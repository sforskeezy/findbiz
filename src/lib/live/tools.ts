import { createHash } from "node:crypto";

import { researchCompany } from "@/lib/company-intelligence";
import { researchAcrossSources } from "@/lib/discovery";
import { lookupFccAvailability } from "@/lib/fcc";
import { researchGoogleWeb } from "@/lib/google-research-engine";
import { googleMapsScraperEnabled, researchWithGoogleMapsScraper } from "@/lib/google-maps-scraper";
import { PLACE_CATEGORIES, distanceMiles } from "@/lib/place-candidate";
import { classifyServiceability } from "@/lib/serviceability";
import {
  attachRivalSignals,
  filterProspectsForBrief,
  genuineSignal,
  looksHomeBased,
  mergeSignals,
} from "@/lib/live/filters";
import type { LiveProfile } from "@/lib/live/intent";
import { LIVE_RADII } from "@/lib/live/types";
import type { LiveProspectCard, LiveQueue, LiveSource } from "@/lib/live/types";
import type { CompanyIntelligence, LiveLeadSignal, Prospect } from "@/lib/types";

function sourceDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

export function toSource(input: { title: string; url: string | null; snippet?: string | null }): LiveSource | null {
  if (!input.url || !/^https?:\/\//i.test(input.url)) return null;
  const domain = sourceDomain(input.url);
  return {
    id: createHash("sha1").update(input.url).digest("hex").slice(0, 12),
    title: input.title.trim().slice(0, 120) || domain,
    url: input.url,
    domain,
    snippet: input.snippet?.trim().slice(0, 200) || null,
  };
}

export function dedupeSources(sources: Array<LiveSource | null>) {
  const seen = new Set<string>();
  const kept: LiveSource[] = [];
  for (const source of sources) {
    if (!source || seen.has(source.url)) continue;
    seen.add(source.url);
    kept.push(source);
  }
  return kept.slice(0, 8);
}

export function compactProspect(prospect: Prospect): LiveProspectCard {
  const why = [prospect.topOpportunity, prospect.summary].find((item) => item && !/\bhiring\b/i.test(item)) || prospect.category;
  return {
    id: prospect.id,
    name: prospect.name,
    category: prospect.category,
    address: prospect.address,
    distanceMiles: prospect.distanceMiles,
    phone: prospect.phone,
    website: prospect.website,
    score: prospect.score,
    why: why.slice(0, 180),
    source: prospect.source,
    signals: prospect.signals,
  };
}

export function clampRadius(value: unknown, fallback = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  const closest = LIVE_RADII.reduce((best, item) => (Math.abs(item - number) < Math.abs(best - number) ? item : best), LIVE_RADII[0]);
  return closest;
}

function matchCategory(value: string | null | undefined) {
  if (!value?.trim()) return null;
  const needle = value.trim().toLowerCase();
  return PLACE_CATEGORIES.find((item) => item.toLowerCase() === needle || item.toLowerCase().includes(needle) || needle.includes(item.toLowerCase())) ?? null;
}

export function liveSearchDetail() {
  return googleMapsScraperEnabled()
    ? "Google Maps scraper · public listings as backstop"
    : "PAI Places · OpenStreetMap";
}

function fromGoogleMaps(prospect: Prospect) {
  return /google maps/i.test(prospect.source);
}

/**
 * Service-area trades. Maps lists these without a storefront because the owner
 * works out of a house, a garage, or a truck. Kept short on purpose — every
 * query is two round trips and the rep is standing on a doorstep waiting.
 */
const HOME_BASED_QUERIES = [
  "home based business",
  "mobile detailing",
  "mobile mechanic",
  "lawn care service",
  "house cleaning service",
  "handyman service",
  "pet sitting",
  "home daycare",
  "home bakery",
  "photographer",
  "landscaping",
  "mobile notary",
];

/** Fast enough to cover a street without a 20-second wait. */
const LIVE_QUERIES = [
  "business",
  "llc",
  "contractor",
  "auto repair",
  "medical office",
  "law firm",
  "salon",
  "restaurant",
];

function streetKey(address: string) {
  const match = address.trim().match(/^(\d{1,6})\s+([A-Za-z0-9'.-]+(?:\s+[A-Za-z0-9'.-]+)?)/);
  if (!match) return null;
  return { number: match[1], street: match[2].toLowerCase() };
}

