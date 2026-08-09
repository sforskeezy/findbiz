import type { PlaceProvider, PlaceSearchRequest, PlaceSearchResult } from "@/lib/place-provider";
import { normalizeCategory, type PlaceCandidate } from "@/lib/place-candidate";

export function makeCandidate(overrides: Partial<PlaceCandidate> = {}): PlaceCandidate {
  const providerId = overrides.sources?.[0]?.providerId ?? "fixture";
  const candidate: PlaceCandidate = {
    id: "fixture-1",
    name: "Local Fixture LLC",
    address: "101 Commerce St, Public City, PA 19000",
    coordinates: { lat: 40, lng: -75 },
    category: normalizeCategory("consulting"),
    rawCategories: ["consulting"],
    phone: null,
    website: null,
    directoryUrl: null,
    hours: null,
    rating: null,
    reviewCount: null,
    brand: null,
    apartmentUnits: null,
    operatingStatus: "Open",
    publicNotes: null,
    sources: [{ providerId, providerRecordId: "1", label: providerId, url: null, updatedAt: null, confidence: null }],
    fieldProvenance: { name: [providerId], address: [providerId], coordinates: [providerId], category: [providerId] },
    sourceDate: "",
    confidence: "Estimated",
    sourceConfidence: null,
    ...overrides,
  };
  if (!overrides.sources) {
    candidate.sources = [{ providerId, providerRecordId: candidate.id, label: providerId, url: null, updatedAt: null, confidence: null }];
  }
  return candidate;
}

export class StubProvider implements PlaceProvider {
  constructor(readonly id: string, private readonly places: PlaceCandidate[], private readonly status: PlaceSearchResult["diagnostic"]["status"] = "complete") {}
  async searchNearby(request: PlaceSearchRequest): Promise<PlaceSearchResult> {
    return {
      providerId: this.id,
      places: this.places,
      completedCellIds: request.cells.map((cell) => cell.id),
      diagnostic: { providerId: this.id, label: this.id, status: this.status, code: "STUB", recordCount: this.places.length, requestCount: 1, durationMs: 0, message: "stub", attributionUrl: null },
    };
  }
}
