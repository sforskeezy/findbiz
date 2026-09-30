import type { ProductId } from '@/lib/swarm/deal-plan';

/**
 * Spectrum Business promotions shown in the profile's Promotions tab.
 * Offers change often: update `PROMOTIONS_VERIFIED` whenever this list is re-checked.
 */
export const PROMOTIONS_VERIFIED = 'September 29–30, 2026';

export type Bundle = { name: string; price: number; term: string; products: ProductId[] };
export type Promotion = { title: string; detail: string; requirements: string[]; products: ProductId[] };
export type DeviceOffer = { device: string; offer: string; note: string; sourceLabel: string; sourceUrl: string };

export const BUNDLES: Bundle[] = [
  { name: '500 Mbps Internet + Mobile', price: 50, term: '1 year', products: ['internet', 'mobile'] },
  { name: '500 Mbps Internet + Business Phone', price: 70, term: '1 year', products: ['internet', 'voice'] },
  { name: '500 Mbps Internet + Phone + TV Local+', price: 100, term: '1 year', products: ['internet', 'voice', 'tv'] },
  { name: 'Gig Internet + Mobile', price: 100, term: '1 year', products: ['internet', 'mobile', 'wifi'] },
  { name: 'Gig Internet + Business Phone', price: 120, term: '2 years', products: ['internet', 'voice'] },
  { name: 'Gig Internet + Phone + TV Local+', price: 150, term: '3 years', products: ['internet', 'voice', 'tv'] },
];

export const PROMOTIONS: Promotion[] = [
  {
    title: 'Free Internet for life with four mobile lines',
    detail: 'Buy four qualifying Business Unlimited Mobile lines, port at least two numbers, and keep all four lines.',
    requirements: ['Same-day ordering', 'AutoPay', 'Advanced WiFi excluded'],
    products: ['mobile', 'internet'],
  },
  {
    title: 'One Unlimited Mobile line free for 12 months',
    detail: 'Available with qualifying Business Internet service.',
    requirements: ['One promotional line per account', 'Existing mobile lines and tablets excluded'],
    products: ['mobile'],
  },
  {
    title: 'Save $25/month on Internet by bundling',
    detail: 'The bundle builder applies this when any two of Business Phone, paid Unlimited Mobile or Business TV Entertainment are added.',
    requirements: ['Any two listed services'],
    products: ['internet', 'voice', 'mobile', 'tv'],
  },
  {
    title: 'Free installation with Gig Internet + Mobile',
    detail: 'The $100/month bundle also includes Advanced WiFi, Security Shield and Guest WiFi.',
    requirements: ['Gig Internet + Mobile bundle'],
    products: ['internet', 'mobile', 'wifi'],
  },
  {
    title: '500 Mbps Internet for $50/month for one year, no bundle',
    detail: 'Advertised as an online exclusive.',
    requirements: ['Qualifying areas only', 'Online order'],
    products: ['internet'],
  },
  {
    title: 'Home office: $40/month Internet, one month free, free installation',
    detail: 'The 500 Mbps price lasts one year.',
    requirements: ['Bundle two or more services'],
    products: ['internet', 'connect'],
  },
  {
    title: 'Business contract buyout up to $1,000',
    detail: 'Covers the previous provider’s early termination charges.',
    requirements: ['Two or more qualifying non-mobile services', 'Proof of early termination charges'],
    products: ['internet', 'voice', 'tv'],
  },
  {
    title: 'Mobile phone-balance buyout up to $10,000',
    detail: 'Up to $500 per ported line toward eligible remaining device balances.',
    requirements: ['2–20 mobile lines, at least two ported', 'Business Internet', '12-month qualifying-line commitment'],
    products: ['mobile'],
  },
];

/** Published Spectrum Mobile device offers. These are consumer listings; business eligibility must be confirmed. */
export const DEVICE_OFFERS: DeviceOffer[] = [
  { device: 'iPhone 18 Pro, iPhone 18 Pro Max, iPhone Duo', offer: '$240 off with eligible trade-in', note: 'Plus $360 in monthly device credits on Unlimited Plus Premium ($600 total). iPhone Duo pre-orders open October 16.', sourceLabel: 'Charter newsroom · Sept 18, 2026', sourceUrl: 'https://corporate.charter.com/newsroom/apple-iphone-18-lineup-lands-at-spectrum' },
  { device: 'Samsung Galaxy S26+', offer: '$500 off', note: 'Trade-in required.', sourceLabel: 'Spectrum Mobile phone deals', sourceUrl: 'https://www.spectrum.com/mobile/products/phones/phone-deals' },
  { device: 'iPhone 17', offer: '$200 off', note: 'Eligible trade-in required.', sourceLabel: 'Spectrum Mobile phone deals', sourceUrl: 'https://www.spectrum.com/mobile/products/phones/phone-deals' },
  { device: 'Motorola moto g stylus (2026)', offer: '$10/month', note: 'Extra $100 off with eligible trade-in.', sourceLabel: 'Spectrum Mobile phone deals', sourceUrl: 'https://www.spectrum.com/mobile/products/phones/phone-deals' },
];

export const TRADE_IN_TERMS = 'Trade-in bonuses are paid as bill credits over 36 months on a 36-month device payment plan, one offer per line, tablets excluded. Cancelling, upgrading early or changing plans forfeits the remaining credits.';
export const BUSINESS_TRADE_IN_URL = 'https://www.spectrum.com/business/mobile/trade-in';

/**
 * Marks offers for the business's top needs. Every offer includes Internet, so a
 * bundle fits only when it covers all top needs, and a promotion fits only when it
 * targets a need beyond Internet (or Internet is the only need).
 */
export function promotionFit(needs: ProductId[]) {
  const top = needs.slice(0, 2);
  const specific: ProductId[] = top.filter((id) => id !== 'internet');
  const covering = BUNDLES.filter((bundle) => top.every((id) => bundle.products.includes(id)));
  const fitting = !top.length ? [] : covering.length ? covering : BUNDLES.filter((bundle) => bundle.products.some((id) => specific.includes(id)));
  // A mark on every card tells the rep nothing.
  const marked = fitting.length < BUNDLES.length ? fitting : [];
  const promotionFits = (promotion: Promotion) => specific.length > 0 && promotion.products.some((id) => specific.includes(id));
  return {
    bundles: BUNDLES.map((bundle) => ({ ...bundle, fit: marked.includes(bundle) })),
    promotions: PROMOTIONS.map((promotion) => ({ ...promotion, fit: promotionFits(promotion) })),
    topBundle: [...fitting].sort((a, b) => a.price - b.price)[0] ?? null,
  };
}
