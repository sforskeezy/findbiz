import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { DuckDBInstance } from "@duckdb/node-api";

import { boundsForRadius, buildSearchCells } from "@/lib/place-provider";
import { normalizeOvertureRow, OverturePlaceProvider, type OvertureQuery } from "@/lib/overture";

const center = { lat: 40, lng: -75 };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "gers-1",
    name: "Public Market",
    primary_category: "grocery_store",
    alternate_categories_json: JSON.stringify(["market"]),
    confidence: 0.91,
    websites_json: JSON.stringify(["https://market.example"]),
    phones_json: JSON.stringify(["+15550102000"]),
    brand_json: JSON.stringify({ names: { primary: "Public Market" } }),
    addresses_json: JSON.stringify([{ freeform: "100 Market St", locality: "Public City", region: "PA", postcode: "19000" }]),
    sources_json: JSON.stringify([{ dataset: "fixture", update_time: "2026-07-01T00:00:00Z" }]),
    operating_status: "open",
    lat: 40,
    lng: -75,
    ...overrides,
  };
}

afterEach(() => delete process.env.OVERTURE_PLACES_PATH);

describe("Overture provider", () => {
  it("normalizes current Places fields and provenance", () => {
    const place = normalizeOvertureRow(row());
    expect(place).toMatchObject({ name: "Public Market", phone: "+15550102000", website: "https://market.example", brand: "Public Market", operatingStatus: "Open" });
    expect(place?.sources[0]).toMatchObject({ providerId: "overture", providerRecordId: "gers-1", dataset: "fixture" });
    expect(place?.rawCategories).toEqual(["grocery_store", "market"]);
  });

  it("returns a safe not-configured diagnostic", async () => {
    const provider = new OverturePlaceProvider(async () => []);
    const result = await provider.searchNearby({ center, radiusMiles: 1, bounds: boundsForRadius(center, 1), cells: buildSearchCells(center, 1), budget: { maxRequests: 1, maxRecords: 100, deadline: Date.now() + 1000 } });
    expect(result.diagnostic).toMatchObject({ status: "unavailable", code: "OVERTURE_NOT_CONFIGURED" });
    expect(result.diagnostic.setupHint).not.toContain(process.cwd());
  });

  it("passes bounded coordinates to DuckDB and enforces the requested radius", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "findbiz-overture-"));
    const file = path.join(directory, "places.parquet");
    await writeFile(file, "fixture");
    process.env.OVERTURE_PLACES_PATH = file;
    let captured: Parameters<OvertureQuery>[0] | undefined;
    const provider = new OverturePlaceProvider(async (params) => {
      captured = params;
      return [row(), row({ id: "outside", lat: 41, lng: -75 })];
    });
    const bounds = boundsForRadius(center, 1);
    const result = await provider.searchNearby({ center, radiusMiles: 1, bounds, cells: buildSearchCells(center, 1), budget: { maxRequests: 1, maxRecords: 100, deadline: Date.now() + 1000 } });
    expect(captured?.request.bounds).toEqual(bounds);
    expect(result.places).toHaveLength(1);
  });

  it("queries a real local GeoParquet-compatible file through DuckDB", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "findbiz-overture-real-"));
    const file = path.join(directory, "places.parquet");
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await connection.run(
      `COPY (
        SELECT
          'gers-real'::VARCHAR AS id,
          {'primary': 'DuckDB Repair'} AS names,
          {'primary': 'car_repair', 'alternate': ['repair']} AS categories,
          0.93::DOUBLE AS confidence,
          ['https://duckdb-repair.example'] AS websites,
          ['+15550102000'] AS phones,
          {'names': {'primary': 'DuckDB Repair'}} AS brand,
          [{'freeform': '100 Commerce St', 'locality': 'Public City', 'region': 'PA', 'postcode': '19000'}] AS addresses,
          [{'dataset': 'fixture', 'update_time': '2026-07-01T00:00:00Z'}] AS sources,
          'open'::VARCHAR AS operating_status,
          {'xmin': -75.0::DOUBLE, 'xmax': -75.0::DOUBLE, 'ymin': 40.0::DOUBLE, 'ymax': 40.0::DOUBLE} AS bbox
      ) TO $output (FORMAT PARQUET)`,
      { output: file },
    );
    connection.closeSync();
    process.env.OVERTURE_PLACES_PATH = file;
    const provider = new OverturePlaceProvider();
    const result = await provider.searchNearby({ center, radiusMiles: 1, bounds: boundsForRadius(center, 1), cells: buildSearchCells(center, 1), budget: { maxRequests: 1, maxRecords: 100, deadline: Date.now() + 2000 } });
    expect(result.diagnostic.status).toBe("complete");
    expect(result.places[0]).toMatchObject({ name: "DuckDB Repair", category: "Automotive", phone: "+15550102000" });
  });
});
