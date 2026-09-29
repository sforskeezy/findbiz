export type WorkspaceNote = {
  key: string; title: string; body: string; pinned: boolean; trashed: boolean;
  leadKey: string | null; tags: string[]; revision: number; mutationId: string;
  createdAt: string; updatedAt: string;
};
export type NoteFields = Pick<WorkspaceNote,'title'|'body'|'pinned'|'trashed'|'leadKey'|'tags'>;
export type NoteChange = { key: string; expectedRevision: number; mutationId: string; changes: Partial<NoteFields> };
export class NoteConflict extends Error { constructor(){super('This note changed elsewhere. Your draft is safe. Save it as a copy or load the latest version.');} }
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateNoteChange(input: unknown): NoteChange {
  const value=input as NoteChange;
  if(!value || !uuid.test(value.key??'') || !uuid.test(value.mutationId??'') || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision<0 || !value.changes || typeof value.changes!=='object' || Array.isArray(value.changes))throw Error('Invalid note update.');
  const fields=value.changes;
  if(Object.keys(fields).some(key=>!['title','body','pinned','trashed','leadKey','tags'].includes(key)))throw Error('Unknown note field.');
  if(fields.title!==undefined&&(typeof fields.title!=='string'||fields.title.length>160))throw Error('Keep the title under 160 characters.');
  if(fields.body!==undefined&&(typeof fields.body!=='string'||fields.body.length>30000))throw Error('Keep the note under 30,000 characters.');
  if(['pinned','trashed'].some(key=>fields[key as 'pinned']!==undefined&&typeof fields[key as 'pinned']!=='boolean'))throw Error('Invalid note setting.');
  if(fields.leadKey!==undefined&&fields.leadKey!==null&&(typeof fields.leadKey!=='string'||fields.leadKey.length>1000||!fields.leadKey))throw Error('Invalid linked business.');
  if(fields.tags!==undefined&&(!Array.isArray(fields.tags)||fields.tags.length>6||fields.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>32)))throw Error('Use up to six tags, each under 32 characters.');
  return {...value,changes:{...fields,...(fields.tags?{tags:[...new Set(fields.tags.map(t=>t.trim()))]}:{})}};
}
export function applyNoteChange(previous: WorkspaceNote | null, change: NoteChange, now=new Date().toISOString()): WorkspaceNote {
  if(previous?.mutationId===change.mutationId)return previous;
  if((previous?.revision??0)!==change.expectedRevision)throw new NoteConflict();
  return {...(previous??{key:change.key,title:'',body:'',pinned:false,trashed:false,leadKey:null,tags:[],createdAt:now}),...change.changes,revision:(previous?.revision??0)+1,mutationId:change.mutationId,updatedAt:now};
}
export function noteFields(note: WorkspaceNote): NoteFields {
  return {title:note.title,body:note.body,pinned:note.pinned,trashed:note.trashed,leadKey:note.leadKey,tags:note.tags};
}
export function noteTitle(note: Pick<WorkspaceNote,'title'|'body'>) { return note.title.trim() || note.body.split('\n').find(line=>line.trim())?.replace(/^\s*(?:#{1,6}\s+|-\s+\[[ x]\]\s*|[-*]\s+)/i,'').slice(0,90) || 'Untitled note'; }
export function notePreview(body: string) {return body.replace(/\[[ x]\]/gi,'').replace(/[#*]/g,'').replace(/\s+/g,' ').trim();}
