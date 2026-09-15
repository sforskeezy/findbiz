import { distanceMiles } from "@/lib/place-candidate";
import type { Coordinates } from "@/lib/types";
import type { SwarmProspect } from "@/lib/swarm/types";

export type RouteFocus = 'balanced' | 'priority' | 'nearby';
const valid = (p: Coordinates) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
export function routeDistance(stops: SwarmProspect[], origin: Coordinates) {
  return stops.reduce((miles, stop, i) => miles + distanceMiles(i ? stops[i - 1].business.coordinates : origin, stop.business.coordinates), 0);
}
/** A quality/distance shortlist, followed by a bounded 2-opt pass to reduce backtracking. */
export function buildRoute(cards: SwarmProspect[], origin: Coordinates, count = 8, focus: RouteFocus = 'balanced') {
  if (!valid(origin)) return { stops: [], miles: 0, omitted: cards.length };
  const pool = [...new Map(cards.filter((p) => valid(p.business.coordinates)).map((p) => [p.id, p])).values()];
  const omitted = cards.length - pool.length;
  const power = focus === 'priority' ? .3 : focus === 'nearby' ? 1.25 : .7;
  const stops: SwarmProspect[] = [];
  let current = origin;
  const limit = Math.min(12, Math.max(1, Math.floor(count)));
  while (pool.length && stops.length < limit) {
    pool.sort((a, b) => {
      const utility = (p: SwarmProspect) => (Math.max(1, p.rank) + 20) / Math.pow(1 + distanceMiles(current, p.business.coordinates), power);
      return utility(b) - utility(a) || a.id.localeCompare(b.id);
    });
    const next = pool.shift()!;
    stops.push(next); current = next.business.coordinates;
  }
  for (let pass = 0; pass < 6; pass++) {
    let improved = false;
    for (let from = 0; from < stops.length - 1; from++) {
      for (let to = from + 1; to < stops.length; to++) {
        const candidate = [...stops.slice(0, from), ...stops.slice(from, to + 1).reverse(), ...stops.slice(to + 1)];
        if (routeDistance(candidate, origin) + .00001 < routeDistance(stops, origin)) { stops.splice(0, stops.length, ...candidate); improved = true; }
      }
    }
    if (!improved) break;
  }
  return { stops, miles: routeDistance(stops, origin), omitted };
}

/** At most three waypoints per link, including mobile browsers. */
export function routeLinks(stops: SwarmProspect[], origin: string) {
  const parts: Array<{ label: string; url: string }> = [];
  for (let i = 0; i < stops.length; i += 4) {
    const group = stops.slice(i, i + 4);
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1'); url.searchParams.set('travelmode', 'driving');
    url.searchParams.set('origin', i ? stops[i - 1].business.address : origin);
    url.searchParams.set('destination', group.at(-1)!.business.address);
    if (group.length > 1) url.searchParams.set('waypoints', group.slice(0, -1).map((p) => p.business.address).join('|'));
    parts.push({ label: `Stops ${i + 1}–${i + group.length}`, url: url.href });
  }
  return parts;
}
