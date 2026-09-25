"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Archive, ArchiveRestore, AudioLines, Check, ChevronDown, ChevronUp, Copy, LoaderCircle, Mic, Pencil, Phone, Sparkles, X } from 'lucide-react';
import { normalizeFunnelInput, type FunnelInput, type FunnelLead, type FunnelStatus } from '@/lib/swarm/funnel';
import { useLiveVoice } from '@/components/live/use-live-voice';
import { KIND_HINT, STAGE, STAGE_ORDER, addDays, dateLabel, displayPhone, noteEntries, relative, telHref, today } from './funnel-ui';

type Props = {
  lead?: FunnelLead;
  position?: { index: number; total: number };
  step: (delta: number) => void;
  onClose: () => void;
  onSave: (fields: FunnelInput, key?: string, expectedUpdatedAt?: string, archivedAt?: string) => Promise<FunnelLead>;
  onStatus: (lead: FunnelLead, status: FunnelStatus) => Promise<void>;
  onArchive: (lead: FunnelLead, restore?: boolean) => Promise<void>;
  onCreated: (lead: FunnelLead) => void;
};
const blank = (): FunnelInput => ({ businessName: '', phone: '', accountNumber: '', contactName: '', notes: '', status: 'blue', kind: 'other', followUpAt: '', followUpTime: '', source: 'Manual' });
const FIELDS: (keyof FunnelInput)[] = ['businessName','phone','accountNumber','contactName','notes','status','kind','followUpAt','followUpTime'];
const QUICK_DATES: [string, number][] = [['Today', 0], ['Tomorrow', 1], ['In 2 days', 2], ['Next week', 7]];
const typing = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT','TEXTAREA','SELECT'].includes(target.tagName));

