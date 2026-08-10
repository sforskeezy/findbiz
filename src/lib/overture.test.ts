import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { DuckDBInstance } from "@duckdb/node-api";

import { boundsForRadius, buildSearchCells } from "@/lib/place-provider";
import {
  inspectOvertureReadiness,
  normalizeOvertureRow,
  OverturePlaceProvider,
  overtureCoverageRelation,
  parseOvertureCoverageBbox,
  type OvertureQuery,
  type OvertureReadiness,
} from "@/lib/overture";

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

afterEach(() => {
  delete process.env.OVERTURE_PLACES_PATH;
  delete process.env.OVERTURE_COVERAGE_BBOX;
});

const ready = async (): Promise<OvertureReadiness> => ({
  configured: true,
  ready: true,
  code: "OVERTURE_READY",
  coverageBoundaryConfigured: Boolean(parseOvertureCoverageBbox()),
});

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
    }, ready);
    const bounds = boundsForRadius(center, 1);
    const result = await provider.searchNearby({ center, radiusMiles: 1, bounds, cells: buildSearchCells(center, 1), budget: { maxRequests: 1, maxRecords: 100, deadline: Date.now() + 1000 } });
    expect(captured?.request.bounds).toEqual(bounds);
    expect(result.places).toHaveLength(1);
  });

  it("reports a missing configured file without exposing its path", async () => {
    process.env.OVERTURE_PLACES_PATH = path.join(os.tmpdir(), "missing-findbiz-overture.parquet");
    const status = await inspectOvertureReadiness();
    expect(status).toMatchObject({ configured: true, ready: false, code: "OVERTURE_FILE_MISSING" });
    const result = await new OverturePlaceProvider().searchNearby({ center, radiusMiles: 1, bounds: boundsForRadius(center, 1), cells: buildSearchCells(center, 1), budget: { maxRequests: 1, maxRecords: 100, deadline: Date.now() + 1000 } });
    expect(result.diagnostic).toMatchObject({ status: "unavailable", code: "OVERTURE_FILE_MISSING" });
    expect(result.diagnostic.message).not.toContain(os.tmpdir());
  });

  it("rejects an invalid Places schema during readiness validation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "findbiz-overture-invalid-"));
    const file = path.join(directory, "places.parquet");
    await writeFile(file, "not parquet");
    process.env.OVERTURE_PLACES_PATH = file;
    await expect(inspectOvertureReadiness()).resolves.toMatchObject({ ready: false, code: "OVERTURE_SCHEMA_INVALID" });
  });

  it("classifies outside and partial configured coverage before querying", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "findbiz-overture-coverage-"));
    const file = path.join(directory, "places.parquet");
    await writeFile(file, "fixture");
    process.env.OVERTURE_PLACES_PATH = file;
    process.env.OVERTURE_COVERAGE_BBOX = "-75.01,39.99,-74.99,40.01";
    const coverage = parseOvertureCoverageBbox();
    expect(overtureCoverageRelation(boundsForRadius({ lat: 41, lng: -75 }, 1), coverage)).toBe("outside");

    let calls = 0;
    const provider = new OverturePlaceProvider(async ({ request }) => {
      calls += 1;
      expect(request.bounds.west).toBe(-75.01);
      return [row()];
    }, ready);
    const partial = await provider.searchNearby({ center, radiusMiles: 1, bounds: boundsForRadius(center, 1), cells: buildSearchCells(center, 1), budget: { maxRequests: 1, maxRecords: 100, deadline: Date.now() + 1000 } });
    expect(partial.diagnostic).toMatchObject({ status: "partial", code: "OVERTURE_PARTIAL_CONFIGURED_COVERAGE", coverage: "partial" });
    expect(calls).toBe(1);

    const outsideCenter = { lat: 41, lng: -75 };
    const outside = await provider.searchNearby({ center: outsideCenter, radiusMiles: 1, bounds: boundsForRadius(outsideCenter, 1), cells: buildSearchCells(outsideCenter, 1), budget: { maxRequests: 1, maxRecords: 100, deadline: Date.now() + 1000 } });
    expect(outside.diagnostic).toMatchObject({ status: "unavailable", code: "OVERTURE_OUTSIDE_CONFIGURED_COVERAGE", coverage: "outside" });
    expect(calls).toBe(1);
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