function sameDoor(left: string, right: string) {
  const a = streetKey(left);
  const b = streetKey(right);
  return Boolean(a && b && a.number === b.number && a.street === b.street);
}

/**
 * Answers "what is this address" with what is actually sitting there, rather
 * than treating the address as the centre of a prospecting run.
 */
export async function identifyAddress(address: string) {
  const query = address.replace(/\s+/g, " ").trim().slice(0, 80);
  const research = googleMapsScraperEnabled()
    ? await researchWithGoogleMapsScraper(query, 0.15, [query]).catch(() =>
        researchAcrossSources(query, 0.15),
      )
    : await researchAcrossSources(query, 0.15);

  const wanted = research.target.formattedAddress || address;
  const exact = research.prospects.filter(
    (prospect) => sameDoor(prospect.address, address) || sameDoor(prospect.address, wanted),
  );
  const neighbours = research.prospects
    .filter((prospect) => !exact.some((item) => item.id === prospect.id))
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, 3);

  return {
    query: address,
    resolved: wanted,
    coordinates: research.target.coordinates,
    exactMatch: exact.length > 0,
    atAddress: exact.map(compactProspect),
    neighbours: neighbours.map(compactProspect),
    prospects: exact,
    sources: dedupeSources(
      [...exact, ...neighbours].map((item) =>
        toSource({ title: item.name, url: item.website || item.directoryUrl, snippet: `${item.category} · ${item.address}` }),
      ),
    ),
  };
}

export async function findBusinesses(input: {
  location: string;
  radiusMiles?: number | null;
  category?: string | null;
  limit?: number | null;
  profile?: LiveProfile | null;
  excludeNational?: boolean;
}): Promise<{
  queue: LiveQueue;
  cards: LiveProspectCard[];
  warnings: string[];
  sources: LiveSource[];
  via: string;
  dropped: number;
  homeConfirmed: number;
  relaxed: boolean;
}> {
  const location = input.location.replace(/\s+/g, " ").trim();
  if (location.length < 3) throw new Error("Give Live a city, ZIP, or address to search.");
  const radiusMiles = clampRadius(input.radiusMiles, /\d{5}/.test(location) ? 2 : 2);
  const category = matchCategory(input.category);
  const cap = Number.isFinite(input.limit) && Number(input.limit) > 0
    ? Math.min(40, Math.max(1, Math.round(Number(input.limit))))
    : 20;
  const research = googleMapsScraperEnabled()
    ? await researchWithGoogleMapsScraper(
        location,
        radiusMiles,
        input.profile === "home_based" ? HOME_BASED_QUERIES : LIVE_QUERIES,
      ).catch(() => researchAcrossSources(location, radiusMiles))
    : await researchAcrossSources(location, radiusMiles);
  const filtered = filterProspectsForBrief(research.prospects, {
    profile: input.profile ?? "any",
    excludeNational: input.excludeNational !== false,
    category,
  });
  const dropped = Math.max(0, research.prospects.length - filtered.kept.length);
  const ranked = attachRivalSignals(
    [...filtered.kept].sort((a, b) => {
      const homeBoost = input.profile === "home_based" ? Number(looksHomeBased(b)) - Number(looksHomeBased(a)) : 0;
      const aMaps = fromGoogleMaps(a) ? 1 : 0;
      const bMaps = fromGoogleMaps(b) ? 1 : 0;
      const aContact = a.phone || a.website ? 1 : 0;
      const bContact = b.phone || b.website ? 1 : 0;
      return homeBoost || bMaps - aMaps || bContact - aContact || b.score - a.score || a.distanceMiles - b.distanceMiles;
    }).slice(0, cap),
  );
  const mapsCount = ranked.filter(fromGoogleMaps).length;
  const queue: LiveQueue = {
    locationLabel: research.target.formattedAddress || location,
    radiusMiles,
    category,
    currentIndex: 0,
    prospects: ranked,
  };
  return {
    queue,
    cards: ranked.map(compactProspect),
    dropped,
    homeConfirmed: ranked.filter((item) => item.signals?.some((signal) => signal.kind === "home")).length,
    relaxed: filtered.relaxed,
    warnings: research.warnings ?? [],
    via:
      mapsCount > 0
        ? mapsCount === ranked.length
          ? "Google Maps scraper"
          : `Google Maps scraper · ${ranked.length - mapsCount} public backstop`
        : googleMapsScraperEnabled()
          ? "Google Maps scraper found none · public listings as backstop"
          : "PAI Places · OpenStreetMap",
    sources: dedupeSources(
      ranked.map((item) =>
        toSource({
          title: item.name,
          url: item.website || item.directoryUrl,
          snippet: `${item.category} · ${item.address}`,
        }),
      ),
    ),
  };
}

