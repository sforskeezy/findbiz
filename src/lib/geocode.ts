import type { Confidence, Coordinates } from "@/lib/types";
import { createTimeoutSignal } from "@/lib/request-safety";

export type GeocodeResult = {
  formattedAddress: string;
  coordinates: Coordinates;
  confidence: Confidence;
  provider: "census" | "photon" | "nominatim";
};

type ParsedAddress = {
  raw: string;
  housenumber: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
};

type Candidate = GeocodeResult & { score: number };

const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  DC: "District of Columbia",
};

const STREET_EXPAND: Record<string, string> = {
  rd: "road", road: "rd",
  st: "street", street: "st",
  ave: "avenue", avenue: "ave",
  blvd: "boulevard", boulevard: "blvd",
  dr: "drive", drive: "dr",
  ln: "lane", lane: "ln",
  ct: "court", court: "ct",
  cir: "circle", circle: "cir",
  hwy: "highway", highway: "hwy",
  pkwy: "parkway", parkway: "pkwy",
  rte: "route", route: "rte",
};

const geocodeCache = new Map<string, { value: GeocodeResult; expiresAt: number }>();
let lastNominatimRequest = 0;

function userAgent() {
  const contact = process.env.OSM_CONTACT_EMAIL?.trim();
  return contact
    ? `ProspectIQ/0.2 (${contact})`
    : "ProspectIQ/0.2 (private single-user business research; contact via OSM_CONTACT_EMAIL)";
}

function collapse(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeToken(value: string) {
  return value
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function highwayVariants(street: string, state: string | null) {
  const base = collapse(street);
  const variants = new Set<string>([base]);
  const match =
    base.match(/^(?:state|us|u\.s\.|county)?\s*(?:route|rte|highway|hwy|sr|cr)\s*#?\s*(\d+[A-Za-z]?)$/i) ||
    base.match(/^[A-Za-z]{2}[-\s](\d+[A-Za-z]?)$/);
  if (!match) return [...variants];

  const number = match[1];
  variants.add(`State Route ${number}`);
  variants.add(`State Rte ${number}`);
  variants.add(`SR ${number}`);
  variants.add(`Route ${number}`);
  variants.add(`Rte ${number}`);
  variants.add(`Highway ${number}`);
  variants.add(`Hwy ${number}`);
  if (state) {
    variants.add(`${state}-${number}`);
    variants.add(`${state} ${number}`);
  }
  return [...variants];
}

function streetVariants(street: string, state: string | null = null) {
  const base = collapse(street);
  const tokens = base.split(/\s+/);
  const last = tokens[tokens.length - 1]?.toLowerCase().replace(/\./g, "");
  const variants = new Set<string>([base, ...highwayVariants(base, state)]);
  if (last && STREET_EXPAND[last]) {
    variants.add([...tokens.slice(0, -1), STREET_EXPAND[last]].join(" "));
  }
  return [...variants];
}

export function parseUsAddress(input: string): ParsedAddress {
  const raw = collapse(input);
  let working = raw.replace(/,?\s*USA?\.?$/i, "").trim();

  let postcode: string | null = null;
  const zipMatch = working.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zipMatch) {
    postcode = zipMatch[1];
    working = collapse(working.replace(zipMatch[0], " "));
  }

  let state: string | null = null;
  const stateMatch =
    working.match(/,?\s*\b([A-Z]{2})\b\.?\s*$/i) ||
    working.match(
      /,?\s*\b(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)\b\.?\s*$/i,
    );
  if (stateMatch) {
    const token = stateMatch[1];
    state =
      token.length === 2
        ? token.toUpperCase()
        : (Object.entries(STATE_NAMES).find(([, name]) => name.toLowerCase() === token.toLowerCase())?.[0] ?? token);
    working = collapse(working.slice(0, stateMatch.index).replace(/,\s*$/, ""));
  }

  const parts = working.split(",").map((part) => collapse(part)).filter(Boolean);
  let city: string | null = null;
  let streetLine = working;

  if (parts.length >= 2) {
    city = parts[parts.length - 1] || null;
    streetLine = parts.slice(0, -1).join(", ");
  }

  const houseMatch = streetLine.match(/^(\d+[A-Za-z]?)\s+(.+)$/);
  return {
    raw,
    housenumber: houseMatch?.[1] ?? null,
    street: houseMatch?.[2] ?? (streetLine || null),
    city,
    state,
    postcode,
  };
}

function buildQueryVariants(parsed: ParsedAddress) {
  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | null | undefined) => {
    const query = value ? collapse(value) : "";
    if (query.length < 5 || seen.has(query.toLowerCase())) return;
    seen.add(query.toLowerCase());
    queries.push(query);
  };

  const streets = parsed.street ? streetVariants(parsed.street, parsed.state) : [""];
  const stateName = parsed.state ? STATE_NAMES[parsed.state] : null;

  // Prefer exact and locality forms first so highway aliases don't bury city/ZIP matches.
  add(parsed.raw);
  if (parsed.housenumber && parsed.street && parsed.city && parsed.state && parsed.postcode) {
    add(`${parsed.housenumber} ${parsed.street}, ${parsed.city}, ${parsed.state} ${parsed.postcode}`);
  }
  if (parsed.city && parsed.state && parsed.postcode) {
    add(`${parsed.city}, ${parsed.state} ${parsed.postcode}`);
    if (stateName) add(`${parsed.city}, ${stateName} ${parsed.postcode}`);
  }
  if (parsed.city && parsed.postcode) add(`${parsed.city} ${parsed.postcode}`);
  if (parsed.city && parsed.state) add(`${parsed.city}, ${parsed.state}`);

  for (const street of streets.slice(0, 6)) {
    const line = [parsed.housenumber, street].filter(Boolean).join(" ");
    if (line && parsed.state && parsed.postcode) {
      add(`${line}, ${parsed.state} ${parsed.postcode}`);
      if (stateName) add(`${line}, ${stateName} ${parsed.postcode}`);
    }
    if (line && parsed.postcode) {
      add(`${line} ${parsed.postcode}`);
      add(`${line}, ${parsed.postcode}`);
    }
    if (street && parsed.postcode) {
      add(`${street} ${parsed.postcode}`);
      if (parsed.state) add(`${street}, ${parsed.state} ${parsed.postcode}`);
    }
    if (line && parsed.city && parsed.state) add(`${line}, ${parsed.city}, ${parsed.state}`);
  }

  if (parsed.postcode) add(parsed.postcode);
  return queries;
}

function scoreCandidate(candidate: Omit<Candidate, "score">, parsed: ParsedAddress): number {
  let score = 0;
  const formatted = normalizeToken(candidate.formattedAddress);

  if (parsed.postcode && formatted.includes(parsed.postcode)) score += 40;
  if (parsed.state) {
    const stateName = STATE_NAMES[parsed.state]?.toLowerCase();
    if (formatted.includes(parsed.state.toLowerCase()) || (stateName && formatted.includes(stateName))) score += 12;
  }
  if (parsed.street) {
    for (const variant of streetVariants(parsed.street, parsed.state)) {
      if (formatted.includes(normalizeToken(variant))) {
        score += 28;
        break;
      }
    }
  }
  if (parsed.housenumber && formatted.includes(normalizeToken(parsed.housenumber))) score += 24;
  if (parsed.city && formatted.includes(normalizeToken(parsed.city))) score += 18;
  if (candidate.confidence === "Verified") score += 10;
  if (candidate.provider === "census") score += 6;
  return score;
}

async function geocodeWithCensus(query: string): Promise<GeocodeResult | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", query);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  const response = await fetch(url, { cache: "no-store", signal: createTimeoutSignal(4_500) });
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    result?: {
      addressMatches?: Array<{
        matchedAddress?: string;
        coordinates?: { x?: number; y?: number };
      }>;
    };
  };
  const match = payload.result?.addressMatches?.[0];
  if (!match?.coordinates || match.coordinates.x == null || match.coordinates.y == null) return null;
  return {
    formattedAddress: match.matchedAddress || query,
    coordinates: { lat: match.coordinates.y, lng: match.coordinates.x },
    confidence: "Verified",
    provider: "census",
  };
}

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    state?: string;
    countrycode?: string;
    extent?: [number, number, number, number];
  };
};

