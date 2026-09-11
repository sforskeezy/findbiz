"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Settings, X } from "lucide-react";
import {
  parseVoiceKey,
  voiceKeyFromEvent,
  voiceKeyLabel,
  VOICE_PRESETS,
  VOICE_STORAGE_KEY,
  type VoiceKey,
} from "@/lib/voice-shortcut";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener("pai-settings", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("pai-settings", onChange);
  };
}
function readKey() {
  try { return parseVoiceKey(localStorage.getItem(VOICE_STORAGE_KEY)); } catch { return "Tab" as const; }
}
export function useVoiceKey(): VoiceKey {
  return useSyncExternalStore(subscribe, readKey, () => "Tab");
}

export function SettingsButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const captureButton = useRef<HTMLButtonElement>(null);
  const key = useVoiceKey();
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const custom = !(VOICE_PRESETS as readonly string[]).includes(key);

  useEffect(() => { if (capturing) captureButton.current?.focus(); }, [capturing]);

  function save(next: VoiceKey) {
    try {
      localStorage.setItem(VOICE_STORAGE_KEY, next);
      window.dispatchEvent(new Event("pai-settings"));
      setError("");
    } catch { setError("Your browser could not save this setting."); }
  }

  function capture(event: ReactKeyboardEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const next = voiceKeyFromEvent(event.nativeEvent);
    if (!next) { setError("That key is reserved. Try another one."); return; }
    save(next);
    setCapturing(false);
  }

  return <>
    <button type="button" title="Settings" aria-label="Settings" onClick={() => dialog.current?.showModal()}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#77776e] transition hover:bg-[#eaeae4] hover:text-[#24241f] focus-visible:outline-2 focus-visible:outline-offset-2">
      <Settings size={18} strokeWidth={1.7} />
    </button>
    <dialog ref={dialog} aria-label="Settings" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      className="fixed inset-0 m-auto w-[calc(100%-40px)] max-w-md rounded-3xl border border-[#e1e1d9] bg-[#fafaf7] p-7 text-[#24241f] shadow-2xl backdrop:bg-black/25">
      <div className="mb-7 flex items-center justify-between"><h2 className="text-xl font-semibold tracking-tight">Settings</h2><button type="button" aria-label="Close settings" onClick={() => dialog.current?.close()} className="rounded-lg p-2 hover:bg-[#eaeae4]"><X size={18} /></button></div>
      <label className="flex items-center justify-between gap-4 text-sm font-medium">Voice control key
        <select value={custom ? "Custom" : key} onChange={(event) => {
          const value = event.target.value;
          if (value === "Custom") { setError(""); setCapturing(true); return; }
          setCapturing(false);
          save(value);
        }} className="rounded-lg border border-[#ddddd5] bg-white px-3 py-2">
          <option value="Tab">Tab (default)</option><option value="Backquote">` (backtick)</option><option value="F8">F8</option><option value="Control">Ctrl</option><option value="None">Off</option><option value="Custom">Custom key…</option>
        </select>
      </label>
      {(capturing || custom) && (
        <button type="button" ref={captureButton} onKeyDown={capture} onClick={() => { setError(""); setCapturing(true); }}
          aria-label={capturing ? "Press the key you want to use" : `Custom voice key: ${voiceKeyLabel(key)}. Activate to change it.`}
          className="mt-4 w-full rounded-xl border border-dashed border-[#c8c8bd] bg-white px-4 py-3 text-sm font-medium transition hover:border-[#9a9a8e] focus-visible:outline-2 focus-visible:outline-offset-2">
          {capturing ? "Press the key you want to use…" : <>Custom key: <kbd className="rounded border border-[#ddddd5] bg-[#f2f2ec] px-1.5 py-0.5">{voiceKeyLabel(key)}</kbd> — click to change</>}
        </button>
      )}
      <p className="mt-3 text-sm leading-6 text-[#74746b]">Hold <kbd className="rounded border border-[#ddddd5] bg-[#f2f2ec] px-1.5 py-0.5">{voiceKeyLabel(key)}</kbd> in the LIVE message box to talk. Release to send.</p>
      <p className="mt-3 text-xs leading-5 text-[#74746b]">Copy and paste always win: pressing another key while the voice key is held cancels the recording and lets the shortcut through. Escape, Enter, Space and Shift cannot be bound. You can always use the microphone button.</p>
      <p role="status" className="mt-5 text-xs text-[#74746b]">{error || "Saved automatically on this browser."}</p>
    </dialog>
  </>;
}
