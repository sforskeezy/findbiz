import { randomUUID } from 'node:crypto';
import { cloudConfigured, updateCloud } from '@/lib/swarm/cloud-store';
import { listRepRecords, saveRepRecord } from '@/lib/swarm/rep-store';
import { findFunnelMatch, mergeImportedLead, normalizeFunnelInput, type FunnelInput, type FunnelLead } from '@/lib/swarm/funnel';

let writes:Promise<unknown>=Promise.resolve();
export class FunnelConflict extends Error {constructor(){super('This lead changed in another tab. Reload the funnel and try again.');}}
export async function listFunnelLeads() {return listRepRecords<FunnelLead>('funnel');}
export async function putFunnelLead(input:unknown,key?:string,expectedUpdatedAt?:string,archivedAt?:string):Promise<FunnelLead> {
  const fields=normalizeFunnelInput(input);
  if(key!==undefined && !/^[a-f0-9-]{36}$/i.test(key))throw Error('Invalid lead ID.');
  const id=key??randomUUID();
  const update=(previous:FunnelLead|null) => {
    if(expectedUpdatedAt && previous?.updatedAt!==expectedUpdatedAt)throw new FunnelConflict();
    const now=new Date().toISOString();
    return {...fields,key:id,createdAt:previous?.createdAt??now,updatedAt:now,archivedAt:archivedAt??previous?.archivedAt??''};
  };
  if(cloudConfigured())return updateCloud<FunnelLead>('funnel',id,update,value=>({key:value.key}));
  const work=writes.catch(()=>{}).then(async()=>{
    const previous=(await listFunnelLeads()).find(row=>row.key===id)??null;
    return saveRepRecord('funnel',update(previous));
  });
  writes=work;return work;
}
export async function importFunnelLeads(values:unknown[]) {
  if(values.length>5000)throw Error('Import up to 5,000 leads at a time.');
  const incoming: FunnelInput[]=values.map(normalizeFunnelInput);
  const current=await listFunnelLeads();
  let created=0,updated=0;
  for(const row of incoming) {
    const previous=findFunnelMatch(current,row);
    const saved=await putFunnelLead(previous?mergeImportedLead(previous,row):row,previous?.key);
    if(previous){updated++;current.splice(current.indexOf(previous),1,saved);}else{created++;current.push(saved);}
  }
  return {created,updated,leads:current};
}
