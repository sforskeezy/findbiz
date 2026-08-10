import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { Bounds } from "@/lib/types";
import type { PlaceSearchRequest, PlaceSearchResult, PlaceProvider } from "@/lib/place-provider";
import { distanceMiles, normalizeCategory, type PlaceCandidate } from "@/lib/place-candidate";
import { redactError } from "@/lib/request-safety";

export const OVERTURE_ATTRIBUTION = "Overture Maps Foundation";
export const OVERTURE_ATTRIBUTION_URL = "https://docs.overturemaps.org/attribution/";

const rowSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  primary_category: z.string().nullable().optional(),
  alternate_categories_json: z.string().nullable().optional(),
  confidence: z.number().nullable().optional(),
  websites_json: z.string().nullable().optional(),
  phones_json: z.string().nullable().optional(),
  brand_json: z.string().nullable().optional(),
  addresses_json: z.string().nullable().optional(),
  sources_json: z.string().nullable().optional(),
  operating_status: z.string().nullable().optional(),
  lat: z.number(),
  lng: z.number(),
});

export type OvertureRow = z.infer<typeof rowSchema>;
export type OvertureQuery = (params: {
  parquetPath: string;
  request: PlaceSearchRequest;
}) => Promise<unknown[]>;

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function configuredDatasetPath() {
  const configured = process.env.OVERTURE_PLACES_PATH?.trim();
  if (!configured) return null;
  return path.resolve(configured);
}

export type OvertureCoverageRelation = "inside" | "partial" | "outside" | "unknown";

export type OvertureReadiness = {
  configured: boolean;
  ready: boolean;
  code:
    | "OVERTURE_NOT_CONFIGURED"
    | "OVERTURE_FILE_MISSING"
    | "OVERTURE_SCHEMA_INVALID"
    | "OVERTURE_READY";
  coverageBoundaryConfigured: boolean;
};

let readinessCache: { fingerprint: string; value: OvertureReadiness } | null = null;

export function parseOvertureCoverageBbox(value = process.env.OVERTURE_COVERAGE_BBOX): Bounds | null {
  if (!value?.trim()) return null;
  const coordinates = value.split(",").map((item) => Number(item.trim()));
  if (
    coordinates.length !== 4 ||
    coordinates.some((item) => !Number.isFinite(item)) ||
    coordinates[0] < -180 || coordinates[2] > 180 ||
    coordinates[1] < -90 || coordinates[3] > 90 ||
    coordinates[0] >= coordinates[2] || coordinates[1] >= coordinates[3]
  ) {
    return null;
  }
  const [west, south, east, north] = coordinates;
  return { west, south, east, north };
}

export function overtureCoverageRelation(search: Bounds, coverage: Bounds | null): OvertureCoverageRelation {
  if (!coverage) return "unknown";
  const intersects =
    search.west < coverage.east && search.east > coverage.west &&
    search.south < coverage.north && search.north > coverage.south;
  if (!intersects) return "outside";
  const contained =
    search.west >= coverage.west && search.east <= coverage.east &&
    search.south >= coverage.south && search.north <= coverage.north;
  return contained ? "inside" : "partial";
}

function intersectBounds(search: Bounds, coverage: Bounds): Bounds {
  return {
    west: Math.max(search.west, coverage.west),
    east: Math.min(search.east, coverage.east),
    south: Math.max(search.south, coverage.south),
    north: Math.min(search.north, coverage.north),
  };
}

function parquetReadPath(configured: string) {
  return statSync(/* turbopackIgnore: true */ configured).isDirectory()
    ? path.join(configured, "**", "*.parquet")
    : configured;
}

export function overtureConfigurationStatus() {
  const configured = configuredDatasetPath();
  if (!configured) return { configured: false, code: "OVERTURE_NOT_CONFIGURED" } as const;
  if (!existsSync(/* turbopackIgnore: true */ configured)) {
    return { configured: false, code: "OVERTURE_FILE_MISSING" } as const;
  }
  return { configured: true, code: "OVERTURE_READY" } as const;
}

