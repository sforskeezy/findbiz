import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { applyNoteChange, validateNoteChange, NoteConflict, noteTitle } from '../src/lib/swarm/notes.ts';
import { GET, POST } from '../src/app/api/swarm/notes/route.ts';

const change=(key=randomUUID(),revision=0,changes={title:'Call notes',body:'Ask for Sam',tags:['Call']})=>({key,expectedRevision:revision,mutationId:randomUUID(),changes});
test('note edits reject stale revisions while safe retries remain idempotent',()=>{
  const create=change();const first=applyNoteChange(null,create,'2026-09-20T10:00:00Z');
  const update=change(first.key,1,{body:'Sam prefers mornings'});const next=applyNoteChange(first,update,'2026-09-20T11:00:00Z');
  assert.equal(next.revision,2);assert.equal(next.createdAt,first.createdAt);
  assert.deepEqual(applyNoteChange(next,update),next);
  assert.throws(()=>applyNoteChange(next,change(first.key,1,{body:'Stale draft'})),NoteConflict);
});
test('trash and restore preserve note content, tags and business linkage',()=>{
  const first=applyNoteChange(null,change(undefined,0,{title:'Important',body:'Do not lose this',tags:['Territory'],leadKey:'local-biz',pinned:true}));
  const trash=applyNoteChange(first,change(first.key,1,{trashed:true}));
  const restored=applyNoteChange(trash,change(first.key,2,{trashed:false}));
  assert.equal(restored.body,first.body);assert.equal(restored.leadKey,'local-biz');assert.equal(restored.pinned,true);assert.deepEqual(restored.tags,['Territory']);assert.equal(restored.trashed,false);
});
test('note validation bounds content and prevents changing server-owned metadata',()=>{
  for(const fields of [{body:'x'.repeat(30001)},{title:'x'.repeat(161)},{revision:900},{createdAt:'yesterday'},{pinned:'yes'},{tags:[null]},{tags:Array(7).fill('a')},{leadKey:123}])assert.throws(()=>validateNoteChange(change(undefined,0,fields)));
  assert.deepEqual(validateNoteChange(change(undefined,0,{tags:['Call',' Call ']})).changes.tags,['Call']);
  assert.equal(noteTitle({title:'',body:'xylophone business'}),'xylophone business');
  assert.equal(noteTitle({title:'',body:'- [ ] Call Sam'}),'Call Sam');
});
test('notes API persists records, rejects competing edits, blocks foreign origins and restores trash',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'findbiz-notes-test-'));const old=process.env.SWARM_STORE_PATH;process.env.SWARM_STORE_PATH=root;
  const post=(data,origin='http://localhost:3000')=>POST(new Request('http://localhost:3000/api/swarm/notes',{method:'POST',headers:{'Content-Type':'application/json',origin},body:JSON.stringify(data)}));
  try {
    const create=change();assert.equal((await post(create)).status,200);
    assert.equal((await (await GET()).json()).notes[0].body,'Ask for Sam');
    const results=await Promise.all([post(change(create.key,1,{body:'New note A'})),post(change(create.key,1,{body:'New note B'}))]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal((await post(change(create.key,2,{trashed:true}),'https://unrelated.example')).status,403);
    assert.equal((await post(change(create.key,2,{leadKey:'missing-business'}))).status,400);
    assert.equal((await post(change(create.key,2,{trashed:true}))).status,200);
    assert.equal((await (await GET()).json()).notes[0].trashed,true);
    assert.equal((await post(change(create.key,3,{trashed:false}))).status,200);
    assert.equal((await (await GET()).json()).notes[0].trashed,false);
  } finally {await rm(root,{recursive:true,force:true});if(old===undefined)delete process.env.SWARM_STORE_PATH;else process.env.SWARM_STORE_PATH=old;}
});
