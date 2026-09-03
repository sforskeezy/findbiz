import { geocodeAddress } from "@/lib/geocode";
import {
  buildProspect,
  distanceMiles,
  normalizeCategory,
  type PlaceCandidate,
} from "@/lib/place-candidate";
import type { Coordinates, Prospect, ResearchResponse } from "@/lib/types";

export const GOOGLE_MAPS_SCRAPER_LABEL = "Google Maps · first-party public search scraper";

const GOOGLE_ORIGIN = "https://www.google.com";
const MAX_RESPONSE_BYTES = 5_000_000;
const REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_QUERIES = [
  "business",
  "company",
  "llc",
  "contractor",
  "services",
  "farm",
  "horse",
  "stable",
  "home builder",
  "construction company",
  "welder",
  "machine shop",
  "auto repair",
  "warehouse",
  "manufacturer",
  "trucking company",
  "logistics",
  "medical office",
  "dentist",
  "law firm",
  "accounting firm",
  "insurance agency",
  "property management",
  "restaurant",
  "retail store",
  "salon",
  "church",
  "daycare",
] as const;

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type UnknownArray = unknown[];

export type ScrapeDiagnostics = {
  queriesRequested: number;
  queriesCompleted: number;
  rawListings: number;
  uniqueListings: number;
  failures: string[];
  blocked: boolean;
  cacheHit: boolean;
};

export type GoogleMapsScrapeResult = {
  candidates: PlaceCandidate[];
  diagnostics: ScrapeDiagnostics;
  retrievedAt: string;
};

type CacheEntry = {
  expiresAt: number;
  result: GoogleMapsScrapeResult;
};

const scrapeCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<GoogleMapsScrapeResult>>();

class GoogleMapsBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleMapsBlockedError";
  }
}

function numberEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function asArray(value: unknown): UnknownArray | null {
  return Array.isArray(value) ? value : null;
}

function at(value: unknown, ...path: number[]): unknown {
  let current = value;
  for (const index of path) {
    if (!Array.isArray(current)) return null;
    current = current[index];
  }
  return current;
}

function stringAt(value: unknown, ...path: number[]) {
  const found = at(value, ...path);
  return typeof found === "string" && found.trim() ? found.trim() : null;
}

function numberAt(value: unknown, ...path: number[]) {
  const found = at(value, ...path);
  return typeof found === "number" && Number.isFinite(found) ? found : null;
}

function collectStrings(value: unknown, output: string[] = [], depth = 0) {
  if (depth > 8) return output;
  if (typeof value === "string") {
    if (value.trim()) output.push(value.trim());
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output, depth + 1);
  }
  return output;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function zoomForRadius(radiusMiles: number) {
  if (radiusMiles <= 0.25) return 16;
  if (radiusMiles <= 0.5) return 15;
  if (radiusMiles <= 1) return 14;
  if (radiusMiles <= 2) return 13;
  if (radiusMiles <= 5) return 12;
  if (radiusMiles <= 10) return 11;
  return 10;
}

function mapsPlaceUrl(placeId: string, coordinates: Coordinates) {
  const url = new URL("/maps/search/", GOOGLE_ORIGIN);
  url.searchParams.set("api", "1");
  url.searchParams.set("query", `${coordinates.lat},${coordinates.lng}`);
  url.searchParams.set("query_place_id", placeId);
  return url.toString();
}

function pageSearchUrl(query: string, center: Coordinates, radiusMiles: number) {
  const encodedQuery = encodeURIComponent(query);
  const url = new URL(
    `/maps/search/${encodedQuery}/@${center.lat},${center.lng},${zoomForRadius(radiusMiles)}z`,
    GOOGLE_ORIGIN,
  );
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");
  return url;
}

function blockedResponse(response: Response, body: string) {
  return (
    response.status === 403 ||
    response.status === 429 ||
    response.url.includes("/sorry/") ||
    /unusual traffic|g-recaptcha|recaptcha\/api|before you continue to google/i.test(body)
  );
}

async function responseText(response: Response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_RESPONSE_BYTES) {
    throw new Error("Google Maps returned an unexpectedly large response.");
  }
  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new Error("Google Maps returned an unexpectedly large response.");
  }
  return body;
}

