import { describe, expect, it } from "vitest";

import { classifyEligibility } from "@/lib/eligibility";
import { searchPlaces } from "@/lib/place-search";
import { buildProspect, normalizeCategory } from "@/lib/place-candidate";
import { makeCandidate, StubProvider } from "../../tests/helpers";

describe("business eligibility", () => {
  it.each([
    ["bank", "Friendly Financial Center", "bank_or_atm"],
    ["credit_union", "Community Financial Center", "bank_or_atm"],
    ["atm", "Quick Cash", "bank_or_atm"],
    ["high_school", "Lincoln Campus", "traditional_school"],
    ["kindergarten", "Lincoln Early Learning", "traditional_school"],
  ])("excludes structured %s categories without relying on the name", (category, name, reason) => {
    const result = classifyEligibility(makeCandidate({ name, rawCategories: [category], category: normalizeCategory(category) }));
    expect(result).toMatchObject({ status: "excluded", reason });
  });

  it("handles apartment units without guessing", () => {
    const base = { name: "Park View", rawCategories: ["apartment_complex"], category: "Property management" };
    expect(classifyEligibility(makeCandidate({ ...base, apartmentUnits: null }))).toMatchObject({ status: "excluded", reason: "apartment_units_unknown" });
    expect(classifyEligibility(makeCandidate({ ...base, apartmentUnits: 10 }))).toMatchObject({ status: "excluded", reason: "apartment_over_nine_units" });
    expect(classifyEligibility(makeCandidate({ ...base, apartmentUnits: 9 }))).toMatchObject({ status: "eligible" });
  });

  it("suppresses configured enterprises and closed businesses", () => {
    expect(classifyEligibility(makeCandidate({ name: "Walmart", brand: "Walmart", rawCategories: ["department_store"] }))).toMatchObject({ status: "excluded", reason: "configured_enterprise" });
    expect(classifyEligibility(makeCandidate({ operatingStatus: "Permanently closed" }))).toMatchObject({ status: "excluded", reason: "permanently_closed" });
  });

  it.each([
    ["Dollar General #1842", "Dollar General", null],
    ["Sam's Club 6120", "Sam's Club", null],
    ["Local-looking Store", null, "https://stores.dollartree.com/pa/public-city"],
    ["Whole Foods Market", "Whole Foods Market", null],
    ["Tractor Supply Co", "Tractor Supply Company", null],
    ["Harbor Freight Tools", "Harbor Freight Tools", null],
  ])("excludes enterprise aliases and domains for %s", (name, brand, website) => {
    expect(classifyEligibility(makeCandidate({ name, brand, website, rawCategories: ["retail"] }))).toMatchObject({ status: "excluded", reason: "configured_enterprise" });
  });

  it("excludes government facilities and retains eligible local businesses", () => {
    expect(classifyEligibility(makeCandidate({ name: "Public City Hall", rawCategories: ["city_hall"] }))).toMatchObject({ status: "excluded", reason: "government_only" });
    expect(classifyEligibility(makeCandidate({ name: "Green Valley Dental", rawCategories: ["dentist"] }))).toMatchObject({ status: "eligible" });
  });

  it("keeps franchise ownership uncertain instead of excluding by brand alone", () => {
    expect(classifyEligibility(makeCandidate({ name: "McDonald's", brand: "McDonald's", rawCategories: ["restaurant"] }))).toMatchObject({ status: "eligible" });
  });

  it("reports anonymous exclusion diagnostics while returning only eligible prospects", async () => {
    const places = [
      makeCandidate({ id: "eligible", name: "Local Repair", rawCategories: ["repair"] }),
      makeCandidate({ id: "bank", name: "Friendly Center", rawCategories: ["bank"] }),
      makeCandidate({ id: "school", name: "Lincoln Campus", rawCategories: ["school"] }),
      makeCandidate({ id: "apartment", name: "Park View", rawCategories: ["apartment_complex"], apartmentUnits: null }),
    ];
    const result = await searchPlaces({ lat: 40, lng: -75 }, 1, { providers: [new StubProvider("fixture", places)], useCache: false });
    expect(result.prospects.map((item) => item.id)).toEqual(["eligible"]);
    expect(result.eligibilityUnknown).toHaveLength(0);
    expect(result.diagnostics.eligibility).toMatchObject({ eligible: 1, banks: 1, schools: 1, apartmentsUnknownUnits: 1 });
  });

  it("never returns Dollar General in the eligible prospect list", async () => {
    const result = await searchPlaces({ lat: 40, lng: -75 }, 1, {
      providers: [new StubProvider("fixture", [
        makeCandidate({ id: "local", name: "Green Valley Dental", rawCategories: ["dentist"] }),
        makeCandidate({ id: "enterprise", name: "Dollar General #1842", brand: "Dollar General", rawCategories: ["retail"] }),
      ])],
      useCache: false,
    });
    expect(result.prospects.map((prospect) => prospect.name)).toEqual(["Green Valley Dental"]);
    expect(result.diagnostics.eligibility.enterprises).toBe(1);
  });
});

describe("ranking dimensions", () => {
  it("defaults unknown categories to Other/Unknown and keeps ranking dimensions separate", () => {
    const candidate = makeCandidate({ category: normalizeCategory("mystery widget"), rawCategories: ["mystery_widget"], phone: "+15550102000", website: "https://fixture.example", sources: [
      { providerId: "overture", providerRecordId: "1", label: "Overture", url: null, updatedAt: null, confidence: 0.9 },
      { providerId: "openstreetmap", providerRecordId: "node/1", label: "OSM", url: null, updatedAt: null, confidence: null },
    ], sourceConfidence: 0.9 });
    const prospect = buildProspect(candidate, { lat: 40, lng: -75 }, new Date().toISOString());
    expect(prospect.category).toBe("Other/Unknown");
    expect(prospect.dataConfidence).toBe("High");
    expect(prospect.distanceMiles).toBe(0);
    expect(prospect.eligibility.status).toBe("eligible");
    expect(prospect.scoreRationale).toContain("not a probability of sale");
  });
});
