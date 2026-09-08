import type { Prospect } from "@/lib/types";

export type LiveLeadSignal = import("@/lib/types").LiveLeadSignal;

export const LIVE_RADII = [0.5, 1, 2, 5, 10] as const;
export type LiveRadius = (typeof LIVE_RADII)[number];

export type LiveMemoryKind = "territory" | "preference" | "contacted" | "note";

export type LiveMemoryFact = {
  id: string;
  kind: LiveMemoryKind;
  text: string;
  createdAt: string;
};

export type LiveProspectCard = {
  id: string;
  name: string;
  category: string;
  address: string;
  distanceMiles: number;
  phone: string | null;
  website: string | null;
  score: number;
  why: string;
  source?: string;
  signals?: LiveLeadSignal[];
};

export type LiveChatRole = "user" | "assistant";

export type LiveSource = {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string | null;
};

export type LiveThinkingStep = {
  id: string;
  label: string;
  detail: string | null;
  /** Verbatim model reasoning, when the model produced any for this step. */
  thought?: string | null;
};

export type LiveChatMessage = {
  id: string;
  role: LiveChatRole;
  content: string;
  createdAt: string;
  prospects?: LiveProspectCard[];
  sources?: LiveSource[];
  thinking?: LiveThinkingStep[];
};

export type LiveQueue = {
  locationLabel: string;
  radiusMiles: number;
  category: string | null;
  currentIndex: number;
  prospects: Prospect[];
};

/** Conversational focus from a named lookup or the current list item. Not a fake nearby list. */
export type LiveActiveCompany = {
  name: string;
  location: string | null;
  website: string | null;
  findings: Array<{ title: string; url: string; snippet: string }>;
  prospectId?: string | null;
};

/**
 * A named business Live could not confidently resolve. It keeps the rep's real
 * question alive so a one-word spelling correction continues that research
 * instead of starting a nearby-business search.
 */
export type LivePendingLookup = {
  /** Name as last understood, which may be misspelled. */
  name: string | null;
  location: string | null;
  /** The question still owed an answer, e.g. "who owns this specific location". */
  question: string | null;
  /** The original request, verbatim, so the answer stays on topic. */
  raw: string;
  /** Closest public spelling seen in search results, if any. */
  suggestion: string | null;
  askedAt: string;
};

export type LiveSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: LiveChatMessage[];
  queue: LiveQueue | null;
  /** Last named or listed company “this/them” refers to. Independent of the nearby list. */
  activeCompany?: LiveActiveCompany | null;
  /** Last request Live is still working from, so compound asks survive the list. */
  brief?: import("@/lib/live/intent").LiveBrief | null;
  awaitingLocation?: boolean;
  /** Named lookup awaiting a spelling correction from the rep. */
  pendingLookup?: LivePendingLookup | null;
};

export type LiveSessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
};

/** Enough of the active company for Live Coach. Findings stay off the wire. */
export type LivePublicCompany = {
  name: string;
  location: string | null;
  website: string | null;
  /** Company-specific public trigger (expansion etc.). Never Spectrum construction. */
  publicTrigger: string | null;
};

export type LivePublicState = {
  session: LiveSessionSummary & { messages: LiveChatMessage[] };
  queue: {
    locationLabel: string;
    radiusMiles: number;
    category: string | null;
    currentIndex: number;
    total: number;
    current: LiveProspectCard | null;
    cards: LiveProspectCard[];
  } | null;
  memory: LiveMemoryFact[];
  activeCompany: LivePublicCompany | null;
};

export type LiveChatEvent =
  | { type: "session"; state: LivePublicState }
  | { type: "status"; message: string }
  | { type: "step"; step: LiveThinkingStep }
  | { type: "sources"; sources: LiveSource[] }
  /** One chunk of the answer as the model writes it. */
  | { type: "delta"; text: string }
  /** The model restarted its answer, so drop whatever was streamed so far. */
  | { type: "delta_reset" }
  | { type: "complete"; state: LivePublicState }
  | { type: "error"; error: string };