export function skipQueue(queue: LiveQueue | null): (LiveQueue & { wrapped: boolean }) | null {
  if (!queue || queue.prospects.length === 0) return null;
  const nextIndex = Math.min(queue.currentIndex + 1, queue.prospects.length - 1);
  return { ...queue, currentIndex: nextIndex, wrapped: nextIndex === queue.currentIndex };
}

function factValue(intelligence: CompanyIntelligence, kind: string) {
  return intelligence.facts.find((item) => item.kind === kind)?.value ?? null;
}

export async function researchProspect(prospect: Prospect) {
  const intelligence = await researchCompany(prospect);
  const sources = dedupeSources([
    toSource({ title: `${prospect.name} — official site`, url: prospect.website, snippet: prospect.publicNotes }),
    toSource({ title: `${prospect.name} — public listing`, url: prospect.directoryUrl, snippet: prospect.address }),
    ...intelligence.searchResults.slice(0, 6).map((item) => toSource({ title: item.title, url: item.url, snippet: item.snippet })),
  ]);
  return {
    sources,
    business: {
      id: prospect.id,
      name: prospect.name,
      category: prospect.category,
      address: prospect.address,
      distanceMiles: prospect.distanceMiles,
      phone: prospect.phone || factValue(intelligence, "phone"),
      website: prospect.website || factValue(intelligence, "website"),
      hours: factValue(intelligence, "hours"),
      rating: factValue(intelligence, "rating"),
      summary: intelligence.summary || prospect.summary,
      publicNotes: prospect.publicNotes,
      topOpportunity: prospect.topOpportunity,
      callOpener: prospect.callOpener,
      hypothesizedNeeds: prospect.hypothesizedNeeds.filter((item) => !/\bhiring\b/i.test(item)).slice(0, 3),
      facts: intelligence.facts.slice(0, 6).map((item) => ({ label: item.label, value: item.value.slice(0, 140) })),
      warnings: intelligence.warnings.slice(0, 2),
      email: prospect.followUpEmail,
    },
  };
}

function speedLabel(down: number | null, up: number | null) {
  if (down == null && up == null) return "speeds not reported";
  return `${down ?? "?"}/${up ?? "?"} Mbps`;
}

function fccSource(sourceUrl: string, snippet: string) {
  return dedupeSources([toSource({ title: "FCC National Broadband Map", url: sourceUrl, snippet })]);
}

/** Same FCC Form 477 path Search uses, so Live quotes identical provider data. */
export async function checkBroadband(prospect: Prospect) {
  const fcc = await lookupFccAvailability({
    address: prospect.address,
    coordinates: prospect.coordinates,
  });
  const charter = classifyServiceability(fcc);
  const providers = fcc.observations.slice(0, 10).map((item) => ({
    provider: item.provider,
    technology: item.technology,
    speed: speedLabel(item.downloadMbps, item.uploadMbps),
    servesBusiness: item.classification === "Business",
  }));

  return {
    sources: fccSource(fcc.sourceUrl, `Provider-reported availability at ${prospect.address}`),
    availability: {
      businessName: prospect.name,
      address: prospect.address,
      status: fcc.status,
      matchQuality: fcc.matchQuality,
      asOfDate: fcc.asOfDate,
      providerCount: fcc.observations.length,
      providers,
      // Charter/Spectrum only. Never read this as "no providers at all".
      charterSpectrum: {
        tier: charter.tier,
        label: charter.shortLabel,
        detail: charter.detail,
      },
      message: fcc.message,
      note: "Provider-reported FCC data, not a rooftop orderability guarantee. Say reported, not confirmed. providerCount is every provider; charterSpectrum only describes Charter/Spectrum.",
    },
  };
}

