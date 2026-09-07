import { parseLiveBrief } from "@/lib/live/intent";
import type { LiveChatMessage } from "@/lib/live/types";
import { matchesBusinessName } from "@/lib/business-identity";
export { matchesBusinessName as matchesLookupName } from "@/lib/business-identity";

export type WebLookupPlan = {
  query: string;
  name: string | null;
  location: string | null;
  variants: string[];
};

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
  const clean = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 240);
  const query = clean(name ? [name, location].filter(Boolean).join(" ") : brief.webQueries[0] || subject);
  const trade = subject.match(/\b(decks?|screen enclosures?|patios?|roofing|plumbing|landscaping|lawn care)\b/i)?.[0];
  const variants = name ? [
    clean([`"${name.replace(/"/g, "")}"`, location, trade].filter(Boolean).join(" ")),
    clean([name, location, trade, "business contact"].filter(Boolean).join(" ")),
  ] : brief.webQueries.slice(1);
  return { query, name, location, variants: [...new Set(variants)].filter((value) => value !== query) };
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

export function lookupEvidenceReply(query: string, findings: Array<{title: string; url: string; snippet: string}>, unavailable = false) {
  if (!findings.length) return unavailable
    ? `The search providers could not complete the lookup for **${query}**. That does not mean the business does not exist. Try again shortly, or share its website or a screenshot of the listing.`
    : `I couldn’t verify a matching result for **${query}** from the searches I ran. I haven’t substituted another business. A website, phone number, or another part of the name would help narrow it down.`;
  return `Here are the matching public sources for **${query}**:\n\n${findings.slice(0, 3).map((item) => `- [${item.title}](${item.url}) — ${item.snippet || "Open this source for details."}`).join("\n")}`;
}
