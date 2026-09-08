import {
  isLiveNext,
  isLiveRetry,
  isLiveSearchRequest,
  parseLiveBrief,
  repairSelfCorrection,
  researchQuestionLabel,
} from "@/lib/live/intent";
import { businessNameTokens, foldBusinessName } from "@/lib/business-identity";
import type { LivePendingLookup } from "@/lib/live/types";

/** A named lookup the rep is still owed an answer on. */
export type ClarifiedLookup = {
  /** Best current spelling of the business. */
  name: string;
  /** Carried from the original request unless the rep named a new place. */
  location: string | null;
  /** The question that outlived the name correction, e.g. "who owns this specific location". */
  question: string | null;
  /** The original request, restated so the answer stays on topic. */
  request: string;
  /** Extra words the rep used to describe the place ("the coffee place"). */
  descriptor: string | null;
};

const PENDING_TTL_MS = 45 * 60 * 1000;

/** "no, I mean it's actually called …" — throat clearing in front of the real answer. */
const CLARIFY_LEAD_IN =
  /^(?:(?:no|nope|nah|yeah|yes|well|um|uh|ok|okay|sorry|oops)\b[\s,.!-]*)*(?:i\s+(?:mean|meant)|it'?s\s+(?:called|actually|named)|they'?re\s+called|the\s+name\s+is|its\s+called|actually|instead|rather|try|maybe|probably|should\s+be|more\s+like|meant)?\b[\s,.:!-]*/i;

/** Words that describe a business without naming it. */
const DESCRIPTOR_WORDS =
  /\b(?:place|spot|shop|store|stand|one|business|company|location|branch|joint|drive[\s-]?thru|coffee|pizza|burger|donut|barber|salon|bakery|deli|garage|dealership|gym|hotel|motel|bank|clinic|dental|vet)\b/i;

const NOT_A_CLARIFICATION =
  /\b(?:how|why|what\s+(?:do|does|should|is|are)|explain|thanks|thank\s+you|stop|hold\s+on|call\s+them|write|draft|email|script|pitch|route|walk|map|memory|remember|forget|start\s+over|new\s+search)\b/i;

function words(value: string) {
  return value.split(/\s+/).filter(Boolean);
}