/** Territory-wide rollup for "who is available around here" questions. */
export async function checkBroadbandAcrossQueue(queue: LiveQueue, limit = 6) {
  const targets = queue.prospects.slice(0, limit);
  const results = await Promise.all(
    targets.map(async (prospect) => ({
      prospect,
      fcc: await lookupFccAvailability({ address: prospect.address, coordinates: prospect.coordinates }),
    })),
  );

  const byProvider = new Map<string, { provider: string; technologies: Set<string>; topDown: number | null; addresses: number }>();
  let covered = 0;
  let asOfDate: string | null = null;

  for (const { fcc } of results) {
    if (fcc.asOfDate) asOfDate = fcc.asOfDate;
    if (!fcc.observations.length) continue;
    covered += 1;
    const seenHere = new Set<string>();
    for (const observation of fcc.observations) {
      const entry = byProvider.get(observation.provider) ?? {
        provider: observation.provider,
        technologies: new Set<string>(),
        topDown: null,
        addresses: 0,
      };
      entry.technologies.add(observation.technology);
      if (observation.downloadMbps != null && (entry.topDown == null || observation.downloadMbps > entry.topDown)) {
        entry.topDown = observation.downloadMbps;
      }
      if (!seenHere.has(observation.provider)) {
        entry.addresses += 1;
        seenHere.add(observation.provider);
      }
      byProvider.set(observation.provider, entry);
    }
  }

  const providers = [...byProvider.values()]
    .sort((a, b) => b.addresses - a.addresses || (b.topDown ?? 0) - (a.topDown ?? 0))
    .slice(0, 10)
    .map((item) => ({
      provider: item.provider,
      technologies: [...item.technologies].slice(0, 3),
      topDownloadMbps: item.topDown,
      reportedAtAddresses: item.addresses,
    }));

  return {
    sources: fccSource(
      results[0]?.fcc.sourceUrl ?? "https://broadbandmap.fcc.gov/",
      `Provider-reported availability across ${queue.locationLabel}`,
    ),
    availability: {
      territory: queue.locationLabel,
      addressesChecked: targets.length,
      addressesWithReportedService: covered,
      asOfDate,
      providers,
      note: `Rollup of FCC provider-reported availability across the current list. Lead with the coverage gap: only ${covered} of ${targets.length} addresses have any reported service, so every provider below comes from those ${covered}. Reported, not confirmed.`,
    },
  };
}

export function currentProspect(queue: LiveQueue | null) {
  if (!queue || !queue.prospects.length) return null;
  return queue.prospects[Math.min(queue.currentIndex, queue.prospects.length - 1)] ?? null;
}

function cityContext(address: string) {
  const parts = address.split(",").map((value) => value.trim()).filter(Boolean);
  return parts.slice(-2).join(" ").slice(0, 80);
}

/**
 * Targeted public-web lookup for one business, for questions the cached listing
 * cannot answer (ownership, locations, recent coverage).
 */
export async function webLookup(prospect: Prospect, question: string) {
  const topic = question.replace(/\s+/g, " ").trim().slice(0, 120);
  const name = `"${prospect.name.replace(/["“”]/g, "").trim().slice(0, 120)}"`;
  const location = cityContext(prospect.address);
  const research = await researchGoogleWeb(prospect, [
    `${name} ${topic}`,
    `${name} ${location} ${topic}`,
  ]);
  const results = research.results.slice(0, 6);

  return {
    sources: dedupeSources(results.map((item) => toSource({ title: item.title, url: item.url, snippet: item.snippet }))),
    findings: results.map((item) => ({
      title: item.title.slice(0, 140),
      url: item.url,
      snippet: (item.snippet || "").slice(0, 320),
    })),
    engine: research.diagnostics.providers.join(", ") || research.diagnostics.engine,
  };
}

/**
 * What a rep can actually open a call with, strongest first. Only the first
 * matching kind is used, so "grand opening" never gets downgraded to "in the news".
 */
const NEWS_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: "Just opened",
    pattern: /\b(grand opening|now open|newly opened|opened (?:its|their) (?:doors|new)|opening soon|celebrated its opening|officially opened)\b/i,
  },
  {
    label: "Recent expansion",
    pattern: /\b(expansion|expanding|expands|new location|second location|another location|additional location|opens? (?:a )?(?:new|second)|breaking ground|broke ground|adds? a new|doubling|doubled (?:its|their))\b/i,
  },
  {
    label: "Just moved",
    pattern: /\b(relocated|relocating|relocation|moved to|moving to|new home at|new address|new headquarters)\b/i,
  },
  {
    label: "New ownership",
    pattern: /\b(under new ownership|new owner|acquired by|acquisition of|has been acquired|changed hands|new management)\b/i,
  },
  {
    label: "In the news",
    pattern: /\b(ribbon[- ]cutting|celebrates|celebrating|anniversary|years in business|named (?:the )?best|wins? (?:the )?award|honored|fundraiser|sponsors|community event|renovation|remodel)\b/i,
  },
];

