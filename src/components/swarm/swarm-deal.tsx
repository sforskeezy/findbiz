"use client";
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Ban, Check, ChevronDown, Clock3, Copy, CornerDownRight, ListChecks, NotebookPen, TriangleAlert } from 'lucide-react';
import { Card } from '@/components/swarm/swarm-research';
import { dealQuestions, type DealPlan } from '@/lib/swarm/deal-plan';
import './swarm-deal.css';

/** A short, reason-specific note on where an out-of-lane account actually belongs. */
function routingNote(reason: string) {
  if (/chain|enterprise|locations/i.test(reason)) return 'Corporate-owned. Route to your enterprise or national accounts team.';
  if (/government|agency/i.test(reason)) return 'Public sector. Route through your government accounts team.';
  if (/school|college|university/i.test(reason)) return 'Education account. Route through E-Rate or your public-sector team.';
  if (/hospital|care facility/i.test(reason)) return 'Health system account. Route through enterprise healthcare.';
  if (/housing/i.test(reason)) return 'Multi-unit housing. Route through MDU or bulk agreements.';
  if (/venue/i.test(reason)) return 'Large venue. Likely an existing enterprise contract.';
  return 'Not a fit for local outreach.';
}

export function DealCard({ plan, logToNotes, notify }: { plan: DealPlan; logToNotes: (line: string) => void; notify: (message: string) => void }) {
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [showDetail, setShowDetail] = useState(false);
  const out = plan.lane.status === 'out';
  const { discovery } = plan;
  function toggle(id: string) { setAsked(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function copy() {
    try { await navigator.clipboard.writeText(dealQuestions(plan)); notify('Game plan copied'); }
    catch { notify('Clipboard unavailable in this browser.'); }
  }
  function log() {
    const labels = plan.products.filter(item => asked.has(item.id)).map(item => item.label);
    logToNotes(`Asked about: ${labels.join(', ')}`);
  }
  function toggleDetail() {
    const next = !showDetail;
    setShowDetail(next);
    notify(next ? 'Out of lane — reason and routing below' : 'Details collapsed');
  }

  return <Card className={`spd ${plan.lane.status}`}>
    <div className="spx-card-head">
      <h3><ListChecks size={15}/>Game plan</h3>
      {!out && <span className="spd-kind">{discovery.kind}</span>}
    </div>

    {plan.lane.status !== 'clear' && <div
      className={`spd-lane ${out ? 'clickable' : ''}`}
      role={out ? 'button' : 'alert'}
      tabIndex={out ? 0 : undefined}
      aria-expanded={out ? showDetail : undefined}
      onClick={out ? toggleDetail : undefined}
      onKeyDown={out ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleDetail(); } } : undefined}
    >
      {out ? <Ban size={15}/> : <TriangleAlert size={15}/>}
      <div className="spd-lane-body">
        <div className="spd-lane-top">
          <strong>{out ? 'Out of your lane' : 'Check before you pitch'}</strong>
          {out && <motion.span animate={{ rotate: showDetail ? 180 : 0 }} transition={{ duration: .18 }}><ChevronDown size={14}/></motion.span>}
        </div>
        {out ? <p className="spd-lane-sub">Not a fit for a local SMB pitch</p> : <ul>{plan.lane.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}

        {out && <AnimatePresence initial={false}>
          {showDetail && <motion.div className="spd-detail" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: .18, ease: 'easeInOut' }}>
            <div className="spd-detail-inner">
              {plan.lane.reasons.map(reason => <div key={reason} className="spd-detail-row"><span>Reason</span><b>{reason}</b></div>)}
              <div className="spd-detail-row"><span>Routing</span><b>{routingNote(plan.lane.reasons[0] ?? '')}</b></div>
            </div>
          </motion.div>}
        </AnimatePresence>}
      </div>
    </div>}

    {!out && <>
      <h4 className="spd-step">Get them talking</h4>
      <ul className="spd-open">{discovery.opening.map(question => <li key={question}>{question}</li>)}</ul>

      <h4 className="spd-step">Find the need</h4>
      <ol className="spd-products">{plan.products.map(item => {
        const on = asked.has(item.id);
        return <li key={item.id} className={on ? 'on' : undefined}>
          <button type="button" aria-pressed={on} onClick={() => toggle(item.id)} aria-label={`${on ? 'Unmark' : 'Mark'} ${item.label} as asked`}>{on && <Check size={12} strokeWidth={3}/>}</button>
          <div>
            <p className="spd-q">{item.ask}</p>
            {item.followUps.map(followUp => <p key={followUp} className="spd-follow"><CornerDownRight size={12}/>{followUp}</p>)}
            <small>{item.label}</small>
          </div>
        </li>;
      })}</ol>

      <h4 className="spd-step">Before you hang up</h4>
      <ul className="spd-open">{discovery.closing.map(question => <li key={question}>{question}</li>)}</ul>

      {(plan.bestTime || plan.drivers.length > 0) && <div className="spd-drivers">
        {plan.bestTime && <span className="time"><Clock3 size={12}/>Best time: {plan.bestTime}</span>}
        {plan.drivers.map(driver => <span key={driver.label} className={driver.good ? undefined : 'warn'}>{driver.label}</span>)}
      </div>}
      <div className="spd-actions">
        <button type="button" onClick={() => void copy()}><Copy size={13}/>Copy</button>
        <button type="button" disabled={!asked.size} onClick={log}><NotebookPen size={13}/>{asked.size ? `Add ${asked.size} asked to notes` : 'Add asked to notes'}</button>
      </div>
    </>}
  </Card>;
}
