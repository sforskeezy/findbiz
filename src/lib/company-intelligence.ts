import { lookup } from "node:dns/promises";
import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { researchGoogleWeb } from "@/lib/google-research-engine";
import type {
  CompanyIntelligence,
  Confidence,
  Prospect,
  PublicFact,
  PublicFactKind,
  ResearchDiagnostics,
  SourceRecord,
  WebSearchResult,
} from "@/lib/types";

const MAX_HTML_BYTES = 1_000_000;
const MAX_PAGES = 5;
const FETCH_TIMEOUT_MS = 8_000;
const CONTACT_LINK = /\b(about|contact|company|team|location|our-story|who-we-are)\b/i;
const PHONE_PATTERN = /(?:\+?1[\s.()-]*)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const COMPANY_ID_PATTERN = /\b(company|registration|entity|corporation|business|license)\s*(?:number|no\.?|id)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,30})\b/gi;
const IDENTIFIER_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  { label: "Employer ID (EIN)", pattern: /\b(?:EIN|FEIN|Employer Identification Number)\s*(?:number|no\.?|#|:)?\s*[:#-]?\s*(\d{2}-?\d{7})\b/gi },
  { label: "Legal Entity Identifier (LEI)", pattern: /\b(?:LEI|Legal Entity Identifier)\s*(?:number|no\.?|#|:)?\s*[:#-]?\s*([A-Z0-9]{18}\d{2})\b/gi },
  { label: "D-U-N-S", pattern: /\b(?:D-?U-?N-?S|DUNS)\s*(?:number|no\.?|#|:)?\s*[:#-]?\s*(\d{9})\b/gi },
  { label: "NAICS", pattern: /\bNAICS\s*(?:code|number|no\.?|#|:)?\s*[:#-]?\s*(\d{2,6})\b/gi },
  { label: "NCUA charter number", pattern: /\b(?:NCUA\s+)?charter\s*(?:number|no\.?|#|:)\s*[:#-]?\s*(\d{3,12})\b/gi },
  { label: "State filing number", pattern: /\b(?:state\s+)?(?:file|filing|entity)\s*(?:number|no\.?|#|id)\s*[:#-]?\s*([A-Z0-9-]{4,30})\b/gi },
];

type PageSnapshot = {
  url: string;
  title: string;
  html: string;
  text: string;
};

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function plainText(html: string) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2] ? decodeEntities(match[2].trim()) : null;
}

function metaContent(html: string, names: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attribute(tag, "name") || attribute(tag, "property"))?.toLowerCase();
    if (key && names.includes(key)) {
      const content = attribute(tag, "content");
      if (content) return content;
    }
  }
  return null;
}

function pageTitle(html: string, fallbackUrl: string) {
  const title = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) return plainText(title).slice(0, 160);
  return new URL(fallbackUrl).hostname.replace(/^www\./, "");
}

function privateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateIp(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(normalized) === 4) return privateIpv4(normalized);
  if (isIP(normalized) === 6) {
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
  }
  return true;
}

async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only public HTTP websites can be researched.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Local network addresses cannot be researched.");
  }
  if (isIP(hostname)) {
    if (privateIp(hostname)) throw new Error("Private network addresses cannot be researched.");
  } else {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((result) => privateIp(result.address))) {
      throw new Error("The website does not resolve to a public address.");
    }
  }
  return url;
}

async function fetchHtml(input: string): Promise<PageSnapshot> {
  let url = await assertPublicUrl(input);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": `ProspectIQ-PublicResearch/1.0${process.env.OSM_CONTACT_EMAIL ? ` (${process.env.OSM_CONTACT_EMAIL})` : ""}`,
      },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Website redirect ${response.status} had no destination.`);
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Website returned ${response.status}.`);

    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      throw new Error("Website did not return an HTML page.");
    }
    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_HTML_BYTES) throw new Error("Website page was too large to inspect safely.");

    const html = (await response.text()).slice(0, MAX_HTML_BYTES);
    return { url: url.toString(), title: pageTitle(html, url.toString()), html, text: plainText(html) };
  }
  throw new Error("Website redirected too many times.");
}

function comparableHost(value: string) {
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

function discoverCompanyLinks(page: PageSnapshot) {
  const originHost = comparableHost(page.url);
  const links: string[] = [];
  for (const tag of page.html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attribute(tag, "href");
    if (!href || !CONTACT_LINK.test(href)) continue;
    try {
      const url = new URL(href, page.url);
      url.hash = "";
      if (/^https?:$/.test(url.protocol) && comparableHost(url.toString()) === originHost) links.push(url.toString());
    } catch {
      // Ignore malformed public-page links.
    }
  }
  return [...new Set(links)].slice(0, MAX_PAGES - 1);
}

function hashId(...parts: string[]) {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

function sourceLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "Public web";
  }
}

