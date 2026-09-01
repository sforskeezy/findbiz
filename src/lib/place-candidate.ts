import { describeScore, scoreProspect } from "@/lib/scoring";
import { displayPhone } from "@/lib/phone";
import { buildSalesOpportunity, buildSalesSummary } from "@/lib/sales-copy";
import type { Confidence, Coordinates, OperatingStatus, Prospect } from "@/lib/types";

/**
 * Provider-neutral business record. Every PAI Places source (OpenStreetMap,
 * the local operator cache, future licensed feeds) normalizes into this shape
 * so scoring, dedupe, and sales copy stay identical across sources.
 */
export type PlaceCandidate = {
  id: string;
  name: string;
  address: string | null;
  coordinates: Coordinates;
  category: string;
  phone: string | null;
  website: string | null;
  directoryUrl: string | null;
  hours: string[] | null;
  rating: number | null;
  reviewCount: number | null;
  operatingStatus: OperatingStatus;
  publicNotes: string | null;
  /** Honest attribution shown in the UI and CSV export. */
  source: string;
  sourceDate: string;
  confidence: Confidence;
};

export const PLACE_CATEGORIES = [
  "Medical & dental",
  "Legal & accounting",
  "Logistics & warehouse",
  "Property management",
  "Financial services",
  "Education & childcare",
  "Automotive",
  "Hospitality & food",
  "Retail",
  "Construction",
  "Agriculture & equine",
  "Community & faith",
  "Professional services",
] as const;

export const NEEDS_BY_CATEGORY: Record<string, string[]> = {
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
  "Agriculture & equine": ["Property-wide Wi-Fi", "Security cameras", "Booking and billing tools", "Backup connectivity"],
  "Community & faith": ["Guest Wi-Fi", "Streaming and AV", "Security cameras", "Staff connectivity"],
  "Professional services": ["Cloud applications", "VoIP phones", "Video conferencing", "Backup connectivity"],
};