async function fetchGoogle(url: URL, referer?: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: referer || `${GOOGLE_ORIGIN}/maps`,
      "User-Agent": process.env.GOOGLE_MAPS_SCRAPER_USER_AGENT?.trim() || USER_AGENT,
    },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await responseText(response);
  if (blockedResponse(response, body)) {
    throw new GoogleMapsBlockedError(
      `Google Maps blocked the public-page request (${response.status}). No CAPTCHA or access control was bypassed.`,
    );
  }
  if (!response.ok) throw new Error(`Google Maps returned ${response.status}.`);
  return body;
}

function extractMapDataUrl(html: string) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const href = tag.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!href) continue;
    const decoded = decodeHtml(href);
    if (!decoded.includes("tbm=map")) continue;
    const url = new URL(decoded, GOOGLE_ORIGIN);
    if (url.origin !== GOOGLE_ORIGIN || url.pathname !== "/search" || url.searchParams.get("tbm") !== "map") {
      continue;
    }
    return url;
  }
  return null;
}

function parseXssiJson(body: string) {
  const cleaned = body.replace(/^\s*\)\]\}'\s*/, "");
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    throw new Error("Google Maps returned a data shape the scraper could not parse.");
  }
}

function placeArrays(payload: unknown) {
  const found: UnknownArray[] = [];
  const seen = new Set<string>();

  const walk = (value: unknown, depth: number) => {
    if (depth > 18 || !Array.isArray(value)) return;
    const name = stringAt(value, 11);
    const placeId = stringAt(value, 78);
    const lat = numberAt(value, 9, 2);
    const lng = numberAt(value, 9, 3);
    if (name && placeId && lat !== null && lng !== null) {
      if (!seen.has(placeId)) {
        seen.add(placeId);
        found.push(value);
      }
      return;
    }
    for (const item of value) walk(item, depth + 1);
  };

  walk(payload, 0);
  return found;
}

function descriptionFor(place: UnknownArray) {
  const values = collectStrings(place[32]).filter(
    (value) => !/^https?:\/\//i.test(value) && value.length >= 30 && value.length <= 500,
  );
  return values.sort((a, b) => b.length - a.length)[0] ?? null;
}

function hoursFor(place: UnknownArray) {
  const rows = asArray(at(place, 203, 0));
  if (!rows) return null;
  const hours = rows
    .map((row) => {
      const day = stringAt(row, 0);
      const time = stringAt(row, 3, 0, 0);
      return day && time ? `${day}: ${time}` : null;
    })
    .filter((value): value is string => Boolean(value));
  return hours.length ? hours : null;
}

function operatingStatusFor(place: UnknownArray): Prospect["operatingStatus"] | "Permanently closed" {
  const statusText = collectStrings(place).filter((value) => value.length < 80).join(" ").toLowerCase();
  if (statusText.includes("permanently closed")) return "Permanently closed";
  if (statusText.includes("temporarily closed")) return "Temporarily closed";
  return place[203] ? "Open" : "Unknown";
}

function looksLikeCompanyListing(name: string, types: string[]) {
  if (
    types.some((type) =>
      /^(parking lot|parking garage|bus stop|transit station|train station|road|route|street|intersection)$/i.test(
        type,
      ),
    )
  ) {
    return false;
  }
  if (/^(parking|transit center|section \d+|unnamed road)$/i.test(name.trim())) return false;
  return true;
}

function looksLikeRoadway(name: string, hasCompanySignals: boolean) {
  return (
    !hasCompanySignals &&
    /\b(street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr|way|parkway|pkwy|highway|hwy)$/i.test(
      name,
    )
  );
}

function candidateFromPlace(place: UnknownArray, retrievedAt: string): PlaceCandidate | null {
  const rawName = stringAt(place, 11);
  const name = rawName?.replace(/\s+/g, " ").slice(0, 240) ?? null;
  const placeId = stringAt(place, 78);
  const lat = numberAt(place, 9, 2);
  const lng = numberAt(place, 9, 3);
  if (!name || !placeId || lat === null || lng === null) return null;

  const operatingStatus = operatingStatusFor(place);
  if (operatingStatus === "Permanently closed") return null;
  const coordinates = { lat, lng };
  const types = asArray(place[13])?.filter((item): item is string => typeof item === "string") ?? [];
  if (!looksLikeCompanyListing(name, types)) return null;
  const addressWithName = stringAt(place, 18);
  const address =
    stringAt(place, 39) ||
    (addressWithName?.toLowerCase().startsWith(`${name.toLowerCase()}, `)
      ? addressWithName.slice(name.length + 2)
      : addressWithName);
  const phone = stringAt(place, 178, 0, 3) || stringAt(place, 178, 0, 0);
  const website = cleanUrl(stringAt(place, 7, 0));
  const hours = hoursFor(place);
  const rating = numberAt(place, 4, 7);
  if (looksLikeRoadway(name, Boolean(phone || website || hours?.length || rating))) return null;

  return {
    id: `gmap-${placeId}`,
    name,
    address,
    coordinates,
    category: normalizeCategory(types.join(" ")),
    phone,
    website,
    directoryUrl: mapsPlaceUrl(placeId, coordinates),
    hours,
    rating,
    reviewCount: numberAt(place, 4, 8),
    operatingStatus,
    publicNotes: descriptionFor(place),
    source: GOOGLE_MAPS_SCRAPER_LABEL,
    sourceDate: retrievedAt,
    confidence: "Verified",
  };
}

