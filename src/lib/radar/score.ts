import type { DatePrecision, RadarScore, SignalSeverity, SignalType } from "@/lib/radar/types";
import { daysBetween } from "@/lib/radar/time";

const SIGNIFICANCE: Record<SignalType, number> = {
  grand_opening: 20,
  new_location: 20,
  moved: 19,
  reopened: 18,
  new_business: 18,
  coming_soon: 17,
  expanding: 16,
  hiring: 0,
  new_ownership: 15,
  newly_registered: 14,
  multiple_locations: 14,
  address_changed: 12,
  new_website: 12,
  phone_added: 11,
  website_changed: 10,
  renovation: 10,
  newly_active_online: 9,
  possible_new_listing: 0,
};

function recencyPoints(occurredAt: string | null, detectedAt: string, precision: DatePrecision, sincePreviousScanDays?: number | null) {
  const age =
    occurredAt && precision !== "unknown"
      ? daysBetween(occurredAt)
      : sincePreviousScanDays != null
        ? sincePreviousScanDays
        : daysBetween(detectedAt);

  if (age == null) return 6;
  if (age <= 3) return 40;
  if (age <= 7) return 32;
  if (age <= 14) return 24;
  if (age <= 30) return 16;
  if (age <= 90) return 8;
  if (age <= 180) return 4;
  return 1;
}

export function scoreSignal(input: {
  type: SignalType;
  evidenceCount: number;
  independentSources: number;
  occurredAt: string | null;
  detectedAt: string;
  precision: DatePrecision;
  sincePreviousScanDays?: number | null;
  hasPhone: boolean;
  hasWebsite: boolean;
  verified: boolean;
  hiringCount?: number | null;
}): { score: RadarScore; severity: SignalSeverity } {
  const recency = recencyPoints(input.occurredAt, input.detectedAt, input.precision, input.sincePreviousScanDays);
  const corroboration = Math.min(20, input.independentSources * 7 + Math.max(0, input.evidenceCount - input.independentSources) * 2);
  const significance = Math.min(20, SIGNIFICANCE[input.type]);
  const evidenceQuality = Math.min(15, (input.verified ? 8 : 3) + Math.min(7, input.independentSources * 3));
  const relevance = (input.hasPhone ? 3 : 0) + (input.hasWebsite ? 2 : 0);
  const total = Math.max(0, Math.min(100, recency + corroboration + significance + evidenceQuality + relevance));

  let severity: SignalSeverity = "watch";
  if (total >= 72 && recency >= 16 && (input.independentSources >= 2 || recency >= 32)) severity = "hot";
  else if (total >= 70 && significance >= 18 && recency >= 24) severity = "hot";
  else if (total >= 48 && (input.independentSources >= 1 || recency >= 16)) severity = "active";

  if (!input.verified && severity === "hot" && input.independentSources < 2) severity = "active";
  if (input.type === "possible_new_listing" && severity !== "watch") severity = "watch";

  return {
    score: { total, recency, corroboration, significance, evidenceQuality, relevance },
    severity,
  };
}

export function worthContacting(input: { severity: SignalSeverity; score: number; hasPhone: boolean; hasWebsite: boolean; dismissed: boolean }) {
  if (input.dismissed) return false;
  if (input.severity === "hot") return true;
  return input.severity === "active" && input.score >= 58 && (input.hasPhone || input.hasWebsite);
}
