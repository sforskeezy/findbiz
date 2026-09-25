import { parseFunnelFile } from '@/lib/swarm/funnel-import';
import { sameOrigin } from '@/lib/swarm/request-origin';
export const runtime='nodejs';
export async function POST(request:Request) {
  if(!sameOrigin(request))return Response.json({error:'Cross-origin request rejected.'},{status:403});
  try {
    const files=(await request.formData()).getAll('files');
    if(!files.length||files.length>10||files.some(file=>!(file instanceof File)))throw Error('Choose up to 10 Excel or text files.');
    const rows=[];const warnings:string[]=[];let skipped=0,total=0;
    for(const file of files as File[]) {
      total+=file.size;
      if(total>20_000_000)throw Error('The combined file size must be under 20 MB.');
      const result=await parseFunnelFile(file.name,Buffer.from(await file.arrayBuffer()));
      rows.push(...result.rows);skipped+=result.skipped;warnings.push(...result.warnings);
      if(rows.length>5000)throw Error('Import up to 5,000 leads at a time. Split larger files into smaller batches.');
    }
    if(!rows.length)throw Error('No leads found. Include a business name in each row.');
    return Response.json({rows,skipped,warnings},{headers:{'Cache-Control':'private, no-store'}});
  } catch(error) {return Response.json({error:error instanceof Error?error.message:'Could not read these files.'},{status:400});}
}