async function validateOvertureSchema(parquetPath: string) {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:", { threads: "1", memory_limit: "256MB" });
  const connection = await instance.connect();
  try {
    await connection.runAndReadAll(
      `SELECT
        id,
        names.primary,
        categories.primary,
        bbox.xmin,
        bbox.ymin,
        operating_status
      FROM read_parquet($parquet_path, union_by_name = true)
      LIMIT 0`,
      { parquet_path: parquetPath },
    );
  } finally {
    connection.closeSync();
  }
}

export async function inspectOvertureReadiness(): Promise<OvertureReadiness> {
  const configured = configuredDatasetPath();
  const coverageBoundaryConfigured = Boolean(parseOvertureCoverageBbox());
  if (!configured) return { configured: false, ready: false, code: "OVERTURE_NOT_CONFIGURED", coverageBoundaryConfigured };
  if (!existsSync(/* turbopackIgnore: true */ configured)) {
    return { configured: true, ready: false, code: "OVERTURE_FILE_MISSING", coverageBoundaryConfigured };
  }
  const stats = statSync(/* turbopackIgnore: true */ configured);
  const fingerprint = `${configured}:${stats.size}:${stats.mtimeMs}:${process.env.OVERTURE_COVERAGE_BBOX ?? ""}`;
  if (readinessCache?.fingerprint === fingerprint) return readinessCache.value;
  try {
    await validateOvertureSchema(parquetReadPath(configured));
    const value = { configured: true, ready: true, code: "OVERTURE_READY", coverageBoundaryConfigured } as const;
    readinessCache = { fingerprint, value };
    return value;
  } catch {
    const value = { configured: true, ready: false, code: "OVERTURE_SCHEMA_INVALID", coverageBoundaryConfigured } as const;
    readinessCache = { fingerprint, value };
    return value;
  }
}

export async function queryOvertureRows({
  parquetPath,
  request,
}: {
  parquetPath: string;
  request: PlaceSearchRequest;
}): Promise<unknown[]> {
  const { DuckDBInstance } = await import("@duckdb/node-api");
  const instance = await DuckDBInstance.create(":memory:", { threads: "2", memory_limit: "512MB" });
  const connection = await instance.connect();
  const abort = () => connection.interrupt();
  request.signal?.addEventListener("abort", abort, { once: true });
  try {
    const reader = await connection.runAndReadAll(
      `SELECT
        id,
        names.primary AS name,
        categories.primary AS primary_category,
        CAST(categories.alternate AS JSON) AS alternate_categories_json,
        confidence,
        CAST(websites AS JSON) AS websites_json,
        CAST(phones AS JSON) AS phones_json,
        CAST(brand AS JSON) AS brand_json,
        CAST(addresses AS JSON) AS addresses_json,
        CAST(sources AS JSON) AS sources_json,
        operating_status,
        bbox.ymin::DOUBLE AS lat,
        bbox.xmin::DOUBLE AS lng
      FROM read_parquet($parquet_path, union_by_name = true)
      WHERE bbox.xmin BETWEEN $west AND $east
        AND bbox.ymin BETWEEN $south AND $north
        AND COALESCE(operating_status, '') <> 'permanently_closed'
        AND names.primary IS NOT NULL
      LIMIT $record_limit`,
      {
        parquet_path: parquetPath,
        west: request.bounds.west,
        east: request.bounds.east,
        south: request.bounds.south,
        north: request.bounds.north,
        record_limit: request.budget.maxRecords,
      },
    );
    return reader.getRowObjectsJson();
  } finally {
    request.signal?.removeEventListener("abort", abort);
    connection.closeSync();
  }
}

