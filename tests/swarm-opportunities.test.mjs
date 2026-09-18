import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpportunityPool, matchOpportunities, opportunityCsv } from '../src/lib/swarm/opportunities.ts';
import { generateDemoResearch } from '../src/lib/demo-data.ts';
import { leadSnapshot } from '../src/lib/swarm/lead-book.ts';
import { territoryProspectKey } from '../src/lib/swarm/territory.ts';

const template=generateDemoResearch().prospects[0];
function card(id,name='Local Dental',address='100 Main St, Columbia SC',extra={}) {
  return {id,business:{...template,id,name,address,category:'Dentist',phone:'(803) 555-0100',operatingStatus:'Open',coordinates:{lat:34,lng:-81}},sourceAddressIds:['address'],clusterId:'area',rank:80,opportunity:'high',broadband:null,broadbandChecked:true,intelligence:null,researchStatus:'listing',firstSeenAt:'2026-09-01',updatedAt:'2026-09-17',...extra};
}
const batch=(id,prospects,extra={})=>({id,title:id,prospects,addresses:[{id:'address',text:'101 Main St, Columbia SC'}],radiusMiles:1,createdAt:'2026-09-01',updatedAt:'2026-09-17',status:'complete',...extra});
const filters={query:'',category:'',provider:'',phoneOnly:true,freshOnly:true,contactOnly:false,similar:null};

test('workspace opportunities deduplicate overlap, retain both origins and preserve separate branches',()=>{
  const first=card('a');
  const duplicate=card('b','Local Dental','100 Main Street, Columbia SC');
  const branch=card('c','Local Dental','500 Main St, Columbia SC');branch.business.coordinates.lat=35;
  const pool=buildOpportunityPool([batch('one',[first]),batch('two',[duplicate,branch])],[],[]);
  assert.equal(pool.items.length,2);assert.equal(pool.duplicates,1);
  assert.equal(pool.items.find(p=>p.prospectId==='a').sources.length,2);
  assert.equal(pool.items[0].phone,'8035550100');
});
test('hidden dispositions exclude every duplicate and removed batches do not return',()=>{
  const p=card('a'),b=batch('one',[p]);const hidden=leadSnapshot(p,b,'hidden');
  const pool=buildOpportunityPool([b,batch('two',[card('b')]),batch('removed',[card('c','Other')],{archivedAt:'2026-09-17'})],[hidden],[]);
  assert.equal(pool.items.length,0);assert.equal(pool.batches,2);
});
test('fresh shortlist skips saved and reviewed businesses but keeps new businesses in reviewed areas',()=>{
  const a=card('a'),b=card('b','Another Dental'),c=card('c','New Dental');
  const all=batch('one',[a,b,c]);
  const pool=buildOpportunityPool([all],[leadSnapshot(a,all,'saved')],[{key:'area',reviewedAt:'2026-09-17',prospectIds:[territoryProspectKey(b)]}]);
  assert.deepEqual(matchOpportunities(pool.items,filters).map(p=>p.name),['New Dental']);
  assert.equal(matchOpportunities(pool.items,{...filters,freshOnly:false}).length,3);
});
test('Spectrum matches Charter availability without claiming the subscriber uses it',()=>{
  const p=card('a');
  p.broadband={matchQuality:'area',asOfDate:'2021-06-30',observations:[{provider:'Charter Communications Inc'}]};
  const pool=buildOpportunityPool([batch('one',[p])],[],[]);
  const matches=matchOpportunities(pool.items,{...filters,provider:'spectrum'});
  assert.equal(matches.length,1);assert.equal(matches[0].coverage,'Area-level availability');assert.equal(matches[0].reportedAt,'2021-06-30');
  assert.ok(!matches[0].signals.some(s=>s.includes('customer')));
});
test('similar finds same industry across batches, excludes seed and respects other filters',()=>{
  const a=card('a'),b=card('b','Second Dental'),c=card('c','Cafe');c.business.category='Restaurant';
  const pool=buildOpportunityPool([batch('one',[a]),batch('two',[b,c])],[],[]);
  const seed=pool.items.find(p=>p.name==='Local Dental');
  assert.deepEqual(matchOpportunities(pool.items,{...filters,similar:seed}).map(p=>p.name),['Second Dental']);
  assert.equal(matchOpportunities(pool.items,{...filters,similar:seed,query:'Greenville'}).length,0);
});
test('a newer closed listing overrides an older open discovery',()=>{
  const old=card('a'),closed=card('b');closed.updatedAt='2026-09-18';closed.business.operatingStatus='Temporarily closed';
  assert.equal(buildOpportunityPool([batch('one',[old]),batch('two',[closed])],[],[]).items.length,0);
});
test('CSV keeps provenance and notes and neutralizes spreadsheet formulas',()=>{
  const p=card('a','=HYPERLINK("bad")');const b=batch('one',[p]);const record=leadSnapshot(p,b,'saved',undefined,{contactName:'Jane',notes:'Quoted "note"\nsecond line'});
  const csv=opportunityCsv(buildOpportunityPool([b],[record],[]).items);
  assert.ok(csv.includes("'="));assert.ok(csv.includes('Quoted ""note""'));assert.ok(csv.includes('101 Main St'));assert.ok(csv.includes('not current ISP'));assert.ok(csv.includes('8035550100'));
});
