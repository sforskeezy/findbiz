import { describe, expect, it } from "vitest";

import { candidatesRepresentSameBusiness, dedupeCandidates } from "@/lib/place-candidate";
import { makeCandidate } from "../../tests/helpers";

describe("cross-source deduplication", () => {
  it("merges strong duplicates and preserves all sources and field provenance", () => {
    const overture = makeCandidate({ id: "overture-1", name: "Oak Street Bakery LLC", phone: "+1 555 010 2000", sourceConfidence: 0.9, sources: [{ providerId: "overture", providerRecordId: "1", label: "Overture", url: null, updatedAt: "2026-07-01", confidence: 0.9 }], fieldProvenance: { name: ["overture"], phone: ["overture"] } });
    const osm = makeCandidate({ id: "osm-1", name: "Oak Street Bakery", phone: "(555) 010-2000", coordinates: { lat: 40.0001, lng: -75 }, sources: [{ providerId: "openstreetmap", providerRecordId: "node/1", label: "OSM", url: null, updatedAt: null, confidence: null }], fieldProvenance: { name: ["openstreetmap"], phone: ["openstreetmap"] } });
    const merged = dedupeCandidates([overture, osm]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sources.map((source) => source.providerId)).toEqual(["overture", "openstreetmap"]);
    expect(merged[0].fieldProvenance.name).toEqual(["overture", "openstreetmap"]);
  });

  it("does not merge separate branches or conflicting suites", () => {
    const branchA = makeCandidate({ name: "Pine Auto Repair", coordinates: { lat: 40, lng: -75 } });
    const branchB = makeCandidate({ id: "fixture-2", name: "Pine Auto Repair", coordinates: { lat: 40.01, lng: -75 } });
    const suiteA = makeCandidate({ name: "Civic Tax", address: "100 Main St Suite 1, Public City, PA" });
    const suiteB = makeCandidate({ id: "fixture-3", name: "Civic Tax", address: "100 Main St Suite 2, Public City, PA", coordinates: { lat: 40.00001, lng: -75 } });
    expect(candidatesRepresentSameBusiness(branchA, branchB)).toBe(false);
    expect(candidatesRepresentSameBusiness(suiteA, suiteB)).toBe(false);
    expect(dedupeCandidates([branchA, branchB])).toHaveLength(2);
  });
});
