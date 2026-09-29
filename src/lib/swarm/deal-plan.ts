import { homeBasedVerdict, isNationalChain } from '@/lib/live/filters';
import { isSpectrumProvider } from '@/lib/swarm/lead-book';
import { CLOSING, askFor, fill, profileFor } from '@/lib/swarm/discovery-bank';
import type { SwarmProspect } from '@/lib/swarm/types';

export type LaneStatus = 'clear' | 'check' | 'out';
export type LaneVerdict = { status: LaneStatus; reasons: string[] };
export type ProductId = 'internet' | 'mobile' | 'voice' | 'tv' | 'wifi' | 'backup' | 'static_ip' | 'connect';
/** `ask` is the question to lead with; `followUps` dig into the answer. */
export type DealProduct = { id: ProductId; label: string; why: string; ask: string; followUps: string[]; weight: number };
export type DealDriver = { label: string; good: boolean };
export type DiscoveryScript = {
  /** What kind of business this reads as, so the rep knows why the questions sound the way they do. */
  kind: string;
  /** Situation questions that get the owner talking about their own day before any product comes up. */
  opening: string[];
  /** Who to ask the person who answers the phone for. */
  gatekeeper: string;
  closing: string[];
};
export type DealPlan = {
  lane: LaneVerdict;
  products: DealProduct[];
  discovery: DiscoveryScript;
  /** 0–100. How much a single yes from this business is likely worth. Zero when out of lane. */
  score: number;
  drivers: DealDriver[];
  bestTime: string | null;
};

/** Accounts an SMB inside rep does not own: education, health systems, government, housing, enterprise. */
const OUT_OF_LANE: [RegExp, string][] = [
  [/\b(elementary|primary|intermediate|middle|junior high|high|charter|public|private|christian|catholic|baptist|parochial|prep(?:aratory)?|magnet|alternative|career|vocational)\s+school\b|\b(head start|board of education|early learning center|jr\.? high|junior high)\b|\bschool district\b|\bschools\b|\bk-?12\b/i, 'School or school district'],
  [/\b(university|college|community college|technical college|seminary)\b/i, 'College or university'],
  [/\b((?<!(?:animal|pet|veterinary|vet|doll|equine) )hospital|medical center|health system|healthcare system|regional medical|behavioral health center|surgery center|emergency room)\b/i, 'Hospital or health system'],
  [/\b(nursing home|assisted living|senior living|rehabilitation center|skilled nursing)\b/i, 'Large care facility'],
  [/\b(city of|county of|town of|village of|state of|department of|police|sheriff|fire (?:station|department|dept|district|rescue)|courthouse|post office|postal service|usps|library|dmv|town hall|city hall|township|twp|public works|road department|water (?:district|department|authority|works|commission)|utilities (?:district|department)|sewer district)\b/i, 'Government or public agency'],
  [/\b(apartments?|apartment homes|condominiums?|townhomes|mobile home park|student housing|senior apartments)\b/i, 'Multi-unit housing'],
  [/\b(resort|casino|convention center|stadium|arena|airport|speedway|raceway|motorsports park)\b/i, 'Large venue'],
];

const LODGING = /\b(hotel|motel|inn|lodge|suites|bed (?:and|&) breakfast|b&b|guest ?house|cabins?|cottages?|hostel|extended stay)\b/i;
const SCHOOLISH = /\b(school|academy|institute)\b/i;
const FINANCIAL = /\b(bank|credit union|savings (?:and|&) loan)\b/i;
const PLANT = /\b(plant|factory|manufacturing|distribution center)\b/i;
/** Corporate-run brands the shared national-chain list does not cover. */
const MORE_CHAINS = /\b(citi trends|dg market|fedex|southern states|tractor supply|harbor freight|rent-a-center|aaron's|advance america|sherwin-williams|o'reilly|ace cash|cricket wireless|metro by t-mobile|boost mobile)\b/i;
const SHOP_WORDS = /\b(pizza|pizzeria|grill|cafe|café|coffee|bakery|diner|deli|barber|salon|nails?|dental|dentist|orthodont|chiropract|tire|auto|mechanic|boutique|florist|liquor|vape|cleaners|laundr|tattoo|grooming|realty|insurance|cpa|attorney|law firm|pub|tavern|wings|tacos?|bbq|cleaning|plumbing|electric|roofing|lawn|landscap)\b/i;

