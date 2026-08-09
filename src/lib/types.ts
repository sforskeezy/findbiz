export type Confidence =
  | "Verified"
  | "Estimated"
  | "Manually entered"
  | "Unavailable"
  | "Potentially stale";

export type OperatingStatus = "Open" | "Temporarily closed" | "Permanently closed" | "Unknown";

export type Coordinates = {
  lat: number;
  lng: number;
};

export type Bounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type PlaceSource = {
  providerId: string;
  providerRecordId: string;
  label: string;
  url: string | null;
  updatedAt: string | null;
  confidence: number | null;
  dataset?: string | null;
};

export type PlaceField =
  | "name"
  | "address"
  | "coordinates"
  | "category"
  | "phone"
  | "website"
  | "brand"
  | "operatingStatus";

export type FieldProvenance = Partial<Record<PlaceField, string[]>>;

export type EligibilityStatus = "eligible" | "excluded" | "unknown";

export type EligibilityReason =
  | "eligible_business"
  | "bank_or_atm"
  | "traditional_school"
  | "apartment_over_nine_units"
  | "apartment_units_unknown"
  | "permanently_closed"
  | "government_only"
  | "configured_enterprise"
  | "insufficient_business_identity";

export type Eligibility = {
  status: EligibilityStatus;
  reason: EligibilityReason;
  label: string;
  ownership: "enterprise" | "unknown";
  policyVersion: string;
};

export type ProspectPriority = "Strong prospect" | "Worth checking" | "Thin evidence" | "Eligibility unknown";
export type DataConfidence = "High" | "Medium" | "Low";

export type ScoreBreakdown = {
  proximity: number;
  industryFit: number;
  operationalDependence: number;
  organizationScale: number;
  broadbandOpportunity: number;
  dataConfidence: number;
};

export type FollowUpEmail = {
  subject: string;
  body: string;
};

export type Prospect = {
  id: string;
  name: string;
  address: string;
  coordinates: Coordinates;
  distanceMiles: number;
  category: string;
  rawCategories: string[];
  phone: string | null;
  website: string | null;
  directoryUrl: string | null;
  hours: string[] | null;
  rating: number | null;
  reviewCount: number | null;
  locationCount: number | null;
  businessSize: string | null;
  brand: string | null;
  apartmentUnits: number | null;
  operatingStatus: OperatingStatus;
  publicNotes: string | null;
  source: string;
  sources: PlaceSource[];
  fieldProvenance: FieldProvenance;
  sourceDate: string;
  retrievedAt: string;
  confidence: Confidence;
  dataConfidence: DataConfidence;
  evidenceCompleteness: number;
  eligibility: Eligibility;
  priority: ProspectPriority;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  scoreRationale: string;
  topOpportunity: string;
  summary: string;
  hypothesizedNeeds: string[];
  discoveryQuestions: string[];
  callOpener: string;
  followUpEmail: FollowUpEmail;
};

export type ProviderStatus = "complete" | "partial" | "unavailable" | "failed" | "disabled";

export type ProviderDiagnostic = {
  providerId: string;
  label: string;
  status: ProviderStatus;
  code: string;
  recordCount: number;
  requestCount: number;
  durationMs: number;
  message: string;
  attributionUrl: string | null;
  setupHint?: string;
};

export type EligibilityCounts = {
  eligible: number;
  unknown: number;
  banks: number;
  schools: number;
  apartmentsOverNine: number;
  apartmentsUnknownUnits: number;
  enterprises: number;
  permanentlyClosed: number;
  government: number;
  insufficientIdentity: number;
};

export type SearchDiagnostics = {
  partialCoverage: boolean;
  rawRecords: number;
  duplicatesMerged: number;
  eligibleProspects: number;
  eligibilityUnknown: number;
  excludedRecords: number;
  requestCount: number;
  durationMs: number;
  cellsPlanned: number;
  cellsCompleted: number;
  sourceContribution: Record<string, number>;
  eligibility: EligibilityCounts;
  providers: ProviderDiagnostic[];
};

export type BroadbandObservation = {
  id: string;
  providerId: string;
  provider: string;
  technologyCode: string;
  technology: string;
  downloadMbps: number | null;
  uploadMbps: number | null;
  classification: "Business" | "Residential" | "Unknown";
  coverageArea: string;
  scope: "exact_location" | "nearby_area";
  matchMethod: "fcc_location_id" | "costquest_full_address" | "h3_res8";
  source: string;
  sourceDate: string;
  datasetVintage: string;
  retrievedAt: string;
  confidence: Confidence;
  note?: string;
};

export type SourceRecord = {
  id: string;
  label: string;
  url: string | null;
  sourceDate: string;
  retrievedAt: string;
  status: Confidence;
};

export type ResearchTarget = {
  inputAddress: string;
  formattedAddress: string;
  coordinates: Coordinates;
  geocodingConfidence: Confidence;
};

export type ResearchResponse = {
  target: ResearchTarget;
  radiusMiles: number;
  prospects: Prospect[];
  eligibilityUnknown: Prospect[];
  broadband: BroadbandObservation[];
  sources: SourceRecord[];
  diagnostics: SearchDiagnostics;
  partialCoverage: boolean;
  retrievedAt: string;
  demoMode: boolean;
  warnings: string[];
};

export type AiBriefResult = {
  summary: string;
  hypothesizedNeeds: string[];
  reflectOn: string[];
  talkAbout: string[];
  topOpportunity: string;
  discoveryQuestions: string[];
  callOpener: string;
  unsupportedClaimsToAvoid: string[];
  followUpEmail: FollowUpEmail;
};

/** FCC-derived public filing context — never provider orderability. */
export type ServiceabilityTier = "reported_exact" | "reported_area" | "not_reported" | "data_unavailable";

/** Rep-owned local note only — never inferred from FCC data. */
export type RepDisposition = "customer" | "do_not_contact";

export type FccMatchQuality = "exact" | "user_supplied_location_id" | "area_h3" | "none";

export type ServiceabilitySignal = {
  tier: ServiceabilityTier;
  providerLabel: string | null;
  asOfDate: string | null;
  matchQuality: FccMatchQuality;
  shortLabel: string;
  detail: string;
  disclaimer: string;
};

export type FccLookupResponse = {
  status: "available" | "not_configured" | "no_report" | "unavailable" | "error";
  observations: BroadbandObservation[];
  message: string;
  sourceUrl: string;
  asOfDate: string | null;
  datasetVintage: string | null;
  matchedLocationId: string | null;
  matchQuality: FccMatchQuality;
  serviceability?: ServiceabilitySignal;
};
