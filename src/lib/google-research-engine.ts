import { createHash } from "node:crypto";

import type {
  Prospect,
  ResearchDiagnostics,
  SearchSourceKind,
  WebSearchResult,
} from "@/lib/types";

const GOOGLE_ORIGIN = "https://www.google.com";
const GOOGLE_CUSTOM_SEARCH_ORIGIN = "https://customsearch.googleapis.com";
const DUCKDUCKGO_ORIGIN = "https://html.duckduckgo.com";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 2_000_000;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

type SearchProvider = "google_custom_search" | "google_public_search" | "keyless_web_fallback";

type RawSearchResult = {
  title: string;
  url: string;
  snippet: string;
  provider: SearchProvider;
  query: string;
  position: number;
};

type GoogleCustomSearchPayload = {
  items?: Array<{ title?: string; link?: string; snippet?: string }>;
  error?: { message?: string };
};

export type GoogleResearchResult = {
  queries: string[];
  results: WebSearchResult[];
  diagnostics: ResearchDiagnostics;
  retrievedAt: string;
};

type CacheEntry = { expiresAt: number; result: GoogleResearchResult };

const researchCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<GoogleResearchResult>>();

function numberEnv(name: string, fallback: number, minimum: number, maximum: number) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function plainText(value: string) {
  return decodeEntities(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function hashId(...parts: string[]) {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

function configuredDomains() {
  return (process.env.RESEARCH_SEARCH_DOMAINS || "")
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean)
    .slice(0, 8);
}

function websiteHost(prospect: Prospect) {
  if (!prospect.website) return null;
  try {
    return new URL(prospect.website).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function addressContext(address: string) {
  const parts = address.split(",").map((value) => value.trim()).filter(Boolean);
  const city = parts.length >= 2 ? parts[parts.length - 2] : "";
  const stateZip = parts.length >= 1 ? parts[parts.length - 1] : "";
  return [city, stateZip].filter(Boolean).join(" ").slice(0, 100);
}

export function planCompanyResearchQueries(prospect: Prospect, requested?: string[]) {
  const maximum = numberEnv("GOOGLE_RESEARCH_MAX_QUERIES", 9, 1, 16);
  if (requested?.length) {
    return [...new Set(requested.map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean))]
      .filter((value) => value.length >= 2 && value.length <= 240)
      .slice(0, maximum);
  }

  const name = prospect.name.replace(/["“”]/g, "").trim().slice(0, 140);
  const exactName = `"${name}"`;
  const location = addressContext(prospect.address);
  const officialHost = websiteHost(prospect);
  const queries = [
    `${exactName} ${location}`,
    `${exactName} official website contact ${location}`,
    `${exactName} company registration entity number ${location}`,
    `${exactName} EIN FEIN LEI DUNS NAICS`,
    `${exactName} owner leadership about`,
    `${exactName} address phone email ${location}`,
    `${exactName} license state registry ${location}`,
    `${exactName} news ${location}`,
    ...(officialHost
      ? [`site:${officialHost} ${exactName}`, `site:${officialHost} ${exactName} about contact company`]
      : []),
    ...configuredDomains().map((domain) => `site:${domain} ${exactName} ${location}`),
  ];

  return [...new Set(queries.map((value) => value.replace(/\s+/g, " ").trim()))].slice(0, maximum);
}

function googleCustomSearchConfigured() {
  return Boolean(
    (process.env.GOOGLE_SEARCH_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim()) &&
      process.env.GOOGLE_SEARCH_ENGINE_ID?.trim(),
  );
}

export function googleResearchStatus() {
  return {
    engine: "first_party_google_research",
    googleCustomSearch: googleCustomSearchConfigured() ? "active" : "not_configured",
    googlePublicSearch:
      process.env.ENABLE_GOOGLE_SEARCH_SCRAPER === "false" ? "disabled" : "active_with_runtime_probe",
    keylessFallback:
      process.env.ENABLE_KEYLESS_WEB_SEARCH_FALLBACK === "false" ? "disabled" : "active",
    domains: configuredDomains(),
  };
}

async function responseText(response: Response) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error("Search provider returned an oversized response.");
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new Error("Search provider returned an oversized response.");
  return text;
}

async function fetchText(url: URL, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.7",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": process.env.GOOGLE_RESEARCH_USER_AGENT?.trim() || USER_AGENT,
      ...init?.headers,
    },
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await responseText(response);
  if (
    response.status === 403 ||
    response.status === 429 ||
    response.url.includes("/sorry/") ||
    /unusual traffic|g-recaptcha|recaptcha\/api/i.test(text)
  ) {
    throw new Error(`Search provider blocked the request (${response.status}); no access control was bypassed.`);
  }
  if (!response.ok) throw new Error(`Search provider returned ${response.status}.`);
  return text;
}

function canonicalResultUrl(value: string, base: string) {
  try {
    let url = new URL(decodeEntities(value), base);
    if (url.hostname.endsWith("duckduckgo.com") && url.pathname === "/l/") {
      const destination = url.searchParams.get("uddg");
      if (destination) url = new URL(destination);
    }
    if (url.hostname.endsWith("google.com") && url.pathname === "/url") {
      const destination = url.searchParams.get("q") || url.searchParams.get("url");
      if (destination) url = new URL(destination);
    }
    if (!/^https?:$/.test(url.protocol)) return null;
    if (
      /(^|\.)google\.[a-z.]+$/i.test(url.hostname) ||
      /(^|\.)duckduckgo\.com$/i.test(url.hostname)
    ) {
      return null;
    }
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_|^(gclid|fbclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function searchGoogleCustom(query: string): Promise<RawSearchResult[]> {
  const key = process.env.GOOGLE_SEARCH_API_KEY?.trim() || process.env.GOOGLE_MAPS_API_KEY?.trim();
  const cx = process.env.GOOGLE_SEARCH_ENGINE_ID?.trim();
  if (!key || !cx) return [];
  const url = new URL("/customsearch/v1", GOOGLE_CUSTOM_SEARCH_ORIGIN);
  url.searchParams.set("key", key);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", query);
  url.searchParams.set("num", "10");
  url.searchParams.set("safe", "active");
  url.searchParams.set("gl", "us");
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const payload = (await response.json()) as GoogleCustomSearchPayload;
  if (!response.ok) throw new Error(payload.error?.message || `Google Custom Search returned ${response.status}.`);
  return (payload.items ?? []).flatMap((item, index) => {
    const url = item.link ? canonicalResultUrl(item.link, GOOGLE_ORIGIN) : null;
    return url
      ? [{
          title: item.title?.replace(/\s+/g, " ").trim() || new URL(url).hostname,
          url,
          snippet: item.snippet?.replace(/\s+/g, " ").trim() || "",
          provider: "google_custom_search" as const,
          query,
          position: index + 1,
        }]
      : [];
  });
}

function parseGoogleHtml(html: string, query: string): RawSearchResult[] {
  const results: RawSearchResult[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>[\s\S]{0,900}?<h3\b[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<\/a>/gi)) {
    const url = canonicalResultUrl(match[1], GOOGLE_ORIGIN);
    const title = plainText(match[2]);
    if (!url || !title) continue;
    const following = html.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 1_500);
    const snippet = plainText(following.match(/<(?:div|span)\b[^>]*>([\s\S]{20,700}?)<\/(?:div|span)>/i)?.[1] || "").slice(0, 500);
    results.push({ title, url, snippet, provider: "google_public_search", query, position: results.length + 1 });
  }
  return results.slice(0, 10);
}

async function searchGooglePublic(query: string) {
  const url = new URL("/search", GOOGLE_ORIGIN);
  url.searchParams.set("q", query);
  url.searchParams.set("hl", "en");
  url.searchParams.set("gl", "us");
  url.searchParams.set("num", "10");
  url.searchParams.set("filter", "0");
  url.searchParams.set("pws", "0");
  const html = await fetchText(url);
  const results = parseGoogleHtml(html, query);
  if (!results.length && /enablejs|sg_trbl|update your browser/i.test(html)) {
    throw new Error("Google returned a JavaScript-gated search page instead of result records.");
  }
  if (!results.length) throw new Error("Google returned no parseable public result records.");
  return results;
}

function parseDuckDuckGoHtml(html: string, query: string): RawSearchResult[] {
  const anchors = [...html.matchAll(/<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  return anchors.flatMap((match, index) => {
    const url = canonicalResultUrl(match[1], DUCKDUCKGO_ORIGIN);
    const title = plainText(match[2]);
    if (!url || !title) return [];
    const start = (match.index ?? 0) + match[0].length;
    const end = anchors[index + 1]?.index ?? Math.min(html.length, start + 4_000);
    const block = html.slice(start, end);
    const snippet = plainText(
      block.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i)?.[1] || "",
    ).slice(0, 500);
    return [{ title, url, snippet, provider: "keyless_web_fallback" as const, query, position: index + 1 }];
  }).slice(0, 10);
}

async function searchKeylessFallback(query: string) {
  const url = new URL("/html/", DUCKDUCKGO_ORIGIN);
  url.searchParams.set("q", query);
  const html = await fetchText(url);
  if (/anomaly-modal|challenge-form|captcha/i.test(html)) {
    throw new Error("The keyless web index requested a challenge; no challenge was bypassed.");
  }
  const results = parseDuckDuckGoHtml(html, query);
  if (!results.length) throw new Error("The keyless web index returned no parseable results.");
  return results;
}

function sourceClassification(urlValue: string, officialHost: string | null) {
  const hostname = new URL(urlValue).hostname.toLowerCase().replace(/^www\./, "");
  const configured = configuredDomains();
  let sourceKind: SearchSourceKind = "other";
  let authorityScore = 50;

  if (officialHost && (hostname === officialHost || hostname.endsWith(`.${officialHost}`))) {
    sourceKind = "official_site";
    authorityScore = 100;
  } else if (hostname.endsWith(".gov") || hostname.endsWith(".gov.uk") || hostname.endsWith(".gc.ca")) {
    sourceKind = "government_registry";
    authorityScore = 98;
  } else if (configured.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) {
    sourceKind = "professional_registry";
    authorityScore = 92;
  } else if (/opencorporates|lei-|gleif|ncua|sec\.gov|bbb\.org|chamberofcommerce/i.test(hostname)) {
    sourceKind = "professional_registry";
    authorityScore = 82;
  } else if (/linkedin|facebook|instagram|x\.com|twitter|youtube|tiktok/i.test(hostname)) {
    sourceKind = "social";
    authorityScore = 35;
  } else if (/reuters|apnews|bloomberg|businesswire|prnewswire|news|times|journal|herald/i.test(hostname)) {
    sourceKind = "news";
    authorityScore = 68;
  } else if (/yelp|yellowpages|mapquest|bizapedia|buzzfile|dnb|zoominfo|directory|lookup/i.test(hostname)) {
    sourceKind = "directory";
    authorityScore = 48;
  }
  return { sourceKind, authorityScore };
}

function nameTokens(name: string) {
  const ignored = new Set(["the", "and", "company", "inc", "llc", "ltd", "corp", "corporation", "services"]);
  return name.toLowerCase().split(/[^a-z0-9]+/).filter((value) => value.length >= 3 && !ignored.has(value));
}

function relevanceScore(result: RawSearchResult, prospect: Prospect) {
  const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  const tokens = nameTokens(prospect.name);
  const tokenMatches = tokens.filter((token) => haystack.includes(token)).length;
  const exactName = haystack.includes(prospect.name.toLowerCase());
  const addressTokens = addressContext(prospect.address).toLowerCase().split(/\s+/).filter((value) => value.length >= 4);
  const locationMatches = addressTokens.filter((token) => haystack.includes(token)).length;
  return Math.min(35, (exactName ? 18 : 0) + tokenMatches * 5 + Math.min(7, locationMatches * 2));
}

function resultKey(value: string) {
  const url = new URL(value);
  return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}`;
}

function rankAndDedupe(raw: RawSearchResult[], prospect: Prospect) {
  const officialHost = websiteHost(prospect);
  const byUrl = new Map<string, WebSearchResult>();
  for (const item of raw) {
    const { sourceKind, authorityScore } = sourceClassification(item.url, officialHost);
    const relevance = relevanceScore(item, prospect);
    const rank = Math.round(authorityScore * 0.55 + relevance + Math.max(0, 12 - item.position));
    const key = resultKey(item.url);
    const existing = byUrl.get(key);
    if (existing) {
      existing.matchedQueries = [...new Set([...existing.matchedQueries, item.query])];
      if (rank > existing.rank) {
        existing.title = item.title;
        existing.snippet = item.snippet || existing.snippet;
        existing.rank = rank;
        existing.query = item.query;
        existing.provider = item.provider;
      }
      continue;
    }
    byUrl.set(key, {
      id: hashId(item.url),
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      provider:
        item.provider === "google_custom_search"
          ? "Google Programmable Search"
          : item.provider === "google_public_search"
            ? "Google public search"
            : "Keyless web index fallback",
      query: item.query,
      matchedQueries: [item.query],
      rank,
      authorityScore,
      sourceKind,
    });
  }
  return [...byUrl.values()]
    .filter((item) => item.rank >= 40)
    .sort((a, b) => b.rank - a.rank || b.authorityScore - a.authorityScore)
    .slice(0, numberEnv("GOOGLE_RESEARCH_MAX_RESULTS", 30, 5, 60));
}

function cacheKey(prospect: Prospect, queries: string[]) {
  return hashId(prospect.name, prospect.address, prospect.website || "", ...queries);
}

function pruneCache() {
  const now = Date.now();
  for (const [key, value] of researchCache) if (value.expiresAt <= now) researchCache.delete(key);
  while (researchCache.size > 50) researchCache.delete(researchCache.keys().next().value!);
}

async function runResearch(prospect: Prospect, queries: string[]): Promise<GoogleResearchResult> {
  const retrievedAt = new Date().toISOString();
  const failures: string[] = [];
  const providers: string[] = [];
  const raw: RawSearchResult[] = [];
  let completed = 0;
  let provider: SearchProvider;
  let firstResults: RawSearchResult[] | null = null;

  if (googleCustomSearchConfigured()) {
    provider = "google_custom_search";
    providers.push("Google Programmable Search");
  } else if (process.env.ENABLE_GOOGLE_SEARCH_SCRAPER !== "false") {
    try {
      firstResults = await searchGooglePublic(queries[0]);
      provider = "google_public_search";
      providers.push("Google public search");
      raw.push(...firstResults);
      completed += 1;
    } catch (error) {
      failures.push(`Google public search: ${error instanceof Error ? error.message : String(error)}`);
      if (process.env.ENABLE_KEYLESS_WEB_SEARCH_FALLBACK === "false") {
        provider = "google_public_search";
        providers.push("Google public search");
      } else {
        provider = "keyless_web_fallback";
        providers.push("Google public search (runtime probe)", "Keyless web index fallback");
      }
    }
  } else {
    provider = "keyless_web_fallback";
    providers.push("Keyless web index fallback");
  }

  const startIndex = firstResults ? 1 : 0;
  let nextIndex = startIndex;
  const concurrency = numberEnv("GOOGLE_RESEARCH_CONCURRENCY", 2, 1, 4);
  const delayMs = numberEnv("GOOGLE_RESEARCH_DELAY_MS", 200, 0, 3_000);

  async function worker() {
    while (nextIndex < queries.length) {
      const index = nextIndex++;
      const query = queries[index];
      try {
        const results =
          provider === "google_custom_search"
            ? await searchGoogleCustom(query)
            : provider === "google_public_search"
              ? await searchGooglePublic(query)
              : await searchKeylessFallback(query);
        raw.push(...results);
        completed += 1;
      } catch (error) {
        failures.push(`${query}: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (delayMs && nextIndex < queries.length) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queries.length - startIndex) }, () => worker()));
  const results = rankAndDedupe(raw, prospect);
  return {
    queries,
    results,
    diagnostics: {
      engine: "first_party_google_research",
      providers,
      queriesPlanned: queries.length,
      queriesCompleted: completed,
      rawResults: raw.length,
      uniqueResults: results.length,
      pagesSelected: 0,
      pagesRead: 0,
      failures,
      cacheHit: false,
    },
    retrievedAt,
  };
}

export async function researchGoogleWeb(
  prospect: Prospect,
  requestedQueries?: string[],
): Promise<GoogleResearchResult> {
  const queries = planCompanyResearchQueries(prospect, requestedQueries);
  if (!queries.length) throw new Error("The Google research engine has no valid search queries.");
  pruneCache();
  const key = cacheKey(prospect, queries);
  const cached = researchCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      ...cached.result,
      diagnostics: { ...cached.result.diagnostics, cacheHit: true },
    };
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = runResearch(prospect, queries)
    .then((result) => {
      const ttl = numberEnv("GOOGLE_RESEARCH_CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_MS / 1_000, 30, 86_400);
      researchCache.set(key, { expiresAt: Date.now() + ttl * 1_000, result });
      return result;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
