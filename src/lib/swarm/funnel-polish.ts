import { inferKind, normalizeFunnelInput, type FunnelInput } from '@/lib/swarm/funnel';

export type PolishMode='capture'|'update';
export type PolishResult={fields:FunnelInput;summary:string;usedAi:boolean};
const phonePattern=/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d+)?/i;
const weekdays=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
const clean=(text:string)=>text.replace(/\s+/g,' ').trim();
const iso=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const localDate=(today:string)=>/^\d{4}-\d{2}-\d{2}$/.test(today)?new Date(`${today}T12:00:00`):new Date();
function followUp(text:string,today:string) {
  if(!/\b(?:follow\s*up|callback|call\s*(?:back|them)|next\s*(?:call|meeting|week)|tomorrow|next\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i.test(text))return {followUpAt:'',followUpTime:''};
  const now=localDate(today);let date='';
  const explicit=text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if(explicit)date=explicit[1];
  else if(/\btomorrow\b/i.test(text)){now.setDate(now.getDate()+1);date=iso(now);}
  else if(/\bnext week\b/i.test(text)){now.setDate(now.getDate()+7);date=iso(now);}
  else if(/\btoday\b/i.test(text))date=iso(now);
  else {
    const weekday=text.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
    if(weekday){const target=weekdays.indexOf(weekday[1].toLowerCase());const advance=(target-now.getDay()+7)%7||7;now.setDate(now.getDate()+advance);date=iso(now);}
    else {
      const us=text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
      if(us){let year=us[3]?Number(us[3]):now.getFullYear();if(year<100)year+=2000;const candidate=new Date(year,Number(us[1])-1,Number(us[2]),12);if(candidate.getMonth()===Number(us[1])-1&&candidate.getDate()===Number(us[2]))date=iso(candidate);}
    }
  }
  const time=text.match(/\b(?:at|around|by)\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);
  let followUpTime='';
  if(time&&date){let hour=Number(time[1]);const minute=Number(time[2]??'0');const meridiem=time[3]?.toLowerCase().replaceAll('.','');if(meridiem==='pm'&&hour<12)hour+=12;if(meridiem==='am'&&hour===12)hour=0;if(hour<24&&minute<60)followUpTime=`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`;}
  return {followUpAt:date,followUpTime};
}
function leadStatus(text:string,existing:FunnelInput['status'],mode:PolishMode):FunnelInput['status'] {
  if(/\b(?:sold|closed\s*won|signed\s*(?:up|the deal)|deal\s*closed)\b/i.test(text))return 'green';
  if(/\b(?:hot lead|close\s*(?:asap|tomorrow|within\s*two\s*days)|ready\s*to\s*(?:buy|sign))\b/i.test(text))return 'red';
  if(existing==='red'||existing==='green')return existing;
  if(/\b(?:spoke|talked|met with|had\s*(?:a\s*)?(?:call|conversation|meeting)|things\s+went\s+(?:good|well)|call\s+went\s+(?:good|well)|interested|50\s*\/\s*50)\b/i.test(text)&&!/\b(?:haven't|have not|didn't|did not|no answer|voicemail)\s*(?:spoken|talk|answer)?\b/i.test(text))return 'yellow';
  if(mode==='update'&&/\bfollow\s*up\b/i.test(text)&&!/\b(?:no answer|voicemail|haven't spoken|have not spoken)\b/i.test(text))return 'yellow';
  return existing;
}
function preliminary(text:string,existing:Partial<FunnelInput>,mode:PolishMode,today:string):FunnelInput {
  const lines=text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const nameLabel=text.match(/\b(?:business|biz|company|customer)(?:\s*name)?\s*[:#-]\s*([^\n,;.]+)/i)?.[1]?.trim();
  const first=lines[0]?.split(/[>|,]/)[0]?.replace(/^(?:new lead|add lead)\s*[:#-]?/i,'').trim()??'';
  const candidate=nameLabel||(!existing.businessName&&first&&!phonePattern.test(first)&&first.length<100?first:'');
  const phone=text.match(phonePattern)?.[0]?.trim()??'';
  const account=text.match(/\b(?:acc(?:ount)?|acct)\s*(?:#|number|no)?\s*[:#-]?\s*([a-z0-9-]{2,})/i)?.[1]??'';
  const contact=text.match(/\b(?:spoke|talked)\s+(?:to|with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/)?.[1]??text.match(/\b(?:contact|owner)\s*[:#-]\s*([A-Za-z]+(?:\s+[A-Za-z]+){0,2})/i)?.[1]??'';
  const schedule=followUp(text,today);
  const businessName=existing.businessName||candidate||'';
  const notes=mode==='update'&&existing.notes?`${existing.notes.trim()}\n\n${text.trim()}`:text.trim();
  return {businessName,phone:existing.phone||phone,accountNumber:existing.accountNumber||account,contactName:existing.contactName||contact,notes,status:leadStatus(text,existing.status??'blue',mode),kind:existing.kind&&existing.kind!=='other'?existing.kind:inferKind(text),followUpAt:schedule.followUpAt||existing.followUpAt||'',followUpTime:schedule.followUpTime||existing.followUpTime||'',source:existing.source||'Manual'};
}
export function polishFunnelText(text:string,existing:Partial<FunnelInput>,mode:PolishMode,today:string,model?:Partial<FunnelInput>&{summary?:string}):PolishResult {
  const raw=text.trim().slice(0,10000);
  if(!raw)throw Error('Paste or say a few details first.');
  const basic=preliminary(raw,existing,mode,today);
  const contains=(value:string)=>!!value&&clean(raw).toLowerCase().includes(clean(value).toLowerCase());
  const numberInRaw=(value:string)=>{const digits=value.replace(/\D/g,'');return digits.length>=7&&raw.replace(/\D/g,'').includes(digits);};
  if(model) {
    if(!basic.businessName&&model.businessName&&contains(model.businessName))basic.businessName=model.businessName.trim();
    if(!basic.phone&&model.phone&&numberInRaw(model.phone))basic.phone=model.phone.trim();
    if(!basic.accountNumber&&model.accountNumber&&contains(model.accountNumber))basic.accountNumber=model.accountNumber.trim();
    if(!basic.contactName&&model.contactName&&contains(model.contactName))basic.contactName=model.contactName.trim();
    if(!basic.followUpAt&&model.followUpAt&&/\b(?:follow|call|next|tomorrow|today|\d{1,2}\/\d{1,2})\b/i.test(raw))basic.followUpAt=model.followUpAt;
    if(!basic.followUpTime&&model.followUpTime&&/\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)?\b/i.test(raw))basic.followUpTime=model.followUpTime;
  }
  const summary=clean(model?.summary||raw);
  // Keep facts unchanged; the model only improves phrasing, while rule-based status and literal identifiers stay authoritative.
  const safeSummary=Array.from(summary.matchAll(/\b\d+(?:[.:/-]\d+)*\b/g)).every(match=>raw.includes(match[0]))?summary:clean(raw);
  basic.notes=mode==='update'&&existing.notes?`${existing.notes.trim()}\n\n${today} · ${safeSummary}`:safeSummary;
  if(!basic.businessName)return {fields:{...basic,notes:basic.notes},summary:safeSummary,usedAi:!!model};
  return {fields:normalizeFunnelInput(basic),summary:safeSummary,usedAi:!!model};
}
