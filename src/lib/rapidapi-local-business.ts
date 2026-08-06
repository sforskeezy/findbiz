import { describeScore, scoreProspect } from "@/lib/scoring";
import { geocodeAddress } from "@/lib/geocode";
import { buildSalesOpportunity, buildSalesSummary } from "@/lib/sales-copy";
import type { Coordinates, Prospect, ResearchResponse } from "@/lib/types";

const HOST = () => process.env.RAPIDAPI_HOST?.trim() || "local-business-data.p.rapidapi.com";

let rapidApiCooldownUntil = 0;

type RapidPlace = {
  business_id?: string;
  place_id?: string;
  google_id?: string;
  name?: string;
  full_address?: string;
  address?: string;
  street_address?: string;
  city?: string;
  state?: string;
  zipcode?: string;
  latitude?: number;
  longitude?: number;
  phone_number?: string;
  website?: string;
  place_link?: string;
  types?: string[];
  type?: string;
  subtypes?: string[];
  rating?: number;
  review_count?: number;
  working_hours?: Record<string, string[]> | string[] | null;
  business_status?: string;
  photos_sample?: Array<{ photo_url?: string }>;
};

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

function categoryFor(place: RapidPlace) {
  const tokens = [...(place.types ?? []), place.type, ...(place.subtypes ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/dentist|doctor|medical|clinic|hospital|pharmacy|veterinary|chiropractor/.test(tokens)) return "Medical & dental";
  if (/lawyer|attorney|accountant|accounting|tax/.test(tokens)) return "Legal & accounting";
  if (/warehouse|logistics|moving|storage|freight/.test(tokens)) return "Logistics & warehouse";
  if (/real estate|property management|realtor/.test(tokens)) return "Property management";
  if (/bank|insurance|financial|credit union/.test(tokens)) return "Financial services";
  if (/school|preschool|child care|daycare|college|university/.test(tokens)) return "Education & childcare";
  if (/car |auto|garage|tire|dealer/.test(tokens)) return "Automotive";
  if (/restaurant|cafe|coffee|bar|hotel|motel|food|pizza|bakery/.test(tokens)) return "Hospitality & food";
  if (/store|shop|retail|grocery|supermarket|boutique/.test(tokens)) return "Retail";
  if (/contractor|construction|plumber|electrician|roofer|hvac/.test(tokens)) return "Construction";
  return "Professional services";
}

function hoursFor(place: RapidPlace): string[] | null {
  if (!place.working_hours) return null;
  if (Array.isArray(place.working_hours)) return place.working_hours;
  return Object.entries(place.working_hours).map(([day, hours]) => `${day}: ${hours.join(", ")}`);
}

function operatingStatus(place: RapidPlace): Prospect["operatingStatus"] {
  const status = (place.business_status || "").toLowerCase();
  if (status.includes("temporarily")) return "Temporarily closed";
  if (status.includes("operational") || status.includes("open")) return "Open";
  return "Unknown";
}

function toProspect(place: RapidPlace, target: Coordinates, retrievedAt: string): Prospect | null {
  if (!place.name || place.latitude == null || place.longitude == null) return null;
  const coordinates = { lat: place.latitude, lng: place.longitude };
  const distance = distanceMiles(target, coordinates);
  const category = categoryFor(place);
  const needs = needsByCategory[category] ?? needsByCategory["Professional services"];
  const phone = place.phone_number || null;
  const website = place.website || null;
  const address =
    place.full_address ||
    place.address ||
    [place.street_address, place.city, place.state, place.zipcode].filter(Boolean).join(", ") ||
    "Address unavailable";
  const id = place.business_id || place.place_id || place.google_id || `rapid-${place.name}-${place.latitude}-${place.longitude}`;
  const { total, breakdown } = scoreProspect({
    distanceMiles: distance,
    category,
    rating: place.rating ?? null,
    reviewCount: place.review_count ?? null,
    hasPhone: Boolean(phone),
    hasWebsite: Boolean(website),
    locationCount: null,
    verifiedBroadbandDelta: false,
    confidence: "Verified",
  });
  const operations = needs.slice(0, 2).join(" and ").toLowerCase();

  return {
    id: `rapid-${id}`,
    name: place.name,
    address,
    coordinates,
    distanceMiles: distance,
    category,
    phone,
    website,
    directoryUrl: place.place_link || null,
    hours: hoursFor(place),
    rating: place.rating ?? null,
    reviewCount: place.review_count ?? null,
    locationCount: null,
    businessSize: null,
    operatingStatus: operatingStatus(place),
    publicNotes: null,
    source: "RapidAPI Local Business Data",
    sourceDate: retrievedAt,
    retrievedAt,
    confidence: "Verified",
    score: total,
    scoreBreakdown: breakdown,
    scoreRationale: describeScore(total, distance, category, breakdown),
    topOpportunity: buildSalesOpportunity(category),
    summary: buildSalesSummary({
      name: place.name,
      category,
      distanceMiles: distance,
      phone,
      website,
      rating: place.rating ?? null,
      reviewCount: place.review_count ?? null,
      operatingStatus: operatingStatus(place),
    }),
    hypothesizedNeeds: needs,
    discoveryQuestions: [
      "How many employees and connected devices normally use your network?",
      `Do connection issues ever affect ${operations}?`,
      "What happens operationally when your internet connection slows down or goes offline?",
    ],
    callOpener: `Hi, this is [Name] with Spectrum Business. I work with businesses in the area on internet reliability and speed. I wanted to ask how your current connection is handling ${operations}.`,
    followUpEmail: {
      subject: `Connectivity options for ${place.name}`,
      body: `Hi — I’m following up from Spectrum Business. I work with nearby teams on reliable connectivity for ${operations}. If it would be useful, I can review the options available at your address and compare them with what your operation needs. Would a brief conversation next week be convenient?`,
    },
  };
}

async function rapidGet(path: string, params: Record<string, string>) {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) throw new Error("RAPIDAPI_KEY is not configured.");
  if (Date.now() < rapidApiCooldownUntil) {
    throw new Error("RapidAPI is temporarily unavailable due to quota limits.");
  }

  const host = HOST();
  const url = new URL(`https://${host}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const response = await fetch(url, {
    headers: {
      "x-rapidapi-key": apiKey,
      "x-rapidapi-host": host,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 429) {
      rapidApiCooldownUntil = Date.now() + 6 * 60 * 60 * 1_000;
    }
    throw new Error(`RapidAPI request failed (${response.status}): ${body.slice(0, 180)}`);
  }

  return (await response.json()) as { data?: RapidPlace[]; status?: string; message?: string };
}

async function searchNearby(center: Coordinates, radiusMiles: number) {
  // One broad query conserves RapidAPI quota; OpenStreetMap remains the fallback.
  const limit = String(Math.min(40, Math.max(16, Math.round(radiusMiles * 20))));
  const batch = await rapidGet("/search-nearby", {
    query: "business",
    lat: String(center.lat),
    lng: String(center.lng),
    limit,
    language: "en",
    region: "us",
    extract_emails_and_contacts: "false",
  });

  const deduped = new Map<string, RapidPlace>();
  for (const place of batch.data ?? []) {
    const key = place.business_id || place.place_id || place.google_id || `${place.name}-${place.latitude}-${place.longitude}`;
    if (key) deduped.set(key, place);
  }
  return [...deduped.values()];
}

export function hasRapidApiKey() {
  return Boolean(process.env.RAPIDAPI_KEY?.trim()) && Date.now() >= rapidApiCooldownUntil;
}

export async function researchWithRapidApi(
  inputAddress: string,
  radiusMiles: number,
): Promise<ResearchResponse> {
  const retrievedAt = new Date().toISOString();
  const location = await geocodeAddress(inputAddress);
  const places = await searchNearby(location.coordinates, radiusMiles);
  const prospects = places
    .map((place) => toProspect(place, location.coordinates, retrievedAt))
    .filter((item): item is Prospect => Boolean(item && item.distanceMiles <= radiusMiles))
    .sort((a, b) => b.score - a.score || a.distanceMiles - b.distanceMiles);

  const warnings = [
    "Business records come from public local listings and may be incomplete. Verify facts before outreach.",
    "Broadband availability is researched only after selecting a business; availability never proves the business's current provider.",
  ];
  if (location.confidence !== "Verified") {
    warnings.unshift(
      "Address was matched at street, city, or ZIP precision, not an exact rooftop point. Confirm the location before outreach.",
    );
  }

  return {
    target: {
      inputAddress,
      formattedAddress: location.formattedAddress,
      coordinates: location.coordinates,
      geocodingConfidence: location.confidence,
    },
    radiusMiles,
    prospects,
    broadband: [],
    sources: [
      {
        id: `rapid-${Date.now()}`,
        label: "Local business listings",
        url: null,
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
