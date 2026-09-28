"use client";
import { Fragment, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, animate, motion } from 'motion/react';
import { ArrowUpRight, BadgeCheck, Briefcase, Building2, Check, Copy, FileText, Globe, Landmark, Mail, MessagesSquare, Newspaper, Phone, PhoneIncoming, Radar, ShieldCheck, Sparkles, Store, UserRoundCheck, UserRoundSearch, Users } from 'lucide-react';
import { CopyContact } from '@/components/swarm/copy-contact';
import { digits } from '@/lib/swarm/lead-book';
import { lookupLinks } from '@/lib/swarm/lookup-links';
import { normalizePhonesForCopy } from '@/lib/phone';
import type { ResearchPerson, WebSearchResult } from '@/lib/types';
import type { SwarmProspect } from '@/lib/swarm/types';
import './swarm-research.css';

export const rise = { hidden: { opacity: 0, y: 14, filter: 'blur(6px)' }, show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { type: 'spring' as const, stiffness: 320, damping: 30 } } };
export const stagger = { hidden: {}, show: { transition: { staggerChildren: .06, delayChildren: .04 } } };

export function safeUrl(value?: string | null) { try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } }
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };
export function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]?.toUpperCase()).join(''); }
export function hue(name: string) { let h = 0; for (const char of name) h = (h * 31 + char.charCodeAt(0)) % 360; return h; }

/** Cards that light up under the pointer. */
export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <motion.section variants={rise} className={`spx-card ${className}`} onPointerMove={event => { const box = event.currentTarget.getBoundingClientRect(); event.currentTarget.style.setProperty('--mx', `${event.clientX - box.left}px`); event.currentTarget.style.setProperty('--my', `${event.clientY - box.top}px`); }}>{children}</motion.section>;
}

/** People from this research, falling back to leadership facts saved by older research runs. */
export function researchPeople(card: SwarmProspect): ResearchPerson[] {
  const intelligence = card.intelligence;
  if (!intelligence) return [];
  if (intelligence.people) return intelligence.people;
  return intelligence.facts.filter(fact => fact.kind === 'leadership').map(fact => ({ name: fact.value, roles: [fact.label.replace(/^Published /, '')], sources: [{ label: fact.sourceLabel, url: fact.sourceUrl, snippet: '' }], confidence: fact.confidence }));
}

const PHONE_QUERY = /^"\d{3}-\d{3}-\d{4}"/;
const COVERAGE: Array<{ id: string; label: string; Icon: typeof Globe; match: (result: WebSearchResult) => boolean }> = [
  { id: 'web', label: 'Web search', Icon: Globe, match: () => true },
  { id: 'official', label: 'Official website', Icon: Store, match: r => r.sourceKind === 'official_site' },
  { id: 'registry', label: 'State registries', Icon: Landmark, match: r => r.sourceKind === 'government_registry' },
  { id: 'bizapedia', label: 'Bizapedia', Icon: FileText, match: r => host(r.url).endsWith('bizapedia.com') },
  { id: 'opencorporates', label: 'OpenCorporates', Icon: Briefcase, match: r => host(r.url).endsWith('opencorporates.com') },
  { id: 'bbb', label: 'BBB', Icon: ShieldCheck, match: r => host(r.url).endsWith('bbb.org') },
  { id: 'linkedin', label: 'LinkedIn', Icon: Users, match: r => host(r.url).endsWith('linkedin.com') },
  { id: 'facebook', label: 'Facebook', Icon: MessagesSquare, match: r => host(r.url).endsWith('facebook.com') },
  { id: 'phone', label: 'Reverse phone', Icon: PhoneIncoming, match: r => r.matchedQueries.some(query => PHONE_QUERY.test(query)) },
  { id: 'news', label: 'News and directories', Icon: Newspaper, match: r => r.sourceKind === 'news' || (r.sourceKind === 'directory' && !host(r.url).endsWith('bizapedia.com')) },
];
const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'records', label: 'Records', match: (r: WebSearchResult) => ['government_registry', 'professional_registry'].includes(r.sourceKind) || host(r.url).endsWith('bizapedia.com') },
  { id: 'social', label: 'Social', match: (r: WebSearchResult) => r.sourceKind === 'social' },
  { id: 'official', label: 'Official', match: (r: WebSearchResult) => r.sourceKind === 'official_site' },
  { id: 'other', label: 'Directories and web', match: (r: WebSearchResult) => ['directory', 'news', 'other'].includes(r.sourceKind) && !host(r.url).endsWith('bizapedia.com') },
] as const;

