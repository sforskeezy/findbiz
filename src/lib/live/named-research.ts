import {
  foldBusinessName,
  locationQueryVariants,
  matchesBusinessName,
  mentionsRequestedPlace,
  nameVariants,
} from "@/lib/business-identity";
import { researchQuestionLabel } from "@/lib/live/intent";
import type { WebLookupPlan } from "@/lib/live/lookup";

export type LookupFinding = { title: string; url: string; snippet: string };

export type LocationResearch = {
  name: string;
  location: string | null;
  findings: LookupFinding[];
  locationVerified: boolean;
  firstParty: LookupFinding | null;
  operator: { name: string; evidence: LookupFinding[] } | null;
  legalEntityVerified: boolean;
  brandOnly: boolean;
};

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240);
}

const OPERATOR_TERMS = [
  "franchisee",
  "operator",
  '"operated by"',
  '"franchise partner"',
  '"development group"',
  '"grand opening"',
  "owner",
];

const DIRECTORY_HOST =
  /yelp|yellowpages|mapquest|bizapedia|buzzfile|zoominfo|bbb\.org|facebook|instagram|linkedin/i;
const NEWS_HOST = /news|times|herald|journal|tribune|post|observer|gazette|businesswire|prnewswire/i;
const GOV_HOST = /\.gov(?:\.|$)/i;

function hostnameOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isOwnershipLookup(text: string) {
  return researchQuestionLabel(text) === "who owns this specific location";
}

/** Location-existence queries first. Operator terms are a later round. */
export function planLocationResearchQueries(name: string, location: string | null) {
  const names = nameVariants(name);
  const places = locationQueryVariants(location);
  const primary = names[0];
  const place = places[0] || "";
  const queries = [
    compact([primary, place].filter(Boolean).join(" ")),
    compact([primary, places[1] || place].filter(Boolean).join(" ")),
    ...names.slice(1).map((item) => compact([item, place].filter(Boolean).join(" "))),
    compact([`"${primary.replace(/"/g, "")}"`, place].filter(Boolean).join(" ")),
  ];
  return [...new Set(queries.filter((item) => item.length >= 3))];
}

export function planOperatorResearchQueries(name: string, location: string | null, operators: string[] = []) {
  const place = locationQueryVariants(location)[0] || "";
  const queries = OPERATOR_TERMS.map((term) => compact([name, place, term].filter(Boolean).join(" ")));
  for (const operator of operators) {
    queries.push(compact([operator, name, place].filter(Boolean).join(" ")));
    queries.push(compact([operator, place, "franchisee"].filter(Boolean).join(" ")));
  }
  return [...new Set(queries.filter((item) => item.length >= 5))];
}

const GENERIC_OPERATORS = new Set([
  "the company", "the brand", "corporate", "the franchise", "the store", "the location",
  "a franchisee", "the franchisee", "the operator", "the owner", "llc", "inc",
]);

/**
 * Pull operator/franchisee names out of public copy. Never invent one — these
 * are only strings the sources already used next to operate/franchise language.
 */
export function extractOperatorNames(text: string, brandName: string) {
  const brand = foldBusinessName(brandName);
  const found = new Set<string>();
  const patterns = [
    /\b(?:operated|owned|run)\s+by\s+([A-Z][A-Za-z0-9&']+(?:\s+[A-Z0-9][A-Za-z0-9&']*){0,5}(?:\s+(?:LLC|L\.L\.C\.|Inc\.?|Group|Partners|Holdings|Hospitality))?)/g,
    /\b(?:franchisee|franchise partner|local operator|development group)\s+([A-Z][A-Za-z0-9&']+(?:\s+[A-Z0-9][A-Za-z0-9&']*){0,4}(?:\s+(?:LLC|L\.L\.C\.|Inc\.?|Group|Partners|Holdings))?)/g,
    /\b([A-Z][A-Za-z0-9&']+(?:\s+[A-Z0-9][A-Za-z0-9&']*){0,4})\s+operates\s+(?:the|this|a)\b/g,
    /\b([A-Z][A-Za-z0-9&']+(?:\s+[A-Z0-9][A-Za-z0-9&']*){0,4}\s+(?:LLC|L\.L\.C\.|Inc\.?|Holdings|Hospitality|Partners))\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1]?.replace(/\s+/g, " ").trim();
      if (!name || name.length < 4 || name.length > 80) continue;
      const folded = foldBusinessName(name);
      if (GENERIC_OPERATORS.has(folded)) continue;
      if (folded === brand || brand.includes(folded) || folded.includes(brand)) continue;
      found.add(name.replace(/[.,;:]+$/, ""));
    }
  }
  return [...found].slice(0, 4);
}

