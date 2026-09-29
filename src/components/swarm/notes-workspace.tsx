"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Check, CheckSquare, ChevronDown, Copy, FileText, Link2, LoaderCircle, Pin, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { noteFields, notePreview, noteTitle, type NoteChange, type NoteFields, type WorkspaceNote } from '@/lib/swarm/notes';
import type { LeadRecord } from '@/lib/swarm/lead-book';
import './notes-workspace.css';

const templates=[
  {name:'Blank note',body:'',tags:[]},
  {name:'Call notes',body:'Contact\n\nConversation\n\nNext step\n- [ ] Follow up',tags:['Call']},
  {name:'Follow-up checklist',body:'- [ ] Confirm the right contact\n- [ ] Send requested information\n- [ ] Follow up',tags:['Follow-up']},
  {name:'Territory notes',body:'Area\n\nWhat I found\n\nNext steps\n- [ ] ',tags:['Territory']},
];
type Draft={revision:number;fields:NoteFields};
const draftKey=(key:string)=>`findbiz.note-draft.${key}`;
const fingerprint=(fields:NoteFields)=>JSON.stringify(fields);
function readDraft(note:WorkspaceNote):Draft|null {
  try {const value=JSON.parse(localStorage.getItem(draftKey(note.key))??'null');return value&&typeof value.fields?.body==='string'&&typeof value.fields?.title==='string'&&Array.isArray(value.fields?.tags)&&typeof value.revision==='number'?value:null;}catch{return null;}
}
function forgetDraft(key:string) {try{localStorage.removeItem(draftKey(key));}catch{/* Cloud notes still work without local storage. */}}
async function persist(change:NoteChange):Promise<WorkspaceNote> {
  const body=JSON.stringify(change);
  const response=await fetch('/api/swarm/notes',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:new TextEncoder().encode(body).length<60000});
  const data=await response.json();
  if(!response.ok)throw Object.assign(new Error(data.error||'Could not save note.'),{conflict:response.status===409});
  return data.note;
}

