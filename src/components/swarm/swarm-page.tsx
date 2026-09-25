"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PaiLogo } from "@/components/pai-logo";
import Link from "next/link";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { ArrowDownToLine, Check, ChevronLeft, ChevronRight, Copy, Funnel, FunnelPlus, ScanLine, Waypoints, Bookmark, BookmarkCheck, List, LoaderCircle, Map, Menu, Pause, Play, Plus, Search, X, RotateCw } from "lucide-react";
import { BatchList, compactBatchTitle } from '@/components/swarm/batch-list';
import { SwarmEntry } from '@/components/swarm/swarm-entry';
import { displayPhone } from '@/components/swarm/funnel-ui';
import { addToFunnel, prospectToFunnel } from '@/lib/swarm/to-funnel';
import { useClickIntent, isContactInteraction } from '@/components/swarm/use-click-intent';
import { ModeSwitch } from "@/components/prospect-header";
import { SettingsButton } from "@/components/settings-button";
import { SwarmMap } from "@/components/swarm/swarm-map";
import { OpportunityFinder } from "@/components/swarm/opportunity-finder";
import { SwarmClusters } from "@/components/swarm/swarm-clusters";
import type { TerritoryReview } from "@/lib/swarm/territory";
import { FunnelWorkspace } from '@/components/swarm/funnel-workspace';
import { SavedBusinesses } from '@/components/swarm/saved-businesses';
import { useLeadBook } from '@/components/swarm/use-lead-book';
import { CopyContact } from '@/components/swarm/copy-contact';
import { ProviderLabels } from '@/components/swarm/provider-labels';
import { digits, findLead, isSpectrumProvider, leadBatch, type LeadRecord } from '@/lib/swarm/lead-book';
import { SwarmDetail } from "@/components/swarm/swarm-detail";
import { exportSwarm, parseAddressBatch, swarmClusters } from "@/lib/swarm/logic";
import { rememberModeLocation } from "@/lib/mode-memory";
import type { SwarmResponse, SwarmProspect, SwarmBatch } from "@/lib/swarm/types";

