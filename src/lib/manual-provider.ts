import type { PlaceProvider, PlaceSearchRequest, PlaceSearchResult } from "@/lib/place-provider";
import { distanceMiles, normalizeCategory, type PlaceCandidate } from "@/lib/place-candidate";

export type ManualSessionPlace = {
  id: string;
  name: string;
  coordinates: { lat: number; lng: number };
  address?: string | null;
  category?: string | null;
  phone?: string | null;
  website?: string | null;
};

/**
 * Optional request-scoped adapter. The caller owns the array in memory; this
 * provider never reads or writes a file, browser storage, database, or log.
 */
export class ManualSessionPlaceProvider implements PlaceProvider {
  readonly id = "manual_session";

  constructor(private readonly entries: ManualSessionPlace[]) {}

  async searchNearby(request: PlaceSearchRequest): Promise<PlaceSearchResult> {
    const started = performance.now();
    const places: PlaceCandidate[] = this.entries
      .filter((entry) => distanceMiles(request.center, entry.coordinates) <= request.radiusMiles)
      .slice(0, request.budget.maxRecords)
      .map((entry) => ({
        id: `manual-${entry.id}`,
        name: entry.name,
        address: entry.address ?? null,
        coordinates: entry.coordinates,
        category: normalizeCategory(entry.category),
        rawCategories: entry.category ? [entry.category] : [],
        phone: entry.phone ?? null,
        website: entry.website ?? null,
        directoryUrl: null,
        hours: null,
        rating: null,
        reviewCount: null,
        brand: null,
        apartmentUnits: null,
        operatingStatus: "Unknown",
        publicNotes: null,
        sources: [
          {
            providerId: this.id,
            providerRecordId: entry.id,
            label: "Manually entered for this session",
            url: null,
            updatedAt: null,
            confidence: null,
            dataset: null,
          },
        ],
        fieldProvenance: {
          name: [this.id],
          address: entry.address ? [this.id] : [],
          coordinates: [this.id],
          category: entry.category ? [this.id] : [],
          phone: entry.phone ? [this.id] : [],
          website: entry.website ? [this.id] : [],
        },
        sourceDate: "",
        confidence: "Manually entered",
        sourceConfidence: null,
      }));

    return {
      providerId: this.id,
      places,
      completedCellIds: request.cells.map((cell) => cell.id),
      diagnostic: {
        providerId: this.id,
        label: "Manually entered for this session",
        status: "complete",
        code: "MANUAL_SESSION_COMPLETE",
        recordCount: places.length,
        requestCount: 0,
        durationMs: Math.round(performance.now() - started),
        message: "Request-scoped manual entries were checked.",
        attributionUrl: null,
      },
    };
  }
}
