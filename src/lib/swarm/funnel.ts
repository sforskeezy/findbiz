export const FUNNEL_STATUSES = ['blue', 'red', 'yellow', 'green'] as const;
export type FunnelStatus = typeof FUNNEL_STATUSES[number];
export type FunnelKind = 'stand' | 'upgrade' | 'other';
export type FunnelLead = {
  key: string;
  businessName: string;
  phone: string;
  accountNumber: string;
  contactName: string;
  notes: string;
  status: FunnelStatus;
  kind: FunnelKind;
  followUpAt: string;
  followUpTime: string;
  source: string;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
};
export type FunnelInput = Pick<FunnelLead, 'businessName'|'phone'|'accountNumber'|'contactName'|'notes'|'status'|'kind'|'followUpAt'|'followUpTime'|'source'>;
export const FUNNEL_LABELS: Record<FunnelStatus,string> = {blue:'Up in the air',red:'Close ASAP',yellow:'In conversation',green:'Sold'};

const clean = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0,max) : '';
const status = (value: unknown): FunnelStatus => FUNNEL_STATUSES.includes(value as FunnelStatus) ? value as FunnelStatus : 'blue';
export function inferKind(value: string): FunnelKind {
  if (/\bstand(?:alone)?\b|mobile\s+lead/i.test(value)) return 'stand';
  if (/\b(?:upgrade|up\s*speed)\b|\b\d{2,5}\s*(?:to|→|->|-)\s*\d{2,5}\b/i.test(value)) return 'upgrade';
  return 'other';
}
export function normalizeFunnelInput(value: unknown): FunnelInput {
  const input = value as Partial<FunnelInput> | null;
  if (!input || typeof input !== 'object') throw Error('Invalid lead.');
  const businessName = clean(input.businessName, 200);
  if (!businessName) throw Error('Each lead needs a business name.');
  const notes = clean(input.notes, 20000);
  const followUpAt = clean(input.followUpAt, 40);
  if (followUpAt && (!/^\d{4}-\d{2}-\d{2}$/.test(followUpAt) || Number.isNaN(Date.parse(`${followUpAt}T12:00:00Z`)) || new Date(`${followUpAt}T12:00:00Z`).toISOString().slice(0,10)!==followUpAt)) throw Error('Use a valid follow-up date.');
  const followUpTime=clean(input.followUpTime,5);
  if(followUpTime&&!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(followUpTime))throw Error('Use a valid follow-up time.');
  const kind = input.kind === 'stand' || input.kind === 'upgrade' || input.kind === 'other' ? input.kind : inferKind(notes);
  return {businessName,phone:clean(input.phone,80),accountNumber:clean(input.accountNumber,100),contactName:clean(input.contactName,160),notes,status:status(input.status),kind,followUpAt,followUpTime:followUpAt?followUpTime:'',source:clean(input.source,250)};
}
export function findFunnelMatch(rows: FunnelLead[], input: FunnelInput) {
  const name = input.businessName.toLowerCase().replace(/[^a-z0-9]/g,'');
  const account = input.accountNumber.toLowerCase().replace(/[^a-z0-9]/g,'');
  const phone = input.phone.replace(/\D/g,'');
  const exact=rows.find(row => {
    const rowName = row.businessName.toLowerCase().replace(/[^a-z0-9]/g,'');
    const rowAccount = row.accountNumber.toLowerCase().replace(/[^a-z0-9]/g,'');
    const rowPhone = row.phone.replace(/\D/g,'');
    return !!account && account === rowAccount || !!phone && phone === rowPhone && name === rowName;
  });
  if(exact)return exact;
  const candidates=rows.filter(row=>row.businessName.toLowerCase().replace(/[^a-z0-9]/g,'')===name&&(!account&&!phone||!row.accountNumber&&!row.phone));
  return candidates.length===1?candidates[0]:undefined;
}
export function mergeImportedLead(previous: FunnelLead, incoming: FunnelInput): FunnelInput {
  const notes = [previous.notes, incoming.notes].filter(Boolean);
  return {
    businessName: previous.businessName || incoming.businessName,
    phone: previous.phone || incoming.phone,
    accountNumber: previous.accountNumber || incoming.accountNumber,
    contactName: previous.contactName || incoming.contactName,
    notes: notes.length === 2 && notes[0] !== notes[1] ? notes.join('\n\n') : notes[0] || '',
    status: previous.status === 'blue' ? incoming.status : previous.status,
    kind: previous.kind === 'other' ? incoming.kind : previous.kind,
    followUpAt: previous.followUpAt || incoming.followUpAt,
    followUpTime: previous.followUpTime || incoming.followUpTime,
    source: [previous.source,incoming.source].filter(Boolean).filter((item,index,all)=>all.indexOf(item)===index).join(', ').slice(0,250),
  };
}
function csvCell(value:string){const safe=/^[\s\uFEFF]*[=+@-]/.test(value)?`'${value}`:value;return `"${safe.replace(/"/g,'""')}"`;}
export function funnelCsv(rows:FunnelLead[]) {
  const columns=['Business name','Phone','Account number','Contact','Status','Lead type','Follow up date','Follow up time','Information and notes','Source'];
  return '\uFEFF'+[columns.map(csvCell).join(','),...rows.map(row=>[row.businessName,row.phone,row.accountNumber,row.contactName,row.status,row.kind,row.followUpAt,row.followUpTime||'',row.notes,row.source].map(csvCell).join(','))].join('\r\n');
}
