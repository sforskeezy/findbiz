import {
  createSession,
  forgetFact,
  liveId,
  loadMemory,
  loadSession,
  rememberFact,
  saveSession,
  sessionSummary,
} from "@/lib/live/store";
import {
  checkBroadband,
  checkBroadbandAcrossQueue,
  compactProspect,
  currentProspect,
  dedupeSources,
  findBusinesses,
  liveSearchDetail,
  refineQueue,
  researchProspect,
  skipQueue,
  toSource,
  webLookup,
} from "@/lib/live/tools";
import type {
  LiveChatEvent,
  LiveChatMessage,
  LiveMemoryFact,
  LiveProspectCard,
  LivePublicState,
  LiveQueue,
  LiveSession,
  LiveSource,
  LiveThinkingStep,
} from "@/lib/live/types";

/** Collects the narration and citations for one turn so the UI can replay them. */
type TurnTrace = {
  steps: LiveThinkingStep[];
  sources: LiveSource[];
  searched: boolean;
  emit: (event: LiveChatEvent) => Promise<void>;
};

async function trackStep(
  trace: TurnTrace,
  label: string,
  detail: string | null = null,
  thought: string | null = null,
) {
  const step: LiveThinkingStep = { id: liveId("step"), label, detail, thought };
  trace.steps.push(step);
  await trace.emit({ type: "step", step });
  await trace.emit({ type: "status", message: label });
}

const PHONE_IN_TEXT = /(?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]\d{4}/g;

function phoneDigits(value: string) {
  return value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

function collectGroundedPhones(payload: string, into: Set<string>) {
  for (const match of payload.match(PHONE_IN_TEXT) ?? []) {
    const digits = phoneDigits(match);
    if (digits.length === 10) into.add(digits);
  }
}

/**
 * The model is told never to invent a phone number. This is the check that it
 * did not: any 10-digit number in the answer that never appeared in the list or
 * in a tool result gets pulled before the rep can dial it.
 */
function stripUngroundedPhones(content: string, allowed: Set<string>) {
  let removed = 0;
  const cleaned = content.replace(PHONE_IN_TEXT, (match) => {
    const digits = phoneDigits(match);
    if (digits.length !== 10 || allowed.has(digits)) return match;
    removed += 1;
    return "(no public phone on file)";
  });
  return { content: cleaned, removed };
}

function looksLikeDemo(text: string) {
  return /\b(Acme Legal|Bright Dental|Two things I can do|parsed a task item)\b/i.test(text);
}

function isPresentationFact(fact: LiveMemoryFact) {
  return fact.kind === "preference" && /\b(table|tables|markdown|skimmable|boxed|demo|format)\b/i.test(fact.text);
}

function usefulMemory(memory: LiveMemoryFact[]) {
  return memory.filter((item) => !isPresentationFact(item));
}

const TABLE_ROW = /^\s*\|.*\|?\s*$/;
const TABLE_DIVIDER = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/;

function splitTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.replace(/\*+/g, "").trim());
}

/** Turn a markdown table into a numbered list so businesses never render as a boxed grid. */
function flattenMarkdownTables(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const next = lines[index + 1] ?? "";
    if (TABLE_ROW.test(lines[index]) && lines[index].includes("|") && TABLE_DIVIDER.test(next) && next.includes("-")) {
      const head = splitTableRow(lines[index]);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && TABLE_ROW.test(lines[index]) && !TABLE_DIVIDER.test(lines[index])) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      rows.forEach((row, rowIndex) => {
        const parts = row
          .map((cell, cellIndex) => {
            if (!cell || /^(#|business|name|miles|distance|fit|phone|category|why.*)$/i.test(cell)) return "";
            if (cellIndex === 0) return `**${cell.replace(/^\d+[.)]\s*/, "")}**`;
            const label = head[cellIndex] ?? "";
            if (/\b(miles|distance)\b/i.test(label) && !/\bmi\b/i.test(cell)) return `${cell} mi`;
            return cell;
          })
          .filter(Boolean);
        if (parts.length) out.push(`${rowIndex + 1}. ${parts.join(" — ")}`);
      });
      continue;
    }
    out.push(lines[index]);
    index += 1;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function looksIncomplete(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (trimmed.endsWith("|") || /\|[-: ]*$/.test(trimmed.split("\n").at(-1) ?? "")) return true;
  const lastWord = trimmed.split(/\s+/).pop() ?? "";
  return lastWord.length <= 3 && !/[.!?)]$/.test(trimmed) && trimmed.length < 120;
}

function hasBusinessTable(text: string) {
  return /\n\s*\|.+\|\s*\n\s*\|[-: |]+\|/m.test(text);
}

/** Newest turns first within a character budget, so a long chat costs a stable number of tokens. */
function historyMessages(messages: LiveChatMessage[]): ChatMessage[] {
  const kept: ChatMessage[] = [];
  let budget = HISTORY_BUDGET_CHARS;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item.role === "assistant" && looksLikeDemo(item.content)) continue;
    const flattened = flattenMarkdownTables(item.content);
    const content = flattened.length > 1_800 ? `${flattened.slice(0, 1_800)}…` : flattened;
    if (content.length > budget && kept.length >= 2) break;
    budget -= content.length;
    kept.push({ role: item.role, content });
  }

  return kept.reverse();
}

async function trackSources(trace: TurnTrace, sources: LiveSource[]) {
  if (!sources.length) return;
  trace.sources = dedupeSources([...trace.sources, ...sources]);
  await trace.emit({ type: "sources", sources: trace.sources });
}

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string | null;
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ToolCallDelta = {
  index?: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
};

type GroqStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: ToolCallDelta[];
    };
    message?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: ToolCallDelta[];
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
};

type ModelReply = {
  content: string;
  reasoning: string;
  toolCalls: ToolCall[];
};