function operatingStatus(value: string | null | undefined): PlaceCandidate["operatingStatus"] {
  if (value === "open") return "Open";
  if (value === "temporarily_closed") return "Temporarily closed";
  if (value === "permanently_closed") return "Permanently closed";
  return "Unknown";
}

function addressFrom(value: string | null | undefined) {
  const addresses = parseJson<Array<Record<string, unknown>>>(value, []);
  const address = addresses[0];
  if (!address) return null;
  const freeform = typeof address.freeform === "string" ? address.freeform.trim() : "";
  const locality = [address.locality, address.region, address.postcode]
    .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    .join(", ");
  return [freeform, locality].filter(Boolean).join(", ") || null;
}

function sourceDetails(value: string | null | undefined, id: string, confidence: number | null) {
  const upstream = parseJson<Array<Record<string, unknown>>>(value, []);
  const updated = upstream
    .map((item) => (typeof item.update_time === "string" ? item.update_time : null))
    .filter((item): item is string => Boolean(item))
    .sort()
    .at(-1) ?? null;
  const datasets = upstream
    .map((item) => (typeof item.dataset === "string" ? item.dataset : null))
    .filter((item): item is string => Boolean(item));
  return {
    updated,
    source: {
      providerId: "overture",
      providerRecordId: id,
      label: OVERTURE_ATTRIBUTION,
      url: OVERTURE_ATTRIBUTION_URL,
      updatedAt: updated,
      confidence,
      dataset: datasets.length ? [...new Set(datasets)].join(", ") : null,
    },
  };
}

export function normalizeOvertureRow(input: unknown): PlaceCandidate | null {
  const parsed = rowSchema.safeParse(input);
  if (!parsed.success) return null;
  const row = parsed.data;
  const rawCategories = [
    row.primary_category,
    ...parseJson<string[]>(row.alternate_categories_json, []),
  ].filter((item): item is string => Boolean(item));
  const websites = parseJson<string[]>(row.websites_json, []);
  const phones = parseJson<string[]>(row.phones_json, []);
  const brandValue = parseJson<Record<string, unknown> | null>(row.brand_json, null);
  const brandNames = brandValue?.names as Record<string, unknown> | undefined;
  const brand = typeof brandNames?.primary === "string" ? brandNames.primary : null;
  const confidence = row.confidence ?? null;
  const { updated, source } = sourceDetails(row.sources_json, row.id, confidence);
  const provider = source.providerId;

  return {
    id: `overture-${row.id}`,
    name: row.name.trim(),
    address: addressFrom(row.addresses_json),
    coordinates: { lat: row.lat, lng: row.lng },
    category: normalizeCategory(row.primary_category),
    rawCategories,
    phone: phones[0] ?? null,
    website: websites[0] ?? null,
    directoryUrl: null,
    hours: null,
    rating: null,
    reviewCount: null,
    brand,
    apartmentUnits: null,
    operatingStatus: operatingStatus(row.operating_status),
    publicNotes: null,
    sources: [source],
    fieldProvenance: {
      name: [provider],
      address: [provider],
      coordinates: [provider],
      category: [provider],
      phone: phones[0] ? [provider] : [],
      website: websites[0] ? [provider] : [],
      brand: brand ? [provider] : [],
      operatingStatus: [provider],
    },
    sourceDate: updated ?? "",
    confidence: confidence !== null && confidence >= 0.8 ? "Verified" : "Estimated",
    sourceConfidence: confidence,
  };
}

export class OverturePlaceProvider implements PlaceProvider {
  readonly id = "overture";

  constructor(
    private readonly query: OvertureQuery = queryOvertureRows,
    private readonly inspect: () => Promise<OvertureReadiness> = inspectOvertureReadiness,
  ) {}

