import {
  createSession,
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
  researchProspect,
  skipQueue,
  toSource,
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

const TOOL_PHRASING: Array<[RegExp, string]> = [
  [/\bfind_businesses\b/g, "the area search"],
  [/\bresearch_business\b/g, "a public records lookup"],
  [/\bcheck_broadband\b/g, "the FCC broadband map"],
  [/\bskip_to_next\b/g, "moving down the list"],
  [/\bdraft_outreach\b/g, "drafting the opener"],
  [/\bremember\b/g, "saving a note"],
];

/** gpt-oss thinks in raw scratchpad. Keep the whole thing, just make it readable. */
function readableReasoning(reasoning: string) {
  let text = reasoning.replace(/\s+/g, " ").trim();
  if (text.length < 8) return null;
  for (const [pattern, phrase] of TOOL_PHRASING) text = text.replace(pattern, phrase);
  text = text.replace(/\bcalling\b/gi, "using").replace(/\bcall\b/gi, "use");
  const sentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  const label = sentence.length > 88 ? `${sentence.slice(0, 85).trim()}…` : sentence;
  return {
    label: label.replace(/^(we|i)\s+/i, "").replace(/^./, (char) => char.toUpperCase()),
    thought: text.length > 900 ? `${text.slice(0, 900).trim()}…` : text,
  };
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
};

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type GroqResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
  error?: { message?: string };
};

const LIVE_MODEL_FALLBACK = "openai/gpt-oss-120b";

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
];

function groqConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function liveAssistantStatus() {
  return {
    groq: groqConfigured() ? "active" : "not_configured",
    model: process.env.LIVE_MODEL?.trim() || LIVE_MODEL_FALLBACK,
    fallback: "tool_router",
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
  const memoryBlock = memory.length
    ? memory.map((item) => `- (${item.kind}) ${item.text}`).join("\n")
    : "None yet.";
  const queueBlock = queue?.prospects.length
    ? queue.prospects
        .map((item, index) => {
          const mark = index === queue.currentIndex ? " ← current" : "";
          return `${index + 1}. ${item.name} · ${item.category} · ${item.distanceMiles.toFixed(1)} mi · fit ${item.score} · ${item.phone || "no phone"} · ${item.topOpportunity || item.summary || item.category}${mark}`;
        })
        .join("\n")
    : "No current list.";
  return `You are Live, PAI's full-time sales prospecting assistant.

You help a field rep find nearby businesses worth contacting, brief them in chat, draft openers, and keep moving. Talk like a sharp colleague, not a chatbot.

Rules:
- Never invent businesses, phone numbers, websites, hours, owners, or events.
- Only use tool results and the current list. If you do not know, say so and look it up.
- This is not recruiting. Ignore hiring, jobs, and careers.
- Call find_businesses only with a place the user actually named, or the remembered territory. Never guess a location from a business name, and never search a place the user did not give you.
- If they already have a list and ask who to call, rank from the current list. Do not search again.
- When they ask about one company, call research_business if you need public facts you do not already have.
- If they name a business that is not on the current list and you have no territory, ask which city or ZIP it is in. Do not search for it blind.
- When they ask who is available, who serves an address, what providers are there, or what speeds they can get, call check_broadband. Use scope "territory" if they said the area, around here, or the list; use scope "business" for one company. Never answer availability from memory, and report it as FCC provider-reported data rather than a confirmed install.
- In broadband results, providerCount and providers cover every provider. charterSpectrum describes Charter/Spectrum only, so never read a not_reported Charter tier as "no providers serve this address".
- When they say skip, next, or similar, call skip_to_next.
- When they ask to write, draft, open, or email, call draft_outreach. Ground every line in the returned facts. Do not invent a new pitch.
- Call remember only for durable facts that will help later (territory, industries, already-contacted names, working style). Never remember the whole chat.
- Lead with the useful answer. If you found businesses, say how many are worth talking to, then name the strongest two or three with why, distance, and phone when you have it. The full list is already on screen, so do not repeat every row.
- Keep replies tight. Usually under 140 words, except emails, which can run a short paragraph.
- Write in markdown the UI can render: **bold** names, numbered lists when ranking, a short ## heading only when splitting a brief from a draft. No tables, no emoji, no horizontal rules.

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
const READ_ONLY_TOOLS = new Set(["research_business", "check_broadband"]);

async function runTool(
  name: string,
  args: Record<string, unknown>,
  session: LiveSession,
  trace: TurnTrace,
) {
  if (name === "find_businesses") {
    const location = typeof args.location === "string" ? args.location : "";
    await trackStep(trace, `Searching public listings near ${location || "that area"}`, "PAI Places · OpenStreetMap");
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
      "Contactable first, then fit and distance",
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
      })),
      note: found.cards.length
        ? "These are real listings from public sources. Recommend only these. The full list is already rendered for the user, so highlight two or three."
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

  if (name === "remember") {
    const kind = args.kind;
    const fact = typeof args.fact === "string" ? args.fact : "";
    if (kind !== "territory" && kind !== "preference" && kind !== "contacted" && kind !== "note") {
      return { ok: false, error: "Unsupported memory kind." };
    }
    const memory = await rememberFact({ kind, text: fact });
    await trackStep(trace, "Saving that for later", fact.slice(0, 90));
    return { ok: true, saved: fact, memoryCount: memory.length };
  }

  return { ok: false, error: `Unknown tool ${name}` };
}

/** Free-tier Groq keys sit on a tight tokens-per-minute budget, so a 429 is expected traffic. */
function retryDelayMs(message: string, attempt: number) {
  const suggested = message.match(/try again in ([\d.]+)\s*s/i);
  if (suggested) return Math.min(12_000, Math.ceil(Number(suggested[1]) * 1000) + 400);
  return Math.min(12_000, 900 * 2 ** attempt);
}

async function groqChat(messages: ChatMessage[], tools = true) {
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) throw new Error("Live is not configured.");
  const model = process.env.LIVE_MODEL?.trim() || LIVE_MODEL_FALLBACK;
  const baseUrl = (process.env.LIVE_BASE_URL?.trim() || process.env.RADAR_BRIEF_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/$/, "");

  let lastError = "Live could not reach the model.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.25,
        max_tokens: 850,
        reasoning_effort: "low",
        messages,
        ...(tools ? { tools: TOOLS, tool_choice: "auto" } : {}),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(24_000),
    });
    const payload = (await response.json()) as GroqResponse;
    if (response.ok) return payload.choices?.[0]?.message;

    lastError = payload.error?.message || lastError;
    if (response.status !== 429 && response.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(lastError, attempt)));
  }
  throw new Error(lastError);
}

function looksLikeFind(text: string) {
  return /\b(find|search|look(?:ing)? for|show me|who(?:'s| is) near|businesses? (?:in|near|around))\b/i.test(text);
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

function extractLocation(text: string) {
  const quoted = text.match(/["“]([^"”]{3,80})["”]/);
  if (quoted) return quoted[1];
  const zip = text.match(/\b\d{5}(?:-\d{4})?\b/);
  if (zip) {
    const around = text.match(new RegExp(`([A-Za-z][A-Za-z .'-]{2,40},?\\s*[A-Z]{2}\\s*)?${zip[0]}`));
    return (around?.[0] || zip[0]).trim();
  }
  const near = text.match(/\b(?:in|near|around)\s+([A-Za-z0-9][A-Za-z0-9 .,'-]{2,60})$/i);
  if (near) return near[1].replace(/[?.!]+$/, "").trim();
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
    await trackStep(trace, `Searching public listings near ${location}`, "PAI Places · OpenStreetMap");
    const found = await findBusinesses({ location });
    session.queue = found.queue;
    trace.searched = true;
    await trackSources(trace, found.sources);
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
  let attachedProspects: LiveProspectCard[] | undefined;
  let content = "";

  if (groqConfigured()) {
    await trackStep(trace, "Reading your message", null);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(memory, session.queue) },
      // The free tier caps tokens per minute, and an oversized history buys backoff, not accuracy.
      ...session.messages.slice(-6).map((item) => ({ role: item.role, content: item.content.slice(0, 900) })),
    ];
    try {
      for (let round = 0; round < 4; round += 1) {
        const reply = await groqChat(messages);
        if (!reply) break;
        if (reply.reasoning) {
          const thinking = readableReasoning(reply.reasoning);
          if (thinking) await trackStep(trace, thinking.label, null, thinking.thought);
        }
        if (reply.tool_calls?.length) {
          const calls = reply.tool_calls;
          messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: calls });

          // Lookups only read the queue, so fan them out. Anything that mutates
          // session state still runs in order to keep writes deterministic.
          const parallel = calls.length > 1 && calls.every((call) => READ_ONLY_TOOLS.has(call.function.name));
          const results = parallel
            ? await Promise.all(calls.map((call) => runTool(call.function.name, parseArgs(call.function.arguments), session, trace)))
            : await calls.reduce<Promise<unknown[]>>(
                async (chain, call) => [
                  ...(await chain),
                  await runTool(call.function.name, parseArgs(call.function.arguments), session, trace),
                ],
                Promise.resolve([]),
              );

          for (const [index, call] of calls.entries()) {
            if (call.function.name === "find_businesses" && session.queue) {
              attachedProspects = session.queue.prospects.map(compactProspect);
            }
            if (call.function.name === "remember") memory = await loadMemory();
            messages.push({
              role: "tool",
              tool_call_id: call.id,
              content: JSON.stringify(results[index]),
            });
          }
          continue;
        }
        content = (reply.content || "").trim();
        break;
      }
      await trackStep(trace, "Writing the answer", null);
    } catch (modelError) {
      // Tool results are already in hand, so answer from them instead of losing the turn.
      const reason = modelError instanceof Error ? modelError.message : "";
      await trackStep(trace, "Answering from what I already pulled", /rate limit/i.test(reason) ? "Model was rate limited" : null);
    }
    if (!content) content = await heuristicReply(text, session, trace);
  } else {
    await trackStep(trace, "Working from the live business list", null);
    content = await heuristicReply(text, session, trace);
    if (session.queue) attachedProspects = session.queue.prospects.map(compactProspect);
  }

  if (looksLikeFind(text) && session.queue) attachedProspects = session.queue.prospects.map(compactProspect);

  const assistantMessage: LiveChatMessage = {
    id: liveId("msg"),
    role: "assistant",
    content,
    createdAt: new Date().toISOString(),
    prospects: attachedProspects,
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
