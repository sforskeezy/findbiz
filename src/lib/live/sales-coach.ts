import { categoryStakes } from "@/lib/brief-fallback";
import type { Prospect } from "@/lib/types";

export type SalesFact = {
  label: string;
  value: string;
};

export type SalesEvidence = {
  prospectName: string;
  category: string;
  verified: SalesFact[];
  hypotheses: string[];
  unknowns: string[];
  trigger: string | null;
  discoveryQuestions: string[];
};

export type CompanyResearchView = {
  facts?: SalesFact[];
  findings?: Array<{ title: string; snippet: string; url?: string }>;
  warnings?: string[];
  summary?: string | null;
};

const COMPANY_BRIEF =
  /\b(?:brief me|prep(?:are)? me|what should i know before|before (?:i |we )?(?:call|dial) (?:them|this|that|her|him))\b/i;
const TELL_ABOUT_CURRENT =
  /\btell me (?:about|more about) (?:this|that|them|the (?:current |first )?(?:one|company|business|prospect))\b/i;
const KNOW_ABOUT_CURRENT =
  /\bwhat do (?:we|i) know about (?:them|this|that)\b/i;

export function looksLikeCompanyBrief(text: string) {
  const value = text.trim();
  if (/^(?:how|why|explain|what (?:does|do|is|are) (?:a|an|the|fiber|broadband))\b/i.test(value)) return false;
  if (COMPANY_BRIEF.test(value) || TELL_ABOUT_CURRENT.test(value) || KNOW_ABOUT_CURRENT.test(value)) return true;
  const named = value.match(/\btell me about\s+(?:the\s+)?([A-Za-z0-9])/i);
  if (named && /[A-Z0-9]/.test(named[1])) return true;
  return /\b(?:this|that|the current) (?:one|company|business|prospect)\b/i.test(value) &&
    /\b(?:brief|prep|research|look (?:it|them|this) up|again)\b/i.test(value);
}

/** Follow-ups that mean the active/current company, not a new named lookup. */
export function refersToCurrentCompany(text: string) {
  const value = text.trim();
  if (/\b(?:whole list|every business|all of them|each of them|the list)\b/i.test(value)) return false;
  if (/\b(?:brief me on|tell me about|prep(?:are)? me for)\s+(?!this\b|that\b|them\b|the (?:current |first )?(?:one|company|business|prospect)\b)/i.test(value)) {
    return false;
  }
  if (looksLikeCompanyBrief(value)) return true;
  if (/\b(?:this|that|the current) (?:one|company|business|prospect)\b/i.test(value)) return true;
  if (/\b(?:brief(?: me)? again|tell me more about them|what should i (?:ask|know about) them)\b/i.test(value)) return true;
  if (/\b(?:ask them|about them|call them)\b/i.test(value)) return true;
  return false;
}

export function neutralDiscoveryQuestion() {
  return "How does internet and phone fit into the day-to-day operation here?";
}

/** Generic category copy from listings and sales-copy — never a fact about this shop. */
const GENERIC_INDUSTRY =
  /\b(?:usually depend|teams often|teams usually|shops lean on|offices (?:need|move|juggle)|clinics usually|property (?:teams|management teams) (?:often|juggle)|lead with how\b|connectivity pain|feel connectivity pain|day to day, then walk the FCC)\b/i;

const TRIGGER_PATTERN =
  /\b(?:grand opening|now open|newly opened|opened (?:a |its |their )?(?:new |second )(?:location|warehouse|office|store|shop|facility|site)|second location|new location|(?:recent(?:ly)? )?expansion|expanding|acquired by|under new ownership|new owner|relocated|moved to|ribbon[- ]cutting)\b/i;

