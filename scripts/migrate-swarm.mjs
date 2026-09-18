// Run with: node --env-file=.env.local --import ./scripts/test-register.mjs scripts/migrate-swarm.mjs
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { cloudConfigured, cloudRead, cloudWrite } from '../src/lib/swarm/cloud-store.ts';
import { summarizeSwarm } from '../src/lib/swarm/store.ts';
process.env.CONVEX_URL ||= process.env.NEXT_PUBLIC_CONVEX_URL;
if (!cloudConfigured()) throw new Error('Set CONVEX_URL and FINDBIZ_STORAGE_SECRET before migrating.');
const root = path.resolve(process.env.SWARM_STORE_PATH || 'data/swarm');
let imported = 0, existing = 0;
for (const name of await readdir(root)) {
  if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
  const batch = JSON.parse(await readFile(path.join(root,name),'utf8'));
  if (await cloudRead('swarm',batch.id)) { existing++; continue; }
  batch.lease = null; batch.leaseUntil = null;
  if (await cloudWrite('swarm',batch.id,null,batch,summarizeSwarm(batch))) imported++;
}
for (const collection of ['leads','territory']) {
  const directory = path.join(root,collection);
  let files;
  try { files = await readdir(directory); } catch(e) { if(e.code==='ENOENT')continue;throw e; }
  for (const name of files.filter(n=>n.endsWith('.json'))) {
    const record=JSON.parse(await readFile(path.join(directory,name),'utf8'));
    if(await cloudWrite(collection,record.key,null,record,{key:record.key}))imported++;else existing++;
  }
}
console.log(`Migration verified: ${imported} records imported, ${existing} already saved. Local originals retained.`);
