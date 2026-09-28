import type { CallBrief, Confidence, Prospect, ResearchPerson, WebSearchResult } from "@/lib/types";

/** Owner- and contact-focused searches across registries, review sites, social profiles, and reverse phone. */
export function contactQueries(prospect: Prospect) {
  const name = `"${prospect.name.replace(/["“”]/g, "").trim().slice(0, 120)}"`;
  const parts = prospect.address.split(",").map((part) => part.trim()).filter(Boolean);
  const location = parts.slice(-2).join(" ").replace(/\s+\d{5}(?:-\d{4})?$/, "");
  const digits = (prospect.phone ?? "").replace(/\D/g, "").slice(-10);
  const phone = digits.length === 10 ? `"${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}"` : "";
  return [
    `${name} ${location}`,
    `${name} owner ${location}`,
    `${name} owner OR president OR manager OR founder`,
    `${name} registered agent ${location}`,
    `site:bizapedia.com ${name}`,
    `site:opencorporates.com ${name}`,
    `site:bbb.org ${name}`,
    `site:linkedin.com ${name} owner`,
    `site:facebook.com ${name} ${location}`,
    ...(phone ? [phone, `${phone} owner`] : []),
    `${name} official website contact ${location}`,
  ].map((query) => query.replace(/\s+/g, " ").trim());
}

/** Role words match in any case; person names still have to be capitalized, so the patterns cannot use the `i` flag. */
const anyCase = (phrase: string) => phrase.replace(/[a-z]/gi, (letter) => `[${letter.toUpperCase()}${letter.toLowerCase()}]`);
const ROLE = `(?:${["Co-Owner", "CoOwner", "Owner/Operator", "Owner", "Proprietor", "Vice President", "President", "Chief Executive Officer", "Co-Founder", "Founder", "General Manager", "Office Manager", "Store Manager", "Managing Member", "Managing Partner", "Manager", "Partner", "Principal", "Registered Agent", "Director", "Operator", "Organizer", "Secretary", "Treasurer", "Incorporator"].map((role) => anyCase(role).replace("/", "\\/")).join("|")}|CEO)`;
const PERSON = "([A-Z][a-z]+(?:[-'’][A-Z]?[a-z]+)?(?: [A-Z]\\.?)?(?: [A-Z][a-z]+(?:[-'’][A-Z]?[a-z]+)?){1,2})";
const PATTERNS = [
  new RegExp(`\\b(${ROLE})\\s*(?:is|:|-|–|,)?\\s*(?:is\\s+)?${PERSON}`, "g"),
  new RegExp(`${PERSON}\\s*(?:,|-|–|\\||is the|is an?|as)\\s*(?:the\\s+)?(${ROLE})\\b`, "g"),
  new RegExp(`\\b(?:[Oo]wned|[Rr]un|[Oo]perated|[Ff]ounded|[Mm]anaged|[Ss]tarted)(?: and operated)? by\\s+${PERSON}`, "g"),
  new RegExp(`\\b${anyCase("registered agent")} (?:on file )?(?:for this company )?is\\s+${PERSON}`, "g"),
];
const NOT_NAMES = new Set("the our your this that with from about contact home page services service company business owner manager president llc inc corp group team staff customer customers reviews review call today google linkedin facebook instagram yelp bbb open closed monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december street road avenue drive lane suite north south east west new county city state united states america view profile see more read learn all rights reserved privacy policy terms".split(" "));

function roleLabel(value: string) {
  const role = value.replace(/\s+/g, " ").trim();
  if (/^co-?owner$/i.test(role)) return "Co-owner";
  if (/^owner/i.test(role) || /^proprietor$/i.test(role)) return "Owner";
  if (/^chief executive officer$/i.test(role)) return "CEO";
  return role.split(" ").map((word) => word === "CEO" ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ");
}

function plausibleName(name: string, businessWords: Set<string>) {
  const words = name.replace(/\./g, "").split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  const lower = words.map((word) => word.toLowerCase());
  if (lower.some((word) => NOT_NAMES.has(word))) return false;
  if (lower.filter((word) => word.length > 1 && businessWords.has(word)).length >= Math.min(2, lower.length)) return false;
  return words.filter((word) => word.length > 1).length >= 2;
}

/** Names paired with an explicit role or ownership phrase, never a bare capitalized pair. */
export function extractPeople(text: string, businessName: string) {
  const businessWords = new Set(businessName.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 3));
  const found: Array<{ name: string; role: string }> = [];
  const add = (name: string, role: string) => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (plausibleName(clean, businessWords) && !found.some((item) => item.name === clean && item.role === role)) found.push({ name: clean, role });
  };
  for (const match of text.matchAll(PATTERNS[0])) add(match[2], roleLabel(match[1]));
  for (const match of text.matchAll(PATTERNS[1])) add(match[1], roleLabel(match[2]));
  for (const match of text.matchAll(PATTERNS[2])) add(match[1], /founded|started/i.test(match[0]) ? "Founder" : "Owner");
  for (const match of text.matchAll(PATTERNS[3])) add(match[1], "Registered Agent");
  return found;
}

