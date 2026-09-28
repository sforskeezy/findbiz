"use client";
import { useEffect, useState } from 'react';
import { AnimatePresence, animate, motion } from 'motion/react';
import { ArrowUpRight, Bookmark, BookmarkCheck, Check, Clock3, Copy, EyeOff, FunnelPlus, Globe, LoaderCircle, MapPin, Phone, Search, Sparkles, UserRoundCheck, Wifi, X } from 'lucide-react';
import { SwarmDialog } from '@/components/swarm/swarm-dialog';
import { CopyContact } from '@/components/swarm/copy-contact';
import { ProviderLabels } from '@/components/swarm/provider-labels';
import { Card, ResearchTab, hue, initials, researchPeople, rise, safeUrl, stagger } from '@/components/swarm/swarm-research';
import { digits, draftLead, isSpectrumProvider, type LeadRecord } from '@/lib/swarm/lead-book';
import { normalizePhonesForCopy } from '@/lib/phone';
import type { SwarmBatch, SwarmProspect } from '@/lib/swarm/types';
import './swarm-profile.css';

function formatPhone(phone?: string | null) { const d = digits(phone); const local = d.length === 11 && d.startsWith('1') ? d.slice(1) : d; return local.length === 10 ? `(${local.slice(0,3)}) ${local.slice(3,6)}-${local.slice(6)}` : phone ?? ''; }
const TABS = [['overview', 'Overview'], ['research', 'Research'], ['sources', 'Sources']] as const;

function FitGauge({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => { const control = animate(0, value, { duration: 1.1, ease: [.2, .8, .2, 1], onUpdate: next => setShown(Math.round(next)) }); return () => control.stop(); }, [value]);
  const circumference = 2 * Math.PI * 34;
  return <div className={`spx-gauge ${value >= 70 ? 'high' : value >= 45 ? 'mid' : ''}`} role="img" aria-label={`Prospecting fit ${value} out of 100`}>
    <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="34" className="spx-gauge-track"/><motion.circle cx="40" cy="40" r="34" className="spx-gauge-bar" strokeDasharray={circumference} initial={{ strokeDashoffset: circumference }} animate={{ strokeDashoffset: circumference * (1 - value / 100) }} transition={{ duration: 1.1, ease: [.2, .8, .2, 1] }}/></svg>
    <span><strong>{shown}</strong><small>/100</small></span>
  </div>;
}

function Stars({ rating }: { rating: number }) {
  return <span className="spx-stars" aria-label={`${rating} stars`}><span>{'★★★★★'}</span><span style={{ width: `${Math.max(0, Math.min(5, rating)) * 20}%` }}>{'★★★★★'}</span></span>;
}