function photonFormatted(properties: NonNullable<PhotonFeature["properties"]>, fallback: string) {
  const streetLine = [properties.housenumber, properties.street || properties.name].filter(Boolean).join(" ");
  const locality = [properties.city, properties.state, properties.postcode].filter(Boolean).join(", ");
  return [streetLine, locality].filter(Boolean).join(", ") || fallback;
}

function streetNamesMatch(candidateStreet: string | undefined, parsedStreet: string | null, state: string | null) {
  if (!candidateStreet || !parsedStreet) return false;
  const left = normalizeToken(candidateStreet);
  const rightVariants = streetVariants(parsedStreet, state).map(normalizeToken);
  return rightVariants.some((variant) => left === variant || left.includes(variant) || variant.includes(left));
}

async function geocodeWithPhoton(query: string, parsed: ParsedAddress): Promise<Candidate[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");
  url.searchParams.set("lang", "en");

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": userAgent() },
    cache: "no-store",
    signal: createTimeoutSignal(4_500),
  });
  if (!response.ok) return [];

  const payload = (await response.json()) as { features?: PhotonFeature[] };
  const out: Candidate[] = [];

  for (const feature of payload.features ?? []) {
    const coordinates = feature.geometry?.coordinates;
    const properties = feature.properties;
    if (!coordinates || !properties) continue;
    if (properties.countrycode && properties.countrycode.toUpperCase() !== "US") continue;

    const type = properties.type ?? "";
    const postcodeOk = !parsed.postcode || properties.postcode === parsed.postcode;
    const cityOk =
      !parsed.city ||
      normalizeToken(properties.city || "") === normalizeToken(parsed.city) ||
      normalizeToken(properties.name || "") === normalizeToken(parsed.city);
    const streetOk = streetNamesMatch(properties.street || properties.name, parsed.street, parsed.state);
    const houseOk = !parsed.housenumber || properties.housenumber === parsed.housenumber;

    if (parsed.postcode && !postcodeOk && !["other", "district", "city", "locality"].includes(type)) continue;
    if (parsed.street && type === "street" && !streetOk) continue;
    if (type === "house" && parsed.street && !streetOk && !houseOk) continue;
    if (["district", "city", "locality", "other"].includes(type) && parsed.city && !cityOk && !postcodeOk) continue;

    let confidence: Confidence = "Estimated";
    if (type === "house" && houseOk && postcodeOk) confidence = "Verified";
    if (type === "street" && streetOk && postcodeOk) confidence = "Estimated";
    if (["district", "city", "locality", "other"].includes(type) && (postcodeOk || cityOk)) confidence = "Estimated";

    const result: GeocodeResult = {
      formattedAddress: photonFormatted(properties, query),
      coordinates: { lat: coordinates[1], lng: coordinates[0] },
      confidence,
      provider: "photon",
    };
    const localityBonus = ["district", "city", "locality"].includes(type) && postcodeOk && cityOk ? 12 : 0;
    out.push({ ...result, score: scoreCandidate(result, parsed) + (type === "house" ? 8 : 0) + localityBonus });
  }

  return out;
}

