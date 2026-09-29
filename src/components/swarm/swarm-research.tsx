"use client";
import { Fragment, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, BadgeCheck, Check, Copy, FileText, LoaderCircle, Mail, Phone, RotateCw, UserRoundCheck } from 'lucide-react';
import { CopyContact } from '@/components/swarm/copy-contact';
import { digits } from '@/lib/swarm/lead-book';
import { lookupLinks } from '@/lib/swarm/lookup-links';
import { normalizePhonesForCopy } from '@/lib/phone';
import type { ResearchPerson, WebSearchResult } from '@/lib/types';
import type { SwarmProspect } from '@/lib/swarm/types';
import './swarm-research.css';

/** Short and transform-only: blur filters and springs on every card made the profile stutter on open. */
export const rise = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { duration: .16, ease: 'easeOut' as const } } };
export const stagger = { hidden: {}, show: { transition: { staggerChildren: .025 } } };

export function safeUrl(value?: string | null) { try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
export function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase()).join(''); }
export function hue(name: string) { let h = 0; for (const char of name) h = (h * 31 + char.charCodeAt(0)) % 360; return h; }

export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <motion.section variants={rise} className={`spx-card ${className}`}>{children}</motion.section>;
}

/** People from this research, falling back to leadership facts saved by older research runs. */
export function researchPeople(card: SwarmProspect): ResearchPerson[] {
  const intelligence = card.intelligence;
  if (!intelligence) return [];
  if (intelligence.people) return intelligence.people;
  return intelligence.facts.filter(fact => fact.kind === 'leadership').map(fact => ({ name: fact.value, roles: [fact.label.replace(/^Published /, '')], sources: [{ label: fact.sourceLabel, url: fact.sourceUrl, snippet: '' }], confidence: fact.confidence }));
}

const PHONE_QUERY = /^"\d{3}-\d{3}-\d{4}"/;
const SOURCES: Array<{ id: string; label: string; match: (result: WebSearchResult) => boolean }> = [
  { id: 'official', label: 'Their website', match: r => r.sourceKind === 'official_site' },
  { id: 'registry', label: 'State records', match: r => r.sourceKind === 'government_registry' || host(r.url).endsWith('bizapedia.com') || host(r.url).endsWith('opencorporates.com') },
  { id: 'bbb', label: 'BBB', match: r => host(r.url).endsWith('bbb.org') },
  { id: 'social', label: 'Facebook and LinkedIn', match: r => host(r.url).endsWith('facebook.com') || host(r.url).endsWith('linkedin.com') },
  { id: 'phone', label: 'Reverse phone', match: r => r.matchedQueries.some(query => PHONE_QUERY.test(query)) },
  { id: 'news', label: 'News and directories', match: r => r.sourceKind === 'news' || (r.sourceKind === 'directory' && !host(r.url).endsWith('bizapedia.com')) },
];
const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'records', label: 'Records', match: (r: WebSearchResult) => ['government_registry', 'professional_registry'].includes(r.sourceKind) || host(r.url).endsWith('bizapedia.com') },
  { id: 'social', label: 'Social', match: (r: WebSearchResult) => r.sourceKind === 'social' },
  { id: 'official', label: 'Website', match: (r: WebSearchResult) => r.sourceKind === 'official_site' },
  { id: 'other', label: 'Other', match: (r: WebSearchResult) => ['directory', 'news', 'other'].includes(r.sourceKind) && !host(r.url).endsWith('bizapedia.com') },
] as const;
const KIND: Record<string, string> = { official_site: 'Website', government_registry: 'State record', professional_registry: 'License', social: 'Social', directory: 'Directory', news: 'News', other: 'Web' };

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return <>{text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>)}</>;
}

