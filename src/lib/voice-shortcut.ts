export const VOICE_PRESETS = ["Tab", "Backquote", "F8", "Control", "None"] as const;
/** A KeyboardEvent.code, a side-agnostic modifier name, or "None". */
export type VoiceKey = string;
export const VOICE_STORAGE_KEY = "pai.voice-key.v1";

/** Stored without a side so either physical Control, Alt, or Command works. */
const MODIFIERS = new Set(["Control", "Alt", "Shift", "Meta"]);
/**
 * Binding any of these would leave the rep unable to type, send, or escape the
 * mic. Shift is reserved too: it is held constantly for capitals and Shift+Tab.
 */
const RESERVED = new Set([
  "Escape", "Enter", "NumpadEnter", "Space", " ", "Backspace", "Delete",
  "Shift", "ShiftLeft", "ShiftRight",
]);

const LABELS: Record<string, string> = {
  Tab: "Tab", Backquote: "`", F8: "F8", Control: "Ctrl", Alt: "Alt", Meta: "Cmd", None: "Off",
};

export function isModifierVoiceKey(key: VoiceKey) {
  return MODIFIERS.has(key);
}

export function parseVoiceKey(value: string | null): VoiceKey {
  if (!value || RESERVED.has(value)) return "Tab";
  if (value === "None" || MODIFIERS.has(value)) return value;
  return /^[A-Za-z][A-Za-z0-9]{0,19}$/.test(value) ? value : "Tab";
}

/** Turns a captured keypress into a stored binding, or null if it is not bindable. */
export function voiceKeyFromEvent(event: Pick<KeyboardEvent, "key" | "code">): VoiceKey | null {
  if (RESERVED.has(event.key) || RESERVED.has(event.code)) return null;
  if (MODIFIERS.has(event.key)) return event.key;
  const code = event.code || event.key;
  return code && parseVoiceKey(code) === code ? code : null;
}

export function voiceKeyLabel(key: VoiceKey) {
  if (LABELS[key]) return LABELS[key];
  if (/^Key[A-Z]$/.test(key)) return key.slice(3);
  if (/^Digit\d$/.test(key)) return key.slice(5);
  if (/^Numpad/.test(key)) return `Numpad ${key.slice(6)}`;
  if (/^F\d{1,2}$/.test(key)) return key;
  return key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function matchesVoiceShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing">,
  key: VoiceKey,
) {
  if (key === "None" || event.isComposing) return false;
  // Every modifier except the bound one has to be up, so Ctrl+C and Cmd+V keep
  // reaching the browser instead of opening the mic.
  if (event.ctrlKey && key !== "Control") return false;
  if (event.metaKey && key !== "Meta") return false;
  if (event.altKey && key !== "Alt") return false;
  if (event.shiftKey && key !== "Shift") return false;
  if (MODIFIERS.has(key)) return event.key === key;
  return event.code === key || event.key === key;
}
