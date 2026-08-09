import type { DataConfidence, ScoreBreakdown } from "@/lib/types";

type ScoreInput = {
  distanceMiles: number;
  category: string;
  hasPhone: boolean;
  hasWebsite: boolean;
  sourceCount: number;
  dataConfidence: DataConfidence;
  evidenceCompleteness: number;
};

const industryFit: Record<string, number> = {
  "Medical & dental": 15,
  "Legal & accounting": 15,
  "Logistics & warehouse": 15,
  "Property management": 13,
  "Financial services": 12,
  "Education & childcare": 11,
  Automotive: 13,
  "Hospitality & food": 13,
  "Professional services": 14,
  Retail: 12,
  Construction: 13,
  "Agriculture & equine": 12,
  "Community & faith": 8,
  "Other/Unknown": 7,
};

const dependence: Record<string, number> = {
  "Medical & dental": 20,
  "Legal & accounting": 19,
  "Logistics & warehouse": 18,
  "Property management": 18,
  "Financial services": 20,
  "Education & childcare": 17,
  Automotive: 15,
  "Hospitality & food": 17,
  "Professional services": 18,
  Retail: 16,
  Construction: 14,
  "Agriculture & equine": 13,
  "Community & faith": 10,
  "Other/Unknown": 9,
};

function proximityScore(distanceMiles: number) {
  if (distanceMiles <= 0.25) return 15;
  if (distanceMiles <= 0.5) return 12;
  if (distanceMiles <= 1) return 9;
  if (distanceMiles <= 2) return 5;
  return 2;
}

export function scoreProspect(input: ScoreInput): { total: number; breakdown: ScoreBreakdown } {
  const evidencePoints = (input.hasPhone ? 2 : 0) + (input.hasWebsite ? 2 : 0) + Math.min(3, input.sourceCount);
  const organizationScale = Math.min(10, 2 + evidencePoints);
  const confidenceBase = input.dataConfidence === "High" ? 6 : input.dataConfidence === "Medium" ? 4 : 2;
  const dataConfidence = Math.min(10, confidenceBase + Math.round(input.evidenceCompleteness / 34));

  const breakdown: ScoreBreakdown = {
    proximity: proximityScore(input.distanceMiles),
    industryFit: industryFit[input.category] ?? industryFit["Other/Unknown"],
    operationalDependence: dependence[input.category] ?? dependence["Other/Unknown"],
    organizationScale,
    broadbandOpportunity: 0,
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
  confidence: DataConfidence,
  completeness: number,
) {
  const reasons = [
    `${distanceMiles.toFixed(2)} miles from the target`,
    `${category.toLowerCase()} category fit`,
    `${confidence.toLowerCase()} data confidence`,
    `${completeness}% evidence completeness`,
  ];
  if (breakdown.broadbandOpportunity === 0) reasons.push("FCC context is not used to decide business eligibility");
  return `Prospect-research heuristic ${score}/100: ${reasons.join(", ")}. It is not a probability of sale.`;
}
