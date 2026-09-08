import { describeBrief, type LiveBrief } from "@/lib/live/intent";
import type {
  LiveChatMessage,
  LiveMemoryFact,
  LiveProspectCard,
  LivePublicState,
  LiveSession,
  LiveThinkingStep,
} from "@/lib/live/types";
import type { Prospect } from "@/lib/types";

export type LiveBugQueueCard = {
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
  signals?: Array<{ kind: string; label: string; detail?: string | null }>;
  coordinates?: { lat: number; lng: number };
};

export type LiveBugQueueSnapshot = {
  locationLabel: string;
  radiusMiles: number;
  category: string | null;
  currentIndex: number;
  total: number;
  currentName: string | null;
  cards: LiveBugQueueCard[];
};

export type LiveBugInProgress = {
  status?: string;
  answer?: string;
  steps?: LiveThinkingStep[];
  error?: string;
  notice?: string;
};

export type LiveBugSnapshot = {
  exportedAt: string;
  app?: { url?: string | null; userAgent?: string | null };
  session: {
    id: string;
    title: string;
    createdAt: string | null;
    updatedAt: string;
    awaitingLocation: boolean;
    brief: LiveBrief | null;
  };
  queue: LiveBugQueueSnapshot | null;
  memory: LiveMemoryFact[];
  messages: LiveChatMessage[];
  inProgress?: LiveBugInProgress | null;
};

function asCard(item: Prospect | LiveProspectCard): LiveBugQueueCard {
  const why = "why" in item && item.why ? item.why : "scoreRationale" in item ? item.scoreRationale : "";
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    address: item.address,
    distanceMiles: item.distanceMiles,
    phone: item.phone,
    website: item.website,
    score: item.score,
    why,
    source: item.source,
    signals: item.signals,
    coordinates: "coordinates" in item ? item.coordinates : undefined,
  };
}

export function snapshotFromSession(session: LiveSession, memory: LiveMemoryFact[], exportedAt = new Date().toISOString()): LiveBugSnapshot {
  const cards = session.queue?.prospects.map(asCard) ?? [];
  return {
    exportedAt,
    session: {
      id: session.id,
      title: session.title,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      awaitingLocation: Boolean(session.awaitingLocation),
      brief: session.brief ?? null,
    },
    queue: session.queue
      ? {
          locationLabel: session.queue.locationLabel,
          radiusMiles: session.queue.radiusMiles,
          category: session.queue.category,
          currentIndex: session.queue.currentIndex,
          total: session.queue.prospects.length,
          currentName: cards[session.queue.currentIndex]?.name ?? null,
          cards,
        }
      : null,
    memory,
    messages: session.messages,
  };
}

export function snapshotFromPublicState(input: {
  sessionId: string | null;
  title?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  awaitingLocation?: boolean;
  brief?: LiveBrief | null;
  messages: LiveChatMessage[];
  queue: LivePublicState["queue"];
  memory: LiveMemoryFact[];
  exportedAt?: string;
}): LiveBugSnapshot {
  const cards = input.queue?.cards.map(asCard) ?? [];
  return {
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    session: {
      id: input.sessionId || "unsaved",
      title: input.title?.trim() || "New chat",
      createdAt: input.createdAt ?? null,
      updatedAt: input.updatedAt ?? input.exportedAt ?? new Date().toISOString(),
      awaitingLocation: Boolean(input.awaitingLocation),
      brief: input.brief ?? null,
    },
    queue: input.queue
      ? {
          locationLabel: input.queue.locationLabel,
          radiusMiles: input.queue.radiusMiles,
          category: input.queue.category,
          currentIndex: input.queue.currentIndex,
          total: input.queue.total,
          currentName: input.queue.current?.name ?? cards[input.queue.currentIndex]?.name ?? null,
          cards,
        }
      : null,
    memory: input.memory,
    messages: input.messages,
  };
}

