import { describeScore, scoreProspect } from "@/lib/scoring";
import { buildSalesOpportunity, buildSalesSummary } from "@/lib/sales-copy";
import type { Coordinates, Prospect, ResearchResponse } from "@/lib/types";

const GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

type GoogleText = { text?: string; languageCode?: string };

type GooglePlace = {
  id?: string;
  displayName?: GoogleText;
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number; lat?: number; lng?: number };
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: GoogleText;
  nationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[] };
  rating?: number;
  userRatingCount?: number;
  businessStatus?: "OPERATIONAL" | "CLOSED_TEMPORARILY" | "CLOSED_PERMANENTLY";
};

export type GeocodeResult = {
  formattedAddress: string;
  coordinates: Coordinates;
  confidence: "Verified" | "Estimated";
};

function placeCoordinates(place: GooglePlace): Coordinates | null {
  const lat = place.location?.latitude ?? place.location?.lat;
  const lng = place.location?.longitude ?? place.location?.lng;
  if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) return null;
  return { lat, lng };
}

type GeocodeResponse = {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    geometry?: { location?: Coordinates; location_type?: string };
  }>;
};

const categoryTypes: Array<[string[], string]> = [
  [["dentist", "doctor", "medical_clinic", "hospital", "physiotherapist", "pharmacy", "veterinary_care"], "Medical & dental"],
  [["lawyer", "accounting"], "Legal & accounting"],
  [["warehouse", "moving_company", "storage"], "Logistics & warehouse"],
  [["real_estate_agency", "real_estate_agent"], "Property management"],
  [["bank", "insurance_agency", "finance"], "Financial services"],
  [["school", "preschool", "child_care_agency", "primary_school", "secondary_school"], "Education & childcare"],
  [["car_dealer", "car_repair", "car_wash", "car_rental"], "Automotive"],
  [["restaurant", "cafe", "bar", "hotel", "bakery", "meal_takeaway"], "Hospitality & food"],
  [["store", "shopping_mall", "clothing_store", "grocery_store", "convenience_store"], "Retail"],
  [["general_contractor", "roofing_contractor", "electrician", "plumber", "painter"], "Construction"],
  [["farm", "stable"], "Professional services"],
];

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

const PLACE_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.nationalPhoneNumber",
  "places.websiteUri",
  "places.googleMapsUri",
  "places.regularOpeningHours",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
].join(",");

// Nearby Search caps at 20. Fan out by type so rural pins aren't missed.
const NEARBY_TYPE_BATCHES: string[][] = [
  [], // unrestricted — closest establishments
  ["dentist", "doctor", "hospital", "physiotherapist", "pharmacy", "veterinary_care"],
  ["lawyer", "accounting", "bank", "insurance_agency", "real_estate_agency"],
  ["restaurant", "cafe", "bar", "hotel", "store", "grocery_store"],
  ["car_repair", "car_dealer", "car_wash", "electrician", "plumber", "general_contractor"],
  ["school", "preschool", "child_care_agency", "warehouse", "moving_company", "storage"],
  ["farm", "stable", "church", "gym", "beauty_salon", "hair_salon"],
];

/** Text searches catch home-based / oddly typed Google Maps businesses Nearby misses. */
const TEXT_QUERIES = [
  "businesses",
  "companies",
  "home builder",
  "contractor",
  "farm",
  "horse",
  "stable",
  "customs",
  "auto repair",
  "welder",
  "services",
  "shop",
  "office",
];

function categoryFor(place: GooglePlace) {
  const types = [place.primaryType, ...(place.types ?? [])].filter(Boolean) as string[];
  return categoryTypes.find(([candidates]) => candidates.some((value) => types.includes(value)))?.[1] ?? "Professional services";
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

function normalizeOperatingStatus(place: GooglePlace): Prospect["operatingStatus"] {
  if (place.businessStatus === "CLOSED_TEMPORARILY") return "Temporarily closed";
  if (place.businessStatus === "OPERATIONAL") return "Open";
  return "Unknown";
}

/** Official Google Places API path. Off unless explicitly enabled by the operator. */
export function hasGooglePlacesKey() {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim()) && process.env.ENABLE_GOOGLE_PLACES === "true";
}

export function googlePlacesApiKey() {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new Error("GOOGLE_MAPS_API_KEY is not configured.");
  return key;
}