export function laneVerdict(card: SwarmProspect): LaneVerdict {
  const p = card.business;
  const blob = `${p.name} ${p.category}`;
  const matched = OUT_OF_LANE.filter(([pattern]) => pattern.test(blob)).map(([, reason]) => reason);
  // "College Street Pizza" or "University Dental" names a road or a neighborhood, not the account.
  const smallBusiness = SHOP_WORDS.test(p.name);
  const out = smallBusiness ? [] : matched;
  const check: string[] = smallBusiness ? matched.map(reason => `Name suggests "${reason.toLowerCase()}", but it reads like a small business. Confirm who owns it`) : [];
  if (isNationalChain(p.name) || MORE_CHAINS.test(p.name)) out.push('National chain, owned by enterprise or corporate');
  if ((p.locationCount ?? 1) >= 10) out.push(`${p.locationCount} locations, which is enterprise-sized`);
  if (out.length) return { status: 'out', reasons: [...new Set(out)] };

  if (LODGING.test(blob)) check.push('Lodging. Confirm 8 rooms or fewer before you pitch');
  if (SCHOOLISH.test(blob)) check.push('Has "school" or "academy" in the name. Fine for a dance, driving, or martial arts studio; not for a K-12 or college');
  if (FINANCIAL.test(blob)) check.push('Bank or credit union. These are usually enterprise accounts');
  if (PLANT.test(p.name)) check.push('Plant or factory. Usually an enterprise account unless it is a small shop');
  if ((p.locationCount ?? 1) > 3) check.push(`${p.locationCount} locations. Confirm multi-site accounts stay in your lane`);
  if ((p.reviewCount ?? 0) >= 1500) check.push('Very high review volume. Confirm it is not an enterprise account');
  return { status: check.length ? 'check' : 'clear', reasons: check };
}

type Need = { id: ProductId; test: RegExp; why: string };

const CREW = /\b(home ?care|home health|hospice|caregiv|in-home|hvac|refrigeration|heating|air condition|plumb|electric|roof|landscap|lawn|pest|termite|exterminat|clean|janitor|maid|pressure wash|pool|construction|contractor|builder|remodel|handyman|painting|painter|drywall|flooring|concrete|paving|fence|gutter|tree|towing|tow service|moving|movers|junk|hauling|septic|well drilling|excavat|garage door|locksmith|appliance repair|courier|delivery|security system|alarm)\b/i;
const WAITING = /\b(barber|salon|hair|nail|spa|auto repair|tire|mechanic|body shop|collision|oil change|car wash|dental|dentist|orthodont|chiropract|optometr|eye care|veterinar|animal hospital|vet clinic|urgent care|clinic|physical therapy|dermatolog|pediatric|family practice|laundromat|dealership|motors|auto sales)\b/i;
const SPORTS_TV = /\b(bar|pub|tavern|grill|sports|wings|brewery|taproom|saloon|lounge|pizza|restaurant|diner|bowling|billiards|gym|fitness|crossfit|boxing|martial arts)\b/i;
const GUEST_WIFI = /\b(restaurant|cafe|café|coffee|bakery|diner|grill|pizza|bar|pub|brewery|salon|barber|spa|nail|laundromat|gym|fitness|hotel|motel|inn|lodge|cabin|bed (?:and|&) breakfast|b&b|waiting|clinic|dental|chiropract|veterinar|tire|auto repair|church|daycare|child care|boutique|store|shop|market)\b/i;
const TAKES_CARDS = /\b(restaurant|cafe|café|coffee|bakery|diner|grill|pizza|bar|pub|brewery|salon|barber|spa|nail|retail|boutique|store|shop|market|pharmacy|liquor|vape|smoke|florist|pet|grocery|deli|gas|convenience|auto repair|tire|dental|clinic|veterinar)\b/i;
const OFFICE = /\b(law|attorney|legal|cpa|accounting|accountant|tax|bookkeep|insurance|realty|real estate|mortgage|title|financial|advis|consult|agency|architect|engineer|dental|dentist|chiropract|clinic|veterinar|medical|therap|counsel|staffing|property management|funeral)\b/i;
const CAMERAS_REMOTE = /\b(dental|dentist|clinic|medical|veterinar|pharmacy|auto|tire|body shop|storage|warehouse|jewel|pawn|liquor|vape|smoke|firearm|gun|cannabis|dispensary|car wash|daycare|child care|law|cpa|accounting|architect|engineer)\b/i;

