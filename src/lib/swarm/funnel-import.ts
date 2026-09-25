import ExcelJS from 'exceljs';
import { inferKind, normalizeFunnelInput, type FunnelInput, type FunnelStatus } from '@/lib/swarm/funnel';

export type ImportPreview = { rows: FunnelInput[]; skipped: number; warnings: string[] };
const MAX_ROWS = 5000;
const headings = {
  businessName: /^(?:biz(?:\s*name)?|business(?:\s*name)?|company(?:\s*name)?|customer(?:\s*name)?|lead(?:\s*name)?|account\s*name|name)$/i,
  phone: /^(?:phone(?:\s*(?:number|#|no))?|mobile|tel(?:ephone)?|contact\s*(?:number|phone)|cell)$/i,
  accountNumber: /^(?:acc(?:ount)?(?:\s*(?:number|#|no|id))?|acct(?:\s*(?:number|#|no))?|customer\s*(?:id|number))$/i,
  contactName: /^(?:contact(?:\s*name)?|owner|decision\s*maker|person)$/i,
  contactInfo: /^(?:(?:phone|mobile|contact)(?:\s*(?:number|no))?\s*(?:or|and|\/)\s*(?:acc|account|acct)(?:\s*(?:number|no))?(?:\s*or\s*both)?|phone\s*\/\s*account)$/i,
  notes: /^(?:info(?:rmation)?(?:\s*(?:and|\/)\s*notes?)?|notes?|details?|comments?|description|remarks?|opportunity)$/i,
  status: /^(?:status|stage|color|colour|priority)$/i,
  followUpAt: /^(?:follow\s*up(?:\s*date)?|next\s*(?:step|contact|call)(?:\s*date)?|due\s*date)$/i,
  followUpTime: /^(?:follow\s*up\s*time|next\s*(?:step|contact|call)\s*time|due\s*time)$/i,
  kind: /^(?:type|lead\s*type|product|service|offer)$/i,
} satisfies Record<string, RegExp>;
type Field = keyof typeof headings;
function cleanHeader(value:string) {return value.toLowerCase().replace(/[_#.:/()-]+/g,' ').replace(/\s+/g,' ').trim();}
function columns(values:string[]) {
  const mapping:Partial<Record<Field,number>>={};
  for (let index=0;index<values.length;index++) {
    const label=cleanHeader(values[index]);
    for (const [field,pattern] of Object.entries(headings) as [Field,RegExp][]) if(mapping[field]===undefined&&pattern.test(label)) mapping[field]=index;
  }
  return mapping;
}
function color(text:string):FunnelStatus {
  if (/\b(?:red|hot|urgent|close\s*asap)\b/i.test(text)) return 'red';
  if (/\b(?:yellow|50\s*\/\s*50|warm|conversation|spoke)\b/i.test(text)) return 'yellow';
  if (/\b(?:green|sold|won|closed\s*won)\b/i.test(text)) return 'green';
  return 'blue';
}
function date(value:string) {
  const trimmed=value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (!trimmed || !/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(trimmed)) return '';
  const parsed=new Date(trimmed);
  return Number.isNaN(parsed.getTime())?'':`${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
}
function phoneAndAccount(value:string) {
  const match=value.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d+)?/i);
  const phone=match?.[0]?.trim()??'';
  const account=value.replace(match?.[0]??'', '').replace(/\b(?:phone|ph|acc(?:ount)?|acct|number|no)\b\s*[:#-]?/gi,'').replace(/^[\s,;/|&+]+|[\s,;/|&+]+$/g,'').trim();
  return {phone,account};
}
function rowToLead(values:string[], mapping:Partial<Record<Field,number>>, source:string):FunnelInput|null {
  const get=(field:Field)=>values[mapping[field]??-1]?.trim()??'';
  const named=Object.keys(mapping).length>0;
  const businessName=named?get('businessName'):values[0]?.trim()??'';
  if (!businessName) return null;
  let phone=named?get('phone'):'';
  let accountNumber=named?get('accountNumber'):'';
  const combined=named?get('contactInfo'):(values[1]??'');
  if(combined){const parsed=phoneAndAccount(combined);phone=phone||parsed.phone;accountNumber=accountNumber||parsed.account;}
  const notes=named?get('notes'):values.slice(2).filter(Boolean).join(' · ');
  const kindText=named?get('kind'):'';
  const statusText=named?get('status'):'';
  return normalizeFunnelInput({businessName,phone,accountNumber,contactName:named?get('contactName'):'',notes,
    status:color(statusText),kind:inferKind(`${kindText} ${notes}`),followUpAt:date(named?get('followUpAt'):''),followUpTime:named?get('followUpTime'):'',source});
}
function parseDelimitedLine(line:string, delimiter:string) {
  const cells:string[]=[];let cell='',quoted=false;
  for(let i=0;i<line.length;i++) {
    const char=line[i];
    if(char==='"') {if(quoted&&line[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(char===delimiter&&!quoted){cells.push(cell.trim());cell='';}
    else cell+=char;
  }
  cells.push(cell.trim());return cells;
}
function parseTextBlock(block:string,source:string):FunnelInput|null {
  const [first,...rest]=block.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  const businessName=first?.replace(/^(?:business|biz|company|customer|lead)(?:\s*name)?\s*[:#-]\s*/i,'').trim();
  if(!businessName)return null;
  let phone='',accountNumber='',contactName='',statusText='',followUpAt='',followUpTime='';const noteLines:string[]=[];
  for(const line of rest) {
    const match=line.match(/^([^:]+):\s*(.+)$/);
    const label=match?.[1]?.trim().toLowerCase()??'';
    const value=match?.[2]?.trim()??'';
    if(/^(?:phone|mobile|tel|cell)/.test(label))phone=value;
    else if(/^(?:acc|account|acct)/.test(label))accountNumber=value;
    else if(/^(?:contact|owner)/.test(label))contactName=value;
    else if(/^(?:status|stage|color|priority)/.test(label))statusText=value;
    else if(/^(?:follow|due|next call)/.test(label)){followUpAt=date(value);followUpTime=value.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/)?.[0]?.padStart(5,'0')??'';}
    else noteLines.push(match&&/^(?:notes?|info|details?|comments?)/.test(label)?value:line);
  }
  if(!phone&&!accountNumber) {
    const extracted=phoneAndAccount(noteLines.join(' '));
    phone=extracted.phone;
    // Only use an unlabelled account when the block explicitly says "account".
    const account=noteLines.join(' ').match(/\b(?:acc(?:ount)?|acct)\s*(?:#|number|no)?\s*[:#-]?\s*([\w-]+)/i);
    accountNumber=account?.[1]??'';
  }
  const notes=noteLines.join('\n');
  return normalizeFunnelInput({businessName,phone,accountNumber,contactName,notes,status:color(statusText),kind:inferKind(notes),followUpAt,followUpTime,source});
}
function parseDelimitedText(text:string, delimiter:string) {
  const rows:string[][]=[];let cell='',row:string[]=[],quoted=false;
  for(let i=0;i<text.length;i++) {
    const char=text[i];
    if(char==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(char===delimiter&&!quoted){row.push(cell.trim());cell='';}
    else if((char==='\n'||char==='\r')&&!quoted){if(char==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell='';}
    else cell+=char;
  }
  row.push(cell.trim());if(row.some(Boolean))rows.push(row);
  return rows;
}
function rowsToPreview(rows:string[][],source:string):ImportPreview {
  let skipped=0;const warnings:string[]=[];const leads:FunnelInput[]=[];
  const headerIndex=rows.findIndex(row=>Object.keys(columns(row)).includes('businessName'));
  const mapping=headerIndex>=0&&headerIndex<8?columns(rows[headerIndex]):{};
  const start=headerIndex>=0&&headerIndex<8?headerIndex+1:0;
  for(let index=start;index<rows.length;index++) {
    if(leads.length>=MAX_ROWS){warnings.push(`Only the first ${MAX_ROWS} leads were read.`);break;}
    try {const lead=rowToLead(rows[index],mapping,source);if(lead)leads.push(lead);else skipped++;}
    catch {skipped++;}
  }
  if(skipped)warnings.push(`${skipped} empty or incomplete ${skipped===1?'row was':'rows were'} skipped.`);
  return {rows:leads,skipped,warnings};
}
function excelText(cell:ExcelJS.Cell) {
  if(cell.value===null||cell.value===undefined)return '';
  if(cell.type===ExcelJS.ValueType.Date && cell.value instanceof Date) return cell.value.toISOString().slice(0,10);
  if(typeof cell.value==='number' && /^0+$/.test(cell.numFmt??''))return String(cell.value).padStart(cell.numFmt.length,'0');
  return cell.text?.trim()??String(cell.value);
}
function checkWorkbookSize(buffer:Buffer) {
  const start=Math.max(0,buffer.length-65_557);
  let end=-1;
  for(let i=buffer.length-22;i>=start;i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw Error('This Excel file is not a valid .xlsx workbook.');
  const entries=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16);
  if(entries===0xffff||offset===0xffffffff||entries>2000)throw Error('This workbook is too complex to import.');
  let cursor=offset,total=0;
  for(let i=0;i<entries;i++) {
    if(cursor+46>buffer.length||buffer.readUInt32LE(cursor)!==0x02014b50)throw Error('This Excel file is damaged.');
    const unpacked=buffer.readUInt32LE(cursor+24);
    if(unpacked===0xffffffff||unpacked>25_000_000)throw Error('This workbook is too large to import.');
    total+=unpacked;if(total>60_000_000)throw Error('This workbook is too large to import.');
    cursor+=46+buffer.readUInt16LE(cursor+28)+buffer.readUInt16LE(cursor+30)+buffer.readUInt16LE(cursor+32);
  }
}
export async function parseFunnelFile(name:string, buffer:Buffer):Promise<ImportPreview> {
  const extension=name.toLowerCase().split('.').pop();
  if(buffer.length>8_000_000)throw Error(`${name} is over the 8 MB limit.`);
  if(extension==='xlsx') {
    checkWorkbookSize(buffer);
    const workbook=new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const all:ImportPreview={rows:[],skipped:0,warnings:[]};
    for(const sheet of workbook.worksheets) {
      if(!sheet.state||sheet.state==='visible') {
        const rows:string[][]=[];
        sheet.eachRow({includeEmpty:false},row=>{if(rows.length<=MAX_ROWS+8)rows.push(Array.from({length:Math.min(row.cellCount,40)},(_,i)=>excelText(row.getCell(i+1))));});
        const preview=rowsToPreview(rows,`${name} · ${sheet.name}`);
        all.rows.push(...preview.rows.slice(0,Math.max(0,MAX_ROWS-all.rows.length)));
        all.skipped+=preview.skipped;all.warnings.push(...preview.warnings.map(warning=>`${sheet.name}: ${warning}`));
      }
      if(all.rows.length>=MAX_ROWS){all.warnings.push(`Only the first ${MAX_ROWS} leads were read.`);break;}
    }
    return all;
  }
  if(extension==='xls')throw Error('Older .xls files need to be saved as .xlsx or CSV before import.');
  if(!['csv','tsv','txt'].includes(extension??''))throw Error(`Unsupported file: ${name}. Use .xlsx, .csv, .tsv, or .txt.`);
  const text=buffer.toString('utf8').replace(/^\uFEFF/,'');
  if(text.includes('\uFFFD'))throw Error(`${name} is not UTF-8 text. Save it as UTF-8 and try again.`);
  if(text.length>8_000_000)throw Error(`${name} is too large.`);
  const first=text.split(/\r?\n/).find(line=>line.trim())??'';
  const delimiter=extension==='tsv'?'\t':extension==='csv'?',':first.includes('\t')?'\t':first.includes('>')?'>':first.includes('|')?'|':first.includes(' - ')?'-':',';
  if(extension==='txt'&&!first.includes(delimiter)) {
    const blocks=text.split(/\r?\n\s*\r?\n/).map(block=>block.trim()).filter(Boolean);
    const rows=blocks.map(block=>parseTextBlock(block,name)).filter((row):row is FunnelInput=>!!row);
    return {rows:rows.slice(0,MAX_ROWS),skipped:blocks.length-rows.length,warnings:rows.length>MAX_ROWS?[`Only the first ${MAX_ROWS} leads were read.`]:[]};
  }
  // Text files often use a simple > or | separator; quoted CSV/TSV also works.
  const rows=delimiter==='>'||delimiter==='|'||delimiter==='-'?text.split(/\r?\n/).filter(Boolean).map(line=>delimiter==='-'?line.split(/\s+-\s+/).map(value=>value.trim()):parseDelimitedLine(line,delimiter)):parseDelimitedText(text,delimiter);
  return rowsToPreview(rows,name);
}
