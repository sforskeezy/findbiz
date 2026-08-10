import { createHash } from "node:crypto";

import type { PlaceProvider, PlaceSearchRequest, PlaceSearchResult, SearchCell } from "@/lib/place-provider";
import { distanceMiles, normalizeCategory, type PlaceCandidate } from "@/lib/place-candidate";
import {
  CircuitBreaker,
  ProviderRateLimiter,
  coalesceRequest,
  createTimeoutSignal,
  redactError,
} from "@/lib/request-safety";

export const OSM_ATTRIBUTION = "OpenStreetMap contributors";
export const OSM_ATTRIBUTION_URL = "https://www.openstreetmap.org/copyright";

const DEFAULT_OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const DEFAULT_ENDPOINT_TIMEOUTS_MS = [5_000, 3_000, 3_000];

type OsmTags = Record<string, string | undefined>;

export type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  timestamp?: string;
  tags?: OsmTags;
};

type FetchLike = typeof fetch;

const overpassLimiter = new ProviderRateLimiter(1_000);
const responseCache = new Map<string, { expiresAt: number; elements: OverpassElement[] }>();
const endpointCircuits = new Map<string, CircuitBreaker>();

function endpointCircuit(endpoint: string, failureThreshold: number) {
  const current = endpointCircuits.get(endpoint);
  if (current) return current;
  // A slow mirror must not consume the same live search budget cell after cell.
  const circuit = new CircuitBreaker(failureThreshold, 2 * 60_000);
  endpointCircuits.set(endpoint, circuit);
  return circuit;
}

function endpoints() {
  const configured = process.env.OVERPASS_API_URL?.trim();
  // Known public mirrors follow the reviewed health order even if a deploy
  // still carries an older preferred-mirror value. A genuinely custom
  // operator endpoint remains first.
  const ordered = configured && !DEFAULT_OVERPASS_ENDPOINTS.includes(configured)
    ? [configured, ...DEFAULT_OVERPASS_ENDPOINTS]
    : DEFAULT_OVERPASS_ENDPOINTS;
  return ordered.filter(
    (value, index, all): value is string => Boolean(value) && all.indexOf(value) === index,
  );
}

function userAgent() {
  const contact = process.env.OSM_CONTACT_EMAIL?.trim();
  return contact ? `FindBiz/2.0 (${contact})` : "FindBiz/2.0 (independent local business research)";
}

const AMENITY_BUSINESS = [
  "animal_boarding",
  "animal_breeding",
  "bar",
  "biergarten",
  "cafe",
  "car_rental",
  "car_wash",
  "childcare",
  "clinic",
  "dentist",
  "doctors",
  "fast_food",
  "fuel",
  "ice_cream",
  "kindergarten",
  "language_school",
  "music_school",
  "nightclub",
  "pharmacy",
  "pub",
  "restaurant",
  "studio",
  "veterinary",
  "vehicle_inspection",
].join("|");

const LEISURE_BUSINESS = [
  "adult_gaming_centre",
  "amusement_arcade",
  "bowling_alley",
  "dance",
  "escape_game",
  "fitness_centre",
  "golf_course",
  "horse_riding",
  "marina",
  "resort",
  "sports_centre",
  "water_park",
].join("|");

const BUILDING_BUSINESS = "commercial|farm|farm_auxiliary|greenhouse|industrial|kiosk|office|retail|warehouse";

export type OsmCategoryPass = "core" | "extended";

export function buildOverpassQuery(
  cell: SearchCell,
  pass: OsmCategoryPass,
  limit = 450,
  elementTypes: Array<"node" | "way"> = ["node", "way"],
) {
  const bbox = `${cell.bounds.south},${cell.bounds.west},${cell.bounds.north},${cell.bounds.east}`;
  // Business relations are rare and dramatically increase public Overpass
  // execution time. Named nodes and building ways provide the useful local
  // prospect records without letting relation expansion sink the search.
  const selectors = elementTypes.flatMap((elementType) =>
    pass === "core"
      ? [
          `${elementType}(${bbox})["name"][~"^(shop|office|craft|company|industrial|healthcare)$"~"."]`,
          `${elementType}(${bbox})["name"]["amenity"~"^(${AMENITY_BUSINESS})$"]`,
          `${elementType}(${bbox})["name"]["tourism"~"^(hotel|motel|guest_house|hostel|resort|camp_site)$"]`,
        ]
      : [
          `${elementType}(${bbox})["name"]["leisure"~"^(${LEISURE_BUSINESS})$"]`,
          `${elementType}(${bbox})["name"]["landuse"~"^(commercial|retail|industrial|farmyard|quarry)$"]`,
          `${elementType}(${bbox})["name"]["building"~"^(${BUILDING_BUSINESS})$"]`,
          `${elementType}(${bbox})["name"]["man_made"="works"]`,
          `${elementType}(${bbox})["name"]["club"]`,
          `${elementType}(${bbox})["operator"]["craft"]`,
          `${elementType}(${bbox})["operator"]["industrial"]`,
          `${elementType}(${bbox})["operator"]["office"]`,
        ],
  );
  return `[out:json][timeout:12];\n(\n  ${selectors.join(";\n  ")};\n);\nout center tags qt ${limit};`;
}