export function distanceMiles(a: Coordinates, b: Coordinates) {
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

/** Accepts loose free-text categories from the operator cache. */
export function normalizeCategory(value: string | null | undefined): string {
  if (!value) return "Professional services";
  const wanted = value.trim().toLowerCase();
  const exact = PLACE_CATEGORIES.find((category) => category.toLowerCase() === wanted);
  if (exact) return exact;
  if (/(dentist|dental|doctor|medical|clinic|pharmacy|veterinary|health care|healthcare)/.test(wanted)) {
    return "Medical & dental";
  }
  if (/(law|attorney|account|tax|cpa)/.test(wanted)) return "Legal & accounting";
  if (/(logistic|warehouse|freight|truck|moving|storage)/.test(wanted)) return "Logistics & warehouse";
  if (/(realty|real estate|property|apartment)/.test(wanted)) return "Property management";
  if (/(bank|insur|financ|credit union)/.test(wanted)) return "Financial services";
  if (/(school|daycare|childcare|preschool|college|academy)/.test(wanted)) return "Education & childcare";
  if (/(auto|car|tire|tyre|mechanic|collision|customs|truck accessor)/.test(wanted)) return "Automotive";
  if (/(restaurant|cafe|coffee|bar|grill|hotel|motel|food|brew)/.test(wanted)) return "Hospitality & food";
  if (/(shop|store|retail|boutique|market)/.test(wanted)) return "Retail";
  if (/(construct|contract|builder|roof|plumb|electric|hvac|homes|landscap)/.test(wanted)) return "Construction";
  if (/(farm|equine|horse|stable|ranch|agri|nursery|kennel)/.test(wanted)) return "Agriculture & equine";
  if (/(church|worship|ministry|congregation|temple|mosque|synagogue|community centre|community center)/.test(wanted)) {
    return "Community & faith";
  }
  return "Professional services";
}

/**
 * Turns a normalized candidate into the full prospect record the UI renders.
 * Scoring is shared with every other provider so results stay comparable.
 */
export function buildProspect(
  candidate: PlaceCandidate,
  target: Coordinates,
  retrievedAt: string,
): Prospect {
  const distance = distanceMiles(target, candidate.coordinates);
  const category = candidate.category;
  const needs = NEEDS_BY_CATEGORY[category] ?? NEEDS_BY_CATEGORY["Professional services"];
  const { total, breakdown } = scoreProspect({
    distanceMiles: distance,
    category,
    rating: candidate.rating,
    reviewCount: candidate.reviewCount,
    hasPhone: Boolean(candidate.phone),
    hasWebsite: Boolean(candidate.website),
    locationCount: null,
    verifiedBroadbandDelta: false,
    confidence: candidate.confidence,
  });
  const operations = needs.slice(0, 2).join(" and ").toLowerCase();

  return {
    id: candidate.id,
    name: candidate.name,
    address: candidate.address ?? "Address not listed in public data",
    coordinates: candidate.coordinates,
    distanceMiles: distance,
    category,
    phone: displayPhone(candidate.phone),
    website: candidate.website,
    directoryUrl: candidate.directoryUrl,
    hours: candidate.hours,
    rating: candidate.rating,
    reviewCount: candidate.reviewCount,
    locationCount: null,
    businessSize: null,
    operatingStatus: candidate.operatingStatus,
    publicNotes: candidate.publicNotes,
    source: candidate.source,
    sourceDate: candidate.sourceDate,
    retrievedAt,
    confidence: candidate.confidence,
    score: total,
    scoreBreakdown: breakdown,
    scoreRationale: describeScore(total, distance, category, breakdown),
    topOpportunity: buildSalesOpportunity(category),
    summary: buildSalesSummary({
      name: candidate.name,
      category,
      distanceMiles: distance,
      phone: candidate.phone,
      website: candidate.website,
      rating: candidate.rating,
      reviewCount: candidate.reviewCount,
      operatingStatus: candidate.operatingStatus,
    }),
    hypothesizedNeeds: needs,
    discoveryQuestions: [
      "How many employees and connected devices normally use your network?",
      `Do connection issues ever affect ${operations}?`,
      "What happens operationally when your internet connection slows down or goes offline?",
    ],
    callOpener: `Hi, this is [Name] with Spectrum Business. I work with businesses in the area on internet reliability and speed. I wanted to ask how your current connection is handling ${operations}.`,
    followUpEmail: {
      subject: `Connectivity options for ${candidate.name}`,
      body: `Hi — I’m following up from Spectrum Business. I work with nearby teams on reliable connectivity for ${operations}. If it would be useful, I can review the options available at your address and compare them with what your operation needs. Would a brief conversation next week be convenient?`,
    },
  };
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[.,'’"&]/g, "")
    .replace(/\b(llc|inc|incorporated|co|corp|company|ltd|the)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Same-business dedupe across sources. Operator-cache entries win over
 * OpenStreetMap because a human curated them.
 */
export function dedupeCandidates(candidates: PlaceCandidate[]): PlaceCandidate[] {
  const kept: PlaceCandidate[] = [];
  const ranked = [...candidates].sort(
    (a, b) => sourceRank(a) - sourceRank(b) || a.name.localeCompare(b.name),
  );

  for (const candidate of ranked) {
    const name = normalizeName(candidate.name);
    if (!name) continue;
    const duplicate = kept.find((item) => {
      const other = normalizeName(item.name);
      const closeEnough = distanceMiles(item.coordinates, candidate.coordinates) < 0.12;
      const sameName = other === name || other.includes(name) || name.includes(other);
      return sameName && closeEnough;
    });
    if (duplicate) continue;
    kept.push(candidate);
  }

  return kept;
}

function sourceRank(candidate: PlaceCandidate) {
  if (candidate.confidence === "Manually entered") return 0;
  return 1;
}
