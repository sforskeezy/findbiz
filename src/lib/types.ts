export type Confidence =
  | "Verified"
  | "Estimated"
  | "Manually entered"
  | "Unavailable"
  | "Potentially stale";

export type OperatingStatus = "Open" | "Temporarily closed" | "Unknown";

export type Coordinates = {
  lat: number;
  lng: number;
};

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
  phone: string | null;
  website: string | null;
  directoryUrl: string | null;
  hours: string[] | null;
  rating: number | null;
  reviewCount: number | null;
  locationCount: number | null;
  businessSize: string | null;
  operatingStatus: OperatingStatus;
  publicNotes: string | null;
  source: string;
  sourceDate: string;
  retrievedAt: string;
  confidence: Confidence;
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

export type BroadbandObservation = {
  id: string;
  provider: string;
  technology: string;
  downloadMbps: number | null;
  uploadMbps: number | null;
  classification: "Business" | "Residential" | "Unknown";
  coverageArea: string;
  source: string;
  sourceDate: string;
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
  broadband: BroadbandObservation[];
  sources: SourceRecord[];
  retrievedAt: string;
  demoMode: boolean;
  warnings: string[];
};

export type SearchHistoryItem = {
  id: string;
  address: string;
  radiusMiles: number;
  resultCount: number;
  createdAt: string;
  demoMode: boolean;
};

export type AiBriefResult = {
  summary: string;
  hypothesizedNeeds: string[];
  /** Prep reflections for the rep before dialing. */
  reflectOn: string[];
  /** Concrete mid-call talking points. */
  talkAbout: string[];
  topOpportunity: string;
  discoveryQuestions: string[];
  callOpener: string;
  followUpEmail: FollowUpEmail;
};

/** FCC-derived Charter/Spectrum signal — not Spectrum orderability. */
export type ServiceabilityTier = "reported_exact" | "reported_area" | "not_reported";

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
  status: "available" | "not_configured" | "no_exact_match" | "unavailable" | "error";
  observations: BroadbandObservation[];
  message: string;
  sourceUrl: string;
  asOfDate: string | null;
  matchedLocationId: string | null;
  matchQuality: FccMatchQuality;
  serviceability?: ServiceabilitySignal;
};
