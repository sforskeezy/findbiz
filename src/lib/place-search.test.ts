import { describe, expect, it } from "vitest";

import type { PlaceProvider, PlaceSearchRequest } from "@/lib/place-provider";
import { buildSearchCells } from "@/lib/place-provider";
import { searchPlaces } from "@/lib/place-search";
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
    expect(result.diagnostics.partialCoverage).toBe(true);
  });
});
