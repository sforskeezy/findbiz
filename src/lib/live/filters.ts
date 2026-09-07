import { distanceMiles } from "@/lib/place-candidate";
import type { LiveProfile } from "@/lib/live/intent";
import type { LiveLeadSignal } from "@/lib/live/types";
import type { Prospect } from "@/lib/types";

/**
 * Names a field rep is not trying to sell fiber to unless they said so.
 * Matched as whole-ish tokens against the listing name.
 */
const NATIONAL_CHAINS = [
  "walmart", "sam's club", "sams club", "costco", "target", "kroger", "publix",
  "circle k", "7-eleven", "7 eleven", "shell", "bp ", "chevron", "exxon", "mobil",
  "marathon", "quiktrip", "qt ", "racetrac", "wawa", "sheetz", "speedway",
  "dollar general", "dollar tree", "family dollar", "mcdonald", "burger king",
  "taco bell", "wendy", "subway", "starbucks", "dunkin", "chick-fil-a",
  "outback steakhouse", "jersey mike", "cava", "panera", "chipotle",
  "autozone", "o'reilly", "oreilly", "napa auto", "advance auto", "pep boys",
  "firestone", "goodyear", "discount tire", "les schwab", "mavis", "ntb ",
  "take 5", "jiffy lube", "valvoline", "meineke", "maaco", "home depot", "lowe's",
  "lowes", "best buy", "cvs", "walgreens", "rite aid", "at&t", "verizon",
  "t-mobile", "sprint", "planet fitness", "anytime fitness", "h&r block",
  "jackson hewitt", "great clips", "supercuts", "marriott", "hilton", "hampton inn",
  "holiday inn", "days inn", "super 8", "motel 6", "sleep inn", "prisma health",
  "bon secours", "kaiser permanente", "hca healthcare", "afc urgent care",
  "petsuites", "pet suites", "dogtopia", "camp bow wow", "primrose school",
  "kiddie academy", "goddard school", "keller williams", "re/max", "century 21",
  "servpro", "roto-rooter", "mr. handyman", "molly maid", "merry maids", "pridestaff",
  "sprouts farmers market", "americold", "td bank", "wells fargo", "bank of america",
];

const GAS_OR_BOX = /\b(gas station|fuel|convenience store|c-store|big box|supermarket|grocery|pharmacy chain)\b/i;

export function isNationalChain(name: string) {
  const hay = ` ${name.toLowerCase().replace(/[|]/g, " ")} `;
  return NATIONAL_CHAINS.some((chain) => hay.includes(` ${chain} `) || hay.includes(chain));
}

export function isMassRetail(prospect: Pick<Prospect, "name" | "category" | "publicNotes">) {
  if (isNationalChain(prospect.name)) return true;
  const blob = `${prospect.name} ${prospect.category} ${prospect.publicNotes ?? ""}`;
  return GAS_OR_BOX.test(blob) || /\b(circle k|gas station)\b/i.test(prospect.name);
}

const NO_ADDRESS = /address not listed|not listed in public data/i;