export function hasBugLogContent(snapshot: LiveBugSnapshot) {
  return (
    snapshot.messages.length > 0 ||
    snapshot.queue != null ||
    Boolean(snapshot.inProgress?.answer) ||
    Boolean(snapshot.inProgress?.steps?.length) ||
    Boolean(snapshot.inProgress?.error)
  );
}

export function liveBugFilename(snapshot: Pick<LiveBugSnapshot, "exportedAt" | "session">) {
  const stamp = snapshot.exportedAt.slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const id = snapshot.session.id.replace(/[^a-z0-9_-]/gi, "") || "unsaved";
  return `live-bug-log-${id}-${stamp}.md`;
}

function codeBlock(text: string, language = "") {
  const longest = text.match(/`+/g)?.reduce((max, item) => Math.max(max, item.length), 0) ?? 0;
  const ticks = "`".repeat(Math.max(3, longest + 1));
  return `${ticks}${language}\n${text.replace(/\s+$/, "")}\n${ticks}`;
}

function line(label: string, value: string | number | boolean | null | undefined) {
  if (value == null || value === "") return null;
  return `- ${label}: ${value}`;
}

function formatSignals(signals?: LiveBugQueueCard["signals"]) {
  if (!signals?.length) return "";
  return ` · ${signals.map((item) => item.label).join(", ")}`;
}

function formatQueue(queue: LiveBugQueueSnapshot) {
  const current = queue.cards[queue.currentIndex];
  const head = [
    `Working **${queue.locationLabel}** at ${queue.radiusMiles} mi (${queue.total} ${queue.total === 1 ? "listing" : "listings"}).`,
    current ? `Current: **#${queue.currentIndex + 1} ${current.name}**.` : "No current listing.",
    queue.category ? `Category filter: ${queue.category}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const rows = queue.cards.map((card, index) => {
    const mark = index === queue.currentIndex ? " ← current" : "";
    const contact = card.phone || card.website || "no public phone";
    const coords = card.coordinates ? ` · ${card.coordinates.lat.toFixed(5)}, ${card.coordinates.lng.toFixed(5)}` : "";
    return `${index + 1}. **${card.name}** — ${card.category} · ${card.address} · ${card.distanceMiles.toFixed(2)} mi · ${contact} · score ${card.score}${formatSignals(card.signals)}${coords}${mark}`;
  });
  return `${head}\n\n${rows.join("\n") || "(empty list)"}`;
}

function formatBrief(brief: LiveBrief) {
  return [
    line("Raw", brief.raw),
    line("Location", brief.locationHint),
    line("Search terms", brief.searchTerms.join(", ")),
    line("Target name", brief.targetName),
    line("Requested count", brief.requestedCount),
    line("Profile", brief.profile),
    line("Category", brief.categoryHint),
    line("Exclude national", brief.excludeNational),
    line("Asked for chains", brief.askedForChains),
    line("Wants research", brief.wantsResearch),
    line("Wants news", brief.wantsNews),
    line("Wants genuine-check", brief.wantsGenuineCheck),
    line("Wants competitors", brief.wantsCompetitors),
    line("Wants web", brief.wantsWeb),
    line("Web queries", brief.webQueries.join("; ")),
    line("Summary", describeBrief(brief)),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatThinking(steps: LiveThinkingStep[]) {
  return steps
    .map((step, index) => {
      const parts = [`${index + 1}. ${step.label}`];
      if (step.detail) parts.push(`   detail: ${step.detail}`);
      if (step.thought?.trim()) parts.push(`   thought: ${step.thought.trim()}`);
      return parts.join("\n");
    })
    .join("\n");
}

function formatMessage(message: LiveChatMessage, index: number) {
  const who = message.role === "user" ? "User" : "Live";
  const blocks = [`### ${index + 1}. ${who} · ${message.createdAt} · \`${message.id}\``];
  blocks.push(codeBlock(message.content || "(empty)"));
  if (message.thinking?.length) {
    blocks.push("Thinking trace:");
    blocks.push(codeBlock(formatThinking(message.thinking)));
  }
  if (message.sources?.length) {
    const sources = message.sources
      .map((source) => `- [${source.title}](${source.url}) · ${source.domain}${source.snippet ? ` — ${source.snippet}` : ""}`)
      .join("\n");
    blocks.push("Sources:\n" + sources);
  }
  if (message.prospects?.length) {
    const prospects = message.prospects
      .map((card, cardIndex) => `${cardIndex + 1}. **${card.name}** — ${card.category} · ${card.address} · ${card.phone || "no public phone"}`)
      .join("\n");
    blocks.push("Attached listings:\n" + prospects);
  }
  return blocks.join("\n\n");
}

function formatInProgress(progress: LiveBugInProgress) {
  const parts = ["## In progress (not saved yet)"];
  if (progress.status) parts.push(`- Status: ${progress.status}`);
  if (progress.error) parts.push(`- Error: ${progress.error}`);
  if (progress.notice) parts.push(`- Notice: ${progress.notice}`);
  if (progress.steps?.length) {
    parts.push("");
    parts.push("Partial thinking:");
    parts.push(codeBlock(formatThinking(progress.steps)));
  }
  if (progress.answer?.trim()) {
    parts.push("");
    parts.push("Partial answer:");
    parts.push(codeBlock(progress.answer));
  }
  return parts.join("\n");
}

export function formatLiveBugLog(snapshot: LiveBugSnapshot) {
  const userTurns = snapshot.messages.filter((item) => item.role === "user");
  const replay = userTurns.length
    ? userTurns.map((item, index) => `${index + 1}. ${item.content.replace(/\s+/g, " ").trim()}`).join("\n")
    : "(no user turns yet)";

  const sections = [
    "# ProspectIQ Live — bug log",
    "Replay the **User** turns in order. Thinking traces, sources, and session state are what Live actually did — not what it should have done.",
    [
      line("Exported", snapshot.exportedAt),
      line("Page", snapshot.app?.url),
      line("Session", `\`${snapshot.session.id}\` · ${snapshot.session.title}`),
      line("Created", snapshot.session.createdAt),
      line("Updated", snapshot.session.updatedAt),
      line("Awaiting location", snapshot.session.awaitingLocation ? "yes" : "no"),
      line("Client", snapshot.app?.userAgent),
    ]
      .filter(Boolean)
      .join("\n"),
    "## Replay these user turns",
    replay,
  ];

  if (snapshot.session.brief) {
    sections.push("## Active brief", formatBrief(snapshot.session.brief));
  }

  if (snapshot.queue) {
    sections.push("## Current list", formatQueue(snapshot.queue));
  } else {
    sections.push("## Current list", "No list on this session.");
  }

  if (snapshot.memory.length) {
    sections.push(
      "## Remembered facts",
      snapshot.memory.map((item) => `- (${item.kind}) ${item.text}`).join("\n"),
    );
  }

  if (snapshot.inProgress && (snapshot.inProgress.answer || snapshot.inProgress.steps?.length || snapshot.inProgress.error || snapshot.inProgress.status)) {
    sections.push(formatInProgress(snapshot.inProgress));
  }

  sections.push(
    "## Transcript",
    snapshot.messages.length
      ? snapshot.messages.map((message, index) => formatMessage(message, index)).join("\n\n")
      : "(no saved messages)",
  );

  const machine = {
    exportedAt: snapshot.exportedAt,
    app: snapshot.app ?? null,
    session: snapshot.session,
    queue: snapshot.queue,
    memory: snapshot.memory,
    messages: snapshot.messages,
    inProgress: snapshot.inProgress ?? null,
  };
  sections.push("## Machine snapshot", codeBlock(JSON.stringify(machine, null, 2), "json"));

  return `${sections.join("\n\n").trim()}\n`;
}
