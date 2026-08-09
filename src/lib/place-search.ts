import { CommercialPlaceProvider } from "@/lib/commercial-provider";
import { addEligibilityCount, emptyEligibilityCounts } from "@/lib/eligibility";
import { OpenStreetMapPlaceProvider } from "@/lib/openstreetmap";
import { OverturePlaceProvider } from "@/lib/overture";
import {
  boundsForRadius,
  buildSearchCells,
  type PlaceProvider,
  type PlaceSearchRequest,
  type PlaceSearchResult,
} from "@/lib/place-provider";
import { buildProspect, dedupeCandidates } from "@/lib/place-candidate";
import { coalesceRequest, redactError } from "@/lib/request-safety";
import type { Coordinates, Prospect, ProviderDiagnostic, SearchDiagnostics } from "@/lib/types";

export type PlaceSearchAggregate = {
  prospects: Prospect[];
  eligibilityUnknown: Prospect[];
  diagnostics: SearchDiagnostics;
};

type SearchOptions = {
  providers?: PlaceProvider[];
  signal?: AbortSignal;
  now?: () => number;
  useCache?: boolean;
  providerTimeoutMs?: number;
};

const memoryCache = new Map<string, { expiresAt: number; value: PlaceSearchAggregate }>();

function cacheKey(center: Coordinates, radiusMiles: number) {
  return `${center.lat.toFixed(5)}:${center.lng.toFixed(5)}:${radiusMiles.toFixed(2)}`;
}

function providerBudget(providerId: string, now: number) {
  if (providerId === "overture") return { maxRequests: 1, maxRecords: 10_000, deadline: now + 10_000, timeout: 10_000 };
  if (providerId === "openstreetmap") {
    const configured = Number(process.env.OVERPASS_MAX_REQUESTS || 8);
    return { maxRequests: Math.max(1, Math.min(10, configured)), maxRecords: 2_500, deadline: now + 24_000, timeout: 25_000 };
  }
  if (providerId === "commercial") return { maxRequests: 4, maxRecords: 1_000, deadline: now + 9_000, timeout: 10_000 };
  return { maxRequests: 1, maxRecords: 250, deadline: now + 5_000, timeout: 6_000 };
}

function isolatedFailure(provider: PlaceProvider, error: unknown, durationMs: number): PlaceSearchResult {
  return {
    providerId: provider.id,
    places: [],
    completedCellIds: [],
    diagnostic: {
      providerId: provider.id,
      label: provider.id,
      status: "failed",
      code: "PROVIDER_ISOLATED_FAILURE",
      recordCount: 0,
      requestCount: 0,
      durationMs,
      message: redactError(error, "Provider failed without affecting other sources."),
      attributionUrl: null,
    },
  };
}

async function runProvider(
  provider: PlaceProvider,
  base: Omit<PlaceSearchRequest, "budget" | "signal">,
  parent?: AbortSignal,
  timeoutOverride?: number,
) {
  const started = performance.now();
  const budget = providerBudget(provider.id, Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Provider request timed out.")), timeoutOverride ?? budget.timeout);
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  try {
    const providerPromise = provider.searchNearby({
      ...base,
      signal,
      budget: {
        maxRequests: budget.maxRequests,
        maxRecords: budget.maxRecords,
        deadline: budget.deadline,
      },
    });
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason ?? new Error("Provider request cancelled.")), { once: true });
    });
    return await Promise.race([providerPromise, aborted]);
  } catch (error) {
    return isolatedFailure(provider, error, Math.round(performance.now() - started));
  } finally {
    clearTimeout(timer);
  }
}

export async function searchPlaces(
  center: Coordinates,
  radiusMiles: number,
  options: SearchOptions = {},
): Promise<PlaceSearchAggregate> {
  const key = cacheKey(center, radiusMiles);
  const cached = memoryCache.get(key);
  if (options.useCache !== false && cached && cached.expiresAt > Date.now()) return cached.value;

  return coalesceRequest(`places:${key}`, async () => {
    const startTime = (options.now ?? Date.now)();
    const providers = options.providers ?? [
      new OverturePlaceProvider(),
      new OpenStreetMapPlaceProvider(),
      new CommercialPlaceProvider(),
    ];
    const cells = buildSearchCells(center, radiusMiles);
    const base = {
      center,
      radiusMiles,
      bounds: boundsForRadius(center, radiusMiles),
      cells,
    };
    const results = await Promise.all(
      providers.map((provider) => runProvider(provider, base, options.signal, options.providerTimeoutMs)),
    );
    const rawCandidates = results.flatMap((result) => result.places);
    const merged = dedupeCandidates(rawCandidates);
    const retrievedAt = new Date().toISOString();
    const eligibility = emptyEligibilityCounts();
    const included: Prospect[] = [];
    const unknown: Prospect[] = [];

    for (const candidate of merged) {
      const prospect = buildProspect(candidate, center, retrievedAt);
      addEligibilityCount(eligibility, prospect.eligibility);
      if (prospect.eligibility.status === "eligible") included.push(prospect);
      else if (prospect.eligibility.status === "unknown") unknown.push(prospect);
    }

    included.sort((a, b) => b.score - a.score || a.distanceMiles - b.distanceMiles);
    unknown.sort((a, b) => a.distanceMiles - b.distanceMiles);
    const providersDiagnostics = results.map((result) => result.diagnostic);
    const meaningfulProviders = providersDiagnostics.filter((diagnostic) => diagnostic.status !== "disabled");
    const partialCoverage = meaningfulProviders.some((diagnostic) =>
      ["partial", "unavailable", "failed"].includes(diagnostic.status),
    );
    const completedCells = new Set(
      results
        .filter((result) => result.diagnostic.status === "complete" || result.diagnostic.status === "partial")
        .flatMap((result) => result.completedCellIds),
    );
    const sourceContribution: Record<string, number> = {};
    for (const result of results) sourceContribution[result.providerId] = result.places.length;
    const diagnostics: SearchDiagnostics = {
      partialCoverage,
      rawRecords: rawCandidates.length,
      duplicatesMerged: rawCandidates.length - merged.length,
      eligibleProspects: included.length,
      eligibilityUnknown: unknown.length,
      excludedRecords: merged.length - included.length - unknown.length,
      requestCount: providersDiagnostics.reduce((sum, diagnostic) => sum + diagnostic.requestCount, 0),
      durationMs: Math.max(0, (options.now ?? Date.now)() - startTime),
      cellsPlanned: cells.length,
      cellsCompleted: completedCells.size,
      sourceContribution,
      eligibility,
      providers: providersDiagnostics,
    };
    const value = { prospects: included, eligibilityUnknown: unknown, diagnostics };
    if (options.useCache !== false) memoryCache.set(key, { value, expiresAt: Date.now() + 2 * 60_000 });
    return value;
  });
}

export function providerSummary(diagnostics: ProviderDiagnostic[]) {
  return diagnostics
    .filter((item) => item.status !== "disabled")
    .map((item) => `${item.label}: ${item.status}`)
    .join("; ");
}

export function clearPlaceSearchMemoryForTests() {
  memoryCache.clear();
}
