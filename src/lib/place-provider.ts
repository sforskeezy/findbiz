import type { Bounds, Coordinates, ProviderDiagnostic } from "@/lib/types";
import type { PlaceCandidate } from "@/lib/place-candidate";

export type SearchCell = {
  id: string;
  center: Coordinates;
  radiusMiles: number;
  bounds: Bounds;
};

export type PlaceSearchBudget = {
  maxRequests: number;
  maxRecords: number;
  deadline: number;
};

export type PlaceSearchRequest = {
  center: Coordinates;
  radiusMiles: number;
  bounds: Bounds;
  cells: SearchCell[];
  budget: PlaceSearchBudget;
  signal?: AbortSignal;
};

export type PlaceSearchResult = {
  providerId: string;
  places: PlaceCandidate[];
  diagnostic: ProviderDiagnostic;
  completedCellIds: string[];
};

export interface PlaceProvider {
  id: string;
  searchNearby(request: PlaceSearchRequest): Promise<PlaceSearchResult>;
}

export function boundsForRadius(center: Coordinates, radiusMiles: number): Bounds {
  const latitudeDelta = radiusMiles / 69;
  const longitudeMiles = Math.max(1, 69.172 * Math.cos((center.lat * Math.PI) / 180));
  const longitudeDelta = radiusMiles / longitudeMiles;
  return {
    north: Math.min(90, center.lat + latitudeDelta),
    south: Math.max(-90, center.lat - latitudeDelta),
    east: Math.min(180, center.lng + longitudeDelta),
    west: Math.max(-180, center.lng - longitudeDelta),
  };
}

/**
 * Square coverage cells keep public-provider requests bounded and measurable.
 * The local Overture query uses the full search bounds, while capped providers
 * can consume these cells until their explicit request budget is exhausted.
 */
export function buildSearchCells(
  center: Coordinates,
  radiusMiles: number,
  maxCellRadiusMiles = 1.25,
): SearchCell[] {
  if (radiusMiles <= maxCellRadiusMiles) {
    return [{ id: "c0", center, radiusMiles, bounds: boundsForRadius(center, radiusMiles) }];
  }

  const diameter = maxCellRadiusMiles * 2 * 0.92;
  const gridRadius = Math.ceil(radiusMiles / diameter);
  const latitudeStep = diameter / 69;
  const longitudeMiles = Math.max(1, 69.172 * Math.cos((center.lat * Math.PI) / 180));
  const longitudeStep = diameter / longitudeMiles;
  const cells: SearchCell[] = [];

  for (let y = -gridRadius; y <= gridRadius; y += 1) {
    for (let x = -gridRadius; x <= gridRadius; x += 1) {
      const cellCenter = {
        lat: center.lat + y * latitudeStep,
        lng: center.lng + x * longitudeStep,
      };
      const centerDistance = Math.hypot(x * diameter, y * diameter);
      if (centerDistance > radiusMiles + maxCellRadiusMiles) continue;
      cells.push({
        id: `c${cells.length}`,
        center: cellCenter,
        radiusMiles: maxCellRadiusMiles,
        bounds: boundsForRadius(cellCenter, maxCellRadiusMiles),
      });
    }
  }

  return cells.sort((a, b) => {
    const ad = Math.hypot(a.center.lat - center.lat, a.center.lng - center.lng);
    const bd = Math.hypot(b.center.lat - center.lat, b.center.lng - center.lng);
    return ad - bd;
  });
}
