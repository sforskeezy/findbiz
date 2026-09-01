"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/components/ui";
import type { LiveSource } from "@/lib/live/types";

function Favicon({ domain, size = 16 }: { domain: string; size?: number }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#e9e9e3] font-semibold uppercase text-[#6f6f69]"
        style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
        aria-hidden="true"
      >
        {domain.charAt(0)}
      </span>
    );
  }

  return (
    // Favicons come from arbitrary prospect domains, so next/image remote patterns cannot cover them.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full bg-white object-contain"
      style={{ width: size, height: size }}
    />
  );
}

export function LiveSources({ sources }: { sources: LiveSource[] }) {
  const [open, setOpen] = useState(false);
  if (!sources.length) return null;

  const domains = Array.from(new Set(sources.map((item) => item.domain))).slice(0, 4);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group inline-flex items-center gap-2 rounded-full border border-[#e7e7e1] bg-[#fbfbf9] py-1 pl-1.5 pr-2.5 transition hover:border-[#d8d8d0] hover:bg-white"
      >
        <span className="flex items-center">
          {domains.map((domain, index) => (
            <span
              key={domain}
              className="rounded-full bg-white p-[2px] ring-1 ring-[#eaeae4]"
              style={{ marginLeft: index === 0 ? 0 : -6, zIndex: domains.length - index }}
            >
              <Favicon domain={domain} size={14} />
            </span>
          ))}
        </span>
        <span className="text-[12px] font-medium text-[#5f5f59]">
          {sources.length} {sources.length === 1 ? "source" : "sources"}
        </span>
        <ChevronDown size={13} className={cn("text-[#a4a49c] transition-transform duration-200", open && "rotate-180")} />
      </button>

      {open && (
        <ol className="step-enter mt-2.5 space-y-1">
          {sources.map((source, index) => (
            <li key={source.id}>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="flex gap-2.5 rounded-[14px] border border-transparent px-2.5 py-2 transition hover:border-[#eaeae4] hover:bg-[#fbfbf9]"
              >
                <span className="mt-[3px] w-4 shrink-0 text-right text-[11px] tabular-nums text-[#b8b8b0]">{index + 1}</span>
                <Favicon domain={source.domain} size={16} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium leading-5 text-[#1c1c19]">{source.title}</span>
                  {source.snippet && <span className="block truncate text-[12px] leading-5 text-[#8a8a84]">{source.snippet}</span>}
                  <span className="block truncate text-[11px] leading-4 text-[#b0b0a8]">{source.domain}</span>
                </span>
              </a>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
