import { afterEach, describe, expect, it, vi } from "vitest";

import { geocodeAddress, normalizeStreetForComparison } from "@/lib/geocode";

afterEach(() => vi.unstubAllGlobals());

describe("address geocoding", () => {
  it.each([
    ["100 North Main Street", "100 N Main St"],
    ["42 Southwest Market Avenue", "42 SW Market Ave"],
    ["7 Northeast Commerce Road", "7 NE Commerce Rd"],
  ])("normalizes directional and street-type variants for %s", (expanded, abbreviated) => {
    expect(normalizeStreetForComparison(expanded)).toBe(normalizeStreetForComparison(abbreviated));
  });

  it("accepts a resolved street address with a directional abbreviation", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: { addressMatches: [{ matchedAddress: "100 N Main Street, Public City, PA 19000", coordinates: { x: -75, y: 40 } }] } })));
    await expect(geocodeAddress("100 North Main St, Public City, PA 19000")).resolves.toMatchObject({
      formattedAddress: "100 N Main Street, Public City, PA 19000",
      confidence: "Verified",
    });
  });

  it("does not silently replace a supplied street address with a ZIP centroid", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("census.gov")) return Response.json({ result: { addressMatches: [] } });
      if (url.includes("photon")) {
        return Response.json({ features: [{ geometry: { coordinates: [-75, 40] }, properties: { type: "city", name: "Public City", city: "Public City", state: "Pennsylvania", postcode: "19000", countrycode: "US" } }] });
      }
      return Response.json([{ lat: "40", lon: "-75", display_name: "Public City, Pennsylvania, 19000" }]);
    }));
    await expect(geocodeAddress("999 Missing North Street, Public City, PA 19000"))
      .rejects.toThrow("could not be located");
  });
});
