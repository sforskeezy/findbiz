import { readFile } from "node:fs/promises";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DataAttribution } from "@/components/data-attribution";
import { ProspectFit } from "@/components/prospect-fit";
import { ProspectResultRow } from "@/components/prospect-result-row";
import { buildFallbackBrief } from "@/lib/brief-fallback";
import { buildBriefRequest } from "@/lib/brief-schema";
import { buildProspect } from "@/lib/place-candidate";
import { makeCandidate } from "../../tests/helpers";

function prospect() {
  const value = buildProspect(makeCandidate({
    id: "dental",
    name: "Green Valley Dental",
    rawCategories: ["dentist"],
    category: "Medical & dental",
    website: "https://greenvalleydental.example",
    sources: [{ providerId: "openstreetmap", providerRecordId: "node/1", label: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", updatedAt: "2026-08-01", confidence: null }],
  }), { lat: 40, lng: -75 }, "2026-08-09T00:00:00Z");
  return { ...value, score: 54, priority: "Worth checking" as const, dataConfidence: "Medium" as const };
}

describe("prospect-facing UI", () => {
  it("renders one compact prospect-fit score without unavailable broadband state", () => {
    const html = renderToStaticMarkup(<ProspectFit prospect={prospect()} />);
    expect(html).toContain("Prospect fit");
    expect(html).toContain("Worth checking");
    expect(html).toContain("Medium confidence");
    expect(html.match(/54\/100/g)).toHaveLength(1);
    expect(html).toContain('role="progressbar"');
    expect(html).not.toMatch(/heuristic|data unavailable/i);
  });

  it("uses a qualitative result badge and omits source names and numeric score", () => {
    const html = renderToStaticMarkup(<ProspectResultRow prospect={prospect()} index={0} onOpen={() => undefined} />);
    expect(html).toContain("Worth checking");
    expect(html).not.toMatch(/OpenStreetMap|Heuristic|54\/100/i);
  });

  it("keeps required legal attribution accessible outside the prospect card", () => {
    const html = renderToStaticMarkup(<DataAttribution sources={prospect().sources} />);
    expect(html).toContain("Data attribution");
    expect(html).toContain("OpenStreetMap contributors");
  });

  it("keeps backing-source names out of assessment and outreach content", () => {
    const brief = buildFallbackBrief(prospect(), []);
    const text = JSON.stringify(brief);
    expect(text).not.toMatch(/OpenStreetMap|Overture Maps|PAI Places|map contributors/i);
    expect(text).not.toMatch(/currently uses|current provider is|guaranteed service|pricing is/i);
  });

  it("does not build research input for an excluded enterprise", () => {
    const excluded = buildProspect(makeCandidate({ name: "Dollar General #1842", brand: "Dollar General", rawCategories: ["retail"] }), { lat: 40, lng: -75 }, "2026-08-09T00:00:00Z");
    expect(() => buildBriefRequest(excluded, [])).toThrow("eligible prospects");
  });

  it("contains no legacy score label in normal page components", async () => {
    const root = process.cwd();
    const sources = await Promise.all([
      "src/components/business-results-page.tsx",
      "src/components/business-research-page.tsx",
      "src/components/prospect-fit.tsx",
      "src/components/prospect-result-row.tsx",
    ].map((file) => readFile(path.join(root, file), "utf8")));
    expect(sources.join("\n")).not.toMatch(/Research heuristic|Heuristic\s*\{/i);
  });
});
