import { geocodeAddress } from "@/lib/geocode";
import { describeScore, scoreProspect } from "@/lib/scoring";
import { buildSalesOpportunity, buildSalesSummary } from "@/lib/sales-copy";
import type { Coordinates, Prospect, ResearchResponse } from "@/lib/types";

const OVERPASS_ENDPOINTS = [
  process.env.OVERPASS_API_URL,
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
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

function userAgent() {
  const contact = process.env.OSM_CONTACT_EMAIL?.trim();
  return contact
    ? `ProspectIQ/0.2 (${contact})`
    : "ProspectIQ/0.2 (private single-user business research)";
}

function distanceMiles(a: Coordinates, b: Coordinates) {
  const earthRadiusMiles = 3958.8;
  const latDelta = ((b.lat - a.lat) * Math.PI) / 180;
  const lngDelta = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function overpassQuery(center: Coordinates, radiusMiles: number) {
  const radiusMeters = Math.round(radiusMiles * 1609.344);
  const around = `${radiusMeters},${center.lat},${center.lng}`;
  return `[out:json][timeout:45];
(
  nwr(around:${around})["name"]["shop"];
  nwr(around:${around})["name"]["amenity"~"^(bank|bar|cafe|car_rental|childcare|clinic|college|dentist|doctors|fast_food|food_court|kindergarten|pharmacy|pub|restaurant|school|veterinary)$"];
  nwr(around:${around})["name"]["office"];
  nwr(around:${around})["name"]["craft"];
  nwr(around:${around})["name"]["tourism"~"hotel|motel|hostel"];
);
out center tags meta 80;`;
}

async function nearby(center: Coordinates, radiusMiles: number) {
  const body = new URLSearchParams({ data: overpassQuery(center, radiusMiles) });
  let lastError: Error | null = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": userAgent(),
          Accept: "application/json",
        },
        body,
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        lastError = new Error(`Nearby business lookup failed (${response.status}).`);
        continue;
      }
      const payload = (await response.json()) as { elements?: OverpassElement[] };
      return payload.elements ?? [];
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Nearby business lookup failed.");
    } finally {
      clearTimeout(timer);
    }
  }

  // Dense urban areas sometimes time out on full queries — retry a lighter shop/amenity pass.
  const lightBody = new URLSearchParams({
    data: `[out:json][timeout:25];
(
  nwr(around:${Math.round(radiusMiles * 1609.344)},${center.lat},${center.lng})["name"]["shop"];
  nwr(around:${Math.round(radiusMiles * 1609.344)},${center.lat},${center.lng})["name"]["amenity"];
  nwr(around:${Math.round(radiusMiles * 1609.344)},${center.lat},${center.lng})["name"]["office"];
);
out center tags 60;`,
  });
  for (const endpoint of OVERPASS_ENDPOINTS.slice(0, 2)) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "User-Agent": userAgent(),
          Accept: "application/json",
        },
        body: lightBody,
        cache: "no-store",
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as { elements?: OverpassElement[] };
      return payload.elements ?? [];
    } catch {
      // Keep trying.
    }
  }

  throw lastError ?? new Error("Nearby business lookup failed.");
}

function categoryFor(tags: OsmTags) {
  const amenity = tags.amenity;
  const office = tags.office;
  const shop = tags.shop;
  const craft = tags.craft;
  const tourism = tags.tourism;

  if (["dentist", "doctors", "clinic", "pharmacy", "veterinary"].includes(amenity ?? "")) return "Medical & dental";
  if (["lawyer", "accountant", "tax_advisor"].includes(office ?? "")) return "Legal & accounting";
  if (["financial", "insurance", "bank"].includes(office ?? "") || amenity === "bank") return "Financial services";
  if (["estate_agent", "property_management"].includes(office ?? "")) return "Property management";
  if (["logistics", "moving_company", "warehouse"].includes(office ?? "")) return "Logistics & warehouse";
  if (["school", "kindergarten", "childcare", "college"].includes(amenity ?? "")) return "Education & childcare";
  if (["car", "car_repair", "car_parts", "tyres", "car_rental"].includes(shop ?? "") || craft === "car_repair") return "Automotive";
  if (["restaurant", "cafe", "bar", "fast_food", "pub", "food_court"].includes(amenity ?? "") || tourism) return "Hospitality & food";
  if (craft || ["construction", "architect", "engineer"].includes(office ?? "")) return "Construction";
  if (shop) return "Retail";
  return "Professional services";
}

const needsByCategory: Record<string, string[]> = {
  "Medical & dental": ["Cloud practice software", "VoIP phones", "Large imaging files", "Guest Wi-Fi"],
  "Legal & accounting": ["Secure cloud applications", "Large file transfers", "Video conferencing", "Off-site backup"],
  "Logistics & warehouse": ["Dispatch continuity", "Cloud inventory tools", "Security cameras", "Backup connectivity"],
  "Property management": ["Cloud property systems", "VoIP phones", "Video conferencing", "Multi-site coordination"],
  "Financial services": ["Secure cloud applications", "Video conferencing", "VoIP phones", "Off-site backup"],
  "Education & childcare": ["Staff connectivity", "Security cameras", "Guest Wi-Fi", "Backup connectivity"],
  Automotive: ["Shop management software", "Payment processing", "Parts ordering", "Guest Wi-Fi"],
  "Hospitality & food": ["Point-of-sale reliability", "Guest Wi-Fi", "Online ordering", "Security cameras"],
  Retail: ["Point-of-sale reliability", "Inventory systems", "Guest Wi-Fi", "Security cameras"],
  Construction: ["Cloud project tools", "Plan file transfers", "Video conferencing", "Field coordination"],
  "Professional services": ["Cloud applications", "VoIP phones", "Video conferencing", "Backup connectivity"],
};

