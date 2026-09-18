"use client";
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Check, ChevronRight, ListChecks, LoaderCircle, Phone, X } from 'lucide-react';
import { SwarmDialog } from './swarm-dialog';
import { CopyContact } from './copy-contact';
import { ProviderLabels } from './provider-labels';
import { digits, draftLead, findLead, type LeadEdits, type LeadRecord } from '@/lib/swarm/lead-book';
import type { SwarmProspect } from '@/lib/swarm/types';

export function CallQueue({ cards, records, close, save }: { cards: SwarmProspect[]; records: LeadRecord[]; close: () => void; save: (card: SwarmProspect, edits: LeadEdits) => Promise<void> }) {
  const [queue] = useState(() => cards.filter(p => digits(p.business.phone).length >= 7).sort((a,b) => {
    const aa = findLead(records,a)?.activity, bb = findLead(records,b)?.activity;
    const tier = (activity: typeof aa) => activity?.outcome === 'callback' && Date.parse(activity.callbackAt ?? '') <= Date.now() ? 0 : activity ? 2 : 1;
    return tier(aa) - tier(bb) || b.rank - a.rank;
  }));
  const [index, setIndex] = useState(0);
  const [logged, setLogged] = useState(0);
  const card = queue[index];
  return <SwarmDialog label="Call queue" close={close} className="sw-call-modal">
    <header className="sw-call-header"><div><span className="sw-overline"><ListChecks size={14}/>CALL QUEUE</span><h2>One good call at a time.</h2><p>Due callbacks first, then untouched prospects. Strongest opportunities at the top.</p></div><button className="sw-icon" onClick={close} aria-label="Close call queue"><X size={20}/></button></header>
    <div className="sw-call-summary"><span><strong>{queue.length}</strong> with a phone</span><span><strong>{logged}</strong> logged this session</span><span>{card ? `${index + 1} of ${queue.length}` : 'Queue finished'}</span></div>
    <AnimatePresence mode="wait" initial={false}>{card ? <motion.div key={card.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: .18 }}>
      <CallCard card={card} record={findLead(records,card)} save={async edits => { await save(card, edits); setLogged(n => n+1); setIndex(n => n+1); }} skip={() => setIndex(n => n+1)}/>
    </motion.div> : <div className="sw-call-done"><Check size={32}/><h3>{queue.length ? 'That’s your list.' : 'No listed phone numbers yet.'}</h3><p>{logged ? `${logged} call outcomes saved with your business notes.` : 'Research prospects to find business contact details.'}</p><button className="sw-primary" onClick={close}>Back to prospects<ArrowRight size={15}/></button></div>}</AnimatePresence>
    {card && queue[index+1] && <div className="sw-call-up-next"><span>UP NEXT</span><strong>{queue[index+1].business.name}</strong><ChevronRight size={15}/></div>}
  </SwarmDialog>;
}
function CallCard({ card, record, save, skip }: { card: SwarmProspect; record?: LeadRecord; save: (edits: LeadEdits) => Promise<void>; skip: () => void }) {
  const initial = record ?? draftLead(card);
  const [contactName,setContact] = useState(initial.contactName);
  const [notes,setNotes] = useState(initial.notes);
  const [outcome,setOutcome] = useState<'connected'|'no_answer'|'callback'>('connected');
  const [callbackAt,setCallbackAt] = useState('');
  const [pending,setPending] = useState(false), [error,setError] = useState('');
  async function submit() {
    setPending(true);setError('');
    try { if(outcome==='callback' && (!callbackAt || Date.parse(callbackAt) <= Date.now())) throw new Error('Choose a future callback time.'); await save({ contactName, notes, activity: { outcome, at: new Date().toISOString(), ...(outcome === 'callback' ? { callbackAt: new Date(callbackAt).toISOString() } : {}) } }); }
    catch(e) { setError(e instanceof Error ? e.message : 'Could not save this call.');setPending(false); }
  }
  return <form className="sw-call-card" onSubmit={e=>{e.preventDefault();void submit();}}>
    <span className="sw-profile-category">{card.business.category}</span><h3>{card.business.name}</h3><CopyContact label="address" value={card.business.address}/>
    <CopyContact label="phone number" value={digits(card.business.phone)} className="sw-call-number"><Phone size={20}/>{digits(card.business.phone)}</CopyContact>
    <ProviderLabels providers={card.broadband?.observations.map(o=>o.provider) ?? []}/>
    {record?.activity && <p className="sw-call-previous">Last outcome: {record.activity.outcome.replaceAll('_',' ')} · {new Date(record.activity.at).toLocaleDateString()}{record.activity.callbackAt && ` · Callback ${new Date(record.activity.callbackAt).toLocaleString()}`}</p>}
    <div className="sw-call-fields"><label>Contact name<input value={contactName} onChange={e=>setContact(e.target.value)} maxLength={200} placeholder="Who did you speak with?"/></label><label>Call notes<textarea value={notes} onChange={e=>setNotes(e.target.value)} maxLength={20000} rows={4} placeholder="Add details for your next conversation"/></label></div>
    <fieldset className="sw-outcomes"><legend>Call outcome</legend>{([{key:'connected',label:'Connected'},{key:'no_answer',label:'No answer'},{key:'callback',label:'Call back'}] as const).map(item=><label key={item.key} className={outcome===item.key?'active':''}><input type="radio" name="outcome" value={item.key} checked={outcome===item.key} onChange={()=>setOutcome(item.key)}/>{item.label}</label>)}</fieldset>
    {outcome==='callback' && <label className="sw-callback-time">Callback time<input type="datetime-local" value={callbackAt} onChange={e=>setCallbackAt(e.target.value)} required/></label>}
    {error&&<p role="alert" className="sw-error">{error}</p>}
    <div className="sw-call-footer"><button className="sw-secondary" type="button" onClick={skip} disabled={pending}>Skip for now</button><button className="sw-primary" type="submit" disabled={pending}>{pending?<LoaderCircle className="sw-spin" size={15}/>:<Check size={15}/>}Save call & next<ArrowRight size={15}/></button></div>
  </form>;
}
