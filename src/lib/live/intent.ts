export type LiveProfile = "home_based" | "independent" | "any";

export type LiveBrief = {
  raw: string;
  /** Best place named across the active search conversation. */
  locationHint: string | null;
  /** Maps keywords or a business name, kept separate from the geocodable place. */
  searchTerms: string[];
  /** A likely company name, used to label close alternatives honestly. */
  targetName: string | null;
  requestedCount: number | null;
  profile: LiveProfile;
  categoryHint: string | null;
  excludeNational: boolean;
  askedForChains: boolean;
  wantsResearch: boolean;
  wantsNews: boolean;
  wantsGenuineCheck: boolean;
  wantsCompetitors: boolean;
  wantsWeb: boolean;
  /** Distinct Google queries the rep asked for, if they named them. */
  webQueries: string[];
};

const COUNT_PATTERN =
  /\b(?:give me |show me |find |only |just |top |pull |get me )?(\d{1,2})\s+(?:(?:home[- ]?based|local|nearby|independent|owner[- ]?run)\s+)*(?:business(?:es)?|biz|prospects?|leads?|listings?)\b/i;

function requestedCount(text: string) {
  const match = text.match(COUNT_PATTERN) ?? text.match(/\b(?:find|show|give|get|pull)(?:\s+me)?\s+(\d{1,2})\b/i);
  if (!match) {
    return /\b(?:find|show|get|give|pull)\s+(?:me\s+)?(?:a|an|one)\s+/i.test(text) ? 1 : null;
  }
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 1 || value > 40) return null;
  return value;
}

function categoryHint(text: string) {
  const lowered = text.toLowerCase();
  if (/\b(legal|lawyer|attorney|law firm|accounting|cpa|tax)\b/.test(lowered)) return "Legal & accounting";
  if (/\b(dental|dentist|medical|clinic|doctor|vet)\b/.test(lowered)) return "Medical & dental";
  if (
    /\b(construct|contractor|roofer|plumber|hvac|electrician|handyman|painting|painter|fencing|pressure wash|lawn\s*care|lawncare|land\s*scap|landscap)\b/.test(
      lowered,
    )
  ) {
    return "Construction";
  }
  if (/\b(auto|mechanic|body shop|detail)\b/.test(lowered) && !/\b(home[- ]?based|at[- ]home)\b/.test(lowered)) {
    return "Automotive";
  }
  if (/\b(farm|equine|horse|ranch|stable)\b/.test(lowered)) return "Agriculture & equine";
  return null;
}

const US_STATE_CODES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC";

type LocationMatch = { value: string; start: number; end: number };

