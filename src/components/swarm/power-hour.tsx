"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { ArrowLeft, ArrowRight, BellRing, Check, Clock3, Copy, Flame, MapPin, Phone, PhoneMissed, Sparkles, ThumbsDown, ThumbsUp, UserRound, X, Zap } from 'lucide-react';
import { SwarmDialog } from '@/components/swarm/swarm-dialog';
import { displayPhone } from '@/components/swarm/funnel-ui';
import { hue, researchPeople } from '@/components/swarm/swarm-research';
import { compactBatchTitle } from '@/components/swarm/batch-list';
import { digits, draftLead, findLead, type LeadEdits, type LeadRecord } from '@/lib/swarm/lead-book';
import { activityFor, callbackChoices, callNote, hoursToday, OUTCOME_LABEL, powerQueue, sessionRecap, sessionStats, type CallOutcome, type QueueItem, type SessionEntry } from '@/lib/swarm/power-hour';
import type { DealPlan } from '@/lib/swarm/deal-plan';
import type { SwarmBatch, SwarmProspect } from '@/lib/swarm/types';
import './power-hour.css';

const REASON: Record<QueueItem['reason'], string> = { callback_due: 'Callback due', fresh: 'Not called yet', retry: 'Try again' };
const OUTCOMES: { id: CallOutcome; key: string; label: string; Icon: typeof Phone }[] = [
  { id: 'no_answer', key: '1', label: 'No answer', Icon: PhoneMissed },
  { id: 'callback', key: '2', label: 'Call back', Icon: BellRing },
  { id: 'interested', key: '3', label: 'Interested', Icon: ThumbsUp },
  { id: 'not_interested', key: '4', label: 'Not interested', Icon: ThumbsDown },
];
const NOTE_LIMIT = 20000;

function clock(ms: number) {
  const total = Math.floor(ms / 1000), h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return `${h ? `${h}:` : ''}${String(m).padStart(h ? 2 : 1, '0')}:${String(s).padStart(2, '0')}`;
}

function askFor(card: SwarmProspect, record?: LeadRecord) {
  const people = researchPeople(card);
  return record?.contactName || card.intelligence?.brief?.askFor || people[0]?.name || draftLead(card).contactName || '';
}

function Counter({ value }: { value: number }) {
  const reduced = useReducedMotion();
  const count = useMotionValue(reduced ? value : 0);
  const shown = useTransform(count, latest => Math.round(latest).toLocaleString());
  useEffect(() => { const controls = animate(count, value, { duration: reduced ? 0 : .9, ease: [.16, 1, .3, 1] }); return () => controls.stop(); }, [count, value, reduced]);
  return <motion.span>{shown}</motion.span>;
}

function ScoreRing({ score }: { score: number }) {
  const r = 22, c = 2 * Math.PI * r;
  return <div className="ph-ring" title={`Deal score ${score}/100`} aria-label={`Deal score ${score} of 100`}>
    <svg viewBox="0 0 52 52" aria-hidden><circle cx="26" cy="26" r={r} className="track"/><motion.circle cx="26" cy="26" r={r} className="fill" strokeDasharray={c} initial={{ strokeDashoffset: c }} animate={{ strokeDashoffset: c * (1 - score / 100) }} transition={{ duration: .8, ease: [.16, 1, .3, 1] }}/></svg>
    <b>{score}</b>
  </div>;
}

