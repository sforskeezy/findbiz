import { normalizeCategory, type PlaceCandidate } from "@/lib/place-candidate";
import type { Confidence, Coordinates } from "@/lib/types";

const OVERPASS_ENDPOINTS = [
  process.env.OVERPASS_API_URL,
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);

type OsmTags = Record<string, string | undefined>;

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  timestamp?: string;
  tags?: OsmTags;
};

const AMENITY_NOISE = [
  "atm", "bbq", "bench", "bicycle_parking", "bicycle_repair_station", "bicycle_rental",
  "charging_station", "clock", "drinking_water", "ferry_terminal", "fire_hydrant", "fountain",
  "grave_yard", "hunting_stand", "letter_box", "lounger", "motorcycle_parking", "parking",
  "parking_entrance", "parking_space", "picnic_table", "post_box", "public_bookcase",
  "recycling", "shelter", "street_lamp", "table", "telephone", "toilets", "vending_machine",
  "waste_basket", "waste_disposal", "waste_transfer_station", "watering_place",
].join("|");

const TOURISM_NOISE = ["artwork", "information", "picnic_site", "viewpoint"].join("|");

const LEISURE_BUSINESS = [
  "adult_gaming_centre", "amusement_arcade", "bowling_alley", "dance", "escape_game",
  "fitness_centre", "golf_course", "hackerspace", "horse_riding", "marina", "resort",
  "sports_centre", "stadium", "trampoline_park", "water_park",
].join("|");

const BUILDING_BUSINESS = [
  "commercial", "farm", "farm_auxiliary", "greenhouse", "industrial", "kiosk", "office",
  "retail", "warehouse",
].join("|");

const NON_BUSINESS_KEYS = [
  "highway", "waterway", "railway", "power", "barrier", "boundary", "natural", "place",
  "junction", "route", "aeroway", "traffic_calming",
];

/** Short-lived OSM responses — rural Overpass is the bottleneck. */
const osmCache = new Map<string, { expiresAt: number; value: PlaceCandidate[] }>();

function userAgent() {
  const contact = process.env.OSM_CONTACT_EMAIL?.trim();
  return contact
    ? `ProspectIQ/0.3 (${contact})`
    : "ProspectIQ/0.3 (private single-user business research)";
}

function cacheKey(center: Coordinates, radiusMiles: number) {
  return `${center.lat.toFixed(4)}:${center.lng.toFixed(4)}:${radiusMiles}`;
}

/** Fast path: named shops / amenities / offices / craft / company only. */
function lightQuery(center: Coordinates, radiusMiles: number) {
  const radiusMeters = Math.round(radiusMiles * 1609.344);
  const a = `around:${radiusMeters},${center.lat},${center.lng}`;
  return `[out:json][timeout:8];
(
  nwr(${a})["name"]["shop"];
  nwr(${a})["name"]["amenity"];
  nwr(${a})["name"]["office"];
  nwr(${a})["name"]["craft"];
  nwr(${a})["name"]["company"];
  nwr(${a})["name"]["healthcare"];
  nwr(${a})["name"]["tourism"];
  nwr(${a})["name"]["industrial"];
);
out center tags 100;`;
}

/**
 * Broader rural-friendly path when light returns nothing.
 * Includes industrial yards, farmyards, named commercial buildings, operators,
 * and leisure businesses that often miss shop=/office= tags.
 */
function mediumQuery(center: Coordinates, radiusMiles: number) {
  const radiusMeters = Math.round(radiusMiles * 1609.344);
  const a = `around:${radiusMeters},${center.lat},${center.lng}`;
  return `[out:json][timeout:14];
(
  nwr(${a})["shop"]["shop"!="vacant"];
  nwr(${a})["craft"];
  nwr(${a})["company"];
  nwr(${a})["industrial"];
  nwr(${a})["healthcare"];
  nwr(${a})["office"]["office"!="vacant"];
  nwr(${a})["amenity"]["name"]["amenity"!~"^(${AMENITY_NOISE})$"];
  nwr(${a})["tourism"]["name"]["tourism"!~"^(${TOURISM_NOISE})$"];
  nwr(${a})["leisure"~"^(${LEISURE_BUSINESS})$"];
  nwr(${a})["landuse"~"^(commercial|retail|industrial|farmyard|quarry)$"]["name"];
  nwr(${a})["building"~"^(${BUILDING_BUSINESS})$"]["name"];
  nwr(${a})["man_made"="works"]["name"];
  nwr(${a})["operator"]["shop"];
  nwr(${a})["operator"]["craft"];
  nwr(${a})["operator"]["office"];
  nwr(${a})["operator"]["industrial"];
  nwr(${a})["operator"]["company"];
  nwr(${a})["club"]["name"];
);
out center tags 160;`;
}