/** A suite, unit, or hangar number means someone else owns the building. */
const UNIT_DESIGNATOR = /(\b(ste|suite|unit|bldg|building|fl|floor|rm|room|hangar|office|apt)\b\.?\s*[\w-]|#\s*\w)/i;

/**
 * Office-park and corridor names. Greenville proves street type alone is
 * useless here — Cessna Ct and Opportunity Pl are business parks, not homes.
 */
const COMMERCIAL_PARK = /\b(industrial|commerce|commercial|corporate|executive|enterprise|business park|office park|tech|technology|innovation|research|airport|airview|aviation|hangar|cessna|tower|opportunity|distribution|logistics|campus|university|college|medical park|professional park|shoppers)\b/i;

const COMMERCIAL_STREET = /\b(hwy|highway|blvd|boulevard|pkwy|parkway|expy|expressway|turnpike|freeway|plaza|mall|square|centre|center|us-\s?\d+|sc-\s?\d+|state (?:rd|route)|route\s?\d+)\b/i;

/** Quiet street types. Weak on their own, useful as corroboration. */
const RESIDENTIAL_STREET = /\b(ln|lane|ct|court|cir|circle|ter|terrace|trl|trail|cv|cove|run|ridge|holw|hollow|bend|loop|xing|crossing|path|acres|farm|hills?|creek|meadow|orchard|grove|springs?)\b/i;

/** Buildings a business cannot run out of a spare bedroom. */
const FACILITY = /\b(hospital|clinic|urgent care|dental|dentist|orthodont|pharmacy|surgery|surgical|laborator|imaging|cent(?:er|re)\b|school|preschool|montessori|academy|institute|university|college|church|chapel|temple|mosque|synagogue|ministries|hotel|motel|inn\b|resort|lodge|restaurant|cafe|café|grille?\b|pizzeria|diner|buffet|steakhouse|brewery|taproom|nightclub|saloon|bank\b|credit union|dealership|showroom|warehouse|factory|plant\b|foundry|mill\b|distribution|self storage|storage zone|fire station|police|jail|courthouse|post office|library|museum|stadium|arena|gym\b|fitness|country club|golf|airport|terminal|funeral|cemetery|nursing home|assisted living|apartments|supermarket|department store|convention)\b/i;

/** Trades that are usually run out of a house, a truck, or a garage. */
const HOME_TRADE = /\b(lawn ?care|landscap|yard ?work|tree service|handy ?man|house ?clean|cleaning service|janitorial|maid|pressure ?wash|window clean|pet ?sit|dog ?walk|pet ?groom|mobile groom|notary|seamstress|alteration|tailor|tutor|bookkeep|photograph|videograph|home ?bak|cake|cater|personal train|massage|nail tech|barber|hair ?stylist|makeup artist|florist|event planner|wedding planner|\bdj\b|disc jockey|mobile detail|auto detail|mobile mechanic|mobile repair|welding|carpenter|cabinet|painter|painting|drywall|flooring|roofing|gutter|fence|junk removal|hauling|moving help|courier|delivery service|virtual assistant|consulting|consultant|design studio|graphic design|web design|craft|woodwork|upholster|daycare|childcare|child care|babysit|in ?home care|home care|home health|sewing|quilt|candle|soap|jewelry|embroider|screen print)\b/i;

/** Words that say the business runs out of a residence. */
const HOME_EXPLICIT = /\b(home[- ]?based|home ?office|works? from home|out of (?:their|our|my|his|her) home|home studio|home shop|home bakery|home salon|home daycare|cottage|homestead|residential shop|garage shop|farmhouse)\b/i;

/** Comes-to-you language. Strong, but not proof on its own. */
const SERVICE_AREA = /\b(mobile|in[- ]?home|at[- ]?home|we come to you|comes? to you|on[- ]?site|traveling|door to door|service area)\b/i;

/** Categories that live in a building someone else leases. */
const BUILDING_CATEGORIES = new Set([
  "Hospitality & food",
  "Retail",
  "Medical & dental",
  "Community & faith",
  "Logistics & warehouse",
]);

/** Categories a one-person operation plausibly runs from a house. */
const HOME_FRIENDLY_CATEGORIES = new Set([
  "Construction",
  "Agriculture & equine",
  "Professional services",
  "Automotive",
  "Education & childcare",
]);

export type HomeBasedVerdict = {
  homeBased: boolean;
  score: number;
  reasons: string[];
  blockers: string[];
};

/**
 * Scores how much a public listing looks like it runs out of a residence.
 * Deliberately conservative: an office in a business park scores negative even
 * when the street is named like a subdivision.
 */
export function homeBasedVerdict(prospect: Prospect): HomeBasedVerdict {
  const reasons: string[] = [];
  const blockers: string[] = [];
  const name = prospect.name || "";
  const address = prospect.address || "";
  const notes = prospect.publicNotes ?? "";
  const nameAndNotes = `${name} ${notes}`;
  const blob = `${name} ${address} ${prospect.category} ${notes}`;
  let score = 0;

  const missingAddress = NO_ADDRESS.test(address) || address.trim().length < 6;
  // A hidden Maps address suggests a service-area operation, not necessarily a home.
  const fromMaps = /google maps/i.test(prospect.source ?? "");
  const serviceAreaListing = missingAddress && fromMaps && (prospect.reviewCount ?? 0) < 60;

  if (isMassRetail(prospect)) blockers.push("national chain or convenience stop");
  if (missingAddress && !serviceAreaListing) blockers.push("no public street address to judge");
  if (UNIT_DESIGNATOR.test(address)) blockers.push("suite or unit address; residential use is unclear");
  if (COMMERCIAL_PARK.test(address)) blockers.push("address sits in a business or industrial park");
  if (FACILITY.test(nameAndNotes)) blockers.push("the name describes a facility, not a residence");
  if ((prospect.locationCount ?? 1) > 1) blockers.push("more than one location");
  if ((prospect.reviewCount ?? 0) >= 150) blockers.push("high review volume; a small home operation needs stronger evidence");

  const explicit = HOME_EXPLICIT.test(nameAndNotes);
  if (explicit) {
    score += 5;
    reasons.push("says it runs out of a home");
  }
  if (SERVICE_AREA.test(nameAndNotes)) {
    score += 3;
    reasons.push("mobile or in-home service");
  }
  if (HOME_TRADE.test(blob)) {
    score += 3;
    reasons.push("trade can operate from a home or as a mobile service");
  }
  const residentialStreet = RESIDENTIAL_STREET.test(address) && !COMMERCIAL_STREET.test(address);
  if (residentialStreet) {
    score += 1;
    reasons.push("street name suggests residential surroundings; not verified");
  }
  // A missing street number is a weak service-area signal, not proof of a home.
  const noStreetNumber = !/^\s*\d/.test(address) && !missingAddress;
  if (noStreetNumber) {
    score += 1;
    reasons.push("no street number published, which Maps does for service-area businesses");
  }
  if (serviceAreaListing) {
    score += 2;
    reasons.push("listed on Maps with no storefront address, the way service-area businesses are");
  }
  const reviews = prospect.reviewCount;
  if (reviews != null && reviews <= 15) {
    score += 1;
    reasons.push("almost no review traffic");
  }
  if (HOME_FRIENDLY_CATEGORIES.has(prospect.category)) score += 1;

  if (COMMERCIAL_STREET.test(address)) {
    score -= 3;
    blockers.push("commercial corridor address");
  }
  if (BUILDING_CATEGORIES.has(prospect.category) && !explicit) score -= 3;
  if (reviews != null && reviews >= 60) score -= 2;

  // A trade name alone is not enough. Something about where it sits, or how it
  // describes itself, has to point at a residence.
  const placeEvidence =
    explicit || SERVICE_AREA.test(nameAndNotes) || residentialStreet || noStreetNumber || serviceAreaListing;
  const homeBased = blockers.length === 0 && score >= 4 && placeEvidence;
  return { homeBased, score, reasons, blockers };
}

export function looksHomeBased(prospect: Prospect) {
  return homeBasedVerdict(prospect).homeBased;
}

export function homeSignal(prospect: Prospect): LiveLeadSignal | null {
  const verdict = homeBasedVerdict(prospect);
  if (!verdict.homeBased) return null;
  return {
    kind: "home",
    label: "Possibly home-based",
    detail: verdict.reasons.slice(0, 2).join("; ") || "runs out of a residence",
  };
}

export type BriefFilterResult = {
  kept: Prospect[];
  confirmed: number;
  relaxed: boolean;
};

export function filterProspectsForBrief(
  prospects: Prospect[],
  input: { profile: LiveProfile; excludeNational: boolean; category?: string | null; searchTerms?: string[] },
): BriefFilterResult {
  const category = input.category?.trim() || null;
  let kept = prospects.filter((item) => item.operatingStatus !== "Temporarily closed");
  if (category) kept = kept.filter((item) => item.category === category);
  if (input.searchTerms?.length) {
    const terms = input.searchTerms;
    kept = kept.filter((item) => searchRelevance(item, terms) > 0);
  }

  if (input.profile === "home_based") {
    const scored = kept
      .map((item) => ({ item, verdict: homeBasedVerdict(item) }))
      .filter((entry) => entry.verdict.homeBased)
      .sort((a, b) => b.verdict.score - a.verdict.score);
    const confirmed = scored.map((entry) => ({
      ...entry.item,
      signals: mergeSignals(entry.item.signals, {
        kind: "home",
        label: "Possibly home-based",
        detail: entry.verdict.reasons.slice(0, 2).join("; ") || "runs out of a residence",
      }),
    }));
    // A short or empty result is better than silently changing the requested profile.
    return { kept: confirmed, confirmed: confirmed.length, relaxed: false };
  }

  if (input.profile === "independent" || input.excludeNational) {
    kept = kept.filter((item) => !isMassRetail(item));
  }

  return { kept, confirmed: 0, relaxed: false };
}

export function attachRivalSignals(prospects: Prospect[], radiusMiles = 0.35): Prospect[] {
  return prospects.map((prospect) => {
    const rivals = prospects.filter((other) => {
      if (other.id === prospect.id) return false;
      if (other.category !== prospect.category) return false;
      return distanceMiles(prospect.coordinates, other.coordinates) <= radiusMiles;
    });
    if (!rivals.length) return prospect;
    const nearest = [...rivals].sort(
      (a, b) =>
        distanceMiles(prospect.coordinates, a.coordinates) - distanceMiles(prospect.coordinates, b.coordinates),
    )[0]!;
    const miles = distanceMiles(prospect.coordinates, nearest.coordinates);
    const signal: LiveLeadSignal = {
      kind: "rival",
      label: "Near a rival",
      detail: `${nearest.name} is ${miles.toFixed(2)} mi away`,
    };
    return { ...prospect, signals: mergeSignals(prospect.signals, signal) };
  });
}

export function mergeSignals(current: LiveLeadSignal[] | undefined, incoming: LiveLeadSignal) {
  const next = [...(current ?? [])];
  const index = next.findIndex((item) => item.kind === incoming.kind);
  if (index >= 0) next[index] = incoming;
  else next.push(incoming);
  return next;
}

export function genuineSignal(prospect: Prospect): LiveLeadSignal {
  if (isNationalChain(prospect.name) || isMassRetail(prospect)) {
    return { kind: "chain", label: "National chain", detail: "Skip unless they asked for this kind of stop" };
  }
  return {
    kind: "independent",
    label: "Looks independent",
    detail: prospect.phone || prospect.website ? "Public contact on file" : "Thin listing — confirm before you call",
  };
}

function focusTokens(value: string) {
  return value.toLowerCase()
    .replace(/\bplumb(?:ers?|ing)?\b/g, "plumb")
    .replace(/\b(?:dentists?|dentistry|dental)\b/g, "dent")
    .replace(/\blandscap(?:e|ers?|ing)?\b/g, "landscap")
    .replace(/\blawncare\b/g, "lawn care")
    .replace(/\belectric(?:ians?|al)?\b/g, "electric")
    .replace(/\broof(?:ers?|ing)?\b/g, "roof")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !/^(?:and|the|service|services|business|businesses|company|companies|near|local|care|find|show|please|instead)$/.test(token))
    .map((token) => token.length > 4 ? token.replace(/s$/, "") : token);
}

/** Use listing evidence, not generated sales copy or broad industry labels.
 * Medical & dental, for example, is not proof that a clinic is a dentist. */
export function searchRelevance(prospect: Pick<Prospect, "name" | "publicNotes">, terms: string[]) {
  const wanted = new Set(focusTokens(terms.join(" ")));
  if (!wanted.size) return 0;
  const evidence = new Set(focusTokens(`${prospect.name} ${prospect.publicNotes ?? ""}`));
  return [...wanted].reduce((score, token) => score + Number(evidence.has(token)), 0);
}
