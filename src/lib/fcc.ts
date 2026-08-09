import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { latLngToCell } from "h3-js";

import { createTimeoutSignal } from "@/lib/request-safety";
import type { BroadbandObservation, Coordinates, FccLookupResponse } from "@/lib/types";

const FCC_MAP_URL = "https://broadbandmap.fcc.gov/home";

type FccLookupInput = {
  address: string;
  coordinates?: Coordinates;
  locationId?: string;
};

export type AvailabilityRow = {
  provider_id: string;
  brand_name: string;
  technology: string;
  download_mbps: number | null;
  upload_mbps: number | null;
  business_residential_code: string;
};

type MatchLocation = { location_id?: string | number; similarity?: number };
type MatchResponse = { matchtype?: string; matchcount?: number; locations?: MatchLocation[] };

function baseResponse(
  status: FccLookupResponse["status"],
  message: string,
  asOfDate: string | null = null,
  datasetVintage: string | null = null,
): FccLookupResponse {
  return {
    status,
    observations: [],
    message,
    sourceUrl: FCC_MAP_URL,
    asOfDate,
    datasetVintage,
    matchedLocationId: null,
    matchQuality: "none",
  };
}

function metadata(database: DatabaseSync, key: string) {
  try {
    const row = database.prepare("SELECT value FROM fcc_metadata WHERE key = ?").get(key) as { value?: string } | undefined;
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

export function technologyLabel(code: string) {
  const labels: Record<string, string> = {
    "0": "Other fixed broadband",
    "10": "Asymmetric xDSL",
    "11": "ADSL2 / ADSL2+",
    "12": "VDSL",
    "20": "Symmetric xDSL",
    "30": "Other copper wireline",
    "40": "Cable modem – DOCSIS 1, 1.1, 2.0",
    "41": "Cable modem – DOCSIS 3.0",
    "42": "Cable modem – DOCSIS 3.1",
    "43": "Cable modem – DOCSIS 3.1 / 4.0",
    "50": "Optical carrier / fiber to the premises",
    "60": "Satellite",
    "70": "Terrestrial fixed wireless",
    "90": "Electric power line",
  };
  return labels[String(code)] || `FCC technology code ${code}`;
}

export function rowsToObservations(
  rows: AvailabilityRow[],
  asOfDate: string,
  datasetVintage: string,
  coverageArea: string,
  matchMethod: BroadbandObservation["matchMethod"],
): BroadbandObservation[] {
  const retrievedAt = new Date().toISOString();
  const exact = matchMethod !== "h3_res8";
  const deduped = new Map<string, AvailabilityRow>();
  for (const row of rows) {
    const key = [row.provider_id, row.brand_name, row.technology, row.download_mbps, row.upload_mbps, row.business_residential_code].join("|");
    if (!deduped.has(key)) deduped.set(key, row);
  }
  return [...deduped.values()].map((row, index) => ({
    id: `fcc-${row.provider_id || "unknown"}-${row.technology}-${row.download_mbps ?? "x"}-${row.upload_mbps ?? "x"}-${index}`,
    providerId: row.provider_id,
    provider: row.brand_name || `FCC provider ${row.provider_id}`,
    technologyCode: row.technology,
    technology: technologyLabel(row.technology),
    downloadMbps: row.download_mbps,
    uploadMbps: row.upload_mbps,
    classification: "Business",
    coverageArea,
    scope: exact ? "exact_location" : "nearby_area",
    matchMethod,
    source: "FCC Broadband Data Collection",
    sourceDate: asOfDate,
    datasetVintage,
    retrievedAt,
    confidence: exact ? "Verified" : "Estimated",
    note: exact
      ? "Maximum advertised speeds filed for this FCC Location ID. This is not business orderability or a current-subscription claim."
      : "Nearby market context—not availability at this address. Maximum advertised speeds filed somewhere in the loaded H3 area.",
  }));
}

export function availabilityRows(
  database: DatabaseSync,
  whereColumn: "location_id" | "h3_res8_id",
  value: string,
) {
  const statement = database.prepare(`
    SELECT DISTINCT
      provider_id,
      COALESCE(NULLIF(brand_name, ''), provider_id) AS brand_name,
      technology,
      max_advertised_download_speed AS download_mbps,
      max_advertised_upload_speed AS upload_mbps,
      business_residential_code
    FROM fcc_availability
    WHERE ${whereColumn} = ?
      AND business_residential_code IN ('B', 'X')
    ORDER BY brand_name ASC, technology ASC, download_mbps DESC, upload_mbps DESC
  `);
  return statement.all(value) as unknown as AvailabilityRow[];
}

async function matchLocationId(address: string, fabricVintage: string) {
  const token = process.env.COSTQUEST_API_TOKEN?.trim();
  if (!token) return null;
  const baseUrl = (process.env.COSTQUEST_API_BASE_URL || "https://api.costquest.com").replace(/\/$/, "");
  const url = new URL(`${baseUrl}/fabricext/${encodeURIComponent(fabricVintage)}/match`);
  url.searchParams.set("text", address);
  url.searchParams.set("maxresults", "2");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    cache: "no-store",
    signal: createTimeoutSignal(5_000),
  });
  if (!response.ok) throw new Error(`FCC address matcher returned HTTP ${response.status}.`);
  const payload = (await response.json()) as MatchResponse;
  const threshold = Math.max(0.9, Math.min(1, Number(process.env.COSTQUEST_MATCH_MIN_SIMILARITY || 0.95)));
  const first = payload.locations?.[0];
  const locationId = first?.location_id === undefined ? "" : String(first.location_id);
  const unique = payload.matchcount === 1 && payload.locations?.length === 1;
  const fullMatch = payload.matchtype === "F";
  const similarity = Number(first?.similarity ?? 0);
  return unique && fullMatch && similarity >= threshold && /^\d+$/.test(locationId) ? locationId : null;
}

