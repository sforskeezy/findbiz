import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftLead, findLead, leadSnapshot, leadBatch, digits, isSpectrumProvider } from '../src/lib/swarm/lead-book.ts';
import { generateDemoResearch } from '../src/lib/demo-data.ts';

function fixture() {
  const business = { ...generateDemoResearch().prospects[0], id:'provider-original', name:'Example Dental', address:'101 Main Street, Columbia SC', phone:'(803) 555-0123', coordinates:{lat:34,lng:-81} };
  const card = { id:'card-original', business, sourceAddressIds:['seed-one'], rank:75, reasons:['Business phone available'], clusterId:'cell', opportunity:'high', broadband:null, broadbandChecked:true, researchStatus:'complete', error:null, firstSeenAt:'2026-09-15', updatedAt:'2026-09-15', intelligence:{ summary:'A local dental practice.', facts:[{kind:'leadership',label:'Owner',value:'Jamie Smith',sourceUrl:'https://example.test/team'}], sources:[] } };
  const batch = {id:'batch-one',title:'Columbia',radiusMiles:1,addresses:[{id:'seed-one',text:'100 Main St, Columbia SC'}]};
  return {card,batch};
}

test('saving keeps a standalone full profile, provenance, contact and editable notes without changing discovery data',()=>{
  const {card,batch}=fixture();
  const saved=leadSnapshot(card,batch,'saved');
  assert.equal(saved.card.business.phone,'8035550123');
  assert.equal(card.business.phone,'(803) 555-0123');
  assert.equal(saved.contactName,'Jamie Smith');
  assert.match(saved.notes,/local dental practice/); assert.match(saved.notes,/Jamie Smith/);
  card.intelligence.facts[0].value='Changed upstream'; batch.addresses[0].text='Changed upstream';
  assert.equal(saved.card.intelligence.facts[0].value,'Jamie Smith');
  // The stored snapshot must stand alone even when the original batch disappears.
  const restored=leadBatch(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.prospects[0].business.name,'Example Dental');
  assert.equal(restored.addresses[0].text,'100 Main St, Columbia SC');
});

test('never-see-again matches across batches and listing IDs while keeping separate branches',()=>{
  const {card,batch}=fixture();const hidden=leadSnapshot(card,batch,'hidden');
  const rediscovered={...card,id:'another-card',business:{...card.business,id:'another-provider',address:'101 Main St, Columbia SC'}};
  assert.equal(findLead([hidden],rediscovered)?.disposition,'hidden');
  assert.equal(findLead([hidden],{...rediscovered,business:{...rediscovered.business,address:'900 Main St, Columbia SC',coordinates:{lat:34.1,lng:-81}}}),undefined);
});

test('edited contact and notes survive refreshed research and hide/restore actions',()=>{
  const {card,batch}=fixture();
  const edited=leadSnapshot(card,batch,'saved',undefined,{contactName:'Jay',notes:'Ask for Jay. Follow up Friday.'});
  const refreshed=leadSnapshot({...card,intelligence:null},batch,'hidden',edited);
  assert.equal(refreshed.notes,edited.notes);assert.equal(refreshed.contactName,'Jay');assert.ok(refreshed.card.intelligence);
  const restored=leadSnapshot(card,batch,'saved',refreshed);
  assert.equal(restored.key,edited.key);assert.equal(restored.notes,edited.notes);
  assert.deepEqual(draftLead({...card,intelligence:null}).contactName,'');
});

test('contact numbers stay digits-only and Spectrum/Charter labels match reported brand names',()=>{
  assert.equal(digits('+1 (803) 555-0123'),'18035550123');assert.equal(digits(null),'');
  assert.equal(isSpectrumProvider('Charter Communications Inc'),true);assert.equal(isSpectrumProvider('Spectrum Business'),true);
  assert.equal(isSpectrumProvider('Viasat Inc'),false);assert.equal(isSpectrumProvider('Spectrumless Networks'),false);
});