async function backoff(attempt: number, signal: AbortSignal) {
  const waitMs = 250 * 2 ** attempt;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, waitMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("Overpass request cancelled."));
      },
      { once: true },
    );
  });
}

/** One mirror at a time; each mirror gets one retry before sequential fallback. */
export async function sequentialOverpassFetch(
  query: string,
  options: {
    endpoints?: string[];
    signal?: AbortSignal;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
    retries?: number;
  } = {},
): Promise<OverpassElement[]> {
  const queryKey = createHash("sha256").update(query).digest("hex");
  const cached = responseCache.get(queryKey);
  if (cached && cached.expiresAt > Date.now()) return cached.elements;

  return coalesceRequest(`overpass:${queryKey}`, async () => {
    const fetchImpl = options.fetchImpl ?? fetch;
    const failures: Error[] = [];
    const availableEndpoints = (options.endpoints ?? endpoints()).slice(0, 3);
    for (const [endpointIndex, endpoint] of availableEndpoints.entries()) {
      const circuit = endpointCircuit(endpoint, endpointIndex === 0 ? 4 : 1);
      try {
        circuit.assertAvailable();
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error("Overpass mirror circuit is open."));
        continue;
      }
      let endpointSucceeded = false;
      for (let attempt = 0; attempt <= (options.retries ?? 0); attempt += 1) {
        const timeoutMs = options.timeoutMs ?? DEFAULT_ENDPOINT_TIMEOUTS_MS[endpointIndex] ?? 5_000;
        const signal = createTimeoutSignal(timeoutMs, options.signal);
        try {
          await overpassLimiter.wait(signal);
          const response = await fetchImpl(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
              "User-Agent": userAgent(),
              Accept: "application/json",
            },
            body: new URLSearchParams({ data: query }),
            cache: "no-store",
            signal,
          });
          if (!response.ok) throw new Error(`Overpass returned HTTP ${response.status}.`);
          const payload = (await response.json()) as { elements?: OverpassElement[] };
          const elements = payload.elements ?? [];
          endpointSucceeded = true;
          circuit.success();
          responseCache.set(queryKey, { elements, expiresAt: Date.now() + 5 * 60_000 });
          return elements;
        } catch (error) {
          failures.push(error instanceof Error ? error : new Error("Overpass request failed."));
          if (options.signal?.aborted) throw options.signal.reason;
          if (attempt < (options.retries ?? 0)) await backoff(attempt, options.signal ?? new AbortController().signal);
        }
      }
      if (!endpointSucceeded) circuit.failure();
      if (endpointIndex < availableEndpoints.length - 1) {
        await backoff(0, options.signal ?? new AbortController().signal);
      }
    }
    throw failures.at(-1) ?? new Error("No Overpass endpoint was available.");
  });
}

function pointFor(element: OverpassElement) {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  return lat === undefined || lng === undefined ? null : { lat, lng };
}

function addressFor(tags: OsmTags) {
  if (tags["addr:full"]) return tags["addr:full"];
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const locality = [tags["addr:city"], tags["addr:state"], tags["addr:postcode"]].filter(Boolean).join(", ");
  return [street, locality].filter(Boolean).join(", ") || null;
}

function websiteFor(tags: OsmTags) {
  const value = tags.website || tags["contact:website"] || tags.url;
  if (!value) return null;
  return /^https?:\/\//i.test(value) ? value : `https://${value}`;
}

function rawCategories(tags: OsmTags) {
  return [
    tags.shop,
    tags.office,
    tags.craft,
    tags.amenity,
    tags.healthcare,
    tags.tourism,
    tags.leisure,
    tags.industrial,
    tags.landuse,
    tags.building,
  ].filter((value): value is string => Boolean(value));
}

