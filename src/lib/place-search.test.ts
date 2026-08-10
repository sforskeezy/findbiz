import { describe, expect, it } from "vitest";

import type { PlaceProvider, PlaceSearchRequest } from "@/lib/place-provider";
import { buildSearchCells } from "@/lib/place-provider";
import { PlaceSearchUnavailableError, searchPlaces } from "@/lib/place-search";
import { makeCandidate, StubProvider } from "../../tests/helpers";

describe("adaptive coverage and isolation", () => {
  it("creates deterministic controlled cells for larger radiuses", () => {
    const cells = buildSearchCells({ lat: 40, lng: -75 }, 5);
    expect(cells.length).toBeGreaterThan(4);
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(cells.length);
    expect(cells[0].center).toEqual({ lat: 40, lng: -75 });
  });

  it("isolates a provider timeout and preserves successful results", async () => {
    const slow: PlaceProvider = {
      id: "slow",
      searchNearby: async (request: PlaceSearchRequest) => {
        void request.signal;
        return await new Promise(() => {});
      },
    };
    const good = new StubProvider("good", [makeCandidate({ id: "good-1", name: "Good Local Business" })]);
    const result = await searchPlaces({ lat: 40, lng: -75 }, 1, { providers: [slow, good], useCache: false, providerTimeoutMs: 20 });
    expect(result.prospects.map((item) => item.name)).toEqual(["Good Local Business"]);
    expect(result.diagnostics.providers.find((item) => item.providerId === "slow")?.status).toBe("failed");
    expect(result.diagnostics.providers.find((item) => item.providerId === "slow")?.code).toBe("PROVIDER_TIMEOUT");
    expect(result.diagnostics.partialCoverage).toBe(true);
  });

  it("preserves usable partial results", async () => {
    const partial = new StubProvider("partial", [makeCandidate({ name: "Retained Local Business" })], "partial");
    const result = await searchPlaces({ lat: 40, lng: -75 }, 1, { providers: [partial], useCache: false });
    expect(result.prospects.map((item) => item.name)).toEqual(["Retained Local Business"]);
    expect(result.diagnostics.partialCoverage).toBe(true);
  });

  it("throws a retryable error instead of returning a fake successful zero", async () => {
    const failed: PlaceProvider = {
      id: "failed",
      async searchNearby() {
        throw new Error("upstream unavailable");
      },
    };
    await expect(searchPlaces({ lat: 40, lng: -75 }, 1, { providers: [failed], useCache: false }))
      .rejects.toMatchObject({ code: "PLACES_PROVIDER_UNAVAILABLE", retryable: true });
    await expect(searchPlaces({ lat: 40, lng: -75 }, 1, { providers: [failed], useCache: false }))
      .rejects.toBeInstanceOf(PlaceSearchUnavailableError);
  });

  it.each([1, 3, 5])("enforces the exact %s-mile radius after provider normalization", async (radiusMiles) => {
    const latitudeMiles = 1 / 69;
    const provider = new StubProvider("fixture", [
      makeCandidate({ id: `inside-${radiusMiles}`, name: `Inside ${radiusMiles}`, coordinates: { lat: 40 + (radiusMiles - 0.1) * latitudeMiles, lng: -75 } }),
      makeCandidate({ id: `outside-${radiusMiles}`, name: `Outside ${radiusMiles}`, coordinates: { lat: 40 + (radiusMiles + 0.2) * latitudeMiles, lng: -75 } }),
    ]);
    const result = await searchPlaces({ lat: 40, lng: -75 }, radiusMiles, { providers: [provider], useCache: false });
    expect(result.prospects.map((item) => item.name)).toEqual([`Inside ${radiusMiles}`]);
  });
});
