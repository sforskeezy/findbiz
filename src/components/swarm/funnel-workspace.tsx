"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDownToLine, Archive, CalendarClock, Check, ChevronRight, ClipboardPaste, Columns3, FileSpreadsheet, List, LoaderCircle, Phone, Plus, Search, Upload, X } from 'lucide-react';
import { findFunnelMatch, funnelCsv, inferKind, normalizeFunnelInput, type FunnelInput, type FunnelLead, type FunnelStatus } from '@/lib/swarm/funnel';
import type { LeadRecord } from '@/lib/swarm/lead-book';
import { FunnelLeadPanel } from './funnel-lead-panel';
import { FunnelImportDialog, type PendingImport } from './funnel-import-dialog';
import { KIND_LABEL, STAGE, STAGE_ORDER, addDays, dateLabel, displayPhone, isDue, isOverdue, latestNote, relative, staleDays, telHref, timeLabel } from './funnel-ui';
import './funnel.css';

type Scope = 'active' | 'due' | 'archived';
type Kind = 'all' | 'stand' | 'upgrade' | 'other';
type Toast = { message: string; undo?: () => Promise<void> };
const PAGE = 60;
const BOARD_LIMIT = 80;
const priority: Record<FunnelStatus, number> = { red: 0, yellow: 1, blue: 2, green: 3 };