function Count({ value }: { value: number }) {
  const [shown, setShown] = useState(0);
  useEffect(() => { const control = animate(0, value, { duration: .9, ease: [.2, .8, .2, 1], onUpdate: next => setShown(Math.round(next)) }); return () => control.stop(); }, [value]);
  return <>{shown}</>;
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return <>{text.split(pattern).map((part, index) => index % 2 ? <mark key={index}>{part}</mark> : <Fragment key={index}>{part}</Fragment>)}</>;
}

function Coverage({ results, scanning, idle = false }: { results: WebSearchResult[]; scanning: boolean; idle?: boolean }) {
  return <div className={`spx-cov ${scanning ? 'scanning' : ''}`}>
    {scanning && <span className="spx-cov-beam" aria-hidden/>}
    {COVERAGE.map(({ id, label, Icon, match }, index) => {
      const count = results.filter(match).length;
      return <motion.div key={id} className={`spx-cov-tile ${!scanning && count ? 'hit' : ''}`} initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * .035, type: 'spring', stiffness: 400, damping: 30 }}>
        <span className="spx-cov-icon"><Icon size={14}/></span>
        <span className="spx-cov-label">{label}</span>
        <span className="spx-cov-state">{scanning ? <i className="spx-dots"><b/><b/><b/></i> : idle ? <small>Ready</small> : count ? <><motion.em initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: .25 + index * .04, type: 'spring', stiffness: 500, damping: 20 }}><Check size={10} strokeWidth={3}/></motion.em>{count}</> : <small>none</small>}</span>
      </motion.div>;
    })}
  </div>;
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
  const facts = intelligence?.facts ?? [];
  const contacts = facts.filter(fact => ['phone', 'email'].includes(fact.kind));
  const records = facts.filter(fact => ['legal_name', 'company_id', 'founded', 'team_size'].includes(fact.kind));
  const terms = useMemo(() => [...people.map(person => person.name), ...p.name.split(/\s+/).filter(word => word.length >= 4 && !/^(the|and|llc|inc|company)$/i.test(word))], [people, p.name]);
  const shown = results.filter(FILTERS.find(item => item.id === filter)!.match);
  const hits = COVERAGE.filter(source => source.id !== 'web' && results.some(source.match)).length;
  const cityState = (() => { const parts = p.address.split(',').map(part => part.trim()); return parts.length >= 3 ? `${parts.at(-2)}, ${parts.at(-1)?.split(' ')[0]}` : ''; })();

  async function copyBrief() {
    const text = [lead && `Ask for: ${lead.name} (${lead.roles.join(', ')})`, brief?.summary, ...(brief?.talkingPoints ?? []).map(point => `• ${point}`)].filter(Boolean).join('\n');
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* Clipboard is optional. */ }
  }

  const rail = <aside className="spx-rail">
    <Card className="spx-lookup">
      <h3><UserRoundSearch size={15}/>Reverse lookup</h3>
      {[['TruePeopleSearch', 'tps'], ['FastPeopleSearch', 'fps']].map(([label, key]) => <div key={key} className="spx-lookup-row site"><span className={`spx-mono ${key}`}>{key === 'tps' ? 'T' : 'F'}</span><strong>{label}</strong><div>{link(`${key}-phone`) && <a href={link(`${key}-phone`)} target="_blank" rel="noreferrer"><Phone size={12}/>Phone</a>}{link(`${key}-address`) && <a href={link(`${key}-address`)} target="_blank" rel="noreferrer"><Building2 size={12}/>Address</a>}</div></div>)}
      {people.slice(0, 3).map(person => <div key={person.name} className="spx-lookup-row person"><span className="spx-avatar sm" style={{ '--h': hue(person.name) } as React.CSSProperties}>{initials(person.name)}</span><strong>{person.name}</strong><div><a href={link(`tps-${person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`)} target="_blank" rel="noreferrer">TPS</a><a href={`https://www.fastpeoplesearch.com/name/${person.name.toLowerCase().replace(/[^a-z]+/g, '-')}${cityState ? `_${cityState.toLowerCase().replace(/[^a-z]+/g, '-')}` : ''}`} target="_blank" rel="noreferrer">FPS</a></div></div>)}
      <h4>Business records</h4>
      <div className="spx-lookup-list">{links.filter(item => item.group === 'records').map(item => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span><strong>{item.label}</strong><small>{item.detail}</small></span><ArrowUpRight size={13}/></a>)}</div>
      <h4>Web and social</h4>
      <div className="spx-lookup-list">{links.filter(item => item.group === 'web').map(item => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><span><strong>{item.label}</strong><small>{item.detail}</small></span><ArrowUpRight size={13}/></a>)}</div>
    </Card>
    {(contacts.length > 0 || records.length > 0) && <Card className="spx-found-facts">
      {contacts.length > 0 && <><h3><Phone size={15}/>Contact details</h3><ul>{contacts.map(fact => <li key={fact.id}>{fact.kind === 'phone' ? <Phone size={12}/> : <Mail size={12}/>}<div>{fact.kind === 'phone' ? <CopyContact label="phone number" value={digits(fact.value)}/> : <CopyContact label="email" value={fact.value}/>}<small>{fact.sourceLabel}</small></div></li>)}</ul></>}
      {records.length > 0 && <><h3><Landmark size={15}/>Company records</h3><ul>{records.map(fact => <li key={fact.id}><FileText size={12}/><div><span>{fact.value}</span><small>{fact.label}</small></div></li>)}</ul></>}
    </Card>}
  </aside>;

  if (researching || !intelligence) return <motion.div className="spx-rs" variants={stagger} initial="hidden" animate="show">
    <div className="spx-rs-main">
      <Card className={`spx-launch ${researching ? 'live' : ''}`}>
        <div className="spx-launch-top">
          <span className="spx-orb" aria-hidden><Radar size={20}/></span>
          <div><h3>{researching ? 'Searching every source for who runs this business' : 'Find out who you are calling'}</h3><p>{researching ? 'Registries, reviews, social profiles, and the listed phone number. Usually 20–40 seconds.' : 'One click searches the sources below, pulls out owner and manager names, and writes a call brief.'}</p></div>
          {!researching && research && <button className="spx-rainbow" disabled={pending} onClick={research}><Sparkles size={15}/>Run research</button>}
        </div>
        {researching && <div className="spx-progress" aria-hidden><span/></div>}
        <Coverage results={[]} scanning={researching} idle={!researching}/>
      </Card>
    </div>
    {rail}
  </motion.div>;

  return <motion.div className="spx-rs" variants={stagger} initial="hidden" animate="show">
    <div className="spx-rs-main">
      <Card className={`spx-contact ${lead ? 'found' : ''}`}>
        {lead ? <>
          <div className="spx-contact-id">
            <span className="spx-ring"><span className="spx-avatar xl" style={{ '--h': hue(lead.name) } as React.CSSProperties}>{initials(lead.name)}</span></span>
            <div>
              <small>Ask for</small>
              <h3>{lead.name}</h3>
              <div className="spx-roles">{lead.roles.map(role => <span key={role}>{role}</span>)}<span className={`spx-conf ${lead.confidence === 'Verified' ? 'ok' : ''}`}>{lead.confidence === 'Verified' ? <><BadgeCheck size={12}/>Confirmed</> : 'Likely'}</span></div>
            </div>
            <button type="button" className="spx-use" onClick={() => applyContact(lead.name)}><UserRoundCheck size={15}/>Use as contact</button>
          </div>
          {brief?.reason && <p className="spx-contact-why">{brief.reason}</p>}
          <div className="spx-contact-sources">{lead.sources.slice(0, 4).map(source => <a key={source.url} href={safeUrl(source.url)} target="_blank" rel="noreferrer" title={source.snippet}><Globe size={11}/>{source.label}</a>)}</div>
          {people.length > 1 && <div className="spx-others"><span>Also connected</span>{people.slice(1).map(person => <button key={person.name} type="button" onClick={() => applyContact(person.name)} title={`Use ${person.name} as contact`}><span className="spx-avatar xs" style={{ '--h': hue(person.name) } as React.CSSProperties}>{initials(person.name)}</span>{person.name}<em>{person.roles[0]}</em></button>)}</div>}
        </> : <div className="spx-contact-id none">
          <span className="spx-ring idle"><span className="spx-avatar xl ghost"><UserRoundSearch size={22}/></span></span>
          <div><small>Ask for</small><h3>No owner named yet</h3><p>Checked {hits} {hits === 1 ? 'source' : 'sources'} with results. For a small shop, a reverse lookup on the listed phone usually finds the owner.</p>
            <div className="spx-contact-quick">{link('tps-phone') && <a href={link('tps-phone')} target="_blank" rel="noreferrer"><PhoneIncoming size={13}/>Reverse phone<ArrowUpRight size={12}/></a>}{link('fps-address') && <a href={link('fps-address')} target="_blank" rel="noreferrer"><Building2 size={13}/>Who&apos;s at this address<ArrowUpRight size={12}/></a>}</div>
          </div>
        </div>}
      </Card>

      {brief && (brief.summary || brief.talkingPoints.length > 0) && <motion.section variants={rise} className="spx-brief2">
        <div className="spx-brief2-in">
          <div className="spx-brief2-head"><span><Sparkles size={13}/>Call brief</span><button type="button" onClick={() => void copyBrief()}>{copied ? <><Check size={13}/>Copied</> : <><Copy size={13}/>Copy</>}</button></div>
          {brief.summary && <p>{brief.summary}</p>}
          {brief.talkingPoints.length > 0 && <ol>{brief.talkingPoints.map((point, index) => <motion.li key={point} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .2 + index * .07 }}><b>{index + 1}</b>{point}</motion.li>)}</ol>}
        </div>
      </motion.section>}

      <Card>
        <div className="spx-card-head"><h3>Where we looked</h3><small><b><Count value={intelligence.research.queriesCompleted}/></b> searches · <b><Count value={results.length}/></b> results · <b><Count value={intelligence.pagesScanned}/></b> pages read</small></div>
        <Coverage results={results} scanning={false}/>
      </Card>

      {results.length > 0 && <Card className="spx-feed">
        <div className="spx-card-head"><h3>Findings</h3>{research && <button type="button" className="spx-rerun" disabled={pending} onClick={research}><Radar size={13}/>Run again</button>}</div>
        <div className="spx-filters" role="group" aria-label="Filter findings">{FILTERS.map(item => { const count = results.filter(item.match).length; return count || item.id === 'all' ? <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{filter === item.id && <motion.span layoutId="spx-filter" className="spx-filter-pill" transition={{ type: 'spring', stiffness: 450, damping: 36 }}/>}<span>{item.label}</span><small>{count}</small></button> : null; })}</div>
        <ol className="spx-feed-list"><AnimatePresence initial={false} mode="popLayout">{shown.slice(0, 20).map(result => safeUrl(result.url) && <motion.li key={result.id} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .98 }} transition={{ duration: .18 }}>
          <a href={safeUrl(result.url)} target="_blank" rel="noreferrer">
            <span className={`spx-mono k-${result.sourceKind}`}>{host(result.url)[0]?.toUpperCase()}</span>
            <div><span className="spx-feed-top"><b>{host(result.url)}</b><em data-kind={result.sourceKind}>{result.sourceKind.replace('_', ' ')}</em></span><strong><Highlight text={result.title} terms={terms}/></strong>{result.snippet && <p><Highlight text={normalizePhonesForCopy(result.snippet)} terms={terms}/></p>}</div>
            <ArrowUpRight size={14}/>
          </a>
        </motion.li>)}</AnimatePresence></ol>
      </Card>}
    </div>
    {rail}
  </motion.div>;
}
