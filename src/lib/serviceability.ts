import type {
  BroadbandObservation,
  FccLookupResponse,
  RepDisposition,
  ServiceabilitySignal,
  ServiceabilityTier,
} from "@/lib/types";

const DISCLAIMER =
  "This is not Spectrum’s serviceability tool. Colors reflect public FCC filings and any note you set yourself — not orderability or an active-customer claim. Always confirm in the official tool before quoting.";

/** Known Charter/Spectrum brand and holding-company substrings in FCC filings. */
const CHARTER_SPECTRUM_ALIASES = [
  "spectrum",
  "charter communications",
  "charter spectrum",
  "charter fiberlink",
  "time warner cable",
  "twc",
  "bright house",
  "brighthouse",
];

function normalizeProvider(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isCharterSpectrumProvider(provider: string) {
  const normalized = normalizeProvider(provider);
  if (!normalized) return false;
  return CHARTER_SPECTRUM_ALIASES.some(
    (alias) => normalized === alias || normalized.includes(alias) || alias.includes(normalized),
  );
}

export function findCharterSpectrumObservations(observations: BroadbandObservation[]) {
  return observations.filter((item) => isCharterSpectrumProvider(item.provider));
}

function copyForTier(
  tier: ServiceabilityTier,
  providerLabel: string | null,
  asOfDate: string | null,
): Pick<ServiceabilitySignal, "shortLabel" | "detail"> {
  const asOf = asOfDate
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(asOfDate))
    : null;
  const brand = providerLabel || "Charter/Spectrum";

  if (tier === "reported_exact") {
    return {
      shortLabel: "Reported at this address",
      detail: asOf
        ? `${brand} reported business availability at this exact FCC location as of ${asOf}. Verify before quoting.`
        : `${brand} reported business availability at this exact FCC location. Verify before quoting.`,
    };
  }

  if (tier === "reported_area") {
    return {
      shortLabel: "Reported nearby",
      detail: `${brand} reported business availability in this area, but not matched to this exact address. A site check may be needed.`,
    };
  }

  return {
    shortLabel: "Not reported",
    detail:
      "No Charter/Spectrum record in FCC data for this area. FCC data lags by months; this is not a confirmation that service is unavailable.",
  };
}

export function classifyServiceability(fcc: Pick<FccLookupResponse, "observations" | "asOfDate" | "matchQuality">): ServiceabilitySignal {
  const charterRows = findCharterSpectrumObservations(fcc.observations);
  const providerLabel = charterRows[0]?.provider ?? null;
  const exactMatch = fcc.matchQuality === "exact" || fcc.matchQuality === "user_supplied_location_id";

  let tier: ServiceabilityTier = "not_reported";
  if (charterRows.length > 0) {
    tier = exactMatch ? "reported_exact" : "reported_area";
  }

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

export function displayServiceability(
  signal: ServiceabilitySignal,
  disposition: RepDisposition | null,
): DisplayedServiceability {
  if (disposition === "customer") {
    return {
      kind: "disposition",
      disposition,
      tier: signal.tier,
      shortLabel: "Active",
      detail: "Your note — not from FCC data.",
      toneClass: "text-[#17653f]",
    };
  }

  if (disposition === "do_not_contact") {
    return {
      kind: "disposition",
      disposition,
      tier: signal.tier,
      shortLabel: "Do not touch",
      detail: "Your note — not from FCC data.",
      toneClass: "text-[#a63a31]",
    };
  }

  if (signal.tier === "reported_exact") {
    return {
      kind: "tier",
      disposition: null,
      tier: signal.tier,
      shortLabel: signal.shortLabel,
      detail: signal.detail,
      toneClass: "text-[#17653f]",
    };
  }

  if (signal.tier === "reported_area") {
    return {
      kind: "tier",
      disposition: null,
      tier: signal.tier,
      shortLabel: signal.shortLabel,
      detail: signal.detail,
      toneClass: "text-[#8a6613]",
    };
  }

  return {
    kind: "tier",
    disposition: null,
    tier: signal.tier,
    shortLabel: signal.shortLabel,
    detail: signal.detail,
    toneClass: "text-[#6e6e68]",
  };
}
