/** Straight, curly, and similar marks people type as an apostrophe. */
const APOSTROPHES = /['\u2018\u2019\u201A\u201B\u2032\u02BC\u0060\u00B4]/g;

const IGNORED_NAME_WORDS = new Set(["the", "and", "a", "an", "llc", "inc", "company", "companie", "service", "business"]);

const WEAK_NAME_WORDS = new Set([
  "deli", "bakery", "cafe", "grill", "bar", "pub", "inn", "shop", "store", "market",
  "restaurant", "kitchen", "bistro", "tavern", "diner", "pizza", "coffee", "salon",
  "spa", "clinic", "co", "corp", "group", "place", "house",
]);

const STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia",
  kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md",
  massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo",
  montana: "mt", nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj",
  "new mexico": "nm", "new york": "ny", "north carolina": "nc", "north dakota": "nd", ohio: "oh",
  oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri",
  "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut",
  vermont: "vt", virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi", wyoming: "wy",
};

const STATE_CODE_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAME_TO_CODE).map(([name, code]) => [code, name.replace(/\b\w/g, (letter) => letter.toUpperCase())]),
);

const UNAMBIGUOUS_STATE_CODES = new Set(
  Object.values(STATE_NAME_TO_CODE).filter((code) => !["in", "or", "me", "ok", "hi", "id", "co", "la", "ma", "mt", "oh", "pa", "va", "wa"].includes(code)),
);

export function foldBusinessName(value: string) {
  return value
    .toLowerCase()
    .replace(APOSTROPHES, "")
    .replace(/lanscap/g, "landscap")
    .replace(/&/g, " and ");
}

export function businessNameWords(value: string) {
  return foldBusinessName(value)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.replace(/s$/, ""));
}

const NUMBER_WORD_TO_DIGIT: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};

const DIGIT_TO_NUMBER_WORD: Record<string, string> = Object.fromEntries(
  Object.entries(NUMBER_WORD_TO_DIGIT).map(([word, digit]) => [digit, word]),
);

/** "7brew" and "7 Brew" are the same brand. A digit buried mid-token ("l3harris") is not a seam. */
/** Words of a name with glued numerals separated, so "7brew" reads as "7 brew". */
export function businessNameTokens(value: string) {
  return splitNumberSeams(businessNameWords(value));
}

const GLUED_NUMBER = /^(\d+)([a-z]+)$/;
const TRAILING_NUMBER = /^([a-z]+)(\d+)$/;

function splitNumberSeams(words: string[]) {
  const out: string[] = [];
  for (const word of words) {
    const seam = GLUED_NUMBER.exec(word) ?? TRAILING_NUMBER.exec(word);
    if (seam) out.push(seam[1], seam[2]);
    else out.push(word);
  }
  return out;
}

/** "Seven Brew" spoken, "7 Brew" listed. Same token either way. */
function numberAliases(word: string) {
  const aliases = [word];
  if (NUMBER_WORD_TO_DIGIT[word]) aliases.push(NUMBER_WORD_TO_DIGIT[word]);
  if (DIGIT_TO_NUMBER_WORD[word]) aliases.push(DIGIT_TO_NUMBER_WORD[word]);
  return aliases;
}

/**
 * Spelling and spoken-form variants of one name, for search retries: apostrophe
 * styles, glued/split numerals, and digit/number-word swaps.
 */
export function nameVariants(name: string) {
  const seeds = nameSpellingVariants(name);
  const out = new Set(seeds);
  for (const seed of seeds) {
    const spaced = seed.replace(/(\d)([A-Za-z])/g, "$1 $2").replace(/([A-Za-z])(\d)/g, "$1 $2").replace(/\s+/g, " ").trim();
    if (spaced) out.add(spaced);
    for (const candidate of [seed, spaced]) {
      const swapped = candidate
        .split(/\s+/)
        .map((token) => {
          const folded = token.toLowerCase().replace(/[^a-z0-9]/g, "");
          const digit = NUMBER_WORD_TO_DIGIT[folded];
          if (digit) return token.replace(new RegExp(folded, "i"), digit);
          const spelled = DIGIT_TO_NUMBER_WORD[folded];
          if (spelled) return token.replace(folded, spelled.replace(/^\w/, (letter) => letter.toUpperCase()));
          return token;
        })
        .join(" ")
        .trim();
      if (swapped) out.add(swapped);
    }
  }
  return [...out].filter(Boolean).slice(0, 8);
}

export function nameWithoutRepeatedCity(name: string, location: string | null | undefined) {
  if (!location) return null;
  const city = requestedPlace(location).city;
  if (!city || city.length < 4) return null;
  const tokens = name.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (tokens.length < 2) return null;
  if (businessNameWords(tokens[0])[0] !== city && foldBusinessName(tokens[0]) !== city) return null;
  const rest = tokens.slice(1).join(" ");
  return rest.trim().length >= 3 ? rest : null;
}
export function nameSpellingVariants(name: string) {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  const straight = trimmed.replace(APOSTROPHES, "'");
  const stripped = trimmed.replace(APOSTROPHES, "");
  return [...new Set([trimmed, straight, stripped].filter(Boolean))];
}