function mergeCandidate(primary: PlaceCandidate, secondary: PlaceCandidate): PlaceCandidate {
  return {
    ...primary,
    address: primary.address || secondary.address,
    phone: primary.phone || secondary.phone,
    website: primary.website || secondary.website,
    directoryUrl: primary.directoryUrl || secondary.directoryUrl,
    hours: primary.hours?.length ? primary.hours : secondary.hours,
    rating: primary.rating ?? secondary.rating,
    reviewCount: primary.reviewCount ?? secondary.reviewCount,
    publicNotes: primary.publicNotes || secondary.publicNotes,
    operatingStatus:
      primary.operatingStatus === "Unknown" ? secondary.operatingStatus : primary.operatingStatus,
  };
}

async function scrapeQuery(query: string, center: Coordinates, radiusMiles: number, retrievedAt: string) {
  const pageUrl = pageSearchUrl(query, center, radiusMiles);
  const html = await fetchGoogle(pageUrl);
  const dataUrl = extractMapDataUrl(html);
  if (!dataUrl) {
    throw new Error("Google Maps did not expose its public map-search response link; markup may have changed.");
  }
  const dataBody = await fetchGoogle(dataUrl, pageUrl.toString());
  const payload = parseXssiJson(dataBody);
  return placeArrays(payload)
    .map((place) => candidateFromPlace(place, retrievedAt))
    .filter((candidate): candidate is PlaceCandidate => Boolean(candidate));
}

function configuredQueries(input?: string[]) {
  const fromEnv = (process.env.GOOGLE_MAPS_SCRAPER_QUERIES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requested = input?.length ? input : fromEnv.length ? fromEnv : [...DEFAULT_QUERIES];
  const maximum = numberEnv("GOOGLE_MAPS_SCRAPER_MAX_QUERIES", 28, 1, 40);
  return [...new Set(requested.map((value) => value.replace(/\s+/g, " ").trim()).filter((value) => value.length >= 2))]
    .map((value) => value.slice(0, 80))
    .slice(0, maximum);
}

function cacheKey(center: Coordinates, radiusMiles: number, queries: string[]) {
  return `${center.lat.toFixed(5)}:${center.lng.toFixed(5)}:${radiusMiles}:${queries.join("|")}`;
}

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of scrapeCache) if (entry.expiresAt <= now) scrapeCache.delete(key);
  while (scrapeCache.size > 40) scrapeCache.delete(scrapeCache.keys().next().value!);
}