export function SwarmDetail({ card, batch, close, research, pending = false, record, saveLead, inFunnel = false, addToFunnel }: {
  card: SwarmProspect; batch: SwarmBatch; close: () => void; research?: () => void; pending?: boolean;
  inFunnel?: boolean; addToFunnel?: () => Promise<void>;
  record?: LeadRecord;
  saveLead: (disposition: LeadRecord['disposition'], edits: { contactName: string; notes: string }) => Promise<void>;
}) {
  const [tab, setTab] = useState<'overview' | 'research' | 'sources'>('overview');
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
  const lead = card.intelligence?.brief?.askFor ? people.find(person => person.name === card.intelligence?.brief?.askFor) ?? people[0] : people[0];
  const researching = ['queued', 'researching'].includes(card.researchStatus);
  const providers = [...new Set(card.broadband?.observations.map((o) => o.provider))].sort((a, b) => Number(isSpectrumProvider(b)) - Number(isSpectrumProvider(a)));
  const status = card.opportunity === 'high' ? 'High priority' : card.opportunity === 'contact_needed' ? 'Find contact' : 'Review';
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

  return <SwarmDialog label={p.name} close={close} className="sw-profile-modal spx">
    <header className="spx-head">
      <div className="spx-aurora" aria-hidden><i/><i/><i/></div>
      <button className="spx-close" aria-label="Close profile" onClick={close}><X size={17}/></button>
      <motion.div className="spx-identity" variants={stagger} initial="hidden" animate="show">
        <motion.div variants={rise} className="spx-chips">
          <span className="spx-chip">{p.category}</span>
          <span className={`spx-chip status ${card.opportunity}`}><i/>{status}</span>
          {p.rating != null && <span className="spx-chip"><Stars rating={p.rating}/><b>{p.rating}</b>{p.reviewCount != null && <em>({p.reviewCount.toLocaleString()})</em>}</span>}
          {p.operatingStatus !== 'Unknown' && <span className="spx-chip">{p.operatingStatus === 'Open' ? 'Operational' : p.operatingStatus}</span>}
        </motion.div>
        <motion.h2 variants={rise}>{p.name}</motion.h2>
        <motion.div variants={rise} className="spx-address"><CopyContact value={p.address} label="address"><MapPin size={13}/>{p.address}</CopyContact></motion.div>
        <motion.div variants={rise} className="spx-actions">
          {digits(p.phone) && <a className="spx-btn dark" href={`tel:${digits(p.phone)}`}><Phone size={14}/>Call {formatPhone(p.phone)}</a>}
          {digits(p.phone) && <CopyContact value={digits(p.phone)} label="phone number" className="spx-btn">Copy number</CopyContact>}
          {addToFunnel && <button className={`spx-btn blue ${inFunnel ? 'done' : ''}`} disabled={inFunnel || funneling} onClick={() => { setFunneling(true); void addToFunnel().finally(() => setFunneling(false)); }}>{funneling ? <LoaderCircle className="sw-spin" size={14}/> : inFunnel ? <Check size={14}/> : <FunnelPlus size={14}/>}{inFunnel ? 'In your funnel' : 'Add to funnel'}</button>}
          {safeUrl(p.website) && <a className="spx-btn" href={safeUrl(p.website)} target="_blank" rel="noreferrer"><Globe size={14}/>Website<ArrowUpRight size={12}/></a>}
          {research && <button className={`spx-btn glow ${researching ? 'busy' : ''}`} disabled={researching || pending} onClick={() => { research(); setTab('research'); }}>{researching ? <LoaderCircle className="sw-spin" size={14}/> : <Sparkles size={14}/>}{researching ? 'Researching' : card.intelligence ? 'Refresh research' : 'Research'}</button>}
        </motion.div>
      </motion.div>
      <nav className="spx-tabs" aria-label="Profile sections">{TABS.map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{tab === key && <motion.span layoutId="spx-tab" className="spx-tab-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }}/>}<span>{label}</span>{key === 'research' && (researching ? <LoaderCircle size={12} className="sw-spin"/> : people.length > 0 && <small>{people.length}</small>)}</button>)}</nav>
    </header>

    <div className="spx-body"><AnimatePresence mode="wait" initial={false}><motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: .18 }}>
      {tab === 'overview' ? <motion.div className="spx-grid" variants={stagger} initial="hidden" animate="show">
        <div className="spx-col">
          <Card className="spx-who">
            {lead ? <>
              <span className="spx-ring"><span className="spx-avatar lg" style={{ '--h': hue(lead.name) } as React.CSSProperties}>{initials(lead.name)}</span></span>
              <div><small>Who to ask for</small><strong>{lead.name}</strong><span>{lead.roles.join(' · ')} · {lead.confidence === 'Verified' ? 'confirmed' : 'likely'}</span></div>
              {contactName === lead.name ? <span className="spx-set"><Check size={13}/>Contact</span> : <button type="button" onClick={() => applyContact(lead.name)}><UserRoundCheck size={14}/>Use</button>}
            </> : <>
              <span className="spx-ring idle"><span className="spx-avatar lg ghost"><Search size={18}/></span></span>
              <div><small>Who to ask for</small><strong>{researching ? 'Looking for the owner…' : 'Unknown so far'}</strong><span>{researching ? 'Checking registries, reviews, social, and reverse phone.' : card.intelligence ? 'No name in public sources. Try the people-search links in Research.' : 'Research finds the owner or manager and writes a call brief.'}</span></div>
              {!card.intelligence && research && !researching && <button type="button" className="glow" disabled={pending} onClick={() => { research(); setTab('research'); }}><Sparkles size={14}/>Research</button>}
            </>}
          </Card>
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
          <Card className="spx-fit"><FitGauge value={card.rank}/><div><h3>Prospecting fit</h3><ul>{card.reasons.map((reason, index) => <motion.li key={reason} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: .3 + index * .06 }}><Check size={12}/>{reason}</motion.li>)}</ul></div></Card>
          <Card><div className="spx-card-head"><h3><Wifi size={15}/>Reported availability</h3><small>{providers.length || ''}</small></div>
            {providers.length ? <ul className="spx-providers">{providers.map((provider, index) => <motion.li key={provider} className={isSpectrumProvider(provider) ? 'spectrum' : ''} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 + index * .05 }}><ProviderLabels providers={[provider]}/><span>{[...new Set(card.broadband!.observations.filter((o) => o.provider === provider).map((o) => o.technology))].map(tech => <em key={tech}>{tech}</em>)}</span></motion.li>)}</ul> : <p className="spx-muted">{card.broadbandChecked ? 'No provider availability confirmed.' : 'Availability check queued.'}</p>}
            <p className="spx-fine">{card.broadband?.asOfDate ? `Reported ${card.broadband.asOfDate} · ${card.broadband.matchQuality.replaceAll('_', ' ')} match. ` : ''}Availability, not the current ISP.</p>
          </Card>
          {p.hours?.length ? <Card><h3><Clock3 size={15}/>Listed hours</h3><ul className="spx-hours">{p.hours.map((hours, i) => <li key={i}>{hours}</li>)}</ul></Card> : null}
        </div>
      </motion.div> : tab === 'research' ? <ResearchTab card={card} research={research} researching={researching} pending={pending} applyContact={applyContact}/> : <motion.div className="spx-grid" variants={stagger} initial="hidden" animate="show">
        <Card><h3>Evidence sources</h3><div className="spx-sources">
          {safeUrl(p.directoryUrl) && <a href={safeUrl(p.directoryUrl)} target="_blank" rel="noreferrer"><div><strong>{p.source || 'Business listing'}</strong><small>{p.confidence} · Retrieved {new Date(p.retrievedAt).toLocaleDateString()}</small></div><ArrowUpRight size={14}/></a>}
          {card.intelligence?.sources.map((source) => safeUrl(source.url) ? <a key={source.id} href={safeUrl(source.url)} target="_blank" rel="noreferrer"><div><strong>{source.label}</strong><small>{source.status} · {new Date(source.sourceDate).toLocaleDateString()}</small></div><ArrowUpRight size={14}/></a> : null)}
          {safeUrl(card.broadband?.sourceUrl) && <a href={safeUrl(card.broadband!.sourceUrl)} target="_blank" rel="noreferrer"><div><strong>Broadband availability</strong><small>Reported {card.broadband?.asOfDate}</small></div><ArrowUpRight size={14}/></a>}
        </div></Card>
        <Card><h3>Found from {card.sourceAddressIds.length} {card.sourceAddressIds.length === 1 ? 'address' : 'addresses'}</h3><ul className="spx-found">{card.sourceAddressIds.map((id) => <li key={id}><MapPin size={14}/><CopyContact label="source address" value={batch.addresses.find((a) => a.id === id)?.text ?? ''}/></li>)}</ul></Card>
      </motion.div>}
    </motion.div></AnimatePresence>{card.error && <p className="sw-error">{card.error}</p>}{saveError && <p className="sw-error" role="alert">{saveError}</p>}</div>

    <footer className="sw-modal-footer sw-disposition-footer"><div><button className="sw-hide-lead" disabled={saving} onClick={() => void save('hidden')}><EyeOff size={15}/>Never see again</button><AnimatePresence mode="wait">{message && <motion.span key={message} role="status" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{message}</motion.span>}</AnimatePresence></div><div><button className="sw-icon" aria-label="Copy business brief" onClick={() => void copyBrief()}><Copy size={15}/></button><button className="sw-primary" disabled={saving} onClick={() => void save('saved')}>{saving ? <LoaderCircle className="sw-spin" size={15}/> : record?.disposition === 'saved' ? <BookmarkCheck size={15}/> : <Bookmark size={15}/>} {record?.disposition === 'saved' ? 'Save changes' : 'Save business'}</button></div></footer>
  </SwarmDialog>;
}