function areaLookup(
  database: DatabaseSync,
  coordinates: Coordinates | undefined,
  asOfDate: string,
  datasetVintage: string,
) {
  if (!coordinates || !Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng)) return null;
  const h3Cell = latLngToCell(coordinates.lat, coordinates.lng, 8);
  const rows = availabilityRows(database, "h3_res8_id", h3Cell);
  if (!rows.length) return null;
  return {
    status: "available",
    observations: rowsToObservations(rows, asOfDate, datasetVintage, `FCC H3 resolution-8 area ${h3Cell}`, "h3_res8"),
    message: "Nearby market context—not availability at this address. Provider filings exist somewhere in the loaded H3 area.",
    sourceUrl: FCC_MAP_URL,
    asOfDate,
    datasetVintage,
    matchedLocationId: null,
    matchQuality: "area_h3",
  } satisfies FccLookupResponse;
}

export function fccRuntimeConfigured() {
  const configuredPath = process.env.FCC_AVAILABILITY_DB_PATH?.trim();
  return Boolean(configuredPath && existsSync(path.resolve(configuredPath)));
}

export async function lookupFccAvailability(input: FccLookupInput): Promise<FccLookupResponse> {
  const configuredPath = process.env.FCC_AVAILABILITY_DB_PATH?.trim();
  if (!configuredPath || !existsSync(path.resolve(configuredPath))) {
    return baseResponse("not_configured", "Data unavailable. Configure a current FCC Broadband Data Collection index to view filing context.");
  }

  const database = new DatabaseSync(path.resolve(configuredPath), { readOnly: true });
  try {
    const asOfDate = metadata(database, "fcc_as_of_date");
    const fabricVintage = metadata(database, "fabric_vintage");
    const datasetVintage = metadata(database, "fcc_dataset_vintage") || asOfDate;
    if (!asOfDate || !datasetVintage) {
      return baseResponse("unavailable", "Data unavailable. The FCC index is missing its current BDC vintage.");
    }

    if (input.locationId && /^\d+$/.test(input.locationId)) {
      const rows = availabilityRows(database, "location_id", input.locationId);
      if (rows.length) {
        return {
          status: "available",
          observations: rowsToObservations(rows, asOfDate, datasetVintage, `FCC Location ID ${input.locationId}`, "fcc_location_id"),
          message: "Current BDC filings were found for the supplied FCC Location ID. This is not a serviceability guarantee.",
          sourceUrl: FCC_MAP_URL,
          asOfDate,
          datasetVintage,
          matchedLocationId: input.locationId,
          matchQuality: "user_supplied_location_id",
        };
      }
    }

    const hasUsableAddress = !/^address (?:not listed|unavailable)/i.test(input.address);
    if (fabricVintage && process.env.COSTQUEST_API_TOKEN && hasUsableAddress) {
      const matchedLocationId = await matchLocationId(input.address, fabricVintage);
      if (matchedLocationId) {
        const rows = availabilityRows(database, "location_id", matchedLocationId);
        if (rows.length) {
          return {
            status: "available",
            observations: rowsToObservations(rows, asOfDate, datasetVintage, `FCC Location ID ${matchedLocationId}`, "costquest_full_address"),
            message: "The address was uniquely matched to an FCC Fabric location and current BDC filing rows were found. This is not orderability.",
            sourceUrl: FCC_MAP_URL,
            asOfDate,
            datasetVintage,
            matchedLocationId,
            matchQuality: "exact",
          };
        }
      }
    }

    const nearby = areaLookup(database, input.coordinates, asOfDate, datasetVintage);
    if (nearby) return nearby;
    return baseResponse(
      "no_report",
      "No report in the loaded current BDC data. Missing data does not prove that any provider cannot serve this address.",
      asOfDate,
      datasetVintage,
    );
  } catch {
    return baseResponse("error", "Data unavailable. The current FCC BDC index could not be queried safely.");
  } finally {
    database.close();
  }
}
