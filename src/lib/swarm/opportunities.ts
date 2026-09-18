import { sameSwarmBusiness } from '@/lib/swarm/logic';
import { digits, findLead, isSpectrumProvider, type LeadRecord } from '@/lib/swarm/lead-book';
import { territoryProspectKey, type TerritoryReview } from '@/lib/swarm/territory';
import type { SwarmBatch, SwarmProspect } from './types';

export type Opportunity = {
  key: string; prospectId: string; batchId: string; leadKey?: string;
  name: string; address: string; category: string; phone: string; website: string | null;
  contact: string; notes: string; saved: boolean; worked: boolean; reviewed: boolean;
  providers: string[]; coverage: string; reportedAt: string | null; updatedAt: string;
  sources: { id: string; title: string }[]; sourceAddresses: string[];
  signals: string[]; readiness: number;
};
export type OpportunityPool = { items: Opportunity[]; batches: number; duplicates: number; hidden: number; generatedAt: string; unavailable: number };
export type OpportunityFilters = { query: string; category: string; provider: string; phoneOnly: boolean; freshOnly: boolean; contactOnly: boolean; similar: Opportunity | null };
const clean = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export function buildOpportunityPool(batches: SwarmBatch[], records: LeadRecord[], reviews: TerritoryReview[]): Omit<OpportunityPool, 'unavailable'> {
  const groups: { card: SwarmProspect; batch: SwarmBatch | null; record?: LeadRecord; sources: Map<string,string>; addresses: Set<string>; reviewed: boolean }[] = [];
  const byName = new Map<string, typeof groups>();
  let duplicates = 0, hidden = 0;
  const reviewedKeys = new Set(reviews.filter(r=>r.reviewedAt).flatMap(r=>r.prospectIds));
  function add(card: SwarmProspect, batch: SwarmBatch | null, record?: LeadRecord) {
    record ??= findLead(records,card);
    if(record?.disposition==='hidden') { hidden++; return; }
    const bucket = byName.get(clean(card.business.name)) ?? [];
    const existing = bucket.find(group=>sameSwarmBusiness(group.card.business,card.business));
    const sources = batch ? [{id:batch.id,title:batch.title}] : record ? [record.source] : [];
    const addresses = (batch?.addresses ?? record?.source.addresses ?? []).filter(a=>card.sourceAddressIds.includes(a.id)).map(a=>a.text);
    if(existing) {
      duplicates++;
      for(const s of sources) existing.sources.set(s.id,s.title);
      for(const address of addresses) existing.addresses.add(address);
      existing.reviewed ||= reviewedKeys.has(territoryProspectKey(card));
      if(card.updatedAt > existing.card.updatedAt) { existing.card=card; existing.batch=batch; }
      existing.record ??= record;
      return;
    }
    const group = {card,batch,record,sources:new Map(sources.map(s=>[s.id,s.title])),addresses:new Set(addresses),reviewed:reviewedKeys.has(territoryProspectKey(card))};
    groups.push(group);bucket.push(group);byName.set(clean(card.business.name),bucket);
  }
  for(const batch of batches) if(!batch.archivedAt) for(const card of batch.prospects) add(card,batch);
  for(const record of records) if(record.disposition==='saved'&&!groups.some(g=>sameSwarmBusiness(g.card.business,record.card.business))) add(record.card,null,record);
  const items = groups.filter(({card})=>!/closed/i.test(card.business.operatingStatus)).map(({card,batch,record,sources,addresses,reviewed}): Opportunity => {
    const phone=digits(card.business.phone || record?.card.business.phone);
    const contact=record?.contactName || card.intelligence?.facts.find(f=>f.kind==='leadership')?.value || '';
    const providers=[...new Set(card.broadband?.observations.map(o=>o.provider) ?? [])];
    const signals=[...(phone.length>=7?['Business phone listed']:[]),...(contact?['Named contact found']:[]),...(card.business.website?['Company website']:[]),...(!record?.activity&&!reviewed?['Not worked yet']:[])];
    return { key:record?.key??territoryProspectKey(card),prospectId:card.id,batchId:batch?.id??record?.source.id??'',leadKey:record?.disposition==='saved'?record.key:undefined,name:card.business.name,address:card.business.address,category:card.business.category,phone,website:card.business.website,contact,notes:record?.notes??'',saved:record?.disposition==='saved',worked:!!record?.activity,reviewed,providers,coverage:card.broadband?.matchQuality==='exact'?'Address-level availability':providers.length?'Area-level availability':'No availability report',reportedAt:card.broadband?.asOfDate??null,updatedAt:card.updatedAt,sources:[...sources].map(([id,title])=>({id,title})),sourceAddresses:[...addresses],signals,readiness:(phone?4:0)+(contact?3:0)+(card.business.website?1:0)+(!record?.activity&&!reviewed?2:0) };
  });
  return {items,batches:batches.filter(b=>!b.archivedAt).length,duplicates,hidden,generatedAt:new Date().toISOString()};
}

export function matchOpportunities(items: Opportunity[], filters: OpportunityFilters) {
  const seed=filters.similar;
  return items.filter(p=>
    (!filters.phoneOnly||p.phone.length>=7)&&(!filters.freshOnly||(!p.saved&&!p.worked&&!p.reviewed))&&(!filters.contactOnly||!!p.contact)&&
    (!filters.category||p.category===filters.category)&&
    (!filters.provider||p.providers.some(provider=>filters.provider==='spectrum'?isSpectrumProvider(provider):provider===filters.provider))&&
    (!seed||(p.key!==seed.key&&clean(p.category)===clean(seed.category)))&&
    `${p.name} ${p.address} ${p.category} ${p.contact}`.toLowerCase().includes(filters.query.trim().toLowerCase())
  ).sort((a,b)=>b.readiness-a.readiness||b.updatedAt.localeCompare(a.updatedAt)||a.name.localeCompare(b.name));
}

export function opportunityCsv(items: Opportunity[]) {
  const cell=(value:string)=>`"${(/^[=+@\-\t\r]/.test(value)?"'":'')+value.replaceAll('"','""')}"`;
  return [['Business','Phone','Contact','Address','Category','Available providers (not current ISP)','Coverage level','Reported date','Source addresses','Batches','Notes'],...items.map(p=>[p.name,p.phone,p.contact,p.address,p.category,p.providers.join('; '),p.coverage,p.reportedAt??'',p.sourceAddresses.join('; '),p.sources.map(s=>s.title).join('; '),p.notes])].map(row=>row.map(cell).join(',')).join('\r\n');
}
