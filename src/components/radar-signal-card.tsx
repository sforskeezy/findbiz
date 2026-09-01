"use client";

import { useState } from "react";
import { ChevronDown, Copy, ExternalLink, Phone } from "lucide-react";

import { cn } from "@/components/ui";
import { SEVERITY_COPY } from "@/lib/radar/catalog";
import { formatMonthDay } from "@/lib/radar/time";
import type { RadarSignal } from "@/lib/radar/types";

function ActionButton({
  children,
  onClick,
  href,
  tone = "default",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  tone?: "default" | "primary" | "quiet";
}) {
  const className = cn(
    "inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3.5 text-[11px] font-semibold transition",
    tone === "primary" && "bg-[#171715] text-white hover:bg-black",
    tone === "default" && "border border-[#dcdcd6] bg-white text-[#33332e] hover:border-[#c6c6c0] hover:text-[#11110f]",
    tone === "quiet" && "text-[#7a7a74] hover:text-[#171715]",
  );
  if (href) {
    return (
      <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className={className}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}

export function RadarSignalCard({
  signal,
  selected,
  onSelect,
  onResearch,
  onAction,
}: {
  signal: RadarSignal;
  selected: boolean;
  onSelect: () => void;
  onResearch: () => void;
  onAction: (action: "save" | "unsave" | "dismiss" | "restore" | "contacted" | "uncontacted") => void;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = SEVERITY_COPY[signal.severity];

  async function copyPhone() {
    if (!signal.observation.phone) return;
    await navigator.clipboard.writeText(signal.observation.phone);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <article
      id={`radar-signal-${signal.id}`}
      className={cn(
        "rounded-[22px] border bg-white px-5 py-5 shadow-[0_1px_0_rgba(20,20,16,0.04)] transition sm:px-6 sm:py-5",
        selected ? "border-[#c8c8c2] shadow-[0_16px_40px_rgba(20,20,16,0.08)]" : "border-[#e4e4de]",
        signal.dismissed && "opacity-60",
      )}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f8f88]">{copy.label}</span>
          {signal.newSinceLastScan && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8f8f88]">New since last scan</span>
          )}
          <span className="ml-auto text-[11px] tabular-nums text-[#8a8a84]">{signal.observation.distanceMiles.toFixed(1)} mi</span>
        </div>
        <h3 className="mt-2.5 text-[18px] font-semibold tracking-[-0.03em] text-[#141412] sm:text-[20px]">
          {signal.observation.name}
        </h3>
        <p className="mt-1 text-[13px] text-[#6f6f69]">
          {signal.observation.category}
          {signal.observation.address && signal.observation.address !== "Address not listed in public data"
            ? ` · ${signal.observation.address}`
            : ""}
        </p>
        <p className="mt-3.5 text-[15px] font-semibold tracking-[-0.02em] text-[#171715]">{signal.headline}</p>
        <p className="mt-1 text-[13px] text-[#6f6f69]">{signal.recencyLabel}</p>
      </button>

      <div className="mt-5">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f8f88]">Why it was flagged</p>
        <ul className="mt-2 space-y-1.5">
          {signal.why.map((item) => (
            <li key={item} className="flex gap-2 text-[13px] leading-6 text-[#3f3f3b]">
              <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[#c2c2bb]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 text-[12px]">
        <span className="font-semibold tabular-nums text-[#171715]">Confidence {signal.score.total}%</span>
        <span className="text-[#b0b0a9]">·</span>
        <span className="text-[#7a7a74]">{copy.hint}</span>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <ActionButton tone="primary" onClick={onResearch}>
          Research
        </ActionButton>
        {signal.observation.website && (
          <ActionButton href={signal.observation.website}>
            <ExternalLink size={12} /> Website
          </ActionButton>
        )}
        {signal.observation.phone && (
          <ActionButton href={`tel:${signal.observation.phone}`}>
            <Phone size={12} /> Call
          </ActionButton>
        )}
        {signal.observation.phone && (
          <ActionButton onClick={() => void copyPhone()}>
            <Copy size={12} /> {copied ? "Copied" : "Copy phone"}
          </ActionButton>
        )}
        <ActionButton onClick={() => onAction(signal.saved ? "unsave" : "save")}>
          {signal.saved ? "Saved" : "Save"}
        </ActionButton>
      </div>

      <div className="mt-3 flex flex-wrap gap-3">
        <ActionButton tone="quiet" onClick={() => onAction(signal.contacted ? "uncontacted" : "contacted")}>
          {signal.contacted ? "Contacted" : "Mark contacted"}
        </ActionButton>
        <ActionButton tone="quiet" onClick={() => onAction(signal.dismissed ? "restore" : "dismiss")}>
          {signal.dismissed ? "Restore" : "Dismiss signal"}
        </ActionButton>
        <button
          type="button"
          onClick={() => setEvidenceOpen((open) => !open)}
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-[#5f5f59] hover:text-[#171715]"
        >
          View evidence
          <ChevronDown size={13} className={cn("transition", evidenceOpen && "rotate-180")} />
        </button>
      </div>

      {evidenceOpen && (
        <div className="mt-5 border-t border-[#ecece7] pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f8f88]">Evidence</p>
          <ol className="mt-3 space-y-3">
            {signal.evidence.map((item, index) => (
              <li key={item.id} className="text-[13px] leading-6 text-[#3f3f3b]">
                <span className="mr-2 font-semibold text-[#8f8f88]">{index + 1}.</span>
                {item.label}
                {item.snippet ? ` — ${item.snippet}` : ""}
                <span className="mt-0.5 block text-[11px] text-[#8a8a84]">
                  {item.sourceLabel}
                  {item.url ? (
                    <>
                      {" · "}
                      <a href={item.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                        Open source
                      </a>
                    </>
                  ) : null}
                  {` · ${item.confidence}`}
                </span>
              </li>
            ))}
          </ol>
          {signal.timeline.length > 1 && (
            <div className="mt-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f8f88]">Timeline</p>
              <ul className="mt-3 space-y-2">
                {signal.timeline.map((event) => (
                  <li key={event.id} className="flex gap-3 text-[13px] text-[#3f3f3b]">
                    <span className="w-[72px] shrink-0 text-[11px] font-semibold text-[#8a8a84]">{formatMonthDay(event.at)}</span>
                    <span>{event.summary}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