export async function geocodeWithGoogle(address: string, apiKey = googlePlacesApiKey()): Promise<GeocodeResult> {
  const response = await fetch(
    `${GEOCODING_URL}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(apiKey)}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Geocoding request failed (${response.status}).`);

  const payload = (await response.json()) as GeocodeResponse;
  if (payload.status !== "OK" || !payload.results?.[0]?.geometry?.location) {
    if (payload.status === "ZERO_RESULTS") throw new Error("That address could not be located.");
    throw new Error(payload.error_message || `Geocoding returned ${payload.status ?? "an unknown error"}.`);
  }

  const result = payload.results[0];
  return {
    formattedAddress: result.formatted_address ?? address,
    coordinates: result.geometry!.location!,
    confidence: result.geometry?.location_type === "ROOFTOP" ? "Verified" : "Estimated",
  };
}

async function nearbyOnce(center: Coordinates, radiusMiles: number, apiKey: string, includedTypes: string[]) {
  const response = await fetch(NEARBY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACE_FIELD_MASK,
    },
    body: JSON.stringify({
      maxResultCount: 20,
      rankPreference: "DISTANCE",
      ...(includedTypes.length ? { includedTypes } : {}),
      locationRestriction: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: Math.min(radiusMiles * 1609.344, 50000),
        },
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`Places Nearby request failed (${response.status}): ${body}`);
  }
  const payload = (await response.json()) as { places?: GooglePlace[] };
  return payload.places ?? [];
}

async function textSearchOnce(
  query: string,
  center: Coordinates,
  radiusMiles: number,
  apiKey: string,
) {
  const response = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": PLACE_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 20,
      rankPreference: "DISTANCE",
      locationBias: {
        circle: {
          center: { latitude: center.lat, longitude: center.lng },
          radius: Math.min(radiusMiles * 1609.344, 50000),
        },
      },
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`Places Text Search failed (${response.status}): ${body}`);
  }
  const payload = (await response.json()) as { places?: GooglePlace[] };
  return payload.places ?? [];
}

