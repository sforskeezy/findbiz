import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { requireDurableStorage, StorageUnavailable } from '../src/lib/swarm/cloud-store.ts';
import { saveRepRecord, listRepRecords } from '../src/lib/swarm/rep-store.ts';
import { clusterReview, territoryProspectKey, clusterName } from '../src/lib/swarm/territory.ts';
import { sourceCache } from '../src/lib/swarm/source-cache.ts';
import { sameOrigin } from '../src/lib/swarm/request-origin.ts';
import { createSwarm, runSwarm } from '../src/lib/swarm/engine.ts';
import { mutateSwarm, readSwarm, listSwarmBatches } from '../src/lib/swarm/store.ts';
import { generateDemoResearch } from '../src/lib/demo-data.ts';

test('serverless deployments refuse ephemeral batch storage instead of silently losing data',()=>{
  const old=process.env.NETLIFY;process.env.NETLIFY='true';
  try { assert.throws(()=>requireDurableStorage(),StorageUnavailable); } finally { if(old===undefined)delete process.env.NETLIFY;else process.env.NETLIFY=old; }
});
test('reviewed territories survive new batch IDs and flag newly discovered businesses',()=>{
  const card={id:'first',business:{name:'Smith Dental',address:'101 Main St, Columbia SC'}};
  const review={key:'area',reviewedAt:new Date().toISOString(),prospectIds:[territoryProspectKey(card)]};
  assert.deepEqual(clusterReview([{...card,id:'new-batch-card'}],review),{reviewed:true,newCount:0});
  assert.deepEqual(clusterReview([card,{...card,business:{...card.business,name:'Another Business'}}],review),{reviewed:true,newCount:1});
  assert.equal(clusterName([card]),'Main St');
});
test('overlapping official-report requests coalesce; failures are retried, not cached',async()=>{
  const cache=sourceCache(1000);let calls=0;
  const load=async()=>{calls++;await new Promise(r=>setTimeout(r,5));return 'FCC report';};
  assert.deepEqual(await Promise.all(Array.from({length:12},()=>cache('block-1',load))),Array(12).fill('FCC report'));
  assert.equal(calls,1);
  await cache('block-2',load);assert.equal(calls,2);
  await assert.rejects(cache('failure',async()=>{throw Error('offline');}));
  assert.equal(await cache('failure',load),'FCC report');
});
test('Netlify forwarded origins are accepted and unrelated cross-origin mutations rejected',()=>{
  const headers={'x-forwarded-host':'pai.6point.design','x-forwarded-proto':'https',origin:'https://pai.6point.design'};
  assert.equal(sameOrigin(new Request('http://internal/api/swarm',{headers})),true);
  assert.equal(sameOrigin(new Request('http://internal/api/swarm',{headers:{...headers,origin:'https://unrelated.example'}})),false);
  assert.equal(sameOrigin(new Request('http://internal/api/swarm',{headers:{...headers,origin:'null'}})),false);
});
test('server-side lead book survives reloads and importing a browser copy cannot overwrite edited notes',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'findbiz-rep-test-'));const old=process.env.SWARM_STORE_PATH;process.env.SWARM_STORE_PATH=root;
  try {
    await saveRepRecord('leads',{key:'business',notes:'Latest notes'});
    await saveRepRecord('leads',{key:'business',notes:'Older browser copy'},true);
    assert.equal((await listRepRecords('leads'))[0].notes,'Latest notes');
    await saveRepRecord('territory',{key:'area',reviewedAt:'2026-09-16',prospectIds:['business']});
    assert.equal((await listRepRecords('territory'))[0].prospectIds[0],'business');
  } finally {await rm(root,{recursive:true,force:true});if(old===undefined)delete process.env.SWARM_STORE_PATH;else process.env.SWARM_STORE_PATH=old;}
});
test('an expired worker lease recovers unfinished discovery and bounded parallel qualification',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'findbiz-worker-test-'));const old=process.env.SWARM_STORE_PATH;process.env.SWARM_STORE_PATH=root;
  try {
    const batch=await createSwarm(['100 Main St, Columbia SC'],1);
    await mutateSwarm(batch.id,b=>{b.status='scanning';b.lease='dead-worker';b.leaseUntil=new Date(Date.now()-1000).toISOString();b.addresses[0].status='scanning';});
    const fixture=generateDemoResearch();const p=fixture.prospects[0];let active=0,maxActive=0;
    await runSwarm(batch.id,{
      discover:async()=>({...fixture,demoMode:false,prospects:Array.from({length:15},(_,i)=>({...p,id:`b${i}`,name:`Business ${i}`,distanceMiles:.1})),warnings:[]}),
      broadband:async()=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));active--;return {observations:[],matchQuality:'unavailable'};},
      research:async()=>{throw Error('Not requested');}
    });
    const result=await readSwarm(batch.id);assert.equal(result.status,'complete');assert.equal(result.prospects.length,15);assert.equal(maxActive,12);assert.equal(result.lease,null);
  } finally {await rm(root,{recursive:true,force:true});if(old===undefined)delete process.env.SWARM_STORE_PATH;else process.env.SWARM_STORE_PATH=old;}
});

test('removing a batch pauses its worker and hides it from active history without deleting its recoverable data',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'findbiz-archive-test-'));const old=process.env.SWARM_STORE_PATH;process.env.SWARM_STORE_PATH=root;
  try {
    const batch=await createSwarm(['100 Main St, Columbia SC'],1);
    await mutateSwarm(batch.id,b=>{b.archivedAt=new Date().toISOString();b.status='paused';b.lease=null;b.leaseUntil=null;});
    assert.equal((await listSwarmBatches()).length,0);
    assert.equal((await listSwarmBatches(true)).length,1);
    await runSwarm(batch.id,{discover:()=>{throw Error('Archived batch must not run');},broadband:()=>{},research:()=>{}});
    assert.equal((await readSwarm(batch.id)).addresses.length,1);
    await mutateSwarm(batch.id,b=>{b.archivedAt=null;});
    assert.equal((await listSwarmBatches()).length,1);
    assert.equal((await readSwarm(batch.id)).status,'paused');
  } finally {await rm(root,{recursive:true,force:true});if(old===undefined)delete process.env.SWARM_STORE_PATH;else process.env.SWARM_STORE_PATH=old;}
});