function addressFor(tags: OsmTags) {
  if (tags["addr:full"]) return tags["addr:full"]!;
  const streetLine = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const locality = [tags["addr:city"], tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(", ");
  return [streetLine, locality].filter(Boolean).join(", ") || "Address not listed in OpenStreetMap";
}

function normalizeWebsite(tags: OsmTags) {
  const value = tags.website || tags["contact:website"];
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function pointFor(element: OverpassElement): Coordinates | null {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  return lat === undefined || lng === undefined ? null : { lat, lng };
}

function toProspect(element: OverpassElement, target: Coordinates, retrievedAt: string): Prospect | null {
  const tags = element.tags ?? {};
  const coordinates = pointFor(element);
  if (!coordinates || !tags.name || tags.shop === "vacant") return null;
  const distance = distanceMiles(target, coordinates);
  const category = categoryFor(tags);
  const needs = needsByCategory[category] ?? needsByCategory["Professional services"];
  const phone = tags.phone || tags["contact:phone"] || null;
  const website = normalizeWebsite(tags);
  const ageMs = element.timestamp ? Date.now() - new Date(element.timestamp).getTime() : Number.POSITIVE_INFINITY;
  const confidence = ageMs > 2 * 365 * 24 * 60 * 60 * 1_000 ? "Potentially stale" as const : "Verified" as const;
  const { total, breakdown } = scoreProspect({
    distanceMiles: distance,
    category,
    rating: null,
    reviewCount: null,
    hasPhone: Boolean(phone),
    hasWebsite: Boolean(website),
    locationCount: null,
    verifiedBroadbandDelta: false,
    confidence,
  });
  const name = tags.name;
  const operations = needs.slice(0, 2).join(" and ").toLowerCase();

  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    address: addressFor(tags),
    coordinates,
    distanceMiles: distance,
    category,
    phone,
    website,
    directoryUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    hours: tags.opening_hours ? [tags.opening_hours] : null,
    rating: null,
    reviewCount: null,
    locationCount: null,
    businessSize: null,
    operatingStatus: "Unknown",
    publicNotes: tags.description || null,
    source: "OpenStreetMap contributors",
    sourceDate: element.timestamp || retrievedAt,
    retrievedAt,
    confidence,
    score: total,
    scoreBreakdown: breakdown,
    scoreRationale: describeScore(total, distance, category, breakdown),
    topOpportunity: buildSalesOpportunity(category),
    summary: buildSalesSummary({
      name,
      category,
      distanceMiles: distance,
      phone,
      website,
      rating: null,
      reviewCount: null,
      operatingStatus: "Unknown",
    }),
    hypothesizedNeeds: needs,
    discoveryQuestions: [
      "How many employees and connected devices normally use your network?",
      `Do connection issues ever affect ${operations}?`,
      "What happens operationally when your internet connection slows down or goes offline?",
    ],
    callOpener: `Hi, this is [Name] with Spectrum Business. I work with businesses in the area on internet reliability and speed. I wanted to ask how your current connection is handling ${operations}.`,
    followUpEmail: {
      subject: `Connectivity options for ${name}`,
      body: `Hi — I’m following up from Spectrum Business. I work with nearby teams on reliable connectivity for ${operations}. If it would be useful, I can review the options available at your address and compare them with what your operation needs. Would a brief conversation next week be convenient?`,
    },
  };
}

function deduplicate(prospects: Prospect[]) {
  const kept: Prospect[] = [];
  for (const prospect of prospects.sort((a, b) => a.distanceMiles - b.distanceMiles)) {
    const duplicate = kept.some(
      (item) => item.name.trim().toLowerCase() === prospect.name.trim().toLowerCase() &&
        distanceMiles(item.coordinates, prospect.coordinates) < 0.03,
    );
    if (!duplicate) kept.push(prospect);
  }
  return kept;
}

export async function researchWithOpenStreetMap(
  inputAddress: string,
  radiusMiles: number,
): Promise<ResearchResponse> {
  const retrievedAt = new Date().toISOString();
  const location = await geocodeAddress(inputAddress);
  const target = location.coordinates;
  const elements = await nearby(target, radiusMiles);
  const prospects = deduplicate(
    elements
      .map((element) => toProspect(element, target, retrievedAt))
      .filter((item): item is Prospect => Boolean(item && item.distanceMiles <= radiusMiles)),
  ).sort((a, b) => b.score - a.score || a.distanceMiles - b.distanceMiles);

  const warnings = [
    "Business records come from OpenStreetMap and may be incomplete or stale. Verify facts before outreach.",
    "Broadband availability is researched only after selecting a business; availability never proves the business's current provider.",
  ];
  if (location.confidence !== "Verified") {
    warnings.unshift("Address was matched at street or ZIP precision, not an exact rooftop point. Confirm the location before outreach.");
  }

  return {
    target: {
      inputAddress,
      formattedAddress: location.formattedAddress,
      coordinates: target,
      geocodingConfidence: location.confidence,
    },
    radiusMiles,
    prospects,
    broadband: [],
    sources: [
      {
        id: `osm-${Date.now()}`,
        label: "OpenStreetMap contributors",
        url: "https://www.openstreetmap.org/copyright",
        sourceDate: retrievedAt,
        retrievedAt,
        status: "Verified",
      },
    ],
    retrievedAt,
    demoMode: false,
    warnings,
  };
}