  async searchNearby(request: PlaceSearchRequest): Promise<PlaceSearchResult> {
    const started = performance.now();
    const status = await this.inspect();
    if (!status.ready) {
      return {
        providerId: this.id,
        places: [],
        completedCellIds: [],
        diagnostic: {
          providerId: this.id,
          label: OVERTURE_ATTRIBUTION,
          status: "unavailable",
          code: status.code,
          recordCount: 0,
          requestCount: 0,
          durationMs: Math.round(performance.now() - started),
          message: "Local Overture Places coverage is unavailable.",
          setupHint: "Set OVERTURE_PLACES_PATH to a bounded local GeoParquet file or directory.",
          attributionUrl: OVERTURE_ATTRIBUTION_URL,
        },
      };
    }

    const coverage = parseOvertureCoverageBbox();
    const relation = overtureCoverageRelation(request.bounds, coverage);
    if (relation === "outside") {
      return {
        providerId: this.id,
        places: [],
        completedCellIds: [],
        diagnostic: {
          providerId: this.id,
          label: OVERTURE_ATTRIBUTION,
          status: "unavailable",
          code: "OVERTURE_OUTSIDE_CONFIGURED_COVERAGE",
          recordCount: 0,
          requestCount: 0,
          durationMs: Math.round(performance.now() - started),
          message: "The search is outside the configured local Overture extract.",
          attributionUrl: OVERTURE_ATTRIBUTION_URL,
          coverage: relation,
        },
      };
    }

    try {
      const configured = configuredDatasetPath();
      if (!configured) throw new Error("Overture dataset configuration changed during the request.");
      const boundedRequest = relation === "partial" && coverage
        ? { ...request, bounds: intersectBounds(request.bounds, coverage) }
        : request;
      const rows = await this.query({ parquetPath: parquetReadPath(configured), request: boundedRequest });
      const places = rows
        .map(normalizeOvertureRow)
        .filter((place): place is PlaceCandidate => Boolean(place))
        .filter((place) => place.operatingStatus !== "Permanently closed")
        .filter((place) => distanceMiles(request.center, place.coordinates) <= request.radiusMiles)
        .slice(0, request.budget.maxRecords);
      const capped = rows.length >= request.budget.maxRecords;
      const completedCellIds = relation === "partial" && coverage
        ? request.cells
            .filter((cell) => overtureCoverageRelation(cell.bounds, coverage) !== "outside")
            .map((cell) => cell.id)
        : request.cells.map((cell) => cell.id);
      return {
        providerId: this.id,
        places,
        completedCellIds,
        diagnostic: {
          providerId: this.id,
          label: OVERTURE_ATTRIBUTION,
          status: capped || relation === "partial" ? "partial" : "complete",
          code: capped
            ? "OVERTURE_RECORD_BUDGET_REACHED"
            : relation === "partial"
              ? "OVERTURE_PARTIAL_CONFIGURED_COVERAGE"
              : relation === "unknown"
                ? "OVERTURE_COMPLETE_COVERAGE_UNKNOWN"
                : "OVERTURE_COMPLETE",
          recordCount: places.length,
          requestCount: 1,
          durationMs: Math.round(performance.now() - started),
          message: capped
            ? "The local place index reached its record budget; results are partial."
            : relation === "partial"
              ? "The search overlaps only part of the configured local extract."
              : relation === "unknown"
                ? "The local place search completed, but no coverage boundary is configured."
                : "The local place search completed inside its configured coverage.",
          attributionUrl: OVERTURE_ATTRIBUTION_URL,
          coverage: relation,
        },
      };
    } catch (error) {
      return {
        providerId: this.id,
        places: [],
        completedCellIds: [],
        diagnostic: {
          providerId: this.id,
          label: OVERTURE_ATTRIBUTION,
          status: "failed",
          code: request.signal?.aborted ? "OVERTURE_TIMEOUT" : "OVERTURE_QUERY_FAILED",
          recordCount: 0,
          requestCount: 1,
          durationMs: Math.round(performance.now() - started),
          message: redactError(error, "Overture query failed."),
          attributionUrl: OVERTURE_ATTRIBUTION_URL,
          coverage: relation,
        },
      };
    }
  }
}