export function isGenericIndustryCopy(value: string) {
  const text = value.trim();
  if (!text) return true;
  if (/^Lead with how /i.test(text)) return true;
  if (GENERIC_INDUSTRY.test(text)) return true;
  if (/\b(?:often face|typically (?:have|need|struggle)|usually (?:have|need|juggle)|connectivity pain points?)\b/i.test(text)) {
    return true;
  }
  if (/\bfit\s+\d+\b/i.test(text) && /\b(?:pain|need|problem|switch|dissatisf|opportunity)\b/i.test(text)) return true;
  return false;
}

function listingNote(prospect: Prospect) {
  const notes = prospect.publicNotes?.trim();
  if (!notes || /fictitious|illustrative fixture|demonstrate the research workflow/i.test(notes)) return null;
  return notes;
}

function triggerFromText(value: string | null | undefined) {
  if (!value?.trim() || isGenericIndustryCopy(value)) return null;
  const match = value.match(TRIGGER_PATTERN);
  if (!match) return null;
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function collectSalesEvidence(prospect: Prospect, research: CompanyResearchView | null = null): SalesEvidence {
  const verified: SalesFact[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const next = value?.replace(/\s+/g, " ").trim();
    if (!next || isGenericIndustryCopy(next)) return;
    if (verified.some((item) => item.value.toLowerCase() === next.toLowerCase())) return;
    verified.push({ label, value: next.slice(0, 180) });
  };

  add("Listed as", `${prospect.name} · ${prospect.category}`);
  add("Address", prospect.address);
  if (prospect.phone) add("Listed phone", prospect.phone);
  if (prospect.website) add("Website", prospect.website);
  if (prospect.rating != null) {
    add(
      "Public rating",
      `${prospect.rating.toFixed(1)}${prospect.reviewCount ? ` from ${prospect.reviewCount} reviews` : ""}`,
    );
  }
  if (prospect.locationCount && prospect.locationCount > 1) add("Listed locations", `${prospect.locationCount} locations on the listing`);
  if (prospect.operatingStatus && prospect.operatingStatus !== "Unknown") add("Listing status", prospect.operatingStatus);
  const notes = listingNote(prospect);
  if (notes) add("Listing notes", notes);
  for (const signal of prospect.signals ?? []) {
    if (signal.kind === "expansion" || signal.kind === "home") add(signal.label, signal.detail || signal.label);
  }
  for (const fact of research?.facts ?? []) add(fact.label, fact.value);
  for (const finding of research?.findings ?? []) {
    const snippet = `${finding.title}. ${finding.snippet || ""}`.replace(/\s+/g, " ").trim();
    if (TRIGGER_PATTERN.test(snippet)) add("Public coverage", snippet);
  }

  const stakes = categoryStakes(prospect.category);
  const hypotheses = [
    `In ${prospect.category.toLowerCase()}, the network often carries ${stakes.pressure} — test that here, do not assume it.`,
    `When it fails in this category, ${stakes.breaks} — ask what actually happens on a bad day.`,
    `A growth thread to listen for is ${stakes.growth} — only if they bring it up.`,
  ];

  const unknowns = [
    "Who decides on internet and phone, and whether this address is the operating location.",
    "Whether anything about reliability, coverage, or the bill is actually a problem.",
    "Current provider, contract timing, and whether they are considering a change.",
  ];
  if (!prospect.phone) unknowns.unshift("A reachable public phone number.");
  if (prospect.signals?.some((item) => item.kind === "home")) {
    unknowns.unshift("Whether they operate from a residence, a shop, or mostly on the road.");
  }

  let trigger =
    prospect.signals?.find((item) => item.kind === "expansion")?.detail ||
    prospect.signals?.find((item) => item.kind === "expansion")?.label ||
    null;
  if (!trigger) {
    for (const finding of research?.findings ?? []) {
      trigger = triggerFromText(`${finding.title}. ${finding.snippet || ""}`);
      if (trigger) break;
    }
  }
  if (!trigger) trigger = triggerFromText(notes);

  const useQuestion = /contract|construction|deck|landscap|plumb|roof|handyman/i.test(`${prospect.category} ${prospect.name}`)
    ? "How do you handle customer calls, quotes, and scheduling when you’re out on a job?"
    : neutralDiscoveryQuestion();

  return {
    prospectName: prospect.name,
    category: prospect.category,
    verified,
    hypotheses,
    unknowns: unknowns.slice(0, 4),
    trigger,
    discoveryQuestions: [
      "Do you handle the internet and phone decisions for the business?",
      useQuestion,
      "Is anything about reliability, coverage, or the monthly bill getting in the way — or is it working well enough?",
    ],
  };
}

export function hasCompanySpecificTrigger(evidence: SalesEvidence) {
  return Boolean(evidence.trigger);
}

function looksLikeUrl(value: string) {
  return /^https?:\/\//i.test(value.trim());
}

function displayHost(value: string) {
  const raw = value.trim();
  try {
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
  }
}

function isDirectoryHost(host: string) {
  return /(?:^|\.)(?:yelp|facebook|fb|instagram|twitter|x\.com|linkedin|bbb|yellowpages|mapquest|tripadvisor|google|bing|apple)\b/i.test(host);
}

function hostLooksLikeCompany(host: string, name: string) {
  const tokens = name.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 4);
  const haystack = host.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

function prettyFactLabel(label: string) {
  const key = label.trim().toLowerCase();
  const mapped: Record<string, string> = {
    address: "Address",
    website: "Website",
    "listed phone": "Phone",
    "public rating": "Rating",
    "listed locations": "Locations",
    "listing status": "Status",
    "listing notes": "Notes",
    "public website": "Website",
    "public location": "Location",
    "public source": "Website",
  };
  if (mapped[key]) return mapped[key];
  return label.replace(/^(?:listed|public) /i, "");
}

function coverageSummary(value: string, companyName: string) {
  const text = value.replace(/\s+/g, " ").trim().replace(/^https?:\/\/\S+\s*/i, "");
  if (!text || looksLikeUrl(text) || isGenericIndustryCopy(text)) return null;
  const name = companyName.replace(/\s+/g, " ").trim().toLowerCase();
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/[.:]+$/, "").trim())
    .filter(Boolean);
  for (const [index, raw] of sentences.entries()) {
    let sentence = raw;
    if (sentence.length < 24 || sentence.length > 140 || looksLikeUrl(sentence)) continue;
    const lower = sentence.toLowerCase();
    if (/^(?:home\s*[|–—-]|welcome to\b|official (?:site|website)\b)/i.test(sentence)) continue;
    if (/©|copyright|terms and conditions|privacy policy|cookie policy|all rights reserved|site by\b/i.test(sentence)) continue;
    if ((sentence.match(/\|/g) || []).length >= 2) continue;
    if (index === 0 && (lower === name || lower.startsWith(`${name} -`) || lower.startsWith(`${name} —`))) continue;
    if (index === 0 && /[-—|]/.test(sentence) && sentence.length < 56) continue;
    if (/…|\.\.\.$/.test(sentence)) {
      const clipped = sentence.replace(/\s*(?:…|\.\.\.)$/, "");
      const cut = Math.max(clipped.lastIndexOf(","), clipped.lastIndexOf(";"));
      if (cut < 40) continue;
      sentence = clipped.slice(0, cut);
    }
    return sentence;
  }
  return null;
}

