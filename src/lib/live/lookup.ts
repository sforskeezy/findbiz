import { parseLiveBrief } from "@/lib/live/intent";
import type { LiveChatMessage } from "@/lib/live/types";
import {
  locationQueryVariants,
  matchesBusinessName,
  nameVariants,
  nameWithoutRepeatedCity,
} from "@/lib/business-identity";
export { matchesBusinessName as matchesLookupName } from "@/lib/business-identity";

export type WebLookupPlan = {
  query: string;
  name: string | null;
  location: string | null;
  variants: string[];
};

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

function namedLookupQueries(name: string, location: string | null) {
  const names = nameVariants(name);
  const places = locationQueryVariants(location);
  const primaryName = names.find((item) => !/['\u2018\u2019]/.test(item)) || names[0];
  const shortened = nameWithoutRepeatedCity(primaryName, location);
  const primaryPlace = places[0] || "";
  const queries = [
    compact([primaryName, primaryPlace].filter(Boolean).join(" ")),
    shortened ? compact([shortened, primaryPlace].filter(Boolean).join(" ")) : "",
    ...names.map((item) => compact([item, primaryPlace].filter(Boolean).join(" "))),
    ...places.slice(1).map((place) => compact([primaryName, place].join(" "))),
    compact([`"${primaryName.replace(/"/g, "")}"`, primaryPlace].filter(Boolean).join(" ")),
  ];
  return [...new Set(queries.filter(Boolean))];
}

/**
 * Queries for one known business. Used for a fresh named ask and for a name the
 * rep just corrected, so both take the same spelling and place retries.
 */
export function planNamedLookup(name: string, location: string | null, extraTerms: string[] = []): WebLookupPlan {
  const queries = namedLookupQueries(name, location);
  for (const term of extraTerms) {
    const combined = compact([queries[0], term].filter(Boolean).join(" "));
    if (combined && !queries.includes(combined)) queries.push(combined);
  }
  return { query: queries[0], name, location, variants: queries.slice(1) };
}

/** Resolve "just Google it" from the rep's words, never an assistant's wrong guess. */
export function planWebLookup(text: string, history: Pick<LiveChatMessage, "role" | "content">[] = []): WebLookupPlan | null {
  const brief = parseLiveBrief(text);
  const retry = /\b(?:try (?:it )?again|search again|look again|keep looking)\b/i.test(text);
  if (!brief.targetName && !brief.wantsWeb && !retry) return null;
  const referring = (brief.wantsWeb || retry) && !brief.targetName && !brief.webQueries.length;
  let subject = text;
  if (referring) {
    const previous = [...history].reverse().find((item) => item.role === "user"
      && !/^(?:hi|hello|hey|thanks|thank you)[!.\s]*$/i.test(item.content)
      && !/^(?:please\s+)?(?:try (?:it )?again|search again|look again|keep looking)[!.\s]*$/i.test(item.content)
      && !(parseLiveBrief(item.content).wantsWeb && !parseLiveBrief(item.content).webQueries.length && !parseLiveBrief(item.content).targetName));
    if (previous) subject = previous.content;
    else return null;
  }
  const target = parseLiveBrief(subject);
  if (retry && !target.targetName && !target.wantsWeb) return null;
  const name = target.targetName;
  const location = target.locationHint;
  const trade = subject.match(/\b(decks?|screen enclosures?|patios?|roofing|plumbing|landscaping|lawn care)\b/i)?.[0];
  if (name) {
    const wantsTrade = trade && !name.toLowerCase().includes(trade.toLowerCase());
    return planNamedLookup(name, location, wantsTrade ? [trade] : []);
  }
  const query = compact(brief.webQueries[0] || subject);
  return { query, name, location, variants: brief.webQueries.slice(1).filter((item) => item !== query) };
}

export function lookupReplyNeedsEvidence(content: string, name: string) {
  if (!matchesBusinessName({title: content, snippet: ""}, name)) return true;
  const miss = content.match(/\b(?:could not|couldn.t|cannot|can.t|unable to|did not|didn.t) (?:find|verify|confirm)\s+([^.!?\n]+)/i)?.[1];
  if (!miss) return false;
  // Keep useful answers that acknowledge an unverified owner, phone, or address.
  if (/^(?:(?:the|their|its|a|an)\s+)?(?:owner|ownership|phone|number|address|hours|status|eligibility|discount|promotion|current|home[- ]?based)\b/i.test(miss)) return false;
  return matchesBusinessName({title: miss, snippet: ""}, name)
    || /^(?:(?:the|this|that|a|any|local|matching)\s+)*(?:business|company|listing)\b/i.test(miss);
}

/**
 * Ask for the name again without dropping the question. The rep only has to fix
 * the spelling; the place and the ask are already held for them.
 */
export function unresolvedNameReply(input: {
  name: string;
  location: string | null;
  suggestion: string | null;
  question: string | null;
  unavailable: boolean;
}) {
  const place = input.location ? ` in ${input.location}` : "";
  const holding = input.question
    ? `I’m still holding the original ask — ${input.question}${place}.`
    : `I’m still holding the original ask${place}.`;
  if (input.unavailable) {
    return `The search providers could not complete the lookup for **${input.name}**${place}. ${holding} Say the name once more and I’ll run it again.`;
  }
  if (input.suggestion) {
    return `I couldn’t verify **${input.name}**${place}. The closest public match I found is **${input.suggestion}**. ${holding} Confirm that name, or spell the one you meant, and I’ll keep going.`;
  }
  return `I couldn’t confidently resolve **${input.name}**${place}, and I haven’t substituted another business. ${holding} Spell the name, or give me its website, and I’ll continue.`;
}

export function lookupEvidenceReply(query: string, findings: Array<{ title: string; url: string; snippet: string }>, unavailable = false) {
  if (!findings.length) return unavailable
    ? `The search providers could not complete the lookup for **${query}**. That does not mean the business does not exist. Try again shortly, or share its website or a screenshot of the listing.`
    : `I couldn’t verify a matching result for **${query}** from the searches I ran. I haven’t substituted another business. A website, phone number, or another part of the name would help narrow it down.`;
  return `Here are the matching public sources for **${query}**:\n\n${findings.slice(0, 3).map((item) => `- [${item.title}](${item.url}) — ${item.snippet || "Open this source for details."}`).join("\n")}`;
}
