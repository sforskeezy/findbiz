import {
  ENTERPRISE_POLICY,
  ENTERPRISE_POLICY_VERSION,
  type EnterprisePolicyEntry,
} from "@/config/enterprise-policy";
import type { PlaceCandidate } from "@/lib/place-candidate";
import type { Eligibility, EligibilityCounts, EligibilityReason } from "@/lib/types";

const BANK_CATEGORIES = new Set([
  "atm",
  "bank",
  "credit_union",
  "commercial_bank",
  "savings_bank",
]);

const SCHOOL_CATEGORIES = new Set([
  "school",
  "elementary_school",
  "middle_school",
  "high_school",
  "college",
  "university",
  "community_college",
  "kindergarten",
  "preschool",
  "language_school",
  "music_school",
  "driving_school",
]);

const APARTMENT_CATEGORIES = new Set([
  "apartment",
  "apartments",
  "apartment_complex",
  "residential_apartment",
  "residential_building",
]);

const GOVERNMENT_CATEGORIES = new Set([
  "government",
  "government_office",
  "public_building",
  "courthouse",
  "police_station",
  "fire_station",
  "post_office",
  "public_library",
  "prison",
  "military_base",
  "townhall",
  "city_hall",
]);

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizeCategory(value: string) {
  return value.toLowerCase().replace(/[\s-]+/g, "_").trim();
}

function domain(value: string | null) {
  if (!value) return null;
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

function enterpriseEntry(candidate: PlaceCandidate): EnterprisePolicyEntry | null {
  const name = normalize(candidate.name);
  const brand = normalize(candidate.brand ?? "");
  const websiteDomain = domain(candidate.website);
  return (
    ENTERPRISE_POLICY.find((entry) => {
      const exactName = entry.names.some((value) => {
        const alias = normalize(value);
        if (alias === name) return true;
        const suffix = name.slice(alias.length).trim();
        return name.startsWith(`${alias} `) && /^(?:store|market|pharmacy|supercenter|wholesale|location|no|number)?\s*\d+[a-z]?$/i.test(suffix);
      });
      const exactBrand = Boolean(brand) && entry.brands.some((value) => normalize(value) === brand);
      const exactDomain = Boolean(websiteDomain) && entry.domains.some((value) => websiteDomain === value || websiteDomain?.endsWith(`.${value}`));
      return exactName || exactBrand || exactDomain;
    }) ?? null
  );
}

function result(
  status: Eligibility["status"],
  reason: EligibilityReason,
  label: string,
  ownership: Eligibility["ownership"] = "unknown",
): Eligibility {
  return { status, reason, label, ownership, policyVersion: ENTERPRISE_POLICY_VERSION };
}

export function classifyEligibility(candidate: PlaceCandidate): Eligibility {
  const categories = new Set(candidate.rawCategories.map(normalizeCategory));

  if (candidate.operatingStatus === "Permanently closed") {
    return result("excluded", "permanently_closed", "Permanently closed");
  }
  if ([...categories].some((category) => BANK_CATEGORIES.has(category))) {
    return result("excluded", "bank_or_atm", "Bank or ATM");
  }
  if ([...categories].some((category) => SCHOOL_CATEGORIES.has(category))) {
    return result("excluded", "traditional_school", "Traditional school");
  }
  if ([...categories].some((category) => GOVERNMENT_CATEGORIES.has(category))) {
    return result("excluded", "government_only", "Government-only facility");
  }
  if ([...categories].some((category) => APARTMENT_CATEGORIES.has(category))) {
    if (candidate.apartmentUnits === null) {
      return result("excluded", "apartment_units_unknown", "Apartment units need verification");
    }
    if (candidate.apartmentUnits > 9) {
      return result("excluded", "apartment_over_nine_units", "Apartment property over nine units");
    }
  }

  const policy = enterpriseEntry(candidate);
  if (policy?.treatment === "exclude") {
    return result("excluded", "configured_enterprise", "Configured national enterprise", "enterprise");
  }

  if (!candidate.name.trim() || (!candidate.address && candidate.rawCategories.length === 0)) {
    return result("unknown", "insufficient_business_identity", "Insufficient public business identity");
  }

  return result(
    "eligible",
    "eligible_business",
    policy?.treatment === "franchise_unknown" ? "Eligible; franchise ownership unknown" : "Eligible prospect; ownership unknown",
  );
}

export function emptyEligibilityCounts(): EligibilityCounts {
  return {
    eligible: 0,
    unknown: 0,
    banks: 0,
    schools: 0,
    apartmentsOverNine: 0,
    apartmentsUnknownUnits: 0,
    enterprises: 0,
    permanentlyClosed: 0,
    government: 0,
    insufficientIdentity: 0,
  };
}

export function addEligibilityCount(counts: EligibilityCounts, eligibility: Eligibility) {
  if (eligibility.status === "eligible") counts.eligible += 1;
  if (eligibility.status === "unknown") counts.unknown += 1;
  if (eligibility.reason === "bank_or_atm") counts.banks += 1;
  if (eligibility.reason === "traditional_school") counts.schools += 1;
  if (eligibility.reason === "apartment_over_nine_units") counts.apartmentsOverNine += 1;
  if (eligibility.reason === "apartment_units_unknown") counts.apartmentsUnknownUnits += 1;
  if (eligibility.reason === "configured_enterprise") counts.enterprises += 1;
  if (eligibility.reason === "permanently_closed") counts.permanentlyClosed += 1;
  if (eligibility.reason === "government_only") counts.government += 1;
  if (eligibility.reason === "insufficient_business_identity") counts.insufficientIdentity += 1;
}
