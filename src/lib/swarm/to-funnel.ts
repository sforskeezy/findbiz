import type { FunnelInput } from '@/lib/swarm/funnel';
import { digits, isSpectrumProvider, type LeadRecord } from '@/lib/swarm/lead-book';
import type { SwarmProspect } from '@/lib/swarm/types';

/** Turns a Swarm business into a blue (not yet contacted) funnel lead, keeping the useful listing context as the first note. */
export function prospectToFunnel(card: SwarmProspect, source: string, record?: Pick<LeadRecord, 'contactName' | 'notes'>): FunnelInput {
  const p = card.business;
  const providers = [...new Set(card.broadband?.observations.map(o => o.provider) ?? [])];
  const spectrum = providers.some(isSpectrumProvider);
  const notes = [
    record?.notes?.trim(),
    [p.category, p.address].filter(Boolean).join(' · '),
    p.rating != null ? `Rated ${p.rating}${p.reviewCount != null ? ` from ${p.reviewCount} reviews` : ''}` : '',
    providers.length ? `Reported providers: ${providers.slice(0, 5).join(', ')}${spectrum ? ' (Spectrum available)' : ''}` : '',
    p.website ? p.website : '',
  ].filter(Boolean).join('\n');
  return {
    businessName: p.name.slice(0, 200),
    phone: digits(p.phone),
    accountNumber: '',
    contactName: record?.contactName ?? '',
    notes: notes.slice(0, 20000),
    status: 'blue',
    kind: 'other',
    followUpAt: '',
    followUpTime: '',
    source: source.slice(0, 250),
  };
}

export async function addToFunnel(rows: FunnelInput[]) {
  const response = await fetch('/api/swarm/funnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', rows }) });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Could not add to your funnel.');
  return result as { created: number; updated: number };
}