export function PowerHour({ batch, cards, records, plans, save, toFunnel, inFunnel, close }: {
  batch: SwarmBatch; cards: SwarmProspect[]; records: LeadRecord[]; plans: Map<string, DealPlan>;
  save: (card: SwarmProspect, disposition: LeadRecord['disposition'], edits: LeadEdits) => Promise<unknown>;
  toFunnel: (card: SwarmProspect, edits: { contactName: string; notes: string }) => Promise<void>;
  inFunnel: (card: SwarmProspect) => boolean;
  close: () => void;
}) {
  // The order is fixed when the session starts, so logging a call never reshuffles the line.
  const [queue] = useState(() => powerQueue(cards, records, plans));
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [log, setLog] = useState<SessionEntry[]>([]);
  const [note, setNote] = useState('');
  const [picker, setPicker] = useState(false);
  const [finished, setFinished] = useState(false);
  const [flash, setFlash] = useState<{ outcome: CallOutcome; key: number } | null>(null);
  const [failed, setFailed] = useState<{ id: string; name: string; retry: () => Promise<void> }[]>([]);
  const [copied, setCopied] = useState('');
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const callRef = useRef<HTMLAnchorElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(''), 1400); return () => clearTimeout(timer); }, [copied]);

  const item = queue[index];
  const card = item?.card;
  const record = card ? findLead(records, card) : undefined;
  const plan = card ? plans.get(card.id) : undefined;
  const contact = card ? askFor(card, record) : '';
  const phone = card ? digits(card.business.phone) : '';
  const today = card ? hoursToday(card.business.hours) : null;
  const stats = sessionStats(log, startedAt, now);
  const logged = new Map(log.map(entry => [entry.id, entry]));
  const lastNote = record?.notes.split('\n').map(line => line.trim()).filter(Boolean).at(-1);
  const choices = useMemo(() => callbackChoices(new Date(now)), [now]);
  const streak = useMemo(() => { let n = 0; for (let i = log.length - 1; i >= 0 && log[i].outcome !== 'no_answer'; i--) n++; return n; }, [log]);

  function go(delta: number) {
    setPicker(false); setNote(''); setDirection(delta);
    const next = index + delta;
    if (next >= queue.length) { setIndex(queue.length); setFinished(true); return; }
    setIndex(Math.max(0, next));
  }

  function logCall(outcome: CallOutcome, callbackAt?: Date) {
    if (!card) return;
    const at = new Date();
    const base = record?.notes ?? draftLead(card).notes;
    const notes = [base, callNote(outcome, at, note, callbackAt)].filter(Boolean).join('\n').slice(-NOTE_LIMIT);
    const edits = { contactName: contact.slice(0, 200), notes };
    const disposition: LeadRecord['disposition'] = outcome === 'callback' || outcome === 'interested' ? 'saved' : record?.disposition ?? 'active';
    const target = card, name = card.business.name;
    const run = async () => {
      await save(target, disposition, { ...edits, activity: activityFor(outcome, at, callbackAt) });
      if (outcome === 'interested' && !inFunnel(target)) await toFunnel(target, edits);
    };
    const attempt = () => run().then(() => setFailed(old => old.filter(f => f.id !== target.id))).catch(() => setFailed(old => [...old.filter(f => f.id !== target.id), { id: target.id, name, retry: attempt }]));
    void attempt();
    setLog(old => [...old.filter(entry => entry.id !== target.id), { id: target.id, name, outcome, at: at.getTime(), callbackAt: callbackAt?.toISOString() }]);
    setFlash({ outcome, key: at.getTime() });
    go(1);
  }

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); } catch { /* Clipboard is optional. */ }
  }

  function requestClose() { if (!finished && log.length) setFinished(true); else close(); }

  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
      if (typing) { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); (event.target as HTMLElement).blur(); } return; }
      if (finished || !card) return;
      if (picker) {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPicker(false); return; }
        const choice = choices[Number(event.key) - 1];
        if (choice) { event.preventDefault(); logCall('callback', choice.at); }
        return;
      }
      const outcome = OUTCOMES.find(o => o.key === event.key);
      if (outcome) { event.preventDefault(); if (outcome.id === 'callback') setPicker(true); else logCall(outcome.id); return; }
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 's') { event.preventDefault(); go(1); }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); if (index > 0) go(-1); }
      else if (event.key.toLowerCase() === 'n') { event.preventDefault(); noteRef.current?.focus(); }
      else if (event.key.toLowerCase() === 'c' && phone) { event.preventDefault(); void copy(phone, 'Number'); }
      else if (event.key === 'Enter' && phone && (event.target as HTMLElement).tagName !== 'BUTTON') { event.preventDefault(); callRef.current?.click(); }
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener('keydown', listener, true);
    return () => window.removeEventListener('keydown', listener, true);
  }, []);

  const h = card ? hue(card.business.name) : 220;
  const progress = queue.length ? Math.min(1, (finished ? queue.length : index) / queue.length) : 1;

  return <SwarmDialog label="Power Hour" close={requestClose} className="ph">
    <div className="ph-bg" aria-hidden style={{ '--h': h } as React.CSSProperties}><i/><i/><i/></div>
    <header className="ph-top">
      <div className="ph-brand"><span className="ph-bolt"><Zap size={15}/></span><div><strong>Power Hour</strong><small>{compactBatchTitle(batch.title)}</small></div></div>
      <dl className="ph-hud">
        <div><dt>Time</dt><dd className="mono">{clock(now - startedAt)}</dd></div>
        <div><dt>Dials</dt><dd><Counter value={stats.dials}/></dd></div>
        <div><dt>Connects</dt><dd><Counter value={stats.connects}/><em>{stats.connectRate}%</em></dd></div>
        <div className="good"><dt>Interested</dt><dd><Counter value={stats.interested}/></dd></div>
        <div><dt>Callbacks</dt><dd><Counter value={stats.callbacks}/></dd></div>
        <div className="hide-sm"><dt>Pace</dt><dd><Counter value={stats.perHour}/><em>/hr</em></dd></div>
      </dl>
      <button className="ph-x" aria-label={log.length && !finished ? 'End session' : 'Close Power Hour'} onClick={requestClose}><X size={17}/></button>
      <div className="ph-progress" aria-hidden><motion.span animate={{ scaleX: progress }} transition={{ type: 'spring', stiffness: 120, damping: 22 }}/></div>
    </header>

    {finished || !queue.length ? <Summary queue={queue} log={log} startedAt={startedAt} now={now} remaining={queue.length - index} resume={() => setFinished(false)} close={close} copy={copy} copied={copied}/> : <div className="ph-stage">
      <aside className="ph-rail" aria-label="Up next">
        <h3>Up next <span>{queue.length - index - 1}</span></h3>
        <ol>{queue.slice(index + 1, index + 7).map((next, i) => <motion.li key={next.card.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1 - i * .11, x: 0 }} transition={{ duration: .25, delay: i * .03 }}>
          <span className={`ph-dot ${next.reason}`}/><div><strong>{next.card.business.name}</strong><small>{next.reason === 'fresh' ? next.card.business.category : REASON[next.reason]}</small></div><b>{plans.get(next.card.id)?.score ?? ''}</b>
        </motion.li>)}</ol>
        {log.length > 0 && <div className="ph-done"><h3>Logged <span>{log.length}</span></h3>{log.slice(-5).reverse().map(entry => <p key={entry.id} className={entry.outcome}><i/><span>{entry.name}</span><em>{OUTCOME_LABEL[entry.outcome]}</em></p>)}</div>}
        <div className="ph-keys"><span><kbd>1</kbd>–<kbd>4</kbd> outcome</span><span><kbd>↵</kbd> call</span><span><kbd>C</kbd> copy</span><span><kbd>N</kbd> note</span><span><kbd>←</kbd><kbd>→</kbd> move</span></div>
      </aside>

      <main className="ph-center">
        <div className="ph-card-wrap"><AnimatePresence mode="popLayout" initial={false} custom={direction}>
          <motion.article key={card!.id} className="ph-card" custom={direction} style={{ '--h': h } as React.CSSProperties}
            variants={{ enter: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * 60, scale: .98 }), center: { opacity: 1, x: 0, scale: 1 }, exit: (d: number) => ({ opacity: 0, x: reduced ? 0 : d * -80, scale: .96, filter: reduced ? 'none' : 'blur(6px)' }) }}
            initial="enter" animate="center" exit="exit" transition={{ type: 'spring', stiffness: 260, damping: 30 }}>
            <div className="ph-card-top">
              <span className={`ph-reason ${item.reason}`}><i/>{REASON[item.reason]}</span>
              <span className="ph-cat">{card!.business.category}</span>
              {plan?.lane.status === 'check' && <span className="ph-check" title={plan.lane.reasons.join(' · ')}>Check lane</span>}
              {logged.has(card!.id) && <span className="ph-logged"><Check size={12}/>{OUTCOME_LABEL[logged.get(card!.id)!.outcome]}</span>}
              {plan && <ScoreRing score={plan.score}/>}
            </div>
            <h1>{card!.business.name}</h1>
            <p className="ph-addr"><MapPin size={13}/>{card!.business.address}</p>

            <div className="ph-phone">
              <a ref={callRef} href={`tel:${phone}`} className="ph-number">{displayPhone(phone)}</a>
              <div>
                <a href={`tel:${phone}`} className="ph-call"><Phone size={16}/>Call</a>
                <button className={`ph-copy ${copied === 'Number' ? 'on' : ''}`} onClick={() => void copy(phone, 'Number')}>{copied === 'Number' ? <Check size={15}/> : <Copy size={15}/>}{copied === 'Number' ? 'Copied' : 'Copy'}</button>
              </div>
            </div>

            <div className="ph-chips">
              <span className={contact ? 'ask' : ''}><UserRound size={13}/>{contact ? <>Ask for <b>{contact}</b></> : <>Ask for {plan?.discovery.gatekeeper ?? 'the owner'}</>}</span>
              {today && <span><Clock3 size={13}/>Today {today}</span>}
              {plan?.bestTime && <span><Sparkles size={13}/>Best: {plan.bestTime}</span>}
            </div>

            <blockquote className="ph-opener"><small>When they pick up</small>{contact ? `Hi, is ${contact} available? It's about the phone and internet for ${card!.business.name}.` : `Hi, this is about the phone and internet for ${card!.business.name}. Who handles that there, ${plan?.discovery.gatekeeper ?? 'the owner'}?`}</blockquote>

            {plan && plan.lane.status !== 'out' && <div className="ph-plan">
              <section><h4>Get them talking</h4><ul>{plan.discovery.opening.map(q => <li key={q}>{q}</li>)}</ul></section>
              <section><h4>Lead with</h4><ul className="ph-products">{plan.products.slice(0, 3).map(p => <li key={p.id}><b>{p.label}</b>{p.ask}</li>)}</ul></section>
            </div>}
            {(plan?.drivers.length || lastNote) ? <div className="ph-foot">
              {plan?.drivers.slice(0, 3).map(d => <span key={d.label} className={d.good ? '' : 'warn'}>{d.good ? <Flame size={12}/> : null}{d.label}</span>)}
              {lastNote && <p><b>Last note</b>{lastNote}</p>}
            </div> : null}
          </motion.article>
        </AnimatePresence></div>

        <div className="ph-dock">
          <label className="ph-note"><textarea ref={noteRef} rows={1} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} placeholder="Quick note, saved with the outcome  (N)"/></label>
          <div className="ph-outcomes" role="group" aria-label="Call outcome">
            {OUTCOMES.map(({ id, key, label, Icon }) => <motion.button key={id} className={`ph-out ${id} ${picker && id === 'callback' ? 'open' : ''}`} whileTap={{ scale: .96 }} onClick={() => id === 'callback' ? setPicker(p => !p) : logCall(id)}><Icon size={17}/><span>{label}</span><kbd>{key}</kbd></motion.button>)}
            <AnimatePresence>{picker && <motion.div className="ph-picker" role="menu" aria-label="Call back when" initial={{ opacity: 0, y: 8, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 6, scale: .98 }} transition={{ type: 'spring', stiffness: 420, damping: 30 }}>
              <small>Call back when?</small>
              {choices.map((choice, i) => <button key={choice.label} role="menuitem" onClick={() => logCall('callback', choice.at)}><span>{choice.label}</span><em>{choice.at.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</em><kbd>{i + 1}</kbd></button>)}
            </motion.div>}</AnimatePresence>
          </div>
          <div className="ph-nav">
            <button disabled={index === 0} onClick={() => go(-1)}><ArrowLeft size={14}/>Back</button>
            <span>{index + 1} of {queue.length}</span>
            <button onClick={() => go(1)}>Skip<ArrowRight size={14}/></button>
          </div>
        </div>
      </main>
    </div>}

    <AnimatePresence>{flash && !reduced && <motion.div key={flash.key} className={`ph-flash ${flash.outcome}`} aria-hidden initial={{ opacity: .9, scale: .2 }} animate={{ opacity: 0, scale: 2.4 }} transition={{ duration: .7, ease: 'easeOut' }} onAnimationComplete={() => setFlash(null)}/>}</AnimatePresence>
    <AnimatePresence>{streak >= 3 && !finished && <motion.div key={streak} className="ph-streak" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><Flame size={14}/>{streak} connects in a row</motion.div>}</AnimatePresence>
    <AnimatePresence>{failed.length > 0 && <motion.div className="ph-failed" role="alert" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      Couldn&apos;t save {failed.length === 1 ? failed[0].name : `${failed.length} calls`}.<button onClick={() => failed.forEach(f => void f.retry())}>Retry</button>
    </motion.div>}</AnimatePresence>
  </SwarmDialog>;
}

