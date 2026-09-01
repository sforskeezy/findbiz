import type { Confidence, Coordinates, OperatingStatus, Prospect } from "@/lib/types";

export const RADAR_RADII = [1, 2, 5, 10, 15] as const;
export type RadarRadius = (typeof RADAR_RADII)[number];

export const SIGNAL_TYPES = [
  "new_business",
  "new_location",
  "moved",
  "coming_soon",
  "address_changed",
  "new_website",
  "website_changed",
  "phone_added",
  "expanding",
  "hiring",
  "grand_opening",
  "renovation",
  "new_ownership",
  "newly_registered",
  "reopened",
  "multiple_locations",
  "newly_active_online",
  "possible_new_listing",
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];
export type SignalSeverity = "hot" | "active" | "watch";
export type DatePrecision = "exact" | "approximate" | "relative" | "unknown";

export type RadarTerritory = {
  id: string;
  label: string;
  locationQuery: string;
  formattedAddress: string;
  coordinates: Coordinates;
  radiusMiles: number;
  categoryFilter: string | null;
  createdAt: string;
  lastScannedAt: string | null;
};

export type BusinessObservation = {
  key: string;
  companyKey: string;
  prospectId: string;
  name: string;
  address: string;
  coordinates: Coordinates;
  distanceMiles: number;
  category: string;
  phone: string | null;
  website: string | null;
  directoryUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  operatingStatus: OperatingStatus;
  source: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

export type SignalEvidence = {
  id: string;
  label: string;
  snippet: string | null;
  url: string | null;
  sourceLabel: string;
  observedAt: string;
  confidence: Confidence;
};

export type RadarScore = {
  total: number;
  recency: number;
  corroboration: number;
  significance: number;
  evidenceQuality: number;
  relevance: number;
};

export type TimelineEvent = {
  id: string;
  at: string;
  label: string;
  signalType: SignalType;
  summary: string;
};

export type RadarSignal = {
  id: string;
  territoryId: string;
  businessKey: string;
  companyKey: string;
  type: SignalType;
  severity: SignalSeverity;
  verified: boolean;
  title: string;
  headline: string;
  why: string[];
  recencyLabel: string;
  occurredAt: string | null;
  datePrecision: DatePrecision;
  firstDetectedAt: string;
  lastDetectedAt: string;
  newSinceLastScan: boolean;
  score: RadarScore;
  evidence: SignalEvidence[];
  timeline: TimelineEvent[];
  observation: BusinessObservation;
  prospect: Prospect;
  saved: boolean;
  dismissed: boolean;
  contacted: boolean;
};

export type RadarDelta = {
  previousScannedAt: string | null;
  totalChanges: number;
  hot: number;
  active: number;
  watch: number;
  newBusinesses: number;
  addressChanges: number;
  newLocations: number;
  hiring: number;
  websiteChanges: number;
  newHighConfidence: number;
};

export type RadarBrief = {
  territoryLabel: string;
  radiusMiles: number;
  summary: string;
  generatedBy: "deterministic" | "groq";
  model: string | null;
};

export type RadarScanResult = {
  id: string;
  territory: RadarTerritory;
  scannedAt: string;
  firstScan: boolean;
  observationsCount: number;
  enrichedCount: number;
  delta: RadarDelta;
  brief: RadarBrief;
  signals: RadarSignal[];
  warnings: string[];
};

export type RadarScanStage =
  | "scanning"
  | "discovering"
  | "comparing"
  | "web"
  | "expansion"
  | "hiring"
  | "evidence"
  | "ranking"
  | "complete";

export type RadarScanEvent =
  | { type: "stage"; stage: RadarScanStage; message: string }
  | { type: "complete"; result: RadarScanResult }
  | { type: "error"; error: string };

export type RadarSignalAction = "save" | "unsave" | "dismiss" | "restore" | "contacted" | "uncontacted";

export type RadarFilters = {
  signalType: SignalType | "all";
  severity: SignalSeverity | "all";
  industry: string | "all";
  minConfidence: number;
  maxDistance: number | null;
  newSinceLastScan: boolean;
  saved: "all" | "saved" | "unsaved";
  hasPhone: boolean;
  hasWebsite: boolean;
  worthContacting: boolean;
};

export type TerritorySnapshot = {
  territoryId: string;
  scannedAt: string;
  scanId: string;
  observations: BusinessObservation[];
  signals: Array<Pick<RadarSignal, "id" | "businessKey" | "type" | "evidence" | "firstDetectedAt" | "saved" | "dismissed" | "contacted">>;
};