export function FunnelLeadPanel({ lead, position, step, onClose, onSave, onStatus, onArchive, onCreated }: Props) {
  const base = useMemo(() => lead ? normalizeFunnelInput(lead) : blank(), [lead]);
  const [draft, setDraft] = useState<Partial<FunnelInput>>({});
  const fields: FunnelInput = { ...base, ...draft, ...(lead ? { status: lead.status } : {}) };
  const dirty = FIELDS.some(key => key !== 'status' && draft[key] !== undefined && draft[key] !== base[key]) || (!lead && !!(draft.businessName || draft.notes));
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [update, setUpdate] = useState('');
  const [notice, setNotice] = useState('');
  const [heard, setHeard] = useState('');
  const [editNotes, setEditNotes] = useState(false);
  const [copied, setCopied] = useState('');
  const [shownKey, setShownKey] = useState(lead?.key);
  if (shownKey !== lead?.key) { setShownKey(lead?.key); setDraft({}); setUpdate(''); setNotice(''); setHeard(''); setError(''); setEditNotes(false); }
  const leadRef = useRef(lead), fieldsRef = useRef(fields), busyRef = useRef(false), organizedRef = useRef(''), voiceOpen = useRef(false);
  useEffect(() => { leadRef.current = lead; fieldsRef.current = fields; });

  const edit = (part: Partial<FunnelInput>) => { setNotice(''); setError(''); setDraft(old => ({ ...old, ...part })); };
  const organize = useCallback(async (text: string, commit: boolean) => {
    const raw = text.trim();
    if (!raw || busyRef.current) return;
    busyRef.current = true; setProcessing(true); setError(''); setNotice('');
    try {
      const current = leadRef.current;
      const response = await fetch('/api/swarm/funnel/polish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: raw, existing: fieldsRef.current, mode: current ? 'update' : 'capture', today: today() }) });
      const result = await response.json() as { fields?: FunnelInput; error?: string };
      if (!response.ok || !result.fields) throw Error(result.error || 'Could not organize these details.');
      organizedRef.current = raw;
      if (commit && current) {
        await onSave(result.fields, current.key, current.updatedAt, current.archivedAt || '');
        setDraft({}); setUpdate('');
        const moved = result.fields.status !== current.status ? ` Moved to ${STAGE[result.fields.status].label}.` : '';
        const scheduled = result.fields.followUpAt && result.fields.followUpAt !== current.followUpAt ? ` Follow-up set for ${dateLabel(result.fields.followUpAt)}.` : '';
        setNotice(`Update saved.${moved}${scheduled}`);
      } else {
        setDraft(result.fields);
        setNotice('Organized. Check the details, then create the lead.');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not organize the update.'); }
    finally { busyRef.current = false; setProcessing(false); }
  }, [onSave]);
  useEffect(() => {
    if (lead || update.trim().length < 8 || update === organizedRef.current) return;
    const timer = setTimeout(() => void organize(update, false), 1200);
    return () => clearTimeout(timer);
  }, [update, lead, organize]);
  const voice = useLiveVoice({
    disabled: saving || processing,
    getDraft: () => '',
    getVocabulary: () => [fields.businessName, fields.contactName, 'stand, standalone mobile, upgrade, 400 to 750, follow up, sold, close, next week'].filter(Boolean).join(', '),
    onNotice: setNotice,
    onSubmit: text => { setHeard(text); void organize(text, !!leadRef.current); },
  });
  useEffect(() => { voiceOpen.current = voice.listening || voice.transcribing; }, [voice.listening, voice.transcribing]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !voiceOpen.current) { if (typing(event.target)) (event.target as HTMLElement).blur(); else onClose(); }
      if (typing(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (leadRef.current && (event.key === 'k' || event.key === 'ArrowUp')) { event.preventDefault(); step(-1); }
      if (leadRef.current && (event.key === 'j' || event.key === 'ArrowDown')) { event.preventDefault(); step(1); }
      if (leadRef.current && /^[1-4]$/.test(event.key)) void onStatus(leadRef.current, STAGE_ORDER[Number(event.key) - 1]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, step, onStatus]);

  async function commit() {
    if (!fields.businessName.trim()) { setError('Add a business name first.'); return; }
    setSaving(true); setError('');
    try {
      const saved = await onSave(fields, lead?.key, lead?.updatedAt, lead?.archivedAt || '');
      setDraft({});
      if (!lead) onCreated(saved); else setNotice('Saved.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save lead.'); }
    finally { setSaving(false); }
  }
  function pickStatus(status: FunnelStatus) {
    if (lead) void onStatus(lead, status);
    else edit({ status, ...(status === 'red' && !fields.followUpAt ? { followUpAt: addDays(1) } : {}) });
  }
  function copy(label: string, value: string) {
    void navigator.clipboard.writeText(value).then(() => { setCopied(label); setTimeout(() => setCopied(''), 1400); }).catch(() => setError('Clipboard unavailable.'));
  }
  const entries = noteEntries(fields.notes).reverse();
  const listening = voice.listening || voice.transcribing;

  const updatedLine = lead && <>Added {new Date(lead.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })} · updated {relative(lead.updatedAt)}{lead.source && lead.source !== 'Manual' && <> · <span title={lead.source}>{lead.source}</span></>}</>;

  return <motion.div className="fn-overlay fn-overlay-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .16 }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <motion.section className="fn-lead" data-status={fields.status} role="dialog" aria-modal="true" aria-label={lead ? lead.businessName : 'New lead'} initial={{ y: 16, opacity: 0, scale: .985 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 10, opacity: 0, scale: .99 }} transition={{ type: 'spring', stiffness: 440, damping: 36 }}>
      <header className="fn-lead-head">
        <div className="fn-lead-top">
          {lead && position ? <div className="fn-panel-nav">
            <button className="fn-icon-btn" aria-label="Previous lead" title="Previous (K)" disabled={position.index === 0} onClick={() => step(-1)}><ChevronUp size={16}/></button>
            <button className="fn-icon-btn" aria-label="Next lead" title="Next (J)" disabled={position.index >= position.total - 1} onClick={() => step(1)}><ChevronDown size={16}/></button>
            <span>{position.index + 1} of {position.total}</span>
          </div> : <span className="fn-lead-kicker"><i className={`fn-sw fn-bg-${fields.status}`}/>{lead ? STAGE[fields.status].label : 'New lead'}</span>}
          <div className="fn-panel-bar-end">
            {lead && <button className="fn-icon-btn" title={lead.archivedAt ? 'Restore lead' : 'Archive lead'} aria-label={lead.archivedAt ? 'Restore lead' : 'Archive lead'} onClick={() => void onArchive(lead, !!lead.archivedAt).catch(e => setError(e instanceof Error ? e.message : 'Could not archive.'))}>{lead.archivedAt ? <ArchiveRestore size={16}/> : <Archive size={16}/>}</button>}
            <button className="fn-icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={17}/></button>
          </div>
        </div>
        <div className="fn-lead-id">
          <div className="fn-lead-name">
            <input className="fn-title-input" aria-label="Business name" placeholder="Business name" maxLength={200} value={fields.businessName} onChange={event => edit({ businessName: event.target.value })}/>
            <p className="fn-panel-meta">
              {fields.kind !== 'other' && <em className={`fn-kind fn-kind-${fields.kind}`}>{KIND_HINT[fields.kind]}</em>}
              {fields.contactName && <span>{fields.contactName}</span>}
              {lead ? <span>{updatedLine}</span> : <span>Fill in what you know. Only the name is required.</span>}
            </p>
          </div>
          {(fields.phone || fields.accountNumber) && <div className="fn-actions">
            {fields.phone && <a className="fn-btn fn-btn-dark" href={telHref(fields.phone)}><Phone size={14}/>Call {displayPhone(fields.phone)}</a>}
            {fields.phone && <button className="fn-btn" onClick={() => copy('phone', fields.phone)} aria-label="Copy number" title="Copy number">{copied === 'phone' ? <Check size={14}/> : <Copy size={14}/>}{copied === 'phone' ? 'Copied' : 'Number'}</button>}
            {fields.accountNumber && <button className="fn-btn" onClick={() => copy('account', fields.accountNumber)} aria-label="Copy account" title="Copy account">{copied === 'account' ? <Check size={14}/> : <Copy size={14}/>}{copied === 'account' ? 'Copied' : 'Account'}</button>}
          </div>}
        </div>
        <div className="fn-stage-track" role="radiogroup" aria-label="Stage">
          {STAGE_ORDER.map((status, index) => <button key={status} role="radio" aria-checked={fields.status === status} data-status={status} className={fields.status === status ? 'on' : ''} onClick={() => pickStatus(status)} title={`${STAGE[status].hint} (${index + 1})`}>
            <i className={`fn-sw fn-bg-${status}`}/><span><strong>{STAGE[status].label}</strong><small>{STAGE[status].hint}</small></span>
          </button>)}
        </div>
      </header>

      <div className="fn-lead-body">
        <div className="fn-lead-main">
          {!lead && <section className="fn-capture">
            <label htmlFor="fn-capture"><Sparkles size={14}/>Quick capture</label>
            <textarea id="fn-capture" autoFocus rows={4} maxLength={10000} value={update} onChange={event => setUpdate(event.target.value)} placeholder={'Acme Cafe 502-555-0123 acc 0042, spoke w/ Jane about stand, follow up Tuesday at 2'}/>
            <div className="fn-capture-foot"><span>{processing ? <><LoaderCircle className="fn-spin" size={12}/>Organizing…</> : notice || 'Type it messy. Names, numbers, and dates get sorted into the fields.'}</span>
              <button className={`fn-mic ${voice.listening ? 'on' : ''}`} aria-label="Dictate" title="Dictate" onPointerDown={voice.handlePointerDown} onClick={voice.handleClick} disabled={voice.transcribing || processing}><Mic size={15}/></button></div>
          </section>}
          <div className="fn-lead-h"><h3>{lead ? 'Activity' : 'Information and notes'}</h3>{lead && <button className="fn-link" onClick={() => setEditNotes(!editNotes)}><Pencil size={12}/>{editNotes ? 'Done editing' : 'Edit notes'}</button>}</div>
          {lead && <div className={`fn-log ${listening ? 'live' : ''}`}>
            {listening ? <div className="fn-log-live" role="status"><AudioLines size={18}/><span><strong>{voice.transcribing ? 'Writing it up…' : 'Listening'}</strong><small>{voice.transcribing ? 'Adding this to the timeline.' : 'Pause when you’re done and it saves itself.'}</small></span>{voice.listening && <button className="fn-btn" onClick={voice.finish}>Done</button>}<button className="fn-icon-btn" aria-label="Cancel recording" onClick={voice.cancel}><X size={15}/></button></div>
            : <>
              <textarea aria-label="Log an update" rows={3} maxLength={10000} value={update} onChange={event => setUpdate(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void organize(update, true); }} placeholder="What happened? e.g. Went well, wants 400 to 750, call back Friday at 11"/>
              <div className="fn-log-foot">
                <button className="fn-mic" aria-label="Record a voice update" title="Record a voice update" onPointerDown={voice.handlePointerDown} onClick={voice.handleClick} disabled={processing || saving}><Mic size={15}/></button>
                <span>{processing ? <><LoaderCircle className="fn-spin" size={12}/>Organizing…</> : 'Stage and follow-up update from what you write.'}</span>
                <button className="fn-btn fn-btn-dark fn-btn-sm" disabled={!update.trim() || processing} onClick={() => void organize(update, true)}>Log update</button>
              </div>
            </>}
          </div>}
          {(notice && lead) && <p className="fn-notice" role="status"><Check size={13}/>{notice}{heard && <small>Heard: “{heard}”</small>}</p>}
          {editNotes || !lead ? <textarea className="fn-notes-edit" aria-label="Information and notes" rows={7} maxLength={20000} value={fields.notes} onChange={event => edit({ notes: event.target.value })} placeholder="Information and notes"/>
          : entries.length ? <ol className="fn-timeline">{entries.map((entry, index) => <li key={index}><span>{entry.date ? dateLabel(entry.date) : index === entries.length - 1 ? 'First note' : 'Note'}</span><p>{entry.text}</p></li>)}</ol>
          : <p className="fn-timeline-empty">No activity yet. Log your first conversation above.</p>}
        </div>

        <aside className="fn-lead-side">
          <section className="fn-card-box">
            <h3>Details</h3>
            <div className="fn-fields fn-fields-stack">
              <label><span>Phone</span><input type="tel" maxLength={80} value={fields.phone} onChange={event => edit({ phone: event.target.value })} placeholder="Add phone"/></label>
              <label><span>Account #</span><input maxLength={100} value={fields.accountNumber} onChange={event => edit({ accountNumber: event.target.value })} placeholder="Add account"/></label>
              <label><span>Contact</span><input maxLength={160} value={fields.contactName} onChange={event => edit({ contactName: event.target.value })} placeholder="Who you spoke with"/></label>
              <div className="fn-field"><span>Lead type</span><div className="fn-seg fn-seg-fill" role="group" aria-label="Lead type">{(['stand', 'upgrade', 'other'] as const).map(value => <button key={value} aria-pressed={fields.kind === value} title={KIND_HINT[value]} onClick={() => edit({ kind: value })}>{value === 'stand' ? 'Stand' : value === 'upgrade' ? 'Upgrade' : 'Other'}</button>)}</div></div>
            </div>
          </section>
          <section className="fn-card-box">
            <h3>Next follow-up{fields.followUpAt && <em>{dateLabel(fields.followUpAt)}</em>}</h3>
            <div className="fn-quick-dates">{QUICK_DATES.map(([label, days]) => <button key={label} aria-pressed={fields.followUpAt === addDays(days)} onClick={() => edit({ followUpAt: addDays(days) })}>{label}</button>)}{fields.followUpAt && <button className="fn-quick-clear" onClick={() => edit({ followUpAt: '', followUpTime: '' })}>Clear</button>}</div>
            <div className="fn-fields">
              <label><span>Date</span><input type="date" value={fields.followUpAt} onChange={event => edit({ followUpAt: event.target.value, ...(event.target.value ? {} : { followUpTime: '' }) })}/></label>
              <label><span>Time</span><input type="time" value={fields.followUpTime} disabled={!fields.followUpAt} onChange={event => edit({ followUpTime: event.target.value })}/></label>
            </div>
          </section>
        </aside>
      </div>

      {(dirty || !lead || error) && <footer className="fn-panel-foot">
        <span>{error ? <span className="fn-t-red">{error}</span> : dirty ? 'Unsaved changes' : ''}</span>
        {lead ? <button className="fn-btn" disabled={saving} onClick={() => { setDraft({}); setError(''); }}>Discard</button> : <button className="fn-btn" onClick={onClose}>Cancel</button>}
        <button className="fn-btn fn-btn-dark" disabled={saving || processing || (!!lead && !dirty)} onClick={() => void commit()}>{saving ? <LoaderCircle className="fn-spin" size={14}/> : <Check size={14}/>}{lead ? 'Save changes' : 'Create lead'}</button>
      </footer>}
    </motion.section>
  </motion.div>;
}
