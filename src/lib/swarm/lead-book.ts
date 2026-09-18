import { sameSwarmBusiness } from "@/lib/swarm/logic";
import { normalizePhonesForCopy } from "@/lib/phone";
import type { SwarmBatch, SwarmProspect } from "@/lib/swarm/types";

export type LeadRecord = {
  key: string;
  disposition: 'saved' | 'hidden' | 'active';
  card: SwarmProspect;
  source: Pick<SwarmBatch, 'id' | 'title' | 'radiusMiles' | 'addresses'>;
  contactName: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  activity?: { outcome: 'connected' | 'no_answer' | 'callback'; at: string; callbackAt?: string };
};
export type LeadEdits = { contactName: string; notes: string; activity?: LeadRecord['activity'] };
export const digits = (phone: string | null | undefined) => (phone ?? '').replace(/\D/g, '');
export const isSpectrumProvider = (provider: string) => /\b(?:spectrum|charter)\b/i.test(provider);
export function findLead(records: LeadRecord[], card: SwarmProspect) {
  return records.find((record) => sameSwarmBusiness(record.card.business, card.business));
}
export function draftLead(card: SwarmProspect) {
  const facts = card.intelligence?.facts ?? [];
  const contactName = facts.find((fact) => fact.kind === 'leadership')?.value ?? '';
  const notes = [
    card.intelligence?.summary || card.business.publicNotes || `${card.business.category} business listed at ${card.business.address}.`,
    card.business.rating != null ? `Listed rating: ${card.business.rating}/5${card.business.reviewCount != null ? ` from ${card.business.reviewCount} reviews` : ''}.` : null,
    ...facts.filter((fact) => ['leadership', 'founded', 'team_size'].includes(fact.kind)).slice(0, 4).map((fact) => `${fact.label}: ${fact.value}${fact.sourceUrl ? ` (${fact.sourceUrl})` : ''}`),
  ].filter(Boolean).map((text) => normalizePhonesForCopy(text!)).join('\n\n');
  return { contactName, notes };
}
export function leadSnapshot(card: SwarmProspect, batch: SwarmBatch, disposition: LeadRecord['disposition'], previous?: LeadRecord, edits?: LeadEdits): LeadRecord {
  const now = new Date().toISOString();
  const snapshot = structuredClone(card);
  snapshot.business.phone = digits(snapshot.business.phone) || null;
  if (!snapshot.intelligence && previous?.card.intelligence) snapshot.intelligence = structuredClone(previous.card.intelligence);
  const addresses = structuredClone([...new Map([...(previous?.source.addresses ?? []), ...batch.addresses.filter((a) => card.sourceAddressIds.includes(a.id))].map((a) => [a.id, a])).values()]);
  snapshot.sourceAddressIds = addresses.map((a) => a.id);
  return {
    key: previous?.key ?? `${card.business.name.toLowerCase().replace(/[^a-z0-9]/g, '')}|${card.business.address.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    disposition, card: snapshot, source: { id: batch.id, title: batch.title, radiusMiles: batch.radiusMiles, addresses },
    ...(previous ? { contactName: previous.contactName, notes: previous.notes } : draftLead(snapshot)),
    ...(previous?.activity ? { activity: previous.activity } : {}), ...edits, createdAt: previous?.createdAt ?? now, updatedAt: now,
  };
}
export function leadBatch(record: LeadRecord): SwarmBatch {
  return { ...record.source, createdAt: record.createdAt, updatedAt: record.updatedAt, status: 'complete', prospects: [record.card], warnings: [], lease: null, leaseUntil: null };
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('findbiz-lead-book', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('leads', { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Your browser could not open saved businesses. Check site storage permissions.'));
  });
}
export async function readLeadBook(): Promise<LeadRecord[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('leads', 'readonly');
      const request = tx.objectStore('leads').getAll();
      tx.oncomplete = () => resolve(request.result as LeadRecord[]);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function writeLeadRecord(record: LeadRecord) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('leads', 'readwrite');
      tx.objectStore('leads').put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(new Error('The lead could not be saved. Your browser storage may be full.'));
      tx.onabort = () => reject(new Error('The save was interrupted. Please try again.'));
    });
  } finally { db.close(); }
}
