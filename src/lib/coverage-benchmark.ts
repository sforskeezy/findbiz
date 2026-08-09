import type { PlaceProvider, PlaceSearchRequest, PlaceSearchResult } from "@/lib/place-provider";
import { searchPlaces } from "@/lib/place-search";
import { normalizeCategory, type PlaceCandidate } from "@/lib/place-candidate";

type FixturePlace = {
  id: string;
  name: string;
  category: string;
  offset: number;
  address?: boolean;
  phone?: boolean;
  website?: boolean;
  brand?: string;
  units?: number | null;
  status?: PlaceCandidate["operatingStatus"];
};

type Scenario = {
  name: "Downtown" | "Suburban" | "Industrial" | "Rural";
  osm: FixturePlace[];
  overture: FixturePlace[];
};

const sharedOsm: FixturePlace[] = [
  { id: "bakery-osm", name: "Oak Street Bakery", category: "bakery", offset: 0.001, address: true, phone: true },
  { id: "dental-osm", name: "Civic Dental Studio", category: "dentist", offset: 0.002, address: true, website: true },
];

export const COVERAGE_SCENARIOS: Scenario[] = [
  {
    name: "Downtown",
    osm: [...sharedOsm, { id: "bank-osm", name: "Metro Bank", category: "bank", offset: 0.003, address: true }, { id: "cafe-osm", name: "Corner Cup", category: "cafe", offset: 0.004 }],
    overture: [
      { id: "bakery-ov", name: "Oak Street Bakery LLC", category: "bakery", offset: 0.00101, address: true, phone: true, website: true },
      { id: "dental-ov", name: "Civic Dental Studio", category: "dentist", offset: 0.00201, address: true, website: true },
      { id: "law", name: "Hale & Finch Law", category: "lawyer", offset: 0.0035, address: true, phone: true, website: true },
      { id: "salon", name: "Juniper Salon", category: "beauty_salon", offset: 0.0045, address: true, phone: true },
      { id: "walmart", name: "Walmart", category: "department_store", offset: 0.005, address: true, brand: "Walmart" },
    ],
  },
  {
    name: "Suburban",
    osm: [{ id: "auto-osm", name: "Pine Auto Repair", category: "car_repair", offset: 0.002, address: true }],
    overture: [
      { id: "auto-ov", name: "Pine Auto Repair", category: "car_repair", offset: 0.00201, address: true, phone: true },
      { id: "vet", name: "Meadow Veterinary Clinic", category: "veterinary", offset: 0.005, address: true, phone: true, website: true },
      { id: "hvac", name: "Clear Air HVAC", category: "hvac_contractor", offset: 0.006, address: true, website: true },
      { id: "apartments", name: "Park View Apartments", category: "apartment_complex", offset: 0.007, address: true, units: null },
    ],
  },
  {
    name: "Industrial",
    osm: [{ id: "warehouse-osm", name: "Delta Distribution", category: "warehouse", offset: 0.003, address: true }],
    overture: [
      { id: "warehouse-ov", name: "Delta Distribution", category: "warehouse", offset: 0.00301, address: true, phone: true, website: true },
      { id: "machine", name: "Apex Machine Works", category: "machine_shop", offset: 0.008, address: true, phone: true },
      { id: "freight", name: "Northline Freight", category: "freight", offset: 0.01, address: true, website: true },
      { id: "amazon", name: "Amazon Delivery Station", category: "warehouse", offset: 0.012, address: true, brand: "Amazon" },
    ],
  },
  {
    name: "Rural",
    osm: [],
    overture: [
      { id: "farm", name: "Cedar Ridge Farm Market", category: "farm", offset: 0.01, address: true, phone: true },
      { id: "equine", name: "Willow Creek Equine", category: "horse_riding", offset: 0.014, address: true, website: true },
      { id: "repair", name: "County Line Equipment Repair", category: "repair", offset: 0.018, phone: true },
      { id: "closed", name: "Old Mill Supply", category: "hardware_store", offset: 0.02, status: "Permanently closed" },
    ],
  },
];

