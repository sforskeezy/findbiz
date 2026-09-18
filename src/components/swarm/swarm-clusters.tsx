"use client";
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Check, CheckCheck, Eye, MoreHorizontal, RotateCcw, Phone } from 'lucide-react';
import { swarmClusters } from '@/lib/swarm/logic';
import { clusterName, clusterReview, territoryProspectKey, type TerritoryReview } from '@/lib/swarm/territory';
import { digits, isSpectrumProvider } from '@/lib/swarm/lead-book';
import type { SwarmProspect } from '@/lib/swarm/types';

export function SwarmClusters({ cards, open, reviews, update }: { cards: SwarmProspect[]; open: (id: string) => void; reviews: TerritoryReview[]; update: (record: TerritoryReview) => void }) {
  const [showReviewed,setShowReviewed] = useState(false);
  const [menu,setMenu] = useState<string | null>(null);
  const [saving,setSaving] = useState(''), [error,setError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const groups = swarmClusters(cards);
  const reviewedCount = groups.filter(g => clusterReview(g.cards,reviews.find(r=>r.key===g.id)).reviewed).length;
  const visible = groups.filter(g => { const status = clusterReview(g.cards,reviews.find(r=>r.key===g.id)); return showReviewed || !status.reviewed || status.newCount; });
  useEffect(()=>{
    if (!menu) return;
    menuRef.current?.querySelector('button')?.focus();
    const dismiss = (e: PointerEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    document.addEventListener('pointerdown',dismiss);
    return ()=>document.removeEventListener('pointerdown',dismiss);
  },[menu]);
  async function mark(id: string, reviewed: boolean) {
    const group = groups.find(g=>g.id===id); if(!group)return;
    setSaving(id);setError('');
    try {
      const response = await fetch('/api/swarm/territory',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:id,reviewed,prospectIds:group.cards.map(territoryProspectKey)})});
      const result = await response.json();if(!response.ok)throw new Error(result.error);
      update(result.record);setMenu(null);
    } catch(e) {setError(e instanceof Error?e.message:'Could not save cluster.');}finally{setSaving('');}
  }
  return <div className="sw-territories"><div className="sw-territory-heading"><div><h2>Work the territory, once.</h2><p>Right-click a cluster to mark it as already looked at. New businesses still surface.</p></div><button className={`sw-secondary ${showReviewed?'is-active':''}`} aria-pressed={showReviewed} onClick={()=>setShowReviewed(v=>!v)}><CheckCheck size={15}/>{showReviewed?'Hide reviewed':'Show reviewed'}<span>{reviewedCount}</span></button></div>{error&&<p className="sw-error" role="alert">{error}</p>}
    <div className="sw-territory-grid"><AnimatePresence initial={false}>{visible.map((group,index)=>{
      const review = reviews.find(r=>r.key===group.id), status = clusterReview(group.cards,review);
      const phones = group.cards.filter(c=>digits(c.business.phone).length>=7).length;
      const spectrum = group.cards.filter(c=>c.broadband?.observations.some(o=>isSpectrumProvider(o.provider))).length;
      return <motion.article layout="position" key={group.id} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,scale:.97}} transition={{duration:.2}} className={`sw-territory-card ${status.reviewed?'reviewed':''}`} onContextMenu={e=>{if(group.id==='unmapped')return;e.preventDefault();setMenu(group.id);}}>
        <div className="sw-territory-top"><span>{status.reviewed?<><Check size={13}/>LOOKED AT</>:<>CLUSTER {String(index+1).padStart(2,'0')}</>}</span>{group.id!=='unmapped'&&<button className="sw-icon" aria-label={`Options for ${clusterName(group.cards)}`} aria-expanded={menu===group.id} onClick={()=>setMenu(menu===group.id?null:group.id)}><MoreHorizontal size={18}/></button>}</div>
        <button className="sw-territory-title" onClick={()=>open(group.id)}><h3>{clusterName(group.cards)}</h3><ArrowUpRight size={18}/></button>
        <div className="sw-territory-metrics"><div><strong>{group.cards.length}</strong><span>businesses</span></div><div><strong>{phones}</strong><span><Phone size={11}/>with a phone</span></div><div><strong>{group.high}</strong><span>high priority</span></div></div>
        <div className="sw-territory-businesses">{group.cards.slice(0,3).map(c=><p key={c.id}>{c.business.name}</p>)}{group.cards.length>3&&<small>+{group.cards.length-3} more businesses</small>}</div>
        <div className="sw-territory-bottom">{status.newCount?<span className="sw-new-discovery">{status.newCount} new since review</span>:spectrum?<span className="sw-spectrum">{spectrum} with Spectrum / Charter reported</span>:<span>{review?.reviewedAt?`Reviewed ${new Date(review.reviewedAt).toLocaleDateString()}`:'Ready to review'}</span>}<button onClick={()=>open(group.id)} aria-label={`View businesses near ${clusterName(group.cards)}`}><Eye size={15}/></button></div>
        {menu===group.id&&<div ref={menuRef} className="sw-cluster-menu" role="group" aria-label="Cluster actions" onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setMenu(null);}}}><button disabled={saving===group.id} onClick={()=>void mark(group.id,!status.reviewed||status.newCount>0)}>{status.reviewed&&!status.newCount?<RotateCcw size={15}/>:<CheckCheck size={15}/>} {saving===group.id?'Saving…':status.reviewed&&!status.newCount?'Mark as not reviewed':'Mark as already looked at'}</button></div>}
      </motion.article>;
    })}</AnimatePresence></div>{!visible.length&&<div className="sw-empty"><CheckCheck size={24}/><p>{groups.length?'You’ve looked at every cluster. New discoveries will appear here.':'Clusters appear as addresses finish scanning.'}</p></div>}
  </div>;
}
