"use client";
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Bookmark, BookmarkCheck, Check, ChevronLeft, ChevronRight, Clock3, Copy, EyeOff, FunnelPlus, Globe, LoaderCircle, MapPin, Sparkles, Wifi, X } from 'lucide-react';
import { SwarmDialog } from '@/components/swarm/swarm-dialog';
import { CopyContact } from '@/components/swarm/copy-contact';
import { DealCard } from '@/components/swarm/swarm-deal';
import { FitCard } from '@/components/swarm/swarm-fit';
import { WhoToAsk } from '@/components/swarm/swarm-who';
import { ProviderLabels } from '@/components/swarm/provider-labels';
import { PromotionsTab } from '@/components/swarm/swarm-promotions';
import { Card, ResearchTab, researchPeople, rise, safeUrl, stagger } from '@/components/swarm/swarm-research';
import { digits, draftLead, isSpectrumProvider, type LeadRecord } from '@/lib/swarm/lead-book';
import { dealPlan } from '@/lib/swarm/deal-plan';
import { normalizePhonesForCopy } from '@/lib/phone';
import type { SwarmBatch, SwarmProspect } from '@/lib/swarm/types';
import './swarm-profile.css';

function CopyButton({ value, label, done, dark = false }: { value: string; label: string; done: string; dark?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 1600); } catch { /* Clipboard is optional. */ }
  }
  return <button type="button" className={`spx-btn ${dark ? 'dark' : ''} ${copied ? 'copied' : ''}`} aria-label={`${label}: ${value}`} onClick={() => void copy()}>{copied ? <Check size={14}/> : <Copy size={14}/>}{copied ? done : label}</button>;
}
const TABS = [['overview', 'Overview'], ['research', 'Research'], ['promotions', 'Promotions'], ['sources', 'Sources']] as const;