const working = (status?: string) => ['queued','scanning','qualifying','researching'].includes(status ?? '');
const PAGE_SIZE = 40;
const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g,'');
export function SwarmPage() {
  const book = useLeadBook();
  const intent = useClickIntent();
  const reducedMotion = useReducedMotion();
  const [dismissing,setDismissing] = useState<Set<string>>(new Set());
  const dismissingRef = useRef(new Set<string>());
  const [undoAction,setUndoAction] = useState<(()=>Promise<void>)|null>(null);
  const [savedView,setSavedView] = useState(false);
  const [funnelView,setFunnelView] = useState(false);
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
  const [finderOpen,setFinderOpen] = useState(false);
  const [detail,setDetail] = useState<string | null>(null);
  const [page,setPage] = useState(0);
  const [toast,setToast] = useState('');
  function notify(message: string, undo?: ()=>Promise<void>) { setToast(message); setUndoAction(()=>undo??null); }
  const [reviews,setReviews] = useState<TerritoryReview[]>([]);
  const [funnelNames,setFunnelNames] = useState<Set<string>>(new Set());
  const [adding,setAdding] = useState<Set<string>>(new Set());
  useEffect(() => {
    const load = async () => { try { const response = await fetch('/api/swarm/funnel',{cache:'no-store'}); const result = await response.json(); if (response.ok) setFunnelNames(new Set((result.leads as {businessName:string;archivedAt:string}[]).filter(l=>!l.archivedAt).map(l=>nameKey(l.businessName)))); } catch { /* Funnel markers are a convenience. */ } };
    void load(); window.addEventListener('focus',load); return () => window.removeEventListener('focus',load);
  }, [funnelView]);
  const polling = useRef<{id:string|null;generation:number;controller:AbortController}|null>(null);
  const cachedTag = useRef<{id:string|null;tag:string}|null>(null);
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
      const response = await fetch(`/api/swarm${batchId ? `?id=${batchId}` : ''}`, {cache:'no-store',signal:request.controller.signal,headers:cachedTag.current?.id===batchId?{'If-None-Match':cachedTag.current.tag}:undefined});
      if(response.status===304){if(generation===revision.current)setError('');return;}
      const result = await response.json() as SwarmResponse;
      if (!response.ok) throw new Error(result.error || 'Could not load Swarm.');
      if (batchId && !result.batch) throw new Error('Reconnecting to saved results…');
      if (generation === revision.current && batchId === currentId.current) { setData(result); setError(''); const tag=response.headers.get('etag');cachedTag.current=tag?{id:batchId,tag}:null; }
    } catch(error) { if (!request.controller.signal.aborted && generation === revision.current) setError(error instanceof Error ? error.message : 'Connection lost.'); }
    finally { if(polling.current===request){polling.current = null; setLoading(false);} }
  },[]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const requested = params.get('batch');
      setSavedView(params.get('view') === 'saved');
      setFunnelView(params.get('view') === 'funnel' || params.get('view') === 'notes');
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
    cachedTag.current=null;
    setSavedView(false);setFunnelView(false);setBookDetail(null);setFinderOpen(false);
    revision.current++;currentId.current=next;setId(next);setSelected(new Set());setDetail(null);setCluster(null);setQuery('');setPage(0);setSidebar(false);setError('');
    const href=next?`/swarm?batch=${next}`:'/swarm';window.history.replaceState(null,'',href);rememberModeLocation(href);void refresh(next);
  }
  function showSaved() {
    choose(null);setSavedView(true);window.history.replaceState(null,'','/swarm?view=saved');rememberModeLocation('/swarm?view=saved');
  }
  function showFunnel() {
    choose(null);setFunnelView(true);window.history.replaceState(null,'','/swarm?view=funnel');rememberModeLocation('/swarm?view=funnel');
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
  const highCount=available.filter((p)=>p.opportunity==='high').length;
  const withPhone=available.filter((p)=>digits(p.business.phone).length>=7).length;
  const spectrumCount=available.filter((p)=>p.broadband?.observations.some(o=>isSpectrumProvider(o.provider))).length;
  async function sendToFunnel(cards: SwarmProspect[]) {
    const fresh=cards.filter(p=>!funnelNames.has(nameKey(p.business.name)));
    if(!fresh.length){notify('Already in your funnel');return;}
    setAdding(old=>new Set([...old,...fresh.map(p=>p.id)]));
    try {
      const result=await addToFunnel(fresh.map(p=>prospectToFunnel(p,`Swarm · ${batch?compactBatchTitle(batch.title):'batch'}`,findLead(book.records,p))));
      setFunnelNames(old=>new Set([...old,...fresh.map(p=>nameKey(p.business.name))]));
      notify(fresh.length===1?`${fresh[0].business.name} added to your funnel`:`${result.created} added to your funnel${result.updated?` · ${result.updated} merged`:''}`);
    } catch(e) {setError(e instanceof Error?e.message:'Could not add to your funnel.');}
    finally {setAdding(old=>{const next=new Set(old);for(const p of fresh)next.delete(p.id);return next;});}
  }
  return <MotionConfig reducedMotion="user"><div className="sw-app">
    {sidebar&&<button className="sw-mobile-shade" aria-label="Close navigation" onClick={()=>setSidebar(false)}/>}
    <aside inert={!!detail || !!bookDetail || finderOpen} className={`sw-sidebar ${sidebar?'open':''}`} aria-label="Swarm batches"><div className="sw-brand"><Link href="/" aria-label="PAI home"><PaiLogo height={26}/></Link><button className="sw-icon sw-mobile-only" onClick={()=>setSidebar(false)} aria-label="Close navigation"><X size={18}/></button></div><button className="sw-new" onClick={()=>{choose(null);input.current?.focus();}}><Plus size={17}/>New swarm</button><button className={`sw-saved-nav ${savedView?'active':''}`} onClick={showSaved}><Bookmark size={16}/>Saved businesses<span>{book.records.filter(r=>r.disposition==='saved').length}</span></button><button className={`sw-saved-nav ${funnelView?'active':''}`} onClick={showFunnel}><Funnel size={16}/>Funnel</button><BatchList batches={data?.batches??[]} removed={data?.archivedBatches??[]} selected={savedView||funnelView?null:id} choose={choose} manage={manageBatch}/></aside>
    <div className="sw-workspace" inert={!!detail || !!bookDetail || finderOpen}><header className="sw-header"><div><button className="sw-icon sw-mobile-only" aria-label="Open navigation" onClick={()=>setSidebar(true)}><Menu size={20}/></button></div><ModeSwitch small/><div><SettingsButton/></div></header>
      <main className="sw-main">{(error||book.error)&&<div className="sw-error" role="alert">{error||book.error}<button className="sw-icon" aria-label="Dismiss error" onClick={()=>setError('')}><X size={14}/></button></div>}
      {funnelView?<FunnelWorkspace records={book.records}/>:savedView?<SavedBusinesses toFunnel={record=>sendToFunnel([record.card])} inFunnel={record=>funnelNames.has(nameKey(record.card.business.name))} records={book.records} ready={book.ready} dismissing={dismissing} hide={record=>dismissBusiness(record.card,leadBatch(record))} findOpportunities={()=>setFinderOpen(true)} open={setBookDetail} restore={async(record)=>{await book.save(record.card,leadBatch(record),'saved');notify('Business restored');}}/>:!id?<SwarmEntry draft={draft} setDraft={setDraft} radius={radius} setRadius={setRadius} parsed={parsed} busy={pending} disabled={loading||pending||!parsed.addresses.length||!!parsed.invalid.length||!!parsed.error} submit={()=>void action({action:'create',addresses:draft,radiusMiles:radius})} input={input} batches={data?.batches??[]} choose={choose}/>:!batch?<div className="sw-loading"><LoaderCircle className="sw-spin" size={20}/><span>{error ? 'Batch unavailable' : 'Loading batch…'}</span></div>:<>
        <header className="swx-head">
          <div className="swx-head-copy"><span className={`swx-state ${busy?'live':batch.status==='paused'?'paused':batch.status==='error'?'error':failures.length?'partial':'done'}`}><i/>{busy?(batch.status==='qualifying'?'Checking broadband':batch.status==='researching'?'Researching':'Scanning'):batch.status==='paused'?'Paused':batch.status==='error'?'Needs attention':failures.length?'Complete · partial coverage':'Complete'}</span><h1>{compactBatchTitle(batch.title)}</h1><p>{batch.addresses.length} {batch.addresses.length===1?'address':'addresses'} · {batch.radiusMiles} mi radius · started {new Date(batch.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</p></div>
          <div className="swx-head-actions"><button className="fn-btn" title="Copy as CSV" aria-label="Copy prospects as CSV" onClick={()=>void exportResults(true)} disabled={!prospects.length}><Copy size={15}/></button><button className="fn-btn" onClick={()=>void exportResults()} disabled={!prospects.length}><ArrowDownToLine size={15}/>Export</button><motion.button className="fn-btn fn-btn-dark" whileTap={{scale:.97}} disabled={pending} onClick={()=>void action({action:busy?'pause':batch.status==='complete'&&!failures.length?'refresh':'resume',id:batch.id})}>{pending?<LoaderCircle size={15} className="sw-spin"/>:busy?<Pause size={15}/>:batch.status==='complete'&&!failures.length?<RotateCw size={15}/>:<Play size={15}/>}{pending?'Updating…':busy?'Pause':batch.status==='complete'&&!failures.length?'Check again':'Resume'}</motion.button></div>
        </header>
        {busy&&<div className="swx-progress" role="status"><div className="swx-progress-bar"><span style={{width:`${Math.max(4,Math.round(100*(batch.status==='qualifying'?batch.prospects.filter(p=>p.broadbandChecked).length/Math.max(1,batch.prospects.length):(scanned+failures.length)/Math.max(1,batch.addresses.length))))}%`}}/></div><span><LoaderCircle size={13} className="sw-spin"/>{batch.status==='qualifying'?`Checking broadband · ${batch.prospects.filter((p)=>p.broadbandChecked).length} of ${batch.prospects.length}`:batch.status==='researching'?`Researching ${batch.prospects.filter((p)=>p.researchStatus==='researching').map((p)=>p.business.name).join(', ')}`:`Scanning ${scanned+failures.length} of ${batch.addresses.length} addresses · ${available.length} prospects so far`}</span></div>}
        <section className="swx-stats" aria-label="Swarm summary">
          <div><span>Unique prospects</span><strong>{available.length.toLocaleString()}</strong><small>from {discovered.toLocaleString()} listings</small></div>
          <button className={priority==='high'?'on':''} aria-pressed={priority==='high'} onClick={()=>{setView('prospects');setPriority(priority==='high'?'all':'high');setPage(0);}}><span><i className="swx-dot high"/>High priority</span><strong className="swx-t-high">{highCount}</strong><small>Worth calling first</small></button>
          <div><span>With a phone</span><strong>{withPhone}</strong><small>{available.length?Math.round(100*withPhone/available.length):0}% callable</small></div>
          <div><span>Spectrum reported</span><strong>{spectrumCount}</strong><small>Availability, not current ISP</small></div>
          <button className={view==='clusters'?'on':''} onClick={()=>setView(view==='clusters'?'prospects':'clusters')}><span>Clusters</span><strong>{clusters.filter((c)=>c.id!=='unmapped').length}</strong><small>Territories to work</small></button>
        </section>
        <div className="swx-toolbar">
          <div className="fn-seg swx-views" role="group" aria-label="Result views">{([{key:'prospects',label:'Prospects',Icon:List},{key:'map',label:'Map',Icon:Map},{key:'clusters',label:'Clusters',Icon:Waypoints}] as const).map(({key,label,Icon})=><button key={key} aria-pressed={view===key} onClick={()=>setView(key)}><Icon size={14}/>{label}</button>)}</div>
          <div className="swx-tools">
            <label className="fn-search"><Search size={15}/><input aria-label="Search prospects" placeholder="Search name, address, category" value={query} onChange={(event)=>{setQuery(event.target.value);setPage(0);}}/>{query&&<button aria-label="Clear search" onClick={()=>setQuery('')}><X size={13}/></button>}</label>
            <div className="fn-seg" role="group" aria-label="Priority">{([['all','All',available.length],['high','High',highCount],['review','Review',available.filter(p=>p.opportunity==='review').length],['contact_needed','Find contact',available.filter(p=>p.opportunity==='contact_needed').length]] as const).map(([key,label,count])=><button key={key} aria-pressed={priority===key} onClick={()=>{setPriority(key);setPage(0);}}>{label}{key!=='all'&&<b>{count}</b>}</button>)}</div>
            {cluster&&<button className="swx-chip" onClick={()=>setCluster(null)}>Cluster: {clusters.find(c=>c.id===cluster)?.cards[0]?.business.address.split(',')[0]??'selected'}<X size={12}/></button>}
            <button className="fn-btn" onClick={()=>setFinderOpen(true)}><ScanLine size={15}/>Find opportunities</button>
          </div>
        </div>
        <AnimatePresence mode="wait" initial={false}><motion.div key={view} initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-3}} transition={{duration:.16}}>
        {view==='map'?<SwarmMap prospects={prospects} batchId={batch.id} onSelect={setDetail} reviews={reviews} onCluster={key=>{setCluster(key);setView('prospects');setPage(0);}}/>:view==='clusters'?<SwarmClusters cards={available} reviews={reviews} update={record=>setReviews(old=>[...old.filter(r=>r.key!==record.key),record])} open={key=>{setCluster(key);setView('prospects');setPage(0);}}/>:<><div className="swx-table-wrap"><table className="swx-table"><thead><tr><th><input type="checkbox" aria-label="Select visible prospects" checked={!!visible.length&&visible.every((p)=>selected.has(p.id))} onChange={(event)=>setSelected((old)=>{const next=new Set(old);for(const p of visible){if(event.target.checked)next.add(p.id);else next.delete(p.id);}return next;})}/></th><th>Business</th><th>Phone</th><th>Priority</th><th>Reported providers</th><th aria-label="Actions"/></tr></thead><tbody><AnimatePresence initial={false}>{visible.map((p)=>{const lead=findLead(book.records,p),inFunnel=funnelNames.has(nameKey(p.business.name));return <motion.tr key={p.id} data-priority={p.opportunity} initial={{opacity:0}} animate={dismissing.has(p.id)&&!reducedMotion?{opacity:1,x:[0,-4,4,-3,3,0]}:{opacity:1,x:0}} exit={reducedMotion?{opacity:0}:{opacity:0,scale:.97,x:18,filter:'blur(4px)'}} transition={{duration:.24}} onDoubleClick={event=>{if(!isContactInteraction(event.target))void dismissBusiness(p,batch);}} className={selected.has(p.id)?'selected':''}>
          <td><input type="checkbox" aria-label={`Select ${p.business.name}`} checked={selected.has(p.id)} onChange={()=>toggle(p.id)}/></td>
          <td><div className="swx-biz"><button className="swx-biz-name" title="Open profile · Double-click to hide this business" onClick={event=>intent.open(event,()=>setDetail(p.id))}><strong>{p.business.name}</strong></button><div className="swx-biz-meta"><span className="swx-cat">{p.business.category}</span>{lead?.disposition==='saved'&&<span className="swx-tag"><BookmarkCheck size={11}/>Saved</span>}{inFunnel&&<span className="swx-tag funnel"><Funnel size={11}/>In funnel</span>}{p.intelligence&&<span className="swx-tag">Researched</span>}{(p.researchStatus==='queued'||p.researchStatus==='researching')&&<span className="swx-tag"><LoaderCircle size={11} className="sw-spin"/>Researching</span>}</div><CopyContact label="address" value={p.business.address} className="swx-addr"/></div></td>
          <td>{digits(p.business.phone)?<CopyContact label="phone number" value={digits(p.business.phone)} className="swx-phone">{displayPhone(digits(p.business.phone))}</CopyContact>:<span className="swx-muted">No phone</span>}</td>
          <td><span className={`swx-pri ${p.opportunity}`}>{p.opportunity==='high'?'High':p.opportunity==='contact_needed'?'Find contact':'Review'}</span><span className="swx-rank" title={`Prospecting rank ${p.rank}/100`}><i style={{width:`${p.rank}%`}}/></span></td>
          <td><span className="swx-prov">{p.broadband?.observations.length?<ProviderLabels providers={p.broadband.observations.map(o=>o.provider)}/>:p.broadbandChecked?<span className="swx-muted">None confirmed</span>:<span className="swx-muted">Checking…</span>}</span></td>
          <td><div className="swx-row-actions"><button className={`swx-act ${inFunnel?'done':''}`} title={inFunnel?'Already in your funnel':'Add to funnel'} aria-label={`Add ${p.business.name} to funnel`} disabled={inFunnel||adding.has(p.id)} onClick={()=>void sendToFunnel([p])}>{adding.has(p.id)?<LoaderCircle size={15} className="sw-spin"/>:inFunnel?<Check size={15}/>:<FunnelPlus size={15}/>}</button><button className="swx-act" aria-label={`Open ${p.business.name}`} onClick={()=>setDetail(p.id)}><ChevronRight size={16}/></button></div></td>
        </motion.tr>;})}</AnimatePresence></tbody></table>{!visible.length&&<div className="swx-empty">{busy?<><LoaderCircle size={18} className="sw-spin"/>Prospects appear as each address finishes.</>:<><Search size={18}/>No prospects match these filters.</>}</div>}</div>
        <div className="swx-pages"><span>{prospects.length?`${Math.min(page,maxPage)*PAGE_SIZE+1}–${Math.min((Math.min(page,maxPage)+1)*PAGE_SIZE,prospects.length)} of ${prospects.length}`:'0 prospects'}<em>Double-click a row to hide a business from every swarm.</em></span><div><button className="fn-icon-btn" disabled={page===0} aria-label="Previous page" onClick={()=>setPage(page-1)}><ChevronLeft size={16}/></button><button className="fn-icon-btn" disabled={page>=maxPage} aria-label="Next page" onClick={()=>setPage(page+1)}><ChevronRight size={16}/></button></div></div></>}
        </motion.div></AnimatePresence>
        <details className="sw-address-log"><summary>Address results · {failures.length} failed</summary>{batch.addresses.map((a)=><div key={a.id}><CopyContact label="source address" value={a.text}/><span>{a.status==='complete'?`${a.discovered} found`:a.status}</span>{a.error&&<small>{a.error}</small>}</div>)}</details>
        <p className="sw-data-note">Priority is a prospecting rank, not buying intent. Broadband reports show availability, not the current ISP.</p>
      </>}
      </main>
    </div><AnimatePresence>{finderOpen&&<OpportunityFinder close={()=>setFinderOpen(false)} open={item=>{setFinderOpen(false);if(item.leadKey){setBookDetail(item.leadKey);}else{choose(item.batchId);setDetail(item.prospectId);}}}/>}</AnimatePresence><AnimatePresence>{inspected&&inspectedBatch&&<SwarmDetail key={bookDetail??inspected.id} pending={pending} card={inspected} batch={inspectedBatch} record={activeRecord} saveLead={saveActive} close={()=>{setDetail(null);setBookDetail(null);}} research={!savedRecord&&batch?()=>void action({action:'research',id:batch.id,selected:[inspected.id]}):undefined} inFunnel={funnelNames.has(nameKey(inspected.business.name))} addToFunnel={()=>sendToFunnel([inspected])}/>}</AnimatePresence><AnimatePresence>{batch&&!funnelView&&!savedView&&selected.size>0&&!detail&&<motion.div className="swx-selbar" role="toolbar" aria-label="Selected prospects" initial={{opacity:0,y:14,x:'-50%'}} animate={{opacity:1,y:0,x:'-50%'}} exit={{opacity:0,y:10,x:'-50%'}}><strong>{selected.size} selected</strong><button onClick={()=>void sendToFunnel(available.filter(p=>selected.has(p.id)))}><FunnelPlus size={15}/>Add to funnel</button><button disabled={pending} onClick={()=>void action({action:'research',id:batch.id,selected:[...selected]})}><Search size={15}/>Research</button><button onClick={()=>void exportResults(true)}><Copy size={15}/>Copy</button><button onClick={()=>void exportResults()}><ArrowDownToLine size={15}/>Export</button><button className="swx-selbar-x" aria-label="Clear selection" onClick={()=>setSelected(new Set())}><X size={15}/></button></motion.div>}</AnimatePresence><AnimatePresence>{toast&&<motion.div className="sw-toast" role="status" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}><Check size={15}/>{toast}{undoAction&&<button onClick={()=>{const undo=undoAction;setUndoAction(null);void undo().catch(e=>setError(e instanceof Error?e.message:'Could not undo.'));}}>Undo</button>}</motion.div>}</AnimatePresence>
  </div></MotionConfig>;
}
