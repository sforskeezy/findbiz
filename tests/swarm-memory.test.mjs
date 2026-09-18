import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSession, saveSession, loadSession, listSessions, deleteSession, rememberFact, loadMemory } from '../src/lib/live/store.ts';
import { recallConversations, restorePreviousContext, territoryHistory, recallSwarmBatches } from '../src/lib/live/recall.ts';
import { liveCapabilities } from '../src/lib/live/capabilities.ts';
import { createSwarm, runSwarm } from '../src/lib/swarm/engine.ts';
import { readSwarm, mutateSwarm } from '../src/lib/swarm/store.ts';
import { parseAddressBatch, sameSwarmBusiness, addDiscovery, swarmClusters, exportSwarm } from '../src/lib/swarm/logic.ts';
import { generateDemoResearch } from '../src/lib/demo-data.ts';
let root;
before(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'findbiz-memory-swarm-')); process.env.LIVE_STORE_PATH = path.join(root,'live'); process.env.SWARM_STORE_PATH = path.join(root,'swarm'); });
after(async () => { await rm(root,{recursive:true,force:true}); });
const fixture = () => generateDemoResearch().prospects[0];
const message = (text) => ({id:text,role:'user',content:text,createdAt:new Date().toISOString()});

test('concurrent chat saves retain more than 40 chats and full old messages', async () => {
  const sessions = await Promise.all(Array.from({length:48},()=>createSession()));
  await Promise.all(sessions.map((s,index)=>{s.messages=Array.from({length:60},(_,i)=>message(i===0?`RareTerritory${index} opening request`:`Follow-up ${i}`));return saveSession(s);}));
  assert.equal((await listSessions()).length,48);
  assert.equal((await loadSession(sessions[0].id)).messages.length,60);
  const recalled=await recallConversations('RareTerritory0',sessions[47].id);
  assert.equal(recalled[0].id,sessions[0].id);
  assert.ok(recalled[0].excerpts.some(e=>e.text.includes('RareTerritory0')));
  await deleteSession(sessions[0].id);
  assert.equal(await loadSession(sessions[0].id),null);
  assert.ok((await recallConversations('RareTerritory0')).every(s=>s.id!==sessions[0].id));
});

test('concurrent territory memories preserve multiple areas',async()=>{
  await Promise.all(Array.from({length:20},(_,i)=>rememberFact({kind:'territory',text:`Prospecting region ${i}, South Carolina`}))); 
  assert.equal((await loadMemory()).length,20);
});

test('new chats restore a relevant saved queue and retain earlier seen businesses',async()=>{
  const previous=await createSession(); previous.title='Lugoff hardware route'; previous.messages=[message('Lugoff hardware research')];
  previous.queue={locationLabel:'Lugoff, SC 29078',radiusMiles:2,category:null,currentIndex:0,prospects:[fixture()]}; await saveSession(previous);
  const fresh=await createSession();
  await restorePreviousContext(fresh,'Continue our Lugoff hardware route');
  assert.deepEqual(fresh.queue,previous.queue);
  fresh.queue.currentIndex=1; assert.equal(previous.queue.currentIndex,0);
  const history=await territoryHistory(fresh.id);
  assert.ok(history.areas.some(a=>a.location.includes('29078')));
  assert.ok(history.seen.some(p=>p.id===fixture().id));
});

test('address parser removes duplicate inputs and rejects oversized batches',()=>{
  const parsed=parseAddressBatch('1. 101 Main St, Columbia SC\n101 MAIN ST, Columbia SC; 140 Main St, Columbia SC\n123');
  assert.equal(parsed.addresses.length,2); assert.equal(parsed.duplicates,1); assert.deepEqual(parsed.invalid,['123']);
  assert.throws(()=>parseAddressBatch(Array.from({length:1001},(_,i)=>`${i} Main St`).join('\n')),/1,000/);
});

