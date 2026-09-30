"use client";
import { useMemo } from 'react';
import { ArrowUpRight, BadgeCheck, Building2, Check, LoaderCircle, MessagesSquare, PhoneIncoming, Search, Sparkles, UserRoundCheck } from 'lucide-react';
import { Card, hue, initials, researchPeople, safeUrl } from '@/components/swarm/swarm-research';
import { lookupLinks } from '@/lib/swarm/lookup-links';
import type { SwarmProspect } from '@/lib/swarm/types';
import './swarm-who.css';

export function WhoToAsk({ card, contactName, applyContact, research, researching, pending }: {
  card: SwarmProspect; contactName: string; applyContact: (name: string) => void;
  research?: () => void; researching: boolean; pending: boolean;
}) {
  const p = card.business;
  const people = researchPeople(card);
  const brief = card.intelligence?.brief;
  const lead = (brief?.askFor && people.find(person => person.name === brief.askFor)) || people[0];
  const others = people.filter(person => person !== lead).slice(0, 3);
  const links = useMemo(() => lookupLinks(p, []), [p]);
  const link = (id: string) => links.find(item => item.id === id)?.url;

  if (lead) return <Card className="spw found">
    <div className="spw-row">
      <span className="spw-ring"><span className="spx-avatar lg" style={{ '--h': hue(lead.name) } as React.CSSProperties}>{initials(lead.name)}</span></span>
      <div className="spw-id">
        <small>Who to ask for</small>
        <strong>{lead.name}</strong>
        <span>{lead.roles.join(' · ')}<em className={lead.confidence === 'Verified' ? 'ok' : ''}>{lead.confidence === 'Verified' ? <><BadgeCheck size={12}/>Confirmed</> : 'Likely'}</em></span>
      </div>
      {contactName === lead.name ? <span className="spx-set"><Check size={13}/>Contact</span> : <button type="button" className="spw-use" onClick={() => applyContact(lead.name)}><UserRoundCheck size={14}/>Use as contact</button>}
    </div>
    {brief?.reason && <p className="spw-why">{brief.reason}</p>}
    {lead.sources.length > 0 && <div className="spw-sources">{lead.sources.slice(0, 3).map(source => safeUrl(source.url) && <a key={source.url} href={safeUrl(source.url)} target="_blank" rel="noreferrer" title={source.snippet}>{source.label}<ArrowUpRight size={11}/></a>)}</div>}
    <div className="spw-script"><MessagesSquare size={14}/><div><small>When they pick up</small><q>Hi, is {lead.name} available? It&apos;s about the phone and internet for {p.name}.</q></div></div>
    {others.length > 0 && <div className="spw-others"><span>Also connected</span>{others.map(person => <button key={person.name} type="button" onClick={() => applyContact(person.name)} title={`Use ${person.name} as contact`}>{person.name}<em>{person.roles[0]}</em></button>)}</div>}
  </Card>;

  return <Card className="spw">
    <div className="spw-row">
      <span className="spw-ring idle"><span className="spx-avatar lg ghost">{researching ? <LoaderCircle size={18} className="sw-spin"/> : <Search size={18}/>}</span></span>
      <div className="spw-id">
        <small>Who to ask for</small>
        <strong>{researching ? 'Looking for the owner…' : 'Not found yet'}</strong>
        <span>{researching ? 'Checking registries, reviews, social, and reverse phone.' : card.intelligence ? 'No name in public sources. Try the lookups below.' : 'Run research to find the owner or manager, or look them up yourself.'}</span>
      </div>
      {!card.intelligence && research && !researching && <button type="button" className="spw-use glow" disabled={pending} onClick={research}><Sparkles size={14}/>Research</button>}
    </div>
    {!researching && (link('tps-phone') || link('fps-address')) && <div className="spw-quick">
      {link('tps-phone') && <a href={link('tps-phone')} target="_blank" rel="noreferrer"><PhoneIncoming size={13}/>Reverse phone<ArrowUpRight size={11}/></a>}
      {link('fps-address') && <a href={link('fps-address')} target="_blank" rel="noreferrer"><Building2 size={13}/>Who&apos;s at this address<ArrowUpRight size={11}/></a>}
    </div>}
  </Card>;
}
