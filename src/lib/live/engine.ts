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
  checkListing,
  compactProspect,
  currentProspect,
  dedupeSources,
  findBusinesses,
  identifyAddress,
  liveSearchDetail,
  planWalkingRoute,
  refineQueue,
  researchProspect,
  scanLocalNews,
  scanLocalNewsForQueue,
  skipQueue,
  toSource,
  webLookup,
} from "@/lib/live/tools";
import {
  briefNeedsFollowThrough,
  describeBrief,
  mergeLiveBrief,
  parseLiveBrief,
  type LiveBrief,
} from "@/lib/live/intent";
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
  /** Prospect ids already scanned this turn, so a second ask is not a repeat. */
  scannedNews: Set<string>;
  checkedListings: boolean;
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
          limit: { type: "number", description: "Only set this when the user asked for a specific count." },
          profile: {
            type: "string",
            enum: ["home_based", "independent", "any"],
            description: "home_based when they asked for at-home / owner-run shops. independent when they want non-chains.",
          },
          excludeNational: {
            type: "boolean",
            description: "Default true. Set false only if they asked for gas, grocery, or a named chain.",
          },
        },
        required: ["location"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "identify_address",
      description:
        "Look up what business sits at one street address. Use when they ask what is this address, what is at, who is at, or drop a street address as a question. Do not use find_businesses for that.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "The street address they named." },
        },
        required: ["address"],
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
      name: "plan_route",
      description:
        "Put the current list in walking order from where the rep is standing, shortest path between doors. Use when they ask about a route, walking order, what order to hit these, or how to work the street.",
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
      name: "scan_local_news",
      description:
        "Scan public news for a recent expansion, new location, or community event. Use when they ask what's new, for a local news scan, or to check recent expansions. Never invent an expansion.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["business", "list"], description: "Default business." },
          prospectId: { type: "string" },
          name: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_listing",
      description:
        "Genuine-check a listing: independent vs national chain, whether it looks like a real local shop, public contact on file. Use when they ask if it is real, legit, or worth calling.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["business", "list"], description: "Default business." },
          prospectId: { type: "string" },
          name: { type: "string" },
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

