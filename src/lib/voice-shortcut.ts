export const VOICE_KEYS = ["Tab", "Backquote", "F8", "None"] as const;
export type VoiceKey = (typeof VOICE_KEYS)[number];
export const VOICE_STORAGE_KEY = "pai.voice-key.v1";
export function parseVoiceKey(value: string | null): VoiceKey {
  return VOICE_KEYS.includes(value as VoiceKey) ? value as VoiceKey : "Tab";
}
export function matchesVoiceShortcut(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing">, key: VoiceKey) {
  return key !== "None" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing
    && (key === "Backquote" ? event.code === "Backquote" : event.key === key);
}
