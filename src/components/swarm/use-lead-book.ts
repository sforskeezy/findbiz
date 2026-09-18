"use client";
import { useEffect, useRef, useState } from 'react';
import { findLead, leadSnapshot, readLeadBook, type LeadRecord, type LeadEdits } from '@/lib/swarm/lead-book';
import type { SwarmBatch, SwarmProspect } from '@/lib/swarm/types';

export function useLeadBook() {
  const [records, setRecords] = useState<LeadRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [cloud, setCloud] = useState(false);
  const ref = useRef(records);
  const revision = useRef(0);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const version = revision.current;
      try {
        const response = await fetch('/api/swarm/book', { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Saved businesses are unavailable.');
        const rows: LeadRecord[] = result.records;
        // One-way import: cloud edits always win over an older browser copy.
        const legacy = await readLeadBook().catch(() => [] as LeadRecord[]);
        for (const record of legacy) if (!rows.some(r => r.key === record.key)) rows.push(await persist(record, true));
        if (!disposed && version === revision.current) { ref.current = rows; setRecords(rows); setCloud(result.cloud); setError(''); setReady(true); }
      }
      catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : 'Saved businesses are unavailable.'); }
    };
    void load();
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('findbiz-lead-book') : null;
    if (channel) channel.onmessage = () => void load();
    window.addEventListener('focus', load);
    return () => { disposed = true; channel?.close(); window.removeEventListener('focus', load); };
  }, []);
  async function save(card: SwarmProspect, batch: SwarmBatch, disposition: LeadRecord['disposition'], edits?: LeadEdits) {
    if (!ready) throw new Error('Saved businesses are still loading. Please try again.');
    const record = leadSnapshot(card, batch, disposition, findLead(ref.current, card), edits);
    revision.current++;
    await persist(record);
    ref.current = [...ref.current.filter((item) => item.key !== record.key), record];
    setRecords(ref.current);
    setError('');
    if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('findbiz-lead-book'); channel.postMessage('updated'); channel.close(); }
    return record;
  }
  return { records, ready, error, cloud, save };
}

async function persist(record: LeadRecord, importOnly = false): Promise<LeadRecord> {
  const response = await fetch('/api/swarm/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ record, importOnly }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not save this business.');
  return result.record;
}