function isFirstParty(finding: LookupFinding, name: string) {
  if (DIRECTORY_HOST.test(hostnameOf(finding.url))) return false;
  return matchesBusinessName({ title: "", snippet: "", url: finding.url }, name);
}

function sourceRank(finding: LookupFinding, name: string, location: string | null) {
  const host = hostnameOf(finding.url);
  let score = 40;
  if (isFirstParty(finding, name)) score += 50;
  if (GOV_HOST.test(host)) score += 40;
  if (NEWS_HOST.test(host)) score += 20;
  if (DIRECTORY_HOST.test(host)) score -= 15;
  if (location && mentionsRequestedPlace(finding, location)) score += 25;
  if (/\b(?:franchisee|operated by|operator|development group)\b/i.test(`${finding.title} ${finding.snippet}`)) {
    score += 15;
  }
  return score;
}

export function exactLocationFinding(findings: LookupFinding[], name: string, location: string | null) {
  return findings.find((item) => matchesBusinessName(item, name, location) && (!location || mentionsRequestedPlace(item, location))) ?? null;
}

export function summarizeLocationResearch(input: {
  name: string;
  location: string | null;
  findings: LookupFinding[];
}): LocationResearch {
  const ranked = [...input.findings].sort(
    (left, right) => sourceRank(right, input.name, input.location) - sourceRank(left, input.name, input.location),
  );
  const locationHit = exactLocationFinding(ranked, input.name, input.location);
  const firstParty =
    ranked.find((item) => isFirstParty(item, input.name) && (!input.location || mentionsRequestedPlace(item, input.location)))
    ?? ranked.find((item) => isFirstParty(item, input.name))
    ?? null;
  const locationVerified = Boolean(locationHit || (firstParty && input.location && mentionsRequestedPlace(firstParty, input.location)));
  const brandOnly = Boolean(ranked.length && !locationVerified);
  const hay = ranked.map((item) => `${item.title}. ${item.snippet}`).join(" ");
  const operators = extractOperatorNames(hay, input.name);
  const operatorName = operators[0] ?? null;
  const operatorEvidence = operatorName
    ? ranked.filter((item) => foldBusinessName(`${item.title} ${item.snippet}`).includes(foldBusinessName(operatorName)))
    : [];
  const legalEntityVerified = operatorEvidence.some((item) =>
    /\b(?:llc|l\.l\.c\.|inc\.?|incorporated|holdings)\b/i.test(`${item.title} ${item.snippet}`) &&
    /\b(?:franchisee|operated by|owner of record|legal entity)\b/i.test(`${item.title} ${item.snippet}`),
  );

  return {
    name: input.name,
    location: input.location,
    findings: ranked,
    locationVerified,
    firstParty,
    operator: operatorName ? { name: operatorName, evidence: operatorEvidence } : null,
    legalEntityVerified,
    brandOnly,
  };
}

function cite(finding: LookupFinding) {
  return `[${finding.title}](${finding.url})`;
}

/**
 * Answer the local-ownership question from evidence only. Brand-level franchise
 * copy is not an answer, and missing legal-entity detail stays missing.
 */
