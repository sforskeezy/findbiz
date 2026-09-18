"use client";
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Bookmark, BookmarkCheck, Building2, Copy, EyeOff, Globe, LoaderCircle, MapPin, Search, Star, Wifi, X } from 'lucide-react';
import { SwarmDialog } from '@/components/swarm/swarm-dialog';
import { CopyContact } from '@/components/swarm/copy-contact';
import { ProviderLabels } from '@/components/swarm/provider-labels';
import { digits, draftLead, isSpectrumProvider, type LeadRecord } from '@/lib/swarm/lead-book';
import { normalizePhonesForCopy } from '@/lib/phone';
import type { SwarmBatch, SwarmProspect } from '@/lib/swarm/types';

function safeUrl(value?: string | null) { try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }
export function SwarmDetail({ card, batch, close, research, pending = false, record, saveLead }: {
  card: SwarmProspect; batch: SwarmBatch; close: () => void; research?: () => void; pending?: boolean;
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
  const p = card.business;
  const facts = card.intelligence?.facts ?? [];
  const researching = ['queued', 'researching'].includes(card.researchStatus);
  const providers = [...new Set(card.broadband?.observations.map((o) => o.provider))];
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
  return <SwarmDialog label={p.name} close={close} className="sw-profile-modal">
    <header className="sw-profile-header">
      <div className="sw-modal-topline"><span><Building2 size={14}/>Business profile</span><button className="sw-icon" aria-label="Close profile" onClick={close}><X size={20}/></button></div>
      <div className="sw-profile-identity"><div><span className="sw-profile-category">{p.category}</span><h2>{p.name}</h2><CopyContact value={p.address} label="address"><MapPin size={13}/>{p.address}</CopyContact></div><span className={`sw-status ${card.opportunity}`}>{card.opportunity === 'high' ? 'High priority' : card.opportunity === 'contact_needed' ? 'Find contact' : 'Review'}</span></div>
      <div className="sw-profile-actions">
        {digits(p.phone) && <CopyContact value={digits(p.phone)} label="phone number" className="sw-phone-action"/>}
        {safeUrl(p.website) && <a href={safeUrl(p.website)} target="_blank" rel="noreferrer"><Globe size={14}/>Website<ArrowUpRight size={12}/></a>}
        {research && <button className="sw-research-cta" disabled={researching || pending} onClick={research}>{researching ? <LoaderCircle className="sw-spin" size={14}/> : <Search size={14}/>} {researching ? 'Researching' : card.intelligence ? 'Refresh research' : 'Research business'}</button>}
      </div>
      <div className="sw-profile-tabs">{(['overview', 'research', 'sources'] as const).map((key) => <button key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{key === 'overview' ? 'Overview & notes' : key === 'research' ? 'Research' : 'Sources & discovery'}{key === 'research' && facts.length > 0 && <small>{facts.length}</small>}{tab === key && <motion.span layoutId="profile-tab"/>}</button>)}</div>
    </header>
    <div className="sw-profile-body"><AnimatePresence mode="wait" initial={false}><motion.div key={tab} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: .15 }}>
      {tab === 'overview' ? <div className="sw-profile-grid"><div className="sw-profile-main">
        <section><h3>About the business</h3><p className="sw-profile-summary">{normalizePhonesForCopy(card.intelligence?.summary || p.publicNotes || `Listed as ${p.category.toLowerCase()}. Research this business for more company details.`)}</p><div className="sw-listing-metrics">{p.rating != null && <span><Star size={13}/><strong>{p.rating}</strong>{p.reviewCount != null ? ` · ${p.reviewCount} reviews` : ' listing rating'}</span>}{p.operatingStatus !== 'Unknown' && <span>{p.operatingStatus === 'Open' ? 'Listed operational' : p.operatingStatus}</span>}</div></section>
        <section className="sw-lead-notes"><div className="sw-section-heading"><h3>Your notes</h3>{record?.disposition === 'saved' && <span className="sw-saved-indicator"><BookmarkCheck size={13}/>Saved</span>}</div><label htmlFor="sw-contact-name">Contact / name they go by</label><input id="sw-contact-name" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={200} placeholder="Add a name or nickname"/><label htmlFor="sw-lead-notes">Business notes</label><textarea id="sw-lead-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={20000} placeholder="What you learned, who to ask for, and anything worth following up on…" rows={6}/><small>Saved with the full profile when you click {record?.disposition === 'saved' ? 'Save changes' : 'Save business'}.</small></section>
      </div><aside className="sw-profile-context">
        <section className="sw-opportunity-box"><h3>Prospecting fit <small>{card.rank}/100</small></h3><ul>{card.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></section>
        <section className="sw-broadband-box"><h3><Wifi size={15}/>Reported availability</h3>{providers.length ? <div className="sw-provider-list">{providers.sort((a,b)=>Number(isSpectrumProvider(b))-Number(isSpectrumProvider(a))).map((provider) => <div key={provider} className={isSpectrumProvider(provider) ? 'sw-spectrum-provider' : ''}><ProviderLabels providers={[provider]}/><span>{[...new Set(card.broadband!.observations.filter((o) => o.provider === provider).map((o) => o.technology))].join(' · ')}</span></div>)}</div> : <p>{card.broadbandChecked ? 'No provider availability confirmed.' : 'Availability check queued.'}</p>}<small>{card.broadband?.asOfDate ? `Reported ${card.broadband.asOfDate} · ${card.broadband.matchQuality.replaceAll('_', ' ')} match` : card.broadband?.message}</small><p className="sw-evidence-note">Current ISP is unverified. Availability does not confirm a subscription or orderability.</p></section>
        {p.hours?.length ? <section><h3>Listed hours</h3><ul className="sw-hours">{p.hours.map((hours, i) => <li key={i}>{hours}</li>)}</ul></section> : null}
      </aside></div> : tab === 'research' ? <section className="sw-research-facts"><h3>Public business research</h3>{facts.length ? facts.map((fact) => <div className="sw-fact" key={fact.id}><div><span>{fact.label}</span><small>{fact.confidence}</small></div>{fact.kind === 'phone' ? <CopyContact label="phone number" value={digits(fact.value)}/> : fact.kind === 'address' ? <CopyContact label="address" value={fact.value}/> : <p>{normalizePhonesForCopy(fact.value)}</p>}{safeUrl(fact.sourceUrl) && <a href={safeUrl(fact.sourceUrl)} target="_blank" rel="noreferrer">{fact.sourceLabel || 'View source'}<ArrowUpRight size={12}/></a>}</div>) : <div className="sw-research-empty"><Search size={24}/><p>No deeper research saved yet.</p>{research && <button className="sw-primary" disabled={researching || pending} onClick={research}>{researching ? 'Researching…' : 'Research business'}</button>}</div>}</section> : <div className="sw-source-grid"><section><h3>Evidence sources</h3>{safeUrl(p.directoryUrl) && <a className="sw-source-link" href={safeUrl(p.directoryUrl)} target="_blank" rel="noreferrer"><div><strong>{p.source || 'Business listing'}</strong><small>{p.confidence} · Retrieved {new Date(p.retrievedAt).toLocaleDateString()}</small></div><ArrowUpRight size={14}/></a>}{card.intelligence?.sources.map((source) => safeUrl(source.url) ? <a key={source.id} className="sw-source-link" href={safeUrl(source.url)} target="_blank" rel="noreferrer"><div><strong>{source.label}</strong><small>{source.status} · {source.sourceDate}</small></div><ArrowUpRight size={14}/></a> : null)}{safeUrl(card.broadband?.sourceUrl) && <a className="sw-source-link" href={safeUrl(card.broadband!.sourceUrl)} target="_blank" rel="noreferrer"><Wifi size={15}/><div><strong>Broadband availability</strong><small>Reported {card.broadband?.asOfDate}</small></div><ArrowUpRight size={14}/></a>}</section><section><h3>Found from {card.sourceAddressIds.length} {card.sourceAddressIds.length === 1 ? 'address' : 'addresses'}</h3><ul className="sw-discovery-addresses">{card.sourceAddressIds.map((id) => <li key={id}><MapPin size={14}/><CopyContact label="source address" value={batch.addresses.find((a) => a.id === id)?.text ?? ''}/></li>)}</ul></section></div>}
    </motion.div></AnimatePresence>{card.error && <p className="sw-error">{card.error}</p>}{saveError && <p className="sw-error" role="alert">{saveError}</p>}</div>
    <footer className="sw-modal-footer sw-disposition-footer"><div><button className="sw-hide-lead" disabled={saving} onClick={() => void save('hidden')}><EyeOff size={15}/>Never see again</button><span role="status">{message}</span></div><div><button className="sw-icon" aria-label="Copy business brief" onClick={() => void copyBrief()}><Copy size={15}/></button><button className="sw-primary" disabled={saving} onClick={() => void save('saved')}>{saving ? <LoaderCircle className="sw-spin" size={15}/> : <Bookmark size={15}/>} {record?.disposition === 'saved' ? 'Save changes' : 'Save business'}</button></div></footer>
  </SwarmDialog>;
}
