/** Prefilled searches the rep opens themselves. People-search sites block automated lookups, so these are links, not scrapes. */
export type LookupLink = { id: string; group: 'people' | 'records' | 'web'; label: string; detail: string; url: string };

export function splitAddress(address: string) {
  const parts = address.split(',').map(part => part.trim()).filter(Boolean);
  const region = parts.at(-1)?.match(/^([A-Za-z]{2})\s*(\d{5})?/);
  if (parts.length < 3 || !region) return { street: parts[0] ?? '', city: parts[1] ?? '', state: '', zip: '' };
  return { street: parts.slice(0, -2).join(' '), city: parts.at(-2) ?? '', state: region[1].toUpperCase(), zip: region[2] ?? '' };
}

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const google = (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`;

export function lookupLinks(business: { name: string; address: string; phone?: string | null }, people: string[] = []): LookupLink[] {
  const { street, city, state, zip } = splitAddress(business.address);
  const cityState = [city, state].filter(Boolean).join(', ');
  const digits = (business.phone ?? '').replace(/\D/g, '').slice(-10);
  const dashed = digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : '';
  const links: LookupLink[] = [];
  if (dashed) {
    links.push({ id: 'tps-phone', group: 'people', label: 'TruePeopleSearch', detail: `Reverse phone ${dashed}`, url: `https://www.truepeoplesearch.com/resultphone?phoneno=${digits}` });
    links.push({ id: 'fps-phone', group: 'people', label: 'FastPeopleSearch', detail: `Reverse phone ${dashed}`, url: `https://www.fastpeoplesearch.com/${dashed}` });
  }
  if (street && city) {
    links.push({ id: 'tps-address', group: 'people', label: 'TruePeopleSearch', detail: 'Who is tied to this address', url: `https://www.truepeoplesearch.com/resultaddress?streetaddress=${encodeURIComponent(street)}&citystatezip=${encodeURIComponent([cityState, zip].filter(Boolean).join(' '))}` });
    if (state) links.push({ id: 'fps-address', group: 'people', label: 'FastPeopleSearch', detail: 'Who is tied to this address', url: `https://www.fastpeoplesearch.com/address/${slug(street)}_${slug(`${city} ${state} ${zip}`)}` });
  }
  for (const person of people.slice(0, 3)) {
    links.push({ id: `tps-${slug(person)}`, group: 'people', label: person, detail: 'Look up on TruePeopleSearch', url: `https://www.truepeoplesearch.com/results?name=${encodeURIComponent(person)}${cityState ? `&citystatezip=${encodeURIComponent(cityState)}` : ''}` });
  }
  links.push(
    { id: 'bizapedia', group: 'records', label: 'Bizapedia', detail: 'Officers and registered agent', url: `https://www.bizapedia.com/search?q=${encodeURIComponent(business.name)}` },
    { id: 'opencorporates', group: 'records', label: 'OpenCorporates', detail: 'State filings', url: `https://opencorporates.com/companies?q=${encodeURIComponent(business.name)}${state ? `&jurisdiction_code=us_${state.toLowerCase()}` : ''}` },
    { id: 'bbb', group: 'records', label: 'BBB', detail: 'Owner and complaints', url: `https://www.bbb.org/search?find_text=${encodeURIComponent(business.name)}${cityState ? `&find_loc=${encodeURIComponent(cityState)}` : ''}` },
    { id: 'sos', group: 'records', label: 'Secretary of State', detail: state ? `${state} business entity search` : 'Business entity search', url: google(`${state} secretary of state business entity search`) },
    { id: 'owner', group: 'web', label: 'Google', detail: 'Who owns it', url: google(`"${business.name}" owner ${cityState}`) },
    { id: 'linkedin', group: 'web', label: 'LinkedIn', detail: 'Owner or manager profiles', url: google(`site:linkedin.com "${business.name}" ${city}`) },
    { id: 'facebook', group: 'web', label: 'Facebook', detail: 'Page and owner posts', url: `https://www.facebook.com/search/pages/?q=${encodeURIComponent(`${business.name} ${city}`.trim())}` },
  );
  return links;
}
