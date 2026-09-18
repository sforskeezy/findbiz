"use client";
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowDownToLine, ArrowUpRight, Check, CheckCheck, Copy, ListFilter, LoaderCircle, ScanLine, Search, SlidersHorizontal, UsersRound, X } from 'lucide-react';
import { SwarmDialog } from './swarm-dialog';
import { CopyContact } from './copy-contact';
import { ProviderLabels } from './provider-labels';
import { matchOpportunities, opportunityCsv, type Opportunity, type OpportunityPool, type OpportunityFilters } from '@/lib/swarm/opportunities';
import './opportunity-finder.css';

const defaults:OpportunityFilters={query:'',category:'',provider:'',phoneOnly:true,freshOnly:true,contactOnly:false,similar:null};
export function OpportunityFinder({close,open}:{close:()=>void;open:(item:Opportunity)=>void}) {
  const [pool,setPool]=useState<OpportunityPool|null>(null);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  const [filters,setFilters]=useState(defaults);
  const [selected,setSelected]=useState(new Set<string>());
  const [limit,setLimit]=useState(30);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    async function load() {
      setLoading(true);setError('');
      try {
        const response=await fetch('/api/swarm/opportunities',{cache:'no-store',signal:controller.signal});
        const data=await response.json();
        if(!response.ok)throw new Error(data.error||'Could not load opportunities.');
        setPool(data);setSelected(new Set());
      } catch(e) {if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Could not load opportunities.');}
      finally {if(!controller.signal.aborted)setLoading(false);}
    }
    void load();return()=>controller.abort();
  },[attempt]);
  const matches=useMemo(()=>matchOpportunities(pool?.items??[],filters),[pool,filters]);
  const categories=useMemo(()=>[...new Set(pool?.items.map(p=>p.category))].sort(),[pool]);
  const providers=useMemo(()=>[...new Set(pool?.items.flatMap(p=>p.providers))].sort(),[pool]);
  const shortlist=matches.filter(p=>selected.has(p.key));
  function update(change:Partial<OpportunityFilters>) {setFilters(old=>({...old,...change}));setSelected(new Set());setLimit(30);setMessage('');}
  async function copy() {
    const items=shortlist.length?shortlist:matches;
    try { await navigator.clipboard.writeText(items.map(p=>[p.name,p.phone,p.contact&&`Contact: ${p.contact}`,p.address,p.providers.length&&`Available providers (${p.coverage.toLowerCase()}, ${p.reportedAt??'date unknown'}): ${p.providers.join(', ')}`,p.notes].filter(Boolean).join('\n')).join('\n\n'));setMessage(`${items.length} ${items.length===1?'prospect':'prospects'} copied`); }
    catch {setError('Clipboard unavailable. Export the CSV instead.');}
  }
  function exportList() {
    const items=shortlist.length?shortlist:matches;
    const url=URL.createObjectURL(new Blob(['\uFEFF'+opportunityCsv(items)],{type:'text/csv;charset=utf-8;'}));
    const a=document.createElement('a');a.href=url;a.download='findbiz-opportunities.csv';a.click();URL.revokeObjectURL(url);setMessage(`${items.length} ${items.length===1?'prospect':'prospects'} exported`);
  }
  return <SwarmDialog label="Opportunity finder" close={close} className="sw-finder">
    <header className="sw-finder-header"><div className="sw-finder-title"><span><ScanLine size={20}/></span><div><h2>Opportunity finder</h2><p>Your whole territory. A more focused shortlist.</p></div></div><button className="sw-icon" onClick={close} aria-label="Close opportunity finder"><X size={20}/></button></header>
    <div className="sw-finder-layout">
      <aside className="sw-finder-controls"><div className="sw-finder-section-label"><SlidersHorizontal size={13}/>YOUR TARGET</div>
        <label className="sw-finder-search"><Search size={15}/><input aria-label="Search opportunity territory" placeholder="Business, city, ZIP…" value={filters.query} onChange={e=>update({query:e.target.value})}/></label>
        <div className="sw-finder-presets">
          <button className={!filters.provider&&!filters.contactOnly&&!filters.similar&&filters.phoneOnly&&filters.freshOnly?'active':''} onClick={()=>update({...defaults,query:filters.query})}><CheckCheck size={15}/><span>Ready to call<small>Unworked, with a phone</small></span></button>
          <button className={filters.provider==='spectrum'?'active':''} onClick={()=>update({...defaults,query:filters.query,provider:'spectrum'})}><ScanLine size={15}/><span>Spectrum footprint<small>Charter / Spectrum reported</small></span></button>
          <button className={filters.contactOnly?'active':''} onClick={()=>update({...defaults,query:filters.query,contactOnly:true})}><UsersRound size={15}/><span>Named contacts<small>A person to ask for</small></span></button>
        </div>
        <label className="sw-finder-field">Industry<select value={filters.category} onChange={e=>update({category:e.target.value,similar:null})}><option value="">All industries</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
        <label className="sw-finder-field">Available provider<select value={filters.provider} onChange={e=>update({provider:e.target.value})}><option value="">Any provider</option><option value="spectrum">Spectrum / Charter</option>{providers.map(p=><option key={p}>{p}</option>)}</select></label>
        <div className="sw-finder-checks"><label><input type="checkbox" checked={filters.phoneOnly} onChange={e=>update({phoneOnly:e.target.checked})}/>Has a business phone</label><label><input type="checkbox" checked={filters.freshOnly} onChange={e=>update({freshOnly:e.target.checked})}/>New to my shortlist</label><p>Skips saved businesses, logged calls, and prospects you’ve marked as reviewed.</p></div>
        <div className="sw-finder-context"><ListFilter size={15}/><p>Found a good fit? Use <strong>Find similar</strong> to pull the same industry from every saved Swarm.</p></div>
      </aside>
      <section className="sw-finder-results" aria-label="Matching opportunities" aria-busy={loading}>
        {loading?<div className="sw-finder-loading" role="status"><LoaderCircle size={23} className="sw-spin"/><h3>Matching your territory</h3><p>Combining saved Swarms and removing overlaps.</p><div className="sw-finder-skeleton">{[0,1,2].map(i=><span key={i} style={{animationDelay:`${i*.12}s`}}/>)}</div></div>:<>
          <div className="sw-finder-results-top"><div><strong>{matches.length.toLocaleString()}</strong> matches<span>{pool?.batches??0} Swarms · {pool?.duplicates??0} overlaps removed</span></div><button className="sw-icon" aria-label="Refresh opportunity finder" onClick={()=>setAttempt(n=>n+1)}><Search size={16}/></button></div>
          {filters.similar&&<div className="sw-finder-seed"><UsersRound size={14}/><span>Similar to <strong>{filters.similar.name}</strong><small>Same industry: {filters.similar.category}</small></span><button className="sw-icon" aria-label="Clear similar business" onClick={()=>update({similar:null})}><X size={14}/></button></div>}
          {!!pool?.unavailable&&<p className="sw-finder-warning">{pool.unavailable} batches couldn’t be read. These results are partial. Refresh to try again.</p>}
          <p className="sw-finder-disclosure">Ranked by contact readiness. FCC data describes availability, not the business’s current provider.</p>
          {!!matches.length&&<label className="sw-finder-select"><input type="checkbox" checked={shortlist.length===matches.length} onChange={e=>setSelected(e.target.checked?new Set(matches.map(p=>p.key)):new Set())}/>{shortlist.length?`${shortlist.length} selected`:'Select matches'}</label>}
          <div className="sw-finder-list">{matches.slice(0,limit).map((p,index)=><motion.article key={p.key} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} transition={{duration:.2,delay:Math.min(index,5)*.025}} className={selected.has(p.key)?'selected':''}>
            <input type="checkbox" aria-label={`Shortlist ${p.name}`} checked={selected.has(p.key)} onChange={e=>setSelected(old=>{const next=new Set(old);if(e.target.checked)next.add(p.key);else next.delete(p.key);return next;})}/>
            <div className="sw-finder-business"><div className="sw-finder-business-top"><span>{p.category}</span>{p.saved&&<small>Saved</small>}</div><button className="sw-finder-name" onClick={()=>open(p)}>{p.name}<ArrowUpRight size={14}/></button><CopyContact label="address" value={p.address}/><div className="sw-finder-contact">{p.phone?<CopyContact label="phone number" value={p.phone}/>:<span>No phone listed</span>}{p.contact&&<span>Ask for <strong>{p.contact}</strong></span>}</div><div className="sw-finder-signals">{p.signals.map(s=><span key={s}><Check size={10}/>{s}</span>)}</div><div className="sw-finder-providers"><ProviderLabels providers={p.providers}/>{p.providers.length>0&&<small>{p.coverage} · {p.reportedAt??'Report date unavailable'}</small>}</div><div className="sw-finder-row-footer"><span title={p.sources.map(s=>s.title).join('\n')}>{p.sources.length} source {p.sources.length===1?'Swarm':'Swarms'}</span><button onClick={()=>update({similar:p,category:'',provider:'',contactOnly:false})}><UsersRound size={13}/>Find similar</button></div></div>
          </motion.article>)}</div>
          {!matches.length&&<div className="sw-finder-empty"><Search size={24}/><h3>{pool?.items.length?'No matches with these targets':'No prospects to match yet'}</h3><p>{pool?.items.length?'Try another industry or include businesses already in your shortlist.':'Run a Swarm, then use its discoveries here.'}</p>{!!pool?.items.length&&<button className="sw-secondary" onClick={()=>update({...defaults,phoneOnly:false,freshOnly:false})}>Show all prospects</button>}</div>}
          {matches.length>limit&&<button className="sw-finder-more" onClick={()=>setLimit(n=>n+30)}>Show 30 more<span>{matches.length-limit} remaining</span></button>}
        </>}
        {error&&<div className="sw-error" role="alert">{error}<button onClick={()=>setAttempt(n=>n+1)}>Retry</button></div>}
      </section>
    </div>
    <footer className="sw-finder-footer"><span role="status">{message||`${shortlist.length||matches.length} prospects in your ${shortlist.length?'selection':'filtered list'}`}</span><button className="sw-secondary" onClick={exportList} disabled={loading||!matches.length}><ArrowDownToLine size={14}/>Export CSV</button><button className="sw-primary" onClick={()=>void copy()} disabled={loading||!matches.length}><Copy size={14}/>Copy call sheet</button></footer>
  </SwarmDialog>;
}
