import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { geocodeAddress } from "@/lib/geocode";
import { distanceMiles, normalizeCategory, type PlaceCandidate } from "@/lib/place-candidate";
import type { Coordinates } from "@/lib/types";

/**
 * Operator-maintained business list. This is the supported way to add
 * businesses PAI Places cannot discover from public map data — you own the
 * entries, so there is no third-party terms problem.
 */
export type PlacesCacheEntry = {
  id?: string;
  name: string;
  address?: string;
  lat?: number;
  lng?: number;
  category?: string;
  phone?: string | null;
  website?: string | null;
  url?: string | null;
  hours?: string[] | null;
  notes?: string | null;
  source?: string;
  sourceDate?: string;
};

type PlacesCacheFile = { version?: number; places?: PlacesCacheEntry[] };

const MAX_GEOCODES_PER_LOAD = 25;

let cached: { key: string; entries: PlacesCacheEntry[] } | null = null;
const resolvedCoordinates = new Map<string, Coordinates | null>();

export function placesCachePath() {
  const configured = process.env.PAI_PLACES_CACHE_PATH?.trim();
  if (!configured) return path.join(process.cwd(), "data", "places-cache.json");
  if (path.isAbsolute(configured)) return configured;
  return path.join(/* turbopackIgnore: true */ process.cwd(), configured);
}

async function readEntries(): Promise<PlacesCacheEntry[]> {
  const file = placesCachePath();
  let key: string;
  try {
    // Operator-configured path, so it cannot be statically scoped for tracing.
    const info = await stat(/* turbopackIgnore: true */ file);
    key = `${file}:${info.mtimeMs}:${info.size}`;
  } catch {
    cached = null;
    return [];
  }
  if (cached?.key === key) return cached.entries;

  try {
    const raw = await readFile(/* turbopackIgnore: true */ file, "utf8");
    const parsed = JSON.parse(raw) as PlacesCacheFile | PlacesCacheEntry[];
    const places = Array.isArray(parsed) ? parsed : (parsed.places ?? []);
    const entries = places.filter(
      (entry): entry is PlacesCacheEntry => Boolean(entry && typeof entry.name === "string" && entry.name.trim()),
    );
    cached = { key, entries };
    return entries;
  } catch {
    cached = null;
    return [];
  }
}

/** Entries may omit coordinates; geocode those once and remember the result. */
async function coordinatesFor(entry: PlacesCacheEntry, budget: { remaining: number }): Promise<Coordinates | null> {
  if (typeof entry.lat === "number" && typeof entry.lng === "number") {
    return { lat: entry.lat, lng: entry.lng };
  }
  const address = entry.address?.trim();
  if (!address) return null;

  const memoKey = address.toLowerCase();
  if (resolvedCoordinates.has(memoKey)) return resolvedCoordinates.get(memoKey) ?? null;
  if (budget.remaining <= 0) return null;

  budget.remaining -= 1;
  try {
    const result = await geocodeAddress(address);
    resolvedCoordinates.set(memoKey, result.coordinates);
    return result.coordinates;
  } catch {
    resolvedCoordinates.set(memoKey, null);
    return null;
  }
}

export async function loadPlacesCacheCandidates(
  center: Coordinates,
  radiusMiles: number,
): Promise<PlaceCandidate[]> {
  const entries = await readEntries();
  if (!entries.length) return [];

  const budget = { remaining: MAX_GEOCODES_PER_LOAD };
  const candidates: PlaceCandidate[] = [];
  const fallbackDate = new Date().toISOString();

  for (const [index, entry] of entries.entries()) {
    const coordinates = await coordinatesFor(entry, budget);
    if (!coordinates) continue;
    if (distanceMiles(center, coordinates) > radiusMiles) continue;

    candidates.push({
      id: entry.id?.trim() || `pai-cache-${index}-${entry.name.trim().toLowerCase().replace(/\s+/g, "-")}`,
      name: entry.name.trim(),
      address: entry.address?.trim() || null,
      coordinates,
      category: normalizeCategory(entry.category),
      phone: entry.phone ?? null,
      website: entry.website ?? null,
      directoryUrl: entry.url ?? null,
      hours: entry.hours ?? null,
      rating: null,
      reviewCount: null,
      operatingStatus: "Unknown",
      publicNotes: entry.notes ?? null,
      source: entry.source?.trim() || "Local PAI Places cache (operator-entered)",
      sourceDate: entry.sourceDate || fallbackDate,
      confidence: "Manually entered",
    });
  }

  return candidates;
}

export async function placesCacheStatus() {
  const entries = await readEntries();
  return { path: placesCachePath(), entryCount: entries.length, configured: entries.length > 0 };
}
