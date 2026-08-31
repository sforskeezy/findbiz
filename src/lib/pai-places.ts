import { geocodeAddress } from "@/lib/geocode";
import { fetchOsmCandidates } from "@/lib/openstreetmap";
import {
  buildProspect,
  dedupeCandidates,
  distanceMiles,
  type PlaceCandidate,
} from "@/lib/place-candidate";
import { loadPlacesCacheCandidates } from "@/lib/places-cache";
import type { Confidence, Coordinates, Prospect, ResearchResponse } from "@/lib/types";

export const PAI_PLACES_LABEL = "PAI Places · OpenStreetMap + public geocoders";

export type PaiGeocodeResult = {
  formattedAddress: string;
  coordinates: Coordinates;
  confidence: Confidence;
  provider: string;
};

export type PaiNearbyResult = {
  target: PaiGeocodeResult;
  radiusMiles: number;
  /** Businesses inside the requested radius, best match first. */
  prospects: Prospect[];
  /** Closest mapped business outside the radius, so empty results are explainable. */
  nearestBeyondRadius: { name: string; distanceMiles: number; source: string } | null;
  cacheCount: number;
  osmCount: number;
  retrievedAt: string;
};

/**
 * Keep Overpass radius close to what the user asked for. Expanding by +2mi
 * made rural searches hang for 30–80s on public Overpass mirrors.
 */
function searchRadiusFor(radiusMiles: number) {
  return Math.min(radiusMiles + 0.25, radiusMiles <= 1 ? 1.25 : radiusMiles + 0.5);
}

/** First-party geocode: US Census, then Photon, then Nominatim. No Google. */
export async function paiGeocode(inputAddress: string): Promise<PaiGeocodeResult> {
  const result = await geocodeAddress(inputAddress);
  return {
    formattedAddress: result.formattedAddress,
    coordinates: result.coordinates,
    confidence: result.confidence,
    provider: result.provider,
  };
}

export async function paiNearby(inputAddress: string, radiusMiles: number): Promise<PaiNearbyResult> {
  const retrievedAt = new Date().toISOString();
  const target = await paiGeocode(inputAddress);
  const center = target.coordinates;
  const searchRadius = searchRadiusFor(radiusMiles);

  const [osmSettled, cacheSettled] = await Promise.allSettled([
    fetchOsmCandidates(center, searchRadius),
    loadPlacesCacheCandidates(center, searchRadius),
  ]);

  const osmCandidates = osmSettled.status === "fulfilled" ? osmSettled.value : [];
  const cacheCandidates = cacheSettled.status === "fulfilled" ? cacheSettled.value : [];

  if (osmSettled.status === "rejected" && !cacheCandidates.length) {
    throw osmSettled.reason instanceof Error
      ? osmSettled.reason
      : new Error("Nearby business lookup failed.");
  }

  const merged = dedupeCandidates([...cacheCandidates, ...osmCandidates]);
  const withDistance = merged
    .map((candidate) => ({ candidate, distance: distanceMiles(center, candidate.coordinates) }))
    .sort((a, b) => a.distance - b.distance);

  const inRadius = withDistance.filter((item) => item.distance <= radiusMiles);
  const beyond = withDistance.find((item) => item.distance > radiusMiles) ?? null;

  const prospects = inRadius
    .map(({ candidate }) => buildProspect(attributeSource(candidate), center, retrievedAt))
    .sort((a, b) => b.score - a.score || a.distanceMiles - b.distanceMiles);

  return {
    target,
    radiusMiles,
    prospects,
    nearestBeyondRadius: beyond
      ? {
          name: beyond.candidate.name,
          distanceMiles: beyond.distance,
          source: beyond.candidate.source,
        }
      : null,
    cacheCount: inRadius.filter((item) => item.candidate.confidence === "Manually entered").length,
    osmCount: inRadius.filter((item) => item.candidate.confidence !== "Manually entered").length,
    retrievedAt,
  };
}

/** Keeps upstream attribution visible everywhere the prospect is shown or exported. */
function attributeSource(candidate: PlaceCandidate): PlaceCandidate {
  return candidate.source.startsWith("PAI Places")
    ? candidate
    : { ...candidate, source: `PAI Places · ${candidate.source}` };
}

