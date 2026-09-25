import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { inferKind, findFunnelMatch, funnelCsv, mergeImportedLead, normalizeFunnelInput } from '../src/lib/swarm/funnel.ts';
import { parseFunnelFile } from '../src/lib/swarm/funnel-import.ts';
import { GET, POST } from '../src/app/api/swarm/funnel/route.ts';
import { POST as PREVIEW } from '../src/app/api/swarm/funnel/preview/route.ts';
import { polishFunnelText } from '../src/lib/swarm/funnel-polish.ts';

const input=(name,extra={})=>normalizeFunnelInput({businessName:name,phone:'',accountNumber:'',contactName:'',notes:'',status:'blue',kind:'other',followUpAt:'',source:'Test',...extra});
test('funnel understands stand and speed upgrades while retaining notes',()=>{
  assert.equal(inferKind('stand mobile lead'),'stand');
  assert.equal(inferKind('400 to 750'),'upgrade');
  const row=input('ABC', {notes:'400 to 750',kind:'upgrade'});
  assert.equal(row.notes,'400 to 750');
  assert.equal(row.kind,'upgrade');
  const previous={...row,key:'a',createdAt:'2026-01-01',updatedAt:'2026-01-01',archivedAt:'',status:'red',phone:'5550001234'};
  const merged=mergeImportedLead(previous,input('ABC',{phone:'5550001234',notes:'Customer wants tomorrow'}));
  assert.equal(merged.status,'red');assert.match(merged.notes,/400 to 750/);assert.match(merged.notes,/wants tomorrow/);
  assert.equal(findFunnelMatch([previous],input('ABC',{phone:'5550001234'}))?.key,'a');
  assert.equal(findFunnelMatch([previous],input('ABC'))?.key,'a');
  assert.match(funnelCsv([{...previous,businessName:'=HYPERLINK("evil")'}]),/'=HYPERLINK/);
});
test('text import handles user column order, quoted notes, accounts, and multiple leads',async()=>{
  const text='BIZ NAME > PHONE NUMBER OR ACC # OR BOTH > INFORMATION AND NOTES\nAcme > (502) 555-0123 / ACC 0042 > stand mobile lead\nBetter Co > 000123 > 400 to 750';
  const preview=await parseFunnelFile('leads.txt',Buffer.from(text));
  assert.equal(preview.rows.length,2);
  assert.equal(preview.rows[0].phone,'(502) 555-0123');
  assert.equal(preview.rows[0].accountNumber,'0042');
  assert.equal(preview.rows[0].kind,'stand');
  assert.equal(preview.rows[1].accountNumber,'000123');
  assert.equal(preview.rows[1].kind,'upgrade');
  const csv=await parseFunnelFile('leads.csv',Buffer.from('Business Name,Phone,Notes\n"Comma, Inc",5553334444,"Talked yesterday, follow up"'));
  assert.equal(csv.rows[0].businessName,'Comma, Inc');
  assert.equal(csv.rows[0].notes,'Talked yesterday, follow up');
  const blocks=await parseFunnelFile('notes.txt',Buffer.from('Business: The Shop\nPhone: 502-555-1000\nAccount: 00017\nNotes: stand mobile lead\n\nBusiness: Other Co\nNotes: 400 to 750'));
  assert.equal(blocks.rows.length,2);assert.equal(blocks.rows[0].accountNumber,'00017');assert.equal(blocks.rows[0].phone,'502-555-1000');assert.equal(blocks.rows[1].kind,'upgrade');
});
test('Excel import reads worksheets and formatted account numbers',async()=>{
  const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Prospects');
  sheet.addRow(['Business Name','Account Number','Information and Notes']);
  const row=sheet.addRow(['Fast Co',42,'400 to 750']);row.getCell(2).numFmt='000000';
  const result=await parseFunnelFile('leads.xlsx',Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(result.rows.length,1);assert.equal(result.rows[0].accountNumber,'000042');assert.equal(result.rows[0].kind,'upgrade');
});
test('upload preview accepts a text file and blocks cross-origin requests',async()=>{
  const make=origin=>{const form=new FormData();form.append('files',new File(['Business Name > Phone > Notes\nTiny Co > 5025551212 > stand'],'leads.txt',{type:'text/plain'}));return new Request('http://localhost:3000/api/swarm/funnel/preview',{method:'POST',headers:{origin},body:form});};
  assert.equal((await PREVIEW(make('https://unrelated.example'))).status,403);
  const response=await PREVIEW(make('http://localhost:3000'));
  assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.rows.length,1);assert.equal(preview.rows[0].businessName,'Tiny Co');
});
test('quick capture organizes rough details and spoken update advances a blue lead',()=>{
  const first=polishFunnelText('Business: Acme Services\nPhone: 502-555-1212\nAcc: 00042\nStand mobile lead',{}, 'capture','2026-09-24');
  assert.equal(first.fields.businessName,'Acme Services');assert.equal(first.fields.accountNumber,'00042');assert.equal(first.fields.kind,'stand');
  const spoken=polishFunnelText('Things went good. Follow up next week at 11:30.',{...first.fields,status:'blue'},'update','2026-09-24');
  assert.equal(spoken.fields.status,'yellow');assert.equal(spoken.fields.followUpAt,'2026-10-01');assert.equal(spoken.fields.followUpTime,'11:30');
  assert.match(spoken.fields.notes,/Things went good/);
});
test('funnel API imports, merges duplicates, updates status, and archives',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'findbiz-funnel-test-'));const old=process.env.SWARM_STORE_PATH;process.env.SWARM_STORE_PATH=root;
  const post=data=>POST(new Request('http://localhost:3000/api/swarm/funnel',{method:'POST',headers:{'Content-Type':'application/json',origin:'http://localhost:3000'},body:JSON.stringify(data)}));
  try {
    const first=await post({action:'import',rows:[input('Acme',{phone:'5025551234',notes:'stand'})]});assert.equal(first.status,200);
    const firstData=await first.json();assert.equal(firstData.created,1);
    const second=await (await post({action:'import',rows:[input('Acme',{phone:'5025551234',notes:'Follow up tomorrow'})]})).json();
    assert.equal(second.updated,1);assert.equal(second.leads.length,1);assert.match(second.leads[0].notes,/Follow up tomorrow/);
    const lead=second.leads[0];
    const changed=await post({action:'save',key:lead.key,expectedUpdatedAt:lead.updatedAt,lead:{...lead,status:'red'}});assert.equal(changed.status,200);
    const next=(await changed.json()).lead;assert.equal(next.status,'red');
    assert.equal((await post({action:'save',key:lead.key,expectedUpdatedAt:'stale',lead:{...lead,status:'green'}})).status,409);
    const archived=await post({action:'save',key:next.key,expectedUpdatedAt:next.updatedAt,archivedAt:new Date().toISOString(),lead:next});
    assert.ok((await archived.json()).lead.archivedAt);
    assert.equal((await (await GET()).json()).leads.length,1);
  } finally {await rm(root,{recursive:true,force:true});if(old===undefined)delete process.env.SWARM_STORE_PATH;else process.env.SWARM_STORE_PATH=old;}
});
