import { ChevronRight } from "lucide-react";

import type { Prospect } from "@/lib/types";

const missingAddress = new Set(["Address not listed in public data", "Address unavailable"]);

function MetaDot() {
  return <span aria-hidden="true" className="h-[3px] w-[3px] shrink-0 rounded-full bg-[#cbcbc4]" />;
}

export function ProspectResultRow({ prospect, index, onOpen }: { prospect: Prospect; index: number; onOpen: (prospect: Prospect) => void }) {
  const address = missingAddress.has(prospect.address) ? null : prospect.address;
  return (
    <li className="animate-enter border-t border-[#e5e5e0] first:border-t-0" style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}>
      <button type="button" onClick={() => onOpen(prospect)} className="group relative block w-full py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 sm:py-[18px]">
        <span className="pointer-events-none absolute -inset-x-3 -inset-y-px rounded-[16px] border border-[#e6e6e0] bg-white/90 opacity-0 shadow-[0_14px_36px_rgba(20,20,16,0.07)] transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 sm:-inset-x-5" />
        <span className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <span className="min-w-0 flex-1 transition-transform duration-200 group-hover:translate-x-[3px]">
            <span className="flex flex-wrap items-center gap-2.5">
              <span className="truncate text-[16px] font-semibold tracking-[-0.02em] text-[#1a1a17] sm:text-[17px]">{prospect.name}</span>
              <span className="rounded-full border border-[#d8d8d2] bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-[#666660]">{prospect.priority}</span>
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] leading-4 text-[#777771]">
              <span className="font-medium text-[#5f5f59]">{prospect.category}</span>
              {prospect.operatingStatus === "Temporarily closed" && <><MetaDot /><span className="font-semibold text-[#8a6613]">Temporarily closed</span></>}
              {address && <><MetaDot /><span className="max-w-full truncate">{address}</span></>}
            </span>
          </span>
          <span className="flex items-center justify-between gap-5 sm:justify-end sm:gap-6">
            <span className="text-[12px] font-medium tabular-nums text-[#5f5f59]">{prospect.distanceMiles.toFixed(2)} mi</span>
            <ChevronRight size={16} aria-hidden className="text-[#9a9a93] transition group-hover:translate-x-1" />
          </span>
        </span>
      </button>
    </li>
  );
}