function systemPrompt(memory: LiveMemoryFact[], queue: LiveQueue | null, brief: LiveBrief | null) {
  const recalled = usefulMemory(memory);
  const memoryBlock = recalled.length
    ? recalled.map((item) => `- (${item.kind}) ${item.text}`).join("\n")
    : "None yet.";
  const queueBlock = queue?.prospects.length
    ? queue.prospects
        .map((item, index) => {
          const mark = index === queue.currentIndex ? " ← current" : "";
          const flags = item.signals?.map((signal) => signal.label).join(", ");
          return `${index + 1}. ${item.name} · ${item.category} · ${item.distanceMiles.toFixed(1)} mi · fit ${item.score} · ${item.phone || "no phone"} · ${item.topOpportunity || item.summary || item.category}${flags ? ` · ${flags}` : ""}${mark}`;
        })
        .join("\n")
    : "No current list.";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const briefBlock = brief
    ? `This turn they said: "${brief.raw}"
Do every part of that, in order, before you write the answer. Brief: ${describeBrief(brief)}.`
    : "No extra brief this turn.";

  return `You are Live, PAI's full-time sales prospecting assistant. Today is ${today}.

You help a field rep find nearby businesses worth contacting, brief them in chat, draft openers, and keep moving. Talk like a sharp colleague, not a chatbot.

Grounding, in order of importance:
- Never invent businesses, phone numbers, websites, addresses, hours, owners, or events. A number you did not read in a tool result does not exist.
- Only use tool results, the current list, and remembered facts. If you do not know, say so in one line and either look it up or ask.
- Never write a business name that did not come back from a tool. No placeholders, no examples, no "The Local Bakery". If there is no list yet, say so and ask for a city or ZIP.
- If the rep points at the chat ("look in the chat", "the one above"), read the conversation and the list. Do not treat their words as a place to search.
- Attribute anything soft: "the listing says", "FCC reports", "public web". Never upgrade reported to confirmed.
- This is not recruiting. Ignore hiring, jobs, and careers.

Listening:
- Do every part of what they asked, in the order they asked it. A request with "and then" or "also" is not finished until the last clause is done.
- Only mention a count if they asked for one ("give me 8", "find 3"). Never open with "I found 8 businesses" because that is the old default cap.
- If they asked to find AND research AND check what's new, run find_businesses, then research_business or check_listing, then scan_local_news. Do not stop after the list.
- National chains and convenience stops are out unless they named that kind of place.

What home-based means, because this is where you get it wrong:
- Home-based means the business runs out of a residence: a house, a garage, a barn, a spare room, or a truck the owner parks at home. Nothing else counts.
- A suite or unit number, a business park, an office building, a storefront, a clinic, a restaurant, a school, or a place with hundreds of reviews is NOT home-based, no matter how quiet the street name sounds. "Gary Paterson" in an office suite is an office.
- Only the listings carrying a Home-based flag are confirmed. Recommend those.
- If the flag count is short, say so in one line and offer a wider radius. Never relabel an office as home-based to fill the list, and never quietly hand them offices as if they matched.

Picking the right tool:
- find_businesses only with a place the rep actually named, or the remembered territory. Pass profile=home_based when they asked for at-home shops. Pass limit only when they asked for a number.
- identify_address when they ask what is at an address, what is this address, or who is at a street. Answer with the business at that pin. Do not run find_businesses and dump nearby shops.
- Already have a list and they ask who to call? Rank from the current list. Do not search again.
- refine_list when they want fewer: one industry, a tighter radius, only ones with a phone, closest first.
- research_business when you need public facts about one company on the list that you do not already have.
- scan_local_news when they ask what's new, for a local news scan, or expansions. It defaults to the business currently on screen, which is the one they mean after they press Next. Pass scope "list" only when they clearly asked about the whole list. Quote only what the snippet actually says.
- check_listing when they ask if a shop is real, independent, or worth calling.
- web_lookup after research_business when the answer is still missing: ownership, number of locations, still open.
- check_broadband when they ask who is available, who serves an address, what providers are there, or what speeds they can get. scope "territory" for the area or the whole list, scope "business" for one company. Never answer availability from memory.
- skip_to_next when they say skip, next, or similar.
- plan_route when they ask what order to work these, a walking order, or how to cover the street on foot.
- draft_outreach when they ask to write, draft, open, or email. Ground every line in the returned facts.
- mark_contacted when they say they called, emailed, left a voicemail, or that one is a dead end.
- remember only for durable facts (territory, industries they sell, working style, "home-based only"). forget when they correct or retire one. Never remember the whole chat.
- If they name a business that is not on the list and you have no territory, ask which city or ZIP. Do not search blind.

Reading broadband results: providerCount and providers cover every provider at the address. charterSpectrum describes Charter/Spectrum only, so a not_reported Charter tier never means "no providers serve this address".

How to write:
- Answer in the first sentence. Do not narrate a plan, list capabilities, or stall before a tool.
- If they named a place, search it. Never reply with a demo, fake businesses, or a sample table.
- After a search, name the strongest fits with why, distance, and phone. If a listing has a news flag (Just opened, Recent expansion, Just moved, New ownership, In the news), put it next to the phone and open with it instead of the internet pitch. Do not recite every row — the full list is on screen.
- When a news scan finds nothing, say that in one line and move on. "Nothing public on them" is a real answer.
- Keep it tight: usually under 80 words unless they asked for research or news. Emails can run a short paragraph.
- Markdown: **bold** names, numbered lists when ranking, a short ## heading only when splitting a brief from a draft. No tables, no boxed grids, no backtick-wrapping ordinary words, no emoji, no horizontal rules.
- One idea per bullet. Do not pad with a summary of what you just said.

${briefBlock}

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
const READ_ONLY_TOOLS = new Set(["research_business", "check_broadband", "web_lookup", "scan_local_news", "check_listing"]);

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
    const location = cleanLocationArg(typeof args.location === "string" ? args.location : "");
    const brief = session.brief;
    const profile =
      args.profile === "home_based" || args.profile === "independent" || args.profile === "any"
        ? args.profile
        : brief?.profile ?? "any";
    const limit =
      typeof args.limit === "number"
        ? args.limit
        : brief?.requestedCount ?? null;
    await trackStep(trace, `Searching Google Maps near ${location || "that area"}`, liveSearchDetail());
    const found = await findBusinesses({
      location,
      radiusMiles: typeof args.radiusMiles === "number" ? args.radiusMiles : null,
      category: typeof args.category === "string" ? args.category : brief?.categoryHint ?? null,
      limit,
      profile,
      excludeNational: args.excludeNational === false ? false : brief?.excludeNational !== false,
    });
    session.queue = found.queue;
    trace.searched = true;
    await trackSources(trace, found.sources);
    await trackStep(
      trace,
      `Ranking ${found.cards.length} ${found.cards.length === 1 ? "listing" : "listings"}`,
      found.dropped ? `${found.via} · dropped ${found.dropped} chain/retail stops` : found.via,
    );
    await rememberFact({ kind: "territory", text: `Working territory: ${found.queue.locationLabel} (${found.queue.radiusMiles} mi)` });
    if (profile === "home_based") {
      await rememberFact({ kind: "preference", text: "Look for home-based / owner-run shops. Skip gas, big-box, and national chains." });
    }
    return {
      ok: true,
      location: found.queue.locationLabel,
      radiusMiles: found.queue.radiusMiles,
      count: found.cards.length,
      requestedCount: limit,
      dropped: found.dropped,
      confirmedHomeBased: found.homeConfirmed,
      paddedWithQuietIndependents: found.relaxed,
      businesses: found.cards.map((card) => ({
        id: card.id,
        name: card.name,
        category: card.category,
        distanceMiles: Number(card.distanceMiles.toFixed(2)),
        phone: card.phone,
        score: card.score,
        why: card.why.slice(0, 110),
        source: card.source ?? null,
        signals: card.signals ?? [],
      })),
      via: found.via,
      note: !found.cards.length
        ? "No listings survived the filter. Ask for a different area or a wider radius — do not invent businesses or fall back to Circle K / Walmart."
        : profile === "home_based"
          ? `Only the ${found.homeConfirmed} carrying a Home-based flag are confirmed home-based. ${
              found.relaxed
                ? "The rest are the quietest independents nearby — say so plainly and offer a wider radius. Never call them home-based."
                : "Recommend from those."
            }`
          : limit
            ? `They asked for ${limit}. Recommend only these. Do not pad the count. The full list is already on screen.`
            : "These are real listings. Do not announce a default headcount. Highlight the strongest fits. The full list is already on screen.",
    };
  }

  if (name === "identify_address") {
    const address = typeof args.address === "string" ? args.address.trim() : "";
    if (address.length < 6) return { ok: false, error: "Need a street address to look up." };
    await trackStep(trace, `Looking up what is at ${address}`, liveSearchDetail());
    try {
      const identified = await identifyAddress(address);
      if (identified.prospects.length) {
        session.queue = {
          locationLabel: identified.resolved,
          radiusMiles: 0.15,
          category: null,
          currentIndex: 0,
          prospects: identified.prospects,
        };
      }
      await trackSources(trace, identified.sources);
      return {
        ok: true,
        resolved: identified.resolved,
        exactMatch: identified.exactMatch,
        atAddress: identified.atAddress.map((item) => ({
          name: item.name,
          category: item.category,
          phone: item.phone,
          address: item.address,
        })),
        nearby: identified.neighbours.map((item) => ({
          name: item.name,
          category: item.category,
          distanceMiles: Number(item.distanceMiles.toFixed(2)),
        })),
        note: identified.exactMatch
          ? "Name the business at this pin. Nearby listings are next door, not this address. Drag the address onto Normal for the full report."
          : "Nothing public is pinned to this exact number. Say that. Nearby listings are not this address.",
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not resolve that address." };
    }
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

  if (name === "plan_route") {
    if (!session.queue?.prospects.length) {
      return { ok: false, error: "There is no list to route yet. Find businesses in an area first." };
    }
    const route = planWalkingRoute(session.queue);
    if (!route) return { ok: false, error: "The list is empty." };
    await trackStep(
      trace,
      `Putting ${route.stops.length} stops in walking order`,
      `${route.totalMiles.toFixed(1)} mi on foot`,
    );
    return {
      ok: true,
      ...route,
      note: "The list is now in this order, so Next follows the walk. Give them the first three stops, not all of them.",
    };
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

  if (name === "scan_local_news") {
    if (!session.queue?.prospects.length) {
      return { ok: false, error: "There is no list yet. Find businesses in an area first." };
    }
    const listScope = args.scope === "list" && !args.prospectId && !args.name;
    if (listScope) {
      const scanned = await scanLocalNewsForQueue(session.queue, 4, trace.scannedNews);
      if (scanned.businesses.length) {
        await trackStep(
          trace,
          `Scanning local news around ${session.queue.locationLabel}`,
          `${scanned.businesses.length} ${scanned.businesses.length === 1 ? "listing" : "listings"}`,
        );
        for (const item of scanned.businesses) trace.scannedNews.add(item.id);
        await trackSources(trace, scanned.sources);
      }
      const flagged = session.queue.prospects
        .map((item) => ({
          name: item.name,
          flag: item.signals?.find((signal) => signal.kind === "expansion")?.label,
          detail: item.signals?.find((signal) => signal.kind === "expansion")?.detail,
        }))
        .filter((item) => item.flag);
      return {
        ok: true,
        flagged,
        scanned: scanned.businesses.map((item) => item.name),
        note: flagged.length
          ? "Only these snippets are real. Put the flag next to the phone and open with it. Do not invent more."
          : "Public news said nothing about these businesses. Say that plainly — do not invent an opening or a move.",
      };
    }
    // Default to whoever is on screen so pressing Next then asking "what's new"
    // reads the new current business, not row one.
    const prospect = findInQueue(
      session.queue,
      typeof args.prospectId === "string" ? args.prospectId : undefined,
      typeof args.name === "string" ? args.name : undefined,
    );
    if (!prospect) return { ok: false, error: "That business is not in the current list." };
    const existing = prospect.signals?.find((signal) => signal.kind === "expansion") ?? null;
    if (trace.scannedNews.has(prospect.id)) {
      return {
        ok: true,
        business: prospect.name,
        signal: existing,
        note: existing
          ? "Already scanned this turn. Quote the flag you have."
          : "Already scanned this turn and public news said nothing. Do not invent one.",
      };
    }
    await trackStep(trace, `Scanning local news on ${prospect.name}`, prospect.address);
    try {
      const scanned = await scanLocalNews(prospect);
      if (scanned.signal) {
        prospect.signals = [...(prospect.signals ?? []).filter((item) => item.kind !== "expansion"), scanned.signal];
      }
      trace.scannedNews.add(prospect.id);
      await trackSources(trace, scanned.sources);
      return {
        ok: true,
        business: prospect.name,
        address: prospect.address,
        signal: scanned.signal,
        findings: scanned.findings,
        pagesChecked: scanned.checked,
        pagesAboutThisBusiness: scanned.matched,
        note: scanned.signal
          ? `Quote the snippet and open the call with it. The ${scanned.signal.label} flag is now on ${prospect.name}.`
          : `Nothing public about ${prospect.name} mentions an opening, move, or event. Say that in one line — do not invent one.`,
      };
    } catch (scanError) {
      return {
        ok: false,
        error: scanError instanceof Error ? scanError.message : "The news scan failed.",
        note: "Say you could not confirm recent news.",
      };
    }
  }

  if (name === "check_listing") {
    if (args.scope === "list") {
      if (!session.queue?.prospects.length) {
        return { ok: false, error: "There is no list yet. Find businesses in an area first." };
      }
      const checks = session.queue.prospects.slice(0, 8).map(checkListing);
      trace.checkedListings = true;
      await trackStep(trace, "Checking which listings look like real local shops", `${checks.length} on the list`);
      return {
        ok: true,
        checks,
        note: "Drop anything marked National chain unless they asked for that kind of stop.",
      };
    }
    const prospect = findInQueue(
      session.queue,
      typeof args.prospectId === "string" ? args.prospectId : undefined,
      typeof args.name === "string" ? args.name : undefined,
    );
    if (!prospect) return { ok: false, error: "That business is not in the current list." };
    const checked = checkListing(prospect);
    trace.checkedListings = true;
    await trackStep(trace, `Checking ${prospect.name}`, checked.signal.label);
    return { ok: true, check: checked };
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
  return /\b(find|search|look(?:ing)? for|show me|who(?:'s| is) near|biz|businesses)\b/i.test(text);
}

/** A numbered or bulleted run of bolded proper names reads as a prospect list. */
function looksLikeInventedList(content: string) {
  const named = content.match(/^\s*(?:\d+\.|[-*])\s+\*\*([^*]{3,80})\*\*/gm) ?? [];
  return named.length >= 2;
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

/**
 * The model sometimes hands back the whole phrase ("5 businesses near 477
 * Haywood Rd"). Geocoding that returns nothing, so strip the ask off the front.
 */
function cleanLocationArg(value: string) {
  let cleaned = value.replace(/\s+/g, " ").trim();
  cleaned = cleaned.replace(
    /^(?:find|show|get|give me|look for)?\s*\d*\s*(?:home[- ]?based\s+)?(?:businesses|business|shops|shop|companies|company|leads|prospects|places)\b\s*(?:that are\s+)?(?:home[- ]?based\s+)?(?:near|in|around|by|at|close to|within)?\s*/i,
    "",
  );
  cleaned = cleaned.replace(/^(?:near|in|around|by|at|close to|the area of)\s+/i, "");
  return cleaned.trim() || value.trim();
}

const LOCATION_NOISE = /^(?:near|around|in|at|by|of|businesses?|shops?|stores?|companies|company|leads?|prospects?|places?|home|based)$/i;

/** Words that mean the rep is pointing at the screen, not naming a place. */
const NOT_A_PLACE =
  /\b(chat|screen|list|above|below|history|thread|conversation|message|earlier|before|there|here|them|those|these|it|one|ones|mine|yours|anything|something|nearby|around here|the area|my territory|my area)\b/i;

/**
 * The parser will happily hand back "the chat.." as a city. Geocoding that
 * wastes a turn and tells the rep their own words are an unknown address.
 */
function looksLikePlace(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 3) return false;
  if (/\b\d{5}(?:-\d{4})?\b/.test(trimmed)) return true;
  if (/\b\d{1,6}\s+\w/.test(trimmed)) return true;
  if (/,\s*[A-Za-z]{2,}\b/.test(trimmed)) return true;
  if (NOT_A_PLACE.test(trimmed)) return false;
  return /^[A-Za-z][A-Za-z .'-]{2,60}$/.test(trimmed);
}

/** The territory saved the last time a search actually ran. */
function rememberedTerritory(memory: LiveMemoryFact[]) {
  for (const fact of memory) {
    if (fact.kind !== "territory") continue;
    const match = fact.text.match(/Working territory:\s*(.+?)\s*(?:\(|$)/i);
    const place = match?.[1]?.trim();
    if (place && looksLikePlace(place)) return place;
  }
  return null;
}

function extractLocation(raw: string) {
  // "find 5 businesses near 477 Haywood Rd" would otherwise geocode the whole
  // phrase, because the 5 reads as a street number.
  const text = cleanLocationArg(raw);
  const quoted = text.match(/["“]([^"”]{3,80})["”]/);
  if (quoted) return expandPlaceName(quoted[1]);

  // A street address is checked before the ZIP. Otherwise "3618 Pelham Rd,
  // Greenville, SC 29615" collapses to the ZIP and loses the door they meant.
  const street = text.match(
    /\b(\d{1,6}\s+(?!near\b|around\b|businesses?\b|shops?\b|companies\b|leads?\b)[A-Za-z][A-Za-z0-9'.-]*(?:\s+(?!near\b|around\b|businesses?\b|shops?\b)[A-Za-z0-9'.-]+){0,5}\s+(?:rd|road|dr|drive|st|street|ave|avenue|blvd|boulevard|ln|lane|way|ct|court|hwy|highway|pkwy|parkway|cir|circle|pl|place|ter|terrace))\b/i,
  );
  if (street) {
    const after = text.slice((street.index ?? 0) + street[0].length);
    const tail = after.match(/^[\s,]+([A-Za-z][A-Za-z.']{1,40})(?:[\s,]+([A-Za-z]{2}))?\b/);
    const city = tail?.[1] ? expandPlaceName(tail[1]) : "";
    const state = tail?.[2]?.toUpperCase() ?? (/^[\s,]+([A-Z]{2})\b/.exec(after)?.[1] ?? "");
    const zipAfter = after.match(/\b\d{5}(?:-\d{4})?\b/)?.[0] ?? "";
    const parts = [street[1], city && city.length > 2 ? city : "", state].filter(Boolean);
    const joined = parts.join(", ");
    return zipAfter ? `${joined} ${zipAfter}` : joined;
  }

  const zip = text.match(/\b\d{5}(?:-\d{4})?\b/);
  if (zip) {
    const around = text.match(new RegExp(`([A-Za-z][A-Za-z .'-]{2,40},?\\s*[A-Z]{2}\\s*)?${zip[0]}`));
    return expandPlaceName((around?.[0] || zip[0]).trim());
  }
  const near = text.match(/\b(?:in|near|around|of)\s+([A-Za-z0-9][A-Za-z0-9 .,'-]{2,80})/i);
  if (near) {
    const trimmed = near[1].replace(/[?.!]+$/, "").trim();
    if (!LOCATION_NOISE.test(trimmed.split(/\s+/)[0] ?? "")) return expandPlaceName(trimmed);
  }
  const cityState = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*[A-Z]{2}\b/);
  return cityState?.[0] ?? null;
}

function extractPlace(text: string) {
  const value = extractLocation(text);
  return value && looksLikePlace(value) ? value : null;
}

function hostOf(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** "what is this 3618 Pelham Rd" is a question about one address, not a search. */
function looksLikeIdentify(text: string) {
  return (
    /\b(what|what's|whats|who|who's|whos)\s+(?:is\s+|are\s+)?(?:this|that|at|there|in|inside)\b/i.test(text) ||
    /\b(identify|look ?up|check)\s+(?:this\s+)?address\b/i.test(text) ||
    /\bwhat(?:'s| is)\s+(?:at|on)\b/i.test(text) ||
    /\bwho(?:'s| is)\s+(?:at|on)\b/i.test(text)
  );
}

function formatIdentifyReply(result: Awaited<ReturnType<typeof identifyAddress>>) {
  const [primary, ...alsoHere] = result.atAddress;
  if (!primary) {
    const nearby = result.neighbours.length
      ? ` Closest public pins are ${result.neighbours
          .slice(0, 3)
          .map((item) => `**${item.name}** ${item.distanceMiles.toFixed(2)} mi`)
          .join(", ")} — those are not this address.`
      : "";
    return `Nothing public is listed at **${result.resolved}**. It reads as a residence, a vacant unit, or a business with no Maps pin.${nearby} Drag the address onto Normal if you want the full workup.`;
  }

  const details = [primary.phone, hostOf(primary.website)].filter(Boolean);
  const lines = [
    `**${result.resolved}** is **${primary.name}** — ${primary.category}${details.length ? `, ${details.join(" · ")}` : ""}.`,
  ];
  if (alsoHere.length) {
    lines.push(`Also at that address: ${alsoHere.map((item) => `**${item.name}** (${item.category})`).join(", ")}.`);
  }
  if (result.neighbours.length) {
    lines.push(
      `Next door: ${result.neighbours
        .slice(0, 3)
        .map((item) => `**${item.name}** ${item.distanceMiles.toFixed(2)} mi`)
        .join(", ")}.`,
    );
  }
  lines.push("Drag the address up to Normal for the full report, or drop it on the chat box to stay in Live.");
  return lines.join("\n\n");
}

function looksLikeRoute(text: string) {
  return /\b(walk(?:ing)? order|walk order|route|what order|which order|door to door|work the street|plan (?:my|the) (?:day|street|walk)|shortest (?:path|route)|most efficient)\b/i.test(
    text,
  );
}

function formatRouteReply(route: NonNullable<ReturnType<typeof planWalkingRoute>>) {
  const lines = route.stops
    .slice(0, 5)
    .map(
      (stop) =>
        `${stop.order}. **${stop.name}** — ${stop.category}${stop.legMiles ? ` · ${stop.legMiles} mi from the last door` : " · you are here"}`,
    );
  const rest = route.stops.length > 5 ? `\n\n${route.stops.length - 5} more after that.` : "";
  return `Walking order from **${route.start}** — ${route.stops.length} doors, ${route.totalMiles.toFixed(1)} mi, about ${route.walkingMinutes} minutes of walking.\n\n${lines.join("\n")}${rest}\n\nNext now follows the walk instead of the ranking.`;
}

function looksLikePrioritize(text: string) {
  return /\b(worth calling|call first|priorit|who first|rank|best (?:ones?|prospects?)|top (?:ones?|picks?))\b/i.test(text);
}

function looksLikeOutreach(text: string) {
  return /\b(email|opener|cold call|script|draft|write (?:a |an |me )?(?:short )?(?:email|opener|intro|message)|outreach)\b/i.test(
    text,
  );
}

function formatListReply(cards: LiveProspectCard[], location: string, brief: LiveBrief | null) {
  if (!cards.length) {
    const wanted = brief?.profile === "home_based" ? "home-based business" : "business worth putting in front of you";
    return `I looked around ${location} and did not find a ${wanted} yet. Try a street address, a tighter ZIP, or a different category.`;
  }
  const homeBased = cards.filter((item) => item.signals?.some((signal) => signal.kind === "home"));
  const pool = brief?.profile === "home_based" && homeBased.length ? homeBased : cards;
  const show = brief?.requestedCount ? pool.slice(0, brief.requestedCount) : pool.slice(0, 3);
  const lines = show.map((item, index) => {
    const contact = item.phone ? item.phone : item.website ? "website on file" : "no public phone";
    const flags = (item.signals ?? [])
      .filter((signal) => signal.kind === "expansion" || signal.kind === "home" || signal.kind === "rival")
      .map((signal) => signal.label)
      .join(" · ");
    return `${index + 1}. **${item.name}** — ${item.category}, ${item.distanceMiles.toFixed(1)} mi. ${item.why} · ${contact}${flags ? ` · ${flags}` : ""}`;
  });

  let opener: string;
  if (brief?.profile === "home_based") {
    opener = homeBased.length
      ? `${homeBased.length === 1 ? "One listing near" : `${homeBased.length} listings near`} ${location} actually reads as home-based. Everything in a suite, a business park, or a storefront is out.`
      : `Nothing near ${location} reads as genuinely home-based — the listings here are offices, suites, and storefronts. These are the quietest independents instead, and I would widen the radius.`;
  } else if (brief?.requestedCount) {
    opener = `Here ${show.length === 1 ? "is the" : "are the"} **${show.length}** you asked for near ${location}.`;
  } else {
    opener = `Here's who I'd actually put on a call list near ${location}.`;
  }

  const news = cards.filter((item) => item.signals?.some((signal) => signal.kind === "expansion"));
  const closer = news.length
    ? `${news
        .map((item) => `**${item.name}** (${item.signals?.find((signal) => signal.kind === "expansion")?.label})`)
        .join(", ")} — open with that instead of the internet pitch.`
    : "I can brief one, scan what's new, or skip to the next.";
  return `${opener}\n\n${lines.join("\n")}\n\n${closer}`;
}

/**
 * True when the ask is about the business on screen rather than the whole list,
 * so pressing Next then "what's new" reads the new current business.
 */
function targetsCurrentOnly(text: string, session: LiveSession) {
  const current = currentProspect(session.queue);
  if (!current) return false;
  if (/\b(whole list|every business|all of them|each of them|the list)\b/i.test(text)) return false;
  if (/\b(this one|current|the one (?:we|i)(?:'re| are) on|them\b)/i.test(text)) return true;
  const tokens = current.name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  const hay = text.toLowerCase();
  return tokens.some((token) => hay.includes(token));
}

async function fulfillFollowThrough(session: LiveSession, brief: LiveBrief, trace: TurnTrace) {
  if (!session.queue?.prospects.length) return;
  if (brief.wantsNews) {
    const current = currentProspect(session.queue);
    const singleTarget = targetsCurrentOnly(brief.raw, session) && current;
    if (singleTarget && current) {
      if (!trace.scannedNews.has(current.id)) {
        await trackStep(trace, `Scanning local news on ${current.name}`, current.address);
        const scanned = await scanLocalNews(current);
        if (scanned.signal) {
          current.signals = [...(current.signals ?? []).filter((item) => item.kind !== "expansion"), scanned.signal];
        }
        trace.scannedNews.add(current.id);
        await trackSources(trace, scanned.sources);
      }
    } else {
      const scanned = await scanLocalNewsForQueue(session.queue, 4, trace.scannedNews);
      if (scanned.businesses.length) {
        await trackStep(
          trace,
          `Scanning local news around ${session.queue.locationLabel}`,
          `${scanned.businesses.length} ${scanned.businesses.length === 1 ? "listing" : "listings"}`,
        );
        for (const item of scanned.businesses) trace.scannedNews.add(item.id);
        await trackSources(trace, scanned.sources);
      }
    }
  }
  if (brief.wantsGenuineCheck && !trace.checkedListings) {
    for (const prospect of session.queue.prospects) checkListing(prospect);
    trace.checkedListings = true;
    await trackStep(trace, "Checking which listings look like real local shops", `${session.queue.prospects.length} on the list`);
  }
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
  if (session.brief && briefNeedsFollowThrough(session.brief)) {
    await fulfillFollowThrough(session, session.brief, trace);
  }
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
    return formatListReply(session.queue.prospects.map(compactProspect), session.queue.locationLabel, session.brief ?? null);
  }
  const location = extractPlace(text);
  if (location && (looksLikeFind(text) || !currentProspect(session.queue))) {
    await trackStep(trace, `Searching Google Maps near ${location}`, liveSearchDetail());
    const found = await findBusinesses({
      location,
      limit: session.brief?.requestedCount,
      profile: session.brief?.profile,
      excludeNational: session.brief?.excludeNational,
      category: session.brief?.categoryHint,
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
    return formatListReply(found.cards, found.queue.locationLabel, session.brief ?? null);
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
  const trace: TurnTrace = {
    steps: [],
    sources: [],
    searched: false,
    scannedNews: new Set<string>(),
    checkedListings: false,
    emit,
  };

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
  session.brief = mergeLiveBrief(session.brief ?? null, parseLiveBrief(text));
  const brief = session.brief;

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

  const named = extractPlace(text);
  // "find 3 businesses nearby" has no place in it, but the rep means the
  // territory we already worked. Falling through here is how the model ends up
  // inventing names, so resolve it before the model gets a chance.
  const territory = rememberedTerritory(memory);
  const wantsFreshList =
    looksLikeFind(text) &&
    (!session.queue?.prospects.length ||
      /\b(nearby|near me|around here|in the area|this area|my territory|same area|more|another list|again)\b/i.test(text));
  const location = named ?? (wantsFreshList ? territory : null);
  const mostlyLocation = Boolean(named) && text.length <= (named?.length ?? 0) + 24;
  const extraAsk =
    looksLikeBroadband(text) ||
    looksLikeOutreach(text) ||
    looksLikePrioritize(text) ||
    briefNeedsFollowThrough(brief);
  // "What's new with Cory Hughes, LLC" reads as a place to the location parser.
  // If they named the business already on screen, they want that one, not a search.
  const aboutCurrent = targetsCurrentOnly(text, session);
  const identifyAsked =
    Boolean(named) && (looksLikeIdentify(text) || (/^\s*(?:what(?:'s| is)|who(?:'s| is)|this)\b/i.test(text) && !looksLikeFind(text))) &&
    !looksLikeFind(text);
  const wantsList =
    Boolean(location) &&
    !aboutCurrent &&
    !identifyAsked &&
    (looksLikeFind(text) || !currentProspect(session.queue) || mostlyLocation);

  // Asking what sits at an address is a lookup, not a prospecting run. Handling
  // it here keeps it to one scrape and skips the model round trip entirely.
  if (identifyAsked && named) {
    await trackStep(trace, `Looking up what is at ${named}`, liveSearchDetail());
    try {
      const identified = await identifyAddress(named);
      if (identified.prospects.length) {
        session.queue = {
          locationLabel: identified.resolved,
          radiusMiles: 0.15,
          category: null,
          currentIndex: 0,
          prospects: identified.prospects,
        };
      }
      await trackSources(trace, identified.sources);
      await publish(formatIdentifyReply(identified));
    } catch {
      await publish(`I could not resolve **${named}**. Give me the street, city, and ZIP and I will try again.`);
    }
  }

  if (wantsList && location) {
    const trySearch = async (place: string) => {
      await trackStep(trace, `Searching Google Maps near ${place}`, liveSearchDetail());
      const found = await findBusinesses({
        location: place,
        limit: brief.requestedCount,
        profile: brief.profile,
        excludeNational: brief.excludeNational,
        category: brief.categoryHint,
      });
      session.queue = found.queue;
      trace.searched = true;
      await trackSources(trace, found.sources);
      await trackStep(
        trace,
        `Ranking ${found.cards.length} ${found.cards.length === 1 ? "listing" : "listings"}`,
        found.dropped ? `${found.via} · dropped ${found.dropped} chain/retail stops` : found.via,
      );
      await rememberFact({
        kind: "territory",
        text: `Working territory: ${found.queue.locationLabel} (${found.queue.radiusMiles} mi)`,
      });
      if (brief.profile === "home_based") {
        await rememberFact({
          kind: "preference",
          text: "Look for home-based / owner-run shops. Skip gas, big-box, and national chains.",
        });
      }
      memory = await loadMemory();
      if (!extraAsk) await publish(formatListReply(found.cards, found.queue.locationLabel, brief));
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

  // No place, no memory, no list: there is nothing real to answer from, and the
  // model will fill the gap with invented shops if we let it near the question.
  if (!content && looksLikeFind(text) && !location && !session.queue?.prospects.length) {
    await publish(
      "I do not have a territory yet, and I will not guess business names. Give me a city, a ZIP, or a street address and I will pull real listings.",
    );
  }

  if (!content && looksLikeRoute(text) && session.queue?.prospects.length) {
    const route = planWalkingRoute(session.queue);
    if (route) {
      await trackStep(
        trace,
        `Putting ${route.stops.length} stops in walking order`,
        `${route.totalMiles.toFixed(1)} mi on foot`,
      );
      await publish(formatRouteReply(route));
    }
  }

  // Next has to move the queue itself. Left to the model it will happily narrate
  // the next business without advancing, and then "what's new" reads row one.
  if (!content && looksLikeSkip(text) && session.queue?.prospects.length) {
    const skipped = skipQueue(session.queue);
    if (skipped) {
      session.queue = {
        locationLabel: skipped.locationLabel,
        radiusMiles: skipped.radiusMiles,
        category: skipped.category,
        currentIndex: skipped.currentIndex,
        prospects: skipped.prospects,
      };
      const moved = currentProspect(session.queue);
      if (moved) {
        await trackStep(
          trace,
          `Moving to ${moved.name}`,
          `${session.queue.currentIndex + 1} of ${session.queue.prospects.length}`,
        );
        if (!extraAsk) {
          await publish(
            formatSkipReply(compactProspect(moved), session.queue.currentIndex + 1, session.queue.prospects.length),
          );
        }
      }
    }
  }

  if (session.queue && extraAsk) {
    await fulfillFollowThrough(session, brief, trace);
  }

  if (!content && liveConfigured()) {
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(memory, session.queue, brief) },
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
          await publish(formatListReply(session.queue.prospects.map(compactProspect), session.queue.locationLabel, brief));
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

  // Last line of defence. If there is no list, any reply that reads like one is
  // invented, because every real name on screen comes from the queue.
  if (!session.queue?.prospects.length && looksLikeInventedList(content)) {
    await trackStep(trace, "Dropped an answer that named businesses I never pulled", "No list in this session");
    await publish(
      "I nearly answered with business names I never pulled, so I stopped. I only report listings from a real search. Give me a city, a ZIP, or a street address and I will run one.",
    );
  }

  if (looksLikeDemo(content) || looksIncomplete(content) || (hasBusinessTable(content) && session.queue)) {
    if (session.queue) {
      await publish(formatListReply(session.queue.prospects.map(compactProspect), session.queue.locationLabel, brief));
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