const REGISTRY = /bizapedia|opencorporates|bbb\.org|\.gov$|sos\.|sunbiz|corporationwiki|buzzfile/i;
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "web"; } };
const ROLE_ORDER = ["Owner", "Co-owner", "Founder", "President", "CEO", "Managing Member", "General Manager", "Manager", "Registered Agent"];

/** Merge every mention of the same person across results; more independent sources means more confidence. */
export function collectPeople(documents: Array<{ url: string; title: string; text: string }>, businessName: string): ResearchPerson[] {
  const people = new Map<string, ResearchPerson>();
  for (const document of documents) {
    const text = `${document.title}. ${document.text}`;
    for (const { name, role } of extractPeople(text, businessName)) {
      const key = name.toLowerCase().replace(/[^a-z]/g, "");
      const person = people.get(key) ?? { name, roles: [], sources: [], confidence: "Estimated" as Confidence };
      if (!person.roles.includes(role)) person.roles.push(role);
      if (!person.sources.some((source) => source.url === document.url)) {
        const at = text.indexOf(name);
        person.sources.push({ label: host(document.url), url: document.url, snippet: text.slice(Math.max(0, at - 90), at + name.length + 90).replace(/\s+/g, " ").trim() });
      }
      people.set(key, person);
    }
  }
  const rank = (person: ResearchPerson) => new Set(person.sources.map((source) => source.label)).size * 10 + (person.sources.some((source) => REGISTRY.test(source.label)) ? 6 : 0) + Math.max(0, 9 - Math.min(...person.roles.map((role) => { const index = ROLE_ORDER.indexOf(role); return index < 0 ? 9 : index; })));
  return [...people.values()]
    .map((person) => ({
      ...person,
      roles: [...person.roles].sort((a, b) => (ROLE_ORDER.indexOf(a) + 99) % 99 - (ROLE_ORDER.indexOf(b) + 99) % 99),
      confidence: (new Set(person.sources.map((source) => source.label)).size >= 2 || person.sources.some((source) => REGISTRY.test(source.label)) ? "Verified" : "Estimated") as Confidence,
    }))
    .sort((a, b) => rank(b) - rank(a))
    .slice(0, 6);
}

type SearchAnswer = { people?: Array<{ name?: unknown; role?: unknown; source?: unknown }>; facts?: Array<{ text?: unknown; source?: unknown } | string> };