function locationMatch(raw: string): LocationMatch | null {
  const text = raw.replace(/\s+/g, " ").trim();

  // Keep a complete street address intact. It is more precise than a ZIP that
  // may also be present later in the same sentence.
  const street = new RegExp(
    `\\b(\\d{1,6}\\s+[A-Za-z0-9'.#-]+(?:\\s+[A-Za-z0-9'.#-]+){0,5}\\s+(?:rd|road|dr|drive|st|street|ave|avenue|blvd|boulevard|ln|lane|way|ct|court|hwy|highway|pkwy|parkway|cir|circle|pl|place|ter|terrace|trl|trail)(?:[\\s,]+[A-Za-z][A-Za-z .'-]{1,40})?(?:[\\s,]+(?:${US_STATE_CODES}))?(?:\\s+\\d{5}(?:-\\d{4})?)?)\\b`,
    "i",
  ).exec(text);
  if (street?.index != null) {
    return { value: street[1].trim(), start: street.index, end: street.index + street[0].length };
  }

  const zip = /\b\d{5}(?:-\d{4})?\b/.exec(text);
  if (zip?.index != null) {
    return { value: zip[0], start: zip.index, end: zip.index + zip[0].length };
  }

  // Ordinary speech rarely includes the comma: "in lugoff sc lawn care". The
  // state code is the reliable boundary between the place and the search focus.
  const afterPreposition = new RegExp(
    `\\b(?:in|near|around|by|at|within)\\s+([A-Za-z][A-Za-z.'-]*(?:\\s+[A-Za-z][A-Za-z.'-]*){0,3})[\\s,]+(${US_STATE_CODES})\\b`,
    "i",
  ).exec(text);
  if (afterPreposition?.index != null) {
    const whole = afterPreposition[0];
    const placeOffset = whole.toLowerCase().indexOf(afterPreposition[1].toLowerCase());
    const start = afterPreposition.index + Math.max(0, placeOffset);
    return {
      value: `${afterPreposition[1].trim()}, ${afterPreposition[2].toUpperCase()}`,
      start,
      end: afterPreposition.index + whole.length,
    };
  }

  const commaPlace = new RegExp(`\\b([A-Za-z][A-Za-z.'-]*(?:\\s+[A-Za-z][A-Za-z.'-]*){0,3}),\\s*(${US_STATE_CODES})\\b`, "i").exec(
    text,
  );
  if (commaPlace?.index != null) {
    return {
      value: `${commaPlace[1].trim()}, ${commaPlace[2].toUpperCase()}`,
      start: commaPlace.index,
      end: commaPlace.index + commaPlace[0].length,
    };
  }

  const cityOnly = /\b(?:in|near|around|by|at)\s+([A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){0,3}?)(?=\s+(?:and|then|for|within|that|who|which|with)\b|[?!,;]|$)/i.exec(
    text,
  );
  if (cityOnly?.index != null) {
    const whole = cityOnly[0];
    const placeOffset = whole.toLowerCase().indexOf(cityOnly[1].toLowerCase());
    const start = cityOnly.index + Math.max(0, placeOffset);
    return { value: cityOnly[1].trim(), start, end: cityOnly.index + whole.length };
  }

  const bareCityState = new RegExp(`^([A-Za-z][A-Za-z.'-]*(?:\\s+[A-Za-z][A-Za-z.'-]*){0,3})[\\s,]+(${US_STATE_CODES})\\b`, "i").exec(text);
  if (bareCityState && !/\b(?:find|show|tell|help|what|how|why|can|could|give|explain|write|thanks|thank|stop)\b/i.test(bareCityState[1]) && (!/^(?:me|in|or|hi|ok|id)$/i.test(bareCityState[2]) || bareCityState[2] === bareCityState[2].toUpperCase())) {
    return { value: `${bareCityState[1]}, ${bareCityState[2].toUpperCase()}`, start: 0, end: bareCityState[0].length };
  }

  const quoted = /\b(?:in|near|around|at)\s+["“]([^"”]{3,80})["”]/.exec(text);
  if (quoted?.index != null) {
    return { value: quoted[1].trim(), start: quoted.index, end: quoted.index + quoted[0].length };
  }

  return null;
}

export function extractLiveLocation(text: string) {
  const value = locationMatch(text)?.value ?? null;
  if (value && /\b(chat|list|screen|conversation|history|answer|reply|your|my|them|those|these|here|there|this|that|the area|my territory|mind|general)\b/i.test(value)) return null;
  return value;
}

const SEARCH_TERM_PATTERNS: Array<{ pattern: RegExp; terms: string[] }> = [
  { pattern: /\b(lawn\s*care|yard\s*(?:care|service)|landscap(?:e|er|ers|ing)?)\b/i, terms: ["lawn care service", "landscaping"] },
  { pattern: /\broof(?:ers?|ing)?\b/i, terms: ["roofing contractor"] },
  { pattern: /\bplumb(?:ers?|ing)?\b/i, terms: ["plumber"] },
  { pattern: /\b(hvac|heating and cooling)\b/i, terms: ["HVAC contractor"] },
  { pattern: /\b(electricians?|electrical)\b/i, terms: ["electrician"] },
  { pattern: /\b(handym[ae]n|general contractors?)\b/i, terms: ["general contractor"] },
  { pattern: /\b(auto repair|mechanics?|body shops?|collision repair)\b/i, terms: ["auto repair"] },
  { pattern: /\b(mobile detailing|car detailing)\b/i, terms: ["car detailing"] },
  { pattern: /\b(dentists?|dental|orthodontists?)\b/i, terms: ["dentist"] },
  { pattern: /\b(medical office|doctors?|clinics?)\b/i, terms: ["medical office"] },
  { pattern: /\b(veterinar(?:ian|ians|y)|vets?)\b/i, terms: ["veterinarian"] },
  { pattern: /\b(attorneys?|lawyers?|law firms?)\b/i, terms: ["law firm"] },
  { pattern: /\b(accountants?|accounting|cpa|tax services?)\b/i, terms: ["accounting firm"] },
  { pattern: /\b(house cleaning|cleaning services?|janitorial|maid service)\b/i, terms: ["cleaning service"] },
  { pattern: /\b(daycares?|child\s*care|preschools?|tutor(?:ing)?)\b/i, terms: ["daycare"] },
  { pattern: /\b(restaurants?|cafes?|coffee shops?|baker(?:y|ies)|bar and grill|pizzerias?)\b/i, terms: ["restaurant"] },
  { pattern: /\b(salons?|barbers?(?:hop|shop)?|hair stylist|spas?)\b/i, terms: ["salon"] },
  { pattern: /\b(farms?|ranch|horses?|equine|stables?|kennels?|nursery)\b/i, terms: ["farm"] },
];