/** User-facing facts only. Collection still keeps coverage/source rows for matching. */
function presentableFacts(evidence: SalesEvidence) {
  const bullets: string[] = [];
  const seen = new Set<string>();
  const push = (label: string, value: string) => {
    const clean = value.replace(/\s+/g, " ").trim();
    if (!clean || isGenericIndustryCopy(clean)) return;
    const key = `${label}:${clean}`.toLowerCase();
    if (seen.has(key) || seen.has(clean.toLowerCase())) return;
    seen.add(key);
    seen.add(clean.toLowerCase());
    bullets.push(`- **${label}:** ${clean}`);
  };

  for (const fact of evidence.verified) {
    if (bullets.length >= 5) break;
    const label = fact.label.trim();
    if (/^public name$/i.test(label)) continue;
    if (/^public coverage$/i.test(label)) continue;
    if (/^listed as$/i.test(label)) {
      const parts = fact.value.split("·").map((part) => part.trim()).filter(Boolean);
      const category = parts.find((part) => part.toLowerCase() !== evidence.prospectName.toLowerCase());
      if (category) push("Category", category);
      continue;
    }
    if (/^public source$/i.test(label)) {
      const host = displayHost(fact.value);
      if (!isDirectoryHost(host) && hostLooksLikeCompany(host, evidence.prospectName)) {
        push("Website", host);
      }
      continue;
    }
    if (/^public website$/i.test(label) || (/website/i.test(label) && looksLikeUrl(fact.value))) {
      const host = displayHost(fact.value);
      if (!isDirectoryHost(host)) push("Website", host);
      continue;
    }
    push(prettyFactLabel(label), fact.value);
  }

  if (bullets.length < 3) {
    for (const fact of evidence.verified) {
      if (!/^public coverage$/i.test(fact.label)) continue;
      const summary = coverageSummary(fact.value, evidence.prospectName);
      if (!summary) continue;
      const key = summary.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      bullets.push(`- ${summary}`);
      break;
    }
  }

  return bullets.slice(0, 5);
}

