"use client";
import { ArrowUpRight, BadgeCheck, Check, MessagesSquare, UserRoundCheck } from 'lucide-react';
import { Card, hue, initials, researchPeople, safeUrl } from '@/components/swarm/swarm-research';
import type { SwarmProspect } from '@/lib/swarm/types';
import './swarm-who.css';

// Nothing to show until research actually finds a name — no placeholder "Not found yet" card.
export function WhoToAsk({ card, contactName, applyContact }: {
  card: SwarmProspect; contactName: string; applyContact: (name: string) => void;
}) {
  const p = card.business;
  const people = researchPeople(card);
  const brief = card.intelligence?.brief;
  const lead = (brief?.askFor && people.find(person => person.name === brief.askFor)) || people[0];
  const others = people.filter(person => person !== lead).slice(0, 3);
  if (!lead) return null;

  return <Card className="spw found">
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
}
