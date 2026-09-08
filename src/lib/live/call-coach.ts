import {
  collectLookupEvidence,
  customerSpeechFromRep,
  inventsUnverifiedNetwork,
  isHardRejection,
  promisesUnverifiedPriceWin,
  recommendsInPersonSelling,
  repProvidedNetworkFact,
} from "@/lib/live/sales-coach";

export type CallStage =
  | "introduction"
  | "reason_for_call"
  | "current_provider"
  | "satisfaction"
  | "price_value"
  | "operational"
  | "objection"
  | "qualification"
  | "buying_interest"
  | "closing"
  | "true_rejection";

export type CallFactSource = "inferred_from_rep" | "rep_stated" | "verified";

export type CallFactKey =
  | "provider"
  | "satisfaction"
  | "price"
  | "services"
  | "switching_resistance"
  | "decision_maker"
  | "callback"
  | "email"
  | "busy"
  | "buying_interest"
  | "hard_rejection"
  | "network";

export type CallFact = {
  key: CallFactKey;
  label: string;
  value: string;
  source: CallFactSource;
};

export type CoachBusiness = {
  name: string;
  location: string | null;
  website: string | null;
  /** Company-specific public trigger. Never treated as Spectrum construction. */
  publicTrigger: string | null;
};

export type CallCoachState = {
  business: CoachBusiness;
  utterances: string[];
  facts: CallFact[];
  stage: CallStage;
  hardRejected: boolean;
  explicitRejectionCount: number;
  softPivotsUsed: number;
  introduced: boolean;
  askedProvider: boolean;
  askedSatisfaction: boolean;
  askedPrice: boolean;
  askedOperational: boolean;
  askedConditionalLook: boolean;
  networkVerified: boolean;
};

export type CallCoachSuggestion = {
  line: string;
  goal: string;
  why: string;
  stage: CallStage;
  heardCustomer: false;
  customerInference: string | null;
};

export type CallCoachView = {
  state: CallCoachState;
  suggestion: CallCoachSuggestion;
  transcript: string;
};

export type CoachBusinessInput = {
  activeCompany?: {
    name?: string | null;
    location?: string | null;
    website?: string | null;
    findings?: Array<{ title: string; snippet: string; url?: string }>;
    publicTrigger?: string | null;
  } | null;
  queueCurrent?: {
    name?: string | null;
    address?: string | null;
    website?: string | null;
  } | null;
};

const FILLER = /^(?:uh|um|hmm+|mm+|hm|ah|eh)[.!?]?$/i;

const PROVIDER_NAMES = [
  "AT&T",
  "ATT",
  "Verizon",
  "Comcast",
  "Xfinity",
  "T-Mobile",
  "T Mobile",
  "CenturyLink",
  "Lumen",
  "Cox",
  "Spectrum",
  "Charter",
  "Windstream",
  "Frontier",
  "Optimum",
  "Altice",
  "WOW",
  "Mediacom",
  "EarthLink",
  "HughesNet",
  "Viasat",
  "Starlink",
  "Metronet",
  "Google Fiber",
  "FiOS",
  "Fios",
];

const PROVIDER_PATTERN = new RegExp(
  `\\b(${PROVIDER_NAMES.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`,
  "i",
);

