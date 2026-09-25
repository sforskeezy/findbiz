import { FunnelConflict, importFunnelLeads, listFunnelLeads, putFunnelLead } from '@/lib/swarm/funnel-store';
import { sameOrigin } from '@/lib/swarm/request-origin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET() {
  try{return Response.json({leads:await listFunnelLeads()},{headers});}
  catch(error){return Response.json({error:error instanceof Error?error.message:'Could not load funnel.'},{status:503,headers});}
}
export async function POST(request:Request) {
  if(!sameOrigin(request))return Response.json({error:'Cross-origin request rejected.'},{status:403,headers});
  try {
    const text=await request.text();
    if(text.length>4_000_000)throw Error('Too many leads in one request.');
    const body=JSON.parse(text);
    if(body.action==='import') {
      if(!Array.isArray(body.rows))throw Error('Invalid import.');
      return Response.json(await importFunnelLeads(body.rows),{headers});
    }
    if(body.action!=='save')throw Error('Invalid funnel action.');
    const lead=await putFunnelLead(body.lead,body.key,body.expectedUpdatedAt,body.archivedAt);
    return Response.json({lead},{headers});
  } catch(error) {
    return Response.json({error:error instanceof Error?error.message:'Could not save funnel.',conflict:error instanceof FunnelConflict},{status:error instanceof FunnelConflict?409:400,headers});
  }
}