export function SwarmDetail({ card, batch, close, research, pending = false, record, saveLead, inFunnel = false, addToFunnel, position, step }: {
  card: SwarmProspect; batch: SwarmBatch; close: () => void; research?: () => void; pending?: boolean;
  inFunnel?: boolean; addToFunnel?: (edits: { contactName: string; notes: string }) => Promise<void>;
  record?: LeadRecord;
  saveLead: (disposition: LeadRecord['disposition'], edits: { contactName: string; notes: string }) => Promise<void>;
  /** Lets the header offer "next/previous lead" through the same filtered list the table shows. */
  position?: { index: number; total: number }; step?: (delta: number) => void;
}) {
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('overview');
  const [contactDraft, setContactName] = useState<string | null>(null);
  const [notesDraft, setNotes] = useState<string | null>(null);
  const contactName = contactDraft ?? record?.contactName ?? draftLead(card).contactName;
  const notes = notesDraft ?? record?.notes ?? draftLead(card).notes;
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const [funneling, setFunneling] = useState(false);
  const p = card.business;
  const people = researchPeople(card);
  const plan = useMemo(() => dealPlan(card), [card]);
  const researching = ['queued', 'researching'].includes(card.researchStatus);
  const providers = [...new Set(card.broadband?.observations.map((o) => o.provider))].sort((a, b) => Number(isSpectrumProvider(b)) - Number(isSpectrumProvider(a)));
  async function save(disposition: LeadRecord['disposition']) {
    setSaving(true); setSaveError('');
    try { await saveLead(disposition, { contactName, notes }); setMessage(disposition === 'saved' ? 'Business and notes saved' : 'Business hidden'); }
    catch (cause) { setSaveError(cause instanceof Error ? cause.message : 'Could not save. Please try again.'); }
    finally { setSaving(false); }
  }
  async function copyBrief() {
    try { await navigator.clipboard.writeText(normalizePhonesForCopy([p.name, p.address, digits(p.phone), contactName && `Contact: ${contactName}`, notes].filter(Boolean).join('\n\n'))); setMessage('Brief copied'); }
    catch { setSaveError('Clipboard unavailable in this browser.'); }
  }
  function applyContact(name: string) { setContactName(name); setTab('overview'); setMessage(`${name} set as the contact. Save to keep it.`); }
  // A contact or note typed in this profile is real work, even if the rep never hits "Save business."
  // Leaving the profile — close (X, backdrop click, Escape) or stepping to another lead, which
  // remounts this component from scratch — should not silently throw an unsaved draft away.
  async function persistDraftIfDirty() {
    const contactChanged = contactDraft !== null && contactDraft !== (record?.contactName ?? draftLead(card).contactName);
    const notesChanged = notesDraft !== null && notesDraft !== (record?.notes ?? draftLead(card).notes);
    if (contactChanged || notesChanged) {
      try { await saveLead(record?.disposition ?? 'active', { contactName, notes }); } catch { /* Best-effort: leaving should never hang on a failed autosave. */ }
    }
  }
  async function closeWithDraftSaved() { await persistDraftIfDirty(); close(); }
  async function stepWithDraftSaved(delta: number) { await persistDraftIfDirty(); step?.(delta); }

  return <SwarmDialog label={p.name} close={() => void closeWithDraftSaved()} className="sw-profile-modal spx">
    <header className="spx-head">
      <div className="spx-aurora" aria-hidden/>
      <button className="spx-close" aria-label="Close profile" onClick={() => void closeWithDraftSaved()}><X size={17}/></button>
      <motion.div className="spx-identity" variants={stagger} initial="hidden" animate="show">
        <motion.h2 variants={rise}>{p.name}</motion.h2>
        <motion.p variants={rise} className="spx-address">
          <MapPin size={13}/>{p.address}
          {position && step && <span className="spx-nav">
            <button type="button" aria-label="Previous lead" title="Previous lead" disabled={position.index <= 0} onClick={() => void stepWithDraftSaved(-1)}><ChevronLeft size={14}/></button>
            <b>{position.index + 1} of {position.total}</b>
            <button type="button" aria-label="Next lead" title="Next lead" disabled={position.index >= position.total - 1} onClick={() => void stepWithDraftSaved(1)}><ChevronRight size={14}/></button>
          </span>}
        </motion.p>
        <motion.div variants={rise} className="spx-actions">
          <CopyButton value={p.address} label="Copy address" done="Address copied" dark/>
          {digits(p.phone) && <CopyButton value={digits(p.phone)} label="Copy number" done="Number copied"/>}
          {addToFunnel && <button className={`spx-btn blue ${inFunnel ? 'done' : ''}`} disabled={inFunnel || funneling} onClick={() => { setFunneling(true); void addToFunnel({ contactName, notes }).finally(() => setFunneling(false)); }}>{funneling ? <LoaderCircle className="sw-spin" size={14}/> : inFunnel ? <Check size={14}/> : <FunnelPlus size={14}/>}{inFunnel ? 'In your funnel' : 'Add to funnel'}</button>}
          {safeUrl(p.website) && <a className="spx-btn" href={safeUrl(p.website)} target="_blank" rel="noreferrer"><Globe size={14}/>Website<ArrowUpRight size={12}/></a>}
          {research && <button className={`spx-btn glow ${researching ? 'busy' : ''}`} disabled={researching || pending} onClick={() => { research(); setTab('research'); }}>{researching ? <LoaderCircle className="sw-spin" size={14}/> : <Sparkles size={14}/>}{researching ? 'Researching' : card.intelligence ? 'Refresh research' : 'Research'}</button>}
        </motion.div>
      </motion.div>
      <nav className="spx-tabs" aria-label="Profile sections">{TABS.map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{tab === key && <span className="spx-tab-pill"/>}<span>{label}</span>{key === 'research' && (researching ? <LoaderCircle size={12} className="sw-spin"/> : people.length > 0 && <small>{people.length}</small>)}</button>)}</nav>
    </header>

    <div className="spx-body"><motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .12 }}>
      {tab === 'overview' ? <motion.div className="spx-grid" variants={stagger} initial="hidden" animate="show">
        <div className="spx-col">
          <WhoToAsk card={card} contactName={contactName} applyContact={applyContact}/>
          <DealCard plan={plan} notify={setMessage} logToNotes={line => { setNotes([notes.trim(), line].filter(Boolean).join('\n')); setMessage('Added to notes. Save to keep it.'); }}/>
          <Card><h3>About the business</h3><p className="spx-summary">{normalizePhonesForCopy(card.intelligence?.summary || p.publicNotes || `Listed as ${p.category.toLowerCase()}. Run research for more company details.`)}</p></Card>
          <Card className="spx-notes">
            <div className="spx-card-head"><h3>Your notes</h3>{record?.disposition === 'saved' && <span className="spx-saved"><BookmarkCheck size={13}/>Saved</span>}</div>
            <label htmlFor="sw-contact-name">Contact</label>
            <input id="sw-contact-name" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={200} placeholder="Name or nickname they go by"/>
            <label htmlFor="sw-lead-notes">Notes</label>
            <textarea id="sw-lead-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={20000} placeholder="What you learned, who to ask for, and anything worth following up on…" rows={5}/>
          </Card>
        </div>
        <div className="spx-col">
          <FitCard card={card} plan={plan}/>
          <Card><div className="spx-card-head"><h3><Wifi size={15}/>Reported availability</h3><small>{providers.length || ''}</small></div>
            {providers.length ? <ul className="spx-providers">{providers.map((provider) => <li key={provider} className={isSpectrumProvider(provider) ? 'spectrum' : ''}><ProviderLabels providers={[provider]}/><span>{[...new Set(card.broadband!.observations.filter((o) => o.provider === provider).map((o) => o.technology))].map(tech => <em key={tech}>{tech}</em>)}</span></li>)}</ul> : <p className="spx-muted">{card.broadbandChecked ? 'No provider availability confirmed.' : 'Availability check queued.'}</p>}
            <p className="spx-fine">{card.broadband?.asOfDate ? `Reported ${card.broadband.asOfDate} · ${card.broadband.matchQuality.replaceAll('_', ' ')} match. ` : ''}Availability, not the current ISP.</p>
          </Card>
          {p.hours?.length ? <Card><h3><Clock3 size={15}/>Listed hours</h3><ul className="spx-hours">{p.hours.map((hours, i) => <li key={i}>{hours}</li>)}</ul></Card> : null}
        </div>
      </motion.div> : tab === 'research' ? <ResearchTab card={card} research={research} researching={researching} pending={pending} applyContact={applyContact}/> : tab === 'promotions' ? <PromotionsTab card={card} plan={plan} notify={setMessage}/> : <motion.div className="spx-grid" variants={stagger} initial="hidden" animate="show">
        <Card><h3>Evidence sources</h3><div className="spx-sources">
          {safeUrl(p.directoryUrl) && <a href={safeUrl(p.directoryUrl)} target="_blank" rel="noreferrer"><div><strong>{p.source || 'Business listing'}</strong><small>{p.confidence} · Retrieved {new Date(p.retrievedAt).toLocaleDateString()}</small></div><ArrowUpRight size={14}/></a>}
          {card.intelligence?.sources.map((source) => safeUrl(source.url) ? <a key={source.id} href={safeUrl(source.url)} target="_blank" rel="noreferrer"><div><strong>{source.label}</strong><small>{source.status} · {new Date(source.sourceDate).toLocaleDateString()}</small></div><ArrowUpRight size={14}/></a> : null)}
          {safeUrl(card.broadband?.sourceUrl) && <a href={safeUrl(card.broadband!.sourceUrl)} target="_blank" rel="noreferrer"><div><strong>Broadband availability</strong><small>Reported {card.broadband?.asOfDate}</small></div><ArrowUpRight size={14}/></a>}
        </div></Card>
        <Card><h3>Found from {card.sourceAddressIds.length} {card.sourceAddressIds.length === 1 ? 'address' : 'addresses'}</h3><ul className="spx-found">{card.sourceAddressIds.map((id) => <li key={id}><MapPin size={14}/><CopyContact label="source address" value={batch.addresses.find((a) => a.id === id)?.text ?? ''}/></li>)}</ul></Card>
      </motion.div>}
    </motion.div>{card.error && <p className="sw-error">{card.error}</p>}{saveError && <p className="sw-error" role="alert">{saveError}</p>}</div>

    <footer className="sw-modal-footer sw-disposition-footer"><div><button className="sw-hide-lead" disabled={saving} onClick={() => void save('hidden')}><EyeOff size={15}/>Never see again</button><AnimatePresence mode="wait">{message && <motion.span key={message} role="status" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{message}</motion.span>}</AnimatePresence></div><div><button className="sw-icon" aria-label="Copy business brief" onClick={() => void copyBrief()}><Copy size={15}/></button><button className="sw-primary" disabled={saving} onClick={() => void save('saved')}>{saving ? <LoaderCircle className="sw-spin" size={15}/> : record?.disposition === 'saved' ? <BookmarkCheck size={15}/> : <Bookmark size={15}/>} {record?.disposition === 'saved' ? 'Save changes' : 'Save business'}</button></div></footer>
  </SwarmDialog>;
}
