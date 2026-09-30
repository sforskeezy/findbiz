"use client";
import { Check, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/swarm/swarm-research';
import type { DealPlan } from '@/lib/swarm/deal-plan';
import type { SwarmProspect } from '@/lib/swarm/types';
import './swarm-fit.css';

function verdict(rank: number, lane: DealPlan['lane']['status']) {
  // An out-of-lane account never reads as a fit, no matter how the old prospecting rank scored it.
  if (lane === 'out') return { label: 'Out of your lane', tone: 'out' };
  if (rank >= 75) return { label: 'Strong fit', tone: 'high' };
  if (rank >= 55) return { label: 'Good fit', tone: 'good' };
  if (rank >= 35) return { label: 'Fair fit', tone: 'fair' };
  return { label: 'Weak fit', tone: 'weak' };
}

/** A few plain-language reasons, warnings first because they change whether to call. */
function reasons(card: SwarmProspect, plan: DealPlan) {
  const p = card.business;
  const warn: string[] = [], good: string[] = [];
  if (plan.lane.status === 'out') warn.push('Outside your lane');
  if (/chain/i.test(card.reasons.join(' ')) && !card.reasons.some(r => /^not matched/i.test(r))) warn.push('National chain');
  if (p.operatingStatus === 'Temporarily closed') warn.push('Listed as temporarily closed');
  const caution = plan.drivers.find(driver => !driver.good);
  if (caution) warn.push(caution.label.split(/[.:]/)[0]);
  if (p.phone) good.push('Has a listed phone');
  if (card.reasons.some(r => /^not matched/i.test(r))) good.push('Independent, not a chain');
  if (Number.isFinite(p.distanceMiles) && p.distanceMiles <= 1) good.push(`Close by, ${p.distanceMiles.toFixed(1)} mi`);
  if (p.website) good.push('Has a website to research');
  return [...warn.map(text => ({ text, good: false })), ...good.map(text => ({ text, good: true }))].slice(0, 3);
}

/** A beaded dash pattern (using `pathLength` so units are percent, not pixels) that fills
 *  proportionally with dots instead of one solid arc — a string of beads up to `rank`, then
 *  one long gap for the rest, so the ring reads as segmented rather than a plain progress bar. */
function beadedArc(rank: number, bead = 2.4, gap = 5.2) {
  const filled = Math.max(0, Math.min(100, rank));
  if (filled <= 0) return '0 100';
  const unit = bead + gap;
  const values: number[] = [];
  let used = 0;
  while (used + unit <= filled) { values.push(bead, gap); used += unit; }
  const remainder = filled - used;
  if (remainder > 0.4) values.push(remainder, 0);
  values.push(100 - filled);
  return values.join(' ');
}

export function FitCard({ card, plan }: { card: SwarmProspect; plan: DealPlan }) {
  const { label, tone } = verdict(card.rank, plan.lane.status);
  return <Card className={`spf ${tone}`}>
    <div className="spf-top">
      <div className="spf-ring" role="img" aria-label={`Prospecting fit ${card.rank} out of 100`}>
        <svg viewBox="0 0 72 72"><circle cx="36" cy="36" r="30" pathLength={100}/><circle cx="36" cy="36" r="30" pathLength={100} className="bar" strokeDasharray={beadedArc(card.rank)}/></svg>
        <strong>{card.rank}</strong>
      </div>
      <div><small>Prospecting fit</small><h3>{label}</h3></div>
    </div>
    <ul className="spf-list">{reasons(card, plan).map(item => <li key={item.text} className={item.good ? undefined : 'warn'}>{item.good ? <Check size={13} strokeWidth={2.5}/> : <TriangleAlert size={13}/>}{item.text}</li>)}</ul>
  </Card>;
}
