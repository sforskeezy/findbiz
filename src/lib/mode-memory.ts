export type PaiMode = "normal" | "live";

export const MODE_HOME: Record<PaiMode, string> = { normal: "/", live: "/live" };

const MODES: readonly PaiMode[] = ["normal", "live"];
const STORAGE_KEY = "pai.mode-return.v1";

export function modeForPath(pathname: string): PaiMode {
  return pathname.startsWith("/live") || pathname.startsWith("/radar") ? "live" : "normal";
}

/**
 * Only a same-origin path is worth keeping. A protocol-relative or absolute URL
 * would turn the mode switch into an open redirect the next time it is read.
 */
export function normalizeModeHref(href: string): string | null {
  if (typeof href !== "string" || href.length > 2048) return null;
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\")) return null;
  return href;
}

export type ModeMemory = Partial<Record<PaiMode, string>>;

const EMPTY: ModeMemory = {};
const listeners = new Set<() => void>();
/** Cached so `useSyncExternalStore` sees a stable object between writes. */
let memory: ModeMemory | null = null;

function parse(raw: string | null): ModeMemory {
  const next: ModeMemory = {};
  if (!raw) return next;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object") return next;
    for (const mode of MODES) {
      const href = parsed[mode];
      if (typeof href !== "string") continue;
      const safe = normalizeModeHref(href);
      // A stored path has to still belong to the mode it is filed under.
      if (safe && modeForPath(safe) === mode) next[mode] = safe;
    }
  } catch {
    // A hand-edited or half-written entry just means no memory yet.
  }
  return next;
}

function read(): ModeMemory {
  if (memory) return memory;
  if (typeof window === "undefined") return EMPTY;
  try {
    memory = parse(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    // Private browsing can block session storage entirely.
    memory = {};
  }
  return memory;
}

/** The path the current tab is on, in the form the mode switch stores. */
export function currentModeHref() {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * File a path under the mode it belongs to, so switching away and back returns
 * to the work in progress instead of that mode's blank home screen.
 */
export function rememberModeLocation(href: string) {
  const safe = normalizeModeHref(href);
  if (!safe) return;
  const mode = modeForPath(safe);
  const current = read();
  if (current[mode] === safe) return;
  memory = { ...current, [mode]: safe };
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Keep the in-memory pointer even when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

/** Drop a pointer that no longer resolves, so the next switch lands on home. */
export function forgetModeLocation(mode: PaiMode) {
  const current = read();
  if (!current[mode]) return;
  const next = { ...current };
  delete next[mode];
  memory = next;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
  } catch {
    // Ignored for the same reason as above.
  }
  for (const listener of listeners) listener();
}

export function modeReturnHref(memoryState: ModeMemory, mode: PaiMode) {
  return memoryState[mode] ?? MODE_HOME[mode];
}

export function subscribeModeMemory(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function modeMemorySnapshot(): ModeMemory {
  return read();
}

/** The server knows nothing about this tab, so it always renders mode home. */
export function serverModeMemorySnapshot(): ModeMemory {
  return EMPTY;
}

/** Test seam: drops the process-level cache without touching storage. */
export function resetModeMemoryCache() {
  memory = null;
}
