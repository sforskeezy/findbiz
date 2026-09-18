import type { SwarmProspect } from './types';
export type TerritoryReview = { key: string; reviewedAt: string | null; prospectIds: string[] };
export function territoryProspectKey(card: SwarmProspect) {
  return `${card.business.name}|${card.business.address}`.toLowerCase().replace(/[^a-z0-9|]/g, '');
}
export function clusterReview(cards: SwarmProspect[], review?: TerritoryReview) {
  const newCount = review?.reviewedAt ? cards.filter(card => !review.prospectIds.includes(territoryProspectKey(card))).length : 0;
  return { reviewed: Boolean(review?.reviewedAt), newCount };
}
export function clusterName(cards: SwarmProspect[]) {
  const streets = new Map<string, number>();
  for (const { business } of cards) {
    const first = business.address.split(',')[0];
    const street = first.replace(/^\d+[\w-]*\s+/, '').trim();
    if (/^\d/.test(first) && street && !/address (?:not|unavailable)/i.test(street)) streets.set(street, (streets.get(street) ?? 0) + 1);
  }
  return [...streets].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? (cards[0] ? `${cards[0].business.name} area` : 'Unmapped businesses');
}
