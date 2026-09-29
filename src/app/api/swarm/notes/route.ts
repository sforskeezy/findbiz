import { listRepRecords, readSavedLead } from '@/lib/swarm/rep-store';
import { saveNote } from '@/lib/swarm/note-store';
import { NoteConflict, validateNoteChange, type WorkspaceNote } from '@/lib/swarm/notes';
import { sameOrigin } from '@/lib/swarm/request-origin';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET() {
  try {return Response.json({notes:await listRepRecords<WorkspaceNote>('notes')},{headers});}
  catch {return Response.json({error:'Could not load notes. Your saved notes are still in storage.'},{status:503,headers});}
}
export async function POST(request:Request) {
  if(!sameOrigin(request))return Response.json({error:'Cross-origin request rejected.'},{status:403});
  try {
    const text=await request.text();if(text.length>50000)throw Error('This note is too large.');
    const change=validateNoteChange(JSON.parse(text));
    if(change.changes.leadKey&&!await readSavedLead(change.changes.leadKey))throw Error('Choose a business from your saved list.');
    return Response.json({note:await saveNote(change)},{headers});
  } catch(e) {return Response.json({error:e instanceof Error?e.message:'Could not save note.',conflict:e instanceof NoteConflict},{status:e instanceof NoteConflict?409:400,headers});}
}
