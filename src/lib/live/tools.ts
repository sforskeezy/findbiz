import { createHash } from "node:crypto";

import { researchCompany } from "@/lib/company-intelligence";
import { researchAcrossSources } from "@/lib/discovery";
import { lookupFccAvailability } from "@/lib/fcc";
import { researchGoogleWeb } from "@/lib/google-research-engine";
import { googleMapsScraperEnabled } from "@/lib/google-maps-scraper";
import { PLACE_CATEGORIES } from "@/lib/place-candidate";
import { classifyServiceability } from "@/lib/serviceability";
import { LIVE_RADII } from "@/lib/live/types";
import type { LiveProspectCard, LiveQueue, LiveSource } from "@/lib/live/types";
import type { CompanyIntelligence, Prospect } from "@/lib/types";

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

export async function findBusinesses(input: {
  location: string;
  radiusMiles?: number | null;
  category?: string | null;
}): Promise<{ queue: LiveQueue; cards: LiveProspectCard[]; warnings: string[]; sources: LiveSource[]; via: string }> {
  const location = input.location.replace(/\s+/g, " ").trim();
  if (location.length < 3) throw new Error("Give Live a city, ZIP, or address to search.");
  const radiusMiles = clampRadius(input.radiusMiles, /\d{5}/.test(location) ? 2 : 2);
  const category = matchCategory(input.category);
  const research = await researchAcrossSources(location, radiusMiles);
  const filtered = category ? research.prospects.filter((item) => item.category === category) : research.prospects;
  const ranked = [...filtered]
    .filter((item) => item.operatingStatus !== "Temporarily closed")
    .sort((a, b) => {
      const aMaps = fromGoogleMaps(a) ? 1 : 0;
      const bMaps = fromGoogleMaps(b) ? 1 : 0;
      const aContact = a.phone || a.website ? 1 : 0;
      const bContact = b.phone || b.website ? 1 : 0;
      return bMaps - aMaps || bContact - aContact || b.score - a.score || a.distanceMiles - b.distanceMiles;
    })
    .slice(0, 8);
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
