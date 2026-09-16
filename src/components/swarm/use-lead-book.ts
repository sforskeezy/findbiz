"use client";
import { useEffect, useRef, useState } from 'react';
import { findLead, leadSnapshot, readLeadBook, writeLeadRecord, type LeadRecord } from '@/lib/swarm/lead-book';
import type { SwarmBatch, SwarmProspect } from '@/lib/swarm/types';

export function useLeadBook() {
  const [records, setRecords] = useState<LeadRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const ref = useRef(records);
  const revision = useRef(0);
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      const version = revision.current;
      try { const rows = await readLeadBook(); if (!disposed && version === revision.current) { ref.current = rows; setRecords(rows); setError(''); } }
      catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : 'Saved businesses are unavailable.'); }
      finally { if (!disposed) setReady(true); }
    };
    void load();
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('findbiz-lead-book') : null;
    if (channel) channel.onmessage = () => void load();
    window.addEventListener('focus', load);
    return () => { disposed = true; channel?.close(); window.removeEventListener('focus', load); };
  }, []);
  async function save(card: SwarmProspect, batch: SwarmBatch, disposition: LeadRecord['disposition'], edits?: { contactName: string; notes: string }) {
    if (!ready) throw new Error('Saved businesses are still loading. Please try again.');
    const record = leadSnapshot(card, batch, disposition, findLead(ref.current, card), edits);
    revision.current++;
    await writeLeadRecord(record);
    ref.current = [...ref.current.filter((item) => item.key !== record.key), record];
    setRecords(ref.current);
    setError('');
    if (typeof BroadcastChannel !== 'undefined') { const channel = new BroadcastChannel('findbiz-lead-book'); channel.postMessage('updated'); channel.close(); }
    return record;
  }
  return { records, ready, error, save };
}
