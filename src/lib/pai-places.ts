import { geocodeAddress } from "@/lib/geocode";
import { searchPlaces } from "@/lib/place-search";
import { coalesceRequest } from "@/lib/request-safety";
import type {
  Confidence,
  Coordinates,
  Prospect,
  ResearchResponse,
  SearchDiagnostics,
} from "@/lib/types";

export const PAI_PLACES_LABEL = "PAI Places · multi-source discovery";

export type PaiGeocodeResult = {
  formattedAddress: string;
  coordinates: Coordinates;
  confidence: Confidence;
  provider: string;
};

export type PaiNearbyResult = {
  target: PaiGeocodeResult;
  radiusMiles: number;
  prospects: Prospect[];
  eligibilityUnknown: Prospect[];
  diagnostics: SearchDiagnostics;
  retrievedAt: string;
};

/** Public geocoders only: US Census, then Photon, then Nominatim. */
export async function paiGeocode(inputAddress: string): Promise<PaiGeocodeResult> {
  const key = inputAddress.trim().toLowerCase().replace(/\s+/g, " ");
  return coalesceRequest(`geocode:${key}`, async () => {
    const result = await geocodeAddress(inputAddress);
    return {
      formattedAddress: result.formattedAddress,
      coordinates: result.coordinates,
      confidence: result.confidence,
      provider: result.provider,
    };
  });
}

export async function paiNearby(inputAddress: string, radiusMiles: number): Promise<PaiNearbyResult> {
  const target = await paiGeocode(inputAddress);
  const search = await searchPlaces(target.coordinates, radiusMiles);
  return {
    target,
    radiusMiles,
    prospects: search.prospects,
    eligibilityUnknown: search.eligibilityUnknown,
    diagnostics: search.diagnostics,
    retrievedAt: new Date().toISOString(),
  };
}

export async function researchWithPaiPlaces(
  inputAddress: string,
  radiusMiles: number,
): Promise<ResearchResponse> {
  const nearby = await paiNearby(inputAddress, radiusMiles);
  const { retrievedAt, prospects, target, diagnostics } = nearby;
  const warnings: string[] = [];

  if (diagnostics.partialCoverage) {
    warnings.push("Coverage is partial. Successful source results are shown; source-specific limits appear in diagnostics.");
  }
  if (!prospects.length) {
    warnings.push("No eligible businesses were returned in this radius. This is not proof that no businesses exist.");
  }
  if (nearby.eligibilityUnknown.length) {
    warnings.push(`${nearby.eligibilityUnknown.length} record(s) require eligibility verification and are hidden from the primary list.`);
  }
  if (target.confidence !== "Verified") {
    warnings.push("The search location is estimated rather than an exact rooftop match.");
  }
  warnings.push("Business records can be incomplete or stale. Verify public facts before outreach.");

  const sources = diagnostics.providers
    .filter((provider) => provider.status !== "disabled")
    .map((provider, index) => ({
      id: `${provider.providerId}-${index}`,
      label: provider.label,
      url: provider.attributionUrl,
      sourceDate: "",
      retrievedAt,
      status:
        provider.status === "complete"
          ? ("Verified" as const)
          : provider.status === "partial"
            ? ("Estimated" as const)
            : ("Unavailable" as const),
    }));

  return {
    target: {
      inputAddress,
      formattedAddress: target.formattedAddress,
      coordinates: target.coordinates,
      geocodingConfidence: target.confidence,
    },
    radiusMiles,
    prospects,
    eligibilityUnknown: nearby.eligibilityUnknown,
    broadband: [],
    sources,
    diagnostics,
    partialCoverage: diagnostics.partialCoverage,
    retrievedAt,
    demoMode: false,
    warnings,
  };
}