function addFact(
  facts: PublicFact[],
  params: {
    kind: PublicFactKind;
    label: string;
    value: unknown;
    sourceUrl: string;
    retrievedAt: string;
    confidence?: Confidence;
  },
) {
  const value = typeof params.value === "string" || typeof params.value === "number" ? String(params.value).trim() : "";
  if (!value || value.length > 500) return;
  const normalizedValue = (kind: PublicFactKind, candidate: string) => {
    if (kind === "phone") return candidate.replace(/\D/g, "").slice(-10);
    if (kind === "email") return candidate.toLowerCase();
    if (kind === "website" || kind === "social") {
      try {
        const url = new URL(candidate);
        return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "")}`;
      } catch {
        return candidate.toLowerCase();
      }
    }
    return candidate.toLowerCase().replace(/\W/g, "");
  };
  const key = `${params.kind}:${normalizedValue(params.kind, value)}`;
  const existing = facts.find((fact) => `${fact.kind}:${normalizedValue(fact.kind, fact.value)}` === key);
  if (existing) {
    if (existing.sourceUrl !== params.sourceUrl) {
      const source = { label: sourceLabel(params.sourceUrl), url: params.sourceUrl };
      if (!(existing.corroboratingSources ?? []).some((item) => item.url === source.url)) {
        existing.corroboratingSources = [...(existing.corroboratingSources ?? []), source];
      }
    }
    if (params.confidence === "Verified" && existing.confidence !== "Verified") existing.confidence = "Verified";
    return;
  }
  facts.push({
    id: hashId(params.kind, value, params.sourceUrl),
    kind: params.kind,
    label: params.label,
    value,
    sourceUrl: params.sourceUrl,
    sourceLabel: sourceLabel(params.sourceUrl),
    retrievedAt: params.retrievedAt,
    confidence: params.confidence ?? "Verified",
  });
}

function addIdentifierFacts(
  text: string,
  facts: PublicFact[],
  sourceUrl: string,
  retrievedAt: string,
  confidence: Confidence,
) {
  for (const { label, pattern } of IDENTIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      addFact(facts, {
        kind: "company_id",
        label,
        value: match[1],
        sourceUrl,
        retrievedAt,
        confidence,
      });
    }
  }
  for (const match of text.matchAll(COMPANY_ID_PATTERN)) {
    addFact(facts, {
      kind: "company_id",
      label: `Published ${match[1].toLowerCase()} number`,
      value: match[2],
      sourceUrl,
      retrievedAt,
      confidence,
    });
  }
}

function values(value: unknown): string[] {
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(values);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return values(record.value ?? record.name ?? record.url);
  }
  return [];
}

function jsonLdObjects(html: string) {
  const objects: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeEntities(match[1].trim())) as unknown;
      const walk = (value: unknown) => {
        if (Array.isArray(value)) return value.forEach(walk);
        if (!value || typeof value !== "object") return;
        const record = value as Record<string, unknown>;
        objects.push(record);
        if (record["@graph"]) walk(record["@graph"]);
      };
      walk(parsed);
    } catch {
      // Invalid structured data should not prevent other public facts from loading.
    }
  }
  return objects;
}

function addPageFacts(page: PageSnapshot, facts: PublicFact[], retrievedAt: string) {
  const description = metaContent(page.html, ["description", "og:description"]);
  addFact(facts, {
    kind: "description",
    label: "Published description",
    value: description,
    sourceUrl: page.url,
    retrievedAt,
  });

  for (const object of jsonLdObjects(page.html)) {
    const types = values(object["@type"]).join(" ").toLowerCase();
    if (!/(organization|business|corporation|company|store|service|restaurant|contractor|school|office)/.test(types)) continue;

    addFact(facts, { kind: "legal_name", label: "Published legal name", value: object.legalName, sourceUrl: page.url, retrievedAt });
    addFact(facts, { kind: "phone", label: "Published phone", value: object.telephone, sourceUrl: page.url, retrievedAt });
    addFact(facts, { kind: "email", label: "Published email", value: object.email, sourceUrl: page.url, retrievedAt });
    addFact(facts, { kind: "founded", label: "Founded", value: object.foundingDate, sourceUrl: page.url, retrievedAt });
    addFact(facts, { kind: "team_size", label: "Published team size", value: object.numberOfEmployees, sourceUrl: page.url, retrievedAt });
    addFact(facts, { kind: "company_id", label: "Tax ID", value: object.taxID, sourceUrl: page.url, retrievedAt });
    addFact(facts, { kind: "company_id", label: "VAT ID", value: object.vatID, sourceUrl: page.url, retrievedAt });
    addFact(facts, { kind: "company_id", label: "LEI", value: object.leiCode, sourceUrl: page.url, retrievedAt });
    addFact(facts, { kind: "company_id", label: "D-U-N-S", value: object.duns, sourceUrl: page.url, retrievedAt });
    addFact(facts, { kind: "company_id", label: "NAICS", value: object.naics, sourceUrl: page.url, retrievedAt });
    for (const identifier of values(object.identifier)) {
      addFact(facts, { kind: "company_id", label: "Published company identifier", value: identifier, sourceUrl: page.url, retrievedAt });
    }
    for (const social of values(object.sameAs)) {
      if (/^https?:\/\//i.test(social)) addFact(facts, { kind: "social", label: "Published profile", value: social, sourceUrl: page.url, retrievedAt });
    }
  }

  const telLinks = [...page.html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((match) =>
    decodeEntities(decodeURIComponent(match[1])),
  );
  const mailLinks = [...page.html.matchAll(/href=["']mailto:([^?"']+)/gi)].map((match) =>
    decodeEntities(decodeURIComponent(match[1])),
  );
  const phoneMatches = [...page.text.matchAll(PHONE_PATTERN)].map((match) => match[0]);
  const emailMatches = [...page.text.matchAll(EMAIL_PATTERN)].map((match) => match[0]);

  for (const phone of [...telLinks, ...phoneMatches].slice(0, 8)) {
    addFact(facts, { kind: "phone", label: "Published phone", value: phone, sourceUrl: page.url, retrievedAt });
  }
  for (const email of [...mailLinks, ...emailMatches].slice(0, 8)) {
    addFact(facts, { kind: "email", label: "Published email", value: email, sourceUrl: page.url, retrievedAt });
  }
  addIdentifierFacts(page.text, facts, page.url, retrievedAt, "Estimated");
}

function emptyResearch(): ResearchDiagnostics {
  return {
    engine: "first_party_google_research",
    providers: [],
    queriesPlanned: 0,
    queriesCompleted: 0,
    rawResults: 0,
    uniqueResults: 0,
    pagesSelected: 0,
    pagesRead: 0,
    failures: [],
    cacheHit: false,
  };
}

function addSearchFacts(results: WebSearchResult[], facts: PublicFact[], retrievedAt: string) {
  for (const result of results) {
    for (const phone of result.snippet.match(PHONE_PATTERN) ?? []) {
      addFact(facts, { kind: "phone", label: "Phone found in search", value: phone, sourceUrl: result.url, retrievedAt, confidence: "Estimated" });
    }
    for (const email of result.snippet.match(EMAIL_PATTERN) ?? []) {
      addFact(facts, { kind: "email", label: "Email found in search", value: email, sourceUrl: result.url, retrievedAt, confidence: "Estimated" });
    }
    for (const match of result.snippet.matchAll(COMPANY_ID_PATTERN)) {
      addFact(facts, {
        kind: "company_id",
        label: `Published ${match[1].toLowerCase()} number`,
        value: match[2],
        sourceUrl: result.url,
        retrievedAt,
        confidence: "Estimated",
      });
    }
  }
}

function descriptionFromHome(page: PageSnapshot | undefined) {
  if (!page) return null;
  return metaContent(page.html, ["description", "og:description"])?.replace(/\s+/g, " ").trim().slice(0, 320) || null;
}

export async function researchCompany(prospect: Prospect): Promise<CompanyIntelligence> {
  const retrievedAt = new Date().toISOString();
  const facts: PublicFact[] = [];
  const pages: PageSnapshot[] = [];
  const warnings: string[] = [];
  const listingUrl = prospect.directoryUrl || prospect.website;

  if (listingUrl) {
    addFact(facts, {
      kind: "address",
      label: "Listed address",
      value: prospect.address,
      sourceUrl: listingUrl,
      retrievedAt,
      confidence: prospect.confidence,
    });
    addFact(facts, {
      kind: "phone",
      label: "Listed phone",
      value: prospect.phone,
      sourceUrl: listingUrl,
      retrievedAt,
      confidence: prospect.confidence,
    });
    addFact(facts, {
      kind: "website",
      label: "Listed website",
      value: prospect.website,
      sourceUrl: listingUrl,
      retrievedAt,
      confidence: prospect.confidence,
    });
    addFact(facts, {
      kind: "rating",
      label: "Public rating",
      value:
        prospect.rating == null
          ? null
          : `${prospect.rating.toFixed(1)}${prospect.reviewCount ? ` · ${prospect.reviewCount.toLocaleString()} reviews` : ""}`,
      sourceUrl: listingUrl,
      retrievedAt,
      confidence: prospect.confidence,
    });
    addFact(facts, {
      kind: "hours",
      label: "Published hours",
      value: prospect.hours?.join(" · "),
      sourceUrl: listingUrl,
      retrievedAt,
      confidence: prospect.confidence,
    });
    addFact(facts, {
      kind: "description",
      label: "Maps description",
      value: prospect.publicNotes,
      sourceUrl: listingUrl,
      retrievedAt,
      confidence: prospect.confidence,
    });
  }

  // The site crawl and the search engine touch different hosts, so run them together
  // instead of paying for one and then the other.
  const sitePages: Promise<PageSnapshot[]> = (async () => {
    if (!prospect.website) {
      warnings.push("No official website was supplied by the business directory, so site-level contact research was skipped.");
      return [];
    }
    try {
      const home = await fetchHtml(prospect.website);
      const found = [home];
      const links = discoverCompanyLinks(home);
      const detailPages = await Promise.allSettled(links.map((url) => fetchHtml(url)));
      for (const result of detailPages) {
        if (result.status === "fulfilled" && !found.some((page) => page.url === result.value.url)) found.push(result.value);
      }
      if (detailPages.some((result) => result.status === "rejected")) {
        warnings.push("Some linked company pages could not be read.");
      }
      return found;
    } catch (error) {
      warnings.push(error instanceof Error ? `Official website research: ${error.message}` : "Official website could not be read.");
      return [];
    }
  })();

  const googleSearch = researchGoogleWeb(prospect).then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );

  const [crawled, googleOutcome] = await Promise.all([sitePages, googleSearch]);
  pages.push(...crawled);

  for (const page of pages) addPageFacts(page, facts, retrievedAt);

  let searchResults: WebSearchResult[] = [];
  let research = emptyResearch();
  try {
    if (!googleOutcome.ok) throw googleOutcome.error;
    const google = googleOutcome.value;
    searchResults = google.results;
    research = { ...google.diagnostics };
    addSearchFacts(searchResults, facts, retrievedAt);

    const already = new Set(
      pages.flatMap((page) => {
        try {
          return [comparableHost(page.url)];
        } catch {
          return [];
        }
      }),
    );
    if (prospect.website) {
      try {
        already.add(comparableHost(prospect.website));
      } catch {
        // Listed websites that are not absolute URLs are skipped for extra crawls.
      }
    }

    const extra = searchResults
      .filter(
        (result) =>
          result.sourceKind === "government_registry" ||
          result.sourceKind === "professional_registry" ||
          result.sourceKind === "official_site",
      )
      .filter((result) => {
        try {
          return !already.has(comparableHost(result.url));
        } catch {
          return false;
        }
      })
      .slice(0, 4);
    research.pagesSelected = extra.length;

    const extraPages = await Promise.allSettled(extra.map((result) => fetchHtml(result.url)));
    let extraRead = 0;
    extraPages.forEach((result, index) => {
      if (result.status !== "fulfilled") {
        warnings.push(
          `Could not read ${sourceLabel(extra[index].url)}: ${
            result.reason instanceof Error ? result.reason.message : "unavailable"
          }`,
        );
        return;
      }
      if (pages.some((page) => page.url === result.value.url)) return;
      pages.push(result.value);
      addPageFacts(result.value, facts, retrievedAt);
      extraRead += 1;
    });
    research.pagesRead = extraRead;
  } catch (error) {
    warnings.push(
      error instanceof Error ? `Google research engine: ${error.message}` : "Google research engine could not be completed.",
    );
  }

  if (!searchResults.length) {
    const engineNote = research.failures[0]
      ? `Google research found no usable sources. ${research.failures[0]}`
      : "Google research completed with no usable indexed sources for this company.";
    warnings.push(engineNote);
  }

  if (!facts.length) warnings.push("No additional public contact or registration facts were found. Nothing was guessed.");

  const sources: SourceRecord[] = pages.map((page) => ({
    id: hashId("page", page.url),
    label: page.title,
    url: page.url,
    sourceDate: retrievedAt,
    retrievedAt,
    status: "Verified",
  }));
  if (prospect.directoryUrl) {
    sources.unshift({
      id: hashId("directory", prospect.directoryUrl),
      label: prospect.source,
      url: prospect.directoryUrl,
      sourceDate: prospect.sourceDate,
      retrievedAt,
      status: prospect.confidence,
    });
  }
  if (searchResults.length || research.queriesCompleted) {
    sources.push({
      id: hashId("google-research", prospect.id, retrievedAt),
      label: research.providers.join(" + ") || "Google research engine",
      url: searchResults[0]?.url || "https://www.google.com/search",
      sourceDate: retrievedAt,
      retrievedAt,
      status: searchResults.length ? "Estimated" : "Unavailable",
    });
  }

  return {
    status: facts.length ? (pages.length ? "complete" : "partial") : pages.length || searchResults.length ? "partial" : "unavailable",
    summary: descriptionFromHome(pages[0]) || prospect.publicNotes,
    facts,
    searchResults,
    sources,
    pagesScanned: pages.length,
    research,
    retrievedAt,
    warnings: [...new Set(warnings)],
  };
}
