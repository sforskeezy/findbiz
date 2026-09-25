import ExcelJS from 'exceljs';
import { FUNNEL_STATUSES, inferKind, normalizeFunnelInput, type FunnelInput, type FunnelStatus } from '@/lib/swarm/funnel';
import { EMOJI_PATTERN, statusFromEmoji, statusFromSheetColor, statusFromWords, themePalette, type SheetColor } from '@/lib/swarm/funnel-colors';

export type ImportStats = { byStatus: Record<FunnelStatus, number>; fromCellColor: number; fromText: number };
export type ImportPreview = { rows: FunnelInput[]; skipped: number; warnings: string[]; stats: ImportStats; assisted?: boolean };
export type ImportAssist = {
  /** Maps unfamiliar header labels to funnel fields. Returns column indexes. */
  mapHeaders?: (headers: string[]) => Promise<Partial<Record<Field, number>> | null>;
  /** Pulls leads out of free-form text that has no consistent structure. */
  extractLeads?: (text: string) => Promise<Partial<FunnelInput>[] | null>;
};
type Cell = { text: string; fill: FunnelStatus | null; font: FunnelStatus | null };
type Row = Cell[];

const MAX_ROWS = 5000;
const headings = {
  businessName: /^(?:biz(?:\s*name)?|business(?:\s*name)?|company(?:\s*name)?|customer(?:\s*name)?|client(?:\s*name)?|lead(?:\s*name)?|account\s*name|merchant(?:\s*name)?|store(?:\s*name)?|dba|prospect(?:\s*name)?|name)$/i,
  phone: /^(?:phone(?:\s*(?:number|#|no|num))?|mobile(?:\s*number)?|tel(?:ephone)?|contact\s*(?:number|phone)|cell(?:\s*phone)?|ph|btn|number)$/i,
  accountNumber: /^(?:acc(?:ount)?(?:\s*(?:number|#|no|num|id))?|acct(?:\s*(?:number|#|no|num))?|customer\s*(?:id|number|#)|ban)$/i,
  contactName: /^(?:contact(?:\s*name)?|owner(?:\s*name)?|decision\s*maker|person|poc|dm|manager|spoke\s*(?:to|with))$/i,
  contactInfo: /^(?:(?:phone|mobile|contact)(?:\s*(?:number|no|num))?\s*(?:or|and|\/|&)\s*(?:acc|account|acct)(?:\s*(?:number|no|num))?(?:\s*(?:or|and)\s*both)?|phone\s*\/\s*account|contact\s*info)$/i,
  notes: /^(?:info\w*(?:\s*(?:and|\/|&)\s*notes?)?|notes?(?:\s*(?:and|\/|&)\s*info(?:rmation)?)?|details?|comments?|description|remarks?|opportunity|summary|what\s*they\s*(?:want|need))$/i,
  status: /^(?:status|stage|colou?r|priority|temp(?:erature)?|heat|lead\s*status|deal\s*status)$/i,
  followUpAt: /^(?:follow\s*up(?:\s*date)?|next\s*(?:step|contact|call|touch)(?:\s*date)?|due(?:\s*date)?|call\s*back|callback(?:\s*date)?)$/i,
  followUpTime: /^(?:follow\s*up\s*time|next\s*(?:step|contact|call)\s*time|due\s*time|callback\s*time|time)$/i,
  kind: /^(?:type|lead\s*type|product|service|offer|plan|package)$/i,
} satisfies Record<string, RegExp>;
export type Field = keyof typeof headings;
const FIELDS = Object.keys(headings) as Field[];
const phonePattern = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?:\s*(?:ext\.?|x)\s*\d+)?/i;

const emptyStats = (): ImportStats => ({ byStatus: {blue:0,red:0,yellow:0,green:0}, fromCellColor: 0, fromText: 0 });
function cleanHeader(value: string) { return value.toLowerCase().replace(EMOJI_PATTERN,'').replace(/[_#.:/()*?-]+/g,' ').replace(/\s+/g,' ').trim(); }
function columns(values: string[]) {
  const mapping: Partial<Record<Field, number>> = {};
  for (let index = 0; index < values.length; index++) {
    const label = cleanHeader(values[index]);
    if (!label) continue;
    for (const field of FIELDS) if (mapping[field] === undefined && headings[field].test(label)) { mapping[field] = index; break; }
  }
  return mapping;
}
const plain = (row: string[]): Row => row.map(text => ({ text, fill: null, font: null }));
const texts = (row: Row) => row.map(cell => cell.text);

function date(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0,10);
  const us = trimmed.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (!us) return '';
  let year = us[3] ? Number(us[3]) : new Date().getFullYear();
  if (year < 100) year += 2000;
  const parsed = new Date(year, Number(us[1]) - 1, Number(us[2]), 12);
  if (parsed.getMonth() !== Number(us[1]) - 1) return '';
  return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
}
function time(value: string) {
  const match = value.match(/\b([01]?\d|2[0-3])(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);
  if (!match || (!match[2] && !match[3])) return '';
  let hour = Number(match[1]);
  const meridiem = match[3]?.toLowerCase().replaceAll('.','');
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return `${String(hour).padStart(2,'0')}:${match[2] ?? '00'}`;
}
function phoneAndAccount(value: string) {
  const match = value.match(phonePattern);
  const phone = match?.[0]?.trim() ?? '';
  const account = value.replace(match?.[0] ?? '', '').replace(/\b(?:phone|ph|acc(?:ount)?|acct|number|no)\b\s*[:#-]?/gi,'').replace(/^[\s,;/|&+#]+|[\s,;/|&+#]+$/g,'').trim();
  return { phone, account };
}
function majority(values: (FunnelStatus | null)[]) {
  const counts = new Map<FunnelStatus, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
/** A lone "HOT", "SOLD", "🟡 50/50" row acts as a section heading for the leads beneath it. */
function sectionMarker(row: Row): FunnelStatus | null {
  const filled = row.filter(cell => cell.text.trim());
  if (filled.length !== 1) return null;
  const raw = filled[0].text.trim();
  const core = raw.replace(EMOJI_PATTERN,'').replace(/[-=*#:_\[\]()]+/g,' ').replace(/\s+/g,' ').trim();
  if (raw.length > 32 || phonePattern.test(raw)) return null;
  const exact = /^(?:red|hot|blue|cold|yellow|green|sold|won|warm|50 ?\/ ?50|close asap|up in the air|in conversation|closed|new)(?: (?:leads?|deals?|accounts?|list|ones))?$/i.test(core);
  const decorated = raw.replace(EMOJI_PATTERN,'') !== raw || /^[-=*#\[(]|[-=*#\]):]$/.test(raw);
  return exact || (decorated && core.split(' ').length <= 4) ? statusFromWords(raw, true) : null;
}

type Resolved = { status: FunnelStatus; via: 'text' | 'color' | 'default' };
function resolveStatus(row: Row, mapping: Partial<Record<Field, number>>, fallback: FunnelStatus | null): Resolved {
  const statusCell = mapping.status !== undefined ? row[mapping.status] : undefined;
  const nameCell = row[mapping.businessName ?? 0];
  const fromWords = statusCell ? statusFromWords(statusCell.text, true) : null;
  if (fromWords) return { status: fromWords, via: 'text' };
  const fromEmoji = statusFromEmoji(texts(row).join(' '));
  if (fromEmoji) return { status: fromEmoji, via: 'text' };
  const fill = statusCell?.fill ?? nameCell?.fill ?? majority(row.map(cell => cell.fill));
  if (fill) return { status: fill, via: 'color' };
  const font = statusCell?.font ?? nameCell?.font ?? majority(row.map(cell => cell.font));
  if (font && font !== 'blue') return { status: font, via: 'color' };
  if (fallback) return { status: fallback, via: 'text' };
  return { status: 'blue', via: 'default' };
}

function rowToLead(row: Row, mapping: Partial<Record<Field, number>>, headers: string[], source: string, section: FunnelStatus | null) {
  const values = texts(row);
  const get = (field: Field) => values[mapping[field] ?? -1]?.trim() ?? '';
  const named = mapping.businessName !== undefined;
  const businessName = (named ? get('businessName') : values[0]?.trim() ?? '').replace(EMOJI_PATTERN,'').replace(/^[\s\-–•*]+/,'').trim();
  if (!businessName) return null;
  let phone = named ? get('phone') : '';
  let accountNumber = named ? get('accountNumber') : '';
  const combined = named ? get('contactInfo') : values[1] ?? '';
  if (combined) { const parsed = phoneAndAccount(combined); phone = phone || parsed.phone; accountNumber = accountNumber || parsed.account; }
  if (phone && !accountNumber && !phonePattern.test(phone) && /^[\w-]{3,}$/.test(phone)) { accountNumber = phone; phone = ''; }
  const used = new Set(Object.values(mapping));
  const extra = named
    ? values.map((value, index) => used.has(index) || !value.trim() ? '' : headers[index]?.trim() ? `${headers[index].trim()}: ${value.trim()}` : value.trim()).filter(Boolean)
    : values.slice(2).filter((value, index) => value.trim() && index + 2 !== mapping.status);
  const notes = [named ? get('notes') : '', ...extra].filter(Boolean).join(named ? '\n' : ' · ').replace(EMOJI_PATTERN,'').trim();
  const resolved = resolveStatus(row, mapping, section);
  const followUpRaw = get('followUpAt');
  const lead = normalizeFunnelInput({
    businessName, phone, accountNumber, contactName: named ? get('contactName') : '', notes,
    status: resolved.status, kind: inferKind(`${get('kind')} ${notes}`),
    followUpAt: date(followUpRaw), followUpTime: time(get('followUpTime') || followUpRaw), source,
  });
  return { lead, via: resolved.via };
}

function looksLikeHeaderRow(row: string[]) {
  const filled = row.filter(value => value.trim());
  return filled.length >= 2 && filled.every(value => value.length < 45 && !/\d{5,}/.test(value) && !phonePattern.test(value));
}
function inferStatusColumn(rows: Row[], start: number, exclude: Set<number>) {
  const sample = rows.slice(start, start + 40);
  const width = Math.max(0, ...sample.map(row => row.length));
  for (let index = 1; index < width; index++) {
    if (exclude.has(index)) continue;
    const values = sample.map(row => row[index]?.text.trim() ?? '').filter(Boolean);
    if (values.length >= 2 && values.filter(value => value.length <= 16 && statusFromWords(value, true)).length / values.length >= 0.6) return index;
  }
  return undefined;
}

async function rowsToPreview(rows: Row[], source: string, assist?: ImportAssist, sheetStatus: FunnelStatus | null = null): Promise<ImportPreview> {
  let skipped = 0, assisted = false;
  const warnings: string[] = [], leads: FunnelInput[] = [], stats = emptyStats();
  const headerIndex = rows.slice(0, 8).findIndex(row => columns(texts(row)).businessName !== undefined);
  let mapping: Partial<Record<Field, number>> = headerIndex >= 0 ? columns(texts(rows[headerIndex])) : {};
  let start = headerIndex >= 0 ? headerIndex + 1 : 0;
  let headers = headerIndex >= 0 ? texts(rows[headerIndex]) : [];
  if (headerIndex < 0 && rows.length && looksLikeHeaderRow(texts(rows[0])) && assist?.mapHeaders) {
    const guess = await assist.mapHeaders(texts(rows[0])).catch(() => null);
    if (guess && typeof guess.businessName === 'number') { mapping = guess; start = 1; headers = texts(rows[0]); assisted = true; }
  }
  if (mapping.status === undefined) {
    const found = inferStatusColumn(rows, start, new Set(Object.values(mapping)));
    if (found !== undefined && (mapping.businessName !== undefined || found >= 2)) mapping = { ...mapping, status: found };
  }
  let section = sheetStatus;
  for (let index = start; index < rows.length; index++) {
    if (leads.length >= MAX_ROWS) { warnings.push(`Only the first ${MAX_ROWS} leads were read.`); break; }
    const marker = sectionMarker(rows[index]);
    if (marker) { section = marker; continue; }
    try {
      const result = rowToLead(rows[index], mapping, headers, source, section);
      if (!result) { skipped++; continue; }
      leads.push(result.lead); stats.byStatus[result.lead.status]++;
      if (result.via === 'color') stats.fromCellColor++; else if (result.via === 'text') stats.fromText++;
    } catch { skipped++; }
  }
  if (skipped) warnings.push(`${skipped} empty or incomplete ${skipped === 1 ? 'row was' : 'rows were'} skipped.`);
  return { rows: leads, skipped, warnings, stats, assisted };
}

function parseDelimitedLine(line: string, delimiter: string) {
  const cells: string[] = []; let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') { if (quoted && line[i+1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { cells.push(cell.trim()); cell = ''; }
    else cell += char;
  }
  cells.push(cell.trim()); return cells;
}
function parseTextBlock(block: string, source: string, section: FunnelStatus | null) {
  const [first, ...rest] = block.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const businessName = first?.replace(EMOJI_PATTERN,'').replace(/^(?:business|biz|company|customer|lead)(?:\s*name)?\s*[:#-]\s*/i,'').replace(/^[\s\-–•*]+/,'').trim();
  if (!businessName) return null;
  let phone = '', accountNumber = '', contactName = '', statusText = '', followUpAt = '', followUpTime = '';
  const noteLines: string[] = [];
  for (const line of rest) {
    const match = line.match(/^([^:]{1,30}):\s*(.+)$/);
    const label = match?.[1]?.trim().toLowerCase() ?? '';
    const value = match?.[2]?.trim() ?? '';
    if (/^(?:phone|mobile|tel|cell|ph)\b/.test(label)) phone = value;
    else if (/^(?:acc|account|acct|ban)\b/.test(label)) accountNumber = value;
    else if (/^(?:contact|owner|poc|dm)\b/.test(label)) contactName = value;
    else if (/^(?:status|stage|colou?r|priority|temp)\b/.test(label)) statusText = value;
    else if (/^(?:follow|due|next call|callback|call back)/.test(label)) { followUpAt = date(value); followUpTime = time(value); }
    else noteLines.push(match && /^(?:notes?|info|details?|comments?)/.test(label) ? value : line);
  }
  if (!phone && !accountNumber) {
    const joined = [first, ...noteLines].join(' ');
    phone = joined.match(phonePattern)?.[0]?.trim() ?? '';
    accountNumber = joined.match(/\b(?:acc(?:ount)?|acct)\s*(?:#|number|no)?\s*[:#-]?\s*([\w-]+)/i)?.[1] ?? '';
  }
  const notes = noteLines.join('\n').replace(EMOJI_PATTERN,'').trim();
  const cleanName = businessName.replace(phone, '').replace(/[\s,;|>-]+$/,'').trim() || businessName;
  const status = statusFromWords(statusText, true) ?? statusFromEmoji(block) ?? section;
  const lead = normalizeFunnelInput({ businessName: cleanName, phone, accountNumber, contactName, notes, status: status ?? 'blue', kind: inferKind(notes), followUpAt, followUpTime, source });
  return { lead, via: status ? 'text' as const : 'default' as const };
}
function parseDelimitedText(text: string, delimiter: string) {
  const rows: string[][] = []; let cell = '', row: string[] = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i+1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) { if (char === '\r' && text[i+1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function excelText(cell: ExcelJS.Cell) {
  if (cell.value === null || cell.value === undefined) return '';
  if (cell.type === ExcelJS.ValueType.Date && cell.value instanceof Date) return cell.value.toISOString().slice(0,10);
  if (typeof cell.value === 'number' && /^0+$/.test(cell.numFmt ?? '')) return String(cell.value).padStart(cell.numFmt.length,'0');
  try { return cell.text?.trim() ?? String(cell.value); } catch { return String(cell.value); }
}
function excelCell(cell: ExcelJS.Cell, palette: string[]): Cell {
  const fill = cell.fill as { type?: string; pattern?: string; fgColor?: SheetColor; bgColor?: SheetColor; stops?: { color: SheetColor }[] } | undefined;
  let fillStatus: FunnelStatus | null = null;
  if (fill?.type === 'pattern' && fill.pattern && fill.pattern !== 'none') fillStatus = statusFromSheetColor(fill.fgColor, palette) ?? statusFromSheetColor(fill.bgColor, palette);
  else if (fill?.type === 'gradient') fillStatus = majority((fill.stops ?? []).map(stop => statusFromSheetColor(stop.color, palette)));
  const font = statusFromSheetColor((cell.font as { color?: SheetColor } | undefined)?.color, palette);
  return { text: excelText(cell), fill: fillStatus, font };
}
function checkWorkbookSize(buffer: Buffer) {
  const start = Math.max(0, buffer.length - 65_557);
  let end = -1;
  for (let i = buffer.length - 22; i >= start; i--) if (buffer.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw Error('This Excel file is not a valid .xlsx workbook.');
  const entries = buffer.readUInt16LE(end + 10), offset = buffer.readUInt32LE(end + 16);
  if (entries === 0xffff || offset === 0xffffffff || entries > 2000) throw Error('This workbook is too complex to import.');
  let cursor = offset, total = 0;
  for (let i = 0; i < entries; i++) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw Error('This Excel file is damaged.');
    const unpacked = buffer.readUInt32LE(cursor + 24);
    if (unpacked === 0xffffffff || unpacked > 25_000_000) throw Error('This workbook is too large to import.');
    total += unpacked; if (total > 60_000_000) throw Error('This workbook is too large to import.');
    cursor += 46 + buffer.readUInt16LE(cursor + 28) + buffer.readUInt16LE(cursor + 30) + buffer.readUInt16LE(cursor + 32);
  }
}
function merge(into: ImportPreview, next: ImportPreview, prefix = '') {
  into.rows.push(...next.rows.slice(0, Math.max(0, MAX_ROWS - into.rows.length)));
  into.skipped += next.skipped;
  into.warnings.push(...next.warnings.map(warning => prefix ? `${prefix}: ${warning}` : warning));
  for (const status of FUNNEL_STATUSES) into.stats.byStatus[status] += next.stats.byStatus[status];
  into.stats.fromCellColor += next.stats.fromCellColor; into.stats.fromText += next.stats.fromText;
  into.assisted ||= next.assisted;
}
function fromLeads(parsed: { lead: FunnelInput; via: 'text' | 'color' | 'default' }[], skipped: number): ImportPreview {
  const stats = emptyStats();
  for (const item of parsed) { stats.byStatus[item.lead.status]++; if (item.via === 'text') stats.fromText++; }
  return { rows: parsed.slice(0, MAX_ROWS).map(item => item.lead), skipped, warnings: parsed.length > MAX_ROWS ? [`Only the first ${MAX_ROWS} leads were read.`] : skipped ? [`${skipped} blocks without a business name were skipped.`] : [], stats };
}
/** Unstructured text is where literal parsing breaks down, so the model gets a try — but every value it returns must appear in the file. */
async function aiExtract(text: string, source: string, assist: ImportAssist): Promise<ImportPreview | null> {
  if (!assist.extractLeads) return null;
  const found = await assist.extractLeads(text.slice(0, 14_000)).catch(() => null);
  if (!found?.length) return null;
  const flat = text.replace(/\s+/g,' ').toLowerCase(), digits = text.replace(/\D/g,'');
  const inText = (value?: string) => !!value && flat.includes(value.replace(/\s+/g,' ').trim().toLowerCase());
  const leads: { lead: FunnelInput; via: 'text' | 'default' }[] = [];
  for (const item of found.slice(0, MAX_ROWS)) {
    if (!inText(item.businessName)) continue;
    const phoneDigits = (item.phone ?? '').replace(/\D/g,'');
    const status = FUNNEL_STATUSES.includes(item.status as FunnelStatus) ? item.status as FunnelStatus : null;
    try {
      leads.push({ via: status ? 'text' : 'default', lead: normalizeFunnelInput({
        businessName: item.businessName, phone: phoneDigits.length >= 7 && digits.includes(phoneDigits) ? item.phone : '',
        accountNumber: inText(item.accountNumber) ? item.accountNumber : '', contactName: inText(item.contactName) ? item.contactName : '',
        notes: typeof item.notes === 'string' ? item.notes.slice(0, 4000) : '', status: status ?? 'blue', kind: inferKind(item.notes ?? ''),
        followUpAt: '', followUpTime: '', source,
      }) });
    } catch { /* Skip anything the model returned that doesn't validate. */ }
  }
  if (!leads.length) return null;
  return { ...fromLeads(leads, 0), assisted: true };
}

export async function parseFunnelFile(name: string, buffer: Buffer, assist?: ImportAssist): Promise<ImportPreview> {
  const extension = name.toLowerCase().split('.').pop();
  if (buffer.length > 8_000_000) throw Error(`${name} is over the 8 MB limit.`);
  if (extension === 'xlsx' || extension === 'xlsm') {
    checkWorkbookSize(buffer);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const palette = themePalette((workbook as unknown as { _themes?: Record<string, string> })._themes?.theme1);
    const all: ImportPreview = { rows: [], skipped: 0, warnings: [], stats: emptyStats() };
    const visible = workbook.worksheets.filter(sheet => !sheet.state || sheet.state === 'visible');
    for (const sheet of visible) {
      const rows: Row[] = [];
      sheet.eachRow({ includeEmpty: false }, row => { if (rows.length <= MAX_ROWS + 8) rows.push(Array.from({ length: Math.min(row.cellCount, 40) }, (_, i) => excelCell(row.getCell(i + 1), palette))); });
      const preview = await rowsToPreview(rows, `${name} · ${sheet.name}`, assist, visible.length > 1 ? statusFromWords(sheet.name, true) : null);
      merge(all, preview, visible.length > 1 ? sheet.name : '');
      if (all.rows.length >= MAX_ROWS) { all.warnings.push(`Only the first ${MAX_ROWS} leads were read.`); break; }
    }
    return all;
  }
  if (extension === 'xls') throw Error('Older .xls files need to be saved as .xlsx or CSV before import.');
  if (!['csv','tsv','txt','text','md'].includes(extension ?? '')) throw Error(`Unsupported file: ${name}. Use .xlsx, .csv, .tsv, or .txt.`);
  const text = buffer.toString('utf8').replace(/^\uFEFF/,'');
  if (text.includes('\uFFFD')) throw Error(`${name} is not UTF-8 text. Save it as UTF-8 and try again.`);
  if (text.length > 8_000_000) throw Error(`${name} is too large.`);
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  const first = lines.find(line => !sectionMarker(plain([line]))) ?? '';
  const delimiter = extension === 'tsv' ? '\t' : extension === 'csv' ? ',' : first.includes('\t') ? '\t' : first.includes('>') ? '>' : first.includes('|') ? '|' : / [-–—] /.test(first) ? '-' : first.includes(',') ? ',' : '';
  if (!delimiter) {
    const blocks = text.split(/\r?\n\s*\r?\n/).map(block => block.trim()).filter(Boolean);
    let section: FunnelStatus | null = null;
    const parsed: { lead: FunnelInput; via: 'text' | 'color' | 'default' }[] = [];
    let skipped = 0;
    for (const block of blocks) {
      const blockLines = block.split(/\r?\n/);
      const marker = sectionMarker(plain([blockLines[0]]));
      if (marker) { section = marker; if (blockLines.length === 1) continue; }
      const body = marker ? blockLines.slice(1).join('\n') : block;
      const result = parseTextBlock(body, name, section);
      if (result) parsed.push(result); else skipped++;
    }
    const literal = fromLeads(parsed, skipped);
    const weak = !literal.rows.length || literal.rows.filter(row => !row.phone && !row.accountNumber).length / literal.rows.length > 0.6 || literal.rows.some(row => row.businessName.length > 70);
    if (weak && assist) { const ai = await aiExtract(text, name, assist); if (ai && ai.rows.length >= literal.rows.length * 0.5) return ai; }
    return literal;
  }
  const rows = delimiter === '>' || delimiter === '|' || delimiter === '-'
    ? lines.map(line => delimiter === '-' ? line.split(/\s+[-–—]\s+/).map(value => value.trim()) : parseDelimitedLine(line, delimiter))
    : parseDelimitedText(text, delimiter);
  return rowsToPreview(rows.map(plain), name, assist);
}
