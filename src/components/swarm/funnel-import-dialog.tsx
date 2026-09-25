"use client";
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { FileSpreadsheet, LoaderCircle, Paintbrush, Sparkles, X } from 'lucide-react';
import type { FunnelInput, FunnelStatus } from '@/lib/swarm/funnel';
import type { ImportStats } from '@/lib/swarm/funnel-import';
import { KIND_LABEL, STAGE, STAGE_ORDER, displayPhone } from './funnel-ui';

export type PendingImport = { rows: FunnelInput[]; stats: ImportStats; warnings: string[]; assisted: boolean; duplicates: number; label: string };
const SHOWN = 150;

export function FunnelImportDialog({ pending, close, confirm }: { pending: PendingImport; close: () => void; confirm: (rows: FunnelInput[]) => Promise<void> }) {
  const [rows, setRows] = useState(pending.rows);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const counts = useMemo(() => Object.fromEntries(STAGE_ORDER.map(status => [status, rows.filter(row => row.status === status).length])) as Record<FunnelStatus, number>, [rows]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !saving) close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close, saving]);
  const cycle = (index: number) => setRows(old => old.map((row, i) => i === index ? { ...row, status: STAGE_ORDER[(STAGE_ORDER.indexOf(row.status) + 1) % 4] } : row));
  async function run() {
    setSaving(true); setError('');
    try { await confirm(rows); } catch (e) { setError(e instanceof Error ? e.message : 'Import failed.'); setSaving(false); }
  }
  const fresh = rows.length - pending.duplicates;
  return <motion.div className="fn-overlay fn-overlay-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={event => { if (event.target === event.currentTarget && !saving) close(); }}>
    <motion.section className="fn-import" role="dialog" aria-modal="true" aria-labelledby="fn-import-title" initial={{ opacity: 0, y: 14, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ type: 'spring', stiffness: 420, damping: 36 }}>
      <header className="fn-import-head">
        <span className="fn-import-file"><FileSpreadsheet size={16}/>{pending.label}</span>
        <button className="fn-icon-btn" aria-label="Close import" onClick={close} disabled={saving}><X size={17}/></button>
      </header>
      <div className="fn-import-summary">
        <h2 id="fn-import-title">{rows.length.toLocaleString()} {rows.length === 1 ? 'lead' : 'leads'} ready</h2>
        <p>{fresh > 0 ? `${fresh.toLocaleString()} new` : 'No new leads'}{pending.duplicates > 0 && ` · ${pending.duplicates.toLocaleString()} already in your funnel will be merged, keeping your notes`}</p>
        <div className="fn-bar fn-bar-lg" aria-hidden="true">{STAGE_ORDER.map(status => counts[status] > 0 && <span key={status} className={`fn-bg-${status}`} style={{ flexGrow: counts[status] }}/>)}</div>
        <ul className="fn-import-counts">{STAGE_ORDER.map(status => <li key={status}><i className={`fn-sw fn-bg-${status}`}/><span>{STAGE[status].label}</span><b>{counts[status]}</b></li>)}</ul>
        {(pending.stats.fromCellColor > 0 || pending.assisted) && <div className="fn-import-notes">
          {pending.stats.fromCellColor > 0 && <span><Paintbrush size={13}/>{pending.stats.fromCellColor.toLocaleString()} colors read from cell highlights</span>}
          {pending.assisted && <span><Sparkles size={13}/>AI helped match columns in this file</span>}
        </div>}
        {pending.warnings.length > 0 && <p className="fn-import-warn">{pending.warnings.join(' ')}</p>}
      </div>
      <div className="fn-import-table" role="table" aria-label="Leads to import">
        <div className="fn-import-row head" role="row"><span role="columnheader" aria-label="Color"/><span role="columnheader">Business</span><span role="columnheader">Phone / account</span><span role="columnheader">Notes</span></div>
        {rows.slice(0, SHOWN).map((row, index) => <div className="fn-import-row" role="row" key={index}>
          <span role="cell"><button className={`fn-dot fn-bg-${row.status}`} title={`${STAGE[row.status].label}. Click to change`} aria-label={`${row.businessName}: ${STAGE[row.status].label}. Change color`} onClick={() => cycle(index)}/></span>
          <span role="cell" className="fn-import-name"><strong>{row.businessName}</strong>{row.kind !== 'other' && <em className={`fn-kind fn-kind-${row.kind}`}>{KIND_LABEL[row.kind]}</em>}</span>
          <span role="cell" className="fn-mono">{row.phone ? displayPhone(row.phone) : ''}{row.phone && row.accountNumber ? ' · ' : ''}{row.accountNumber ? `Acct ${row.accountNumber}` : ''}{!row.phone && !row.accountNumber && <span className="fn-muted">—</span>}</span>
          <span role="cell" className="fn-import-note">{row.notes || <span className="fn-muted">—</span>}</span>
        </div>)}
        {rows.length > SHOWN && <p className="fn-import-more">+{(rows.length - SHOWN).toLocaleString()} more rows</p>}
      </div>
      <footer className="fn-import-foot">
        <span>{error ? <span className="fn-t-red">{error}</span> : 'Click a color dot to change it before importing.'}</span>
        <button className="fn-btn" onClick={close} disabled={saving}>Cancel</button>
        <button className="fn-btn fn-btn-dark" onClick={() => void run()} disabled={saving || !rows.length}>{saving && <LoaderCircle className="fn-spin" size={15}/>}Import {rows.length.toLocaleString()} {rows.length === 1 ? 'lead' : 'leads'}</button>
      </footer>
    </motion.section>
  </motion.div>;
}