/** Strip the correction framing and any trailing "location"/"store" descriptor. */
function clarificationCore(text: string) {
  let value = repairSelfCorrection(text).replace(/[?!.]+$/g, "").trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const next = value.replace(CLARIFY_LEAD_IN, "").trim();
    if (next === value) break;
    value = next;
  }
  return value.replace(/^["“']|["”']$/g, "").trim();
}

function stateOf(location: string | null | undefined) {
  return location?.match(/,\s*([A-Za-z]{2})$/)?.[1]?.toUpperCase() ?? null;
}

/** "Travelers Rest location" refines the place, it does not rename the business. */
function placeRefinement(core: string, pending: LivePendingLookup) {
  const match = /^(?:the\s+)?(.+?)\s+(?:location|store|shop|branch|site)$/i.exec(core);
  if (!match) return null;
  const place = match[1].trim();
  if (!looksNamey(place)) return null;
  const state = stateOf(pending.location);
  const pendingCity = pending.location?.split(",")[0]?.trim() ?? "";
  if (pendingCity && foldBusinessName(pendingCity) === foldBusinessName(place)) return pending.location;
  return state ? `${place}, ${state}` : place;
}

function looksNamey(value: string) {
  return /[A-Z0-9]/.test(value) && /[A-Za-z]/.test(value);
}

/** Distinct words that make a name a name, ignoring filler. */
function coreWords(value: string) {
  return businessNameTokens(value).filter((word) => word.length > 1);
}

function sharesWord(left: string, right: string) {
  const other = new Set(coreWords(right));
  return coreWords(left).some((word) => other.has(word));
}

/**
 * Is this short turn a correction of the business we are already researching?
 * Anything that reads as a fresh discovery request, a command, or a new question
 * is left alone so ordinary search keeps working.
 */
export function isLookupClarification(text: string, pending: LivePendingLookup | null) {
  if (!pending) return false;
  const raw = text.trim();
  if (!raw || raw.startsWith("/")) return false;
  if (Date.now() - Date.parse(pending.askedAt) > PENDING_TTL_MS) return false;
  if (isLiveRetry(raw) || isLiveNext(raw)) return false;
  if (NOT_A_CLARIFICATION.test(raw)) return false;

  const core = clarificationCore(raw);
  if (!core || words(core).length > 6) return false;

  // A real discovery request names a category or a count and asks to find things.
  const brief = parseLiveBrief(core);
  if (isLiveSearchRequest(core) && !brief.targetName) return false;
  if (brief.requestedCount) return false;
  if (/\b(?:businesses|prospects|leads|listings|places|shops|companies)\b/i.test(core)) return false;

  if (placeRefinement(core, pending)) return true;
  if (pending.name && sharesWord(core, pending.name)) return true;
  if (DESCRIPTOR_WORDS.test(core) && /^(?:the|that)\b/i.test(core)) return true;
  if (pending.suggestion && sharesWord(core, pending.suggestion)) return true;
  // A bare proper-ish name with no verb is a spelling, not an instruction.
  return looksNamey(core) && coreWords(core).length > 0 && !/\b(?:find|search|show|pull|give|get)\b/i.test(core);
}

/**
 * Fold a short correction into the request it belongs to: the corrected name,
 * the location the rep already gave, and the question they actually asked.
 */
export function resolveLookupClarification(text: string, pending: LivePendingLookup | null): ClarifiedLookup | null {
  if (!pending || !isLookupClarification(text, pending)) return null;
  const core = clarificationCore(text);
  const refined = placeRefinement(core, pending);
  const spoken = parseLiveBrief(core);
  const namedPlace = spoken.locationHint;

  let name = pending.name;
  let descriptor: string | null = null;
  if (refined) {
    name = pending.suggestion ?? pending.name;
  } else if (DESCRIPTOR_WORDS.test(core) && /^(?:the|that)\b/i.test(core) && !looksNamey(core.replace(/^(?:the|that)\s+/i, ""))) {
    descriptor = core.replace(/^(?:the|that)\s+/i, "").trim();
    name = pending.suggestion ?? pending.name;
  } else {
    // The spoken name wins; a place spoken with it is a location, not a name.
    const spelled = namedPlace ? core.replace(new RegExp(`\\b${escapeRegExp(namedPlace.split(",")[0])}\\b.*$`, "i"), "").trim() : core;
    const cleaned = spelled
      .replace(/[,;]+$/g, "")
      .replace(/^(?:in|near|at)\s+/i, "")
      .replace(/\s+(?:in|near|at|on|the)$/i, "")
      .trim();
    // Nothing left once the place is removed: they corrected where, not who.
    if (!cleaned && namedPlace) name = pending.suggestion ?? pending.name;
    else if (cleaned) name = cleaned;
    // They confirmed the name public sources use, so search that spelling.
    if (
      name &&
      pending.suggestion &&
      sharesWord(name, pending.suggestion) &&
      coreWords(pending.suggestion).length >= coreWords(name).length
    ) {
      name = pending.suggestion;
    }
  }

  if (!name) return null;

  const location = refined ?? namedPlace ?? pending.location ?? null;
  return {
    name,
    location,
    question: pending.question,
    request: pending.raw,
    descriptor,
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remember an unresolved named lookup so the next short turn can fix the name. */
export function pendingFromLookup(input: {
  name: string;
  location: string | null;
  request: string;
  suggestion?: string | null;
}): LivePendingLookup {
  return {
    name: input.name,
    location: input.location,
    question: researchQuestionLabel(input.request),
    raw: input.request.replace(/\s+/g, " ").trim().slice(0, 400),
    suggestion: input.suggestion ?? null,
    askedAt: new Date().toISOString(),
  };
}

function editDistance(left: string, right: string) {
  if (left === right) return 0;
  const rows = left.length + 1;
  const columns = right.length + 1;
  let previous = Array.from({ length: columns }, (_, index) => index);
  for (let row = 1; row < rows; row += 1) {
    const current = [row];
    for (let column = 1; column < columns; column += 1) {
      current[column] = Math.min(
        previous[column] + 1,
        current[column - 1] + 1,
        previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[columns - 1];
}

function allowedSlips(word: string) {
  if (word.length <= 3) return 0;
  return word.length <= 5 ? 1 : 2;
}

/**
 * The rep half-heard a name and spelled it wrong. Search results usually contain
 * the real one, so offer the closest public spelling instead of guessing.
 */
export function suggestNameCorrection(
  name: string,
  findings: Array<{ title: string; snippet?: string }>,
  location?: string | null,
) {
  const wanted = coreWords(name);
  if (!wanted.length) return null;
  const city = location ? foldBusinessName(location.split(",")[0]) : "";
  const scored: Array<{ label: string; slips: number }> = [];

  for (const finding of findings) {
    const label = businessLabel(finding.title);
    if (!label) continue;
    const candidates = coreWords(label).filter((word) => word !== city);
    if (!candidates.length) continue;
    let slips = 0;
    let matched = 0;
    for (const word of wanted) {
      if (word === city) continue;
      let best = Infinity;
      for (const candidate of candidates) {
        best = Math.min(best, editDistance(word, candidate));
      }
      if (best <= allowedSlips(word)) {
        slips += best;
        matched += 1;
      }
    }
    const required = wanted.filter((word) => word !== city).length;
    if (matched >= Math.max(1, required - 1) && slips > 0) scored.push({ label, slips });
  }

  scored.sort((left, right) => left.slips - right.slips);
  const best = scored[0];
  if (!best) return null;
  return foldBusinessName(best.label) === foldBusinessName(name) ? null : best.label;
}

/** Search titles carry site chrome: "7 Brew Coffee | Travelers Rest, SC - Menu". */
function businessLabel(title: string) {
  const head = title.split(/\s+[|·—–]\s+|\s+-\s+/)[0]?.replace(/\s+/g, " ").trim() ?? "";
  if (!head || head.length > 60) return "";
  if (/^(?:home|about|menu|contact|locations?|order online|welcome)$/i.test(head)) {
    const next = title.split(/\s+[|·—–]\s+|\s+-\s+/)[1]?.trim() ?? "";
    return next.length && next.length <= 60 ? next : "";
  }
  return head;
}
