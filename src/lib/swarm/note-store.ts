import { cloudConfigured, requireDurableStorage, updateCloud } from '@/lib/swarm/cloud-store';
import { listRepRecords, saveRepRecord } from '@/lib/swarm/rep-store';
import { applyNoteChange, type WorkspaceNote, type NoteChange } from '@/lib/swarm/notes';
let localWrites:Promise<unknown>=Promise.resolve();
export async function saveNote(change: NoteChange) {
  requireDurableStorage();
  if(cloudConfigured())return updateCloud<WorkspaceNote>('notes',change.key,existing=>applyNoteChange(existing,change),note=>({key:note.key}));
  const write=localWrites.catch(()=>{}).then(async()=>{
    const existing=(await listRepRecords<WorkspaceNote>('notes')).find(note=>note.key===change.key)??null;
    return saveRepRecord('notes',applyNoteChange(existing,change));
  });
  localWrites=write;return write;
}
