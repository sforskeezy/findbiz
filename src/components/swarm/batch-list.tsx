"use client";
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArchiveRestore, Check, Copy, MoreHorizontal, Pause, Pencil, Play, Trash2, X } from 'lucide-react';
import { SwarmIcon } from './swarm-icon';
import { SwarmDialog } from './swarm-dialog';
import type { SwarmSummary } from '@/lib/swarm/types';
const busy = (status: string) => ['queued','scanning','qualifying','researching'].includes(status);
export const compactBatchTitle = (title: string) => title.replace(/^\d+ addresses?\s*·\s*/,'');

export function BatchList({ batches, removed, selected, choose, manage }: { batches: SwarmSummary[]; removed: SwarmSummary[]; selected: string | null; choose: (id: string) => void; manage: (action: string, id: string, title?: string) => Promise<void> }) {
  const [menu,setMenu] = useState<{batch:SwarmSummary;x:number;y:number}|null>(null);
  const [renaming,setRenaming] = useState<SwarmSummary|null>(null), [name,setName] = useState('');
  const [pending,setPending] = useState(''), [removing,setRemoving] = useState('');
  const [error,setError] = useState(''), [copied,setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement|null>(null);
  const reduce = useReducedMotion();
  useEffect(()=>{
    if(!menu)return;
    menuRef.current?.querySelector('button')?.focus();
    const dismiss=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))setMenu(null);};
    document.addEventListener('pointerdown',dismiss);
    return()=>document.removeEventListener('pointerdown',dismiss);
  },[menu]);
  function openMenu(batch: SwarmSummary, x: number, y: number, element: HTMLElement) {
    opener.current=element;setCopied(false);setError('');setMenu({batch,x:Math.max(8,Math.min(x,window.innerWidth-218)),y:Math.max(8,Math.min(y,window.innerHeight-270))});
  }
  async function run(action: string, batch: SwarmSummary, title?: string) {
    setPending(batch.id);setError('');
    if(action==='remove')setRemoving(batch.id);
    try { await manage(action,batch.id,title);setMenu(null);if(action==='rename')setRenaming(null); }
    catch(e){setError(e instanceof Error?e.message:'Could not update batch.');}
    finally{setPending('');setRemoving('');}
  }
  return <>
    <div className="sw-sidebar-label">Your batches <span>{batches.length}</span></div>
    <nav className="sw-compact-batches" aria-label="Saved Swarm batches"><AnimatePresence initial={false}>{batches.map(batch=><motion.div key={batch.id} layout="position" className={`sw-batch-item ${batch.id===selected?'selected':''}`} initial={{opacity:0,y:5}} animate={removing===batch.id&&!reduce?{x:[0,-3,3,-2,2,0]}:{x:0,opacity:1}} exit={reduce?{opacity:0}:{opacity:0,scale:.9,x:12,filter:'blur(5px)',height:0,marginBottom:0}} transition={{duration:.28}} onContextMenu={event=>{event.preventDefault();openMenu(batch,event.clientX,event.clientY,event.currentTarget);}}>
      <button className="sw-batch-pick" onClick={()=>choose(batch.id)} aria-current={batch.id===selected?'page':undefined} title={batch.title} onKeyDown={e=>{if(e.key==='ContextMenu'||(e.shiftKey&&e.key==='F10')){e.preventDefault();const box=e.currentTarget.getBoundingClientRect();openMenu(batch,box.right-20,box.top,e.currentTarget);}}}><SwarmIcon size={17} active={busy(batch.status)}/><span className="sw-batch-copy"><HoverTitle text={compactBatchTitle(batch.title)}/><small>{batch.addresses} {batch.addresses===1?'address':'addresses'}<i/> {batch.prospects} prospects{busy(batch.status)&&<em>Scanning</em>}</small></span></button>
      <button className="sw-batch-more" aria-label={`Batch settings: ${compactBatchTitle(batch.title)}`} aria-expanded={menu?.batch.id===batch.id} disabled={pending===batch.id} onClick={e=>{const box=e.currentTarget.getBoundingClientRect();openMenu(batch,box.right,box.top,e.currentTarget);}}><MoreHorizontal size={15}/></button>
    </motion.div>)}</AnimatePresence>{!batches.length&&<p className="sw-sidebar-empty">Your batches will appear here.</p>}
    {removed.length>0&&<details className="sw-removed-batches"><summary><ArchiveRestore size={13}/>Removed batches<span>{removed.length}</span></summary>{removed.map(batch=><div key={batch.id}><span title={batch.title}>{compactBatchTitle(batch.title)}</span><button aria-label={`Restore ${compactBatchTitle(batch.title)}`} disabled={pending===batch.id} onClick={()=>void run('restore',batch)}><ArchiveRestore size={14}/></button></div>)}</details>}</nav>
    {error&&!menu&&!renaming&&<p className="sw-batch-error" role="alert">{error}</p>}
    {menu&&createPortal(<div ref={menuRef} className="sw-batch-menu" style={{left:menu.x,top:menu.y}} role="menu" aria-label="Batch settings" onKeyDown={e=>{
      if(e.key==='Escape'){e.preventDefault();setMenu(null);opener.current?.focus();}
      if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const buttons=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]);const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
      if(e.key==='Tab')setMenu(null);
    }}><small>BATCH SETTINGS</small><button role="menuitem" disabled={!!pending} onClick={()=>{setRenaming(menu.batch);setName(compactBatchTitle(menu.batch.title));setMenu(null);}}><Pencil size={14}/>Rename</button><button role="menuitem" disabled={!!pending} onClick={()=>void run(busy(menu.batch.status)?'pause':'resume',menu.batch)}>{busy(menu.batch.status)?<Pause size={14}/>:<Play size={14}/>} {busy(menu.batch.status)?'Pause swarm':'Resume swarm'}</button><button role="menuitem" onClick={()=>{void navigator.clipboard.writeText(`${window.location.origin}/swarm?batch=${menu.batch.id}`).then(()=>setCopied(true)).catch(()=>setError('Clipboard unavailable.'));}}>{copied?<Check size={14}/>:<Copy size={14}/>} {copied?'Link copied':'Copy batch link'}</button><div className="sw-menu-divider"/><button role="menuitem" className="sw-remove-batch" disabled={!!pending} onClick={()=>void run('remove',menu.batch)}><Trash2 size={14}/>{pending?'Removing…':'Remove batch'}</button>{error&&<p role="alert">{error}</p>}</div>,document.body)}
    <AnimatePresence>{renaming&&createPortal(<SwarmDialog label="Rename batch" close={()=>setRenaming(null)} className="sw-rename-modal"><form onSubmit={e=>{e.preventDefault();void run('rename',renaming,name);}}><div><h2>Rename batch</h2><button className="sw-icon" type="button" onClick={()=>setRenaming(null)} aria-label="Close rename"><X size={18}/></button></div><label htmlFor="sw-batch-name">Batch name</label><input id="sw-batch-name" value={name} onChange={e=>setName(e.target.value)} maxLength={100} autoFocus required/>{error&&<p className="sw-error" role="alert">{error}</p>}<button className="sw-primary" disabled={!!pending||!name.trim()}>{pending?'Saving…':'Save name'}</button></form></SwarmDialog>,document.body)}</AnimatePresence>
  </>;
}
function HoverTitle({text}:{text:string}) {
  const box=useRef<HTMLSpanElement>(null),content=useRef<HTMLSpanElement>(null);
  const [distance,setDistance]=useState(0);
  useEffect(()=>{
    const measure=()=>setDistance(Math.max(0,(content.current?.scrollWidth??0)-(box.current?.clientWidth??0)));
    measure();const observer=new ResizeObserver(measure);if(box.current)observer.observe(box.current);return()=>observer.disconnect();
  },[text]);
  return <span ref={box} className={`sw-hover-title ${distance>0?'overflows':''}`} style={{'--sw-scroll-distance':`${-distance}px`,'--sw-scroll-duration':`${Math.max(2.5,distance/35)}s`} as CSSProperties}><span className="sw-title-static">{text}</span><span ref={content} className="sw-title-scroll" aria-hidden="true">{text}</span></span>;
}
