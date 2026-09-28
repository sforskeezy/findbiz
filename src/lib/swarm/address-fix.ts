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

export function fixAddresses(text: string) {
  const lines = text.split(/\r?\n/).map(clean);
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (address: string) => { const key = address.toLowerCase().replace(/[^a-z0-9]/g, ''); if (!seen.has(key)) { seen.add(key); found.push(address); } };
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