async function geocodeWithNominatim(query: string, parsed: ParsedAddress): Promise<GeocodeResult | null> {
  const elapsed = Date.now() - lastNominatimRequest;
  if (elapsed < 1_050) await new Promise((resolve) => setTimeout(resolve, 1_050 - elapsed));
  lastNominatimRequest = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  if (parsed.street || parsed.postcode) {
    if (parsed.housenumber && parsed.street) url.searchParams.set("street", `${parsed.housenumber} ${parsed.street}`);
    else if (parsed.street) url.searchParams.set("street", parsed.street);
    if (parsed.city) url.searchParams.set("city", parsed.city);
    if (parsed.state) url.searchParams.set("state", parsed.state);
    if (parsed.postcode) url.searchParams.set("postalcode", parsed.postcode);
    url.searchParams.set("country", "USA");
  } else {
    url.searchParams.set("q", query);
  }
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "us");
  if (process.env.OSM_CONTACT_EMAIL) url.searchParams.set("email", process.env.OSM_CONTACT_EMAIL);

  const response = await fetch(url, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
    cache: "no-store",
    signal: createTimeoutSignal(5_000),
  });
  if (!response.ok) return null;
  const results = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  if (!results[0]) return null;
  return {
    formattedAddress: results[0].display_name,
    coordinates: { lat: Number(results[0].lat), lng: Number(results[0].lon) },
    confidence: "Estimated",
    provider: "nominatim",
  };
}

export async function geocodeAddress(inputAddress: string): Promise<GeocodeResult> {
  const key = collapse(inputAddress).toLowerCase();
  const cached = geocodeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const parsed = parseUsAddress(inputAddress);
  const queries = buildQueryVariants(parsed);
  // Also try a zero-stripped house number variant without mutating the primary parse.
  if (parsed.housenumber?.startsWith("0")) {
    const stripped = { ...parsed, housenumber: parsed.housenumber.replace(/^0+/, "") || parsed.housenumber };
    for (const q of buildQueryVariants(stripped).slice(0, 2)) {
      if (!queries.includes(q)) queries.splice(1, 0, q);
    }
  }
  const candidates: Candidate[] = [];

  // Prefer the original / cleaned street forms — don't burn time on 8 sequential Census calls.
  for (const query of queries.slice(0, 3)) {
    try {
      const census = await geocodeWithCensus(query);
      if (census) candidates.push({ ...census, score: scoreCandidate(census, parsed) });
    } catch {
      // Continue with other providers.
    }
    if (candidates.some((item) => item.provider === "census" && item.score >= 55)) break;
  }

  if (!candidates.some((item) => item.score >= 70)) {
    for (const query of queries.slice(0, 4)) {
      try {
        candidates.push(...(await geocodeWithPhoton(query, parsed)));
      } catch {
        // Continue.
      }
      if (candidates.some((item) => item.score >= 60)) break;
    }
  }

  if (!candidates.length) {
    for (const query of queries.slice(0, 2)) {
      try {
        const nominatim = await geocodeWithNominatim(query, parsed);
        if (nominatim) candidates.push({ ...nominatim, score: scoreCandidate(nominatim, parsed) });
      } catch {
        // Nominatim is often blocked from cloud/hosting IPs.
      }
      if (candidates.length) break;
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score < 25) {
    throw new Error("That address could not be located. Try a full street address with ZIP code.");
  }

  const value: GeocodeResult = {
    formattedAddress: best.formattedAddress,
    coordinates: best.coordinates,
    confidence: best.confidence,
    provider: best.provider,
  };
  geocodeCache.set(key, { value, expiresAt: Date.now() + 5 * 60 * 1_000 });
  return value;
}
