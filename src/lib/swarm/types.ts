import type { CompanyIntelligence, Coordinates, FccLookupResponse, Prospect } from "@/lib/types";
export type SwarmAddress = { id: string; text: string; status: "pending" | "scanning" | "complete" | "error"; coordinates: Coordinates | null; discovered: number; error: string | null };
export type SwarmProspect = {
  id: string; business: Prospect; sourceAddressIds: string[]; clusterId: string;
  opportunity: "high" | "review" | "contact_needed"; rank: number; reasons: string[];
  broadband: FccLookupResponse | null; broadbandChecked: boolean;
  intelligence: CompanyIntelligence | null; researchStatus: "listing" | "queued" | "researching" | "complete" | "partial";
  error: string | null; firstSeenAt: string; updatedAt: string;
};
export type SwarmBatch = {
  id: string; title: string; createdAt: string; updatedAt: string;
  status: "queued" | "scanning" | "qualifying" | "researching" | "complete" | "paused" | "error";
  radiusMiles: number; addresses: SwarmAddress[]; prospects: SwarmProspect[];
  lease: string | null; leaseUntil: string | null; warnings: string[];
};
export type SwarmSummary = Pick<SwarmBatch, "id" | "title" | "createdAt" | "updatedAt" | "status"> & { addresses: number; prospects: number };
export type SwarmResponse = { batch: SwarmBatch | null; batches: SwarmSummary[]; persistent: boolean; error?: string };