const NAME_STOPWORDS = new Set([
  "the", "and", "llc", "inc", "co", "company", "corp", "corporation", "ltd", "pa", "pc",
  "services", "service", "group", "associates", "solutions", "enterprises", "of", "for",
]);

/** Tokens distinctive enough to prove an article is about this business. */
function nameTokens(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 4 && !NAME_STOPWORDS.has(token));
}

function mentionsBusiness(text: string, tokens: string[]) {
  if (!tokens.length) return false;
  const hay = text.toLowerCase();
  return tokens.some((token) => hay.includes(token));
}

function cityFromAddress(address: string) {
  const parts = address.split(",").map((value) => value.trim()).filter(Boolean);
  return parts.slice(-2).join(" ").slice(0, 80);
}

function cityName(address: string) {
  const parts = address.split(",").map((value) => value.trim()).filter(Boolean);
  return (parts.length >= 2 ? parts[parts.length - 2] : parts[0] || "").replace(/\s+\d{5}.*$/, "").slice(0, 40);
}

export async function scanLocalNews(prospect: Prospect) {
  const city = cityFromAddress(prospect.address);
  const town = cityName(prospect.address);
  const name = prospect.name.replace(/["“”]/g, "").trim().slice(0, 120);
  const exact = `"${name}"`;
  const host = prospect.website ? sourceDomain(prospect.website) : null;
  const tokens = nameTokens(name);

  // Two passes. The first three queries catch almost every real story; the rest
  // only run when nothing landed, so the common case stays fast.
  const firstPass = [
    `${exact} ${city} (expansion OR "new location" OR "grand opening" OR "now open" OR relocating)`,
    `${exact} ${town} news`,
    `${exact} "ribbon cutting" OR celebrates OR anniversary OR award`,
  ];
  const secondPass = [
    `${exact} ${town} announcement`,
    `${exact} "under new ownership" OR acquired OR "new owner"`,
    ...(host ? [`site:${host} news OR blog OR "what's new"`] : [`${exact} facebook ${town}`]),
  ];

  const matchNews = (results: Array<{ title: string; snippet: string; url: string }>) => {
    // A story only counts when it names this business. Otherwise it is a generic
    // article about the town and would turn into an invented expansion.
    const relevant = results.filter((item) => mentionsBusiness(`${item.title} ${item.snippet}`, tokens));
    for (const { label, pattern } of NEWS_PATTERNS) {
      const hit = relevant.find((item) => pattern.test(`${item.title} ${item.snippet}`));
      if (hit) return { relevant, label, hit };
    }
    return { relevant, label: null, hit: null };
  };

  let research = await researchGoogleWeb(prospect, firstPass);
  let found = matchNews(research.results);
  if (!found.hit) {
    const more = await researchGoogleWeb(prospect, secondPass);
    research = { ...more, results: [...research.results, ...more.results] };
    found = matchNews(research.results);
  }

  const signal: LiveLeadSignal | null = found.hit
    ? {
        kind: "expansion",
        label: found.label ?? "In the news",
        detail: (found.hit.snippet || found.hit.title).replace(/\s+/g, " ").trim().slice(0, 160),
      }
    : null;

  return {
    sources: dedupeSources(
      (found.relevant.length ? found.relevant : research.results).map((item) =>
        toSource({ title: item.title, url: item.url, snippet: item.snippet }),
      ),
    ),
    findings: found.relevant.slice(0, 5).map((item) => ({
      title: item.title.slice(0, 140),
      url: item.url,
      snippet: (item.snippet || "").slice(0, 280),
    })),
    checked: research.results.length,
    matched: found.relevant.length,
    evidence: found.hit
      ? { title: found.hit.title.slice(0, 140), url: found.hit.url, snippet: (found.hit.snippet || "").slice(0, 280) }
      : null,
    signal,
  };
}

/**
 * Scans outward from whoever is on screen, so pressing Next and asking "what's
 * new" reads the business the rep is actually looking at.
 */
export async function scanLocalNewsForQueue(queue: LiveQueue, limit = 3, skipIds?: Set<string>) {
  const total = queue.prospects.length;
  if (!total) return { sources: [], businesses: [] };
  const ordered = Array.from({ length: total }, (_, offset) => queue.prospects[(queue.currentIndex + offset) % total]);
  const targets = ordered.filter((item) => !skipIds?.has(item.id)).slice(0, Math.max(1, limit));
  const scanned = await Promise.all(
    targets.map(async (prospect) => {
      try {
        const result = await scanLocalNews(prospect);
        if (result.signal) {
          prospect.signals = mergeSignals(prospect.signals, result.signal);
        }
        return { id: prospect.id, name: prospect.name, signal: result.signal, findings: result.findings, sources: result.sources };
      } catch {
        return { id: prospect.id, name: prospect.name, signal: null, findings: [], sources: [] };
      }
    }),
  );
  return {
    sources: dedupeSources(scanned.flatMap((item) => item.sources)),
    businesses: scanned.map((item) => ({
      id: item.id,
      name: item.name,
      signal: item.signal,
      findings: item.findings,
    })),
  };
}

/**
 * Greedy nearest-neighbour walk through the list. A rep working doors loses
 * more time to backtracking than to anything else, and the queue order is also
 * the order Next steps through, so planning the route plans the shift.
 */
export function planWalkingRoute(queue: LiveQueue) {
  const start = queue.prospects[queue.currentIndex] ?? queue.prospects[0];
  if (!start) return null;

  const remaining = queue.prospects.filter((item) => item.id !== start.id);
  const ordered: Array<{ prospect: Prospect; legMiles: number }> = [{ prospect: start, legMiles: 0 }];
  let cursor = start;

  while (remaining.length) {
    let bestIndex = 0;
    let bestMiles = Number.POSITIVE_INFINITY;
    remaining.forEach((candidate, index) => {
      const miles = distanceMiles(cursor.coordinates, candidate.coordinates);
      if (miles < bestMiles) {
        bestMiles = miles;
        bestIndex = index;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push({ prospect: next, legMiles: bestMiles });
    cursor = next;
  }

  const totalMiles = ordered.reduce((sum, item) => sum + item.legMiles, 0);
  queue.prospects = ordered.map((item) => item.prospect);
  queue.currentIndex = 0;

  return {
    start: start.name,
    totalMiles,
    // Roughly 20 minutes a mile once you add doorways and conversations.
    walkingMinutes: Math.round(totalMiles * 20),
    stops: ordered.map((item, index) => ({
      order: index + 1,
      id: item.prospect.id,
      name: item.prospect.name,
      category: item.prospect.category,
      address: item.prospect.address,
      phone: item.prospect.phone,
      legMiles: Number(item.legMiles.toFixed(2)),
    })),
  };
}

export function checkListing(prospect: Prospect) {
  const signal = genuineSignal(prospect);
  prospect.signals = mergeSignals(prospect.signals, signal);
  return {
    id: prospect.id,
    name: prospect.name,
    category: prospect.category,
    address: prospect.address,
    phone: prospect.phone,
    website: prospect.website,
    operatingStatus: prospect.operatingStatus,
    signal,
    note:
      signal.kind === "chain"
        ? "This reads as a national or convenience stop. Drop it unless they asked for that."
        : "Independent-looking listing. Still confirm the phone before you dial.",
  };
}

export type QueueFilters = {
  category?: string | null;
  maxDistanceMiles?: number | null;
  requirePhone?: boolean;
  sortBy?: "fit" | "distance" | null;
};

/**
 * Narrow and re-order the list the rep already has. Nothing is dropped: matches
 * move to the front so a follow-up question can still reach the rest.
 */
export function refineQueue(queue: LiveQueue, filters: QueueFilters) {
  const category = matchCategory(filters.category);
  const limit = Number.isFinite(filters.maxDistanceMiles) ? Number(filters.maxDistanceMiles) : null;

  const matches = queue.prospects.filter((item) => {
    if (category && item.category !== category) return false;
    if (limit != null && item.distanceMiles > limit) return false;
    if (filters.requirePhone && !item.phone) return false;
    return true;
  });

  const sorted = [...matches].sort((a, b) =>
    filters.sortBy === "distance"
      ? a.distanceMiles - b.distanceMiles || b.score - a.score
      : b.score - a.score || a.distanceMiles - b.distanceMiles,
  );
  const rest = queue.prospects.filter((item) => !sorted.includes(item));

  return {
    category,
    matches: sorted.map(compactProspect),
    queue: { ...queue, currentIndex: 0, prospects: [...sorted, ...rest] } satisfies LiveQueue,
  };
}