function candidate(fixture: FixturePlace, providerId: string): PlaceCandidate {
  const label = providerId === "overture" ? "Overture Maps Foundation" : "OpenStreetMap contributors";
  const address = fixture.address ? `${100 + Math.round(fixture.offset * 10_000)} Commerce St, Public City, PA 19000` : null;
  return {
    id: `${providerId}-${fixture.id}`,
    name: fixture.name,
    address,
    coordinates: { lat: 40 + fixture.offset, lng: -75 },
    category: normalizeCategory(fixture.category),
    rawCategories: [fixture.category],
    phone: fixture.phone ? "+1 555 010 2000" : null,
    website: fixture.website ? `https://${fixture.id}.example` : null,
    directoryUrl: null,
    hours: null,
    rating: null,
    reviewCount: null,
    brand: fixture.brand ?? null,
    apartmentUnits: fixture.units ?? null,
    operatingStatus: fixture.status ?? "Open",
    publicNotes: null,
    sources: [{ providerId, providerRecordId: fixture.id, label, url: null, updatedAt: "2026-07-01", confidence: providerId === "overture" ? 0.9 : null }],
    fieldProvenance: { name: [providerId], address: address ? [providerId] : [], coordinates: [providerId], category: [providerId] },
    sourceDate: "2026-07-01",
    confidence: providerId === "overture" ? "Verified" : "Estimated",
    sourceConfidence: providerId === "overture" ? 0.9 : null,
  };
}

class FixtureProvider implements PlaceProvider {
  constructor(readonly id: string, private readonly fixtures: FixturePlace[]) {}
  async searchNearby(request: PlaceSearchRequest): Promise<PlaceSearchResult> {
    const places = this.fixtures.map((item) => candidate(item, this.id));
    return {
      providerId: this.id,
      places,
      completedCellIds: request.cells.map((cell) => cell.id),
      diagnostic: { providerId: this.id, label: this.id, status: "complete", code: "FIXTURE_COMPLETE", recordCount: places.length, requestCount: 1, durationMs: 0, message: "Synthetic fixture completed.", attributionUrl: null },
    };
  }
}

export type CoverageMetric = {
  scenario: string;
  mode: "OSM only" | "PAI Places combined";
  rawRecords: number;
  eligibleBusinesses: number;
  duplicatesMerged: number;
  excluded: number;
  eligibilityUnknown: number;
  exclusionCounts: Record<string, number>;
  completeAddresses: number;
  phoneOrWebsite: number;
  sourceContribution: Record<string, number>;
  partial: boolean;
  requestCount: number;
  durationMs: number;
};

export async function runCoverageBenchmark(): Promise<CoverageMetric[]> {
  const metrics: CoverageMetric[] = [];
  for (const scenario of COVERAGE_SCENARIOS) {
    for (const mode of ["OSM only", "PAI Places combined"] as const) {
      const providers: PlaceProvider[] = mode === "OSM only"
        ? [new FixtureProvider("openstreetmap", scenario.osm)]
        : [new FixtureProvider("overture", scenario.overture), new FixtureProvider("openstreetmap", scenario.osm)];
      const result = await searchPlaces({ lat: 40, lng: -75 }, 5, { providers, useCache: false });
      metrics.push({
        scenario: scenario.name,
        mode,
        rawRecords: result.diagnostics.rawRecords,
        eligibleBusinesses: result.prospects.length,
        duplicatesMerged: result.diagnostics.duplicatesMerged,
        excluded: result.diagnostics.excludedRecords,
        eligibilityUnknown: result.eligibilityUnknown.length,
        exclusionCounts: {
          banks: result.diagnostics.eligibility.banks,
          schools: result.diagnostics.eligibility.schools,
          apartmentsOverNine: result.diagnostics.eligibility.apartmentsOverNine,
          apartmentsUnknownUnits: result.diagnostics.eligibility.apartmentsUnknownUnits,
          enterprises: result.diagnostics.eligibility.enterprises,
          permanentlyClosed: result.diagnostics.eligibility.permanentlyClosed,
        },
        completeAddresses: result.prospects.filter((item) => !item.address.startsWith("Address not listed")).length,
        phoneOrWebsite: result.prospects.filter((item) => item.phone || item.website).length,
        sourceContribution: result.diagnostics.sourceContribution,
        partial: result.diagnostics.partialCoverage,
        requestCount: result.diagnostics.requestCount,
        durationMs: result.diagnostics.durationMs,
      });
    }
  }
  return metrics;
}