/** Ask a search-enabled model; keep only people and facts that come with a public source URL. */
export async function aiWebSearch(prospect: Prospect, ask: (prompt: string) => Promise<SearchAnswer | null>) {
  const phone = (prospect.phone ?? '').replace(/\D/g, '').slice(-10);
  const answer = await ask(`Search the web (state business registries, Bizapedia, OpenCorporates, BBB, LinkedIn, Facebook, news, reverse phone listings) for the business "${prospect.name}" at ${prospect.address}${phone.length === 10 ? `, phone ${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}` : ''}. Who owns, runs, or manages it? Reply with JSON only: {"people":[{"name":"","role":"","source":"https://..."}],"facts":[{"text":"","source":"https://..."}]}. Only include a person if a web page names them in connection with this exact business, and give that page's URL. facts are up to 5 short concrete facts about this business (founded, owner history, second location, filing status) with URLs. Never guess.`);
  const url = (value: unknown) => { try { const parsed = new URL(String(value)); return /^https?:$/.test(parsed.protocol) ? parsed.href : null; } catch { return null; } };
  const businessWords = new Set(prospect.name.toLowerCase().split(/[^a-z]+/).filter((word) => word.length >= 3));
  const documents: Array<{ url: string; title: string; text: string }> = [];
  const people: ResearchPerson[] = [];
  for (const item of answer?.people ?? []) {
    const name = typeof item.name === 'string' ? item.name.replace(/\s+/g, ' ').trim() : '';
    const source = url(item.source);
    if (!source || !plausibleName(name, businessWords)) continue;
    const role = typeof item.role === 'string' && item.role.trim() ? roleLabel(item.role.trim().slice(0, 40)) : 'Contact';
    people.push({ name, roles: [role], sources: [{ label: host(source), url: source, snippet: `${name}, ${role.toLowerCase()} of ${prospect.name} (found by web search)` }], confidence: 'Estimated' });
  }
  for (const item of answer?.facts ?? []) {
    const text = typeof item === 'string' ? item : typeof item.text === 'string' ? item.text : '';
    const source = typeof item === 'string' ? null : url(item.source);
    if (text && source) documents.push({ url: source, title: host(source), text: text.replace(/\s+/g, ' ').trim().slice(0, 400) });
  }
  return { people, documents };
}

/** Fold people found by the search model into the evidence-extracted list; a second independent source confirms them. */
export function mergePeople(found: ResearchPerson[], extra: ResearchPerson[]) {
  const merged = found.map((person) => ({ ...person, sources: [...person.sources] }));
  for (const person of extra) {
    const match = merged.find((item) => item.name.toLowerCase() === person.name.toLowerCase());
    if (!match) { merged.push(person); continue; }
    for (const source of person.sources) if (!match.sources.some((item) => item.url === source.url)) match.sources.push(source);
    for (const role of person.roles) if (!match.roles.includes(role)) match.roles.push(role);
    if (new Set(match.sources.map((source) => source.label)).size >= 2) match.confidence = 'Verified';
  }
  return merged.slice(0, 6);
}

type BriefModel = (system: string, user: string) => Promise<Partial<CallBrief> | null>;

/** A short pre-call brief. The model may only name a person that already appears in the gathered evidence. */
export async function callBrief(prospect: Prospect, people: ResearchPerson[], results: WebSearchResult[], ask: BriefModel): Promise<CallBrief | null> {
  const evidence = results.slice(0, 18).map((result, index) => `[${index + 1}] ${result.title} (${host(result.url)}): ${result.snippet}`).join("\n");
  const peopleText = people.map((person) => `${person.name} — ${person.roles.join(", ")} (${person.sources.length} source${person.sources.length === 1 ? "" : "s"})`).join("\n") || "None found";
  const reply = await ask(
    "You prepare a sales rep for a cold call to a small business about business internet. Use only the evidence given. Never invent names, facts, or numbers. Reply with JSON only: {\"askFor\": string|null, \"reason\": string, \"summary\": string, \"talkingPoints\": string[]}. askFor must be one of the listed people or null. summary is 1-2 sentences about what the business does. talkingPoints are up to 3 short openers, each built on one concrete fact from the evidence (years in business, a second location, a recent event, what customers praise). No generic sales lines, no advice about internet, and no mention of missing reviews or missing news. If the evidence has no concrete facts, return an empty array.",
    `Business: ${prospect.name}\nCategory: ${prospect.category}\nAddress: ${prospect.address}\nRating: ${prospect.rating == null ? "unknown" : `${prospect.rating}${prospect.reviewCount ? ` from ${prospect.reviewCount} reviews` : ""}`}\n\nPeople found:\n${peopleText}\n\nSearch evidence:\n${evidence || "None"}`,
  );
  if (!reply) return null;
  const allowed = new Map(people.map((person) => [person.name.toLowerCase(), person.name]));
  const askFor = typeof reply.askFor === "string" ? allowed.get(reply.askFor.trim().toLowerCase()) ?? null : null;
  const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const talkingPoints = Array.isArray(reply.talkingPoints) ? reply.talkingPoints.map((point) => text(point, 220)).filter(Boolean).slice(0, 3) : [];
  const summary = text(reply.summary, 400);
  if (!summary && !talkingPoints.length && !askFor) return null;
  return { askFor, reason: askFor ? text(reply.reason, 240) : "", summary, talkingPoints };
}