const NEEDS: Need[] = [
  { id: 'mobile', test: CREW, why: 'Crews in the field each carry a phone' },
  { id: 'tv', test: SPORTS_TV, why: 'Customers watch games or TV while they are there' },
  { id: 'tv', test: WAITING, why: 'Customers sit in a waiting area' },
  { id: 'wifi', test: GUEST_WIFI, why: 'Customers stay long enough to want Wi-Fi' },
  { id: 'backup', test: TAKES_CARDS, why: 'An outage stops card payments or appointments' },
  { id: 'voice', test: OFFICE, why: 'A front desk answers calls all day' },
  { id: 'voice', test: WAITING, why: 'Customers call to book or ask about their order' },
  { id: 'voice', test: /\b(restaurant|pizza|pizzeria|grill|diner|cafe|café|bakery|deli|wings|tacos?|bbq|catering|bar|pub)\b/i, why: 'Takeout and reservation calls tie up the line' },
  { id: 'static_ip', test: CAMERAS_REMOTE, why: 'Cameras or office software they log into remotely' },
  { id: 'connect', test: OFFICE, why: 'Several people share the phones and need them on a cell too' },
  { id: 'connect', test: CREW, why: 'Dispatch has to reach the crew and forward calls to the field' },
];

const PRODUCTS: Record<ProductId, Omit<DealProduct, 'why' | 'ask' | 'followUps'>> = {
  internet: { id: 'internet', label: 'Business Internet', weight: 16 },
  mobile: { id: 'mobile', label: 'Mobile lines', weight: 26 },
  voice: { id: 'voice', label: 'Business Voice', weight: 12 },
  tv: { id: 'tv', label: 'Business TV', weight: 12 },
  wifi: { id: 'wifi', label: 'Advanced Wi-Fi', weight: 8 },
  backup: { id: 'backup', label: 'Internet backup', weight: 8 },
  static_ip: { id: 'static_ip', label: 'Static IP', weight: 6 },
  connect: { id: 'connect', label: 'Business Connect', weight: 8 },
};

const ORDER: ProductId[] = ['internet', 'mobile', 'voice', 'tv', 'wifi', 'backup', 'static_ip', 'connect'];

const BEST_TIMES: [RegExp, string][] = [
  [CREW, '7–8:30 AM before trucks roll, or after 4 PM when they are back'],
  [/\b(restaurant|cafe|café|diner|grill|pizza|bar|pub|brewery|bakery|deli)\b/i, '2–4:30 PM, between lunch and dinner'],
  [/\b(barber|salon|nail|spa)\b/i, 'Tuesday–Wednesday mornings, the slowest chairs of the week'],
  [/\b(auto repair|tire|mechanic|body shop|collision)\b/i, '8–9 AM or 1–2 PM, when the bays are loaded'],
  [/\b(dental|dentist|chiropract|clinic|veterinar|optometr|medical|therap)\b/i, '12–1 PM, or the first 15 minutes after opening'],
  [/\b(law|attorney|cpa|accounting|tax|insurance|realty|real estate|mortgage)\b/i, '8:30–10 AM, before meetings stack up'],
  [/\b(hotel|motel|inn|lodge|cabin|bed (?:and|&) breakfast|b&b)\b/i, '10 AM–1 PM, after checkout and before check-in'],
];

const DSL = /xDSL|ADSL|VDSL|copper/i;
const FIBER = /fiber/i;

