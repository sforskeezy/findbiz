import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearRateLimitsForTests } from "@/lib/api-safety";
import { PlaceSearchUnavailableError } from "@/lib/place-search";
import type { SearchDiagnostics } from "@/lib/types";

const mocks = vi.hoisted(() => ({ paiNearby: vi.fn(), researchWithPaiPlaces: vi.fn() }));

vi.mock("@/lib/pai-places", () => ({
  PAI_PLACES_LABEL: "PAI Places",
  paiNearby: mocks.paiNearby,
  researchWithPaiPlaces: mocks.researchWithPaiPlaces,
}));

import { POST as nearbyPost } from "@/app/api/places/nearby/route";
import { POST as researchPost } from "@/app/api/research/route";

const diagnostics: SearchDiagnostics = {
  partialCoverage: false,
  rawRecords: 0,
  duplicatesMerged: 0,
  eligibleProspects: 0,
  eligibilityUnknown: 0,
  excludedRecords: 0,
  requestCount: 1,
  durationMs: 10,
  cellsPlanned: 1,
  cellsCompleted: 0,
  sourceContribution: {},
  eligibility: { eligible: 0, unknown: 0, banks: 0, schools: 0, apartmentsOverNine: 0, apartmentsUnknownUnits: 0, enterprises: 0, permanentlyClosed: 0, government: 0, insufficientIdentity: 0 },
  providers: [{ providerId: "fixture", label: "fixture", status: "failed", code: "PROVIDER_TIMEOUT", recordCount: 0, requestCount: 1, durationMs: 10, message: "timeout", attributionUrl: null }],
};

function request() {
  return new Request("http://localhost/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: "100 Public Square, Public City, PA 19000", radiusMiles: 3 }),
  });
}

beforeEach(() => {
  clearRateLimitsForTests();
  mocks.paiNearby.mockReset();
  mocks.researchWithPaiPlaces.mockReset();
});

describe("PAI Places endpoint contracts", () => {
  it("keeps the nearby endpoint contract stable", async () => {
    mocks.paiNearby.mockResolvedValue({
      target: { formattedAddress: "100 Public Square, Public City, PA 19000", coordinates: { lat: 40, lng: -75 }, confidence: "Verified", provider: "census" },
      radiusMiles: 3,
      prospects: [],
      eligibilityUnknown: [],
      diagnostics,
      retrievedAt: "2026-08-09T00:00:00.000Z",
    });
    const response = await nearbyPost(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ provider: "pai_places", radiusMiles: 3, count: 0, places: [], partialCoverage: false });
  });

  it.each([
    ["nearby", nearbyPost, mocks.paiNearby],
    ["research", researchPost, mocks.researchWithPaiPlaces],
  ] as const)("returns retryable 503 for complete %s provider failure", async (_name, handler, mock) => {
    mock.mockRejectedValue(new PlaceSearchUnavailableError(diagnostics));
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("retry-after")).toBe("5");
    await expect(response.json()).resolves.toMatchObject({ code: "PLACES_PROVIDER_UNAVAILABLE", retryable: true });
  });
});
