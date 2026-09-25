import type { FunnelLead, FunnelStatus } from '@/lib/swarm/funnel';

/** Funnel progression: untouched → talking → hot → sold. Also the 1–4 keyboard order. */
export const STAGE_ORDER: FunnelStatus[] = ['blue','yellow','red','green'];
export const STAGE: Record<FunnelStatus,{label:string;hint:string;short:string}> = {
  blue: {label:'Up in the air',hint:'Haven’t spoken yet',short:'Blue'},
  yellow: {label:'In conversation',hint:'Spoke with them · 50/50+',short:'Yellow'},
  red: {label:'Close ASAP',hint:'Close in the next 1–2 days',short:'Red'},
  green: {label:'Sold',hint:'Closed business',short:'Green'},
};
export const KIND_LABEL = {stand:'Stand',upgrade:'Upgrade',other:''} as const;
export const KIND_HINT = {stand:'Standalone mobile',upgrade:'Speed upgrade',other:'Other'} as const;

export const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const today = () => iso(new Date());
export const addDays = (days: number) => { const date = new Date(); date.setDate(date.getDate() + days); return iso(date); };
export const isDue = (lead: FunnelLead) => !!lead.followUpAt && lead.status !== 'green' && !lead.archivedAt && lead.followUpAt <= today();
export const isOverdue = (lead: FunnelLead) => !!lead.followUpAt && lead.status !== 'green' && lead.followUpAt < today();

export function dateLabel(date: string) {
  if (!date) return '';
  const now = today();
  if (date === now) return 'Today';
  if (date === addDays(1)) return 'Tomorrow';
  if (date === addDays(-1)) return 'Yesterday';
  const value = new Date(`${date}T12:00:00`);
  const sameYear = value.getFullYear() === new Date().getFullYear();
  return value.toLocaleDateString(undefined, sameYear ? {month:'short',day:'numeric'} : {month:'short',day:'numeric',year:'numeric'});
}
export function timeLabel(time: string) {
  if (!time) return '';
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(2026,0,1,hours,minutes).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
}
export function relative(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString(undefined,{month:'short',day:'numeric'});
}
export const staleDays = (lead: FunnelLead) => lead.status === 'green' ? 0 : Math.floor((Date.now() - new Date(lead.updatedAt).getTime()) / 86_400_000);

export type NoteEntry = { date: string; text: string };
/** Notes are stored as blank-line separated entries; updates are prefixed "YYYY-MM-DD · ". */
export function noteEntries(notes: string): NoteEntry[] {
  return notes.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).map(part => {
    const match = part.match(/^(\d{4}-\d{2}-\d{2})\s*·\s*([\s\S]*)$/);
    return match ? {date:match[1],text:match[2].trim()} : {date:'',text:part};
  });
}
export const latestNote = (notes: string) => noteEntries(notes).at(-1)?.text ?? '';
export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g,'')}`;
export function displayPhone(phone: string) {
  const digits = phone.replace(/\D/g,'');
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return local.length === 10 && !/[a-z]/i.test(phone) ? `(${local.slice(0,3)}) ${local.slice(3,6)}-${local.slice(6)}` : phone;
}