async function api(body: unknown) {
  const response = await fetch('/api/swarm/funnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Could not save funnel.');
  return result;
}
function download(rows: FunnelLead[]) {
  const url = URL.createObjectURL(new Blob([funnelCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `funnel-${new Date().toISOString().slice(0,10)}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target.tagName));

export function FunnelWorkspace({ records }: { records: LeadRecord[] }) {
  const [leads, setLeads] = useState<FunnelLead[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [stage, setStage] = useState<FunnelStatus | null>(null);
  const [scope, setScope] = useState<Scope>('active');
  const [kind, setKind] = useState<Kind>('all');
  const [view, setView] = useState<'list' | 'board'>('list');
  const [page, setPage] = useState(0);
  const [cursor, setCursor] = useState(-1);
  const [picker, setPicker] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [pending, setPending] = useState<PendingImport | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/swarm/funnel', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw Error(data.error);
      setLeads(data.leads); setReady(true); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load your funnel.'); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
      try { if (localStorage.getItem('pai.funnel.view') === 'board') setView('board'); } catch { /* Storage is optional. */ }
    }, 0);
    window.addEventListener('focus', load);
    return () => { clearTimeout(timer); window.removeEventListener('focus', load); };
  }, [load]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.undo ? 7000 : 3000); return () => clearTimeout(timer); }, [toast]);

  const active = useMemo(() => leads.filter(lead => !lead.archivedAt), [leads]);
  const counts = useMemo(() => Object.fromEntries(STAGE_ORDER.map(status => [status, active.filter(lead => lead.status === status).length])) as Record<FunnelStatus, number>, [active]);
  const due = useMemo(() => active.filter(isDue).sort((a, b) => (a.followUpAt + a.followUpTime).localeCompare(b.followUpAt + b.followUpTime)), [active]);
  const archivedCount = leads.length - active.length;
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const digits = needle.replace(/\D/g, '');
    return leads.filter(lead => {
      if (scope === 'archived' ? !lead.archivedAt : !!lead.archivedAt) return false;
      if (scope === 'due' && !isDue(lead)) return false;
      if (stage && lead.status !== stage) return false;
      if (kind !== 'all' && lead.kind !== kind) return false;
      if (!needle) return true;
      if (digits.length >= 3 && (lead.phone.replace(/\D/g, '').includes(digits) || lead.accountNumber.replace(/\D/g, '').includes(digits))) return true;
      return [lead.businessName, lead.phone, lead.accountNumber, lead.contactName, lead.notes].join(' ').toLowerCase().includes(needle);
    }).sort((a, b) => Number(isDue(b)) - Number(isDue(a)) || priority[a.status] - priority[b.status] || (a.followUpAt || '9').localeCompare(b.followUpAt || '9') || b.updatedAt.localeCompare(a.updatedAt));
  }, [leads, scope, stage, kind, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE, (safePage + 1) * PAGE);
  const selectedLead = leads.find(lead => lead.key === selected);
  const navigable = selectedLead ? filtered : [];
  const selectedIndex = navigable.findIndex(lead => lead.key === selected);
  const filtersOn = !!query || !!stage || kind !== 'all' || scope !== 'active';

  function notify(message: string, undo?: () => Promise<void>) { setToast({ message, undo }); }
  function resetPaging() { setPage(0); setCursor(-1); }
  function open(key: string) { setSelected(key); setCreating(false); setPicker(null); }

  async function save(fields: FunnelInput, key?: string, expectedUpdatedAt?: string, archivedAt?: string) {
    const data = await api({ action: 'save', lead: fields, key, expectedUpdatedAt, archivedAt });
    setLeads(old => [data.lead, ...old.filter(lead => lead.key !== data.lead.key)]);
    setError('');
    return data.lead as FunnelLead;
  }
  async function setStatus(lead: FunnelLead, status: FunnelStatus) {
    setPicker(null);
    if (lead.status === status) return;
    const original = normalizeFunnelInput(lead);
    const fields: FunnelInput = { ...original, status, ...(status === 'red' && !lead.followUpAt ? { followUpAt: addDays(1) } : {}) };
    setLeads(old => old.map(row => row.key === lead.key ? { ...row, ...fields } : row));
    try {
      const saved = await save(fields, lead.key, lead.updatedAt, lead.archivedAt || '');
      notify(status === 'green' ? `${lead.businessName} is sold` : `${lead.businessName} moved to ${STAGE[status].label}`, async () => { await save(original, saved.key, saved.updatedAt, saved.archivedAt || ''); });
    } catch (e) {
      setLeads(old => old.map(row => row.key === lead.key ? lead : row));
      setError(e instanceof Error ? e.message : 'Could not update this lead.');
      if (e instanceof Error && /another tab/.test(e.message)) void load();
    }
  }
  async function archive(lead: FunnelLead, restore = false) {
    const saved = await save(normalizeFunnelInput(lead), lead.key, lead.updatedAt, restore ? '' : new Date().toISOString());
    setSelected(null);
    notify(restore ? `${lead.businessName} restored` : `${lead.businessName} archived`, async () => { await save(normalizeFunnelInput(saved), saved.key, saved.updatedAt, restore ? new Date().toISOString() : ''); });
  }

  async function readFiles(files: File[]) {
    if (!files.length) return;
    setReading(true); setError('');
    try {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      const response = await fetch('/api/swarm/funnel/preview', { method: 'POST', body: form });
      const preview = await response.json();
      if (!response.ok) throw Error(preview.error || 'Could not read these files.');
      const rows = preview.rows as FunnelInput[];
      setPending({ rows, stats: preview.stats, warnings: preview.warnings ?? [], assisted: !!preview.assisted, duplicates: rows.filter(row => !!findFunnelMatch(leads, row)).length, label: files.length === 1 ? files[0].name : `${files.length} files` });
    } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); }
    finally { setReading(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function commitImport(rows: FunnelInput[]) {
    const data = await api({ action: 'import', rows });
    setLeads(data.leads); setReady(true); setPending(null);
    setStage(null); setScope('active'); setQuery(''); resetPaging();
    notify(`${data.created} added${data.updated ? ` · ${data.updated} merged into existing leads` : ''}`);
  }
  async function importSaved() {
    const rows = records.filter(row => row.disposition === 'saved').map(row => normalizeFunnelInput({ businessName: row.card.business.name, phone: row.card.business.phone ?? '', accountNumber: '', contactName: row.contactName, notes: row.notes, status: 'blue', kind: inferKind(row.notes), followUpAt: row.activity?.callbackAt?.slice(0, 10) ?? '', followUpTime: row.activity?.callbackAt?.slice(11, 16) ?? '', source: 'Saved businesses' }));
    if (!rows.length) return;
    setReading(true);
    try { await commitImport(rows); } catch (e) { setError(e instanceof Error ? e.message : 'Could not add saved businesses.'); } finally { setReading(false); }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (selected || creating || pending || event.metaKey || event.ctrlKey || event.altKey || typing(event.target)) return;
      const rows = visible, current = rows[cursor];
      if (event.key === '/') { event.preventDefault(); searchInput.current?.focus(); }
      else if (event.key === 'n' || event.key === 'N') { event.preventDefault(); setCreating(true); }
      else if (event.key === 'b' || event.key === 'B') setView(old => { const next = old === 'list' ? 'board' : 'list'; try { localStorage.setItem('pai.funnel.view', next); } catch { /* Storage is optional. */ } return next; });
      else if (view === 'list' && (event.key === 'j' || event.key === 'ArrowDown')) { event.preventDefault(); setCursor(index => Math.min(rows.length - 1, index + 1)); }
      else if (view === 'list' && (event.key === 'k' || event.key === 'ArrowUp')) { event.preventDefault(); setCursor(index => Math.max(0, index - 1)); }
      else if (event.key === 'Enter' && current) { event.preventDefault(); open(current.key); }
      else if (/^[1-4]$/.test(event.key) && current) void setStatus(current, STAGE_ORDER[Number(event.key) - 1]);
      else if (event.key === 'Escape') { setPicker(null); setCursor(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => { if (cursor >= 0) document.querySelector(`[data-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (selected || creating || pending || typing(event.target)) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text.trim().length < 3) return;
      event.preventDefault();
      void readFiles([new File([text], text.includes('\t') ? 'Pasted rows.tsv' : 'Pasted text.txt', { type: 'text/plain' })]);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  function chooseStage(next: FunnelStatus | null) { setStage(current => current === next ? null : next); if (scope === 'archived') setScope('active'); resetPaging(); }
  function switchView(next: 'list' | 'board') { setView(next); setCursor(-1); try { localStorage.setItem('pai.funnel.view', next); } catch { /* Storage is optional. */ } }
  const onFileDrag = {
    onDragEnter: (event: DragEvent) => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current++; setDragging(true); },
    onDragLeave: (event: DragEvent) => { if (!event.dataTransfer.types.includes('Files')) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDragOver: (event: DragEvent) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); },
    onDrop: (event: DragEvent) => { if (!event.dataTransfer.types.includes('Files')) return; event.preventDefault(); dragDepth.current = 0; setDragging(false); void readFiles(Array.from(event.dataTransfer.files)); },
  };
  const savedCount = records.filter(row => row.disposition === 'saved').length;
  const heading = scope === 'archived' ? 'Archived' : scope === 'due' ? 'Due for follow-up' : stage ? STAGE[stage].label : 'All leads';
  const now = new Date();

  return <div className="fn" {...onFileDrag}>
    <input ref={fileInput} hidden type="file" multiple accept=".xlsx,.xlsm,.csv,.tsv,.txt,text/plain,text/csv" onChange={event => void readFiles(Array.from(event.target.files ?? []))}/>

    <header className="fn-head">
      <div className="fn-head-copy">
        <span className="fn-date">{now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
        <h1>Funnel</h1>
        <p>{!ready ? 'Loading your leads…' : active.length === 0 ? 'Every name, number, and next step in one place.' : <>
          <b>{active.length}</b> active {active.length === 1 ? 'lead' : 'leads'}
          {counts.red > 0 && <> · <b className="fn-t-red">{counts.red}</b> ready to close</>}
          {due.length > 0 && <> · <b>{due.length}</b> follow-up{due.length === 1 ? '' : 's'} due</>}
        </>}</p>
      </div>
      <div className="fn-head-actions">
        <button className="fn-btn" disabled={reading} onClick={() => fileInput.current?.click()}>{reading ? <LoaderCircle className="fn-spin" size={15}/> : <Upload size={15}/>}Import</button>
        <button className="fn-btn fn-btn-dark" onClick={() => { setCreating(true); setSelected(null); }}><Plus size={16}/>New lead<kbd>N</kbd></button>
      </div>
    </header>

    <section className="fn-pipeline" aria-label="Pipeline by stage">
      <div className="fn-bar" aria-hidden="true">{active.length ? STAGE_ORDER.map(status => counts[status] > 0 && <span key={status} className={`fn-bg-${status}`} style={{ flexGrow: counts[status] }}/>) : <span className="fn-bar-empty"/>}</div>
      <div className="fn-stages">
        {STAGE_ORDER.map((status, index) => <button key={status} className={`fn-stage ${stage === status ? 'on' : ''}`} data-status={status} aria-pressed={stage === status} onClick={() => chooseStage(status)}>
          <span className="fn-stage-top"><i className={`fn-sw fn-bg-${status}`}/>{STAGE[status].label}<kbd>{index + 1}</kbd></span>
          <strong>{counts[status]}</strong>
          <small>{STAGE[status].hint}</small>
        </button>)}
      </div>
    </section>

    {due.length > 0 && scope !== 'archived' && <section className="fn-due" aria-label="Follow-ups due">
      <span className="fn-due-label"><CalendarClock size={14}/>Up next</span>
      <div className="fn-due-list">{due.slice(0, 8).map(lead => <button key={lead.key} onClick={() => open(lead.key)}>
        <i className={`fn-sw fn-bg-${lead.status}`}/><span>{lead.businessName}</span><small className={isOverdue(lead) ? 'fn-t-red' : ''}>{isOverdue(lead) ? dateLabel(lead.followUpAt) : lead.followUpTime ? timeLabel(lead.followUpTime) : 'Today'}</small>
      </button>)}{due.length > 8 && <button className="fn-due-more" onClick={() => { setScope('due'); setStage(null); resetPaging(); }}>+{due.length - 8} more</button>}</div>
    </section>}

    <AnimatePresence>{error && <motion.div className="fn-alert" role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}><span>{error}</span><button onClick={() => { setError(''); void load(); }}>Retry</button><button aria-label="Dismiss" onClick={() => setError('')}><X size={14}/></button></motion.div>}</AnimatePresence>

    <div className="fn-toolbar">
      <div className="fn-toolbar-title"><h2>{heading}</h2><span>{filtered.length}</span>{filtersOn && <button className="fn-clear" onClick={() => { setQuery(''); setStage(null); setKind('all'); setScope('active'); resetPaging(); }}>Clear filters</button>}</div>
      <div className="fn-toolbar-tools">
        <label className="fn-search"><Search size={15}/><input ref={searchInput} aria-label="Search leads" placeholder="Search name, phone, account, notes" value={query} onChange={event => { setQuery(event.target.value); resetPaging(); }} onKeyDown={event => { if (event.key === 'Escape') { setQuery(''); event.currentTarget.blur(); } }}/>{query ? <button aria-label="Clear search" onClick={() => setQuery('')}><X size={13}/></button> : <kbd>/</kbd>}</label>
        <div className="fn-seg" role="group" aria-label="Lead type">{(['all', 'stand', 'upgrade'] as const).map(value => <button key={value} aria-pressed={kind === value} onClick={() => { setKind(value); resetPaging(); }}>{value === 'all' ? 'All types' : KIND_LABEL[value]}</button>)}</div>
        <div className="fn-seg" role="group" aria-label="Scope">
          <button aria-pressed={scope === 'due'} onClick={() => { setScope(scope === 'due' ? 'active' : 'due'); resetPaging(); }}>Due{due.length > 0 && <b>{due.length}</b>}</button>
          <button aria-pressed={scope === 'archived'} onClick={() => { setScope(scope === 'archived' ? 'active' : 'archived'); setStage(null); resetPaging(); }} title="Archived leads"><Archive size={14}/>{archivedCount > 0 && <b>{archivedCount}</b>}</button>
        </div>
        <div className="fn-seg fn-seg-icons" role="group" aria-label="View">
          <button aria-pressed={view === 'list'} onClick={() => switchView('list')} title="List view (B)" aria-label="List view"><List size={15}/></button>
          <button aria-pressed={view === 'board'} onClick={() => switchView('board')} title="Board view (B)" aria-label="Board view"><Columns3 size={15}/></button>
        </div>
        <button className="fn-icon-btn" disabled={!filtered.length} onClick={() => download(filtered)} title="Export this view as CSV" aria-label="Export CSV"><ArrowDownToLine size={15}/></button>
      </div>
    </div>

    {!ready ? <div className="fn-list fn-skeleton" aria-busy="true">{Array.from({ length: 6 }, (_, index) => <div key={index} className="fn-skel-row"><span/><span/><span/><span/></div>)}</div>
    : leads.length === 0 ? <EmptyFunnel reading={reading} savedCount={savedCount} browse={() => fileInput.current?.click()} create={() => setCreating(true)} importSaved={() => void importSaved()}/>
    : view === 'board' ? <Board leads={filtered} stage={stage} open={open} move={setStatus}/>
    : <>
      <div className="fn-list" role="table" aria-label="Leads">
        <div className="fn-list-head" role="row"><span role="columnheader" aria-label="Color"/><span role="columnheader">Business</span><span role="columnheader">Phone / account</span><span role="columnheader">Latest note</span><span role="columnheader">Follow-up</span><span role="columnheader">Touched</span><span role="columnheader" aria-label="Actions"/></div>
        {visible.map((lead, index) => <Row key={lead.key} lead={lead} index={index} focused={cursor === index} pickerOpen={picker === lead.key} togglePicker={() => setPicker(picker === lead.key ? null : lead.key)} closePicker={() => setPicker(null)} open={() => open(lead.key)} setStatus={status => void setStatus(lead, status)} onFocus={() => setCursor(index)}/>)}
        {!visible.length && <div className="fn-none"><Search size={18}/><strong>No leads match</strong><span>Try a different search or clear the filters.</span></div>}
      </div>
      <div className="fn-list-foot">
        <span className="fn-hints"><kbd>↑</kbd><kbd>↓</kbd> move <kbd>1</kbd>–<kbd>4</kbd> set color <kbd>↵</kbd> open <kbd>B</kbd> board · paste rows from Excel anywhere</span>
        {pageCount > 1 && <span className="fn-pages">{safePage * PAGE + 1}–{Math.min((safePage + 1) * PAGE, filtered.length)} of {filtered.length}<button disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Prev</button><button disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Next</button></span>}
      </div>
    </>}
    {ready && leads.length > 0 && savedCount > 0 && <button className="fn-saved-link" disabled={reading} onClick={() => void importSaved()}>Bring in {savedCount} saved {savedCount === 1 ? 'business' : 'businesses'}<ChevronRight size={14}/></button>}

    <AnimatePresence>{dragging && <motion.div className="fn-drop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-hidden="true">
      <div><span className="fn-drop-icon"><FileSpreadsheet size={26}/></span><strong>Drop to import</strong><small>Excel, CSV, or text. Row colors come in automatically.</small></div>
    </motion.div>}</AnimatePresence>
    <AnimatePresence>{pending && <FunnelImportDialog pending={pending} close={() => setPending(null)} confirm={commitImport}/>}</AnimatePresence>
    <AnimatePresence>{(selectedLead || creating) && <FunnelLeadPanel key={selectedLead ? 'lead' : 'new'} lead={selectedLead} position={selectedIndex >= 0 ? { index: selectedIndex, total: navigable.length } : undefined}
      step={delta => { const next = navigable[selectedIndex + delta]; if (next) setSelected(next.key); }}
      onClose={() => { setSelected(null); setCreating(false); }}
      onSave={save} onStatus={setStatus} onArchive={archive}
      onCreated={lead => { setCreating(false); setSelected(lead.key); notify(`${lead.businessName} added to your funnel`); }}/>}</AnimatePresence>
    <AnimatePresence>{toast && <motion.div className="fn-toast" role="status" initial={{ opacity: 0, y: 10, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0, y: 6, x: '-50%' }}>
      <Check size={15}/><span>{toast.message}</span>
      {toast.undo && <button onClick={() => { const undo = toast.undo; setToast(null); void undo?.().catch(e => setError(e instanceof Error ? e.message : 'Could not undo.')); }}>Undo</button>}
    </motion.div>}</AnimatePresence>
  </div>;
}

function ColorPicker({ current, choose, close }: { current: FunnelStatus; choose: (status: FunnelStatus) => void; close: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[aria-checked="true"]')?.focus();
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [close]);
  function keys(event: ReactKeyboardEvent) {
    event.stopPropagation();
    if (event.key === 'Escape') close();
    if (/^[1-4]$/.test(event.key)) choose(STAGE_ORDER[Number(event.key) - 1]);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const buttons = Array.from(ref.current?.querySelectorAll('button') ?? []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
  }
  return <motion.div ref={ref} className="fn-picker" role="menu" aria-label="Change color" initial={{ opacity: 0, scale: .96, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: .12 }} onKeyDown={keys} onClick={event => event.stopPropagation()}>
    {STAGE_ORDER.map((status, index) => <button key={status} role="menuitemradio" aria-checked={current === status} onClick={() => choose(status)}>
      <i className={`fn-sw fn-bg-${status}`}/><span><strong>{STAGE[status].label}</strong><small>{STAGE[status].hint}</small></span>{current === status ? <Check size={14}/> : <kbd>{index + 1}</kbd>}
    </button>)}
  </motion.div>;
}

function Row({ lead, index, focused, pickerOpen, togglePicker, closePicker, open, setStatus, onFocus }: { lead: FunnelLead; index: number; focused: boolean; pickerOpen: boolean; togglePicker: () => void; closePicker: () => void; open: () => void; setStatus: (status: FunnelStatus) => void; onFocus: () => void }) {
  const note = latestNote(lead.notes);
  const stale = staleDays(lead);
  return <div className={`fn-row ${focused ? 'focused' : ''} ${pickerOpen ? 'picking' : ''}`} data-status={lead.status} data-row={index} role="row" onMouseEnter={onFocus}>
    <span className="fn-cell fn-cell-color" role="cell">
      <button className={`fn-dot fn-bg-${lead.status}`} aria-haspopup="menu" aria-expanded={pickerOpen} aria-label={`Color: ${STAGE[lead.status].label}. Change color`} title="Change color" onClick={togglePicker}/>
      <AnimatePresence>{pickerOpen && <ColorPicker current={lead.status} choose={setStatus} close={closePicker}/>}</AnimatePresence>
    </span>
    <span className="fn-cell fn-cell-name" role="cell">
      <button className="fn-open" onClick={open} onFocus={onFocus}><strong>{lead.businessName}</strong></button>
      <small>{lead.kind !== 'other' && <em className={`fn-kind fn-kind-${lead.kind}`}>{KIND_LABEL[lead.kind]}</em>}{lead.contactName || STAGE[lead.status].label}</small>
    </span>
    <span className="fn-cell fn-cell-contact" role="cell">
      {lead.phone ? <span className="fn-mono">{displayPhone(lead.phone)}</span> : !lead.accountNumber && <span className="fn-muted">—</span>}
      {lead.accountNumber && <small className="fn-mono">{lead.phone ? 'Acct ' : ''}{lead.accountNumber}</small>}
    </span>
    <span className="fn-cell fn-cell-note" role="cell">{note || <span className="fn-muted">No notes yet</span>}</span>
    <span className="fn-cell fn-cell-follow" role="cell">{lead.followUpAt ? <span className={`fn-chip ${isOverdue(lead) ? 'late' : isDue(lead) ? 'today' : ''}`}>{dateLabel(lead.followUpAt)}{lead.followUpTime && ` · ${timeLabel(lead.followUpTime)}`}</span> : <span className="fn-muted">—</span>}</span>
    <span className={`fn-cell fn-cell-touched ${stale >= 14 ? 'stale' : ''}`} role="cell" title={new Date(lead.updatedAt).toLocaleString()}>{relative(lead.updatedAt)}</span>
    <span className="fn-cell fn-cell-actions" role="cell">
      {lead.phone && <a className="fn-row-call" href={telHref(lead.phone)} aria-label={`Call ${lead.businessName}`} title={`Call ${displayPhone(lead.phone)}`}><Phone size={14}/></a>}
      <ChevronRight className="fn-row-chev" size={16}/>
    </span>
  </div>;
}

function Board({ leads, stage, open, move }: { leads: FunnelLead[]; stage: FunnelStatus | null; open: (key: string) => void; move: (lead: FunnelLead, status: FunnelStatus) => Promise<void> }) {
  const [over, setOver] = useState<FunnelStatus | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const columns = stage ? [stage] : STAGE_ORDER;
  return <div className={`fn-board ${stage ? 'single' : ''}`}>
    {columns.map(status => {
      const items = leads.filter(lead => lead.status === status);
      return <section key={status} className={`fn-col ${over === status ? 'over' : ''}`} data-status={status} aria-label={STAGE[status].label}
        onDragOver={event => { if (!event.dataTransfer.types.includes('text/x-funnel-lead')) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setOver(status); }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null); }}
        onDrop={event => { const key = event.dataTransfer.getData('text/x-funnel-lead'); setOver(null); const lead = leads.find(row => row.key === key); if (lead) void move(lead, status); }}>
        <header><i className={`fn-sw fn-bg-${status}`}/><strong>{STAGE[status].label}</strong><span>{items.length}</span></header>
        <div className="fn-col-body">
          {items.slice(0, BOARD_LIMIT).map(lead => <article key={lead.key} className={`fn-card ${draggingKey === lead.key ? 'lifting' : ''}`} data-status={lead.status} draggable
            onDragStart={event => { event.dataTransfer.setData('text/x-funnel-lead', lead.key); event.dataTransfer.effectAllowed = 'move'; setDraggingKey(lead.key); }}
            onDragEnd={() => { setDraggingKey(null); setOver(null); }}>
            <button className="fn-open" onClick={() => open(lead.key)}><strong>{lead.businessName}</strong></button>
            {(lead.phone || lead.accountNumber) && <span className="fn-mono fn-card-contact">{lead.phone ? displayPhone(lead.phone) : `Acct ${lead.accountNumber}`}</span>}
            {latestNote(lead.notes) && <p>{latestNote(lead.notes)}</p>}
            <footer>
              {lead.kind !== 'other' && <em className={`fn-kind fn-kind-${lead.kind}`}>{KIND_LABEL[lead.kind]}</em>}
              {lead.followUpAt && <span className={`fn-chip ${isOverdue(lead) ? 'late' : isDue(lead) ? 'today' : ''}`}><CalendarClock size={11}/>{dateLabel(lead.followUpAt)}</span>}
              <span className="fn-card-move" role="group" aria-label="Move to">{STAGE_ORDER.filter(next => next !== status).map(next => <button key={next} className={`fn-bg-${next}`} title={`Move to ${STAGE[next].label}`} aria-label={`Move ${lead.businessName} to ${STAGE[next].label}`} onClick={() => void move(lead, next)}/>)}</span>
            </footer>
          </article>)}
          {items.length > BOARD_LIMIT && <p className="fn-col-more">+{items.length - BOARD_LIMIT} more. Search or use the list view to see them.</p>}
          {!items.length && <p className="fn-col-empty">Drag leads here</p>}
        </div>
      </section>;
    })}
  </div>;
}

