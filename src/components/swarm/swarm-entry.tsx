"use client";
import { useState, type DragEvent, type FormEvent, type RefObject } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, ClipboardList, FileUp, LoaderCircle, Map as MapIcon, Radar, Waypoints } from 'lucide-react';
import { compactBatchTitle } from './batch-list';
import type { SwarmSummary } from '@/lib/swarm/types';

const RADII = [.25, .5, 1, 2, 5, 10];
const radiusLabel = (r: number) => r === .25 ? '¼' : r === .5 ? '½' : String(r);
const working = (status: string) => ['queued','scanning','qualifying','researching'].includes(status);
function ago(iso: string) {
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  if (hours < 1) return 'just now';
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
/** Pull addresses out of a dropped spreadsheet export: prefer an address column, joined with city/state/zip when present. */
function addressesFromFile(name: string, text: string) {
  if (!/\.(csv|tsv)$/i.test(name)) return text;
  const delimiter = name.toLowerCase().endsWith('.tsv') ? '\t' : ',';
  const rows = text.split(/\r?\n/).filter(Boolean).map(line => line.split(delimiter).map(cell => cell.replace(/^"|"$/g, '').trim()));
  const header = rows[0]?.map(cell => cell.toLowerCase()) ?? [];
  const find = (pattern: RegExp) => header.findIndex(cell => pattern.test(cell));
  const street = find(/address|street/), city = find(/^city$/), state = find(/^state|^st$/), zip = find(/zip|postal/);
  if (street < 0) return rows.map(row => row.join(', ')).join('\n');
  return rows.slice(1).map(row => [row[street], row[city], [row[state], row[zip]].filter(Boolean).join(' ')].filter(value => value && value.trim()).join(', ')).filter(Boolean).join('\n');
}

export function SwarmEntry({ draft, setDraft, radius, setRadius, parsed, busy, disabled, submit, input, batches, choose }: {
  draft: string; setDraft: (value: string) => void; radius: number; setRadius: (value: number) => void;
  parsed: { addresses: unknown[]; duplicates: number; invalid: unknown[]; error: string };
  busy: boolean; disabled: boolean; submit: () => void; input: RefObject<HTMLTextAreaElement | null>;
  batches: SwarmSummary[]; choose: (id: string) => void;
}) {
  const [over, setOver] = useState(false);
  const count = parsed.addresses.length;
  const problem = parsed.error || (parsed.invalid.length ? `${parsed.invalid.length} ${parsed.invalid.length === 1 ? 'line needs' : 'lines need'} a street and a city or ZIP.` : '');
  async function drop(event: DragEvent) {
    event.preventDefault(); setOver(false);
    const files = Array.from(event.dataTransfer.files).filter(file => /\.(txt|csv|tsv)$/i.test(file.name) || file.type.startsWith('text/'));
    if (!files.length) return;
    const texts = await Promise.all(files.map(async file => addressesFromFile(file.name, await file.text())));
    setDraft([draft.trim(), ...texts.map(text => text.trim())].filter(Boolean).join('\n'));
    input.current?.focus();
  }
  function onSubmit(event: FormEvent) { event.preventDefault(); if (!disabled) submit(); }
  return <motion.div className="swx-entry" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .3 }}>
    <header className="swx-entry-head">
      <span className="swx-date">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</span>
      <h1>New swarm</h1>
      <p>Paste your addresses. Swarm finds every business around them, removes duplicates, checks reported broadband, and groups everything into territories you can work.</p>
    </header>

    <form onSubmit={onSubmit}>
      <div className={`swx-composer ${over ? 'over' : ''} ${problem ? 'invalid' : ''}`} onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)} onDrop={event => void drop(event)}>
        <label htmlFor="sw-addresses" className="swx-composer-label"><span>Addresses</span><small>One per line</small></label>
        <textarea id="sw-addresses" ref={input} value={draft} onChange={event => setDraft(event.target.value)} spellCheck={false} maxLength={300000}
          onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !disabled) { event.preventDefault(); submit(); } }}
          placeholder={'1800 Frankfort Ave, Louisville, KY 40206\n2001 Bardstown Rd, Louisville, KY 40205\n495 Russell St, Covington, KY 41011'}/>
        <div className="swx-composer-foot">
          <span className={`swx-count ${count ? 'on' : ''}`}><b>{count.toLocaleString()}</b> {count === 1 ? 'address' : 'addresses'}{parsed.duplicates > 0 && <em>{parsed.duplicates} duplicate{parsed.duplicates === 1 ? '' : 's'} removed</em>}</span>
          {problem ? <span className="swx-problem">{problem}</span> : <span className="swx-hint"><FileUp size={13}/>Drop a .txt or .csv of addresses</span>}
          {draft && <button type="button" className="swx-clear" onClick={() => setDraft('')}>Clear</button>}
        </div>
        {over && <div className="swx-composer-drop"><FileUp size={20}/>Drop to add these addresses</div>}
      </div>
      <div className="swx-launch">
        <div className="swx-radius"><span>Search radius</span><div className="fn-seg" role="group" aria-label="Radius around each address">{RADII.map(r => <button type="button" key={r} aria-pressed={radius === r} onClick={() => setRadius(r)}>{radiusLabel(r)}<small>mi</small></button>)}</div></div>
        <button type="submit" className="swx-go" disabled={disabled}>{busy ? <LoaderCircle size={16} className="sw-spin"/> : <Radar size={16}/>}Start swarm{count > 0 && <span>{count.toLocaleString()}</span>}<kbd>⌘↵</kbd></button>
      </div>
      <p className="swx-note">Up to 1,000 addresses per swarm. Include a city or ZIP for each one.</p>
    </form>

    <ol className="swx-steps">
      <li><ClipboardList size={17}/><div><strong>Paste a route</strong><span>Any list of addresses, from a sheet or a text.</span></div></li>
      <li><Radar size={17}/><div><strong>Swarm searches</strong><span>Every business within your radius, deduped into one list.</span></div></li>
      <li><Waypoints size={17}/><div><strong>Work the territory</strong><span>Clusters, a map, broadband checks, and one-tap into your funnel.</span></div></li>
    </ol>

    {batches.length > 0 && <section className="swx-recent">
      <h2>Recent swarms</h2>
      <div className="swx-recent-grid">{batches.slice(0, 6).map(batch => <button key={batch.id} onClick={() => choose(batch.id)}>
        <span className="swx-recent-top"><MapIcon size={14}/>{working(batch.status) ? <em className="live">Scanning</em> : <em>{ago(batch.createdAt)}</em>}</span>
        <strong>{compactBatchTitle(batch.title)}</strong>
        <span className="swx-recent-meta"><b>{batch.prospects.toLocaleString()}</b> prospects · {batch.addresses} {batch.addresses === 1 ? 'address' : 'addresses'}</span>
        <ArrowRight className="swx-recent-go" size={15}/>
      </button>)}</div>
    </section>}
  </motion.div>;
}
