/** Pull clean one-line US addresses out of noisy copied text (e.g. PRISM exports), where each address is scattered across lines between junk. */
const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY', 'puerto rico': 'PR',
};
const ABBREVIATIONS = new Set(Object.values(STATES));
const SUFFIX = /^(?:st|street|rd|road|ave|av|avenue|blvd|boulevard|dr|drive|ln|lane|ct|court|cir|circle|way|pl|place|pkwy|parkway|hwy|highway|ter|terrace|trl|trail|loop|run|pike|sq|square|xing|crossing|row|path|pt|point|cv|cove|bnd|bend|aly|alley|expy|fwy|plz|plaza)\.?$/i;
const DIRECTION = /^(?:n|s|e|w|ne|nw|se|sw|north|south|east|west)\.?$/i;
const UNIT = /^(?:apt|apartment|unit|ste|suite|bldg|building|fl|floor|lot|rm|room|#)\.?$/i;
const STREET_START = /^\d{1,6}[a-z]?(?:-\d{1,5})?\s+(?:[a-z]|\d+(?:st|nd|rd|th)\b)/i;
const ZIP = /\b(\d{5})(?:-\d{4})?\b/;
const LOOKAHEAD = 5;

const clean = (line: string) => line.replace(/[^a-z0-9#.,'\- ]/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s.,'#-]+|[\s.,'-]+$/g, '').trim();
const words = (text: string) => text.replace(/,/g, ' ').split(' ').filter(Boolean);
const title = (word: string) => /^\d/.test(word) ? word.toLowerCase() : DIRECTION.test(word) && word.replace('.', '').length <= 2 ? word.replace('.', '').toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
const titleCase = (text: string) => text.split(' ').map(part => part.split('-').map(title).join('-')).join(' ');

type Locality = { city: string; state: string; zip: string; before: string };

/** Find "City ST 12345", "City Alabama", or a bare ZIP in a line; `before` is whatever precedes the state. */
function locality(line: string): Locality | null {
  const tokens = words(line);
  for (let i = tokens.length - 1; i >= 0; i--) {
    for (const span of [3, 2, 1]) {
      if (i - span + 1 < 0) continue;
      const phrase = tokens.slice(i - span + 1, i + 1).join(' ');
      const full = STATES[phrase.toLowerCase()];
      const after = tokens.slice(i + 1);
      const zip = after[0] && ZIP.test(after[0]) ? after[0].match(ZIP)![1] : '';
      const code = phrase.toUpperCase().replace('.', '');
      const abbr = span === 1 && ABBREVIATIONS.has(code) && (zip || (phrase === code && after.length === 0)) ? code : '';
      const state = full ?? abbr;
      if (!state) continue;
      if (!full && i === 0 && !zip && tokens.length > 1) continue;
      const beforeTokens = tokens.slice(0, i - span + 1);
      return { state, zip, before: beforeTokens.join(' '), city: cityFrom(beforeTokens) };
    }
  }
  const zip = line.match(ZIP);
  if (zip && !STREET_START.test(line)) {
    const beforeTokens = words(line.slice(0, zip.index));
    return { state: '', zip: zip[1], before: beforeTokens.join(' '), city: cityFrom(beforeTokens) };
  }
  return null;
}

/** A city is the trailing run of plain words right before the state. */
function cityFrom(tokens: string[]) {
  const city: string[] = [];
  for (let i = tokens.length - 1; i >= 0 && city.length < 3; i--) {
    const word = tokens[i].replace(/[.,]/g, '');
    if (!/^[a-z][a-z'-]*$/i.test(word) || SUFFIX.test(word) || UNIT.test(word)) break;
    city.unshift(word);
  }
  return city.join(' ');
}

/** Keep the street through its suffix, direction, and unit; anything after is treated as a possible city or noise. */
function splitStreet(text: string) {
  const tokens = words(text);
  let end = -1;
  for (let i = 1; i < tokens.length; i++) if (SUFFIX.test(tokens[i])) { end = i; break; }
  if (end < 0) return { street: tokens.slice(0, Math.min(tokens.length, 5)).join(' '), rest: tokens.slice(5).join(' ') };
  if (tokens[end + 1] && DIRECTION.test(tokens[end + 1])) end++;
  if (tokens[end + 1] && UNIT.test(tokens[end + 1]) && tokens[end + 2]) end += 2;
  else if (tokens[end + 1] && /^#\w+$/.test(tokens[end + 1])) end++;
  return { street: tokens.slice(0, end + 1).join(' '), rest: tokens.slice(end + 1).join(' ') };
}

const plainCity = (line: string) => /^[a-z][a-z' -]{1,30}$/i.test(line) && words(line).length <= 3 && !words(line).some(word => SUFFIX.test(word) || UNIT.test(word)) ? line : '';

function format(street: string, city: string, state: string, zip: string) {
  const region = [state, zip].filter(Boolean).join(' ');
  return [titleCase(street), city && titleCase(city), region].filter(Boolean).join(', ');
}

const HOUSE_CELL = /^(?:\d{1,4}\s+)*(\d{1,6}[a-z]?(?:-\d{1,5})?)$/i;
const UNIT_CELL = /^(?:apt|apartment|unit|ste|suite|bldg|building|fl|floor|lot|rm|room|rear|front|upper|lower|bsmt|basement|trlr|trailer|spc|space|#)\.?$/i;
const CITY_CELL = /^[a-z][a-z .'-]{0,40}$/i;
const PLACEHOLDER = /^[.\s…-]*$/;
const STREET_WINDOW = 8;

/** A city, state, and ZIP that PRISM puts in their own cells ("LOCKPORT⇥KY⇥40036"), or one cell when tabs were lost ("LOCKPORT KY 40036 2"). */
function prismLocality(cells: string[], i: number) {
  const zip = cells[i + 2]?.match(/^(\d{5})(?:-\d{4})?$/);
  const state = cells[i + 1]?.toUpperCase() ?? '';
  if (zip && CITY_CELL.test(cells[i]) && ABBREVIATIONS.has(state) && !SUFFIX.test(cells[i])) return { city: cells[i], state, zip: zip[1], end: i + 2 };
  const joined = cells[i].match(/^([a-z][a-z .'-]*?)\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?(?:\s+\d{1,3})?$/i);
  if (joined && ABBREVIATIONS.has(joined[2].toUpperCase())) return { city: joined[1], state: joined[2].toUpperCase(), zip: joined[3], end: i };
  return null;
}

/** PRISM rows scatter one address over cells: house number, street name, suffix, an optional unit ("Rear", "1"), then city/state/ZIP, all buried in plant columns. Walk back from each locality to the nearest house number that is followed by a street name. */
export function prismAddresses(text: string) {
  const cells = text.split(/\r?\n/).flatMap(line => line.split('\t')).map(cell => cell.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const found: string[] = [];
  let floor = 0;
  for (let i = 0; i < cells.length; i++) {
    const place = prismLocality(cells, i);
    if (!place) continue;
    for (let k = i - 1; k >= Math.max(floor, i - STREET_WINDOW); k--) {
      const house = cells[k].match(HOUSE_CELL);
      const next = cells[k + 1];
      if (!house || k + 1 >= i || !/[a-z]/i.test(next) || UNIT_CELL.test(next)) continue;
      const street = cells.slice(k + 1, i).filter(cell => !PLACEHOLDER.test(cell)).map(clean).filter(Boolean);
      if (!street.length) break;
      found.push(format([house[1], ...street].join(' '), place.city, place.state, place.zip));
      break;
    }
    floor = place.end + 1;
    i = place.end;
  }
  return found;
}

const UNIT_TAIL = /\s+(?:apt|apartment|unit|ste|suite|bldg|building|fl|floor|lot|rm|room|rear|front|upper|lower|bsmt|basement|trlr|trailer|spc|space|#)\b.*$/i;

function routeKey(address: string) {
  const [first = '', ...rest] = address.split(',').map(part => part.trim());
  const house = first.match(/^(\d+)([a-z]?)(?:-\d+)?\s+(.*)$/i);
  const street = house ? house[3] : first;
  return {
    area: rest.join(', '),
    street: street.replace(UNIT_TAIL, '').toLowerCase(),
    number: house ? Number(house[1]) : Number.MAX_SAFE_INTEGER,
    unit: (street.match(UNIT_TAIL)?.[0] ?? '').trim().toLowerCase(),
  };
}

/** Route order: by city/state/ZIP, then street, then house number low to high, so every door on a street sits together. */
export function sortAddresses(addresses: string[]) {
  const keyed = addresses.map(address => ({ address, key: routeKey(address) }));
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  keyed.sort((a, b) => text(a.key.area, b.key.area) || text(a.key.street, b.key.street) || a.key.number - b.key.number || text(a.key.unit, b.key.unit) || text(a.address, b.address));
  return keyed.map(item => item.address);
}

export function fixAddresses(text: string) {
  const lines = text.split(/\r?\n/).map(clean);
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (address: string) => { const key = address.toLowerCase().replace(/[^a-z0-9]/g, ''); if (!seen.has(key)) { seen.add(key); found.push(address); } };
  prismAddresses(text).forEach(add);
  for (let i = 0; i < lines.length; i++) {
    if (!STREET_START.test(lines[i])) continue;
    const { street, rest } = splitStreet(lines[i]);
    const inline = rest ? locality(rest) : null;
    if (inline && (inline.state || inline.zip)) {
      const city = inline.city || cityFrom(words(inline.before));
      add(format(street, city, inline.state, inline.zip || zipAfter(lines, i)));
      continue;
    }
    let cityHint = plainCity(rest);
    for (let j = i + 1; j < Math.min(lines.length, i + 1 + LOOKAHEAD); j++) {
      if (STREET_START.test(lines[j])) break;
      const match = locality(lines[j]);
      if (match && (match.state || match.zip)) {
        add(format(street, match.city || cityHint, match.state, match.zip || zipAfter(lines, j)));
        i = j;
        break;
      }
      cityHint = plainCity(lines[j]) || cityHint;
    }
  }
  return found;
}

function zipAfter(lines: string[], index: number) {
  const next = lines[index + 1] ?? '';
  const match = next.match(/^(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : '';
}
