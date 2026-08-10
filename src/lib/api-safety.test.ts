import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { POST as fccPost } from "@/app/api/fcc/availability/route";
import { POST as researchPost } from "@/app/api/research/route";
import { fccRequestSchema, placeSearchRequestSchema } from "@/lib/api-safety";
import { redactError } from "@/lib/request-safety";

describe("API validation and retention safety", () => {
  it("rejects unknown request fields with strict schemas", () => {
    expect(placeSearchRequestSchema.safeParse({ address: "100 Public Sq, Public City, PA", radiusMiles: 1, unexpected: true }).success).toBe(false);
    expect(fccRequestSchema.safeParse({ address: "100 Public Sq, Public City, PA", locationId: "abc" }).success).toBe(false);
  });

  it("adds no-store headers to sensitive success and validation responses", async () => {
    delete process.env.FCC_AVAILABILITY_DB_PATH;
    const fcc = await fccPost(new Request("http://localhost/api/fcc/availability", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: "100 Public Sq, Public City, PA", coordinates: { lat: 40, lng: -75 } }) }));
    expect(fcc.headers.get("cache-control")).toContain("no-store");
    const invalid = await researchPost(new Request("http://localhost/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: "x", radiusMiles: 1 }) }));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get("cache-control")).toContain("no-store");
  });

  it("redacts URLs, credentials, coordinates, and street-like addresses", () => {
    const message = redactError(new Error("token=secret https://private.example /Users/private/data/places.parquet 40.123456 -75.987654 100 Main Street, Public City, PA"), "failed");
    expect(message).not.toContain("secret");
    expect(message).not.toContain("private.example");
    expect(message).not.toContain("40.123456");
    expect(message).not.toContain("100 Main Street");
    expect(message).not.toContain("/Users/private");
  });

  it("contains no browser persistence or CSV export path", async () => {
    const root = process.cwd();
    const files = [
      "src/components/search-landing.tsx",
      "src/components/business-results-page.tsx",
      "src/components/business-research-page.tsx",
      "src/lib/client-session.ts",
    ];
    const source = (await Promise.all(files.map((file) => readFile(path.join(root, file), "utf8")))).join("\n");
    expect(source).not.toMatch(/localStorage|sessionStorage/);
    expect(source).not.toMatch(/text\/csv|exportResults|\.csv/);
    expect(source).not.toContain("/search?address=");
  });
});
