"use client";
import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Bookmark, ChevronRight, EyeOff, ScanLine, RotateCcw, Search } from 'lucide-react';
import { useClickIntent, isContactInteraction } from './use-click-intent';
import { CopyContact } from '@/components/swarm/copy-contact';
import { ProviderLabels } from '@/components/swarm/provider-labels';
import { digits, type LeadRecord } from '@/lib/swarm/lead-book';

export function SavedBusinesses({ records, ready, open, restore, findOpportunities, hide, dismissing }: { records: LeadRecord[]; ready: boolean; open: (key: string) => void; restore: (record: LeadRecord) => Promise<void>; findOpportunities: () => void; hide: (record: LeadRecord) => Promise<void>; dismissing: Set<string> }) {
  const intent=useClickIntent();
  const reduce=useReducedMotion();
  const [tab, setTab] = useState<'saved' | 'hidden'>('saved');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [restoring, setRestoring] = useState('');
  const [error, setError] = useState('');
  const saved = records.filter(r=>r.disposition==='saved');
  const filtered = records.filter(r => r.disposition === tab && (filter==='all'||(filter==='untouched'?!r.activity:r.activity?.outcome===filter)) && [r.card.business.name,r.card.business.address,digits(r.card.business.phone),r.contactName,r.notes].join(' ').toLowerCase().includes(query.toLowerCase())).sort((a,b) => {
    if(filter==='callback') return (a.activity?.callbackAt ?? '').localeCompare(b.activity?.callbackAt ?? '');
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  async function undo(record: LeadRecord) { setRestoring(record.key); try { await restore(record); setError(''); } catch { setError('Could not restore the business. Please try again.'); } finally { setRestoring(''); } }
  return <div className="sw-saved-page">
    <div className="sw-result-heading"><div><span className="sw-overline">YOUR LEAD BOOK</span><h1>Saved businesses</h1><p>The contact, the context, and the next conversation.</p></div><button className="sw-primary" onClick={findOpportunities}><ScanLine size={15}/>Find opportunities</button></div>
    <div className="sw-book-overview"><span><strong>{saved.length}</strong> saved businesses</span><span><strong>{saved.filter(r=>r.activity?.outcome==='callback').length}</strong> callbacks</span><span><strong>{saved.filter(r=>!r.activity).length}</strong> not called yet</span></div>
    <div className="sw-saved-toolbar"><div className="sw-tabs">{(['saved','hidden'] as const).map(key=><button key={key} className={tab===key?'active':''} aria-pressed={tab===key} onClick={()=>{setTab(key);setFilter('all');}}>{key==='saved'?<Bookmark size={14}/>:<EyeOff size={14}/>} {key==='saved'?'Saved':'Hidden'} <small>{records.filter(r=>r.disposition===key).length}</small></button>)}</div><label className="sw-search"><Search size={15}/><input aria-label="Search saved businesses" placeholder="Name, contact, or notes" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="Call outcome filter" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All outcomes</option><option value="untouched">Not called yet</option><option value="callback">Callbacks</option><option value="connected">Connected</option><option value="no_answer">No answer</option></select></div>
    {error&&<p role="alert" className="sw-error">{error}</p>}
    <div className="sw-book-table"><div className="sw-book-columns" aria-hidden="true"><span>Business / contact</span><span>Last conversation</span><span>Reported providers</span><span/></div><AnimatePresence initial={false}>{filtered.map(record=><motion.article initial={{opacity:0,y:4}} animate={dismissing.has(record.card.id)&&!reduce?{opacity:1,x:[0,-4,4,-3,0]}:{opacity:1,x:0,y:0}} exit={reduce?{opacity:0}:{opacity:0,scale:.96,x:18,filter:'blur(5px)'}} transition={{duration:.28}} onDoubleClick={event=>{if(tab==='saved'&&!isContactInteraction(event.target)){intent.cancel();void hide(record);}}} key={record.key} className="sw-book-row">
      <div className="sw-book-identity"><span className="sw-category-label">{record.card.business.category}</span><button className="sw-saved-name" title="Open profile · Double-click to hide this business" onClick={event=>intent.open(event,()=>open(record.key))}>{record.card.business.name}<ChevronRight size={16}/></button>{record.contactName&&<p className="sw-book-contact">Ask for <strong>{record.contactName}</strong></p>}<CopyContact label="address" value={record.card.business.address}/>{digits(record.card.business.phone)&&<CopyContact label="phone number" className="sw-book-phone" value={digits(record.card.business.phone)}/>}</div>
      <div className="sw-book-conversation"><span className={'sw-call-state '+(record.activity?.outcome ?? 'untouched')}>{record.activity?.outcome==='callback'?'Call back':record.activity?.outcome==='connected'?'Connected':record.activity?.outcome==='no_answer'?'No answer':'Not called yet'}</span>{record.activity?.callbackAt&&<strong className="sw-book-callback">{new Date(record.activity.callbackAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</strong>}<p>{record.notes||'Add a note before your next call.'}</p><small>Updated {new Date(record.updatedAt).toLocaleDateString()}</small></div>
      <div className="sw-book-providers"><ProviderLabels providers={record.card.broadband?.observations.map(o=>o.provider)??[]}/>{!record.card.broadband?.observations.length&&<small>No availability confirmed</small>}</div>
      <div className="sw-book-actions">{tab==='hidden'?<button className="sw-secondary" disabled={restoring===record.key} onClick={()=>void undo(record)}><RotateCcw size={14}/>Restore</button>:<button className="sw-secondary" onClick={()=>open(record.key)}>Edit notes<ChevronRight size={14}/></button>}</div>
    </motion.article>)}</AnimatePresence></div>
    {!filtered.length&&<div className="sw-empty"><Bookmark size={25}/><p>{!ready?'Loading saved businesses…':query||filter!=='all'?'No businesses match these filters.':tab==='saved'?'Save a business from its profile to keep it here with your notes.':'Hidden businesses stay out of your Swarm results.'}</p></div>}
  </div>;
}
