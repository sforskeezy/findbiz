"use client";

import { LargeThinkingOrb } from "@/components/large-thinking-orb";

export function SearchProgress({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={
        compact
          ? "flex items-center justify-center py-16"
          : "flex min-h-[calc(100vh-80px)] items-center justify-center px-5"
      }
    >
      <div className="flex w-full max-w-[640px] flex-col items-center justify-center text-center">
        <LargeThinkingOrb
          state="searching"
          size={compact ? 160 : 260}
          speed={0.5}
          aria-label="Searching"
        />
        <h2 className="mt-7 text-[34px] font-semibold tracking-[-0.04em] text-[#1b1b18] sm:mt-8 sm:text-[42px]">
          Searching nearby businesses
        </h2>
        <p className="mt-3 max-w-[420px] text-base leading-7 text-[#7a7a74] sm:mt-4 sm:text-lg">
          Locating the address and ranking local prospects.
        </p>
      </div>
    </div>
  );
}