const GENERIC_SEARCH_WORDS = new Set([
  "auto", "automotive", "bakery", "barber", "business", "businesses", "care", "car", "child", "cleaning",
  "company", "companies", "construction", "contractor", "contractors", "daycare", "dental", "dentist", "dentists",
  "detail", "detailing", "electric", "electrician", "farm", "farms", "general", "handyman", "home", "house", "hvac",
  "land", "landscape", "landscaping", "lawn", "lawyer", "lawyers", "local", "medical", "mechanic", "mechanics",
  "office", "painting", "plumber", "plumbers", "plumbing", "prospect", "prospects", "restaurant", "restaurants",
  "roof", "roofer", "roofers", "roofing", "salon", "service", "services", "shop", "shops", "spa", "tax", "yard",
]);

function cleanSearchPhrase(value: string) {
  return value
    .replace(/^[\s,;:.-]+|[\s,;:.-]+$/g, "")
    .replace(/^(?:is|that(?:'s| is))\s+(?:the\s+)?(?:zip|zip code|postal code)\b.*$/i, "")
    .replace(/^(?:named|called)\s+/i, "")
    .replace(
      /^(?:and\s+)?(?:then\s+)?(?:research|look (?:them|it|these) up|check (?:what(?:'s| is) new|them|it)|scan (?:the )?news|genuine-check|verify|rank|prioritize|tell me about)\b.*$/i,
      "",
    )
    .replace(/^(?:and\s+)?(?:for|called|named|that (?:does|is)|speciali[sz](?:es|ing) in)\s+/i, "")
    .replace(
      /\s+(?:and\s+)?(?:then\s+)?(?:research|look (?:them|it|these) up|check what'?s new|scan (?:the )?news|genuine-check|verify|rank|prioritize|tell me about)\b.*$/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

function searchPhrase(text: string) {
  const match = locationMatch(text);
  if (!match) return "";
  const normalized = text.replace(/\s+/g, " ").trim();
  const after = cleanSearchPhrase(normalized.slice(match.end));
  const before = cleanSearchPhrase(
    normalized
      .slice(0, match.start)
      .replace(/^(?:please\s+)?(?:can you\s+|could you\s+|will you\s+)?(?:find|search|look for|show|get|give me|pull)\s+(?:me\s+)?/i, "")
      .replace(/^(?:an?\s+)?(?:business(?:es)?|company|companies|shop|shops|prospects?|leads?)\s*$/i, ""),
  );
  const phrase = (after || before).replace(/\s+(?:in|near|around|by|at)$/i, "").trim();
  if (
    phrase.length < 3 ||
    phrase.length > 100 ||
    /^(?:(?:find|me|an?|\d+|home[- ]?based|local|independent|owner[- ]?run|business(?:es)?|company|companies|shops?|prospects?|leads?|nearby|around|here|in|near|by|at)\s*)+$/i.test(
      phrase,
    )
  ) {
    return "";
  }
  return phrase;
}

function searchTerms(text: string) {
  const phrase = searchPhrase(text);
  const found: string[] = phrase ? [phrase] : [];

  for (const entry of SEARCH_TERM_PATTERNS) {
    if (entry.pattern.test(text)) found.push(...entry.terms);
  }

  return [...new Set(found.map((item) => item.toLowerCase()))].slice(0, 4);
}

function targetName(text: string) {
  const phrase = searchPhrase(text);
  if (!phrase) return null;
  const distinctive = phrase
    .toLowerCase()
    .replace(/lawncare/g, "lawn care")
    .replace(/land\s*scape/g, "landscape")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && token !== "and" && !GENERIC_SEARCH_WORDS.has(token));
  return distinctive.length ? phrase : null;
}

const WEB_QUERY_SPLIT = /\s+(?:and then|and also|then also|, then|; then)\b|[.!?]/i;

function webQueries(text: string) {
  const queries: string[] = [];
  const patterns = [
    /\bgoogle(?:\s+for)?\s+(.+)/i,
    /\bsearch(?:\s+the)?\s+(?:web|google|internet)(?:\s+for)?\s+(.+)/i,
    /\b(?:do a )?(?:google|web) search(?:\s+for)?\s+(.+)/i,
    /\blook(?:ing)?\s+(?:it|this|that|them)?\s*up\s+(?:on\s+)?(?:google|the web|online)(?:\s+for)?\s*(.*)/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const rest = (match[1] ?? "").split(WEB_QUERY_SPLIT)[0] ?? "";
    const cleaned = rest.replace(/^[:\-–]\s*/, "").replace(/\s+/g, " ").trim();
    if (cleaned.length >= 3 && cleaned.length <= 160 && !/^(?:this|that|it|them)$/i.test(cleaned)) {
      queries.push(cleaned);
    }
  }
  return [...new Set(queries)].slice(0, 3);
}

function wantsWebSearch(text: string) {
  return /\b(?:google(?:\s+(?:this|that|it|them|for|who|what|whether|if|the))?|search(?:\s+the)?\s+(?:web|google|internet)|look(?:ing)? (?:it |this |that |them )?up(?: online| on google| on the web)|web search|do a google search)\b/i.test(
    text,
  );
}

function namedCompanyLookup(text: string) {
  return /\b(?:named|called)\s+[A-Za-z0-9'&.-]/i.test(text);
}

export function hasCompoundAsk(text: string) {
  return /\b(?:and then|and also|then also|as well as|, then)\b/i.test(text) || /[.!?]\s+(?:also|then|and|plus)\b/i.test(text);
}

export function parseLiveBrief(text: string): LiveBrief {
  const lowered = text.toLowerCase();
  const homeBased = /\b(home[- ]?based|at[- ]home|in[- ]home|from home|work(?:ing)? from home|home business(?:es)?|cottage business|owner[- ]run)\b/.test(
    lowered,
  );
  const excludesChains = /\b(no|not a|not|exclude|excluding|skip|without|drop|avoid)\s+(?:national\s+|big[- ]?)?(?:chains?|franchises?|box|convenience)\b/.test(lowered);
  const askedForChains = !excludesChains && /\b(gas stations?|convenience|grocery|supermarket|walmart|circle k|chains?|franchises?|big box)\b/.test(
    lowered,
  );
  const independent = !homeBased && /\b(independent|locally owned|mom and pop|owner[- ]operated|not a chain)\b/.test(lowered);

  return {
    raw: text.replace(/\s+/g, " ").trim(),
    locationHint: extractLiveLocation(text),
    searchTerms: searchTerms(text),
    targetName: targetName(text),
    requestedCount: requestedCount(text),
    profile: homeBased ? "home_based" : independent ? "independent" : "any",
    categoryHint: categoryHint(text),
    excludeNational: !askedForChains,
    askedForChains,
    wantsResearch:
      /\b(research|look (?:them|it|these) up|dig in|public details|check (?:them|it) out)\b/i.test(text) ||
      /\bbrief (?:me|them|these|the)\b/i.test(text),
    wantsNews:
      /\b(what'?s new|what is new|whats new|news scan|local news|expansion|new location|grand opening|what'?s going on with|check what'?s new|check what is new|new with (?:them|these|it))\b/i.test(
        text,
      ),
    wantsGenuineCheck:
      /\b(genuine|real business|actually exist|legit|verify|check (?:that |if )?(?:they|it)(?:'s| is)? real|independent vs(?:\.| )?chain)\b/i.test(
        text,
      ),
    wantsCompetitors: /\b(competitor|rival|near (?:a |their )?competitor|proximity)\b/i.test(text),
    wantsWeb: wantsWebSearch(text),
    webQueries: webQueries(text),
  };
}

export function mergeLiveBrief(previous: LiveBrief | null, next: LiveBrief, carryActions = false): LiveBrief {
  if (!previous) return next;
  const hasNewFocus = next.searchTerms.length > 0;
  const previousLocation = previous.locationHint ?? null;
  const previousTerms = previous.searchTerms ?? [];
  const previousTarget = previous.targetName ?? null;
  if (next.askedForChains) {
    return {
      ...next,
      locationHint: next.locationHint ?? previousLocation,
      searchTerms: hasNewFocus ? next.searchTerms : previousTerms,
      targetName: hasNewFocus ? next.targetName : previousTarget,
      requestedCount: next.requestedCount ?? previous.requestedCount,
      profile: "any",
      excludeNational: false,
      wantsWeb: next.wantsWeb,
      webQueries: next.webQueries.length ? next.webQueries : previous.webQueries,
    };
  }
  return {
    raw: carryActions ? `${previous.raw}; ${next.raw}` : next.raw,
    locationHint: next.locationHint ?? previousLocation,
    searchTerms: hasNewFocus ? next.searchTerms : previousTerms,
    targetName: hasNewFocus ? next.targetName : previousTarget,
    requestedCount: next.requestedCount ?? previous.requestedCount,
    profile: next.profile !== "any" ? next.profile : hasNewFocus ? "any" : previous.profile,
    categoryHint: next.categoryHint ?? (hasNewFocus ? null : previous.categoryHint),
    excludeNational: previous.excludeNational && next.excludeNational,
    askedForChains: false,
    // Keep unfinished clauses alive through a short location or ZIP follow-up.
    wantsResearch: (carryActions && previous.wantsResearch) || next.wantsResearch,
    wantsNews: (carryActions && previous.wantsNews) || next.wantsNews,
    wantsGenuineCheck: (carryActions && previous.wantsGenuineCheck) || next.wantsGenuineCheck,
    wantsCompetitors: (carryActions && previous.wantsCompetitors) || next.wantsCompetitors,
    wantsWeb: (carryActions && previous.wantsWeb) || next.wantsWeb,
    webQueries: next.webQueries.length ? next.webQueries : carryActions ? previous.webQueries : [],
  };
}

export function briefNeedsFollowThrough(brief: LiveBrief) {
  return brief.wantsResearch || brief.wantsNews || brief.wantsGenuineCheck || brief.wantsWeb;
}

/** Dispatch only obvious searches without a model. Mentioning a business or
 * a place inside a question should not replace the current list. */
export function isLiveSearchRequest(text: string) {
  const value = text.trim();
  if (/^(?:how|why|what (?:does|do|is|are)|explain|tell me why)\b/i.test(value)) return false;
  if (
    wantsWebSearch(value) &&
    (namedCompanyLookup(value) ||
      (!/\b(?:find|show me|pull|get me|give me)\b/i.test(value) &&
        !/\b(?:business(?:es)?|prospects?|leads?|listings?)\b/i.test(value)))
  ) {
    return false;
  }
  const action = /\b(?:find|search(?: for)?|look(?:ing)? for|show me|pull(?: up)?|get me|give me)\b/i.test(value);
  const subject = /\b(?:business(?:es)?|biz|companies|shops?|prospects?|leads?|listings?|places?)\b/i.test(value)
    || SEARCH_TERM_PATTERNS.some((item) => item.pattern.test(value));
  return action && (subject || Boolean(extractLiveLocation(value)));
}

export function isLiveRetry(text: string) {
  return /^(?:(?:please|okay|ok|can you)\s+)*(?:try (?:again|harder|really hard)|search (?:again|harder|wider)|keep (?:trying|looking|searching)|look harder|broaden (?:it|the search)|one more try)[.!?\s]*$/i.test(text);
}

export function isLiveNext(text: string) {
  return /^(?:(?:please|okay|ok)\s+)*(?:skip(?: this(?: one)?)?|next(?: one| business)?|another(?: one)?|skip to (?:the )?next(?: one)?)[.!?\s]*$/i.test(text);
}

export function resolveLiveTurn(text: string, previous: LiveBrief | null, context: {
  awaitingLocation?: boolean;
  locationLabel?: string | null;
}) {
  const parsed = parseLiveBrief(text);
  const reset = /\b(?:start (?:over|fresh)|new search|clear (?:the |my )?list|forget (?:the |that |my )?(?:list|search)|reset (?:the )?search)\b/i.test(text);
  const retry = !reset && isLiveRetry(text);
  const named = parsed.locationHint;
  const webOnly =
    parsed.wantsWeb &&
    (namedCompanyLookup(text) ||
      (!/\b(?:find|show me|pull|get me|give me)\b/i.test(text) &&
        !/\b(?:business(?:es)?|prospects?|leads?|listings?)\b/i.test(text)));
  const locationOnly = Boolean(named) && (
    text.replace(/[.!?]/g, "").replace(/,/g, "").trim().toLowerCase() === named?.replace(/,/g, "").toLowerCase()
    || /^\d{5}(?:-\d{4})?(?:\s+is the (?:zip|zip code))?[.!?\s]*$/i.test(text)
    || /^(?:(?:actually|try|in|near|make (?:it|that))\s+)?[A-Za-z .'-]+,?\s+[A-Z]{2}[.!?\s]*$/.test(text)
  );
  const focusChange = parsed.searchTerms.length > 0 && /^(?:actually|instead|how about|what about|switch to|make (?:it|that)|now (?:find|show)|let'?s (?:do|try|find))\b/i.test(text);
  const locationWithTrade = Boolean(named) && parsed.searchTerms.length > 0
    && text.toLowerCase().replace(/[,\s]+/g, " ").startsWith(named!.toLowerCase().replace(/[,\s]+/g, " "));
  const search = !webOnly && (isLiveSearchRequest(text) || locationOnly || locationWithTrade || focusChange || (retry && Boolean(previous || context.locationLabel)));
  const continuing = !reset && (retry || (locationOnly && Boolean(previous)) || /\b(?:same|more|another|again|nearby|around here)\b/i.test(text));
  // A new trade releases old counts and filters. A location answer completes
  // the pending request, including its compound research clauses.
  const brief = search
    ? mergeLiveBrief(continuing ? previous : null, parsed, Boolean(context.awaitingLocation) || retry)
    : parsed;
  if (search && !brief.locationHint) {
    brief.locationHint = reset ? null : previous?.locationHint ?? context.locationLabel ?? null;
  }
  return { search, retry, reset, brief, awaitingLocation: search && !brief.locationHint };
}

export function describeBrief(brief: LiveBrief) {
  const parts = [
    brief.profile === "home_based" ? "home-based / owner-run listings only — no gas, big-box, or national chains" : null,
    brief.profile === "independent" ? "independent shops, not national chains" : null,
    brief.excludeNational && brief.profile === "any" ? "skip national chains and convenience unless named" : null,
    brief.requestedCount ? `exactly ${brief.requestedCount} ${brief.requestedCount === 1 ? "business" : "businesses"}` : null,
    brief.categoryHint ? `industry: ${brief.categoryHint}` : null,
    brief.searchTerms?.length ? `search focus: ${brief.searchTerms.join(", ")}` : null,
    brief.wantsResearch ? "research the ones you find" : null,
    brief.wantsNews ? "scan local news / what's new" : null,
    brief.wantsGenuineCheck ? "genuine-check each listing" : null,
    brief.wantsCompetitors ? "flag rivals sitting next to each other" : null,
    brief.webQueries.length
      ? `google: ${brief.webQueries.join("; ")}`
      : brief.wantsWeb
        ? "search Google for what they asked"
        : null,
  ].filter(Boolean);
  return parts.length ? parts.join("; ") : "plain search — do not invent a count they did not ask for";
}
