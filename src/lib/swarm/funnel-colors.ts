import type { FunnelStatus } from '@/lib/swarm/funnel';

export type SheetColor = { argb?: string; theme?: number; tint?: number; indexed?: number };

// Office 2013+ default theme, in SpreadsheetML theme-index order (lt1, dk1, lt2, dk2, accent1–6, hlink, folHlink).
const DEFAULT_THEME = ['FFFFFF','000000','E7E6E6','44546A','4472C4','ED7D31','A5A5A5','FFC000','5B9BD5','70AD47','0563C1','954F72'];

// Legacy 64-color Excel palette used by `indexed` colors.
const INDEXED = [
  '000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF',
  '000000','FFFFFF','FF0000','00FF00','0000FF','FFFF00','FF00FF','00FFFF',
  '800000','008000','000080','808000','800080','008080','C0C0C0','808080',
  '9999FF','993366','FFFFCC','CCFFFF','660066','FF8080','0066CC','CCCCFF',
  '000080','FF00FF','FFFF00','00FFFF','800080','800000','008080','0000FF',
  '00CCFF','CCFFFF','CCFFCC','FFFF99','99CCFF','FF99CC','CC99FF','FFCC99',
  '3366FF','33CCCC','99CC00','FFCC00','FF9900','FF6600','666699','969696',
  '003366','339966','003300','333300','993300','993366','333399','333333',
];

/** Reads the workbook's own theme so theme-based fills resolve to the colors the rep actually saw. */
export function themePalette(themeXml?: string): string[] {
  if (!themeXml) return DEFAULT_THEME;
  const pick = (tag: string) => {
    const block = themeXml.match(new RegExp(`<a:${tag}>([\\s\\S]*?)</a:${tag}>`))?.[1] ?? '';
    return block.match(/srgbClr\s+val="([0-9a-f]{6})"/i)?.[1] ?? block.match(/lastClr="([0-9a-f]{6})"/i)?.[1];
  };
  const order = ['lt1','dk1','lt2','dk2','accent1','accent2','accent3','accent4','accent5','accent6','hlink','folHlink'];
  return order.map((tag, index) => pick(tag)?.toUpperCase() ?? DEFAULT_THEME[index]);
}

function hsl(hex: string) {
  const r = parseInt(hex.slice(0,2),16)/255, g = parseInt(hex.slice(2,4),16)/255, b = parseInt(hex.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), l = (max+min)/2, d = max-min;
  if (!d) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2*l - 1));
  const h = max === r ? ((g-b)/d + (g < b ? 6 : 0)) : max === g ? (b-r)/d + 2 : (r-g)/d + 4;
  return { h: h*60, s, l };
}

export function resolveSheetColor(color: SheetColor | undefined, palette: string[] = DEFAULT_THEME): { hex: string; tint: number } | null {
  if (!color) return null;
  let hex = '';
  if (typeof color.argb === 'string' && /^[0-9a-f]{6,8}$/i.test(color.argb)) {
    if (color.argb.length === 8 && color.argb.slice(0,2) === '00' && color.argb.slice(2) === '000000') return null;
    hex = color.argb.slice(-6);
  } else if (typeof color.theme === 'number') hex = palette[color.theme] ?? '';
  else if (typeof color.indexed === 'number') hex = color.indexed === 64 || color.indexed === 65 ? '' : INDEXED[color.indexed] ?? '';
  return hex ? { hex: hex.toUpperCase(), tint: typeof color.tint === 'number' ? color.tint : 0 } : null;
}

/**
 * Buckets any shade into the funnel's four colors by hue, so pastel, dark, and
 * "almost" versions of red, yellow, green, and blue all land in the right stage.
 */
export function statusFromHex(hex: string, tint = 0): FunnelStatus | null {
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
  const color = hsl(hex);
  const lightness = tint > 0 ? color.l*(1-tint) + tint : color.l*(1+tint);
  if (color.s < 0.16 || lightness > 0.975 || lightness < 0.07) return null;
  const h = color.h;
  if (h < 28 || h >= 290) return 'red';
  if (h < 70) return 'yellow';
  if (h < 165) return 'green';
  return 'blue';
}

export function statusFromSheetColor(color: SheetColor | undefined, palette?: string[]): FunnelStatus | null {
  const resolved = resolveSheetColor(color, palette);
  return resolved ? statusFromHex(resolved.hex, resolved.tint) : null;
}

const EMOJI: [RegExp, FunnelStatus][] = [
  [/🟢|🟩|💚|✅|💰|💵|🤑/u, 'green'],
  [/🔴|🟥|❤️|❤|🔥|🚨/u, 'red'],
  [/🟡|🟨|💛|🟠|🟧|🧡/u, 'yellow'],
  [/🔵|🟦|💙|🧊/u, 'blue'],
];
export const EMOJI_PATTERN = /[🟢🟩💚✅💰💵🤑🔴🟥🔥🚨🟡🟨💛🟠🟧🧡🔵🟦💙🧊]|❤️?/gu;

export function statusFromEmoji(text: string): FunnelStatus | null {
  for (const [pattern, status] of EMOJI) if (pattern.test(text)) return status;
  return null;
}

/**
 * Understands the words reps actually type in a status/color column.
 * `strict` limits matching to short labels so a long note isn't misread as a stage.
 */
export function statusFromWords(text: string, strict = false): FunnelStatus | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  const emoji = statusFromEmoji(value);
  if (emoji) return emoji;
  if (strict && value.length > 40) return null;
  if (/^(?:g|gr|grn)$/.test(value)) return 'green';
  if (/^(?:r|rd)$/.test(value)) return 'red';
  if (/^(?:y|yl|yel|yllw)$/.test(value)) return 'yellow';
  if (/^(?:b|bl|blu)$/.test(value)) return 'blue';
  if (!/\b(?:not|never|didn'?t|did\s+not)\s+(?:sold|won|closed|signed|paid)\b/.test(value) && /\b(?:sold|won|closed(?:\s*won)?|signed|paid|money|installed|green|lime|emerald|mint|olive|forest)\b/.test(value)) return 'green';
  if (/\b(?:red|hot|urgent|asap|close\s*(?:asap|soon|tomorrow)|crimson|maroon|scarlet|burgundy|pink|rose|coral|salmon)\b/.test(value)) return 'red';
  if (/\b(?:yellow|50\s*\/\s*50|fifty|warm|maybe|possible|spoke|talked|conversation|gold|golden|amber|orange|mustard|tan)\b/.test(value)) return 'yellow';
  if (/\b(?:blue|cold|new|untouched|not\s*contacted|haven'?t\s*spoken|up\s*in\s*the\s*air|navy|teal|cyan|aqua|sky|indigo|purple|violet|lavender)\b/.test(value)) return 'blue';
  return null;
}