export function dealPlan(card: SwarmProspect): DealPlan {
  const lane = laneVerdict(card);
  const p = card.business;
  const described = `${p.name} ${p.publicNotes ?? ''}`;
  // Listing categories are often wrong ("Doctor's Fork Baptist Church" filed as Medical & dental).
  const blob = NEEDS.some(need => need.test.test(described)) ? described : `${described} ${p.category}`;
  const reasons = new Map<ProductId, string>([['internet', 'Every account starts here']]);
  for (const need of NEEDS) if (!reasons.has(need.id) && need.test.test(blob)) reasons.set(need.id, need.why);

  const home = homeBasedVerdict(p).homeBased;
  if (home && !reasons.has('mobile')) reasons.set('mobile', 'Runs from home, so the owner is on a cell all day');
  if (!reasons.has('mobile')) reasons.set('mobile', 'The owner has a phone, and so do most of their staff');

  const profile = profileFor(blob);
  const context = { name: p.name, place: profile.place };
  const products = ORDER.filter(id => reasons.has(id)).map(id => { const [ask, ...followUps] = askFor(profile, id, context); return { ...PRODUCTS[id], why: reasons.get(id)!, ask, followUps }; });
  const drivers: DealDriver[] = [];
  const add = (label: string, good = true) => drivers.push({ label, good });
  let score = products.reduce((sum, item) => sum + item.weight, 0);
  if (CREW.test(blob)) add('Field crew: several mobile lines on one account');
  if (home) add('Looks home-based: most reps skip these');

  const observations = card.broadband?.observations ?? [];
  const spectrum = observations.some(o => isSpectrumProvider(o.provider));
  const rivals = observations.filter(o => !isSpectrumProvider(o.provider) && !/satellite|fixed wireless/i.test(o.technology));
  if (spectrum && rivals.length && rivals.every(o => DSL.test(o.technology))) { score += 14; add('Only DSL competition reported: speed sells itself'); }
  else if (spectrum && !rivals.length) { score += 10; add('No other wired provider reported'); }
  else if (rivals.some(o => FIBER.test(o.technology))) { score -= 8; add('Fiber competitor reported: lead with the bundle, not speed', false); }
  if (card.broadbandChecked && observations.length && !spectrum) { score -= 25; add('Spectrum not reported here. Confirm serviceability first', false); }

  if (p.reviewCount != null && p.reviewCount <= 5) { score += 6; add('Almost no reviews: may be new and still setting up service'); }
  if (digits(p.phone)) score += 4;
  if (lane.status === 'check') score -= 10;

  const bestTime = BEST_TIMES.find(([pattern]) => pattern.test(blob))?.[1] ?? null;
  // Facts from the listing change what a good opening sounds like.
  const opening = profile.open.map(question => fill(question, context));
  if (home) opening.push('Do you run this out of your home?');
  else if ((p.locationCount ?? 1) > 1) opening.push(`Are all ${p.locationCount} locations on one account?`);
  else if (p.reviewCount != null && p.reviewCount <= 5) opening.push('How long have you been open?');
  const discovery: DiscoveryScript = { kind: profile.label, opening: opening.slice(-3), gatekeeper: profile.gatekeeper, closing: CLOSING };
  return { lane, products, discovery, score: lane.status === 'out' ? 0 : Math.max(1, Math.min(100, Math.round(score))), drivers, bestTime };
}

function digits(value?: string | null) { return (value ?? '').replace(/\D/g, ''); }

/** Out-of-lane last, then the biggest likely deal first. */
export function compareDeals(a: SwarmProspect, b: SwarmProspect) {
  const da = dealPlan(a), db = dealPlan(b);
  return Number(da.lane.status === 'out') - Number(db.lane.status === 'out') || db.score - da.score;
}

export function dealQuestions(plan: DealPlan) {
  const { discovery } = plan;
  const list = (items: string[]) => items.map((item, index) => `${index + 1}. ${item}`).join('\n');
  const products = plan.products.map((item, index) => `${index + 1}. ${item.label}: ${item.ask}${item.followUps.map(followUp => `\n   Then: ${followUp}`).join('')}`).join('\n');
  return [`Open with:\n${list(discovery.opening)}`, `Then uncover:\n${products}`, `Before you hang up:\n${list(discovery.closing)}`].join('\n\n');
}
