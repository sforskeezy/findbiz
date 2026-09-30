"use client";
import { motion } from 'motion/react';
import { ArrowUpRight, BadgePercent, Copy, Smartphone, Sparkles } from 'lucide-react';
import { Card, stagger } from '@/components/swarm/swarm-research';
import type { DealPlan } from '@/lib/swarm/deal-plan';
import { BUSINESS_TRADE_IN_URL, DEVICE_OFFERS, PROMOTIONS_VERIFIED, TRADE_IN_TERMS, promotionFit } from '@/lib/swarm/promotions';
import type { SwarmProspect } from '@/lib/swarm/types';
import './swarm-promotions.css';

export function PromotionsTab({ card, plan, notify }: { card: SwarmProspect; plan: DealPlan; notify: (message: string) => void }) {
  const inLane = plan.lane.status !== 'out';
  const { bundles, promotions, topBundle } = promotionFit(inLane ? plan.products.map((product) => product.id) : []);
  const needs = plan.products.slice(0, 2).map((product) => product.label.toLowerCase()).join(' and ');
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); notify('Offer copied'); } catch { notify('Clipboard unavailable in this browser.'); }
  }

  return <motion.div className="spp" variants={stagger} initial="hidden" animate="show">
    <Card className="spp-hero">
      <div><small>Spectrum Business promotions</small><h3>{topBundle ? <>Lead with <b>{topBundle.name}</b> at ${topBundle.price}/mo</> : 'Current offers'}</h3>
        <p>{topBundle && needs ? `${card.business.name} most likely needs ${needs}. Offers that fit are marked.` : inLane ? 'Offers that fit are marked once this business’s needs are known.' : 'This business is outside the small-business lane. Confirm eligibility before quoting.'}</p></div>
      <span className="spp-date">Verified {PROMOTIONS_VERIFIED}</span>
    </Card>

    <Card><div className="spx-card-head"><h3><BadgePercent size={15}/>Bundles</h3><small>{bundles.length}</small></div>
      <ul className="spp-bundles">{bundles.map((bundle) => <li key={bundle.name} className={bundle.fit ? 'fit' : ''}>
        {bundle.fit && <em><Sparkles size={11}/>Fits</em>}
        <strong>{bundle.name}</strong>
        <span><b>${bundle.price}</b>/mo · {bundle.term}</span>
        <button type="button" aria-label={`Copy ${bundle.name}`} onClick={() => void copy(`${bundle.name}: $${bundle.price}/mo for ${bundle.term}`)}><Copy size={12}/></button>
      </li>)}</ul>
    </Card>

    <Card><div className="spx-card-head"><h3>Promotions and discounts</h3><small>{promotions.length}</small></div>
      <ol className="spp-offers">{promotions.map((promotion) => <li key={promotion.title} className={promotion.fit ? 'fit' : ''}>
        <div><strong>{promotion.title}</strong>{promotion.fit && <em><Sparkles size={11}/>Fits</em>}</div>
        <p>{promotion.detail}</p>
        <span className="spp-reqs">{promotion.requirements.map((item) => <i key={item}>{item}</i>)}</span>
        <button type="button" aria-label={`Copy ${promotion.title}`} onClick={() => void copy(`${promotion.title}. ${promotion.detail} Requires: ${promotion.requirements.join('; ')}.`)}><Copy size={12}/></button>
      </li>)}</ol>
    </Card>

    <Card><div className="spx-card-head"><h3><Smartphone size={15}/>Device offers</h3><small>{DEVICE_OFFERS.length}</small></div>
      <p className="spp-caution">Published Spectrum Mobile consumer offers. Confirm business-account eligibility before quoting.</p>
      <ul className="spp-devices">{DEVICE_OFFERS.map((offer) => <li key={offer.device}>
        <div><strong>{offer.device}</strong><span>{offer.note}</span></div>
        <b>{offer.offer}</b>
        <a href={offer.sourceUrl} target="_blank" rel="noreferrer">{offer.sourceLabel}<ArrowUpRight size={11}/></a>
      </li>)}</ul>
      <p className="spx-fine">{TRADE_IN_TERMS} <a href={BUSINESS_TRADE_IN_URL} target="_blank" rel="noreferrer">Business trade-in details</a></p>
    </Card>
    <p className="spx-fine">Offers change often and vary by address. Confirm current pricing and eligibility before quoting a customer.</p>
  </motion.div>;
}
