"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { Settings, X } from "lucide-react";
import { parseVoiceKey, VOICE_STORAGE_KEY, type VoiceKey } from "@/lib/voice-shortcut";

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
  const key = useVoiceKey();
  const [error, setError] = useState("");
  return <>
    <button type="button" title="Settings" aria-label="Settings" onClick={() => dialog.current?.showModal()}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[#77776e] transition hover:bg-[#eaeae4] hover:text-[#24241f] focus-visible:outline-2 focus-visible:outline-offset-2">
      <Settings size={18} strokeWidth={1.7} />
    </button>
    <dialog ref={dialog} aria-label="Settings" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      className="fixed inset-0 m-auto w-[calc(100%-40px)] max-w-md rounded-3xl border border-[#e1e1d9] bg-[#fafaf7] p-7 text-[#24241f] shadow-2xl backdrop:bg-black/25">
      <div className="mb-7 flex items-center justify-between"><h2 className="text-xl font-semibold tracking-tight">Settings</h2><button type="button" aria-label="Close settings" onClick={() => dialog.current?.close()} className="rounded-lg p-2 hover:bg-[#eaeae4]"><X size={18} /></button></div>
      <label className="flex items-center justify-between gap-4 text-sm font-medium">Voice control key
        <select value={key} onChange={(event) => {
          try { localStorage.setItem(VOICE_STORAGE_KEY, event.target.value); window.dispatchEvent(new Event("pai-settings")); setError(""); }
          catch { setError("Your browser could not save this setting."); }
        }} className="rounded-lg border border-[#ddddd5] bg-white px-3 py-2">
          <option value="Tab">Tab (default)</option><option value="Backquote">` (backtick)</option><option value="F8">F8</option><option value="None">Off</option>
        </select>
      </label>
      <p className="mt-3 text-sm leading-6 text-[#74746b]">Hold the key in the LIVE message box to talk. Release to send. Control and Command stay available for copy and paste.</p>
      <p className="mt-3 text-xs leading-5 text-[#74746b]">With Tab selected, use Shift + Tab to leave the message box. You can always use the microphone button.</p>
      <p role="status" className="mt-5 text-xs text-[#74746b]">{error || "Saved automatically on this browser."}</p>
    </dialog>
  </>;
}