function Summary({ queue, log, startedAt, now, remaining, resume, close, copy, copied }: {
  queue: QueueItem[]; log: SessionEntry[]; startedAt: number; now: number; remaining: number;
  resume: () => void; close: () => void; copy: (value: string, label: string) => Promise<void>; copied: string;
}) {
  const stats = sessionStats(log, startedAt, now);
  if (!queue.length) return <div className="ph-summary empty">
    <span className="ph-big-icon"><Phone size={26}/></span>
    <h2>No one left to call here</h2>
    <p>Power Hour lines up businesses with a phone number that are in your lane and haven&apos;t been reached yet. Callbacks scheduled for later wait until they&apos;re due, and no-answers come back after three hours.</p>
    <button className="ph-primary" onClick={close}>Back to the batch</button>
  </div>;
  const wins = log.filter(entry => entry.outcome === 'interested' || entry.outcome === 'callback');
  return <motion.div className="ph-summary" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
    <span className="ph-big-icon"><Zap size={26}/></span>
    <h2>{log.length ? stats.interested ? `${stats.interested} interested. Nice work.` : 'Session wrapped.' : 'Ready when you are.'}</h2>
    <p>{clock(now - startedAt)} on the phones{remaining > 0 ? ` · ${remaining} still in line` : ' · you made it through the whole line'}</p>
    <div className="ph-totals">
      {([['Dials', stats.dials], ['Connects', stats.connects], ['Interested', stats.interested], ['Callbacks', stats.callbacks]] as const).map(([label, value], i) => <motion.div key={label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .08 + i * .06 }}><strong><Counter value={value}/></strong><span>{label}</span></motion.div>)}
    </div>
    {wins.length > 0 && <ul className="ph-wins">{wins.map(entry => <li key={entry.id} className={entry.outcome}><i/>{entry.name}<em>{entry.outcome === 'callback' && entry.callbackAt ? `Call back ${new Date(entry.callbackAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : 'Interested · added to funnel'}</em></li>)}</ul>}
    <p className="ph-fine">Every outcome is saved to the business, and callbacks and interested leads show up under Saved businesses.</p>
    <div className="ph-summary-actions">
      {log.length > 0 && <button onClick={() => void copy(sessionRecap(log, startedAt, now), 'Recap')}>{copied === 'Recap' ? <Check size={15}/> : <Copy size={15}/>}{copied === 'Recap' ? 'Recap copied' : 'Copy recap'}</button>}
      {remaining > 0 && <button onClick={resume}>Keep going</button>}
      <button className="ph-primary" onClick={close}>Done</button>
    </div>
  </motion.div>;
}