const PROVIDER_ASK =
  /\b(?:who (?:do you|you currently) use|who you(?:'|’)re currently using|see who you currently use|currently using for internet)\b/i;
const SATISFACTION_ASK = /\bhow have they been treating you\b/i;
const PRICE_ASK = /\b(?:what are you paying|all-in right now|paying them all-in)\b/i;
const CONDITIONAL_ASK = /\b(?:if i could put together|open to taking a look|if there were an option)\b/i;
const OPERATIONAL_ASK = /\b(?:day-to-day operation|how does internet and phone fit|out on a job)\b/i;
const INTRO_LINE = /\b(?:recorded line|this is skylar|how are you today)\b/i;
const REASON_LINE = /\b(?:won(?:'|’)t keep you too long|only reason for my call)\b/i;

const SATISFACTION_ECHO =
  /\b(?:glad (?:they(?:'|’)(?:ve|re)|they have) been (?:treating you|taking care of you|good to you)|glad they(?:'|’)ve been taking care of you|i(?:'|’)m glad they(?:'|’)(?:ve|re) been taking care of you|that(?:'|’)s (?:great|good),?\s*i(?:'|’)m glad)\b/i;
const SWITCH_ECHO =
  /\b(?:understand not wanting to (?:switch|change)|not wanting to (?:switch|change)|completely understand.{0,40}switch)\b/i;
const HARD_ECHO =
  /\b(?:take you off the list|take them off the list|won(?:'|’)t call again|remove you from (?:the|our) list|do not call(?: me| us| again)?)\b/i;
const BUSY_ECHO = /\b(?:better time to call back|call you back|catch you later|sounds like you(?:'|’)re busy)\b/i;
const DECISION_ECHO = /\b(?:who (?:should i|handles) .{0,40}internet and phone|not the (?:decision|person)|ask (?:the |your )?(?:owner|boss|manager))\b/i;
const EMAIL_ECHO = /\b(?:i(?:'|’)ll send that over|send (?:that|it) over|email (?:that|it) over)\b/i;
const BUYING_ECHO =
  /\b(?:let me (?:check|run) (?:that )?address|i(?:'|’)ll check (?:that )?address|while i have you|i(?:'|’)ll put (?:a comparable option|something) (?:in front of you|together))\b/i;
const INTEREST_CONFIRM =
  /\b(?:you(?:'|’)d (?:be open|take a look)|sounds like you(?:'|’)d|you(?:'|’)re open to (?:looking|taking a look)|let(?:'|’)s do it|go ahead and (?:check|look))\b/i;

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function isFiller(text: string) {
  return !text || FILLER.test(text);
}

/** ASR hands back one segment per pause, so a sentence can arrive in pieces. */
const FRAGMENT_MAX_CHARS = 80;

function endsThought(text: string) {
  return /[.!?…][)"”'’]?$/.test(text);
}

function looksLikeFragmentOf(previous: string, next: string) {
  if (endsThought(previous)) return false;
  return previous.length <= FRAGMENT_MAX_CHARS && next.length <= FRAGMENT_MAX_CHARS;
}

function sameSegment(a: string, b: string) {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9&]+/g, " ")
      .trim();
  return normalize(a) === normalize(b);
}

export function coachNeedsBusinessMessage() {
  return "Select or research a business first, then type /livemode.";
}

export function resolveCoachBusiness(input: CoachBusinessInput): CoachBusiness | null {
  const named = input.activeCompany?.name?.trim();
  if (named) {
    const findings = input.activeCompany?.findings ?? [];
    const trigger =
      input.activeCompany?.publicTrigger?.trim() ||
      (findings.length
        ? collectLookupEvidence(named, input.activeCompany?.location ?? null, findings).trigger
        : null);
    return {
      name: named,
      location: input.activeCompany?.location?.trim() || null,
      website: input.activeCompany?.website?.trim() || null,
      publicTrigger: trigger || null,
    };
  }
  const listed = input.queueCurrent?.name?.trim();
  if (listed) {
    return {
      name: listed,
      location: input.queueCurrent?.address?.trim() || null,
      website: input.queueCurrent?.website?.trim() || null,
      publicTrigger: null,
    };
  }
  return null;
}

function fact(state: CallCoachState, key: CallFactKey) {
  return state.facts.find((item) => item.key === key) ?? null;
}

function upsertFact(state: CallCoachState, next: CallFact) {
  const index = state.facts.findIndex((item) => item.key === next.key);
  if (index >= 0) {
    const current = state.facts[index]!;
    if (current.source === "verified" && next.source !== "verified") return;
    if (current.source === "rep_stated" && next.source === "inferred_from_rep") return;
    state.facts = state.facts.map((item, itemIndex) => (itemIndex === index ? next : item));
    return;
  }
  state.facts = [...state.facts, next];
}

function displayProvider(raw: string) {
  const named = raw.replace(/\s+/g, " ").trim();
  if (/^att$/i.test(named)) return "AT&T";
  if (/^t[\s-]?mobile$/i.test(named)) return "T-Mobile";
  if (/^fios$/i.test(named)) return "FiOS";
  return named;
}

function lookingForProvider(text: string) {
  return PROVIDER_ASK.test(text) || /\bwho do you (?:currently )?use\b/i.test(text);
}

function echoingProvider(text: string) {
  if (lookingForProvider(text) && !/\b(?:oh|okay|ok|gotcha|nice|so you)\b/i.test(text)) return false;
  return (
    /\b(?:oh|okay|ok|gotcha|nice|ah|yeah|yep|wow)[,.]?\s+(?:so )?(?:you(?:r)?(?: guys| all)? (?:use|using|got|have)|you(?:'|’)re with)\b/i.test(
      text,
    ) ||
    /\byou(?:r)?(?: guys| all)? (?:use|using)\s+[A-Z]/i.test(text) ||
    /\byou(?:'|’)re with\s+[A-Z]/i.test(text) ||
    /\bso you(?:'|’)re (?:on|with)\b/i.test(text)
  );
}

function extractProvider(text: string) {
  const known = text.match(PROVIDER_PATTERN);
  if (known?.[1]) return displayProvider(known[1]);
  const captured = text.match(
    /\b(?:use|using|with)\s+([A-Z][A-Za-z0-9][A-Za-z0-9.&'+-]{0,32})\??/,
  );
  if (!captured?.[1]) return null;
  const value = captured[1].replace(/[?.,!]+$/, "");
  if (/^(?:internet|phone|service|them|that|this|it)$/i.test(value)) return null;
  return displayProvider(value);
}

function extractPrice(text: string) {
  const match =
    text.match(/\$\s*(\d{2,4}(?:\.\d{1,2})?)/) ||
    text.match(/\b(?:around|about|roughly)\s+\$?\s*(\d{2,4})\b/i) ||
    text.match(/\b(\d{2,4})\s+for internet\b/i);
  if (!match?.[1]) return null;
  const amount = match[1].replace(/\.00$/, "");
  return `about $${amount}`;
}

function extractServices(text: string) {
  const bits: string[] = [];
  if (/\binternet\b/i.test(text)) bits.push("internet");
  const mobile = text.match(/\b(\w+)\s+mobile lines?\b/i);
  if (mobile) bits.push(`${mobile[1].toLowerCase()} mobile lines`);
  else if (/\bmobile\b/i.test(text)) bits.push("mobile");
  if (/\b(?:phone|voice|lines?)\b/i.test(text) && !/mobile lines?/i.test(text)) bits.push("phone");
  return bits.length ? bits.join(" and ") : null;
}

function quotedCustomer(text: string) {
  const quoted = customerSpeechFromRep(text);
  return quoted !== clean(text) ? quoted : "";
}

function inferFromUtterance(state: CallCoachState, utterance: string) {
  const text = clean(utterance);
  const quoted = quotedCustomer(text);

  if (INTRO_LINE.test(text)) state.introduced = true;
  if (REASON_LINE.test(text) || lookingForProvider(text)) {
    state.introduced = true;
    state.askedProvider = true;
  }
  if (SATISFACTION_ASK.test(text)) state.askedSatisfaction = true;
  if (PRICE_ASK.test(text)) state.askedPrice = true;
  if (CONDITIONAL_ASK.test(text)) state.askedConditionalLook = true;
  if (OPERATIONAL_ASK.test(text)) state.askedOperational = true;
  if (repProvidedNetworkFact(text) || /\bwe(?:'|’)ve finished construction\b/i.test(text)) {
    state.networkVerified = true;
    upsertFact(state, {
      key: "network",
      label: "Network context",
      value: "Rep-supplied: construction / serviceability is confirmed for this call",
      source: "rep_stated",
    });
  }

  if (isHardRejection(quoted) || isHardRejection(text) || HARD_ECHO.test(text)) {
    state.hardRejected = true;
    state.explicitRejectionCount += 1;
    upsertFact(state, {
      key: "hard_rejection",
      label: "Hard rejection",
      value: "Customer asked to stop or be taken off the list",
      source: "inferred_from_rep",
    });
    return;
  }

  if (echoingProvider(text)) {
    const provider = extractProvider(text);
    if (provider) {
      upsertFact(state, {
        key: "provider",
        label: "Current provider",
        value: provider,
        source: "inferred_from_rep",
      });
    }
  }

  if (SATISFACTION_ECHO.test(text) && !SATISFACTION_ASK.test(text)) {
    upsertFact(state, {
      key: "satisfaction",
      label: "Satisfaction",
      value: "Seemed satisfied with the current provider",
      source: "inferred_from_rep",
    });
  }

  if (SWITCH_ECHO.test(text)) {
    upsertFact(state, {
      key: "switching_resistance",
      label: "Switching resistance",
      value: "Customer likely does not want to switch",
      source: "inferred_from_rep",
    });
  }

  const priceLike =
    /\$\s*\d{2,4}/.test(text) ||
    /\b(?:around|about|roughly)\s+\$?\s*\d{2,4}\b/i.test(text) ||
    /\b\d{2,4}\s+for internet\b/i.test(text);
  if (priceLike && /\b(?:oh wow|wow|around|about|so |for internet|all-in|a month|per month)\b/i.test(text)) {
    const price = extractPrice(text);
    if (price) {
      upsertFact(state, {
        key: "price",
        label: "All-in spend",
        value: price,
        source: "inferred_from_rep",
      });
    }
    const services = extractServices(text);
    if (services) {
      upsertFact(state, {
        key: "services",
        label: "Services",
        value: services,
        source: "inferred_from_rep",
      });
    }
  }

  if (BUSY_ECHO.test(text)) {
    upsertFact(state, {
      key: "busy",
      label: "Timing",
      value: "Customer sounded busy",
      source: "inferred_from_rep",
    });
  }
  if (DECISION_ECHO.test(text)) {
    upsertFact(state, {
      key: "decision_maker",
      label: "Decision maker",
      value: "This person may not decide internet and phone",
      source: "inferred_from_rep",
    });
  }
  if (EMAIL_ECHO.test(text)) {
    upsertFact(state, {
      key: "email",
      label: "Follow-up",
      value: "They asked for information to be sent",
      source: "inferred_from_rep",
    });
  }
  if (BUYING_ECHO.test(text) || INTEREST_CONFIRM.test(text)) {
    upsertFact(state, {
      key: "buying_interest",
      label: "Buying interest",
      value: "Open to looking at a comparable option",
      source: "inferred_from_rep",
    });
  }
}

function openingReason(state: CallCoachState) {
  if (state.networkVerified) {
    return "by popular request we've recently been able to get our high-powered services out there and we've finished construction in the area";
  }
  const trigger = state.business.publicTrigger?.replace(/\.$/, "").trim();
  if (trigger) return `I saw ${trigger}`;
  return "I'm working with a few businesses in the area on internet and phone";
}

function introLine() {
  return "Hey, this is Skylar with Spectrum Business on a recorded line. How are you today?";
}

function reasonLine(state: CallCoachState) {
  return `Good, good — glad to hear it. Hey look, I won't keep you too long. The only reason for my call is ${openingReason(state)}. I wanted to see who you currently use for internet and phone service.`;
}

function satisfactionLine(provider: string | null) {
  if (provider) return `Gotcha. How have they been treating you overall?`;
  return "Gotcha. How have they been treating you overall?";
}

function priceLine() {
  return "Just out of curiosity before I let you go — about what are you paying them all-in right now?";
}

function conditionalLine() {
  return "That's actually pretty solid. If I could put together something comparable that either saved you money or gave you more value for around the same spend, would you at least be open to taking a look?";
}

function operationalLine() {
  return "How does internet and phone fit into the day-to-day operation here?";
}

function wrapLine() {
  return "Totally fair. I won't take more of your time — if the bill or the service ever changes, I'm an easy callback.";
}

function stopLine() {
  return "Understood. I'll take you off the list. Sorry to bother you.";
}

function latestInference(state: CallCoachState) {
  const inferred = [...state.facts].reverse().find((item) => item.source === "inferred_from_rep");
  if (!inferred) return null;
  return `Likely customer detail: ${inferred.label} = ${inferred.value}`;
}

function guardLine(line: string, state: CallCoachState) {
  let next = line;
  if (promisesUnverifiedPriceWin(next)) next = conditionalLine();
  if (!state.networkVerified && inventsUnverifiedNetwork(next)) next = conditionalLine();
  if (recommendsInPersonSelling(next)) next = "Let me check that address while I have you. What's the best callback number if we get disconnected?";
  return next;
}

function pickMove(state: CallCoachState): Omit<CallCoachSuggestion, "heardCustomer" | "customerInference"> {
  if (state.hardRejected) {
    return {
      line: stopLine(),
      goal: "Stop. Do not keep selling.",
      why: "That was a hard no, not a discovery objection.",
      stage: "true_rejection",
    };
  }

  if (fact(state, "busy") && !fact(state, "buying_interest")) {
    return {
      line: "When is a better time to call back?",
      goal: "Book a callback.",
      why: "They sounded busy. Stay on the phone for a time, then hang up cleanly.",
      stage: "closing",
    };
  }
  if (fact(state, "email") && !fact(state, "buying_interest")) {
    return {
      line: "I'll send that over. Anything specific you want in it?",
      goal: "Send what they asked for.",
      why: "They asked for information. Keep leftover discovery on this call or that send.",
      stage: "closing",
    };
  }
  if (fact(state, "decision_maker") && !fact(state, "buying_interest")) {
    return {
      line: "Who should I speak with about internet and phone for the business?",
      goal: "Find the decision maker.",
      why: "This person may not own internet and phone.",
      stage: "qualification",
    };
  }
  if (fact(state, "buying_interest")) {
    return {
      line: "If I can put a comparable option in front of you, I'll do that while I have you. What's the address I should check?",
      goal: "Move toward a quote on this call.",
      why: "Interest is on the table. Check the address. Don't invent availability.",
      stage: "buying_interest",
    };
  }

  const provider = fact(state, "provider")?.value ?? null;
  const satisfied = Boolean(fact(state, "satisfaction"));
  const resisted = Boolean(fact(state, "switching_resistance"));
  const priced = Boolean(fact(state, "price"));

  if (provider && !state.askedSatisfaction && !satisfied) {
    return {
      line: satisfactionLine(provider),
      goal: "Learn how the provider is treating them.",
      why: `They likely named ${provider}. Confirm it, then ask how it's going.`,
      stage: "satisfaction",
    };
  }

  if ((satisfied || resisted || (provider && state.askedSatisfaction)) && !priced && !state.askedPrice) {
    if (satisfied || resisted) state.softPivotsUsed = Math.max(state.softPivotsUsed, 1);
    return {
      line: priceLine(),
      goal: "Learn all-in spend.",
      why: "Soft satisfaction is not a dead lead. Earn the bill before you leave.",
      stage: satisfied || resisted ? "objection" : "price_value",
    };
  }

  if (priced && !state.askedConditionalLook) {
    if (satisfied || resisted) state.softPivotsUsed = Math.max(state.softPivotsUsed, 2);
    return {
      line: conditionalLine(),
      goal: "Test buying interest without promising a win.",
      why: "Stay conditional. Don't promise a lower price.",
      stage: "price_value",
    };
  }

  if ((resisted || satisfied) && !state.askedOperational && state.softPivotsUsed < 3) {
    state.softPivotsUsed = Math.max(state.softPivotsUsed, 3);
    return {
      line: operationalLine(),
      goal: "One more discovery pivot.",
      why: "Still not a hard no. Ask how they actually use the service.",
      stage: "operational",
    };
  }

  if (state.askedConditionalLook && (resisted || state.softPivotsUsed >= 3) && !fact(state, "buying_interest")) {
    return {
      line: wrapLine(),
      goal: "Leave the door open.",
      why: "You earned the pivots. Don't keep selling through a final soft close.",
      stage: "closing",
    };
  }

  if (!state.introduced && !state.askedProvider && !provider) {
    return {
      line: introLine(),
      goal: "Identify current provider.",
      why: "Open, then get who they use. Don't invent a reason.",
      stage: "introduction",
    };
  }

  if (!state.askedProvider && !provider) {
    return {
      line: reasonLine(state),
      goal: "Identify current provider.",
      why: state.networkVerified
        ? "Use the construction context the rep already confirmed."
        : state.business.publicTrigger
          ? "Use the public company detail as the reason — not a guessed problem."
          : "No verified network claim, so keep the reason generic.",
      stage: "reason_for_call",
    };
  }

  if (state.askedProvider && !provider) {
    return {
      line: satisfactionLine(null),
      goal: "Identify current provider.",
      why: "After they name who they use, confirm it and ask how it's going.",
      stage: "current_provider",
    };
  }

  return {
    line: priceLine(),
    goal: "Keep discovery moving.",
    why: "Stay on the call. Don't invent pain, price, or fiber.",
    stage: "price_value",
  };
}

function deriveStage(state: CallCoachState, next: CallStage): CallStage {
  if (state.hardRejected) return "true_rejection";
  if (fact(state, "buying_interest")) return next === "closing" ? "closing" : "buying_interest";
  if (fact(state, "switching_resistance") && !fact(state, "price")) return "objection";
  if (fact(state, "price")) return next;
  if (fact(state, "satisfaction")) return next;
  if (fact(state, "provider")) return "current_provider";
  if (state.askedProvider) return "current_provider";
  if (state.introduced) return "reason_for_call";
  return "introduction";
}

function viewFrom(state: CallCoachState): CallCoachView {
  const move = pickMove(state);
  const stage = deriveStage(state, move.stage);
  state.stage = stage;
  const line = guardLine(move.line, state);
  return {
    state,
    transcript: state.utterances.join("\n\n"),
    suggestion: {
      line,
      goal: move.goal,
      why: move.why,
      stage,
      heardCustomer: false,
      customerInference: latestInference(state),
    },
  };
}

function cloneState(state: CallCoachState): CallCoachState {
  return {
    ...state,
    business: { ...state.business },
    utterances: [...state.utterances],
    facts: state.facts.map((item) => ({ ...item })),
  };
}

export function startCallCoach(business: CoachBusiness): CallCoachView {
  return viewFrom({
    business: { ...business },
    utterances: [],
    facts: [],
    stage: "introduction",
    hardRejected: false,
    explicitRejectionCount: 0,
    softPivotsUsed: 0,
    introduced: false,
    askedProvider: false,
    askedSatisfaction: false,
    askedPrice: false,
    askedOperational: false,
    askedConditionalLook: false,
    networkVerified: false,
  });
}

export function resetCallCoach(state: CallCoachState): CallCoachView {
  return startCallCoach(state.business);
}

export function applyRepUtterance(state: CallCoachState, utterance: string): CallCoachView {
  const text = clean(utterance);
  if (isFiller(text)) return viewFrom(cloneState(state));
  const next = cloneState(state);
  const previous = next.utterances.at(-1);

  // ASR sometimes returns the same segment twice. Counting it twice would
  // advance the call state on words the rep only said once.
  if (previous && sameSegment(previous, text)) return viewFrom(next);

  // "Oh okay, you guys use" + "AT&T?" is one sentence split across two
  // segments. Join it before inference so the fact is not missed.
  if (previous && looksLikeFragmentOf(previous, text)) {
    const joined = clean(`${previous} ${text}`);
    next.utterances = [...next.utterances.slice(0, -1), joined];
    inferFromUtterance(next, joined);
    return viewFrom(next);
  }

  next.utterances = [...next.utterances, text];
  inferFromUtterance(next, text);
  return viewFrom(next);
}

export function formatCoachSummary(state: CallCoachState) {
  const name = state.business.name;
  const inferred = state.facts.filter((item) => item.source === "inferred_from_rep" || item.source === "rep_stated");
  if (!inferred.length && !state.utterances.length) {
    return `**Live Coach — ${name}** ended. No useful call context yet. Customer audio was not captured. Nothing from this call was saved as permanent memory.`;
  }
  const rows = inferred.map((item) => `- ${item.label}: ${item.value} *(inferred from how you responded, not independently verified)*`);
  if (state.hardRejected) {
    rows.push("- Outcome: hard rejection — stop calling / take them off the list");
  } else if (fact(state, "buying_interest")) {
    rows.push("- Outcome: buying interest on the call");
  } else if (state.stage === "closing") {
    rows.push("- Outcome: left the door open");
  }
  const body = rows.length ? `\n\n${rows.join("\n")}` : "";
  return `**Live Coach — ${name}**\n\nCustomer audio was not captured. PAI did not hear the customer. Useful context below came only from how you responded.${body}\n\nNothing from this call was saved as permanent memory.`;
}

export function coachCopyForScan(view: CallCoachView) {
  return [view.suggestion.line, view.suggestion.why, view.suggestion.goal, view.suggestion.customerInference ?? ""].join("\n");
}
