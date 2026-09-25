"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, AudioLines, CalendarDays, Check, ChevronRight, FileSpreadsheet, FolderArchive, LoaderCircle, Mic, Phone, Plus, RotateCcw, ScanText, Search, UploadCloud, X } from 'lucide-react';
import { FUNNEL_LABELS, FUNNEL_STATUSES, findFunnelMatch, funnelCsv, inferKind, normalizeFunnelInput, type FunnelInput, type FunnelLead, type FunnelStatus } from '@/lib/swarm/funnel';
import { useLiveVoice } from '@/components/live/use-live-voice';
import type { LeadRecord } from '@/lib/swarm/lead-book';
import './funnel-workspace.css';
import './funnel-redesign.css';

const blank=():FunnelInput=>({businessName:'',phone:'',accountNumber:'',contactName:'',notes:'',status:'blue',kind:'other',followUpAt:'',followUpTime:'',source:'Manual'});
const statusOrder:Record<FunnelStatus,number>={red:0,yellow:1,blue:2,green:3};
const dateLabel=(date:string)=>new Date(`${date}T12:00:00`).toLocaleDateString(undefined,{month:'short',day:'numeric'});
const timeLabel=(time:string)=>{if(!time)return '';const [hours,minutes]=time.split(':').map(Number);return new Date(2026,0,1,hours,minutes).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});};
const today=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
const due=(lead:FunnelLead)=>!!lead.followUpAt&&lead.status!=='green'&&lead.followUpAt<=today();
function exportCsv(rows:FunnelLead[]) {
  const url=URL.createObjectURL(new Blob([funnelCsv(rows)],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download='findbiz-funnel.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function api(body:unknown) {
  const response=await fetch('/api/swarm/funnel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Could not save funnel.');return result;
}
export function FunnelWorkspace({records}:{records:LeadRecord[]}) {
  const [leads,setLeads]=useState<FunnelLead[]>([]),[ready,setReady]=useState(false),[error,setError]=useState('');
  const [selected,setSelected]=useState<string|null>(null),[creating,setCreating]=useState(false);
  const [query,setQuery]=useState(''),[filter,setFilter]=useState<FunnelStatus|'all'|'due'|'archived'>('all'),[kind,setKind]=useState('all');
  const [dragging,setDragging]=useState(false),[uploading,setUploading]=useState(false),[summary,setSummary]=useState(''),[warnings,setWarnings]=useState<string[]>([]);
  const [page,setPage]=useState(0);
  const fileInput=useRef<HTMLInputElement>(null),dragDepth=useRef(0);
  const load=useCallback(async()=>{try{const response=await fetch('/api/swarm/funnel',{cache:'no-store'});const data=await response.json();if(!response.ok)throw Error(data.error);setLeads(data.leads);setReady(true);setError('');}catch(e){setError(e instanceof Error?e.message:'Could not load funnel.');}},[]);
  useEffect(()=>{const timer=setTimeout(()=>void load(),0);window.addEventListener('focus',load);return()=>{clearTimeout(timer);window.removeEventListener('focus',load);};},[load]);
  const active=leads.filter(lead=>!lead.archivedAt);
  const counts=Object.fromEntries(FUNNEL_STATUSES.map(status=>[status,active.filter(lead=>lead.status===status).length])) as Record<FunnelStatus,number>;
  const dueCount=active.filter(due).length;
  const filtered=useMemo(()=>leads.filter(lead=>{
    if(filter==='archived'?!lead.archivedAt:!!lead.archivedAt)return false;
    if(filter==='due'&&!due(lead))return false;
    if(FUNNEL_STATUSES.includes(filter as FunnelStatus)&&lead.status!==filter)return false;
    if(kind!=='all'&&lead.kind!==kind)return false;
    return [lead.businessName,lead.phone,lead.accountNumber,lead.contactName,lead.notes,lead.source].join(' ').toLowerCase().includes(query.toLowerCase());
  }).sort((a,b)=>Number(due(b))-Number(due(a))||statusOrder[a.status]-statusOrder[b.status]||a.followUpAt.localeCompare(b.followUpAt)||b.updatedAt.localeCompare(a.updatedAt)),[leads,filter,kind,query]);
  const visible=filtered.slice(page*60,(page+1)*60);
  const selectedLead=leads.find(lead=>lead.key===selected);
  function chooseFilter(next:typeof filter){setFilter(next);setPage(0);}
  async function save(fields:FunnelInput,key?:string,expectedUpdatedAt?:string,archivedAt?:string){
    const data=await api({action:'save',lead:fields,key,expectedUpdatedAt,archivedAt});
    setLeads(old=>[data.lead,...old.filter(lead=>lead.key!==data.lead.key)]);
    setError('');return data.lead as FunnelLead;
  }
  async function importRows(rows:FunnelInput[],label:string,extraWarnings:string[]=[]){
    const data=await api({action:'import',rows});
    setLeads(data.leads);setSummary(`${data.created} added · ${data.updated} updated from ${label}`);setWarnings(extraWarnings);
    setReady(true);setError('');
  }
  async function importFiles(files:FileList|File[]){
    if(!files.length)return;
    setUploading(true);setSummary('');setWarnings([]);setError('');
    try{
      const form=new FormData();for(const file of Array.from(files))form.append('files',file);
      const response=await fetch('/api/swarm/funnel/preview',{method:'POST',body:form});
      const preview=await response.json();if(!response.ok)throw Error(preview.error||'Could not read files.');
      const duplicateCount=(preview.rows as FunnelInput[]).filter(row=>!!findFunnelMatch(leads,row)).length;
      await importRows(preview.rows,`${files.length} ${files.length===1?'file':'files'}`,[...preview.warnings,...(duplicateCount?[`${duplicateCount} matched existing leads and were merged.`]:[])]);
    }catch(e){setError(e instanceof Error?e.message:'Import failed.');}
    finally{setUploading(false);if(fileInput.current)fileInput.current.value='';}
  }
  async function importSaved(){
      const rows=records.filter(row=>row.disposition==='saved').map(row=>normalizeFunnelInput({businessName:row.card.business.name,phone:row.card.business.phone??'',accountNumber:'',contactName:row.contactName,notes:row.notes,status:'blue',kind:inferKind(row.notes),followUpAt:row.activity?.callbackAt?.slice(0,10)??'',followUpTime:row.activity?.callbackAt?.slice(11,16)??'',source:'Saved businesses'}));
    if(!rows.length)return;
    setUploading(true);setError('');try{await importRows(rows,'saved businesses');}catch(e){setError(e instanceof Error?e.message:'Could not add saved businesses.');}finally{setUploading(false);}
  }
  return <div className="sw-funnel" onDragEnter={event=>{if(event.dataTransfer.types.includes('Files')){event.preventDefault();dragDepth.current++;setDragging(true);}}} onDragLeave={event=>{event.preventDefault();dragDepth.current=Math.max(0,dragDepth.current-1);if(!dragDepth.current)setDragging(false);}} onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}} onDrop={event=>{event.preventDefault();dragDepth.current=0;setDragging(false);void importFiles(event.dataTransfer.files);}}>
    {dragging&&<div className="sw-funnel-drop" aria-hidden="true"><UploadCloud size={38}/><strong>Drop leads into your funnel</strong><span>Excel, CSV, TSV, or text</span></div>}
    <section className="sw-funnel-hero"><div className="sw-funnel-hero-main"><span className="sw-funnel-hero-kicker"><span/>SWARM / FUNNEL</span><h1>Keep every deal<br/><em>moving forward.</em></h1><p>One clean place for the names, conversations, and next steps that make the sale.</p><div className="sw-funnel-head-actions"><input ref={fileInput} hidden type="file" multiple accept=".xlsx,.csv,.tsv,.txt,text/plain,text/csv" onChange={event=>void importFiles(event.target.files??[])}/><button className="sw-funnel-new" onClick={()=>{setCreating(true);setSelected(null);}}><Plus size={17}/>New lead</button><button className="sw-funnel-import" disabled={uploading} onClick={()=>fileInput.current?.click()}>{uploading?<LoaderCircle className="sw-spin" size={16}/>:<UploadCloud size={16}/>}Import a file</button></div></div><div className="sw-funnel-hero-focus"><div className="sw-funnel-focus-top"><span>YOUR FOCUS</span><CalendarDays size={17}/></div><strong>{dueCount?`${dueCount} to follow up`:'You’re caught up'}</strong><p>{dueCount?'The next conversations are ready for you.':'No overdue follow-ups right now.'}</p><button onClick={()=>chooseFilter(dueCount?'due':'red')}>{dueCount?'See what’s due':'See hot leads'}<ArrowRight size={15}/></button><div className="sw-funnel-focus-foot"><span>{active.length} active leads</span><span>{counts.green} sold</span></div></div></section>
    <div className="sw-funnel-stages"><button className={`sw-funnel-stage-all ${filter==='all'?'active':''}`} aria-pressed={filter==='all'} onClick={()=>chooseFilter('all')}><span>ALL LEADS</span><strong>{active.length}</strong></button>{FUNNEL_STATUSES.map(status=><button key={status} onClick={()=>chooseFilter(status)} aria-pressed={filter===status} className={`sw-funnel-metric ${status} ${filter===status?'active':''}`}><span><i/>{FUNNEL_LABELS[status]}</span><strong>{counts[status]}</strong><small>{status==='blue'?'Haven’t spoken yet':status==='red'?'Close in 1–2 days':status==='yellow'?'Conversation started':'Closed business'}</small></button>)}</div>
    {summary&&<div className="sw-funnel-notice success" role="status"><Check size={17}/><span><strong>{summary}</strong>{warnings.length>0&&<small>{warnings.join(' ')}</small>}</span><button aria-label="Dismiss import summary" onClick={()=>{setSummary('');setWarnings([]);}}><X size={15}/></button></div>}
    {error&&<div className="sw-funnel-notice error" role="alert"><span>{error}</span><button onClick={()=>{setError('');void load();}}>Retry</button></div>}
    <div className="sw-funnel-ledger-heading"><div><span>THE LEAD LEDGER</span><h2>{filter==='due'?'Due for follow-up':filter==='archived'?'Archived leads':filter==='all'?'All your leads':FUNNEL_LABELS[filter]}</h2><p>{filtered.length} {filtered.length===1?'lead':'leads'} in this view</p></div><div className="sw-funnel-ledger-actions"><button aria-pressed={filter==='due'} onClick={()=>chooseFilter('due')}><CalendarDays size={14}/>Due <b>{dueCount}</b></button><button aria-pressed={filter==='archived'} onClick={()=>chooseFilter('archived')}><FolderArchive size={14}/>Archive</button></div></div>
    <div className="sw-funnel-toolbar"><label className="sw-funnel-search"><Search size={16}/><input aria-label="Search funnel" placeholder="Search names, phone numbers, accounts, notes…" value={query} onChange={event=>{setQuery(event.target.value);setPage(0);}}/></label><label className="sw-funnel-select"><select aria-label="Filter lead type" value={kind} onChange={event=>{setKind(event.target.value);setPage(0);}}><option value="all">All lead types</option><option value="stand">Stand · mobile</option><option value="upgrade">Upgrade</option><option value="other">Other</option></select></label><button className="sw-funnel-export" disabled={!filtered.length} onClick={()=>exportCsv(filtered)}><ArrowDownToLine size={15}/>Export</button></div>
    <div className="sw-funnel-table-wrap"><table className="sw-funnel-table"><thead><tr><th>Business</th><th>Phone / account</th><th>Latest detail</th><th>Next move</th><th>Status</th><th aria-label="Open lead"/></tr></thead><tbody>{visible.map(lead=><tr key={lead.key} className={`sw-funnel-row ${lead.status}`}><td colSpan={6}><button className="sw-funnel-row-button" onClick={()=>{setSelected(lead.key);setCreating(false);}} aria-label={`Open ${lead.businessName}`}><span className="sw-funnel-cell business"><i className={`sw-funnel-dot ${lead.status}`}/><span><strong>{lead.businessName}</strong><small>{lead.kind==='stand'?'STAND · MOBILE':lead.kind==='upgrade'?'UPGRADE':lead.contactName||'LEAD'}</small></span></span><span className="sw-funnel-cell contact"><strong>{lead.phone||lead.accountNumber||'—'}</strong>{lead.phone&&lead.accountNumber&&<small>Acc # {lead.accountNumber}</small>}</span><span className="sw-funnel-cell notes">{lead.notes||'Add a conversation note'}</span><span className="sw-funnel-cell next">{lead.followUpAt?<span className={due(lead)?'overdue':''}><CalendarDays size={13}/>{dateLabel(lead.followUpAt)}{lead.followUpTime?` · ${timeLabel(lead.followUpTime)}`:''}{due(lead)?' · due':''}</span>:<small>No follow-up set</small>}</span><span className="sw-funnel-cell state"><span className={`sw-funnel-status ${lead.status}`}><i/>{FUNNEL_LABELS[lead.status]}</span></span><span className="sw-funnel-cell arrow"><ChevronRight size={17}/></span></button></td></tr>)}</tbody></table>
      {!ready?<div className="sw-funnel-empty"><LoaderCircle className="sw-spin" size={22}/>Loading your funnel…</div>:!filtered.length?<div className="sw-funnel-empty"><span className="sw-funnel-empty-icon"><FileSpreadsheet size={22}/></span><h2>{query||filter!=='all'||kind!=='all'?'No leads match this view':'Your funnel starts here'}</h2><p>{query||filter!=='all'||kind!=='all'?'Try another search or filter.':'Drop an Excel or text file, add a lead, or bring over saved businesses.'}</p>{active.length===0&&records.some(row=>row.disposition==='saved')&&<button className="sw-secondary" disabled={uploading} onClick={()=>void importSaved()}>Add {records.filter(row=>row.disposition==='saved').length} saved businesses <ArrowRight size={14}/></button>}</div>:null}
    </div>
    {filtered.length>60&&<div className="sw-funnel-pagination"><span>{page*60+1}–{Math.min((page+1)*60,filtered.length)} of {filtered.length}</span><div><button disabled={page===0} onClick={()=>setPage(page-1)}>Previous</button><button disabled={(page+1)*60>=filtered.length} onClick={()=>setPage(page+1)}>Next</button></div></div>}
    {ready&&active.length>0&&records.some(row=>row.disposition==='saved')&&<button className="sw-funnel-saved-link" disabled={uploading} onClick={()=>void importSaved()}>Bring in saved businesses <ArrowRight size={14}/></button>}
    {(selectedLead||creating)&&<LeadDrawer key={selectedLead?.key??'new'} lead={selectedLead} onClose={()=>{setSelected(null);setCreating(false);}} onSave={save}/>}
  </div>;
}

function LeadDrawer({lead,onClose,onSave}:{lead?:FunnelLead;onClose:()=>void;onSave:(fields:FunnelInput,key?:string,expectedUpdatedAt?:string,archivedAt?:string)=>Promise<FunnelLead>}) {
  const [fields,setFields]=useState<FunnelInput>(()=>lead?normalizeFunnelInput(lead):blank());
  const [saving,setSaving]=useState(false),[processing,setProcessing]=useState(false),[error,setError]=useState('');
  const [archived,setArchived]=useState(!!lead?.archivedAt);
  const [captureText,setCaptureText]=useState(''),[captureNotice,setCaptureNotice]=useState(''),[voiceNotice,setVoiceNotice]=useState(''),[lastTranscript,setLastTranscript]=useState('');
  const fieldsRef=useRef(fields),leadRef=useRef(lead),onSaveRef=useRef(onSave),processingRef=useRef(false),organizedRef=useRef(''),voiceOpenRef=useRef(false);
  useEffect(()=>{fieldsRef.current=fields;leadRef.current=lead;onSaveRef.current=onSave;},[fields,lead,onSave]);
  const organize=useCallback(async(text:string,autoSave:boolean)=>{
    const raw=text.trim();if(!raw||processingRef.current)return;
    processingRef.current=true;setProcessing(true);setError('');setCaptureNotice('');
    try {
      const currentLead=leadRef.current;
      const response=await fetch('/api/swarm/funnel/polish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:raw,existing:fieldsRef.current,mode:currentLead?'update':'capture',today:today()})});
      const result=await response.json() as {fields?:FunnelInput;summary?:string;error?:string};
      if(!response.ok||!result.fields)throw Error(result.error||'Could not organize these details.');
      fieldsRef.current=result.fields;setFields(result.fields);organizedRef.current=raw;
      if(autoSave&&currentLead){
        const saved=await onSaveRef.current(result.fields,currentLead.key,currentLead.updatedAt,currentLead.archivedAt||'');
        leadRef.current=saved;setCaptureNotice('Voice update saved. Lead details and follow-up are current.');
      }else setCaptureNotice('Details organized below. Review them, then save.');
      if(currentLead)setCaptureText('');
      setLastTranscript(autoSave?raw:'');
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not organize the update.');}
    finally{processingRef.current=false;setProcessing(false);}
  },[]);
  useEffect(()=>{if(lead||captureText.trim().length<8||captureText===organizedRef.current)return;const timer=setTimeout(()=>void organize(captureText,false),1200);return()=>clearTimeout(timer);},[captureText,lead,organize]);
  const voice=useLiveVoice({disabled:saving||processing,getDraft:()=>'',getVocabulary:()=>[fields.businessName,fields.contactName,'funnel, lead, stand, standalone mobile, upgrade, 400 to 750, follow up, sold, close, next week'].filter(Boolean).join(', '),onNotice:setVoiceNotice,onSubmit:text=>{void organize(text,!!leadRef.current);}});
  useEffect(()=>{voiceOpenRef.current=voice.listening||voice.transcribing;},[voice.listening,voice.transcribing]);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!voiceOpenRef.current)onClose();};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[onClose]);
  const edit=(part:Partial<FunnelInput>)=>{setCaptureNotice('');setFields(old=>({...old,...part}));};
  async function commit(nextArchived=archived) {
    if(!fields.businessName.trim()){setError('Add a business name first.');return;}
    setSaving(true);setError('');
    try{await onSave(fields,lead?.key,lead?.updatedAt,nextArchived?lead?.archivedAt||new Date().toISOString():'');onClose();}
    catch(e){setError(e instanceof Error?e.message:'Could not save lead.');}
    finally{setSaving(false);}
  }
  return <div className="sw-funnel-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="sw-funnel-drawer" role="dialog" aria-modal="true" aria-label={lead?`Edit ${lead.businessName}`:'Add lead'}><div className="sw-funnel-drawer-top"><span>{lead?'FUNNEL / LEAD DETAILS':'FUNNEL / NEW LEAD'}</span><button aria-label="Close lead details" onClick={onClose}><X size={19}/></button></div><div className="sw-funnel-drawer-scroll"><div className="sw-funnel-drawer-title"><div><span className="sw-funnel-drawer-eyebrow">{lead?'CUSTOMER PROFILE':'START WITH THE ROUGH VERSION'}</span><h2>{fields.businessName||'Capture a new lead'}</h2><p>{lead?`Added ${new Date(lead.createdAt).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'})}`:'Paste a note, type freely, or fill out the fields below.'}</p></div><span className={`sw-funnel-status ${fields.status}`}><i/>{FUNNEL_LABELS[fields.status]}</span></div>
    <div className="sw-funnel-capture"><div className="sw-funnel-capture-head"><span className="sw-funnel-capture-icon"><ScanText size={19}/></span><div><strong>{lead?'Add a conversation':'Quick capture'}</strong><small>{lead?'Talk it through or paste your rough update.':'Drop the messy version here. We’ll organize it.'}</small></div>{lead&&<button className={`sw-funnel-voice-plus ${voice.listening?'active':''}`} aria-label="Record a voice update" title="Record a voice update" onPointerDown={voice.handlePointerDown} onClick={voice.handleClick} disabled={voice.transcribing||processing||saving}><Plus size={20}/><Mic size={14}/></button>}</div>
      {voice.listening||voice.transcribing?<div className="sw-funnel-voice-panel" role="status"><AudioLines size={22}/><div><strong>{voice.transcribing?'Turning speech into an update…':voice.stage==='speaking'?'Listening to your update':'Listening'}</strong><small>{voice.transcribing?'Organizing your next step.':'A short pause will save your update automatically.'}</small></div><button onClick={voice.cancel} aria-label="Cancel recording"><X size={15}/></button>{voice.listening&&<button onClick={voice.finish}>Finish</button>}</div>:<><textarea autoFocus={!lead} aria-label={lead?'Conversation update':'Quick capture lead details'} placeholder={lead?'Things went well. Follow up next week at 11:30 about the 400 to 750 upgrade…':'Acme Cafe, 502-555-0123, account 0042. Spoke with Jane about standalone mobile. Follow up next Tuesday…'} value={captureText} onChange={event=>setCaptureText(event.target.value)} maxLength={10000} rows={lead?3:4}/><div className="sw-funnel-capture-actions"><span>{lead?'Your update will be added to the notes below.':'Names, numbers, notes, and follow-ups land in the right fields.'}</span><button disabled={!captureText.trim()||processing} onClick={()=>void organize(captureText,false)}>{processing?<LoaderCircle className="sw-spin" size={14}/>:<ScanText size={14}/>}Organize details</button></div></>}
      {(captureNotice||voiceNotice||lastTranscript)&&<div className="sw-funnel-capture-feedback" role="status">{captureNotice||voiceNotice}{lastTranscript&&<small>Heard: “{lastTranscript}”</small>}</div>}
    </div>
    <div className="sw-funnel-fieldset sw-funnel-stage-fieldset"><div className="sw-funnel-section-heading"><span className="sw-funnel-section-label">WHERE IT STANDS</span><small>Tap a color to update the stage</small></div><div className="sw-funnel-status-grid">{FUNNEL_STATUSES.map(status=><button key={status} className={`${status} ${fields.status===status?'active':''}`} aria-pressed={fields.status===status} onClick={()=>{const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);edit({status,...(status==='red'&&!fields.followUpAt?{followUpAt:`${tomorrow.getFullYear()}-${String(tomorrow.getMonth()+1).padStart(2,'0')}-${String(tomorrow.getDate()).padStart(2,'0')}`}:{})});}}><i/><strong>{FUNNEL_LABELS[status]}</strong></button>)}</div></div>
    <div className="sw-funnel-fieldset"><div className="sw-funnel-section-heading"><span className="sw-funnel-section-label">CUSTOMER DETAILS</span><small>Everything stays editable</small></div><div className="sw-funnel-form-grid"><label className="wide">Business name<input required maxLength={200} value={fields.businessName} onChange={event=>edit({businessName:event.target.value})} placeholder="Business name"/></label><label>Phone number<input type="tel" maxLength={80} value={fields.phone} onChange={event=>edit({phone:event.target.value})} placeholder="(555) 000-0000"/></label><label>Account number<input maxLength={100} value={fields.accountNumber} onChange={event=>edit({accountNumber:event.target.value})} placeholder="Optional"/></label><label className="wide">Contact name<input maxLength={160} value={fields.contactName} onChange={event=>edit({contactName:event.target.value})} placeholder="Who are you speaking with?"/></label></div>{fields.phone&&<a className="sw-funnel-call" href={`tel:${fields.phone.replace(/[^\d+]/g,'')}`}><Phone size={14}/>Call {fields.phone}</a>}</div>
    <div className="sw-funnel-fieldset"><div className="sw-funnel-section-heading"><span className="sw-funnel-section-label">NEXT MOVE</span><small>Stay ahead of the follow-up</small></div><div className="sw-funnel-form-grid"><label>Lead type<select value={fields.kind} onChange={event=>edit({kind:event.target.value as FunnelInput['kind']})}><option value="other">Other</option><option value="stand">Stand · mobile</option><option value="upgrade">Upgrade</option></select></label><label>Follow-up date<input type="date" value={fields.followUpAt} onChange={event=>edit({followUpAt:event.target.value})}/></label><label>Follow-up time<input type="time" value={fields.followUpTime} disabled={!fields.followUpAt} onChange={event=>edit({followUpTime:event.target.value})}/></label><label className="wide">Information and notes<textarea maxLength={20000} rows={6} value={fields.notes} onChange={event=>edit({notes:event.target.value})} placeholder="The useful details from each conversation…"/></label></div></div>
    {lead?.source&&<div className="sw-funnel-source">Source <strong>{lead.source}</strong></div>}
    {lead&&<button className="sw-funnel-archive" disabled={saving} onClick={()=>{setArchived(!archived);void commit(!archived);}}>{archived?<RotateCcw size={15}/>:<FolderArchive size={15}/>} {archived?'Restore lead':'Archive lead'}</button>}
    </div><div className="sw-funnel-drawer-footer">{error&&<span role="alert">{error}</span>}<button className="sw-secondary" onClick={onClose}>Cancel</button><button className="sw-primary" disabled={saving||processing} onClick={()=>void commit()}>{saving?<LoaderCircle size={15} className="sw-spin"/>:<Check size={15}/>}Save lead</button></div></section></div>;
}
