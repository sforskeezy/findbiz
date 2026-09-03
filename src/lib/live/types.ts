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

export type LiveSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: LiveChatMessage[];
  queue: LiveQueue | null;
  /** Last request Live is still working from, so compound asks survive the list. */
  brief?: import("@/lib/live/intent").LiveBrief | null;
};

export type LiveSessionSummary = {
  id: string;
  title: string;
  updatedAt: string;
  preview: string;
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
};

export type LiveChatEvent =
  | { type: "status"; message: string }
  | { type: "step"; step: LiveThinkingStep }
  | { type: "sources"; sources: LiveSource[] }
  /** One chunk of the answer as the model writes it. */
  | { type: "delta"; text: string }
  /** The model restarted its answer, so drop whatever was streamed so far. */
  | { type: "delta_reset" }
  | { type: "complete"; state: LivePublicState }
  | { type: "error"; error: string };
