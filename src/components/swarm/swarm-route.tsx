"use client";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { ArrowUpRight, Copy, MapPin, Route, X } from "lucide-react";
import { CopyContact } from '@/components/swarm/copy-contact';
import { digits } from '@/lib/swarm/lead-book';
import { SwarmDialog } from "@/components/swarm/swarm-dialog";
import { SwarmMap } from "@/components/swarm/swarm-map";
import { buildRoute, routeLinks, type RouteFocus } from "@/lib/swarm/route-plan";
import { distanceMiles } from "@/lib/place-candidate";
import type { SwarmBatch, SwarmProspect } from "@/lib/swarm/types";

export function SwarmRoute({ batch, cards, selected, close, inspect }: { batch: SwarmBatch; cards: SwarmProspect[]; selected: boolean; close: () => void; inspect: (id: string) => void }) {
  const starts = batch.addresses.filter((a) => a.coordinates && Number.isFinite(a.coordinates.lat) && Number.isFinite(a.coordinates.lng));
  const [startId, setStartId] = useState(starts[0]?.id ?? '');
  const [count, setCount] = useState(8);
  const [focus, setFocus] = useState<RouteFocus>('balanced');
  const [copied, setCopied] = useState('');
  const start = starts.find((a) => a.id === startId) ?? starts[0];
  const eligible = useMemo(() => selected ? cards : cards.filter((card) => card.business.operatingStatus !== 'Temporarily closed'), [cards, selected]);
  const plan = start?.coordinates ? buildRoute(eligible, start.coordinates, count, focus) : { stops: [], miles: 0, omitted: 0 };
  const links = routeLinks(plan.stops, start?.text ?? '');
  async function copy() {
    const text = [`FindBiz route · ${batch.title}`, `Start: ${start?.text}`, `${plan.stops.length} stops · ${plan.miles.toFixed(1)} miles straight-line (not driving distance)`, '', ...plan.stops.map((p, i) => `${i + 1}. ${p.business.name}\n${p.business.address}\n${digits(p.business.phone) || 'No listed phone'} · Rank ${p.rank}/100`), '', ...links.map((part) => `${part.label}: ${part.url}`)].join('\n');
    try { await navigator.clipboard.writeText(text); setCopied('Route copied'); } catch { setCopied('Clipboard unavailable in this browser.'); }
  }
  return <SwarmDialog label="Route builder" close={close} className="sw-route-modal">
    <header className="sw-route-header"><div className="sw-modal-topline"><span><Route size={15}/> Territory tools</span><button className="sw-icon" aria-label="Close route builder" onClick={close}><X size={20}/></button></div><h2>Make your next stops count.</h2><p>{selected ? `Build a route from your ${cards.length} selected prospects.` : 'Turn this prospect pool into a focused route through the territory.'}</p><div className="sw-route-controls"><label>Start from<select value={start?.id ?? ''} onChange={(e) => setStartId(e.target.value)}>{starts.map((a) => <option key={a.id} value={a.id}>{a.text}</option>)}</select></label><label>Stops<select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[4, 8, 12].map((n) => <option key={n} value={n}>Up to {n}</option>)}</select></label><label>Prioritize<select value={focus} onChange={(e) => setFocus(e.target.value as RouteFocus)}><option value="balanced">Quality + distance</option><option value="priority">Prospect quality</option><option value="nearby">Shorter hops</option></select></label></div></header>
    {start && plan.stops.length ? <div className="sw-route-body"><div className="sw-route-list"><div className="sw-route-summary"><span><strong>{plan.stops.length}</strong> stops</span><span><strong>{plan.stops.filter((p) => p.opportunity === 'high').length}</strong> high priority</span><span><strong>{plan.miles.toFixed(1)}</strong> mi straight-line</span></div><div className="sw-route-start"><MapPin size={14}/><span>Start · {start.text}</span></div>{plan.stops.map((p, i) => <motion.div layout="position" className="sw-route-stop" key={p.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .2, delay: i * .025 }}><span className="sw-stop-number">{i + 1}</span><div><button className="sw-route-business" onClick={() => inspect(p.id)}>{p.business.name}<ArrowUpRight size={12}/></button><CopyContact value={p.business.address} label="address"/><small>{distanceMiles(i ? plan.stops[i - 1].business.coordinates : start.coordinates!, p.business.coordinates).toFixed(1)} mi from {i ? 'previous stop' : 'start'} · {p.rank}/100 rank</small>{p.business.operatingStatus === 'Temporarily closed' && <small>Listed temporarily closed — check before visiting.</small>}</div><span className={`sw-route-dot ${p.opportunity}`} title={p.opportunity === 'high' ? 'High priority' : 'Review'}/></motion.div>)}</div><div className="sw-route-map"><SwarmMap prospects={plan.stops} batchId={`${batch.id}:${start.id}:${count}:${focus}:${plan.stops.map(p=>p.id).join(',')}`} onSelect={inspect} numbered origin={start.coordinates!}/><p>Preview connects stops in order. Maps calculates the driving directions.</p>{plan.omitted > 0 && <p>{plan.omitted} prospects have no usable map location.</p>}</div></div> : <div className="sw-empty">A route needs discovered prospects and a geocoded starting address.</div>}
    <footer className="sw-modal-footer sw-route-footer"><span role="status">{copied || 'Navigation opens in sections of up to four stops.'}</span><div><button className="sw-secondary" disabled={!plan.stops.length} onClick={() => void copy()}><Copy size={14}/>Copy route</button>{links.map((part) => <a className="sw-route-navigation" key={part.label} href={part.url} target="_blank" rel="noreferrer"><Route size={14}/>{part.label}<ArrowUpRight size={12}/></a>)}</div></footer>
  </SwarmDialog>;
}