/** Race mirrors; first successful JSON wins. Hard per-attempt timeout. */
async function raceOverpass(data: string, endpoints: string[], attemptMs: number) {
  const body = new URLSearchParams({ data });
  const errors: Error[] = [];

  return await new Promise<OverpassElement[]>((resolve, reject) => {
    let settled = false;
    let pending = endpoints.length;
    if (!pending) {
      reject(new Error("No Overpass endpoints configured."));
      return;
    }

    for (const endpoint of endpoints) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), attemptMs);
      fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": userAgent(),
          Accept: "application/json",
        },
        body,
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Overpass ${response.status}`);
          const payload = (await response.json()) as { elements?: OverpassElement[] };
          if (!settled) {
            settled = true;
            resolve(payload.elements ?? []);
          }
        })
        .catch((error) => {
          errors.push(error instanceof Error ? error : new Error(String(error)));
        })
        .finally(() => {
          clearTimeout(timer);
          pending -= 1;
          if (!settled && pending === 0) {
            reject(errors[0] ?? new Error("Overpass request failed."));
          }
        });
    }
  });
}

function categoryFor(tags: OsmTags): string {
  const amenity = tags.amenity ?? "";
  const office = tags.office ?? "";
  const shop = tags.shop ?? "";
  const craft = tags.craft ?? "";
  const leisure = tags.leisure ?? "";
  const landuse = tags.landuse ?? "";
  const building = tags.building ?? "";

  if (["dentist", "doctors", "clinic", "pharmacy", "veterinary", "hospital", "nursing_home"].includes(amenity) || tags.healthcare) {
    return "Medical & dental";
  }
  if (["place_of_worship", "community_centre", "social_facility", "social_centre", "townhall"].includes(amenity)) {
    return "Community & faith";
  }
  if (["lawyer", "accountant", "tax_advisor", "notary"].includes(office)) return "Legal & accounting";
  if (["financial", "insurance", "financial_advisor"].includes(office) || amenity === "bank") return "Financial services";
  if (["estate_agent", "property_management"].includes(office)) return "Property management";
  if (["logistics", "moving_company", "forwarding"].includes(office) || tags.industrial === "warehouse" || building === "warehouse") {
    return "Logistics & warehouse";
  }
  if (["school", "kindergarten", "childcare", "college", "university", "driving_school", "language_school", "music_school"].includes(amenity)) {
    return "Education & childcare";
  }
  if (
    ["car", "car_repair", "car_parts", "tyres", "car_rental", "truck", "truck_repair", "motorcycle", "trailer"].includes(shop) ||
    ["car_repair", "car_painter", "coachbuilder"].includes(craft) ||
    ["car_wash", "fuel", "vehicle_inspection", "driving_school"].includes(amenity)
  ) {
    return "Automotive";
  }
  if (
    leisure === "horse_riding" ||
    landuse === "farmyard" ||
    ["farm", "farm_auxiliary", "greenhouse"].includes(building) ||
    ["stable", "animal_boarding", "animal_breeding", "kennel"].includes(amenity) ||
    ["agrarian", "garden_centre", "farm"].includes(shop)
  ) {
    return "Agriculture & equine";
  }
  if (["restaurant", "cafe", "bar", "fast_food", "pub", "food_court", "ice_cream", "biergarten"].includes(amenity) || tags.tourism) {
    return "Hospitality & food";
  }
  if (
    craft ||
    ["construction", "architect", "engineer", "surveyor"].includes(office) ||
    ["doityourself", "hardware", "trade", "building_materials"].includes(shop) ||
    landuse === "industrial" ||
    tags.industrial ||
    tags.man_made === "works"
  ) {
    return "Construction";
  }
  if (shop || landuse === "retail") return "Retail";
  return "Professional services";
}

function addressFor(tags: OsmTags): string | null {
  if (tags["addr:full"]) return tags["addr:full"];
  const streetLine = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const locality = [tags["addr:city"], tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(", ");
  return [streetLine, locality].filter(Boolean).join(", ") || null;
}

function normalizeWebsite(tags: OsmTags) {
  const value = tags.website || tags["contact:website"] || tags.url;
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function pointFor(element: OverpassElement): Coordinates | null {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  return lat === undefined || lng === undefined ? null : { lat, lng };
}

function looksLikeBusiness(tags: OsmTags) {
  if (NON_BUSINESS_KEYS.some((key) => tags[key])) return false;
  if (tags.shop === "vacant" || tags.disused === "yes" || tags["disused:shop"]) return false;
  if (tags.landuse === "residential" || tags.building === "house" || tags.building === "residential") return false;
  if (Object.keys(tags).some((key) => /^(was|demolished|removed|abandoned|razed):/.test(key))) return false;
  if (tags.amenity && new RegExp(`^(${AMENITY_NOISE})$`).test(tags.amenity)) return false;

  return Boolean(
    tags.shop || tags.craft || tags.office || tags.healthcare || tags.company ||
      tags.industrial || tags.club || tags.operator || tags.amenity ||
      tags.man_made === "works" ||
      (tags.tourism && !new RegExp(`^(${TOURISM_NOISE})$`).test(tags.tourism)) ||
      (tags.leisure && new RegExp(`^(${LEISURE_BUSINESS})$`).test(tags.leisure)) ||
      ["commercial", "retail", "industrial", "farmyard", "quarry"].includes(tags.landuse ?? "") ||
      new RegExp(`^(${BUILDING_BUSINESS})$`).test(tags.building ?? ""),
  );
}

function toCandidate(element: OverpassElement): PlaceCandidate | null {
  const tags = element.tags ?? {};
  const coordinates = pointFor(element);
  const name = (tags.name || tags.operator || tags.brand || "").trim();
  // Cabin/site numbers and other non-business labels ("24", "Unit 3").
  if (!coordinates || !name || !looksLikeBusiness(tags)) return null;
  if (/^\d+[A-Za-z]?$/.test(name)) return null;
  if (/^(unit|lot|site|cabin|room|bldg|building)\s*#?\s*\d+/i.test(name)) return null;

  const ageMs = element.timestamp ? Date.now() - new Date(element.timestamp).getTime() : Number.POSITIVE_INFINITY;
  const confidence: Confidence = ageMs > 2 * 365 * 24 * 60 * 60 * 1_000 ? "Potentially stale" : "Verified";

  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    address: addressFor(tags),
    coordinates,
    category: normalizeCategory(categoryFor(tags)),
    phone: tags.phone || tags["contact:phone"] || null,
    website: normalizeWebsite(tags),
    directoryUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    hours: tags.opening_hours ? [tags.opening_hours] : null,
    rating: null,
    reviewCount: null,
    operatingStatus: "Unknown",
    publicNotes: tags.description || null,
    source: "OpenStreetMap contributors",
    sourceDate: element.timestamp || new Date().toISOString(),
    confidence,
  };
}

function toCandidates(elements: OverpassElement[]) {
  const candidates: PlaceCandidate[] = [];
  for (const element of elements) {
    const candidate = toCandidate(element);
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

/**
 * Fast OSM nearby lookup. Light query first (race mirrors), then one medium
 * retry if empty. Hard total budget ~12s instead of the old 55–80s path.
 */
export async function fetchOsmCandidates(
  center: Coordinates,
  radiusMiles: number,
): Promise<PlaceCandidate[]> {
  const key = cacheKey(center, radiusMiles);
  const cached = osmCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const mirrors = OVERPASS_ENDPOINTS.slice(0, 3);
  let candidates: PlaceCandidate[] = [];

  try {
    candidates = toCandidates(await raceOverpass(lightQuery(center, radiusMiles), mirrors, 7_000));
  } catch {
    // Fall through to medium.
  }

  if (!candidates.length) {
    try {
      candidates = toCandidates(await raceOverpass(mediumQuery(center, radiusMiles), mirrors.slice(0, 2), 11_000));
    } catch {
      // Return empty rather than hanging the whole search — rural OSM gaps are common.
      candidates = [];
    }
  }

  osmCache.set(key, { value: candidates, expiresAt: Date.now() + 10 * 60 * 1_000 });
  return candidates;
}
