import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { latLngToCell } from "h3-js";
import { afterEach, describe, expect, it } from "vitest";

import { lookupFccAvailability, rowsToObservations, type AvailabilityRow } from "@/lib/fcc";
import { classifyServiceability, isCharterSpectrumObservation, isCharterSpectrumProvider } from "@/lib/serviceability";

const row = (download: number, upload: number): AvailabilityRow => ({
  provider_id: "12345",
  brand_name: "Fixture Broadband",
  technology: "50",
  download_mbps: download,
  upload_mbps: upload,
  business_residential_code: "B",
});

afterEach(() => {
  delete process.env.FCC_AVAILABILITY_DB_PATH;
  delete process.env.COSTQUEST_API_TOKEN;
  delete process.env.CHARTER_FCC_PROVIDER_IDS;
});

async function databaseFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "findbiz-fcc-"));
  const file = path.join(directory, "fcc.sqlite");
  const database = new DatabaseSync(file);
  database.exec(`
    CREATE TABLE fcc_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO fcc_metadata VALUES ('fcc_as_of_date', '2026-06-30');
    INSERT INTO fcc_metadata VALUES ('fabric_vintage', '202606');
    INSERT INTO fcc_metadata VALUES ('fcc_dataset_vintage', 'BDC 2026-06-30');
    CREATE TABLE fcc_availability (
      provider_id TEXT, brand_name TEXT, technology TEXT,
      max_advertised_download_speed REAL, max_advertised_upload_speed REAL,
      business_residential_code TEXT, location_id TEXT, h3_res8_id TEXT
    );
  `);
  return { file, database };
}

describe("current FCC BDC handling", () => {
  it("preserves every filed speed pair instead of combining independent maxima", () => {
    const observations = rowsToObservations([row(1000, 20), row(500, 500)], "2026-06-30", "BDC 2026-06-30", "FCC Location ID 1", "fcc_location_id");
    expect(observations.map((item) => [item.downloadMbps, item.uploadMbps])).toEqual([[1000, 20], [500, 500]]);
    expect(observations.every((item) => item.scope === "exact_location")).toBe(true);
  });

  it("classifies exact and nearby evidence distinctly", async () => {
    const exactFixture = await databaseFixture();
    exactFixture.database.prepare("INSERT INTO fcc_availability VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("12345", "Fixture Broadband", "50", 1000, 100, "B", "9001", "");
    exactFixture.database.close();
    process.env.FCC_AVAILABILITY_DB_PATH = exactFixture.file;
    const exact = await lookupFccAvailability({ address: "100 Public Sq, Public City, PA 19000", locationId: "9001" });
    expect(exact).toMatchObject({ status: "available", matchQuality: "user_supplied_location_id" });
    expect(exact.observations[0]).toMatchObject({ scope: "exact_location", matchMethod: "fcc_location_id", datasetVintage: "BDC 2026-06-30" });

    const areaFixture = await databaseFixture();
    const h3 = latLngToCell(40, -75, 8);
    areaFixture.database.prepare("INSERT INTO fcc_availability VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("12345", "Fixture Broadband", "50", 500, 50, "B", "other", h3);
    areaFixture.database.close();
    process.env.FCC_AVAILABILITY_DB_PATH = areaFixture.file;
    const nearby = await lookupFccAvailability({ address: "100 Public Sq, Public City, PA 19000", coordinates: { lat: 40, lng: -75 } });
    expect(nearby).toMatchObject({ status: "available", matchQuality: "area_h3" });
    expect(nearby.observations[0].note).toContain("Nearby market context—not availability at this address");
  });

  it("returns Data unavailable without falling back to Form 477", async () => {
    const result = await lookupFccAvailability({ address: "100 Public Sq, Public City, PA 19000", coordinates: { lat: 40, lng: -75 } });
    expect(result).toMatchObject({ status: "not_configured", observations: [] });
    expect(result.message).toContain("Data unavailable");
    expect(classifyServiceability(result).tier).toBe("data_unavailable");
  });

  it("uses exact provider identification and rejects substring false positives", () => {
    expect(isCharterSpectrumProvider("Spectrum")).toBe(true);
    expect(isCharterSpectrumProvider("Spectrum Dental Associates")).toBe(false);
    expect(isCharterSpectrumProvider("Acme Charter Communications Consulting")).toBe(false);
    const observation = rowsToObservations([{ ...row(100, 10), brand_name: "Spectrum" }], "2026-06-30", "BDC 2026-06-30", "FCC Location ID 1", "fcc_location_id")[0];
    expect(isCharterSpectrumObservation(observation)).toBe(false);
    process.env.CHARTER_FCC_PROVIDER_IDS = "12345";
    expect(isCharterSpectrumObservation(observation)).toBe(true);
  });
});