export function locationQueryVariants(location: string | null | undefined) {
  const compact = location?.replace(/\s+/g, " ").trim();
  if (!compact) return [];
  const match = compact.match(/^(.*),\s*([A-Za-z]{2})$/);
  if (!match) {
    const named = compact.match(/^(.*),\s*([A-Za-z][A-Za-z .'-]+)$/);
    if (named) {
      const city = named[1].trim();
      const code = STATE_NAME_TO_CODE[named[2].trim().toLowerCase()];
      return [...new Set([compact, code ? `${city}, ${code.toUpperCase()}` : ""].filter(Boolean))];
    }
    return [compact];
  }
  const city = match[1].trim();
  const code = match[2].toUpperCase();
  const full = STATE_CODE_TO_NAME[code.toLowerCase()];
  return [...new Set([compact, full ? `${city}, ${full}` : "", `${city} ${code}`].filter(Boolean))];
}

function hostKey(url?: string) {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  } catch {
    return "";
  }
}

function requestedPlace(location: string) {
  const compact = location.replace(/\s+/g, " ").trim();
  const cityState = compact.match(/^(.*),\s*([A-Za-z]{2})$/) || compact.match(/^(.*),\s*([A-Za-z][A-Za-z .'-]+)$/);
  if (!cityState) return { city: foldBusinessName(compact), state: null as string | null };
  const city = foldBusinessName(cityState[1]);
  const rawState = cityState[2].trim().toLowerCase();
  const state = rawState.length === 2 ? rawState : STATE_NAME_TO_CODE[rawState] ?? null;
  return { city, state };
}

function mentionedStates(text: string) {
  const folded = foldBusinessName(text);
  const found = new Set<string>();
  for (const [name, code] of Object.entries(STATE_NAME_TO_CODE).sort((left, right) => right[0].length - left[0].length)) {
    if (new RegExp(`\\b${name}\\b`, "i").test(folded)) found.add(code);
  }
  const commaCode = folded.match(/,\s*([a-z]{2})\b/g) ?? [];
  for (const item of commaCode) {
    const code = item.replace(/[^a-z]/g, "");
    if (UNAMBIGUOUS_STATE_CODES.has(code) || STATE_NAME_TO_CODE[code] || Object.values(STATE_NAME_TO_CODE).includes(code)) {
      found.add(code);
    }
  }
  for (const word of folded.split(/[^a-z0-9]+/)) {
    if (UNAMBIGUOUS_STATE_CODES.has(word)) found.add(word);
  }
  return found;
}

function mentionedCitiesForState(text: string, state: string) {
  const folded = foldBusinessName(text);
  return [...folded.matchAll(new RegExp(`\\b([a-z][a-z]+(?:\\s+[a-z]+){0,2}),\\s*${state}\\b`, "g"))].map((item) => item[1]);
}

function locationConflicts(result: { title: string; snippet: string; url?: string }, location: string) {
  const requested = requestedPlace(location);
  if (!requested.state && !requested.city) return false;
  const hay = `${result.title} ${result.snippet} ${result.url || ""}`;
  const folded = foldBusinessName(hay);
  const cityHit = requested.city.length >= 4 && folded.includes(requested.city);
  const states = mentionedStates(hay);
  if (requested.state && requested.city.length >= 4) {
    const cities = mentionedCitiesForState(hay, requested.state);
    if (cities.length && !cities.some((city) => city.includes(requested.city) || requested.city.includes(city))) {
      return true;
    }
  }
  if (requested.state && (states.has(requested.state) || cityHit)) return false;
  if (!requested.state && cityHit) return false;
  if (requested.state && states.size && ![...states].includes(requested.state) && !cityHit) return true;
  return false;
}

/** Compare distinctive whole words: a search for L3 must not match L3Harris. */
export function matchesBusinessName(
  result: { title: string; snippet: string; url?: string },
  name: string,
  location?: string | null,
) {
  const wanted = splitNumberSeams(businessNameWords(name)).filter((word) => !IGNORED_NAME_WORDS.has(word));
  if (!wanted.length) return false;
  const found = new Set(splitNumberSeams(businessNameWords(`${result.title} ${result.snippet}`)));
  const host = hostKey(result.url);
  const has = (word: string) =>
    numberAliases(word).some((alias) => found.has(alias) || (alias.length >= 3 && host.includes(alias)));
  const city = location ? requestedPlace(location).city : "";
  // City words and trade labels like deli/bakery are supporting. A distinctive
  // remainder still has to hit, so a "Home | Mercantile" page can match a
  // "[City] Mercantile Deli" lookup without matching a different shop.
  const required = wanted.filter((word) => word !== city && !WEAK_NAME_WORDS.has(word));
  const core = required.length ? required : wanted;
  if (!core.every(has)) return false;
  if (location && locationConflicts(result, location)) return false;
  return true;
}