async function scrapeUncached(
  center: Coordinates,
  radiusMiles: number,
  queries: string[],
): Promise<GoogleMapsScrapeResult> {
  const retrievedAt = new Date().toISOString();
  // Each query costs two dependent round trips, so the queue depth is what sets
  // the wall clock. Both stay env-tunable if Google starts pushing back.
  const concurrency = numberEnv("GOOGLE_MAPS_SCRAPER_CONCURRENCY", 6, 1, 8);
  const delayMs = numberEnv("GOOGLE_MAPS_SCRAPER_DELAY_MS", 60, 0, 5_000);
  const byId = new Map<string, PlaceCandidate>();
  const failures: string[] = [];
  let nextIndex = 0;
  let completed = 0;
  let rawListings = 0;
  let blocked = false;

  async function worker() {
    while (nextIndex < queries.length && !blocked) {
      const index = nextIndex++;
      const query = queries[index];
      try {
        const candidates = await scrapeQuery(query, center, radiusMiles, retrievedAt);
        completed += 1;
        rawListings += candidates.length;
        for (const candidate of candidates) {
          const existing = byId.get(candidate.id);
          byId.set(candidate.id, existing ? mergeCandidate(existing, candidate) : candidate);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${query}: ${message}`);
        if (error instanceof GoogleMapsBlockedError) blocked = true;
      }
      if (delayMs && nextIndex < queries.length && !blocked) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queries.length) }, () => worker()));
  const candidates = [...byId.values()].filter(
    (candidate) => distanceMiles(center, candidate.coordinates) <= radiusMiles,
  );

  if (!candidates.length && blocked) throw new GoogleMapsBlockedError(failures[0] || "Google Maps blocked the scraper.");
  if (!candidates.length && !completed) throw new Error(failures[0] || "No Google Maps query completed.");

  return {
    candidates,
    diagnostics: {
      queriesRequested: queries.length,
      queriesCompleted: completed,
      rawListings,
      uniqueListings: candidates.length,
      failures,
      blocked,
      cacheHit: false,
    },
    retrievedAt,
  };
}

export function googleMapsScraperEnabled() {
  return process.env.ENABLE_GOOGLE_MAPS_SCRAPER !== "false";
}

export async function scrapeGoogleMaps(
  center: Coordinates,
  radiusMiles: number,
  inputQueries?: string[],
): Promise<GoogleMapsScrapeResult> {
  if (!googleMapsScraperEnabled()) throw new Error("The first-party Google Maps scraper is disabled.");
  const queries = configuredQueries(inputQueries);
  if (!queries.length) throw new Error("The Google Maps scraper has no valid search queries.");
  pruneCache();
  const key = cacheKey(center, radiusMiles, queries);
  const cached = scrapeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.result, diagnostics: { ...cached.result.diagnostics, cacheHit: true } };
  }
  const existing = inFlight.get(key);
  if (existing) return existing;

  const pending = scrapeUncached(center, radiusMiles, queries)
    .then((result) => {
      const ttl = numberEnv("GOOGLE_MAPS_SCRAPER_CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_MS / 1_000, 30, 86_400);
      scrapeCache.set(key, { expiresAt: Date.now() + ttl * 1_000, result });
      return result;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, pending);
  return pending;
}

export async function researchWithGoogleMapsScraper(
  inputAddress: string,
  radiusMiles: number,
  queries?: string[],
): Promise<ResearchResponse & { scraper: ScrapeDiagnostics }> {
  const location = await geocodeAddress(inputAddress);
  const locationHint = location.formattedAddress || inputAddress;
  const contextualQueries = configuredQueries(queries).map((query) =>
    /\bnear\b|\bin\s+[A-Za-z]/i.test(query) ? query : `${query} near ${locationHint}`,
  );
  const scrape = await scrapeGoogleMaps(location.coordinates, radiusMiles, contextualQueries);
  const prospects = scrape.candidates
    .map((candidate) => buildProspect(candidate, location.coordinates, scrape.retrievedAt))
    .sort((a, b) => b.score - a.score || a.distanceMiles - b.distanceMiles);
  const diagnostics = scrape.diagnostics;
  const warnings = [
    `First-party Google Maps scraper ran ${diagnostics.queriesCompleted}/${diagnostics.queriesRequested} keyword searches, read ${diagnostics.rawListings} raw listings, and retained ${prospects.length} unique businesses inside ${radiusMiles} mi${diagnostics.cacheHit ? " (cached)" : ""}.`,
    "Google Maps page formats and access rules can change. Every listing links back to Maps and should be verified before outreach.",
  ];
  if (diagnostics.failures.length) {
    warnings.push(
      diagnostics.blocked
        ? "Google Maps blocked part of the scrape. Partial results are shown; no CAPTCHA or access control was bypassed."
        : `${diagnostics.failures.length} Google Maps keyword search(es) failed; partial results are shown.`,
    );
  }
  if (!prospects.length) warnings.unshift("Google Maps returned no businesses inside this radius. The public-data backstop may still add results.");

  return {
    schemaVersion: 3,
    target: {
      inputAddress,
      formattedAddress: location.formattedAddress,
      coordinates: location.coordinates,
      geocodingConfidence: location.confidence,
    },
    radiusMiles,
    prospects,
    broadband: [],
    sources: [
      {
        id: `google-maps-scraper-${Date.now()}`,
        label: GOOGLE_MAPS_SCRAPER_LABEL,
        url: "https://www.google.com/maps",
        sourceDate: scrape.retrievedAt,
        retrievedAt: scrape.retrievedAt,
        status: diagnostics.blocked ? "Potentially stale" : "Verified",
      },
    ],
    retrievedAt: scrape.retrievedAt,
    demoMode: false,
    warnings,
    scraper: diagnostics,
  };
}
