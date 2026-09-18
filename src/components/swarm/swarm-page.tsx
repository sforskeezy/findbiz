"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { ArrowDownToLine, ArrowRight, Check, ChevronLeft, ChevronRight, Copy, FileText, Waypoints, Bookmark, BookmarkCheck, List, LoaderCircle, Map, MapPin, Menu, Pause, Play, Plus, Search, X, Phone, RotateCw } from "lucide-react";
import { BatchList } from '@/components/swarm/batch-list';
import { SwarmIcon } from '@/components/swarm/swarm-icon';
import { useClickIntent, isContactInteraction } from '@/components/swarm/use-click-intent';
import { ModeSwitch } from "@/components/prospect-header";
import { SettingsButton } from "@/components/settings-button";
import { SwarmMap } from "@/components/swarm/swarm-map";
import { CallQueue } from "@/components/swarm/call-queue";
import { SwarmClusters } from "@/components/swarm/swarm-clusters";
import type { TerritoryReview } from "@/lib/swarm/territory";
import { SavedBusinesses } from '@/components/swarm/saved-businesses';
import { useLeadBook } from '@/components/swarm/use-lead-book';
import { CopyContact } from '@/components/swarm/copy-contact';
import { ProviderLabels } from '@/components/swarm/provider-labels';
import { digits, findLead, leadBatch, type LeadRecord } from '@/lib/swarm/lead-book';
import { SwarmDetail } from "@/components/swarm/swarm-detail";
import { exportSwarm, parseAddressBatch, swarmClusters } from "@/lib/swarm/logic";
import { rememberModeLocation } from "@/lib/mode-memory";
import type { SwarmResponse, SwarmProspect, SwarmBatch } from "@/lib/swarm/types";

