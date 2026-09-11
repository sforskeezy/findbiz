"use client";
import { useEffect } from "react";
import { normalizePhonesForCopy } from "@/lib/phone";

/** Applies the same digits-only rule to manually selected phone numbers. */
export function ClipboardNormalizer() {
  useEffect(() => {
    const onCopy = (event: ClipboardEvent) => {
      const active = document.activeElement;
      const text = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
        ? active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0)
        : window.getSelection()?.toString() || "";
      const normalized = normalizePhonesForCopy(text);
      if (text && normalized !== text && event.clipboardData) {
        event.clipboardData.setData("text/plain", normalized);
        event.preventDefault();
      }
    };
    document.addEventListener("copy", onCopy);
    return () => document.removeEventListener("copy", onCopy);
  }, []);
  return null;
}