export function formatOwnershipReply(research: LocationResearch) {
  const place = research.location ? ` in ${research.location}` : "";
  const verified: string[] = [];
  const strong: string[] = [];
  const unknown: string[] = [];

  if (research.locationVerified) {
    const anchor = research.firstParty && mentionsRequestedPlace(research.firstParty, research.location)
      ? research.firstParty
      : exactLocationFinding(research.findings, research.name, research.location);
    verified.push(
      anchor
        ? `- This specific **${research.name}** location exists${place}. ${cite(anchor)}`
        : `- This specific **${research.name}** location exists${place}.`,
    );
  } else if (research.findings.length) {
    verified.push(`- **${research.name}** is a real brand. That is not the same as confirming this exact${place || " requested"} store.`);
  }

  if (research.operator) {
    verified.push(
      `- **${research.operator.name}** publicly identifies${place || " this location"} as a ${research.name} location it operates.`,
    );
    for (const item of research.operator.evidence.slice(0, 3)) {
      strong.push(`- ${cite(item)} — ${item.snippet || "Open this source for the operator relationship."}`);
    }
  }

  if (!research.locationVerified) {
    unknown.push(`a first-party page that names the ${research.location || "requested"} store`);
  }
  if (!research.operator) {
    unknown.push("who owns or operates this specific location, as distinct from the brand / franchisor");
  } else if (!research.legalEntityVerified) {
    unknown.push("the exact legal ownership entity behind the store");
    unknown.push("whether the named operator is the direct franchisee or part of a larger ownership group");
  }

  const lines = [`**${research.name}**${place}`];
  if (verified.length) lines.push("", "**Verified**", ...verified);
  if (strong.length) lines.push("", "**Strong operator evidence**", ...strong);
  if (unknown.length) {
    lines.push("", "**Still not fully verified**", ...unknown.map((item) => `- ${item}`));
  }
  return lines.join("\n");
}

export function ownershipFollowUpQueries(plan: WebLookupPlan, research: LocationResearch) {
  const operators = research.operator ? [research.operator.name] : [];
  const extra = research.findings.flatMap((item) => extractOperatorNames(`${item.title}. ${item.snippet}`, plan.name || ""));
  return planOperatorResearchQueries(plan.name || research.name, plan.location ?? research.location, [...new Set([...operators, ...extra])]);
}

type SearchFn = (
  queries: string[],
  options: { businessName?: string | null; location?: string | null; fresh?: boolean; signal?: AbortSignal },
) => Promise<{
  findings: LookupFinding[];
  nearMisses: LookupFinding[];
  queries: string[];
  engine: string;
  diagnostics: { queriesCompleted: number; failures: string[] };
}>;

function mergeFindings(into: LookupFinding[], extra: LookupFinding[]) {
  for (const item of extra) {
    if (!into.some((existing) => existing.url === item.url)) into.push(item);
  }
}

/**
 * Verify the store, then keep searching for who operates it. A brand homepage
 * is not enough to stop, and a misspelled first query is not "no public record".
 */
export async function runLocationResearch(
  plan: WebLookupPlan,
  search: SearchFn,
  input: { ownership: boolean; signal?: AbortSignal },
) {
  const name = plan.name || "";
  const location = plan.location;
  const findings: LookupFinding[] = [];
  const nearMisses: LookupFinding[] = [];
  const queries: string[] = [];
  let engine = "";
  let queriesCompleted = 0;

  const run = async (next: string[]) => {
    const unique = next.filter((query) => query && !queries.includes(query));
    if (!unique.length) return;
    const looked = await search(unique, { businessName: name, location, fresh: true, signal: input.signal });
    queries.push(...looked.queries);
    engine = [...new Set([engine, looked.engine].filter(Boolean))].join(", ");
    queriesCompleted += looked.diagnostics.queriesCompleted;
    mergeFindings(findings, looked.findings);
    mergeFindings(nearMisses, looked.nearMisses);
  };

  await run(planLocationResearchQueries(name, location));
  let research = summarizeLocationResearch({ name, location, findings });
  // A brand-only hit is a weak first search, not proof the store is missing.
  if (!research.locationVerified && (plan.variants.length || research.brandOnly)) {
    await run(plan.variants);
    research = summarizeLocationResearch({ name, location, findings });
  }
  if (input.ownership && (research.locationVerified || research.brandOnly || findings.length)) {
    await run(planOperatorResearchQueries(name, location));
    research = summarizeLocationResearch({ name, location, findings });
    const follow = ownershipFollowUpQueries(plan, research);
    if (follow.length) {
      await run(follow);
      research = summarizeLocationResearch({ name, location, findings });
    }
  }

  return {
    research,
    findings,
    nearMisses,
    queries,
    engine,
    queriesCompleted,
  };
}
