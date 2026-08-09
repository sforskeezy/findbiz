import type {
  BroadbandObservation,
  FccLookupResponse,
  RepDisposition,
  ServiceabilitySignal,
  ServiceabilityTier,
} from "@/lib/types";

const DISCLAIMER =
  "Public FCC filings are market context only. They are not an internal provider system, a quote, proof of a subscription, business availability, or an orderability guarantee.";

const EXACT_CHARTER_BRAND_NAMES = new Set([
  "spectrum",
  "charter communications",
  "charter communications inc",
  "charter spectrum",
  "charter fiberlink",
  "time warner cable",
  "bright house networks",
]);

function normalizeProvider(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function configuredProviderIds() {
  return new Set(
    (process.env.CHARTER_FCC_PROVIDER_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value)),
  );
}

/** Exact brand-name compatibility only; never loose substring matching. */
export function isCharterSpectrumProvider(provider: string) {
  return EXACT_CHARTER_BRAND_NAMES.has(normalizeProvider(provider));
}

export function isCharterSpectrumObservation(observation: BroadbandObservation) {
  const ids = configuredProviderIds();
  return ids.size > 0 && ids.has(observation.providerId);
}

export function findCharterSpectrumObservations(observations: BroadbandObservation[]) {
  return observations.filter(isCharterSpectrumObservation);
}

function copyForTier(
  tier: ServiceabilityTier,
  providerLabel: string | null,
  asOfDate: string | null,
): Pick<ServiceabilitySignal, "shortLabel" | "detail"> {
  const asOf = asOfDate
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(asOfDate))
    : null;
  const brand = providerLabel || "The configured provider";

  if (tier === "reported_exact") {
    return {
      shortLabel: "Exact FCC location evidence",
      detail: `${brand} filed business availability for this FCC Location ID${asOf ? ` as of ${asOf}` : ""}. This still does not prove orderability.`,
    };
  }
  if (tier === "reported_area") {
    return {
      shortLabel: "Nearby market context",
      detail: "Nearby market context—not availability at this address. A filing exists somewhere in the loaded H3 area.",
    };
  }
  if (tier === "data_unavailable") {
    return { shortLabel: "Data unavailable", detail: "Current FCC Broadband Data Collection evidence is unavailable." };
  }
  return {
    shortLabel: "No report in loaded data",
    detail: "No matching filing was found in the loaded current BDC data. This is not proof that service is unavailable.",
  };
}

export function classifyServiceability(
  fcc: Pick<FccLookupResponse, "status" | "observations" | "asOfDate" | "matchQuality">,
): ServiceabilitySignal {
  const providerRows = findCharterSpectrumObservations(fcc.observations);
  const providerLabel = providerRows[0]?.provider ?? null;
  const exactMatch = fcc.matchQuality === "exact" || fcc.matchQuality === "user_supplied_location_id";
  let tier: ServiceabilityTier = "not_reported";
  if (["not_configured", "unavailable", "error"].includes(fcc.status)) tier = "data_unavailable";
  else if (providerRows.length) tier = exactMatch ? "reported_exact" : "reported_area";

  const copy = copyForTier(tier, providerLabel, fcc.asOfDate);
  return {
    tier,
    providerLabel,
    asOfDate: fcc.asOfDate,
    matchQuality: fcc.matchQuality,
    shortLabel: copy.shortLabel,
    detail: copy.detail,
    disclaimer: DISCLAIMER,
  };
}

export type DisplayedServiceability = {
  kind: "disposition" | "tier";
  disposition: RepDisposition | null;
  tier: ServiceabilityTier;
  shortLabel: string;
  detail: string;
  toneClass: string;
};

export function displayServiceability(signal: ServiceabilitySignal, disposition: RepDisposition | null): DisplayedServiceability {
  if (disposition === "customer") {
    return { kind: "disposition", disposition, tier: signal.tier, shortLabel: "User-marked customer", detail: "Local in-memory note, not FCC evidence.", toneClass: "text-[#17653f]" };
  }
  if (disposition === "do_not_contact") {
    return { kind: "disposition", disposition, tier: signal.tier, shortLabel: "User-marked do not contact", detail: "Local in-memory note, not FCC evidence.", toneClass: "text-[#a63a31]" };
  }
  const toneClass = signal.tier === "reported_exact" ? "text-[#17653f]" : signal.tier === "reported_area" ? "text-[#8a6613]" : "text-[#6e6e68]";
  return { kind: "tier", disposition: null, tier: signal.tier, shortLabel: signal.shortLabel, detail: signal.detail, toneClass };
}
