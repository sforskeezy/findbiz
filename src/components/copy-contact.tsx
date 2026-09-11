"use client";
import { useState, type ReactNode } from "react";
import { phoneCopyValue } from "@/lib/phone";

export function CopyContact({ value, phone = false, children, className = "" }: { value: string; phone?: boolean; children?: ReactNode; className?: string }) {
  const [status, setStatus] = useState("");
  return <button type="button" title={status || `Copy ${phone ? "phone number" : "address"}`}
    aria-label={status || `Copy ${phone ? "phone number" : "address"}: ${value}`}
    className={`copy-contact ${className}`} onClick={async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try { await navigator.clipboard.writeText(phone ? phoneCopyValue(value) : value); setStatus("Copied"); }
      catch { setStatus("Could not copy. Select the text and copy it manually."); }
      window.setTimeout(() => setStatus(""), 1800);
    }}>
      {children || value}<span className="sr-only" role="status">{status}</span>
    </button>;
}
