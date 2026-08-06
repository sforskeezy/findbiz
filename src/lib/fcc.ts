import { existsSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { latLngToCell } from "h3-js";

import type {
  BroadbandObservation,
  Coordinates,
  FccLookupResponse,
} from "@/lib/types";

const FCC_MAP_URL = "https://broadbandmap.fcc.gov/home";
const FORM_477_DATASET = "jdr4-3q4p"; // Fixed Broadband Deployment Data: June 2021 Status V1
const FORM_477_AS_OF = "2021-06-30";

type FccLookupInput = {
  address: string;
  coordinates?: Coordinates;
  locationId?: string;
};

type AvailabilityRow = {
  provider_id: string;
  brand_name: string;
  technology: string;
  download_mbps: number | null;
  upload_mbps: number | null;
  business_residential_code: string;
};

type MatchLocation = {
  location_id?: string | number;
  similarity?: number;
};

type MatchResponse = {
  matchtype?: string;
  matchcount?: number;
  locations?: MatchLocation[];
};

type Form477Row = {
  provider_id?: string;
  providername?: string;
  dbaname?: string;
  holdingcompanyname?: string;
  techcode?: string;
  maxaddown?: string;
  maxadup?: string;
  business?: string;
  consumer?: string;
  blockcode?: string;
};

function baseResponse(
  status: FccLookupResponse["status"],
  message: string,
): FccLookupResponse {
  return {
    status,
    observations: [],
    message,
    sourceUrl: FCC_MAP_URL,
    asOfDate: null,
    matchedLocationId: null,
    matchQuality: "none",
  };
}

function metadata(database: DatabaseSync, key: string) {
  try {
    const row = database
      .prepare("SELECT value FROM fcc_metadata WHERE key = ?")
      .get(key) as { value?: string } | undefined;
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

function technologyLabel(code: string) {
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
    "50": "Optical carrier / Fiber to the premises",
    "60": "Satellite",
    "70": "Terrestrial fixed wireless",
    "90": "Electric power line",
  };
  return labels[String(code)] || `FCC technology code ${code}`;
}

function rowsToObservations(
  rows: AvailabilityRow[],
  asOfDate: string,
  coverageArea: string,
  exact: boolean,
): BroadbandObservation[] {
  const retrievedAt = new Date().toISOString();
  return rows.map((row, index) => ({
    id: `fcc-${row.provider_id || "unknown"}-${row.technology}-${index}`,
    provider: row.brand_name || `FCC provider ${row.provider_id}`,
    technology: technologyLabel(row.technology),
    downloadMbps: row.download_mbps,
    uploadMbps: row.upload_mbps,
    classification: "Business",
    coverageArea,
    source: "FCC Broadband Data Collection",
    sourceDate: asOfDate,
    retrievedAt,
    confidence: exact ? "Verified" : "Estimated",
    note: exact
      ? "Provider-reported availability at the matched FCC location; this is not a current-subscription claim or an orderability guarantee."
      : "Provider-reported business availability somewhere in the same FCC H3 area; this is not an exact-address or current-subscription claim.",
  }));
}

function form477ToObservations(rows: Form477Row[], blockFips: string): BroadbandObservation[] {
  const retrievedAt = new Date().toISOString();
  const businessRows = rows.filter((row) => row.business === "1");
  const sourceRows = businessRows.length ? businessRows : rows;

  const deduped = new Map<string, BroadbandObservation>();
  for (const [index, row] of sourceRows.entries()) {
    const provider = row.dbaname || row.providername || row.holdingcompanyname || `FCC provider ${row.provider_id || index}`;
    const technology = technologyLabel(String(row.techcode || ""));
    const key = `${provider}|${technology}|${row.maxaddown}|${row.maxadup}`;
    if (deduped.has(key)) continue;
    deduped.set(key, {
      id: `fcc477-${row.provider_id || index}-${row.techcode || "x"}`,
      provider,
      technology,
      downloadMbps: row.maxaddown == null ? null : Number(row.maxaddown),
      uploadMbps: row.maxadup == null ? null : Number(row.maxadup),
      classification: row.business === "1" ? "Business" : "Residential",
      coverageArea: `Census block ${blockFips}`,
      source: "FCC Form 477 Fixed Broadband Deployment (June 2021)",
      sourceDate: FORM_477_AS_OF,
      retrievedAt,
      confidence: "Estimated",
      note: "Official FCC provider-reported availability for this census block from the final Form 477 filing (June 2021). This is block-level coverage, not proof of a current subscription or guaranteed orderability.",
    });
  }
  return [...deduped.values()].sort(
    (a, b) => (b.downloadMbps ?? 0) - (a.downloadMbps ?? 0) || a.provider.localeCompare(b.provider),
  );
}

function availabilityRows(
  database: DatabaseSync,
  whereColumn: "location_id" | "h3_res8_id",
  value: string,
) {
  const statement = database.prepare(`
    SELECT
      provider_id,
      COALESCE(NULLIF(brand_name, ''), provider_id) AS brand_name,
      technology,
      MAX(max_advertised_download_speed) AS download_mbps,
      MAX(max_advertised_upload_speed) AS upload_mbps,
      business_residential_code
    FROM fcc_availability
    WHERE ${whereColumn} = ?
      AND business_residential_code IN ('B', 'X')
    GROUP BY provider_id, brand_name, technology, business_residential_code
    ORDER BY download_mbps DESC, brand_name ASC
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
  });
  if (!response.ok) throw new Error(`FCC address matching failed (${response.status}).`);

  const payload = (await response.json()) as MatchResponse;
  const threshold = Number(process.env.COSTQUEST_MATCH_MIN_SIMILARITY || 0.95);
  const first = payload.locations?.[0];
  const locationId = first?.location_id === undefined ? "" : String(first.location_id);
  const unique = payload.matchcount === 1 && payload.locations?.length === 1;
  const fullMatch = payload.matchtype === "F";
  const similarity = Number(first?.similarity ?? 0);

  if (!unique || !fullMatch || similarity < threshold || !/^\d+$/.test(locationId)) return null;
  return locationId;
}

function areaLookup(
  database: DatabaseSync,
  coordinates: Coordinates | undefined,
  asOfDate: string,
): FccLookupResponse | null {
  if (!coordinates || !Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng)) return null;
  const h3Cell = latLngToCell(coordinates.lat, coordinates.lng, 8);
  const rows = availabilityRows(database, "h3_res8_id", h3Cell);
  if (!rows.length) return null;
  return {
    status: "available",
    observations: rowsToObservations(rows, asOfDate, `FCC H3 area ${h3Cell}`, false),
    message: "Official FCC provider-reported business availability was found in the surrounding H3 area. It is not an exact-address match.",
    sourceUrl: FCC_MAP_URL,
    asOfDate,
    matchedLocationId: null,
    matchQuality: "area_h3",
  };
}

async function censusBlockFor(coordinates: Coordinates) {
  const url = new URL("https://geo.fcc.gov/api/census/block/find");
  url.searchParams.set("latitude", String(coordinates.lat));
  url.searchParams.set("longitude", String(coordinates.lng));
  url.searchParams.set("format", "json");

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`FCC census-block lookup failed (${response.status}).`);
  const payload = (await response.json()) as { Block?: { FIPS?: string }; status?: string };
  const fips = payload.Block?.FIPS?.trim();
  if (!fips || !/^\d{15}$/.test(fips)) throw new Error("Could not resolve a census block for this location.");
  return fips;
}

async function lookupForm477ByCoordinates(coordinates: Coordinates): Promise<FccLookupResponse> {
  const blockFips = await censusBlockFor(coordinates);
  const url = new URL(`https://opendata.fcc.gov/resource/${FORM_477_DATASET}.json`);
  url.searchParams.set("$where", `blockcode='${blockFips}'`);
  url.searchParams.set("$limit", "200");

  const response = await fetch(url, {
    headers: { Accept: "application/json", "X-App-Token": process.env.FCC_OPENDATA_APP_TOKEN?.trim() || "" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`FCC Open Data lookup failed (${response.status}).`);

  const rows = (await response.json()) as Form477Row[];
  const observations = form477ToObservations(rows, blockFips);
  if (!observations.length) {
    return {
      ...baseResponse(
        "unavailable",
        `No official Form 477 provider records were reported for census block ${blockFips} in the June 2021 filing.`,
      ),
      asOfDate: FORM_477_AS_OF,
      matchQuality: "area_h3",
    };
  }

  return {
    status: "available",
    observations,
    message:
      "Official FCC Form 477 provider-reported availability for this census block (June 2021 filing). Block-level coverage is not an exact rooftop orderability guarantee.",
    sourceUrl: FCC_MAP_URL,
    asOfDate: FORM_477_AS_OF,
    matchedLocationId: null,
    matchQuality: "area_h3",
  };
}

export function fccRuntimeConfigured() {
  const configuredPath = process.env.FCC_AVAILABILITY_DB_PATH?.trim();
  if (configuredPath && existsSync(path.resolve(configuredPath))) return true;
  return true; // live Form 477 Open Data fallback is always available
}

export async function lookupFccAvailability(input: FccLookupInput): Promise<FccLookupResponse> {
  const configuredPath = process.env.FCC_AVAILABILITY_DB_PATH?.trim();

  if (configuredPath) {
    const databasePath = path.resolve(configuredPath);
    if (existsSync(databasePath)) {
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const asOfDate = metadata(database, "fcc_as_of_date");
        const fabricVintage = metadata(database, "fabric_vintage");
        if (!asOfDate) {
          return baseResponse("error", "The FCC index is missing its official data vintage.");
        }

        if (input.locationId && /^\d+$/.test(input.locationId)) {
          const rows = availabilityRows(database, "location_id", input.locationId);
          if (rows.length) {
            return {
              status: "available",
              observations: rowsToObservations(rows, asOfDate, `FCC Location ID ${input.locationId}`, true),
              message: "Official provider-reported business availability was found for the supplied FCC Location ID.",
              sourceUrl: FCC_MAP_URL,
              asOfDate,
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
                observations: rowsToObservations(rows, asOfDate, `FCC Location ID ${matchedLocationId}`, true),
                message:
                  "The address was uniquely matched to an FCC Fabric location and official provider-reported business availability was found.",
                sourceUrl: FCC_MAP_URL,
                asOfDate,
                matchedLocationId,
                matchQuality: "exact",
              };
            }
          }
        }

        const nearby = areaLookup(database, input.coordinates, asOfDate);
        if (nearby) return nearby;
      } catch (error) {
        return {
          ...baseResponse(
            "error",
            error instanceof Error ? error.message : "The FCC lookup failed. No provider claim was generated.",
          ),
          asOfDate: metadata(database, "fcc_as_of_date"),
        };
      } finally {
        database.close();
      }
    }
  }

  if (input.coordinates && Number.isFinite(input.coordinates.lat) && Number.isFinite(input.coordinates.lng)) {
    try {
      return await lookupForm477ByCoordinates(input.coordinates);
    } catch (error) {
      return baseResponse(
        "error",
        error instanceof Error ? error.message : "The FCC lookup failed. No provider claim was generated.",
      );
    }
  }

  return baseResponse(
    "unavailable",
    "Coordinates are required to look up official FCC broadband availability for this business.",
  );
}