export function NotesWorkspace({records,openBusiness}:{records:LeadRecord[];openBusiness:(key:string)=>void}) {
  const [notes,setNotes]=useState<WorkspaceNote[]>([]);
  const [ready,setReady]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<string|null>(null);
  const [tab,setTab]=useState<'all'|'pinned'|'trash'>('all');
  const [query,setQuery]=useState(''),[tag,setTag]=useState('');
  const [creating,setCreating]=useState(false),[menu,setMenu]=useState(false),[epoch,setEpoch]=useState(0);
  const generation=useRef(0);
  const load=useCallback(async()=>{
    const revision=generation.current;
    try {const response=await fetch('/api/swarm/notes',{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);if(revision===generation.current){setNotes(data.notes);setReady(true);setError('');}}
    catch(e){setError(e instanceof Error?e.message:'Could not load notes.');}
  },[]);
  useEffect(()=>{const timer=setTimeout(()=>void load(),0);window.addEventListener('focus',load);return()=>{clearTimeout(timer);window.removeEventListener('focus',load);};},[load]);
  const save=useCallback(async(change:NoteChange)=>{
    generation.current++;
    const note=await persist(change);
    generation.current++;
    setNotes(old=>[note,...old.filter(n=>n.key!==note.key)]);
    return note;
  },[]);
  async function create(template=templates[0],fields?:NoteFields) {
    setCreating(true);setMenu(false);setError('');
    try {const note=await save({key:crypto.randomUUID(),mutationId:crypto.randomUUID(),expectedRevision:0,changes:fields??{title:template.name==='Blank note'?'':template.name,body:template.body,tags:template.tags,pinned:false,trashed:false,leadKey:null}});setSelected(note.key);setTab('all');setQuery('');setTag('');}
    catch(e){setError(e instanceof Error?e.message:'Could not create note.');}
    finally{setCreating(false);}
  }
  const visible=notes.filter(n=>(tab==='trash'?n.trashed:!n.trashed&&(tab!=='pinned'||n.pinned))&&(!tag||n.tags.includes(tag))&&[n.title,n.body,...n.tags,records.find(r=>r.key===n.leadKey)?.card.business.name??''].join(' ').toLowerCase().includes(query.toLowerCase())).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updatedAt.localeCompare(a.updatedAt));
  const current=notes.find(n=>n.key===selected);
  const tags=[...new Set(notes.filter(n=>!n.trashed).flatMap(n=>n.tags))].sort();
  return <div className="sw-notes-page">
    <header className="sw-notes-heading"><div><h1>Notes</h1><p>Keep the details that make the next conversation easier.</p></div><div className="sw-note-new"><button className="sw-primary" disabled={creating||!ready} onClick={()=>void create()}>{creating?<LoaderCircle size={15} className="sw-spin"/>:<Plus size={15}/>}New note</button><button className="sw-secondary" aria-label="Note templates" aria-expanded={menu} onClick={()=>setMenu(!menu)} disabled={!ready}><ChevronDown size={15}/></button>{menu&&<div className="sw-note-templates" onKeyDown={e=>{if(e.key==='Escape')setMenu(false);}}><small>START WITH</small>{templates.map(t=><button key={t.name} onClick={()=>void create(t)}><FileText size={13}/>{t.name}</button>)}</div>}</div></header>
    {error&&<div className="sw-error" role="alert">{error}<button onClick={()=>void load()}>Retry</button></div>}
    <div className="sw-notes-shell">
      <aside className="sw-note-browser"><label className="sw-note-search"><Search size={14}/><input aria-label="Search notes" placeholder="Search notes or businesses" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        <div className="sw-note-tabs">{(['all','pinned','trash'] as const).map(value=><button key={value} aria-pressed={tab===value} onClick={()=>{setTab(value);setTag('');}}>{value==='pinned'&&<Pin size={11}/>} {value==='all'?'All notes':value==='pinned'?'Pinned':'Trash'}{tab===value&&<motion.span layoutId="notes-filter"/>}</button>)}</div>
        {tags.length>0&&<label className="sw-note-tag-filter"><select aria-label="Filter note tags" value={tag} onChange={e=>setTag(e.target.value)}><option value="">All tags</option>{tags.map(t=><option key={t}>{t}</option>)}</select><span>{visible.length} {visible.length===1?'note':'notes'}</span></label>}
        <div className="sw-note-list"><AnimatePresence initial={false}>{visible.map(note=><motion.button key={note.key} layout="position" initial={{opacity:0,y:5}} animate={{opacity:1,y:0}} exit={{opacity:0,x:-8}} transition={{duration:.18}} aria-pressed={selected===note.key} onClick={()=>setSelected(note.key)}><div><strong>{noteTitle(note)}</strong>{note.pinned&&<Pin size={12}/>}</div><p>{notePreview(note.body)||'Start writing…'}</p><small>{new Date(note.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'})}{note.leadKey&&<span><Link2 size={10}/>{records.find(r=>r.key===note.leadKey)?.card.business.name??'Linked business'}</span>}{!note.leadKey&&note.tags[0]&&<span>{note.tags[0]}</span>}</small></motion.button>)}</AnimatePresence>
          {!visible.length&&<div className="sw-note-list-empty">{!ready?'Loading notes…':query||tag?'No notes match.':tab==='trash'?'Deleted notes will appear here.':tab==='pinned'?'Pin a note to keep it close.':'Your notes will appear here.'}</div>}
        </div>
      </aside>
      {current?<NoteEditor key={`${current.key}:${epoch}`} note={current} records={records} save={save} openBusiness={openBusiness} reload={async()=>{forgetDraft(current.key);await load();setEpoch(n=>n+1);}} copyDraft={async fields=>{await create(templates[0],{...fields,title:`${fields.title||'Untitled note'} (copy)`,trashed:false});}}/>:<div className="sw-note-welcome"><span><FileText size={25} strokeWidth={1.4}/></span><h2>A place for the useful details.</h2><p>Call notes, follow-ups, territory ideas.<br/>Write freely or start with a template.</p><div>{templates.slice(1).map(t=><button key={t.name} disabled={!ready||creating} onClick={()=>void create(t)}><Plus size={13}/>{t.name}</button>)}</div></div>}
    </div>
  </div>;
}

function NoteEditor({note,records,save,openBusiness,reload,copyDraft}:{note:WorkspaceNote;records:LeadRecord[];save:(change:NoteChange)=>Promise<WorkspaceNote>;openBusiness:(key:string)=>void;reload:()=>Promise<void>;copyDraft:(fields:NoteFields)=>Promise<void>}) {
  const [recovery]=useState(()=>readDraft(note));
  const [fields,setFields]=useState<NoteFields>(()=>recovery?.fields??noteFields(note));
  const [baseline,setBaseline]=useState(note);
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const [conflict,setConflict]=useState(!!recovery&&recovery.revision!==note.revision&&fingerprint(recovery.fields)!==fingerprint(noteFields(note)));
  const [recovered,setRecovered]=useState(!!recovery&&fingerprint(recovery.fields)!==fingerprint(noteFields(note)));
  const [localSafe,setLocalSafe]=useState(true);
  const [preview,setPreview]=useState(false),[tagDraft,setTagDraft]=useState(''),[copied,setCopied]=useState(false);
  const [retry,setRetry]=useState(0);
  const textarea=useRef<HTMLTextAreaElement>(null);
  const mounted=useRef(true);
  const operation=useRef<{fingerprint:string;change:NoteChange}|null>(null);
  const dirty=fingerprint(fields)!==fingerprint(noteFields(baseline));
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{
    if(!dirty)return;
    try{localStorage.setItem(draftKey(note.key),JSON.stringify({revision:baseline.revision,fields}));}catch{/* The edit handler reports local storage failures. */}
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);
  },[fields,dirty,note.key,baseline.revision]);
  useEffect(()=>{
    if(!dirty||saving||error||conflict||baseline.trashed)return;
    const timer=setTimeout(()=>{
      const hash=`${baseline.revision}:${fingerprint(fields)}`;
      if(operation.current?.fingerprint!==hash)operation.current={fingerprint:hash,change:{key:note.key,expectedRevision:baseline.revision,mutationId:crypto.randomUUID(),changes:fields}};
      setSaving(true);
      void save(operation.current.change).then(result=>{
        const draft=readDraft(result);
        if(draft&&fingerprint(draft.fields)===fingerprint(fields))forgetDraft(note.key);
        if(mounted.current){setBaseline(result);setRecovered(false);setSaving(false);}
      }).catch(e=>{if(mounted.current){setError(e instanceof Error?e.message:'Could not save note.');setConflict(!!e.conflict);setSaving(false);}});
    },650);
    return()=>clearTimeout(timer);
  },[fields,baseline,dirty,saving,error,conflict,note.key,save,retry]);
  function edit(change:Partial<NoteFields>) {
    const next={...fields,...change};setFields(next);if(!conflict)setError('');
    try{localStorage.setItem(draftKey(note.key),JSON.stringify({revision:baseline.revision,fields:next}));setLocalSafe(true);}catch{setLocalSafe(false);}
  }
  async function setting(change:Partial<NoteFields>) {
    if(saving||dirty)return;
    setSaving(true);setError('');
    try{const result=await save({key:note.key,expectedRevision:baseline.revision,mutationId:crypto.randomUUID(),changes:change});setBaseline(result);setFields(noteFields(result));}
    catch(e){setError(e instanceof Error?e.message:'Could not update note.');setConflict(!!(e as {conflict?:boolean}).conflict);}
    finally{setSaving(false);}
  }
  function insert(text:string) {
    setPreview(false);
    const start=textarea.current?.selectionStart??fields.body.length,end=textarea.current?.selectionEnd??start;
    const addition=(start&&fields.body[start-1]!=='\n'?'\n':'')+text;
    const body=fields.body.slice(0,start)+addition+fields.body.slice(end);
    if(body.length>30000)return;
    edit({body});requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(start+addition.length,start+addition.length);});
  }
  const linked=records.find(r=>r.key===fields.leadKey);
  const tasks=fields.body.split('\n').filter(line=>/^\s*- \[[ x]\]/i.test(line));
  const complete=tasks.filter(line=>/^\s*- \[x\]/i.test(line)).length;
  return <section className="sw-note-editor" aria-label="Note editor" onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();setError('');setRetry(n=>n+1);}}}>
    <div className="sw-note-editor-toolbar"><span className={'sw-note-save-state '+(error||conflict?'failed':'')} role="status">{saving?<><LoaderCircle size={12} className="sw-spin"/>Saving…</>:conflict?'Draft needs review':error?'Not synced':dirty?'Unsaved changes':<><Check size={12}/>Saved</>}</span><div><button className="sw-icon" disabled={saving||dirty||baseline.trashed} aria-label={fields.pinned?'Unpin note':'Pin note'} aria-pressed={fields.pinned} onClick={()=>void setting({pinned:!fields.pinned})}><Pin size={14}/></button><button className="sw-icon" aria-label="Copy note" onClick={()=>{void navigator.clipboard.writeText([fields.title,fields.body].filter(Boolean).join('\n\n')).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1800);}).catch(()=>setError('Clipboard unavailable. Select the text to copy it.'));}}>{copied?<Check size={14}/>:<Copy size={14}/>}</button><button className="sw-icon" disabled={saving||dirty} aria-label={baseline.trashed?'Restore note':'Move note to trash'} onClick={()=>void setting({trashed:!baseline.trashed})}>{baseline.trashed?<RotateCcw size={14}/>:<Trash2 size={14}/>}</button></div></div>
    {recovered&&!conflict&&<div className="sw-note-notice">Recovered your unsaved draft.<button aria-label="Dismiss recovery notice" onClick={()=>setRecovered(false)}><X size={12}/></button></div>}
    {!localSafe&&dirty&&<div className="sw-note-notice">Local draft storage is unavailable. Keep this tab open until the note is saved.</div>}
    {(error||conflict)&&<div className="sw-note-notice warning" role="alert"><p>{error||'This note changed elsewhere. Your recovered draft has been kept.'}</p><div>{conflict?<><button onClick={()=>void copyDraft(fields)}>Save draft as a copy</button><button onClick={()=>void reload()}>Discard draft & load latest</button></>:<button onClick={()=>{setError('');setRetry(n=>n+1);}}>Retry save</button>}</div></div>}
    {baseline.trashed&&<div className="sw-note-notice">This note is in Trash. Restore it to keep editing.<button disabled={saving} onClick={()=>void setting({trashed:false})}>Restore</button></div>}
    <div className="sw-note-document"><input className="sw-note-title" aria-label="Note title" placeholder="Untitled note" maxLength={160} value={fields.title} readOnly={baseline.trashed} onChange={e=>edit({title:e.target.value})}/>
      <div className="sw-note-properties"><label><Link2 size={12}/><select aria-label="Link note to a business" value={fields.leadKey??''} disabled={baseline.trashed} onChange={e=>edit({leadKey:e.target.value||null})}><option value="">Link a business</option>{records.filter(r=>r.disposition==='saved'||r.key===fields.leadKey).map(r=><option key={r.key} value={r.key}>{r.card.business.name}</option>)}</select></label><div className="sw-note-tags">{fields.tags.map(tag=><button key={tag} disabled={baseline.trashed} onClick={()=>edit({tags:fields.tags.filter(t=>t!==tag)})} aria-label={`Remove tag ${tag}`}>{tag}<X size={9}/></button>)}{fields.tags.length<6&&!baseline.trashed&&<input aria-label="Add note tag" placeholder="+ tag" maxLength={32} value={tagDraft} onChange={e=>setTagDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&tagDraft.trim()){e.preventDefault();edit({tags:[...new Set([...fields.tags,tagDraft.trim()])]});setTagDraft('');}}}/>}</div></div>
      {linked&&<button className="sw-note-linked" onClick={()=>openBusiness(linked.key)}><span><strong>{linked.card.business.name}</strong><small>{linked.contactName?`Contact: ${linked.contactName}`:linked.card.business.address}</small></span><ArrowUpRight size={15}/></button>}
      <div className="sw-note-writing-tools"><div><button aria-pressed={!preview} onClick={()=>setPreview(false)}>Write</button><button aria-pressed={preview} onClick={()=>setPreview(true)}>Preview</button></div><button disabled={baseline.trashed} onClick={()=>insert('- [ ] ')}><CheckSquare size={13}/>Checklist</button><button disabled={baseline.trashed} onClick={()=>insert(new Date().toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})+'\n')}>Insert date</button></div>
      {preview?<div className="sw-note-preview">{fields.body?fields.body.split('\n').map((line,index)=>/^\s*- \[[ x]\]/i.test(line)?<label key={index}><input type="checkbox" disabled={baseline.trashed} checked={/^\s*- \[x\]/i.test(line)} onChange={e=>{const lines=fields.body.split('\n');lines[index]=line.replace(/\[[ x]\]/i,e.target.checked?'[x]':'[ ]');edit({body:lines.join('\n')});}}/><span>{line.replace(/^\s*- \[[ x]\]\s*/i,'')}</span></label>:<p key={index}>{line||'\u00a0'}</p>):<p className="sw-note-placeholder">Your note will appear here.</p>}</div>:<textarea ref={textarea} aria-label="Note content" className="sw-note-body" placeholder="Start writing. The details are yours to keep." value={fields.body} maxLength={30000} readOnly={baseline.trashed} onChange={e=>edit({body:e.target.value})}/>}
    </div>
    <footer className="sw-note-editor-footer"><span>{fields.body.trim()?fields.body.trim().split(/\s+/).length:0} words{tasks.length>0&&` · ${complete}/${tasks.length} tasks done`}</span><span>{dirty?'Autosaves as you write':`Edited ${new Date(baseline.updatedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`}</span></footer>
  </section>;
}
