import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { boundsForRadius, buildSearchCells } from "@/lib/place-provider";
import { buildOverpassQuery, clearOverpassRuntimeForTests, OpenStreetMapPlaceProvider, sequentialOverpassFetch } from "@/lib/openstreetmap";

beforeEach(() => clearOverpassRuntimeForTests());
afterEach(() => delete process.env.OVERPASS_API_URL);

describe("OpenStreetMap provider", () => {
  it("falls back to mirrors sequentially without racing", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
      calls.push(String(url));
      if (String(url).includes("first")) return new Response("no", { status: 503 });
      return Response.json({ elements: [{ type: "node", id: 1, lat: 40, lon: -75, tags: { name: "Repair Shop", shop: "car_repair" } }] });
    }) as typeof fetch;
    const result = await sequentialOverpassFetch("unique sequential query", { endpoints: ["https://first.example", "https://second.example"], retries: 0, fetchImpl, timeoutMs: 2_000 });
    expect(result).toHaveLength(1);
    expect(calls).toEqual(["https://first.example", "https://second.example"]);
  });

  it("keeps known mirrors in reviewed health order despite a stale deploy preference", async () => {
    process.env.OVERPASS_API_URL = "https://overpass.private.coffee/api/interpreter";
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: URL | RequestInfo) => {
      calls.push(String(url));
      return Response.json({ elements: [] });
    }) as typeof fetch;
    await sequentialOverpassFetch("known mirror health order query", { fetchImpl });
    expect(calls[0]).toBe("https://overpass-api.de/api/interpreter");
  });

  it("opens a short circuit for a hanging fallback so later cells do not keep waiting", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      calls.push(String(url));
      if (String(url).includes("primary")) return new Response("busy", { status: 503 });
      if (String(url).includes("hanging")) {
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }
      return Response.json({ elements: [] });
    }) as typeof fetch;

    await sequentialOverpassFetch("hanging mirror first query", {
      endpoints: ["https://primary.example", "https://hanging.example", "https://healthy.example"],
      fetchImpl,
      timeoutMs: 2_000,
    });
    await sequentialOverpassFetch("hanging mirror second query", {
      endpoints: ["https://primary.example", "https://hanging.example", "https://healthy.example"],
      fetchImpl,
      timeoutMs: 2_000,
    });

    expect(calls).toEqual([
      "https://primary.example",
      "https://hanging.example",
      "https://healthy.example",
      "https://primary.example",
      "https://healthy.example",
    ]);
  }, 10_000);

  it("builds controlled category passes and reports partial coverage at a request budget", async () => {
    const center = { lat: 40, lng: -75 };
    const cells = buildSearchCells(center, 5);
    expect(cells.length).toBeGreaterThan(1);
    expect(buildOverpassQuery(cells[0], "core")).toContain("shop|office|craft");
    expect(buildOverpassQuery(cells[0], "core")).not.toContain("around:");
    expect(buildOverpassQuery(cells[0], "core")).toContain("node(");
    expect(buildOverpassQuery(cells[0], "core")).toContain("way(");
    expect(buildOverpassQuery(cells[0], "core")).not.toContain("relation(");
    expect(buildOverpassQuery(cells[0], "core")).toContain(String(cells[0].bounds.south));
    expect(buildOverpassQuery(cells[0], "extended")).toContain('["landuse"');
    const provider = new OpenStreetMapPlaceProvider(async () => []);
    const result = await provider.searchNearby({ center, radiusMiles: 5, bounds: boundsForRadius(center, 5), cells, budget: { maxRequests: 1, maxRecords: 500, deadline: Date.now() + 1000 } });
    expect(result.diagnostic.status).toBe("partial");
    expect(result.diagnostic.requestCount).toBe(1);
  });

  it("runs bounded core overview types before spending budget on extended categories", async () => {
    const center = { lat: 40, lng: -75 };
    const cells = buildSearchCells(center, 5);
    const queries: string[] = [];
    const provider = new OpenStreetMapPlaceProvider(async (query) => {
      queries.push(query);
      return queries.length === 1
        ? Array.from({ length: 450 }, (_, id) => ({ type: "node" as const, id }))
        : [];
    });
    const result = await provider.searchNearby({
      center,
      radiusMiles: 5,
      bounds: boundsForRadius(center, 5),
      cells,
      budget: { maxRequests: 2, maxRecords: 500, deadline: Date.now() + 1000 },
    });
    expect(queries).toHaveLength(2);
    expect(queries.every((query) => query.includes("shop|office|craft"))).toBe(true);
    expect(queries.every((query) => !query.includes('["landuse"'))).toBe(true);
    expect(queries[0]).toContain("node(");
    expect(queries[0]).not.toContain("way(");
    expect(queries[1]).toContain("way(");
    expect(result.completedCellIds).toHaveLength(cells.length);
  });
});
