"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import type { LiveProfileContext } from "@/lib/live/types";

export function AskLiveButton(context: Omit<LiveProfileContext, "importedAt">) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  return <div className="mt-5">
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setError("");
      try {
        const response = await fetch("/api/live/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(context) });
        const data = await response.json() as { sessionId?: string; error?: string };
        if (!response.ok || !data.sessionId) throw new Error(data.error || "Could not open LIVE.");
        router.push(`/live?session=${encodeURIComponent(data.sessionId)}`);
      } catch (error) { setError(error instanceof Error ? error.message : "Could not open LIVE."); setBusy(false); }
    }} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#292e24] px-5 text-[13px] font-medium text-white transition hover:bg-[#414e34] disabled:opacity-50">
      <MessageCircle size={15} />{busy ? "Opening LIVE…" : "Ask LIVE"}
    </button>
    <p className="mt-2 text-xs text-[#77776e]">Chat about this business with its full profile in context.</p>
    {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
  </div>;
}