function isBusiness(tags: OsmTags) {
  if (tags.shop === "vacant" || tags.disused === "yes" || tags["disused:shop"] || tags.abandoned === "yes") return false;
  if (Object.keys(tags).some((key) => /^(was|demolished|removed|abandoned|razed):/.test(key))) return false;
  if (["house", "residential", "apartments"].includes(tags.building ?? "") && !tags.operator && !tags.office) return false;
  return rawCategories(tags).length > 0 || Boolean(tags.company || tags.operator || tags.man_made === "works");
}

function categoryFor(categories: string[]) {
  return normalizeCategory(categories.find((category) => category !== "commercial" && category !== "industrial") ?? categories[0]);
}

export function normalizeOsmElement(element: OverpassElement): PlaceCandidate | null {
  const tags = element.tags ?? {};
  const coordinates = pointFor(element);
  const name = (tags.name || tags.operator || tags.brand || "").trim();
  if (!coordinates || !name || !isBusiness(tags)) return null;
  if (/^\d+[A-Za-z]?$/.test(name) || /^(unit|lot|site|room|building)\s*#?\s*\d+/i.test(name)) return null;
  const categories = rawCategories(tags);
  const providerId = "openstreetmap";
  const recordId = `${element.type}/${element.id}`;
  const updatedAt = element.timestamp ?? null;
  const operatingStatus = tags["opening_date"] === "closed" || tags.disused === "yes" ? "Permanently closed" : "Unknown";

  return {
    id: `osm-${element.type}-${element.id}`,
    name,
    address: addressFor(tags),
    coordinates,
    category: categoryFor(categories),
    rawCategories: categories,
    phone: tags.phone || tags["contact:phone"] || null,
    website: websiteFor(tags),
    directoryUrl: `https://www.openstreetmap.org/${recordId}`,
    hours: tags.opening_hours ? [tags.opening_hours] : null,
    rating: null,
    reviewCount: null,
    brand: tags.brand ?? null,
    apartmentUnits: tags["building:units"] && /^\d+$/.test(tags["building:units"])
      ? Number(tags["building:units"])
      : null,
    operatingStatus,
    publicNotes: tags.description || null,
    sources: [
      {
        providerId,
        providerRecordId: recordId,
        label: OSM_ATTRIBUTION,
        url: OSM_ATTRIBUTION_URL,
        updatedAt,
        confidence: null,
        dataset: "OpenStreetMap",
      },
    ],
    fieldProvenance: {
      name: [providerId],
      address: addressFor(tags) ? [providerId] : [],
      coordinates: [providerId],
      category: [providerId],
      phone: tags.phone || tags["contact:phone"] ? [providerId] : [],
      website: websiteFor(tags) ? [providerId] : [],
      brand: tags.brand ? [providerId] : [],
      operatingStatus: [providerId],
    },
    sourceDate: updatedAt ?? "",
    confidence: updatedAt ? "Estimated" : "Unavailable",
    sourceConfidence: null,
  };
}

export function clearOverpassRuntimeForTests() {
  responseCache.clear();
  endpointCircuits.clear();
}

export class OpenStreetMapPlaceProvider implements PlaceProvider {
  readonly id = "openstreetmap";

  constructor(
    private readonly requestElements: (
      query: string,
      options: { signal?: AbortSignal },
    ) => Promise<OverpassElement[]> = sequentialOverpassFetch,
  ) {}

  async searchNearby(request: PlaceSearchRequest): Promise<PlaceSearchResult> {
    const started = performance.now();
    const places = new Map<string, PlaceCandidate>();
    const completedCellIds: string[] = [];
    const completedCoreCellIds = new Set<string>();
    let requestCount = 0;
    let partial = false;
    let lastError: unknown = null;
    const queryLimit = Math.min(450, request.budget.maxRecords);
    const overviewCell: SearchCell = {
      id: "overview",
      center: request.center,
      radiusMiles: request.radiusMiles,
      bounds: request.bounds,
    };

    function collect(elements: OverpassElement[]) {
      for (const element of elements) {
        const candidate = normalizeOsmElement(element);
        if (!candidate || distanceMiles(request.center, candidate.coordinates) > request.radiusMiles) continue;
        places.set(candidate.id, candidate);
        if (places.size >= request.budget.maxRecords) break;
      }
    }

    // Start with one bounded overview. Sparse and rural searches usually
    // complete in one request; dense capped searches fall through to cells.
    let coreCoverageComplete = false;
    let coreOverviewTypesCompleted = 0;
    let coreOverviewCapped = false;
    for (const elementType of ["node", "way"] as const) {
      if (requestCount >= request.budget.maxRequests || Date.now() >= request.budget.deadline) {
        partial = true;
        break;
      }
      try {
        requestCount += 1;
        const elements = await this.requestElements(
          buildOverpassQuery(overviewCell, "core", queryLimit, [elementType]),
          { signal: request.signal },
        );
        collect(elements);
        coreOverviewTypesCompleted += 1;
        if (elements.length >= queryLimit) {
          coreOverviewCapped = true;
          partial = true;
        }
      } catch (error) {
        lastError = error;
        partial = true;
      }
    }
    if (coreOverviewTypesCompleted > 0) {
      completedCellIds.push(...request.cells.map((cell) => cell.id));
    }
    coreCoverageComplete = coreOverviewTypesCompleted === 2 && !coreOverviewCapped;

    // Cover as many geographic cells as possible with the high-yield pass
    // when a dense overview reaches its record cap or the overview fails.
    if (!coreCoverageComplete) {
      for (const cell of request.cells) {
        if (requestCount >= request.budget.maxRequests || Date.now() >= request.budget.deadline) {
          partial = true;
          break;
        }
        try {
          requestCount += 1;
          const elements = await this.requestElements(buildOverpassQuery(cell, "core", queryLimit), { signal: request.signal });
          collect(elements);
          completedCoreCellIds.add(cell.id);
          if (!completedCellIds.includes(cell.id)) completedCellIds.push(cell.id);
        } catch (error) {
          lastError = error;
          partial = true;
          continue;
        }
        if (places.size >= request.budget.maxRecords) {
          partial = true;
          break;
        }
      }
      coreCoverageComplete = completedCoreCellIds.size === request.cells.length;
    }

    if (coreCoverageComplete && places.size < request.budget.maxRecords) {
      for (const elementType of ["node", "way"] as const) {
        if (requestCount >= request.budget.maxRequests || Date.now() >= request.budget.deadline) {
          partial = true;
          break;
        }
        try {
          requestCount += 1;
          const elements = await this.requestElements(
            buildOverpassQuery(overviewCell, "extended", queryLimit, [elementType]),
            { signal: request.signal },
          );
          collect(elements);
          if (elements.length >= queryLimit) partial = true;
        } catch (error) {
          lastError = error;
          partial = true;
        }
      }
    }

    const failed = places.size === 0 && completedCellIds.length === 0 && Boolean(lastError);
    const timedOut = failed && (
      request.signal?.aborted ||
      (lastError instanceof Error && /timed?\s*out|timeout|abort/i.test(`${lastError.name} ${lastError.message}`))
    );
    return {
      providerId: this.id,
      places: [...places.values()],
      completedCellIds,
      diagnostic: {
        providerId: this.id,
        label: OSM_ATTRIBUTION,
        status: failed ? "failed" : partial || completedCellIds.length < request.cells.length ? "partial" : "complete",
        code: failed ? (timedOut ? "OVERPASS_TIMEOUT" : "OVERPASS_UNAVAILABLE") : partial ? "OVERPASS_PARTIAL" : "OVERPASS_COMPLETE",
        recordCount: places.size,
        requestCount,
        durationMs: Math.round(performance.now() - started),
        message: failed
          ? redactError(lastError, "OpenStreetMap search failed.")
          : partial
            ? "OpenStreetMap returned usable results, but its configured request or time budget was reached."
            : "OpenStreetMap supplemental search completed.",
        attributionUrl: OSM_ATTRIBUTION_URL,
      },
    };
  }
}

/** Compatibility wrapper for local diagnostics; orchestration uses the provider class. */
export async function fetchOsmCandidates(center: { lat: number; lng: number }, radiusMiles: number) {
  const { boundsForRadius, buildSearchCells } = await import("@/lib/place-provider");
  const cells = buildSearchCells(center, radiusMiles);
  const result = await new OpenStreetMapPlaceProvider().searchNearby({
    center,
    radiusMiles,
    bounds: boundsForRadius(center, radiusMiles),
    cells,
    budget: { maxRequests: 8, maxRecords: 2_000, deadline: Date.now() + 20_000 },
  });
  return result.places;
}
