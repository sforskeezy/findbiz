import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

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

function parquetReadPath(configured: string) {
  return statSync(/* turbopackIgnore: true */ configured).isDirectory()
    ? path.join(configured, "**", "*.parquet")
    : configured;
}

export function overtureConfigurationStatus() {
  const configured = configuredDatasetPath();
  if (!configured) return { configured: false, code: "OVERTURE_NOT_CONFIGURED" } as const;
  if (!existsSync(/* turbopackIgnore: true */ configured)) {
    return { configured: false, code: "OVERTURE_DATASET_NOT_FOUND" } as const;
  }
  return { configured: true, code: "OVERTURE_READY" } as const;
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

  constructor(private readonly query: OvertureQuery = queryOvertureRows) {}

  async searchNearby(request: PlaceSearchRequest): Promise<PlaceSearchResult> {
    const started = performance.now();
    const status = overtureConfigurationStatus();
    if (!status.configured) {
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

    try {
      const configured = configuredDatasetPath();
      if (!configured) throw new Error("Overture dataset configuration changed during the request.");
      const rows = await this.query({ parquetPath: parquetReadPath(configured), request });
      const places = rows
        .map(normalizeOvertureRow)
        .filter((place): place is PlaceCandidate => Boolean(place))
        .filter((place) => place.operatingStatus !== "Permanently closed")
        .filter((place) => distanceMiles(request.center, place.coordinates) <= request.radiusMiles)
        .slice(0, request.budget.maxRecords);
      const capped = rows.length >= request.budget.maxRecords;
      return {
        providerId: this.id,
        places,
        completedCellIds: request.cells.map((cell) => cell.id),
        diagnostic: {
          providerId: this.id,
          label: OVERTURE_ATTRIBUTION,
          status: capped ? "partial" : "complete",
          code: capped ? "OVERTURE_RECORD_BUDGET_REACHED" : "OVERTURE_COMPLETE",
          recordCount: places.length,
          requestCount: 1,
          durationMs: Math.round(performance.now() - started),
          message: capped
            ? "Overture reached the configured record budget; results are partial."
            : "Local Overture Places search completed.",
          attributionUrl: OVERTURE_ATTRIBUTION_URL,
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
        },
      };
    }
  }
}
