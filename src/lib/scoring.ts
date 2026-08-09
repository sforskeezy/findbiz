import type { ScoreBreakdown } from "@/lib/types";

type ScoreInput = {
  distanceMiles: number;
  category: string;
  rating: number | null;
  reviewCount: number | null;
  hasPhone: boolean;
  hasWebsite: boolean;
  locationCount: number | null;
  verifiedBroadbandDelta: boolean;
  uploadGapMbps?: number;
  confidence: "Verified" | "Estimated" | "Manually entered" | "Unavailable" | "Potentially stale";
};

const industryFit: Record<string, number> = {
  "Medical & dental": 15,
  "Legal & accounting": 15,
  "Logistics & warehouse": 15,
  "Property management": 15,
  "Financial services": 15,
  "Education & childcare": 15,
  "Automotive": 12,
  "Hospitality & food": 12,
  "Professional services": 15,
  "Retail": 12,
  "Construction": 12,
  "Agriculture & equine": 12,
  "Community & faith": 8,
  "Other": 8,
};

const dependence: Record<string, number> = {
  "Medical & dental": 20,
  "Legal & accounting": 19,
  "Logistics & warehouse": 18,
  "Property management": 18,
  "Financial services": 20,
  "Education & childcare": 18,
  "Automotive": 15,
  "Hospitality & food": 17,
  "Professional services": 18,
  "Retail": 16,
  "Construction": 14,
  "Agriculture & equine": 13,
  "Community & faith": 10,
  "Other": 10,
};

function proximityScore(distanceMiles: number) {
  if (distanceMiles <= 0.25) return 15;
  if (distanceMiles <= 0.5) return 12;
  if (distanceMiles <= 1) return 9;
  if (distanceMiles <= 2) return 5;
  return 2;
}

export function scoreProspect(input: ScoreInput): {
  total: number;
  breakdown: ScoreBreakdown;
} {
  const organizationScale = Math.min(
    10,
    (input.locationCount && input.locationCount > 1 ? 5 : 2) +
      (input.reviewCount && input.reviewCount >= 100 ? 3 : input.reviewCount ? 2 : 0) +
      (input.rating ? 1 : 0) +
      (input.hasWebsite ? 1 : 0),
  );

  const broadbandOpportunity = input.verifiedBroadbandDelta
    ? Math.min(30, 12 + Math.max(0, Math.round((input.uploadGapMbps ?? 0) / 10)))
    : 0;

  const confidenceBase =
    input.confidence === "Verified"
      ? 5
      : input.confidence === "Manually entered"
        ? 4
        : input.confidence === "Estimated"
          ? 3
          : 1;
  const dataConfidence = Math.min(
    10,
    confidenceBase + (input.hasPhone ? 1 : 0) + (input.hasWebsite ? 1 : 0) + (input.rating ? 1 : 0),
  );

  const breakdown: ScoreBreakdown = {
    proximity: proximityScore(input.distanceMiles),
    industryFit: industryFit[input.category] ?? industryFit.Other,
    operationalDependence: dependence[input.category] ?? dependence.Other,
    organizationScale,
    broadbandOpportunity,
    dataConfidence,
  };

  return {
    total: Math.min(100, Object.values(breakdown).reduce((sum, value) => sum + value, 0)),
    breakdown,
  };
}

export function describeScore(
  score: number,
  distanceMiles: number,
  category: string,
  breakdown: ScoreBreakdown,
) {
  const reasons = [
    `${distanceMiles.toFixed(2)} miles from the target`,
    `${category.toLowerCase()} operations often depend on connected systems`,
  ];

  if (breakdown.organizationScale >= 7) reasons.push("public signals suggest meaningful operating scale");
  if (breakdown.broadbandOpportunity >= 12) reasons.push("verified public data shows a measurable broadband gap");
  else reasons.push("address-level broadband still needs verification");

  return `Score ${score}. ${reasons.join(", ")}.`;
}