export function ResearchTab({ card, research, researching, pending, applyContact }: { card: SwarmProspect; research?: () => void; researching: boolean; pending: boolean; applyContact: (name: string) => void }) {
  const p = card.business;
  const intelligence = card.intelligence;
  const people = researchPeople(card);
  const brief = intelligence?.brief;
  const results = useMemo(() => intelligence?.searchResults ?? [], [intelligence]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [copied, setCopied] = useState(false);
  const links = useMemo(() => lookupLinks(p, people.map(person => person.name)), [p, people]);
  const link = (id: string) => links.find(item => item.id === id)?.url;
  const lead = (brief?.askFor && people.find(person => person.name === brief.askFor)) || people[0];
  const others = people.filter(person => person !== lead);
  const facts = intelligence?.facts ?? [];
  const contacts = facts.filter(fact => ['phone', 'email'].includes(fact.kind));
  const records = facts.filter(fact => ['legal_name', 'company_id', 'founded', 'team_size'].includes(fact.kind));
  const terms = useMemo(() => [...people.map(person => person.name), ...p.name.split(/\s+/).filter(word => word.length >= 4 && !/^(the|and|llc|inc|company)$/i.test(word))], [people, p.name]);
  const shown = results.filter(FILTERS.find(item => item.id === filter)!.match);

  async function copyBrief() {
    const text = [lead && `Ask for: ${lead.name} (${lead.roles.join(', ')})`, brief?.summary, ...(brief?.talkingPoints ?? []).map(point => `• ${point}`)].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* Clipboard is optional. */ }
  }

  const rail = <aside className="spr-rail">
    <Card className="spr-look">
      <h3>Look it up yourself</h3>
      <div className="spr-look-people">
        {[['TruePeopleSearch', 'tps'], ['FastPeopleSearch', 'fps']].map(([label, key]) => <div key={key}><span>{label}</span><div>{link(`${key}-phone`) && <a href={link(`${key}-phone`)} target="_blank" rel="noreferrer">By phone</a>}{link(`${key}-address`) && <a href={link(`${key}-address`)} target="_blank" rel="noreferrer">By address</a>}</div></div>)}
        {people.slice(0, 3).map(person => { const url = link(`tps-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`); return url ? <div key={person.name}><span>{person.name}</span><div><a href={url} target="_blank" rel="noreferrer">Look up</a></div></div> : null; })}
      </div>
      <h4>Business records</h4>
      <ul className="spr-look-list">{links.filter(item => item.group === 'records').map(item => <li key={item.id}><a href={item.url} target="_blank" rel="noreferrer"><span>{item.label}<small>{item.detail}</small></span><ArrowUpRight size={13}/></a></li>)}</ul>
      <h4>Web and social</h4>
      <ul className="spr-look-list">{links.filter(item => item.group === 'web').map(item => <li key={item.id}><a href={item.url} target="_blank" rel="noreferrer"><span>{item.label}<small>{item.detail}</small></span><ArrowUpRight size={13}/></a></li>)}</ul>
    </Card>
    {(contacts.length > 0 || records.length > 0) && <Card className="spr-facts">
      {contacts.length > 0 && <><h3>Contact details</h3><ul>{contacts.map(fact => <li key={fact.id}>{fact.kind === 'phone' ? <Phone size={13}/> : <Mail size={13}/>}<div>{fact.kind === 'phone' ? <CopyContact label="phone number" value={digits(fact.value)}/> : <CopyContact label="email" value={fact.value}/>}<small>{fact.sourceLabel}</small></div></li>)}</ul></>}
      {records.length > 0 && <><h3>Company records</h3><ul>{records.map(fact => <li key={fact.id}><FileText size={13}/><div><span>{fact.value}</span><small>{fact.label}</small></div></li>)}</ul></>}
    </Card>}
  </aside>;

  if (researching || !intelligence) return <motion.div className="spr" variants={stagger} initial="hidden" animate="show">
    <div className="spr-main">
      <Card className="spr-start">
        <h3>{researching ? 'Looking into this business' : 'Find out who you are calling'}</h3>
        <p>{researching ? 'Checking the sources below for the owner or manager. This usually takes about 30 seconds.' : 'Research checks the sources below for the owner or manager, then writes a short brief for the call.'}</p>
        <ul className="spr-checks">{SOURCES.map(source => <li key={source.id}>{researching ? <LoaderCircle size={13} className="sw-spin"/> : <i/>}{source.label}</li>)}</ul>
        {researching ? <span className="spr-busy"><LoaderCircle size={14} className="sw-spin"/>Searching…</span> : research && <button type="button" className="spr-go" disabled={pending} onClick={research}>Run research</button>}
      </Card>
    </div>
    {rail}
  </motion.div>;

  return <motion.div className="spr" variants={stagger} initial="hidden" animate="show">
    <div className="spr-main">
      <Card className="spr-person">
        {lead ? <>
          <small>Ask for</small>
          <div className="spr-person-row">
            <span className="spx-avatar lg" style={{ '--h': hue(lead.name) } as React.CSSProperties}>{initials(lead.name)}</span>
            <div><h3>{lead.name}</h3><p>{lead.roles.join(' · ')}{lead.confidence === 'Verified' ? <em className="ok"><BadgeCheck size={12}/>Confirmed</em> : <em>Likely</em>}</p></div>
            <button type="button" onClick={() => applyContact(lead.name)}><UserRoundCheck size={14}/>Use as contact</button>
          </div>
          {brief?.reason && <p className="spr-why">{brief.reason}</p>}
          {lead.sources.length > 0 && <p className="spr-from">Found on {lead.sources.slice(0, 3).map((source, index) => <Fragment key={source.url}>{index > 0 && ', '}<a href={safeUrl(source.url)} target="_blank" rel="noreferrer" title={source.snippet}>{source.label}</a></Fragment>)}</p>}
          {others.length > 0 && <div className="spr-others"><span>Also connected</span>{others.map(person => <button key={person.name} type="button" onClick={() => applyContact(person.name)} title={`Use ${person.name} as contact`}>{person.name}{person.roles[0] && <em>{person.roles[0]}</em>}</button>)}</div>}
        </> : <>
          <small>Ask for</small>
          <h3>No owner named yet</h3>
          <p className="spr-why">Public sources did not name anyone. For a small business, a reverse lookup on the listed phone or address usually does.</p>
          <div className="spr-quick">{link('tps-phone') && <a href={link('tps-phone')} target="_blank" rel="noreferrer">Reverse phone<ArrowUpRight size={12}/></a>}{link('fps-address') && <a href={link('fps-address')} target="_blank" rel="noreferrer">Who is at this address<ArrowUpRight size={12}/></a>}</div>
        </>}
      </Card>

      {brief && (brief.summary || brief.talkingPoints.length > 0) && <Card className="spr-brief">
        <div className="spx-card-head"><h3>Call brief</h3><button type="button" className="spr-ghost" onClick={() => void copyBrief()}>{copied ? <><Check size={13}/>Copied</> : <><Copy size={13}/>Copy</>}</button></div>
        {brief.summary && <p>{brief.summary}</p>}
        {brief.talkingPoints.length > 0 && <ol>{brief.talkingPoints.map(point => <li key={point}>{point}</li>)}</ol>}
      </Card>}

      <Card className="spr-found">
        <div className="spx-card-head">
          <h3>What we found</h3>
          <div className="spr-found-meta"><span>{intelligence.research.queriesCompleted} searches · {results.length} results · {intelligence.pagesScanned} pages read</span>{research && <button type="button" className="spr-ghost" disabled={pending} onClick={research}><RotateCw size={12}/>Run again</button>}</div>
        </div>
        <ul className="spr-checks done">{SOURCES.map(source => { const count = results.filter(source.match).length; return <li key={source.id} className={count ? 'hit' : undefined}>{count ? <Check size={13} strokeWidth={2.5}/> : <i/>}{source.label}{count > 0 && <b>{count}</b>}</li>; })}</ul>
        {results.length > 0 && <>
          <div className="spr-filters" role="group" aria-label="Filter findings">{FILTERS.map(item => { const count = results.filter(item.match).length; return count || item.id === 'all' ? <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<small>{count}</small></button> : null; })}</div>
          <ol className="spr-results">{shown.slice(0, 20).map(result => safeUrl(result.url) && <li key={result.id}>
            <a href={safeUrl(result.url)} target="_blank" rel="noreferrer">
              <span className="spr-results-top">{host(result.url)}<em>{KIND[result.sourceKind] ?? 'Web'}</em></span>
              <strong><Highlight text={result.title} terms={terms}/></strong>
              {result.snippet && <p><Highlight text={normalizePhonesForCopy(result.snippet)} terms={terms}/></p>}
            </a>
          </li>)}</ol>
        </>}
        {!results.length && <p className="spx-muted">Nothing came back from the web search. Try the lookups on the right.</p>}
      </Card>
    </div>
    {rail}
  </motion.div>;
}