/**
 * PAI Places — FindBiz's own discovery API. Backed by public geocoders,
 * OpenStreetMap, and the operator's local cache file. It never calls Google
 * Places, never calls RapidAPI, and never scrapes a map provider.
 */
export async function researchWithPaiPlaces(
  inputAddress: string,
  radiusMiles: number,
): Promise<ResearchResponse> {
  const nearby = await paiNearby(inputAddress, radiusMiles);
  const { retrievedAt, prospects, target } = nearby;

  const warnings: string[] = [];
  const cachePath = process.env.PAI_PLACES_CACHE_PATH?.trim() || "data/places-cache.json";

  if (!prospects.length) {
    warnings.push(
      nearby.nearestBeyondRadius
        ? `No businesses are mapped within ${radiusMiles} mi of this address. The nearest mapped business is ${nearby.nearestBeyondRadius.name}, about ${nearby.nearestBeyondRadius.distanceMiles.toFixed(2)} mi away — widen the radius to include it, or add local businesses to ${cachePath}.`
        : `OpenStreetMap has no mapped businesses within ${searchRadiusFor(radiusMiles)} mi of this address. That does not mean none exist — rural shops, farms, and contractors are often unmapped. Add verified entries to ${cachePath}.`,
    );
  } else if (!nearby.osmCount && nearby.cacheCount) {
    warnings.push(
      `OpenStreetMap returned no businesses in this radius. Showing ${nearby.cacheCount} operator-entered cache entr${nearby.cacheCount === 1 ? "y" : "ies"} only — not commercial map data.`,
    );
  } else if (nearby.nearestBeyondRadius) {
    warnings.push(
      `Next closest mapped business outside this radius: ${nearby.nearestBeyondRadius.name}, about ${nearby.nearestBeyondRadius.distanceMiles.toFixed(2)} mi away.`,
    );
  }

  warnings.push(
    "Source: PAI Places · OpenStreetMap + public geocoders (US Census, Photon, Nominatim). This is not Google Maps data.",
    `Add missing businesses yourself in ${cachePath} — cached entries rank above map data and are labeled Manually entered.`,
  );

  if (nearby.cacheCount && nearby.osmCount) {
    warnings.unshift(
      `${nearby.cacheCount} result(s) from your local cache; ${nearby.osmCount} from OpenStreetMap.`,
    );
  } else if (nearby.cacheCount) {
    warnings.unshift(`${nearby.cacheCount} result(s) came from your local PAI Places cache.`);
  }
  if (target.confidence !== "Verified") {
    warnings.unshift(
      "Address was matched at street or ZIP precision, not an exact rooftop point. Confirm the location before outreach.",
    );
  }

  warnings.push(
    "Business records may be incomplete or stale. Verify facts before outreach.",
    "Broadband availability is researched only after selecting a business; availability never proves the business's current provider.",
  );

  return {
    schemaVersion: 3,
    target: {
      inputAddress,
      formattedAddress: target.formattedAddress,
      coordinates: target.coordinates,
      geocodingConfidence: target.confidence,
    },
    radiusMiles,
    prospects,
    broadband: [],
    sources: [
      {
        id: `pai-places-${Date.now()}`,
        label: PAI_PLACES_LABEL,
        url: null,
        sourceDate: retrievedAt,
        retrievedAt,
        status: "Verified",
      },
      {
        id: `osm-${Date.now()}`,
        label: "OpenStreetMap contributors (ODbL)",
        url: "https://www.openstreetmap.org/copyright",
        sourceDate: retrievedAt,
        retrievedAt,
        status: nearby.osmCount ? "Verified" : "Unavailable",
      },
      ...(nearby.cacheCount
        ? [
            {
              id: `pai-cache-${Date.now()}`,
              label: "Local PAI Places cache (operator-entered)",
              url: null,
              sourceDate: retrievedAt,
              retrievedAt,
              status: "Manually entered" as const,
            },
          ]
        : []),
    ],
    retrievedAt,
    demoMode: false,
    warnings,
  };
}
