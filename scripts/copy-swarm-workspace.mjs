// Copy the latest cloud workspace into a new deployment without overwriting it.
// node --env-file=.env.local --import ./scripts/test-register.mjs scripts/copy-swarm-workspace.mjs <destination-url>
import { cloudList, cloudRead, cloudWrite } from '../src/lib/swarm/cloud-store.ts';
import { summarizeSwarm } from '../src/lib/swarm/store.ts';
const source=process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
const destination=process.argv[2];
const syncImports=process.argv.includes('--sync-imports');
if(!source||!destination||new URL(destination).protocol!=='https:'||source===destination)throw Error('Provide different source and destination Convex URLs.');
let copied=0,existing=0;
for(const collection of ['swarm','leads','territory']) {
  process.env.CONVEX_URL=source;
  const rows=await cloudList(collection);
  for(const row of rows) {
    process.env.CONVEX_URL=source;
    const snapshot=await cloudRead(collection,row.key);
    if(!snapshot)continue;
    process.env.CONVEX_URL=destination;
    const previous=await cloudRead(collection,row.key);
    if(previous) {
      // Only advance an untouched initial import, and only from a newer dated
      // source. Never overwrite a destination edited since migration (rev > 1).
      const sourceDate=Date.parse(snapshot.value.updatedAt ?? snapshot.value.reviewedAt ?? '');
      const destinationDate=Date.parse(previous.value.updatedAt ?? previous.value.reviewedAt ?? '');
      if(!syncImports || previous.revision!==1 || !Number.isFinite(sourceDate) || !Number.isFinite(destinationDate) || sourceDate<=destinationDate){existing++;continue;}
    }
    const value=snapshot.value;
    if(collection==='swarm'){value.lease=null;value.leaseUntil=null;}
    if(await cloudWrite(collection,row.key,previous?.revision??null,value,collection==='swarm'?summarizeSwarm(value):{key:row.key}))copied++;else existing++;
  }
}
console.log(`Copied ${copied} workspace records; preserved ${existing} existing destination records.`);
