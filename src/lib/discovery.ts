import { hasGooglePlacesKey, researchWithGoogle } from "@/lib/google-places";
import {
  googleMapsScraperEnabled,
  researchWithGoogleMapsScraper,
} from "@/lib/google-maps-scraper";
import { researchWithPaiPlaces } from "@/lib/pai-places";
import { hasRapidApiKey, researchWithRapidApi } from "@/lib/rapidapi-local-business";
import type { Coordinates, Prospect, ResearchResponse } from "@/lib/types";

type ProviderResult = {
  label: string;
  priority: number;
  response: ResearchResponse;
};

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\b(incorporated|corporation|company|limited|llc|inc|ltd|co)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function phoneDigits(value: string | null) {
  return value?.replace(/\D/g, "").slice(-10) || null;
}

function websiteHost(value: string | null) {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function distanceMiles(a: Coordinates, b: Coordinates) {
  const earthRadiusMiles = 3958.8;
  const latDelta = ((b.lat - a.lat) * Math.PI) / 180;
  const lngDelta = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function sameBusiness(a: Prospect, b: Prospect) {
  const aPhone = phoneDigits(a.phone);
  const bPhone = phoneDigits(b.phone);
  if (aPhone && bPhone && aPhone === bPhone) return true;

  const aHost = websiteHost(a.website);
  const bHost = websiteHost(b.website);
  if (aHost && bHost && aHost === bHost) return true;

  return normalized(a.name) === normalized(b.name) && distanceMiles(a.coordinates, b.coordinates) <= 0.2;
}

function combineSources(a: string, b: string) {
  return [...new Set([...a.split(" + "), ...b.split(" + ")])].join(" + ");
}

function mergeProspect(primary: Prospect, secondary: Prospect): Prospect {
  return {
    ...primary,
    address: primary.address.startsWith("Address ") ? secondary.address : primary.address,
    phone: primary.phone || secondary.phone,
    website: primary.website || secondary.website,
    directoryUrl: primary.directoryUrl || secondary.directoryUrl,
    hours: primary.hours?.length ? primary.hours : secondary.hours,
    rating: primary.rating ?? secondary.rating,
    reviewCount: primary.reviewCount ?? secondary.reviewCount,
    locationCount: primary.locationCount ?? secondary.locationCount,
    businessSize: primary.businessSize ?? secondary.businessSize,
    publicNotes: primary.publicNotes || secondary.publicNotes,
    source: combineSources(primary.source, secondary.source),
  };
}

function uniqueWarnings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * The first-party Google Maps scraper leads. Licensed feeds remain optional;
 * PAI Places is the resilient backstop for businesses that have no Maps pin.
 */
export async function researchAcrossSources(
  inputAddress: string,
  radiusMiles: number,
): Promise<ResearchResponse> {
  const jobs: Array<{ label: string; priority: number; run: () => Promise<ResearchResponse> }> = [];

  if (googleMapsScraperEnabled()) {
    jobs.push({
      label: "Google Maps first-party scraper",
      priority: 0,
      run: () => researchWithGoogleMapsScraper(inputAddress, radiusMiles),
    });
  }
  if (hasGooglePlacesKey()) {
    jobs.push({ label: "Google Places API", priority: 1, run: () => researchWithGoogle(inputAddress, radiusMiles) });
  }
  if (hasRapidApiKey()) {
    jobs.push({ label: "RapidAPI Maps Data", priority: 2, run: () => researchWithRapidApi(inputAddress, radiusMiles) });
  }
  jobs.push({ label: "PAI Places", priority: 3, run: () => researchWithPaiPlaces(inputAddress, radiusMiles) });

  const settled = await Promise.allSettled(jobs.map((job) => job.run()));
  const successes: ProviderResult[] = [];
  const failures: string[] = [];

  settled.forEach((result, index) => {
    const job = jobs[index];
    if (result.status === "fulfilled") {
      successes.push({ label: job.label, priority: job.priority, response: result.value });
      return;
    }
    const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
    failures.push(`${job.label} was unavailable: ${reason}`);
  });

  if (!successes.length) {
    throw new Error(failures[0] || "No business discovery provider completed the search.");
  }

  successes.sort((a, b) => a.priority - b.priority);
  const prospects: Prospect[] = [];
  for (const provider of successes) {
    for (const incoming of provider.response.prospects) {
      const existingIndex = prospects.findIndex((prospect) => sameBusiness(prospect, incoming));
      if (existingIndex === -1) prospects.push(incoming);
      else prospects[existingIndex] = mergeProspect(prospects[existingIndex], incoming);
    }
  }

  const primary = successes[0].response;
  const providerSummary = successes.map((item) => item.label).join(", ");
  const warnings = uniqueWarnings([
    `Discovery combined ${providerSummary}. Duplicate listings were merged and every retained record keeps its source attribution.`,
    ...failures,
    ...successes.flatMap((item) => item.response.warnings),
  ]);

  if (!googleMapsScraperEnabled()) {
    warnings.unshift(
      "The first-party Google Maps scraper is disabled. Set ENABLE_GOOGLE_MAPS_SCRAPER=true to activate it.",
    );
  }

  return {
    schemaVersion: 3,
    target: primary.target,
    radiusMiles,
    prospects: prospects.sort((a, b) => b.score - a.score || a.distanceMiles - b.distanceMiles),
    broadband: [],
    sources: successes.flatMap((item) => item.response.sources),
    retrievedAt: new Date().toISOString(),
    demoMode: false,
    warnings,
  };
}
