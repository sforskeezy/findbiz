import { describe, expect, it, vi } from "vitest";

import { boundsForRadius, buildSearchCells } from "@/lib/place-provider";
import { buildOverpassQuery, OpenStreetMapPlaceProvider, sequentialOverpassFetch } from "@/lib/openstreetmap";

describe("OpenStreetMap provider", () => {
  it("falls back to mirrors sequentially without racing", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
      calls.push(String(url));
      if (String(url).includes("first")) return new Response("no", { status: 503 });
      return Response.json({ elements: [{ type: "node", id: 1, lat: 40, lon: -75, tags: { name: "Repair Shop", shop: "car_repair" } }] });
    }) as typeof fetch;
    const result = await sequentialOverpassFetch("unique sequential query", { endpoints: ["https://first.example", "https://second.example"], retries: 0, fetchImpl, timeoutMs: 500 });
    expect(result).toHaveLength(1);
    expect(calls).toEqual(["https://first.example", "https://second.example"]);
  });

  it("builds controlled category passes and reports partial coverage at a request budget", async () => {
    const center = { lat: 40, lng: -75 };
    const cells = buildSearchCells(center, 5);
    expect(cells.length).toBeGreaterThan(1);
    expect(buildOverpassQuery(cells[0], "core")).toContain('["shop"]');
    expect(buildOverpassQuery(cells[0], "core")).not.toContain("around:");
    expect(buildOverpassQuery(cells[0], "core")).toContain(String(cells[0].bounds.south));
    expect(buildOverpassQuery(cells[0], "extended")).toContain('["landuse"');
    const provider = new OpenStreetMapPlaceProvider(async () => []);
    const result = await provider.searchNearby({ center, radiusMiles: 5, bounds: boundsForRadius(center, 5), cells, budget: { maxRequests: 1, maxRecords: 500, deadline: Date.now() + 1000 } });
    expect(result.diagnostic.status).toBe("partial");
    expect(result.diagnostic.requestCount).toBe(1);
  });
});