test('overlapping addresses merge provenance but keep separate business branches',async()=>{
  const batch=await createSwarm(['101 Main St, Columbia SC','140 Main St, Columbia SC'],1);
  const p={...fixture(),name:'Acme Dental',address:'101 Main Street, Columbia SC',coordinates:{lat:34,lng:-81}};
  addDiscovery(batch,p,batch.addresses[0].id,'one');
  addDiscovery(batch,{...p,id:'different-source',address:'101 Main St, Columbia SC'},batch.addresses[1].id,'two');
  assert.equal(batch.prospects.length,1); assert.equal(batch.prospects[0].sourceAddressIds.length,2);
  const branch={...p,id:'branch',address:'800 Main St, Columbia SC',coordinates:{lat:34.04,lng:-81}};
  assert.equal(sameSwarmBusiness(p,branch),false);
  addDiscovery(batch,branch,batch.addresses[1].id,'branch');
  assert.equal(batch.prospects.length,2); assert.equal(swarmClusters(batch.prospects).length,2);
  batch.prospects[0].business.name='=HYPERLINK("evil")';
  const csv=exportSwarm(batch); assert.match(csv,/'=HYPERLINK/); assert.match(csv,/101 Main St, Columbia SC; 140 Main St/); assert.match(csv,/Not verified/);
});

test('Swarm runs concurrent discovery, deduplicates results, isolates failed addresses and researches selected cards',async()=>{
  const batch=await createSwarm(['101 Main St, Columbia SC','140 Main St, Columbia SC','bad address, Columbia SC'],1);
  let active=0,maxActive=0,researchCalls=0;
  const p={...fixture(),distanceMiles:.2,name:'Memory Swarm Hardware'};
  const deps={
    discover:async address=>{active++;maxActive=Math.max(active,maxActive); await new Promise(r=>setTimeout(r,15)); active--; if(address.startsWith('bad'))throw new Error('Geocoding failed');return {...generateDemoResearch(),demoMode:false,prospects:[p],warnings:[]};},
    broadband:async()=>({matchQuality:'unavailable',observations:[],asOfDate:null}),
    research:async()=>{researchCalls++;return {status:'complete',facts:[]};}
  };
  await runSwarm(batch.id,deps);
  let saved=await readSwarm(batch.id);
  assert.equal(maxActive,3); assert.equal(saved.status,'complete'); assert.equal(saved.prospects.length,1); assert.equal(saved.prospects[0].sourceAddressIds.length,2);
  assert.equal(saved.addresses.filter(a=>a.status==='error').length,1); assert.equal(saved.prospects[0].broadbandChecked,true); assert.equal(researchCalls,0);
  await mutateSwarm(batch.id,b=>{b.status='queued';b.prospects[0].researchStatus='queued';});
  await runSwarm(batch.id,deps); saved=await readSwarm(batch.id);
  assert.equal(researchCalls,1);assert.equal(saved.prospects[0].researchStatus,'complete');
  assert.ok((await territoryHistory()).seen.some(p=>p.name==='Memory Swarm Hardware'));
  assert.equal((await recallSwarmBatches('Memory Swarm Hardware'))[0].id,batch.id);
});

test('pausing invalidates in-flight writes and a resumed job can recover the address',async()=>{
  const batch=await createSwarm(['101 Main St, Columbia SC'],1);
  let started,release; const inFlight=new Promise(r=>{started=r;});const gate=new Promise(r=>{release=r;});
  const deps={discover:async()=>{started();await gate;return {...generateDemoResearch(),demoMode:false,prospects:[{...fixture(),distanceMiles:.2}],warnings:[]};},broadband:async()=>({observations:[]}),research:async()=>({status:'complete',facts:[]})};
  const run=runSwarm(batch.id,deps);await inFlight;
  await mutateSwarm(batch.id,b=>{b.status='paused';b.lease=null;b.leaseUntil=null;});release();await run;
  assert.equal((await readSwarm(batch.id)).prospects.length,0);
  await mutateSwarm(batch.id,b=>{b.status='queued';});await runSwarm(batch.id,deps);
  assert.equal((await readSwarm(batch.id)).status,'complete');assert.equal((await readSwarm(batch.id)).prospects.length,1);
});

test('runtime capabilities expose supported modes and availability limitations without secrets',()=>{
  process.env.GROQ_API_KEY='must-never-leak';
  const caps=liveCapabilities();assert.ok(caps.modes.swarm);assert.equal(caps.broadband.currentProviderKnown,false);
  assert.equal(caps.memory.crossChatSearch,true);assert.doesNotMatch(JSON.stringify(caps),/must-never-leak/);
});