async function settlePool<T>(jobs: Array<() => Promise<T>>, concurrency: number) {
  const results: Array<PromiseSettledResult<T>> = new Array(jobs.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < jobs.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await jobs[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return results;
}

export async function searchNearbyGooglePlaces(
  center: Coordinates,
  radiusMiles: number,
  options: { apiKey?: string; localityHint?: string } = {},
) {
  const apiKey = options.apiKey ?? googlePlacesApiKey();
  const byId = new Map<string, GooglePlace>();
  let firstError: Error | null = null;

  const locality = options.localityHint?.trim();
  const textQueries = locality
    ? TEXT_QUERIES.map((q) => `${q} near ${locality}`)
    : TEXT_QUERIES.map((q) => `${q} nearby`);
  const jobs = [
    ...NEARBY_TYPE_BATCHES.map((types) => () => nearbyOnce(center, radiusMiles, apiKey, types)),
    ...textQueries.map((query) => () => textSearchOnce(query, center, radiusMiles, apiKey)),
  ];

  // A bounded pool preserves the broad query strategy without bursting every
  // paid request at once or tripping a conservative server-side QPS limit.
  const batches = await settlePool(jobs, 4);
  for (const batch of batches) {
    if (batch.status === "fulfilled") {
      for (const place of batch.value) {
        if (place.id && !byId.has(place.id)) byId.set(place.id, place);
      }
    } else if (!firstError) {
      firstError = batch.reason instanceof Error ? batch.reason : new Error(String(batch.reason));
    }
  }

  if (!byId.size && firstError) throw firstError;
  return [...byId.values()];
}

function toProspect(place: GooglePlace, target: Coordinates, retrievedAt: string): Prospect | null {
  const location = placeCoordinates(place);
  if (!place.id || !place.displayName?.text || !location) return null;
  if (place.businessStatus === "CLOSED_PERMANENTLY") return null;

  const distance = distanceMiles(target, location);
  const category = categoryFor(place);
  const needs = needsByCategory[category] ?? needsByCategory["Professional services"];
  const { total, breakdown } = scoreProspect({
    distanceMiles: distance,
    category,
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? null,
    hasPhone: Boolean(place.nationalPhoneNumber),
    hasWebsite: Boolean(place.websiteUri),
    locationCount: null,
    verifiedBroadbandDelta: false,
    confidence: "Verified",
  });
  const name = place.displayName.text;
  const operations = needs.slice(0, 2).join(" and ").toLowerCase();

  return {
    id: place.id,
    name,
    address: place.formattedAddress ?? "Unavailable",
    coordinates: location,
    distanceMiles: distance,
    category,
    phone: place.nationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,
    directoryUrl: place.googleMapsUri ?? null,
    hours: place.regularOpeningHours?.weekdayDescriptions ?? null,
    rating: place.rating ?? null,
    reviewCount: place.userRatingCount ?? null,
    locationCount: null,
    businessSize: null,
    operatingStatus: normalizeOperatingStatus(place),
    publicNotes: null,
    source: "Google Places API (New)",
    sourceDate: retrievedAt,
    retrievedAt,
    confidence: "Verified",
    score: total,
    scoreBreakdown: breakdown,
    scoreRationale: describeScore(total, distance, category, breakdown),
    topOpportunity: buildSalesOpportunity(category),
    summary: buildSalesSummary({
      name,
      category,
      distanceMiles: distance,
      phone: place.nationalPhoneNumber ?? null,
      website: place.websiteUri ?? null,
      rating: place.rating ?? null,
      reviewCount: place.userRatingCount ?? null,
      operatingStatus: normalizeOperatingStatus(place),
    }),
    hypothesizedNeeds: needs,
    discoveryQuestions: [
      "How many employees and connected devices normally use your network?",
      `Do connection issues ever affect ${operations}?`,
      "What happens operationally when your internet connection slows down or goes offline?",
    ],
    callOpener: `Hi, this is [Name] with Spectrum Business. I’m reaching out because we have service in the area, and I work with nearby businesses on internet reliability and speed. I wanted to ask how your current connection is handling ${operations}.`,
    followUpEmail: {
      subject: `Connectivity options for ${name}`,
      body: `Hi — I’m following up from Spectrum Business. I work with nearby teams on reliable connectivity for ${operations}. If it would be useful, I can review the options available at your address and compare them with what your operation needs. Would a brief conversation next week be convenient?`,
    },
  };
}

/**
 * Official Google Places API discovery. The operator is responsible for enabling
 * a billing account and using returned content under their Google Maps license.
 */
export async function researchWithGoogle(
  inputAddress: string,
  radiusMiles: number,
  apiKey = googlePlacesApiKey(),
): Promise<ResearchResponse> {
  if (process.env.ENABLE_GOOGLE_PLACES !== "true") {
    throw new Error("Google Places is disabled. Set ENABLE_GOOGLE_PLACES=true to use it.");
  }
  const retrievedAt = new Date().toISOString();
  const target = await geocodeWithGoogle(inputAddress, apiKey);
  const places = await searchNearbyGooglePlaces(target.coordinates, radiusMiles, {
    apiKey,
    localityHint: target.formattedAddress,
  });
  const deduped = new Map<string, Prospect>();

  for (const place of places) {
    const prospect = toProspect(place, target.coordinates, retrievedAt);
    if (prospect && prospect.distanceMiles <= radiusMiles) deduped.set(prospect.id, prospect);
  }

  return {
    schemaVersion: 3,
    target: {
      inputAddress,
      formattedAddress: target.formattedAddress,
      coordinates: target.coordinates,
      geocodingConfidence: target.confidence,
    },
    radiusMiles,
    prospects: [...deduped.values()].sort((a, b) => b.score - a.score || a.distanceMiles - b.distanceMiles),
    broadband: [],
    sources: [
      {
        id: `google-places-${Date.now()}`,
        label: "Google Places API (New)",
        url: "https://developers.google.com/maps/documentation/places/web-service/overview",
        sourceDate: retrievedAt,
        retrievedAt,
        status: "Verified",
      },
    ],
    retrievedAt,
    demoMode: false,
    warnings: [
      "Google Maps business details were retrieved through the official Places API (New), not by scraping the consumer Maps website.",
      "Use, storage, and export of Google Places content must stay within the operator's Google Maps Platform license.",
      "FCC broadband data is not attached until a business is selected.",
    ],
  };
}