const LIVE_MODEL_FALLBACK = "openai/gpt-oss-120b";
const MAX_TOOL_ROUNDS = 4;
/** Free-tier keys are billed per minute, so the history is trimmed by size, not turn count. */
const HISTORY_BUDGET_CHARS = 5_000;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "find_businesses",
      description:
        "Find real nearby businesses worth contacting. Use when the user names a city, ZIP, street, or area. Never invent listings.",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "City, ZIP, address, or area the user named." },
          radiusMiles: { type: "number", description: "Search radius in miles. Default 2." },
          category: { type: "string", description: "Optional industry filter such as Legal & accounting." },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "research_business",
      description: "Look up public information for one business already in the current list, or by name.",
      parameters: {
        type: "object",
        properties: {
          prospectId: { type: "string" },
          name: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_broadband",
      description:
        "Check FCC-reported broadband availability: which providers serve an address, the technology, and reported speeds. Use whenever the rep asks who is available, who serves them, what is at that address, or what speeds they can get. Use scope 'territory' when they ask about the area or the whole list, 'business' for one address.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["business", "territory"], description: "Default business." },
          prospectId: { type: "string" },
          name: { type: "string", description: "Business name if you do not have the id. Omit for the current business." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "skip_to_next",
      description: "Move to the next business in the current list and brief the user on it.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "draft_outreach",
      description:
        "Draft a call opener or short cold email for a business already on the current list. Uses only public facts on file. Use when they ask to write, draft, open, or email.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["call", "email"], description: "Default email." },
          prospectId: { type: "string" },
          name: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "refine_list",
      description:
        "Narrow or re-order the list the rep already has, without searching again. Use when they ask for only one industry, only places within a distance, only ones with a phone, or the closest ones first.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Industry to keep, such as Legal & accounting." },
          maxDistanceMiles: { type: "number", description: "Drop anything farther than this." },
          requirePhone: { type: "boolean", description: "Keep only listings with a public phone." },
          sortBy: { type: "string", enum: ["fit", "distance"], description: "Default fit." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_lookup",
      description:
        "Search the public web about one business on the list for something the listing does not cover: who owns it, how many locations, recent news, whether it is still open. Use when research_business already ran and the answer is still missing.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "What you need to find out, in a few words." },
          prospectId: { type: "string" },
          name: { type: "string", description: "Business name if you do not have the id." },
        },
        required: ["question"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_contacted",
      description:
        "Record that the rep just worked a business, so it is not suggested again. Use when they say they called it, left a voicemail, emailed it, or that it is a dead end.",
      parameters: {
        type: "object",
        properties: {
          outcome: {
            type: "string",
            enum: ["reached", "voicemail", "no_answer", "not_interested", "follow_up"],
          },
          prospectId: { type: "string" },
          name: { type: "string", description: "Business name if you do not have the id." },
          note: { type: "string", description: "One short line worth keeping, if there is one." },
        },
        required: ["outcome"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "Save a durable fact that will help later: working territory, industries they sell, businesses already contacted, or a lasting preference. Do not save hiring, gossip, or the full chat.",
      parameters: {
        type: "object",
        properties: {
          fact: { type: "string" },
          kind: { type: "string", enum: ["territory", "preference", "contacted", "note"] },
        },
        required: ["fact", "kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "forget",
      description:
        "Drop remembered facts that are now wrong or stale, such as an old territory. Use when the rep says to forget something or corrects a saved fact.",
      parameters: {
        type: "object",
        properties: {
          about: { type: "string", description: "Words that appear in the fact to drop, or the kind of fact." },
        },
        required: ["about"],
      },
    },
  },
];

function groqConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

function qwenConfigured() {
  return Boolean(process.env.DASHSCOPE_API_KEY?.trim());
}

type LiveProvider = {
  id: "qwen" | "groq";
  apiKey: string;
  model: string;
  baseUrl: string;
  enableThinking?: boolean;
  reasoningEffort?: "low" | "medium" | "high";
};

/** Qwen 3.5 Flash first — it is faster. Groq stays as the exhausted-quota fallback. */
function liveProviders(): LiveProvider[] {
  const providers: LiveProvider[] = [];
  const qwenKey = process.env.DASHSCOPE_API_KEY?.trim();
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (qwenKey) {
    providers.push({
      id: "qwen",
      apiKey: qwenKey,
      model: process.env.QWEN_MODEL?.trim() || "qwen3.5-flash",
      baseUrl: (process.env.DASHSCOPE_BASE_URL?.trim() || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1").replace(
        /\/$/,
        "",
      ),
      enableThinking: false,
    });
  }
  if (groqKey) {
    providers.push({
      id: "groq",
      apiKey: groqKey,
      model: process.env.LIVE_MODEL?.trim() || LIVE_MODEL_FALLBACK,
      baseUrl: (process.env.LIVE_BASE_URL?.trim() || process.env.RADAR_BRIEF_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(
        /\/$/,
        "",
      ),
      reasoningEffort: reasoningEffort(),
    });
  }
  return providers;
}

function liveConfigured() {
  return liveProviders().length > 0;
}

export function liveAssistantStatus() {
  const providers = liveProviders();
  return {
    primary: providers[0]?.id ?? "none",
    model: providers[0]?.model ?? LIVE_MODEL_FALLBACK,
    qwen: qwenConfigured() ? "active" : "not_configured",
    groq: groqConfigured() ? "active" : "not_configured",
    fallback: providers[1]?.id ?? "tool_router",
  };
}

function titleFromMessage(text: string) {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 42) return cleaned || "New chat";
  return `${cleaned.slice(0, 39).trim()}…`;
}

export function publicState(session: LiveSession, memory: LiveMemoryFact[]): LivePublicState {
  const cards = session.queue?.prospects.map(compactProspect) ?? [];
  return {
    session: {
      ...sessionSummary(session),
      messages: session.messages,
    },
    queue: session.queue
      ? {
          locationLabel: session.queue.locationLabel,
          radiusMiles: session.queue.radiusMiles,
          category: session.queue.category,
          currentIndex: session.queue.currentIndex,
          total: session.queue.prospects.length,
          current: cards[session.queue.currentIndex] ?? null,
          cards,
        }
      : null,
    memory,
  };
}

function systemPrompt(memory: LiveMemoryFact[], queue: LiveQueue | null) {
  const recalled = usefulMemory(memory);
  const memoryBlock = recalled.length
    ? recalled.map((item) => `- (${item.kind}) ${item.text}`).join("\n")
    : "None yet.";
  const queueBlock = queue?.prospects.length
    ? queue.prospects
        .map((item, index) => {
          const mark = index === queue.currentIndex ? " ← current" : "";
          return `${index + 1}. ${item.name} · ${item.category} · ${item.distanceMiles.toFixed(1)} mi · fit ${item.score} · ${item.phone || "no phone"} · ${item.topOpportunity || item.summary || item.category}${mark}`;
        })
        .join("\n")
    : "No current list.";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return `You are Live, PAI's full-time sales prospecting assistant. Today is ${today}.

You help a field rep find nearby businesses worth contacting, brief them in chat, draft openers, and keep moving. Talk like a sharp colleague, not a chatbot.

Grounding, in order of importance:
- Never invent businesses, phone numbers, websites, addresses, hours, owners, or events. A number you did not read in a tool result does not exist.
- Only use tool results, the current list, and remembered facts. If you do not know, say so in one line and either look it up or ask.
- Attribute anything soft: "the listing says", "FCC reports", "public web". Never upgrade reported to confirmed.
- This is not recruiting. Ignore hiring, jobs, and careers.

Picking the right tool:
- find_businesses only with a place the rep actually named, or the remembered territory. Never guess a location from a business name, and never search a place they did not give you.
- Already have a list and they ask who to call? Rank from the current list. Do not search again.
- refine_list when they want fewer: one industry, a tighter radius, only ones with a phone, closest first.
- research_business when you need public facts about one company on the list that you do not already have.
- web_lookup after research_business when the answer is still missing: ownership, number of locations, recent news, still open.
- check_broadband when they ask who is available, who serves an address, what providers are there, or what speeds they can get. scope "territory" for the area or the whole list, scope "business" for one company. Never answer availability from memory.
- skip_to_next when they say skip, next, or similar.
- draft_outreach when they ask to write, draft, open, or email. Ground every line in the returned facts.
- mark_contacted when they say they called, emailed, left a voicemail, or that one is a dead end.
- remember only for durable facts (territory, industries they sell, working style). forget when they correct or retire one. Never remember the whole chat.
- If they name a business that is not on the list and you have no territory, ask which city or ZIP. Do not search blind.

Reading broadband results: providerCount and providers cover every provider at the address. charterSpectrum describes Charter/Spectrum only, so a not_reported Charter tier never means "no providers serve this address".

How to write:
- Answer in the first sentence. Do not narrate a plan, list capabilities, or stall before a tool.
- If they named a place, search it. Never reply with a demo, fake businesses, or a sample table.
- If you found businesses, say how many are worth talking to, then the strongest two or three with why, distance, and phone as a numbered list. The full list is already on screen, so never repeat every row.
- Keep it tight: usually under 80 words. Emails can run a short paragraph.
- Markdown: **bold** names, numbered lists when ranking, a short ## heading only when splitting a brief from a draft. No tables, no boxed grids, no backtick-wrapping ordinary words, no emoji, no horizontal rules.
- One idea per bullet. Do not pad with a summary of what you just said.

Remembered facts:
${memoryBlock}

Current list:
${queueBlock}`;
}

function parseArgs(raw: string) {
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function findInQueue(queue: LiveQueue | null, prospectId?: string, name?: string) {
  if (!queue) return null;
  if (prospectId) return queue.prospects.find((item) => item.id === prospectId) ?? null;
  if (!name) return currentProspect(queue);
  const needle = name.toLowerCase();
  return queue.prospects.find((item) => item.name.toLowerCase().includes(needle)) ?? currentProspect(queue);
}

/** Tools that only read state, so several of them can be answered at once. */
const READ_ONLY_TOOLS = new Set(["research_business", "check_broadband", "web_lookup"]);

const OUTCOME_LABELS: Record<string, string> = {
  reached: "reached someone",
  voicemail: "left a voicemail",
  no_answer: "no answer",
  not_interested: "not interested",
  follow_up: "wants a follow-up",
};

async function runTool(
  name: string,
  args: Record<string, unknown>,
  session: LiveSession,
  trace: TurnTrace,
) {
  if (name === "find_businesses") {
    if (trace.searched && session.queue) {
      const cards = session.queue.prospects.map(compactProspect);
      return {
        ok: true,
        location: session.queue.locationLabel,
        radiusMiles: session.queue.radiusMiles,
        count: cards.length,
        businesses: cards.map((card) => ({
          id: card.id,
          name: card.name,
          category: card.category,
          distanceMiles: Number(card.distanceMiles.toFixed(2)),
          phone: card.phone,
          score: card.score,
          why: card.why.slice(0, 110),
          source: card.source ?? null,
        })),
        note: "Already searched this turn. Brief from this list as a numbered list, not a table. Do not invent businesses.",
      };
    }
    const location = typeof args.location === "string" ? args.location : "";
    await trackStep(trace, `Searching Google Maps near ${location || "that area"}`, liveSearchDetail());
    const found = await findBusinesses({
      location,
      radiusMiles: typeof args.radiusMiles === "number" ? args.radiusMiles : null,
      category: typeof args.category === "string" ? args.category : null,
    });
    session.queue = found.queue;
    trace.searched = true;
    await trackSources(trace, found.sources);
    await trackStep(
      trace,
      `Ranking ${found.cards.length} ${found.cards.length === 1 ? "listing" : "listings"}`,
      found.via,
    );
    await rememberFact({ kind: "territory", text: `Working territory: ${found.queue.locationLabel} (${found.queue.radiusMiles} mi)` });
    return {
      ok: true,
      location: found.queue.locationLabel,
      radiusMiles: found.queue.radiusMiles,
      count: found.cards.length,
      businesses: found.cards.map((card) => ({
        id: card.id,
        name: card.name,
        category: card.category,
        distanceMiles: Number(card.distanceMiles.toFixed(2)),
        phone: card.phone,
        score: card.score,
        why: card.why.slice(0, 110),
        source: card.source ?? null,
      })),
      via: found.via,
      note: found.cards.length
        ? "These are real listings from the Google Maps scraper. Public map data is only a backstop. Recommend only these. The full list is already rendered for the user, so highlight two or three."
        : "No strong listings came back. Ask for a tighter address or a different area. Do not invent businesses.",
    };
  }

  if (name === "research_business") {
    const prospect = findInQueue(
      session.queue,
      typeof args.prospectId === "string" ? args.prospectId : undefined,
      typeof args.name === "string" ? args.name : undefined,
    );
    if (!prospect) return { ok: false, error: "That business is not in the current list. Find businesses in an area first." };
    await trackStep(trace, `Reading public sources on ${prospect.name}`, prospect.address);
    session.queue = session.queue
      ? { ...session.queue, currentIndex: session.queue.prospects.findIndex((item) => item.id === prospect.id) }
      : session.queue;
    const researched = await researchProspect(prospect);
    await trackSources(trace, researched.sources);
    return { ok: true, business: researched.business };
  }

  if (name === "check_broadband") {
    if (args.scope === "territory") {
      if (!session.queue?.prospects.length) {
        return { ok: false, error: "There is no territory yet. Find businesses in an area first." };
      }
      await trackStep(
        trace,
        `Checking the FCC broadband map across ${session.queue.locationLabel}`,
        `${Math.min(6, session.queue.prospects.length)} addresses on the list`,
      );
      const rolled = await checkBroadbandAcrossQueue(session.queue);
      await trackSources(trace, rolled.sources);
      return { ok: true, availability: rolled.availability };
    }
    const prospect = findInQueue(
      session.queue,
      typeof args.prospectId === "string" ? args.prospectId : undefined,
      typeof args.name === "string" ? args.name : undefined,
    );
    if (!prospect) return { ok: false, error: "No business selected. Find businesses in an area first, or name one on the list." };
    await trackStep(trace, `Checking the FCC broadband map for ${prospect.name}`, prospect.address);
    const checked = await checkBroadband(prospect);
    await trackSources(trace, checked.sources);
    return { ok: true, availability: checked.availability };
  }

  if (name === "skip_to_next") {
    const skipped = skipQueue(session.queue);
    if (!skipped) return { ok: false, error: "There is no list to skip through yet. Find businesses in an area first." };
    session.queue = {
      locationLabel: skipped.locationLabel,
      radiusMiles: skipped.radiusMiles,
      category: skipped.category,
      currentIndex: skipped.currentIndex,
      prospects: skipped.prospects,
    };
    const prospect = currentProspect(session.queue);
    if (!prospect) return { ok: false, error: "The list is empty." };
    await trackStep(trace, `Moving to ${prospect.name}`, `${session.queue.currentIndex + 1} of ${session.queue.prospects.length}`);
    await trackSources(trace, dedupeSources([toSource({ title: prospect.name, url: prospect.website || prospect.directoryUrl, snippet: prospect.address })]));
    return {
      ok: true,
      index: session.queue.currentIndex + 1,
      total: session.queue.prospects.length,
      business: compactProspect(prospect),
      note: skipped.wrapped ? "This is the last business in the current list." : "Brief this business now.",
    };
  }

  if (name === "draft_outreach") {
    const prospect = findInQueue(
      session.queue,
      typeof args.prospectId === "string" ? args.prospectId : undefined,
      typeof args.name === "string" ? args.name : undefined,
    );
    if (!prospect) return { ok: false, error: "No business selected. Find businesses in an area first, or name one on the list." };
    const kind = args.kind === "call" ? "call" : "email";
    session.queue = session.queue
      ? { ...session.queue, currentIndex: session.queue.prospects.findIndex((item) => item.id === prospect.id) }
      : session.queue;
    await trackStep(trace, kind === "call" ? `Drafting a call opener for ${prospect.name}` : `Drafting an email for ${prospect.name}`, prospect.address);
    return {
      ok: true,
      kind,
      business: compactProspect(prospect),
      callOpener: prospect.callOpener,
      email: prospect.followUpEmail,
      needs: prospect.hypothesizedNeeds.filter((item) => !/\bhiring\b/i.test(item)).slice(0, 3),
      note: "These drafts are grounded in the public listing. Keep the Spectrum Business voice. Do not invent facts.",
    };
  }

  if (name === "refine_list") {
    if (!session.queue?.prospects.length) {
      return { ok: false, error: "There is no list to narrow yet. Find businesses in an area first." };
    }
    const refined = refineQueue(session.queue, {
      category: typeof args.category === "string" ? args.category : null,
      maxDistanceMiles: typeof args.maxDistanceMiles === "number" ? args.maxDistanceMiles : null,
      requirePhone: args.requirePhone === true,
      sortBy: args.sortBy === "distance" ? "distance" : "fit",
    });
    session.queue = refined.queue;
    await trackStep(
      trace,
      `Narrowing the ${session.queue.locationLabel} list`,
      `${refined.matches.length} of ${session.queue.prospects.length} match`,
    );
    return {
      ok: true,
      matched: refined.matches.length,
      total: session.queue.prospects.length,
      category: refined.category,
      businesses: refined.matches.slice(0, 8).map((card) => ({
        id: card.id,
        name: card.name,
        category: card.category,
        distanceMiles: Number(card.distanceMiles.toFixed(2)),
        phone: card.phone,
        score: card.score,
      })),
      note: refined.matches.length
        ? "The list on screen is already re-ordered to match. Name the top two or three."
        : "Nothing on the current list matches. Offer a wider radius or a different industry instead of inventing listings.",
    };
  }

  if (name === "web_lookup") {
    const question = typeof args.question === "string" ? args.question.trim() : "";
    if (question.length < 3) return { ok: false, error: "Say what you are trying to find out." };
    const prospect = findInQueue(
      session.queue,
      typeof args.prospectId === "string" ? args.prospectId : undefined,
      typeof args.name === "string" ? args.name : undefined,
    );
    if (!prospect) return { ok: false, error: "That business is not in the current list. Find businesses in an area first." };
    await trackStep(trace, `Searching the public web on ${prospect.name}`, question.slice(0, 90));
    try {
      const looked = await webLookup(prospect, question);
      await trackSources(trace, looked.sources);
      return {
        ok: true,
        question,
        business: prospect.name,
        findings: looked.findings,
        note: looked.findings.length
          ? "Quote only what these snippets support, and say where it came from."
          : "The public web had nothing usable. Say you could not confirm it rather than guessing.",
      };
    } catch (lookupError) {
      return {
        ok: false,
        error: lookupError instanceof Error ? lookupError.message : "The web lookup failed.",
        note: "Tell the rep you could not confirm it from public sources.",
      };
    }
  }

  if (name === "mark_contacted") {
    const outcome = typeof args.outcome === "string" ? args.outcome : "reached";
    const prospect = findInQueue(
      session.queue,
      typeof args.prospectId === "string" ? args.prospectId : undefined,
      typeof args.name === "string" ? args.name : undefined,
    );
    if (!prospect) return { ok: false, error: "No business selected. Find businesses in an area first, or name one on the list." };
    const note = typeof args.note === "string" ? args.note.replace(/\s+/g, " ").trim().slice(0, 120) : "";
    const label = OUTCOME_LABELS[outcome] ?? "worked";
    await rememberFact({
      kind: "contacted",
      text: `${prospect.name} — ${label}${note ? `: ${note}` : ""} (${new Date().toISOString().slice(0, 10)})`,
    });
    await trackStep(trace, `Logging ${prospect.name} as ${label}`, note || null);
    const skipped = skipQueue(session.queue);
    if (skipped) {
      session.queue = {
        locationLabel: skipped.locationLabel,
        radiusMiles: skipped.radiusMiles,
        category: skipped.category,
        currentIndex: skipped.currentIndex,
        prospects: skipped.prospects,
      };
    }
    const next = currentProspect(session.queue);
    return {
      ok: true,
      logged: `${prospect.name} — ${label}`,
      next: next && next.id !== prospect.id ? compactProspect(next) : null,
      note: "Confirm it is logged in one line, then hand them the next business if there is one.",
    };
  }

  if (name === "remember") {
    const kind = args.kind;
    const fact = typeof args.fact === "string" ? args.fact : "";
    if (kind !== "territory" && kind !== "preference" && kind !== "contacted" && kind !== "note") {
      return { ok: false, error: "Unsupported memory kind." };
    }
    if (/\b(table|tables|markdown|skimmable|boxed|demo|emoji|format)\b/i.test(fact)) {
      return { ok: true, saved: null, note: "Presentation preferences are not stored." };
    }
    const memory = await rememberFact({ kind, text: fact });
    await trackStep(trace, "Saving that for later", fact.slice(0, 90));
    return { ok: true, saved: fact, memoryCount: memory.length };
  }

  if (name === "forget") {
    const about = typeof args.about === "string" ? args.about.replace(/\s+/g, " ").trim().toLowerCase() : "";
    if (about.length < 3) return { ok: false, error: "Say which fact to drop." };
    const facts = await loadMemory();
    const doomed = facts.filter((item) => item.text.toLowerCase().includes(about) || item.kind === about);
    if (!doomed.length) return { ok: false, error: "Nothing remembered matches that.", remembered: facts.length };
    let remaining = facts;
    for (const item of doomed) remaining = await forgetFact(item.id);
    await trackStep(trace, "Forgetting that", doomed.map((item) => item.text).join(" · ").slice(0, 90));
    return { ok: true, forgot: doomed.map((item) => item.text), memoryCount: remaining.length };
  }

  return { ok: false, error: `Unknown tool ${name}` };
}

/** A rep will not wait this long for a retry; past it, the tool router answers instead. */
const MAX_RETRY_WAIT_MS = 6_000;

/**
 * Free-tier Groq keys sit on a tight per-minute budget, so a 429 is expected
 * traffic and worth a short wait. A daily-quota 429 asks for ten minutes, which
 * is not a retry — it is a `null`, so the turn falls through immediately.
 */
function retryDelayMs(message: string, retryAfter: string | null, attempt: number) {
  const header = retryAfter ? Number(retryAfter) : NaN;
  const suggestedSeconds = Number.isFinite(header) && header > 0
    ? header
    : Number(message.match(/try again in (?:(\d+)m)?([\d.]+)s/i)?.slice(1).reduce((total, part) => total * 60 + Number(part || 0), 0));

  if (Number.isFinite(suggestedSeconds) && suggestedSeconds > 0) {
    const wait = suggestedSeconds * 1000 + 300;
    return wait > MAX_RETRY_WAIT_MS ? null : wait;
  }
  // Jitter so two tabs backing off at once do not retry in lockstep.
  return Math.min(MAX_RETRY_WAIT_MS, 900 * 2 ** attempt + Math.floor(Math.random() * 400));
}

function rateLimitDetail(message: string) {
  if (/tokens per day|TPD/i.test(message)) return "The model's daily token budget is used up";
  if (/rate limit/i.test(message)) return "Model was rate limited";
  return null;
}

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name]?.trim());
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function reasoningEffort() {
  const value = process.env.LIVE_REASONING_EFFORT?.trim().toLowerCase();
  return value === "low" || value === "medium" || value === "high" ? value : "low";
}

async function readSseStream(response: Response, onChunk: (chunk: GroqStreamChunk) => Promise<void>) {
  if (!response.body) throw new Error("The model returned an empty stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        await onChunk(JSON.parse(payload) as GroqStreamChunk);
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

/**
 * One round trip to the model. Answer text is forwarded chunk by chunk through
 * `onDelta` so the rep reads the reply as it is written; rounds that turn out to
 * be tool calls instead call `onDiscard` so the UI can drop the false start.
 * Qwen 3.5 Flash is first; Groq is used if Qwen fails or is unset, and Qwen is
 * used if Groq is rate-limited or out of quota.
 */
async function groqChat(
  messages: ChatMessage[],
  options: {
    tools?: boolean;
    maxTokens?: number;
    effort?: "low" | "medium" | "high";
    onDelta?: (text: string) => Promise<void>;
    onDiscard?: () => Promise<void>;
  } = {},
): Promise<ModelReply> {
  const providers = liveProviders();
  if (!providers.length) throw new Error("Live is not configured.");
  let lastError = "Live could not reach the model.";
  for (const provider of providers) {
    try {
      return await chatWithProvider(provider, messages, options);
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }
  throw new Error(lastError);
}

async function chatWithProvider(
  provider: LiveProvider,
  messages: ChatMessage[],
  options: {
    tools?: boolean;
    maxTokens?: number;
    effort?: "low" | "medium" | "high";
    onDelta?: (text: string) => Promise<void>;
    onDiscard?: () => Promise<void>;
  },
): Promise<ModelReply> {
  const withTools = options.tools !== false;
  let lastError = `Live could not reach ${provider.id}.`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.15,
        max_tokens: options.maxTokens ?? numberEnv("LIVE_MAX_TOKENS", 700, 256, 4_096),
        stream: true,
        messages,
        ...(withTools ? { tools: TOOLS, tool_choice: "auto" } : {}),
        ...(provider.reasoningEffort || options.effort
          ? { reasoning_effort: options.effort ?? provider.reasoningEffort }
          : {}),
        ...(provider.id === "qwen" ? { enable_thinking: provider.enableThinking ?? false } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(numberEnv("LIVE_TIMEOUT_MS", 18_000, 5_000, 120_000)),
    });

    if (!response.ok) {
      const body = await response.text();
      let message = body.slice(0, 400);
      try {
        message = (JSON.parse(body) as GroqStreamChunk).error?.message || message;
      } catch {
        // Non-JSON error bodies (gateway HTML) are used verbatim.
      }
      lastError = message || lastError;
      if (response.status !== 429 && response.status < 500) break;
      const wait = retryDelayMs(lastError, response.headers.get("retry-after"), attempt);
      if (wait == null) break;
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }

    const partials = new Map<number, { id: string; name: string; arguments: string }>();
    let content = "";
    let reasoning = "";
    let streamed = false;

    const buildReply = (): ModelReply => ({
      content: content.trim(),
      reasoning: reasoning.trim(),
      toolCalls: [...partials.entries()]
        .sort(([a], [b]) => a - b)
        .filter(([, call]) => call.name)
        .map(([index, call], position) => ({
          id: call.id || `call_${index}_${position}`,
          type: "function" as const,
          function: { name: call.name, arguments: call.arguments || "{}" },
        })),
    });

    try {
      await readSseStream(response, async (chunk) => {
        if (chunk.error?.message) throw new Error(chunk.error.message);
        const choice = chunk.choices?.[0];
        if (!choice) return;

        // Some gateways collapse a stream into one non-delta message frame.
        const delta = choice.delta ?? choice.message;
        if (!delta) return;

        if (delta.reasoning) reasoning += delta.reasoning;
        if (delta.reasoning_content) reasoning += delta.reasoning_content;

        for (const call of delta.tool_calls ?? []) {
          const index = call.index ?? partials.size;
          const existing = partials.get(index) ?? { id: "", name: "", arguments: "" };
          partials.set(index, {
            id: call.id || existing.id,
            name: call.function?.name || existing.name,
            arguments: existing.arguments + (call.function?.arguments ?? ""),
          });
          // Text written before the model committed to a tool call is a false
          // start, never part of the answer.
          if (streamed) {
            streamed = false;
            await options.onDiscard?.();
          }
          content = "";
        }

        const text = Array.isArray(delta.content) ? "" : delta.content;
        if (text && !partials.size) {
          content += text;
          if (options.onDelta) {
            streamed = true;
            await options.onDelta(text);
          }
        }
      });
    } catch (streamError) {
      const partial = buildReply();
      if (partial.content || partial.toolCalls.length) return partial;
      lastError = streamError instanceof Error ? streamError.message : lastError;
      continue;
    }

    return buildReply();
  }

  throw new Error(lastError);
}

function looksLikeFind(text: string) {
  return /\b(find|search|look(?:ing)? for|show me|who(?:'s| is) near|biz|business(?:es)?)\b/i.test(text);
}

function looksLikeSkip(text: string) {
  return /^(skip|next|another|next one|skip this)(?:\b|$)/i.test(text.trim()) || /\bskip to (?:the )?next\b/i.test(text);
}

function looksLikeBroadband(text: string) {
  return /\b(broadband|fcc|fiber|fibre|providers?|carriers?|isps?|serviceab|who(?:'s| is) available|what(?:'s| is) available|availability|speeds?|coverage|serve[sd]? (?:that|this|the) address)\b/i.test(
    text,
  );
}

function formatBroadbandReply(availability: Awaited<ReturnType<typeof checkBroadband>>["availability"]) {
  if (!availability.providerCount) {
    return `The FCC map has no provider-reported availability at ${availability.address}. ${availability.message} Worth confirming on a call rather than assuming nothing serves it.`;
  }
  const lines = availability.providers
    .slice(0, 6)
    .map((item) => `- **${item.provider}** — ${item.technology}, ${item.speed}${item.servesBusiness ? ", business class" : ""}`);
  const asOf = availability.asOfDate ? ` (FCC data as of ${availability.asOfDate})` : "";
  return `FCC reports **${availability.providerCount}** provider ${availability.providerCount === 1 ? "record" : "records"} at ${availability.address}${asOf}.\n\n${lines.join("\n")}\n\n${availability.charterSpectrum.detail} This is provider-reported, not a confirmed install.`;
}

function formatTerritoryBroadbandReply(
  availability: Awaited<ReturnType<typeof checkBroadbandAcrossQueue>>["availability"],
) {
  if (!availability.providers.length) {
    return `The FCC map has no provider-reported availability at the ${availability.addressesChecked} addresses I checked around ${availability.territory}. That is a data gap, not proof nothing serves them.`;
  }
  const lines = availability.providers
    .slice(0, 6)
    .map(
      (item) =>
        `- **${item.provider}** — ${item.technologies.join(", ")}${item.topDownloadMbps ? `, up to ${item.topDownloadMbps} Mbps down` : ""} · reported at ${item.reportedAtAddresses} of ${availability.addressesChecked}`,
    );
  const asOf = availability.asOfDate ? ` (FCC data as of ${availability.asOfDate})` : "";
  return `Across **${availability.addressesChecked}** addresses on your ${availability.territory} list, **${availability.addressesWithReportedService}** have provider-reported service${asOf}.\n\n${lines.join("\n")}\n\nThis is provider-reported FCC data, not a confirmed install at any one address.`;
}

function expandPlaceName(value: string) {
  return value.replace(/\bgville\b/gi, "Greenville").replace(/\bgreenvlle\b/gi, "Greenville");
}

function extractLocation(text: string) {
  const quoted = text.match(/["“]([^"”]{3,80})["”]/);
  if (quoted) return expandPlaceName(quoted[1]);
  const zip = text.match(/\b\d{5}(?:-\d{4})?\b/);
  if (zip) {
    const around = text.match(new RegExp(`([A-Za-z][A-Za-z .'-]{2,40},?\\s*[A-Z]{2}\\s*)?${zip[0]}`));
    return expandPlaceName((around?.[0] || zip[0]).trim());
  }
  const street = text.match(
    /\b(\d{1,6}\s+[A-Za-z][A-Za-z0-9'.-]*(?:\s+[A-Za-z0-9'.-]+){0,5}\s+(?:rd|road|dr|drive|st|street|ave|avenue|blvd|boulevard|ln|lane|way|ct|court|hwy|highway|pkwy|parkway|cir|circle|pl|place|ter|terrace))\b/i,
  );
  if (street) {
    const after = text.slice((street.index ?? 0) + street[0].length);
    const tail = after.match(/^\s+([A-Za-z][A-Za-z.']{1,40})(?:\s+([A-Za-z]{2}))?\b/);
    const city = tail?.[1] ? expandPlaceName(tail[1]) : "";
    const state = tail?.[2]?.toUpperCase() ?? (/^\s+([A-Z]{2})\b/.exec(after)?.[1] ?? "");
    if (city && state && city.length > 2) return `${street[1]}, ${city}, ${state}`;
    if (state) return `${street[1]}, ${state}`;
    if (city && city.length > 2) return `${street[1]}, ${city}`;
    return street[1];
  }
  const near = text.match(/\b(?:in|near|around|of)\s+([A-Za-z0-9][A-Za-z0-9 .,'-]{2,80})/i);
  if (near) return expandPlaceName(near[1].replace(/[?.!]+$/, "").trim());
  const cityState = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*[A-Z]{2}\b/);
  return cityState?.[0] ?? null;
}

function looksLikePrioritize(text: string) {
  return /\b(worth calling|call first|priorit|who first|rank|best (?:ones?|prospects?)|top (?:ones?|picks?))\b/i.test(text);
}

function looksLikeOutreach(text: string) {
  return /\b(email|opener|cold call|script|draft|write (?:a |an |me )?(?:short )?(?:email|opener|intro|message)|outreach)\b/i.test(
    text,
  );
}

function formatListReply(cards: LiveProspectCard[], location: string) {
  if (!cards.length) {
    return `I looked around ${location} and did not find a business worth putting in front of you yet. Try a street address, a tighter ZIP, or a different category.`;
  }
  const lines = cards.slice(0, 3).map((item, index) => {
    const contact = item.phone ? item.phone : item.website ? "website on file" : "no public phone";
    return `${index + 1}. **${item.name}** — ${item.category}, ${item.distanceMiles.toFixed(1)} mi. ${item.why} · ${contact}`;
  });
  return `I found **${cards.length} ${cards.length === 1 ? "business" : "businesses"}** near ${location} who could be worth talking to.\n\n${lines.join("\n")}\n\nI can brief the first one, skip to the next, or pull public details on any of them.`;
}

function formatSkipReply(card: LiveProspectCard, index: number, total: number) {
  const contact = card.phone ? `Phone ${card.phone}.` : card.website ? "Website is on file." : "No public phone yet.";
  return `Next is **${card.name}** (${index} of ${total}). ${card.category} at ${card.address}. ${card.why} ${contact}`;
}

function formatPrioritizeReply(cards: LiveProspectCard[], location: string) {
  if (!cards.length) return "Find businesses in an area first, then I can rank who to call.";
  const ranked = [...cards].sort((a, b) => b.score - a.score || a.distanceMiles - b.distanceMiles).slice(0, 3);
  const lines = ranked.map((item, index) => {
    const contact = item.phone ? item.phone : "no public phone";
    return `${index + 1}. **${item.name}** — ${item.why} · ${item.distanceMiles.toFixed(1)} mi · ${contact}`;
  });
  return `If I were working ${location} this afternoon, I would start here:\n\n${lines.join("\n")}\n\nSay skip when you want the next one, or ask me to draft an opener.`;
}

function formatOutreachReply(prospect: { name: string; callOpener: string; followUpEmail: { subject: string; body: string } }, kind: "call" | "email") {
  if (kind === "call") {
    return `## Call opener for **${prospect.name}**\n\n${prospect.callOpener}`;
  }
  return `## Email for **${prospect.name}**\n\n**Subject:** ${prospect.followUpEmail.subject}\n\n${prospect.followUpEmail.body}`;
}

async function heuristicReply(text: string, session: LiveSession, trace: TurnTrace) {
  if (looksLikeSkip(text)) {
    const skipped = skipQueue(session.queue);
    if (!skipped) return "Find businesses in an area first, then I can skip through them.";
    session.queue = {
      locationLabel: skipped.locationLabel,
      radiusMiles: skipped.radiusMiles,
      category: skipped.category,
      currentIndex: skipped.currentIndex,
      prospects: skipped.prospects,
    };
    const prospect = currentProspect(session.queue);
    if (!prospect) return "The list is empty.";
    return formatSkipReply(compactProspect(prospect), session.queue.currentIndex + 1, session.queue.prospects.length);
  }
  if (looksLikePrioritize(text) && session.queue) {
    return formatPrioritizeReply(session.queue.prospects.map(compactProspect), session.queue.locationLabel);
  }
  if (looksLikeOutreach(text)) {
    const currentForDraft = currentProspect(session.queue);
    if (!currentForDraft) return "Find businesses in an area first, then I can draft an opener or email.";
    const kind = /\b(call|opener|script)\b/i.test(text) && !/\bemail\b/i.test(text) ? "call" : "email";
    await trackStep(trace, kind === "call" ? `Drafting a call opener for ${currentForDraft.name}` : `Drafting an email for ${currentForDraft.name}`);
    return formatOutreachReply(currentForDraft, kind);
  }
  if (trace.searched && session.queue) {
    return formatListReply(session.queue.prospects.map(compactProspect), session.queue.locationLabel);
  }
  const location = extractLocation(text);
  if (location && (looksLikeFind(text) || !currentProspect(session.queue))) {
    await trackStep(trace, `Searching Google Maps near ${location}`, liveSearchDetail());
    const found = await findBusinesses({ location });
    session.queue = found.queue;
    trace.searched = true;
    await trackSources(trace, found.sources);
    await trackStep(
      trace,
      `Ranking ${found.cards.length} ${found.cards.length === 1 ? "listing" : "listings"}`,
      found.via,
    );
    await rememberFact({ kind: "territory", text: `Working territory: ${found.queue.locationLabel} (${found.queue.radiusMiles} mi)` });
    return formatListReply(found.cards, found.queue.locationLabel);
  }
  const current = currentProspect(session.queue);
  if (session.queue?.prospects.length && looksLikeBroadband(text)) {
    const territoryWide = /\b(area|areas|territory|list|around here|region|zip|city|everyone|all of them)\b/i.test(text);
    if (territoryWide) {
      await trackStep(
        trace,
        `Checking the FCC broadband map across ${session.queue.locationLabel}`,
        `${Math.min(6, session.queue.prospects.length)} addresses on the list`,
      );
      const rolled = await checkBroadbandAcrossQueue(session.queue);
      await trackSources(trace, rolled.sources);
      return formatTerritoryBroadbandReply(rolled.availability);
    }
    if (current) {
      await trackStep(trace, `Checking the FCC broadband map for ${current.name}`, current.address);
      const checked = await checkBroadband(current);
      await trackSources(trace, checked.sources);
      return formatBroadbandReply(checked.availability);
    }
  }
  if (current) {
    const card = compactProspect(current);
    return `We are on **${card.name}** at ${card.address}. ${card.why} ${card.phone ? `Phone ${card.phone}.` : ""} Ask me to research it, check FCC broadband availability, draft an opener, or skip to the next one.`;
  }
  if (looksLikeFind(text)) return "Tell me a city, ZIP, or address and I will find businesses there.";
  return "Ask me to find businesses in an area — a city, ZIP, or street — and I will look them up, brief you in chat, and skip through the list with you.";
}

export async function runLiveTurn(input: {
  sessionId?: string | null;
  message: string;
  onEvent?: (event: LiveChatEvent) => Promise<void> | void;
}): Promise<LivePublicState> {
  const text = input.message.replace(/\s+/g, " ").trim();
  if (text.length < 1 || text.length > 2_000) {
    throw new Error("Type a message for Live.");
  }

  const emit = async (event: LiveChatEvent) => {
    await input.onEvent?.(event);
  };
  const trace: TurnTrace = { steps: [], sources: [], searched: false, emit };

  let session = input.sessionId ? await loadSession(input.sessionId) : null;
  if (!session) session = await createSession();
  if (session.title === "New chat") session.title = titleFromMessage(text);

  const userMessage: LiveChatMessage = {
    id: liveId("msg"),
    role: "user",
    content: text,
    createdAt: new Date().toISOString(),
  };
  session.messages = [...session.messages, userMessage].slice(-40);

  let memory = await loadMemory();
  let content = "";

  const groundedPhones = new Set<string>();
  let streamed = false;

  const publish = async (text: string) => {
    if (streamed) {
      streamed = false;
      await emit({ type: "delta_reset" });
    }
    content = text.trim();
    if (content) {
      streamed = true;
      await emit({ type: "delta", text: content });
    }
  };

  const location = extractLocation(text);
  const mostlyLocation = Boolean(location) && text.length <= (location?.length ?? 0) + 24;
  const extraAsk = looksLikeBroadband(text) || looksLikeOutreach(text) || looksLikePrioritize(text);
  const wantsList = Boolean(location) && (looksLikeFind(text) || !currentProspect(session.queue) || mostlyLocation);

  if (wantsList && location) {
    const trySearch = async (place: string) => {
      await trackStep(trace, `Searching Google Maps near ${place}`, liveSearchDetail());
      const found = await findBusinesses({ location: place });
      session.queue = found.queue;
      trace.searched = true;
      await trackSources(trace, found.sources);
      await trackStep(
        trace,
        `Ranking ${found.cards.length} ${found.cards.length === 1 ? "listing" : "listings"}`,
        found.via,
      );
      await rememberFact({
        kind: "territory",
        text: `Working territory: ${found.queue.locationLabel} (${found.queue.radiusMiles} mi)`,
      });
      memory = await loadMemory();
      if (!extraAsk) await publish(formatListReply(found.cards, found.queue.locationLabel));
    };

    try {
      await trySearch(location);
    } catch {
      const fallback = location.split(",")[0]?.trim();
      try {
        if (!fallback || fallback === location) throw new Error("no fallback");
        await trySearch(fallback);
      } catch {
        await publish(`I could not locate **${location}**. Try a full street address with city and ZIP.`);
      }
    }
  }

  if (!content && liveConfigured()) {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(memory, session.queue) },
      ...historyMessages(session.messages),
    ];
    const attempted = new Set<string>();

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const reply = await groqChat(messages, {
          onDelta: async (chunk) => {
            streamed = true;
            await emit({ type: "delta", text: chunk });
          },
          onDiscard: async () => {
            streamed = false;
            await emit({ type: "delta_reset" });
          },
        });

        if (reply.reasoning && trace.steps.length) {
          const last = trace.steps[trace.steps.length - 1];
          last.thought = reply.reasoning.replace(/\s+/g, " ").trim().slice(0, 500);
        }

        if (!reply.toolCalls.length) {
          content = reply.content;
          break;
        }

        const calls = reply.toolCalls;
        messages.push({
          role: "assistant",
          content: reply.content || null,
          tool_calls: calls,
          ...(reply.reasoning ? { reasoning_content: reply.reasoning } : {}),
        });

        // Repeating a call verbatim is how these loops stall, so the second
        // attempt gets an answer-now nudge instead of the same work again.
        const runOnce = async (call: ToolCall) => {
          const signature = `${call.function.name}:${call.function.arguments}`;
          if (attempted.has(signature)) {
            return { ok: false, error: "You already ran this exact call this turn. Answer from the result you have." };
          }
          attempted.add(signature);
          return runTool(call.function.name, parseArgs(call.function.arguments), session, trace);
        };

        // Lookups only read the queue, so fan them out. Anything that mutates
        // session state still runs in order to keep writes deterministic.
        const parallel = calls.length > 1 && calls.every((call) => READ_ONLY_TOOLS.has(call.function.name));
        const results = parallel
          ? await Promise.all(calls.map(runOnce))
          : await calls.reduce<Promise<unknown[]>>(
              async (chain, call) => [...(await chain), await runOnce(call)],
              Promise.resolve([]),
            );

        for (const [index, call] of calls.entries()) {
          const name = call.function.name;
          if (name === "remember" || name === "forget" || name === "mark_contacted") memory = await loadMemory();
          const payload = JSON.stringify(results[index]);
          collectGroundedPhones(payload, groundedPhones);
          messages.push({ role: "tool", tool_call_id: call.id, content: payload });
        }

        if (trace.searched && session.queue && !extraAsk) {
          await publish(formatListReply(session.queue.prospects.map(compactProspect), session.queue.locationLabel));
          break;
        }

        if (round === MAX_TOOL_ROUNDS - 1) {
          messages.push({
            role: "user",
            content: "Stop using tools and answer the last question now from what you already pulled. Numbered list, no table.",
          });
        }
      }
    } catch (modelError) {
      // Tool results are already in hand, so answer from them instead of losing the turn.
      const reason = modelError instanceof Error ? modelError.message : "";
      await trackStep(trace, "Answering from what I already pulled", rateLimitDetail(reason));
    }
    if (!content) {
      if (streamed) {
        streamed = false;
        await emit({ type: "delta_reset" });
      }
      content = await heuristicReply(text, session, trace);
    }
  } else if (!content) {
    await trackStep(trace, "Working from the live business list", null);
    content = await heuristicReply(text, session, trace);
  }

  if (looksLikeDemo(content) || looksIncomplete(content) || (hasBusinessTable(content) && session.queue)) {
    if (session.queue) {
      await publish(formatListReply(session.queue.prospects.map(compactProspect), session.queue.locationLabel));
    } else if (looksLikeDemo(content) || looksIncomplete(content)) {
      await publish(await heuristicReply(text, session, trace));
    }
  } else if (hasBusinessTable(content) || content.includes("|")) {
    const flat = flattenMarkdownTables(content);
    if (flat && flat !== content) await publish(flat);
  }

  for (const prospect of session.queue?.prospects ?? []) {
    if (prospect.phone) collectGroundedPhones(prospect.phone, groundedPhones);
  }
  const guarded = stripUngroundedPhones(content, groundedPhones);
  if (guarded.removed) {
    content = guarded.content;
    await trackStep(
      trace,
      `Pulled ${guarded.removed} phone ${guarded.removed === 1 ? "number" : "numbers"} I could not source`,
      "Not present in any listing or tool result",
    );
  }

  const assistantMessage: LiveChatMessage = {
    id: liveId("msg"),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    sources: trace.sources.length ? trace.sources : undefined,
    thinking: trace.steps.length ? trace.steps : undefined,
  };
  session.messages = [...session.messages, assistantMessage].slice(-40);
  await saveSession(session);
  memory = await loadMemory();
  const state = publicState(session, memory);
  await emit({ type: "complete", state });
  return state;
}