function spokenLine(text: string) {
  const trimmed = text.replace(/^[\s“”"']+|[\s“”"']+$/g, "");
  return `> “${trimmed}”`;
}

function reasonForCall(evidence: SalesEvidence) {
  if (evidence.trigger) return `I saw ${evidence.trigger.replace(/\.$/, "")}`;
  return "I’m working with a few businesses around here on internet and phone";
}

function openingSpokenLine(evidence: SalesEvidence) {
  return `Hey, this is [your name] with Spectrum Business on a recorded line. How are you today? I’ll keep this quick. ${reasonForCall(evidence)}. I just wanted to see who you’re currently using for internet and phone service.`;
}

export function openingMove(evidence: SalesEvidence) {
  if (evidence.trigger) {
    return `Open like a real outbound call: short recorded-line intro, the public detail as the reason, then who they use — not a guessed problem.\n\n${spokenLine(openingSpokenLine(evidence))}\n\nAsk that. Don’t invent a sales angle.`;
  }
  return `I didn’t find a strong company-specific trigger in the public information. Treat this as cold discovery rather than pretending we know they have a problem.\n\n${spokenLine(openingSpokenLine(evidence))}\n\nGet the current provider first. Don’t invent a sales angle.`;
}

export function collectLookupEvidence(
  name: string,
  location: string | null,
  findings: Array<{ title: string; snippet: string; url?: string }>,
): SalesEvidence {
  const verified: SalesFact[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const next = value?.replace(/\s+/g, " ").trim();
    if (!next || isGenericIndustryCopy(next)) return;
    if (verified.some((item) => item.value.toLowerCase() === next.toLowerCase())) return;
    verified.push({ label, value: next.slice(0, 180) });
  };

  add("Public name", name);
  for (const finding of findings.slice(0, 4)) {
    const snippet = `${finding.title}. ${finding.snippet || ""}`.replace(/\s+/g, " ").trim();
    add("Public coverage", snippet);
    if (finding.url && /official|welcome|home|about/i.test(`${finding.title} ${finding.url}`)) {
      add("Public website", finding.url);
    } else if (finding.url && verified.filter((item) => item.label === "Public website").length === 0) {
      add("Public source", finding.url);
    }
  }
  if (location && findings.some((item) => `${item.title} ${item.snippet}`.toLowerCase().includes(location.split(",")[0].trim().toLowerCase()))) {
    add("Public location", location);
  }

  let trigger: string | null = null;
  for (const finding of findings) {
    trigger = triggerFromText(`${finding.title}. ${finding.snippet || ""}`);
    if (trigger) break;
  }

  return {
    prospectName: name,
    category: "Unknown",
    verified,
    hypotheses: [
      "I do not have a confirmed operating profile for this company. Category norms are questions, not facts about them.",
      "Whether reliability, coverage, or the bill is actually a problem is unknown until they say so.",
    ],
    unknowns: [
      "Who decides on internet and phone, and the exact operating address.",
      "Whether anything about reliability, coverage, or the monthly bill is actually a problem.",
      "Current provider, contract timing, and whether they are considering a change.",
    ],
    trigger,
    discoveryQuestions: [
      "Do you handle the internet and phone decisions for the business?",
      neutralDiscoveryQuestion(),
      "Is anything about reliability, coverage, or the monthly bill getting in the way — or is it working well enough?",
    ],
  };
}

export function formatNamedLookupBrief(
  name: string,
  location: string | null,
  findings: Array<{ title: string; snippet: string; url?: string }>,
) {
  return formatCompanyBrief({ name }, collectLookupEvidence(name, location, findings));
}

export function formatCompanyBrief(prospect: Pick<Prospect, "name">, evidence: SalesEvidence) {
  const facts = presentableFacts(evidence);
  const verified = facts.length
    ? facts.join("\n")
    : "- Public details on this listing are thin. I have the name and what’s on the page.";
  const unknown = evidence.unknowns[0]?.replace(/\.$/, "")
    || "Who decides, and whether anything about reliability is actually a problem";
  return `**${prospect.name}**\n\n**What I verified**\n${verified}\n\n**What I don’t know**\n\n${unknown}.\n\n**Best move**\n\n${openingMove(evidence)}`;
}

export function assumesUnverifiedPain(content: string) {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\bbiggest headache\b/i.test(text)) return true;
  if (/\bheadache with (?:internet|wifi|wi-?fi|phone|reliability|connectivity)\b/i.test(text)) return true;
  if (/\bduring the lunch rush\b/i.test(text) && /\b(?:headache|problem|pain|unreliable|reliability|outage|struggle)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:many|most|typical)\s+(?:cafes?|coffee shops?|restaurants?|shops?|businesses|offices|clinics)\s+(?:struggle|face|deal with|have trouble)\b/i.test(text)) {
    return true;
  }
  if (/\bis that something you(?:'|’)ve experienced\b/i.test(text)) return true;
  if (/\bwhat happens (?:to payments and bookings )?if the connection drops\b/i.test(text)) return true;
  return false;
}

export function answerLeaksUnverifiedPain(content: string, evidence: SalesEvidence) {
  if (isGenericIndustryCopy(content)) return true;
  if (assumesUnverifiedPain(content)) return true;
  if (/\bfit\s+\d+\b/i.test(content) && /\b(?:pain|need|problem|switch|dissatisf)\b/i.test(content)) return true;
  const assumedPain =
    /\b(?:they|this (?:company|business)|the (?:team|office|shop))\s+(?:rely on|struggle with|face|need|have (?:a )?(?:problem|pain|issue)|are dealing with|depend on (?:tenant|cloud|voip|pos))\b/i;
  if (!assumedPain.test(content)) return false;
  const claimed = content.toLowerCase();
  return !evidence.verified.some((item) => claimed.includes(item.value.toLowerCase().slice(0, 40)));
}

export function formatNeutralCallAdvice(name: string, evidence: SalesEvidence) {
  return `For **${name}**, I don’t have a verified problem to open on. Keep discovery neutral rather than assuming pain.\n\n${spokenLine(openingSpokenLine(evidence))}\n\nGet the current provider first.`;
}

export function listingWhy(prospect: Prospect) {
  const expansion = prospect.signals?.find((item) => item.kind === "expansion");
  const notes = listingNote(prospect);
  const why = expansion?.label || notes || prospect.summary || prospect.category;
  return why.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function groundedCallOpener(_prospect: Prospect, evidence: SalesEvidence) {
  return openingSpokenLine(evidence);
}

const HARD_REJECTION =
  /\b(?:not interested|no thanks|stop calling|remove (?:me|us)|don(?:'|’)t call(?: me| us| again)?|take (?:us|me) off(?: your)?(?: the)? list|i(?:'|’)ve told you no|absolutely not changing)\b/i;
const SOFT_SATISFACTION =
  /\b(?:happy with|been (?:very )?good to us|used them forever|we(?:'|’)re fine|we are fine|don(?:'|’)t really see a reason to change|already have|current provider|under contract|taking care of us|they(?:'|’)ve been (?:very )?good)\b/i;
const RELIABILITY_PRAISE =
  /\b(?:reliable|reliability|been (?:very )?good|taking care of us|happy with|they(?:'|’)ve been good)\b/i;

export function isHardRejection(spoken: string) {
  return HARD_REJECTION.test(spoken);
}

export function customerSpeechFromRep(text: string) {
  const match = text.match(/[“"]([^”"]{6,220})[”"]/);
  return match?.[1]?.trim() || text.trim();
}

export function repProvidedNetworkFact(text: string) {
  return /\b(?:they(?:'|’)re green|they are green|serviceability is confirmed|fiber is available|construction (?:was |is )?completed)\b/i.test(
    text,
  );
}

export function promisesUnverifiedPriceWin(content: string) {
  return /\b(?:i can beat(?: that)?|we can beat(?: that)?|i(?:'|’)ll beat(?: that)?|spectrum can beat|we(?:'|’)ll beat (?:that|it|the price)|i can (?:save you money|come in lower))\b/i.test(
    content.replace(/\s+/g, " "),
  );
}

export function inventsUnverifiedNetwork(content: string) {
  const text = content.replace(/\s+/g, " ");
  if (
    /\b(?:check|confirm|verify|look up)\b/i.test(text) &&
    /\b(?:serviceability|fiber|availability)\b/i.test(text) &&
    !/\b(?:fiber is available|they(?:'|’)re green|you(?:'|’)re serviceable)\b/i.test(text)
  ) {
    return false;
  }
  return /\b(?:fiber is available|they(?:'|’)re green|they are green|you(?:'|’)re serviceable|construction (?:was |is )?completed|we can get you (?:fiber|1 ?gig|gig)|install(?:ation)? next week)\b/i.test(
    text,
  );
}

export function surrendersAfterSoftObjection(content: string, spoken: string) {
  if (!spoken || isHardRejection(spoken)) return false;
  if (!SOFT_SATISFACTION.test(spoken)) return false;
  const text = content.replace(/\s+/g, " ");
  if (/\b(?:what are you paying|all-in|if i could|before i let you go)\b/i.test(text)) return false;
  return /\b(?:thanks for your time|close the lead|dead lead|no reason to switch|they see no reason|move on to the next)\b/i.test(text);
}

export function nextSalesMove(evidence: SalesEvidence | null | undefined, spoken?: string | null) {
  const said = spoken ?? "";
  if (isHardRejection(said)) {
    return `That’s a hard no. Stop.\n\n${spokenLine("Understood. I’ll take you off the list. Sorry to bother you.")}\n\nBack off. Do not keep selling through a final rejection.`;
  }
  if (/\b(?:if you could beat|i(?:'|’)d listen|i would listen|i(?:'|’)d be open|we(?:'|’)d be open|open to (?:looking|taking a look))\b/i.test(said)) {
    return `That’s genuine buying interest. Don’t invent a price, fiber, or a win.\n\n${spokenLine("If I can put a comparable option in front of you, I’ll do that while I have you. What’s the address I should check, and is now a good time to walk through it?")}\n\nMove toward a quote or next phone step. Confirm what we can actually offer before promising anything.`;
  }
  if (/\b(?:interested|check (?:the )?(?:address|availability|service)|what (?:can|would) you (?:do|offer)|let(?:'|’)s do it|go ahead|sign up|order)\b/i.test(said)) {
    return `There’s real interest. Check public/serviceability for the address while you still have them.\n\n${spokenLine("Let me check that address while I have you.")}\n\nMove toward a remote order or a scheduled callback. Don’t invent availability.`;
  }
  if (/\$\s?\d/.test(said) && /\b(?:we pay|paying|all-in|a month|per month|for internet)\b/i.test(said)) {
    return `Don’t promise a lower price. You don’t have a verified Spectrum quote.\n\n${spokenLine("That’s actually pretty solid. If I could put together something comparable that either came in lower or gave you more for around the same money, without making the switch a headache, would you at least be open to taking a look?")}\n\nStay conditional. Only quote if the rep has verified pricing.`;
  }
  if (/\b(?:too expensive|cheaper|price|budget|cost|can(?:'|’)t afford)\b/i.test(said)) {
    return `Diagnose before rebutting: is this budget, value, timing, or authority?\n\n${spokenLine("What are you comparing that to — is cost the real issue, or is it timing?")}\n\nStay on this call until that’s clear.`;
  }
  if (SOFT_SATISFACTION.test(said)) {
    const ruledOut = RELIABILITY_PRAISE.test(said)
      ? "Reliability isn’t the issue. Don’t walk away yet."
      : "They like the incumbent. That’s not the end of the call.";
    return `${ruledOut} Don’t invent a problem with the current provider.\n\n${spokenLine("That’s good to hear. If they’re taking care of you, I’m not going to tell you otherwise. Just out of curiosity before I let you go — about what are you paying them all-in right now?")}\n\nEarn one more question. Soft satisfaction is not a reason to walk away.`;
  }
  if (/\b(?:busy|in a meeting|call (?:me |us )?back|call(?:ing)? later|later today|tomorrow)\b/i.test(said)) {
    return `They’re busy. Stay remote.\n\n${spokenLine("When is a better time to call back?")}\n\nBook that callback and hang up cleanly.`;
  }
  if (/\b(?:email|send (?:me |us )?(?:info|information|something|details|a quote)|follow[- ]up with)\b/i.test(said)) {
    return `Send the information they asked for.\n\n${spokenLine("I’ll send that over. Anything specific you want in it?")}\n\nAny leftover qualification stays on this call or that callback.`;
  }
  if (/\b(?:not (?:the|my) (?:decision|person)|owner isn(?:'|’)t here|ask (?:my|the) (?:boss|owner|manager)|who handles)\b/i.test(said)) {
    return `Find out who handles internet and phone.\n\n${spokenLine("Who should I speak with about internet and phone for the business?")}\n\nThen ask whether a callback with that person works.`;
  }
  if (evidence) return openingMove(evidence);
  return `Keep this as phone discovery.\n\n${spokenLine("Hey, this is [your name] with Spectrum Business on a recorded line. How are you today? I’ll keep this quick. I just wanted to see who you’re currently using for internet and phone service.")}\n\nGet the current provider first.`;
}

/** Field visits are not a Live channel. Flag recommended in-person selling, not website visits. */
export function recommendsInPersonSelling(content: string) {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return false;
  if (/\bvisit (?:our|their|the|your) (?:web ?site|page|url|link)\b/i.test(text)) return false;
  return (
    /\b(?:stop by|stop in|drop by|swing by|come by)\b/i.test(text) ||
    /\bsite walks?\b/i.test(text) ||
    /\bvisit them\b/i.test(text) ||
    /\bmeet (?:them |you )?(?:in person|on[- ]site|at (?:the |their )?(?:shop|store|office|location|site))\b/i.test(text) ||
    /\bin[- ]person (?:visit|appointment|meeting|demo|walk)\b/i.test(text) ||
    /\b(?:on[- ]site|onsite) (?:visit|walk|appointment|inspection|meeting|demo)\b/i.test(text) ||
    /\bschedule (?:an? )?(?:in[- ]person|on[- ]site) (?:visit|appointment|meeting|walk)\b/i.test(text) ||
    /\binspect (?:the )?(?:equipment|site|location|premises)\b/i.test(text)
  );
}

export function salesCoachNotes() {
  return `Sales craft, non-negotiable — same bar as the written research brief:
- This is a call-center phone sale. The rep works the phone only. Recommended next steps must be remote: continue this conversation, ask another discovery question, schedule a callback, send or follow up with information if that capability exists, check public/serviceability information, or move toward a remote order. Choose the best of those for the moment — do not default every close to the same callback line.
- Be persistent without being pushy. Respect the customer while continuing to sell. Do not treat the first soft objection as a dead lead.
- Typical motion: find a prospect, verify serviceability separately, call, introduce yourself with a concise reason, ask who they currently use, discover whether there is a reason to compare, handle objections, then move toward a quote, order, or next phone step if there is real interest.
- Opening style: recorded-line intro, keep it quick, a verified reason for the call if you have one, then who they currently use for internet and phone. Make it natural. Do not freeze one script, and do not invent a reason.
- Discover before pitching. Never invent customer pain, dissatisfaction, owners, staff counts, outages, a current provider, or a reason to switch.
- Never invent fiber availability, construction, network upgrades, serviceability, prices, promotions, speeds, or installation timelines. If the rep says they are green, serviceability is confirmed, fiber is available, or construction was completed, treat that as rep-provided. Otherwise do not claim it.
- Never state or imply they currently subscribe to Spectrum or anyone else. "Their current provider" is only an open question until they say it.
- Listing fit scores, hypothesizedNeeds, and generic category blurbs are not evidence this company has a problem. Do not restate a fit score as if you calculated a pain.
- Verified / public facts: only what a listing, website, or sourced snippet actually says about THIS company.
- Hypotheses: typical for the category — use them to pick a question, never as a company fact.
- Industry knowledge may guide the topic (payments, scheduling, a lunch service) but must not assume pain. Do not ask about their biggest headache, what they struggle with, or whether they have experienced a typical category problem.
- If public research has no company-specific trigger, say so and run cold discovery. Do not invent a sales angle.
- FCC rows are reported availability, not subscriptions, quotes, or install guarantees.
- Soft objections ("we're happy", "they've been good to us", "we've used them forever", "we're fine", "I don't see a reason to change") are not dead leads. Acknowledge them. Do not attack the incumbent. Then earn 1–3 more discovery pivots from what was already learned. Do not re-ask the same question. Do not dump every product. If they praised reliability, do not probe reliability next — move to the bill, capacity, phones, mobile, backup, support, growth, or consolidation.
- Use conditional selling when you do not have a verified offer: "If I could…", "If there were an option…", "If I could show you…". Never say you can beat a price unless the rep has verified pricing that proves it.
- Diagnose what is behind an objection before rebutting. Give the single next move, not a menu of canned lines.
- Hard rejections stop the pitch: not interested, do not call again, take us off the list, I've told you no, we are absolutely not changing. Do not coach the rep to keep selling through a clear final no.
- Once a real need or genuine buying interest is on the table, ask for a remote next commitment — staying on this call, a callback, sending information, checking the address, or moving toward a quote or remote order — without forcing a close and without inventing the offer.
- Write short. Most answers are 2–4 short sections, 3–5 bullets at most, one short explanation, the line the rep should say as a markdown blockquote (>), then one next action. Skip unused templates (What we know now, The Reality Check, Your Single Best Move, Why this works, Strategy for the future). Summarize facts as **Label:** values. Never dump Public coverage or Public source snippets — Sources already attributes.`;
}
