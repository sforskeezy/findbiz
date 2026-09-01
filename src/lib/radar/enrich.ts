import { researchGoogleWeb } from "@/lib/google-research-engine";
import { isProspectSignal, SIGNAL_LABELS } from "@/lib/radar/catalog";
import { hashKey } from "@/lib/radar/identity";
import { extractDateFromText } from "@/lib/radar/time";
import type { DatePrecision, SignalEvidence, SignalType } from "@/lib/radar/types";
import { fetchPublicPage } from "@/lib/radar/web";
import type { Prospect, WebSearchResult } from "@/lib/types";

export type EnrichmentHit = {
  type: SignalType;
  snippet: string;
  url: string | null;
  sourceLabel: string;
  occurredAt: string | null;
  precision: DatePrecision;
  hiringCount: number | null;
};

export type BusinessEnrichment = {
  prospectId: string;
  hits: EnrichmentHit[];
  pagesRead: number;
  searchResults: number;
};

const PATTERN_SET: Array<{ type: SignalType; pattern: RegExp }> = [
  { type: "grand_opening", pattern: /\b(grand opening|ribbon[- ]cutting|now open(?:ing)?(?: for business)?|officially open)\b/i },
  { type: "coming_soon", pattern: /\b(coming soon|opening soon|now accepting|opens? (?:this|next) (?:week|month)|opening in \d{4})\b/i },
  { type: "expanding", pattern: /\b(new location|second (?:office|location)|now (?:also )?(?:located|serving) in|expanded (?:into|to)|additional location)\b/i },
  { type: "renovation", pattern: /\b(under renovation|newly renovated|remodel(?:ing|ed)?|renovation in progress)\b/i },
  { type: "new_ownership", pattern: /\b(under new ownership|under new management|now under new management)\b/i },
  { type: "reopened", pattern: /\b(now reopened|reopened|we're back|we are back)\b/i },
  { type: "newly_registered", pattern: /\b(articles of (?:organization|incorporation)|certificate of organization|newly (?:formed|registered|incorporated)|filed (?:on|with))\b/i },
];

function sourceKindLabel(url: string | null, fallback: string) {
  if (!url) return fallback;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (/\.gov$/i.test(host)) return `${host} registry`;
    return host;
  } catch {
    return fallback;
  }
}

function snippetAround(text: string, pattern: RegExp, width = 160) {
  const match = pattern.exec(text);
  if (!match || match.index == null) return text.slice(0, width).trim();
  let start = Math.max(0, match.index - 40);
  let end = Math.min(text.length, match.index + match[0].length + 90);
  while (start > 0 && /[A-Za-z0-9]/.test(text[start - 1])) start -= 1;
  while (end < text.length && /[A-Za-z0-9]/.test(text[end])) end += 1;
  const slice = text.slice(start, Math.min(end, start + width)).trim();
  return slice;
}

function looksLikeDebtCollection(text: string) {
  return /\b(debt|collection agency|collections?|collector|account balance|past due|owed)\b/i.test(text);
}

function looksLikeHiring(text: string) {
  return /\b(now hiring|we(?:'re| are) hiring|job openings?|join our team|apply (?:now|today)|careers?)\b/i.test(text);
}

function hitsFromText(text: string, url: string | null, sourceLabel: string): EnrichmentHit[] {
  const hits: EnrichmentHit[] = [];
  for (const rule of PATTERN_SET) {
    if (!isProspectSignal(rule.type)) continue;
    if (!rule.pattern.test(text)) continue;
    const snippet = snippetAround(text, rule.pattern);
    if (rule.type === "new_ownership" && looksLikeDebtCollection(snippet)) continue;
    if (looksLikeHiring(snippet) && !/\b(grand opening|now open|coming soon|new location|under new (?:ownership|management))\b/i.test(snippet)) {
      continue;
    }
    const dated = extractDateFromText(snippet) || extractDateFromText(text.slice(0, 1_200));
    hits.push({
      type: rule.type,
      snippet,
      url,
      sourceLabel,
      occurredAt: dated?.iso ?? null,
      precision: dated?.precision ?? "unknown",
      hiringCount: null,
    });
  }
  return hits;
}

function cityHint(address: string) {
  const parts = address.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.slice(-2).join(" ").slice(0, 80);
}

export function planRadarQueries(prospect: Prospect) {
  const name = `"${prospect.name.replace(/["“”]/g, "").slice(0, 120)}"`;
  const city = cityHint(prospect.address);
  return [
    `${name} ${city} "grand opening" OR "now open" OR "coming soon" OR "new location"`,
    `${name} ${city} "under new ownership" OR "second location" OR expanded OR renovated`,
  ];
}

function searchHits(results: WebSearchResult[]): EnrichmentHit[] {
  const hits: EnrichmentHit[] = [];
  for (const result of results) {
    const blob = `${result.title} ${result.snippet}`;
    const extracted = hitsFromText(blob, result.url, sourceKindLabel(result.url, result.provider));
    for (const hit of extracted) {
      if (hit.type === "newly_registered" && result.sourceKind !== "government_registry" && !/\.gov\b/i.test(result.url)) {
        continue;
      }
      hits.push(hit);
    }
  }
  return hits;
}

function dedupeHits(hits: EnrichmentHit[]) {
  const kept: EnrichmentHit[] = [];
  for (const hit of hits) {
    const duplicate = kept.find(
      (item) => item.type === hit.type && (item.url || "") === (hit.url || "") && item.snippet.slice(0, 40) === hit.snippet.slice(0, 40),
    );
    if (!duplicate) kept.push(hit);
  }
  return kept;
}

export async function enrichBusiness(prospect: Prospect): Promise<BusinessEnrichment> {
  const hits: EnrichmentHit[] = [];
  let pagesRead = 0;
  let searchResults = 0;

  if (prospect.website) {
    try {
      const home = await fetchPublicPage(prospect.website);
      pagesRead += 1;
      hits.push(...hitsFromText(home.text, home.url, sourceKindLabel(home.url, "Company website")));
    } catch {
      // Website inspection is optional; listing and search evidence can still stand.
    }
  }

  try {
    const research = await researchGoogleWeb(prospect, planRadarQueries(prospect));
    searchResults = research.results.length;
    hits.push(...searchHits(research.results));
  } catch {
    // Keyless search can fail without invalidating snapshot diffs.
  }

  return {
    prospectId: prospect.id,
    hits: dedupeHits(hits),
    pagesRead,
    searchResults,
  };
}

export function evidenceFromHit(hit: EnrichmentHit, observedAt: string): SignalEvidence {
  return {
    id: hashKey(hit.type, hit.url || "", hit.snippet.slice(0, 80)),
    label: SIGNAL_LABELS[hit.type].short,
    snippet: hit.snippet,
    url: hit.url,
    sourceLabel: hit.sourceLabel,
    observedAt,
    confidence: hit.url ? "Verified" : "Estimated",
  };
}

export function numberEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

export async function enrichBusinesses(prospects: Prospect[], onProgress?: (done: number, total: number) => void) {
  const concurrency = numberEnv("RADAR_ENRICH_CONCURRENCY", 2, 1, 4);
  const results: BusinessEnrichment[] = [];
  let next = 0;
  async function worker() {
    while (next < prospects.length) {
      const index = next++;
      const prospect = prospects[index];
      try {
        results[index] = await enrichBusiness(prospect);
      } catch {
        results[index] = { prospectId: prospect.id, hits: [], pagesRead: 0, searchResults: 0 };
      }
      onProgress?.(Math.min(index + 1, prospects.length), prospects.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, prospects.length) }, () => worker()));
  return results.filter(Boolean);
}