const working = (status?: string) => ['queued','scanning','qualifying','researching'].includes(status ?? '');
const PAGE_SIZE = 40;
export function SwarmPage() {
  const book = useLeadBook();
  const intent = useClickIntent();
  const reducedMotion = useReducedMotion();
  const [dismissing,setDismissing] = useState<Set<string>>(new Set());
  const dismissingRef = useRef(new Set<string>());
  const [undoAction,setUndoAction] = useState<(()=>Promise<void>)|null>(null);
  const [savedView,setSavedView] = useState(false);
  const [bookDetail,setBookDetail] = useState<string | null>(null);
  const [data,setData] = useState<SwarmResponse | null>(null);
  const [id,setId] = useState<string | null>(null);
  const [draft,setDraft] = useState('');
  const [radius,setRadius] = useState(1);
  const [pending,setPending] = useState(false);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [sidebar,setSidebar] = useState(false);
  const [view,setView] = useState<'prospects'|'map'|'clusters'>('prospects');
  const [query,setQuery] = useState('');
  const [priority,setPriority] = useState('all');
  const [cluster,setCluster] = useState<string | null>(null);
  const [selected,setSelected] = useState<Set<string>>(new Set());
  const [callOpen,setCallOpen] = useState(false);
  const [detail,setDetail] = useState<string | null>(null);
  const [page,setPage] = useState(0);
  const [toast,setToast] = useState('');
  function notify(message: string, undo?: ()=>Promise<void>) { setToast(message); setUndoAction(()=>undo??null); }
  const [reviews,setReviews] = useState<TerritoryReview[]>([]);
  const polling = useRef<{id:string|null;generation:number;controller:AbortController}|null>(null);
  useEffect(() => {
    const load = async () => { try { const response = await fetch('/api/swarm/territory', {cache:'no-store'}); const result = await response.json(); if (!response.ok) throw new Error(result.error); setReviews(result.records); } catch(e) { setError(e instanceof Error ? e.message : 'Reviewed clusters could not load.'); } };
    void load(); window.addEventListener('focus',load); return () => window.removeEventListener('focus',load);
  }, []);
  const initial = useRef(false), revision = useRef(0), currentId = useRef<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const batch = data?.batch?.id === id ? data.batch : null;
  const busy = working(batch?.status);
  const available = useMemo(() => book.ready ? (batch?.prospects ?? []).filter(p => findLead(book.records, p)?.disposition !== 'hidden') : [], [batch,book.records,book.ready]);
  const parsed = useMemo(() => { try { return {...parseAddressBatch(draft), error:''}; } catch(error) { return {addresses:[],duplicates:0,invalid:[],error:error instanceof Error ? error.message : 'Invalid addresses.'}; } },[draft]);
  const refresh = useCallback(async (batchId: string | null) => {
    const generation = revision.current;
    if (polling.current?.id === batchId && polling.current.generation === generation) return;
    polling.current?.controller?.abort();
    const request = {id:batchId,generation,controller:new AbortController()};
    polling.current = request;
    try {
      const response = await fetch(`/api/swarm${batchId ? `?id=${batchId}` : ''}`, {cache:'no-store',signal:request.controller.signal});
      const result = await response.json() as SwarmResponse;
      if (!response.ok) throw new Error(result.error || 'Could not load Swarm.');
      if (batchId && !result.batch) throw new Error('Reconnecting to saved results…');
      if (generation === revision.current && batchId === currentId.current) { setData(result); setError(''); }
    } catch(error) { if (!request.controller.signal.aborted && generation === revision.current) setError(error instanceof Error ? error.message : 'Connection lost.'); }
    finally { if(polling.current===request){polling.current = null; setLoading(false);} }
  },[]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get('batch');
      setSavedView(params.get('view') === 'saved');
      currentId.current = requested; setId(requested); initial.current = true;
      try { setDraft(localStorage.getItem('pai.swarm.draft') ?? ''); } catch { /* Storage is optional. */ }
      void refresh(requested);
    },0);
    const interval = setInterval(() => { if (!document.hidden) void refresh(currentId.current); },4000);
    return () => {clearTimeout(timer);clearInterval(interval);polling.current?.controller?.abort();};
  },[refresh]);
  useEffect(() => { if (initial.current) { try {localStorage.setItem('pai.swarm.draft',draft);} catch { /* Storage is optional. */ } } },[draft]);
  useEffect(() => { if (!toast) return; const timer=setTimeout(()=>setToast(''),undoAction?8000:2500); return ()=>clearTimeout(timer); },[toast,undoAction]);
  function choose(next: string | null) {
    intent.cancel();
    setSavedView(false);setBookDetail(null);setCallOpen(false);
    revision.current++;currentId.current=next;setId(next);setSelected(new Set());setDetail(null);setCluster(null);setQuery('');setPage(0);setSidebar(false);setError('');
    const href=next?`/swarm?batch=${next}`:'/swarm';window.history.replaceState(null,'',href);rememberModeLocation(href);void refresh(next);
  }
  function showSaved() {
    choose(null);setSavedView(true);window.history.replaceState(null,'','/swarm?view=saved');rememberModeLocation('/swarm?view=saved');
  }
  async function action(body: Record<string,unknown>) {
    setPending(true);setError('');revision.current++;
    try {
      const response=await fetch('/api/swarm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json() as SwarmResponse;
      if(!response.ok)throw new Error(result.error||'Could not save your batch.');
      revision.current++;setData(result);
      if(result.batch){currentId.current=result.batch.id;setId(result.batch.id);const href=`/swarm?batch=${result.batch.id}`;window.history.replaceState(null,'',href);rememberModeLocation(href);}
      return true;
    }catch(error){setError(error instanceof Error?error.message:'Please try again.');return false;}finally{setPending(false);}
  }

  async function manageBatch(actionName: string, target: string, title?: string) {
    revision.current++;
    const response=await fetch('/api/swarm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:actionName,id:target,title})});
    const result=await response.json() as SwarmResponse;
    if(!response.ok)throw new Error(result.error||'Could not update batch.');
    revision.current++;
    setData(old=>old?{...old,batches:result.batches,archivedBatches:result.archivedBatches,batch:currentId.current===target?result.batch:old.batch}:result);
    if(actionName==='remove') {
      if(currentId.current===target)choose(null);
      notify('Batch removed',async()=>{await manageBatch('restore',target);notify('Batch restored');});
    } else if(actionName==='restore')notify('Batch restored');
  }
  async function dismissBusiness(card: SwarmProspect, source: SwarmBatch) {
    intent.cancel();
    if(dismissingRef.current.has(card.id))return;
    dismissingRef.current.add(card.id);setDismissing(new Set(dismissingRef.current));
    const previous=findLead(book.records,card);
    try {
      await book.save(card,source,'hidden');
      setSelected(old=>new Set([...old].filter(key=>key!==card.id)));
      notify('Business hidden from all Swarms',async()=>{
        await book.save(card,source,previous?.disposition??'active',previous?{contactName:previous.contactName,notes:previous.notes}:undefined);
        notify('Business restored');
      });
    } catch(e) {setError(e instanceof Error?e.message:'Could not hide this business.');}
    finally {dismissingRef.current.delete(card.id);setDismissing(new Set(dismissingRef.current));}
  }
  const prospects=useMemo(()=>[...available].filter((p)=>(priority==='all'||p.opportunity===priority)&&(!cluster||p.clusterId===cluster)&&`${p.business.name} ${p.business.address} ${p.business.category}`.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.rank-a.rank||a.business.name.localeCompare(b.business.name)),[available,priority,cluster,query]);
  const clusters=useMemo(()=>swarmClusters(available),[available]);
  const maxPage=Math.max(0,Math.ceil(prospects.length/PAGE_SIZE)-1);
  const visible=prospects.slice(Math.min(page,maxPage)*PAGE_SIZE,(Math.min(page,maxPage)+1)*PAGE_SIZE);
  function toggle(key:string){setSelected((old)=>{const next=new Set(old);if(next.has(key))next.delete(key);else next.add(key);return next;});}
  async function exportResults(copy=false){if(!batch)return;const cards=selected.size?available.filter((p)=>selected.has(p.id)):prospects;const csv=exportSwarm(batch,cards);if(copy){try{await navigator.clipboard.writeText(csv);notify(`${cards.length} prospects copied`);}catch{setError('Clipboard unavailable. Use Export CSV instead.');}}else{const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const link=document.createElement('a');link.href=url;link.download=`findbiz-swarm-${batch.id.slice(0,8)}.csv`;link.click();URL.revokeObjectURL(url);}}
  const savedRecord=book.records.find(r=>r.key===bookDetail);
  const inspected=savedRecord?.card ?? available.find((p)=>p.id===detail);
  const inspectedBatch=savedRecord ? leadBatch(savedRecord) : batch;
  const activeRecord=inspected ? findLead(book.records,inspected) : undefined;
  async function saveActive(disposition: LeadRecord['disposition'], edits: {contactName:string;notes:string}) {
    if(!inspected || !inspectedBatch) return;
    await book.save(inspected,inspectedBatch,disposition,edits);
    notify(disposition==='saved'?'Business and notes saved':'Hidden from all Swarm batches');
    if(disposition==='hidden'){setDetail(null);setBookDetail(null);setSelected(old=>new Set([...old].filter(key=>key!==inspected.id)));}
  }
  const scanned=batch?.addresses.filter((a)=>a.status==='complete').length??0;
  const failures=batch?.addresses.filter((a)=>a.status==='error')??[];
  const discovered=batch?.addresses.reduce((sum,a)=>sum+a.discovered,0)??0;
  return <MotionConfig reducedMotion="user"><div className="sw-app">
    {sidebar&&<button className="sw-mobile-shade" aria-label="Close navigation" onClick={()=>setSidebar(false)}/>}
    <aside inert={!!detail || !!bookDetail || callOpen} className={`sw-sidebar ${sidebar?'open':''}`} aria-label="Swarm batches"><div className="sw-brand"><Link href="/" aria-label="PAI home"><Image src="/pai-logo-lockup.png" width={960} height={321} alt="PAI" priority/></Link><button className="sw-icon sw-mobile-only" onClick={()=>setSidebar(false)} aria-label="Close navigation"><X size={18}/></button></div><button className="sw-new" onClick={()=>{choose(null);input.current?.focus();}}><Plus size={17}/>New swarm</button><button className={`sw-saved-nav ${savedView?'active':''}`} onClick={showSaved}><Bookmark size={16}/>Saved businesses<span>{book.records.filter(r=>r.disposition==='saved').length}</span></button><BatchList batches={data?.batches??[]} removed={data?.archivedBatches??[]} selected={savedView?null:id} choose={choose} manage={manageBatch}/><div className="sw-sidebar-bottom"><FileText size={14}/><span>Saved in this workspace</span></div></aside>
    <div className="sw-workspace" inert={!!detail || !!bookDetail || callOpen}><header className="sw-header"><div><button className="sw-icon sw-mobile-only" aria-label="Open navigation" onClick={()=>setSidebar(true)}><Menu size={20}/></button></div><ModeSwitch small/><div><SettingsButton/></div></header>
      <main className="sw-main">{(error||book.error)&&<div className="sw-error" role="alert">{error||book.error}<button className="sw-icon" aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
      {savedView?<SavedBusinesses records={book.records} ready={book.ready} cloud={book.cloud} dismissing={dismissing} hide={record=>dismissBusiness(record.card,leadBatch(record))} startCalls={()=>setCallOpen(true)} open={setBookDetail} restore={async(record)=>{await book.save(record.card,leadBatch(record),'saved');notify('Business restored');}}/>:!id?<motion.div className="sw-entry" initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:.3}}><h1>Swarm mode</h1><p>Drop in a batch of addresses. FindBiz searches them together, removes duplicates, and builds one territory-wide prospect list.</p><form onSubmit={(event)=>{event.preventDefault();void action({action:'create',addresses:draft,radiusMiles:radius});}}><div className="sw-input-label"><label htmlFor="sw-addresses">Addresses</label><span>One per line</span></div><div className="sw-editor"><textarea id="sw-addresses" ref={input} value={draft} onChange={(event)=>setDraft(event.target.value)} spellCheck={false} placeholder={'101 Main St, Columbia, SC\n140 Main St, Columbia, SC\n221 Main St, Columbia, SC'} maxLength={300000}/><div className="sw-editor-footer"><span>{parsed.addresses.length} addresses{parsed.duplicates?` · ${parsed.duplicates} duplicates removed`:''}</span>{draft&&<button type="button" onClick={()=>setDraft('')}>Clear</button>}</div></div>{(parsed.error||parsed.invalid.length>0)&&<p className="sw-validation">{parsed.error||`${parsed.invalid.length} invalid lines. Include a street and city or ZIP.`}</p>}<div className="sw-start-row"><label>Search radius <select aria-label="Radius around each address" value={radius} onChange={(event)=>setRadius(Number(event.target.value))}>{[.25,.5,1,2,5,10].map((r)=><option key={r} value={r}>{r} mi per address</option>)}</select></label><motion.button type="submit" className="sw-primary" disabled={loading||pending||!parsed.addresses.length||!!parsed.invalid.length||!!parsed.error} whileTap={{scale:.98}}>{pending?<LoaderCircle size={16} className="sw-spin"/>:<SwarmIcon size={18}/>}Start swarm<ArrowRight size={15}/></motion.button></div><small className="sw-entry-note">Up to 1,000 addresses per batch. Include a city or ZIP for each address.</small></form></motion.div>:!batch?<div className="sw-loading"><LoaderCircle className="sw-spin" size={20}/><span>{error ? 'Batch unavailable' : 'Loading batch…'}</span></div>:<>
        <div className="sw-result-heading"><div><span className="sw-overline">{busy?'SWARM RUNNING':batch.status==='paused'?'SWARM PAUSED':batch.status==='error'?'SWARM NEEDS ATTENTION':failures.length?'SWARM COMPLETE · PARTIAL COVERAGE':'SWARM COMPLETE'}</span><h1>{batch.title.replace(/^1 addresses/, '1 address')}</h1></div><motion.button className="sw-secondary sw-check-again" whileTap={{scale:.96}} disabled={pending} onClick={()=>void action({action:busy?'pause':batch.status==='complete'&&!failures.length?'refresh':'resume',id:batch.id})}>{pending?<LoaderCircle size={14} className="sw-spin"/>:busy?<Pause size={14}/>:batch.status==='complete'?<RotateCw size={14}/>:<Play size={14}/>} {pending?'Updating…':busy?'Pause':batch.status==='complete'&&!failures.length?'Check again':'Resume'}</motion.button></div>
        <div className="sw-stats">{[[scanned,'addresses scanned'],[discovered,'businesses discovered'],[available.length,'unique prospects'],[available.filter((p)=>p.opportunity==='high').length,'high-priority opportunities'],[clusters.filter((c)=>c.id!=='unmapped').length,'geographic clusters']].map(([count,label])=><div key={label}><motion.strong key={count} initial={{opacity:.4,y:3}} animate={{opacity:1,y:0}}>{count}</motion.strong><span>{label}</span></div>)}</div>
        {busy&&<div className="sw-progress" role="status"><LoaderCircle size={13} className="sw-spin"/><span>{batch.status==='qualifying'?`Checking broadband · ${batch.prospects.filter((p)=>p.broadbandChecked).length} of ${batch.prospects.length}`:batch.status==='researching'?`Researching ${batch.prospects.filter((p)=>p.researchStatus==='researching').map((p)=>p.business.name).join(', ')}`:`Scanning ${scanned+failures.length} of ${batch.addresses.length} addresses`}</span></div>}
        <div className="sw-toolbar"><div className="sw-tabs" aria-label="Result views">{([{key:'prospects',label:'Prospects',Icon:List},{key:'map',label:'Map',Icon:Map},{key:'clusters',label:'Clusters',Icon:Waypoints}] as const).map(({key,label,Icon})=><button key={key} aria-pressed={view===key} className={view===key?'active':''} onClick={()=>setView(key)}>{view===key&&<motion.span layoutId="sw-view" className="sw-tab-pill" transition={{type:'spring',stiffness:380,damping:33}}/>}<Icon size={14}/><span>{label}</span></button>)}</div><div className="sw-export-actions"><button title="Copy CSV" aria-label="Copy prospects" onClick={()=>void exportResults(true)} disabled={!prospects.length}><Copy size={15}/></button><button onClick={()=>void exportResults()} disabled={!prospects.length}><ArrowDownToLine size={15}/>Export CSV</button></div></div>
        <div className="sw-filter-row"><label className="sw-search"><Search size={14}/><input aria-label="Search prospects" placeholder="Search prospects" value={query} onChange={(event)=>{setQuery(event.target.value);setPage(0);}}/></label><select aria-label="Priority filter" value={priority} onChange={(event)=>{setPriority(event.target.value);setPage(0);}}><option value="all">All priorities</option><option value="high">High priority</option><option value="review">Review</option><option value="contact_needed">Find contact</option></select>{cluster&&<button className="sw-cluster-filter" onClick={()=>setCluster(null)}>Cluster selected<X size={12}/></button>}<span className="sw-selection-count">{selected.size?`${selected.size} selected`:''}</span><button className="sw-route-trigger" disabled={!prospects.length} onClick={()=>setCallOpen(true)}><Phone size={14}/>Call queue</button><button className="sw-small-button" disabled={!selected.size||pending} onClick={()=>void action({action:'research',id:batch.id,selected:[...selected]})}><Search size={13}/>Research selected</button></div>
        <AnimatePresence mode="wait" initial={false}><motion.div key={view} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-3}} transition={{duration:.16}}>
        {view==='map'?<SwarmMap prospects={prospects} batchId={batch.id} onSelect={setDetail} reviews={reviews} onCluster={key=>{setCluster(key);setView('prospects');setPage(0);}}/>:view==='clusters'?<SwarmClusters cards={available} reviews={reviews} update={record=>setReviews(old=>[...old.filter(r=>r.key!==record.key),record])} open={key=>{setCluster(key);setView('prospects');setPage(0);}}/>:<><div className="sw-table-wrap"><table><thead><tr><th><input type="checkbox" aria-label="Select visible prospects" checked={!!visible.length&&visible.every((p)=>selected.has(p.id))} onChange={(event)=>setSelected((old)=>{const next=new Set(old);for(const p of visible){if(event.target.checked)next.add(p.id);else next.delete(p.id);}return next;})}/></th><th>Business</th><th>Priority</th><th>Available providers</th><th>Source addresses</th><th>Research</th><th/></tr></thead><tbody><AnimatePresence initial={false}>{visible.map((p)=><motion.tr key={p.id} initial={{opacity:0}} animate={dismissing.has(p.id)&&!reducedMotion?{opacity:1,x:[0,-4,4,-3,3,0]}:{opacity:1,x:0}} exit={reducedMotion?{opacity:0}:{opacity:0,scale:.96,x:18,filter:'blur(5px)'}} transition={{duration:.28}} onDoubleClick={event=>{if(!isContactInteraction(event.target))void dismissBusiness(p,batch);}} className={selected.has(p.id)?'selected':''}><td><input type="checkbox" aria-label={`Select ${p.business.name}`} checked={selected.has(p.id)} onChange={()=>toggle(p.id)}/></td><td><div className="sw-business"><button className="sw-business-name" title="Open profile · Double-click to hide this business" onClick={event=>intent.open(event,()=>setDetail(p.id))}><strong>{p.business.name}</strong>{findLead(book.records,p)?.disposition==='saved'&&<BookmarkCheck size={14}/>}</button><CopyContact label="address" value={p.business.address}/>{digits(p.business.phone)&&<CopyContact label="phone number" value={digits(p.business.phone)} className="sw-row-phone"/>}<small className="sw-category-label">{p.business.category}</small></div></td><td><span className={`sw-status ${p.opportunity}`}>{p.opportunity==='high'?'High priority':p.opportunity==='contact_needed'?'Find contact':'Review'}</span><small className="sw-rank">{p.rank}/100</small></td><td><span className="sw-provider">{p.broadband?.observations.length?<ProviderLabels providers={p.broadband.observations.map(o=>o.provider)}/>:p.broadbandChecked?'Not confirmed':'Queued'}</span>{p.broadband?.asOfDate&&<small className="sw-date">Reported {p.broadband.asOfDate}</small>}</td><td><button className="sw-source-count" onClick={()=>setDetail(p.id)}><MapPin size={12}/>{p.sourceAddressIds.length}</button></td><td><span className="sw-research-status">{p.researchStatus==='listing'?'Listing ready':p.researchStatus==='queued'||p.researchStatus==='researching'?<><LoaderCircle size={11} className="sw-spin"/>Queued research</>:p.researchStatus==='partial'?'Partial':'Researched'}</span></td><td><button className="sw-icon" aria-label={`Open ${p.business.name}`} onClick={()=>setDetail(p.id)}><ChevronRight size={15}/></button></td></motion.tr>)}</AnimatePresence></tbody></table>{!visible.length&&<div className="sw-empty">{busy?'Prospects will appear as each address finishes.':'No prospects match these filters.'}</div>}</div><div className="sw-pagination"><span>{prospects.length?`${Math.min(page,maxPage)*PAGE_SIZE+1}–${Math.min((Math.min(page,maxPage)+1)*PAGE_SIZE,prospects.length)} of ${prospects.length}`:'0 prospects'}</span><div><button className="sw-icon" disabled={page===0} aria-label="Previous page" onClick={()=>setPage(page-1)}><ChevronLeft size={16}/></button><button className="sw-icon" disabled={page>=maxPage} aria-label="Next page" onClick={()=>setPage(page+1)}><ChevronRight size={16}/></button></div></div></>}
        </motion.div></AnimatePresence>
        <details className="sw-address-log"><summary>Address results · {failures.length} failed</summary>{batch.addresses.map((a)=><div key={a.id}><CopyContact label="source address" value={a.text}/><span>{a.status==='complete'?`${a.discovered} found`:a.status}</span>{a.error&&<small>{a.error}</small>}</div>)}</details>
        <p className="sw-data-note">Priority is a prospecting rank, not buying intent. Broadband reports show availability, not the current ISP.</p>
      </>}
      </main>
    </div><AnimatePresence>{callOpen&&(batch||savedView)&&<CallQueue cards={savedView?book.records.filter(r=>r.disposition==='saved').map(r=>r.card):selected.size?available.filter(p=>selected.has(p.id)):prospects} records={book.records} close={()=>setCallOpen(false)} save={async(card,edits)=>{const source=batch??(findLead(book.records,card)?leadBatch(findLead(book.records,card)!):null);if(source)await book.save(card,source,'saved',edits);}}/>}</AnimatePresence><AnimatePresence>{inspected&&inspectedBatch&&<SwarmDetail key={bookDetail??inspected.id} pending={pending} card={inspected} batch={inspectedBatch} record={activeRecord} saveLead={saveActive} close={()=>{setDetail(null);setBookDetail(null);}} research={!savedRecord&&batch?()=>void action({action:'research',id:batch.id,selected:[inspected.id]}):undefined}/>}</AnimatePresence><AnimatePresence>{toast&&<motion.div className="sw-toast" role="status" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}><Check size={15}/>{toast}{undoAction&&<button onClick={()=>{const undo=undoAction;setUndoAction(null);void undo().catch(e=>setError(e instanceof Error?e.message:'Could not undo.'));}}>Undo</button>}</motion.div>}</AnimatePresence>
  </div></MotionConfig>;
}
