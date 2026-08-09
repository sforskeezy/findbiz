import { classifyEligibility } from "@/lib/eligibility";
import { describeScore, scoreProspect } from "@/lib/scoring";
import { buildSalesOpportunity, buildSalesSummary } from "@/lib/sales-copy";
import type {
  Confidence,
  Coordinates,
  DataConfidence,
  FieldProvenance,
  OperatingStatus,
  PlaceSource,
  Prospect,
  ProspectPriority,
} from "@/lib/types";

export type PlaceCandidate = {
  id: string;
  name: string;
  address: string | null;
  coordinates: Coordinates;
  category: string;
  rawCategories: string[];
  phone: string | null;
  website: string | null;
  directoryUrl: string | null;
  hours: string[] | null;
  rating: number | null;
  reviewCount: number | null;
  brand: string | null;
  apartmentUnits: number | null;
  operatingStatus: OperatingStatus;
  publicNotes: string | null;
  sources: PlaceSource[];
  fieldProvenance: FieldProvenance;
  sourceDate: string;
  confidence: Confidence;
  sourceConfidence: number | null;
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
  "Other/Unknown",
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
  "Other/Unknown": ["Connected operations", "Payment or booking tools", "Security cameras", "Backup connectivity"],
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

export function normalizeCategory(value: string | null | undefined): string {
  if (!value) return "Other/Unknown";
  const wanted = value.trim().toLowerCase().replace(/_/g, " ");
  const exact = PLACE_CATEGORIES.find((category) => category.toLowerCase() === wanted);
  if (exact) return exact;
  if (/(dent|doctor|medic|clinic|pharm|vet|health|optometr|chiropract)/.test(wanted)) return "Medical & dental";
  if (/(law|attorney|account|tax|cpa|notary)/.test(wanted)) return "Legal & accounting";
  if (/(logistic|warehouse|freight|truck|moving|storage|distribution)/.test(wanted)) return "Logistics & warehouse";
  if (/(realty|real estate|property management|apartment)/.test(wanted)) return "Property management";
  if (/(bank|insur|financ|credit union)/.test(wanted)) return "Financial services";
  if (/(daycare|childcare|preschool|driving school|music school|tutor)/.test(wanted)) return "Education & childcare";
  if (/(auto|car|tire|tyre|mechanic|collision|vehicle|motorcycle|truck repair)/.test(wanted)) return "Automotive";
  if (/(restaurant|cafe|coffee|bar|grill|hotel|motel|food|brew|lodging|resort)/.test(wanted)) return "Hospitality & food";
  if (/(shop|store|retail|boutique|market|florist|jewelry|clothing)/.test(wanted)) return "Retail";
  if (/(construct|contract|builder|roof|plumb|electric|hvac|landscap|craft|repair)/.test(wanted)) return "Construction";
  if (/(farm|equine|horse|stable|ranch|agri|nursery|kennel)/.test(wanted)) return "Agriculture & equine";
  if (/(church|worship|ministry|congregation|temple|mosque|synagogue|community cent)/.test(wanted)) return "Community & faith";
  if (/(office|consult|professional|software|agency|architect|engineer)/.test(wanted)) return "Professional services";
  return "Other/Unknown";
}

function evidenceCompleteness(candidate: PlaceCandidate) {
  const checks = [candidate.address, candidate.phone, candidate.website, candidate.rawCategories.length > 0, candidate.brand];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function candidateDataConfidence(candidate: PlaceCandidate): DataConfidence {
  const sources = new Set(candidate.sources.map((source) => source.providerId)).size;
  const completeness = evidenceCompleteness(candidate);
  const confidence = candidate.sourceConfidence ?? 0.5;
  if ((sources >= 2 && completeness >= 40) || (confidence >= 0.85 && completeness >= 60)) return "High";
  if (completeness >= 40 || confidence >= 0.6) return "Medium";
  return "Low";
}

function priorityFor(
  score: number,
  eligibility: Prospect["eligibility"],
  dataConfidence: DataConfidence,
): ProspectPriority {
  if (eligibility.status === "unknown") return "Eligibility unknown";
  if (score >= 65 && dataConfidence !== "Low") return "Strong prospect";
  if (score >= 48) return "Worth checking";
  return "Thin evidence";
}

export function buildProspect(candidate: PlaceCandidate, target: Coordinates, retrievedAt: string): Prospect {
  const distance = distanceMiles(target, candidate.coordinates);
  const category = candidate.category || "Other/Unknown";
  const needs = NEEDS_BY_CATEGORY[category] ?? NEEDS_BY_CATEGORY["Other/Unknown"];
  const dataConfidence = candidateDataConfidence(candidate);
  const completeness = evidenceCompleteness(candidate);
  const eligibility = classifyEligibility(candidate);
  const { total, breakdown } = scoreProspect({
    distanceMiles: distance,
    category,
    hasPhone: Boolean(candidate.phone),
    hasWebsite: Boolean(candidate.website),
    sourceCount: new Set(candidate.sources.map((source) => source.providerId)).size,
    dataConfidence,
    evidenceCompleteness: completeness,
  });
  const operations = needs.slice(0, 2).join(" and ").toLowerCase();
  const sourceLabels = [...new Set(candidate.sources.map((source) => source.label))];

  return {
    id: candidate.id,
    name: candidate.name,
    address: candidate.address ?? "Address not listed in public data",
    coordinates: candidate.coordinates,
    distanceMiles: distance,
    category,
    rawCategories: candidate.rawCategories,
    phone: candidate.phone,
    website: candidate.website,
    directoryUrl: candidate.directoryUrl,
    hours: candidate.hours,
    rating: candidate.rating,
    reviewCount: candidate.reviewCount,
    locationCount: null,
    businessSize: null,
    brand: candidate.brand,
    apartmentUnits: candidate.apartmentUnits,
    operatingStatus: candidate.operatingStatus,
    publicNotes: candidate.publicNotes,
    source: sourceLabels.join(" + "),
    sources: candidate.sources,
    fieldProvenance: candidate.fieldProvenance,
    sourceDate: candidate.sourceDate,
    retrievedAt,
    confidence: candidate.confidence,
    dataConfidence,
    evidenceCompleteness: completeness,
    eligibility,
    priority: priorityFor(total, eligibility, dataConfidence),
    score: total,
    scoreBreakdown: breakdown,
    scoreRationale: describeScore(total, distance, category, breakdown, dataConfidence, completeness),
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
    hypothesizedNeeds: needs.map((need) => `Hypothesis to test: ${need}`),
    discoveryQuestions: [
      "How many employees and connected devices normally use your network?",
      `Do connection issues ever affect ${operations}?`,
      "What happens operationally when your internet connection slows down or goes offline?",
    ],
    callOpener: `Hi, this is [Name] with [Company]. I’m researching how nearby businesses handle connectivity. Could I ask how your current connection supports ${operations}?`,
    followUpEmail: {
      subject: `Connectivity questions for ${candidate.name}`,
      body: `Hi — I’m following up about connectivity for ${operations}. If useful, I can compare publicly available options with what your operation actually needs. Would a brief conversation next week be convenient?`,
    },
  };
}

export function normalizeBusinessName(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(llc|inc|incorporated|co|corp|company|ltd|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedPhone(value: string | null) {
  const digits = value?.replace(/\D/g, "") ?? "";
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function normalizedDomain(value: string | null) {
  if (!value) return "";
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return "";
  }
}

function splitAddress(value: string | null) {
  const normalized = (value ?? "")
    .toLowerCase()
    .replace(/\bstreet\b/g, "st")
    .replace(/\broad\b/g, "rd")
    .replace(/\bavenue\b/g, "ave")
    .replace(/[^a-z0-9#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const unit = normalized.match(/\b(?:suite|ste|unit|#)\s*([a-z0-9-]+)/)?.[1] ?? "";
  const base = normalized.replace(/\b(?:suite|ste|unit|#)\s*[a-z0-9-]+\b/g, "").trim();
  return { base, unit };
}

function nameSimilarity(a: string, b: string) {
  const left = new Set(normalizeBusinessName(a).split(" ").filter(Boolean));
  const right = new Set(normalizeBusinessName(b).split(" ").filter(Boolean));
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  return intersection / Math.max(left.size, right.size);
}

function sameProviderRecord(a: PlaceCandidate, b: PlaceCandidate) {
  return a.sources.some((left) =>
    b.sources.some(
      (right) =>
        left.providerId === right.providerId && left.providerRecordId === right.providerRecordId,
    ),
  );
}

export function candidatesRepresentSameBusiness(a: PlaceCandidate, b: PlaceCandidate) {
  if (sameProviderRecord(a, b)) return true;
  const distance = distanceMiles(a.coordinates, b.coordinates);
  if (distance > 0.25) return false;

  const aAddress = splitAddress(a.address);
  const bAddress = splitAddress(b.address);
  if (aAddress.unit && bAddress.unit && aAddress.unit !== bAddress.unit) return false;

  const similarity = nameSimilarity(a.name, b.name);
  const phoneMatch = Boolean(normalizedPhone(a.phone)) && normalizedPhone(a.phone) === normalizedPhone(b.phone);
  const domainMatch = Boolean(normalizedDomain(a.website)) && normalizedDomain(a.website) === normalizedDomain(b.website);
  const addressMatch = Boolean(aAddress.base) && aAddress.base === bAddress.base;
  const exactName = normalizeBusinessName(a.name) === normalizeBusinessName(b.name);

  if (phoneMatch && similarity >= 0.5 && distance < 0.12) return true;
  if (domainMatch && similarity >= 0.6 && distance < 0.12) return true;
  if (addressMatch && similarity >= 0.75) return true;
  return exactName && distance < 0.045;
}

function scoreValue(candidate: PlaceCandidate, value: unknown) {
  if (value === null || value === undefined || value === "") return -1;
  const sourceBonus = candidate.sources.some((source) => source.providerId === "overture") ? 2 : 0;
  return (candidate.sourceConfidence ?? 0.4) * 10 + sourceBonus + String(value).length / 100;
}

function chooseField<K extends keyof PlaceCandidate>(a: PlaceCandidate, b: PlaceCandidate, key: K) {
  return scoreValue(b, b[key]) > scoreValue(a, a[key]) ? b[key] : a[key];
}

function mergeProvenance(a: FieldProvenance, b: FieldProvenance): FieldProvenance {
  const merged: FieldProvenance = { ...a };
  for (const [field, providerIds] of Object.entries(b)) {
    const key = field as keyof FieldProvenance;
    merged[key] = [...new Set([...(merged[key] ?? []), ...(providerIds ?? [])])];
  }
  return merged;
}

export function mergeCandidates(a: PlaceCandidate, b: PlaceCandidate): PlaceCandidate {
  const sources = [...a.sources];
  for (const source of b.sources) {
    if (!sources.some((item) => item.providerId === source.providerId && item.providerRecordId === source.providerRecordId)) {
      sources.push(source);
    }
  }
  const name = chooseField(a, b, "name");
  const address = chooseField(a, b, "address");
  const category = chooseField(a, b, "category");
  const phone = chooseField(a, b, "phone");
  const website = chooseField(a, b, "website");
  const brand = chooseField(a, b, "brand");
  const primary = scoreValue(b, b.name) > scoreValue(a, a.name) ? b : a;
  return {
    ...primary,
    id: a.sources.some((source) => source.providerId === "overture") ? a.id : b.sources.some((source) => source.providerId === "overture") ? b.id : a.id,
    name,
    address,
    category,
    rawCategories: [...new Set([...a.rawCategories, ...b.rawCategories])],
    phone,
    website,
    brand,
    apartmentUnits: a.apartmentUnits ?? b.apartmentUnits,
    operatingStatus:
      a.operatingStatus === "Permanently closed" || b.operatingStatus === "Permanently closed"
        ? "Permanently closed"
        : chooseField(a, b, "operatingStatus"),
    sources,
    fieldProvenance: mergeProvenance(a.fieldProvenance, b.fieldProvenance),
    sourceDate: [a.sourceDate, b.sourceDate].filter(Boolean).sort().at(-1) ?? a.sourceDate,
    sourceConfidence: Math.max(a.sourceConfidence ?? 0, b.sourceConfidence ?? 0) || null,
  };
}

export function dedupeCandidates(candidates: PlaceCandidate[]): PlaceCandidate[] {
  const kept: PlaceCandidate[] = [];
  for (const candidate of candidates) {
    const duplicateIndex = kept.findIndex((item) => candidatesRepresentSameBusiness(item, candidate));
    if (duplicateIndex < 0) kept.push(candidate);
    else kept[duplicateIndex] = mergeCandidates(kept[duplicateIndex], candidate);
  }
  return kept;
}