function EmptyFunnel({ reading, savedCount, browse, create, importSaved }: { reading: boolean; savedCount: number; browse: () => void; create: () => void; importSaved: () => void }) {
  return <section className="fn-empty">
    <button className="fn-empty-drop" onClick={browse} disabled={reading}>
      <span className="fn-drop-icon">{reading ? <LoaderCircle className="fn-spin" size={24}/> : <FileSpreadsheet size={24}/>}</span>
      <strong>{reading ? 'Reading your file…' : 'Drop your lead sheet here'}</strong>
      <small>Excel, CSV, or text. Highlighted rows keep their color, whatever the shade.</small>
      <code>BIZ NAME &gt; PHONE OR ACC # &gt; NOTES</code>
    </button>
    <div className="fn-empty-side">
      <h3>Other ways in</h3>
      <button onClick={create}><Plus size={15}/><span><strong>Add a lead by hand</strong><small>Paste a messy note and it gets organized for you.</small></span></button>
      <div className="fn-empty-tip"><ClipboardPaste size={15}/><span><strong>Paste from Excel</strong><small>Copy rows and press Ctrl+V anywhere on this page.</small></span></div>
      {savedCount > 0 && <button onClick={importSaved} disabled={reading}><ArrowDownToLine size={15}/><span><strong>Bring in {savedCount} saved {savedCount === 1 ? 'business' : 'businesses'}</strong><small>From businesses you saved in Swarm.</small></span></button>}
      <dl>
        <div><dt>stand</dt><dd>standalone mobile lead</dd></div>
        <div><dt>400 to 750</dt><dd>speed upgrade</dd></div>
      </dl>
    </div>
  </section>;
}
