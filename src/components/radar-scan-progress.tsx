"use client";

import { LargeThinkingOrb } from "@/components/large-thinking-orb";
import { SCAN_STAGE_COPY } from "@/lib/radar/catalog";
import type { RadarScanStage } from "@/lib/radar/types";

const ORDER: RadarScanStage[] = [
  "scanning",
  "discovering",
  "comparing",
  "web",
  "expansion",
  "evidence",
  "ranking",
];

export function RadarScanProgress({ stage }: { stage: RadarScanStage }) {
  const currentIndex = Math.max(0, ORDER.indexOf(stage === "hiring" ? "expansion" : stage));
  return (
    <div className="flex min-h-[calc(100vh-160px)] items-center justify-center px-5 py-16">
      <div className="flex w-full max-w-[640px] flex-col items-center text-center">
        <LargeThinkingOrb state="searching" size={220} speed={0.48} aria-label="Scanning territory" />
        <h2 className="mt-8 text-[32px] font-semibold tracking-[-0.045em] text-[#1b1b18] sm:text-[40px]">
          {SCAN_STAGE_COPY[stage] || "Scanning territory…"}
        </h2>
        <p className="mt-3 max-w-[420px] text-[15px] leading-7 text-[#7a7a74]">
          Radar is looking for openings, moves, expansions, and other public change — not who is hiring.
        </p>
        <ol className="mt-10 w-full max-w-[420px] space-y-2 text-left">
          {ORDER.map((item, index) => {
            const done = index < currentIndex;
            const active = index === currentIndex;
            return (
              <li
                key={item}
                className={`flex items-center gap-3 text-[13px] ${
                  active ? "font-semibold text-[#171715]" : done ? "text-[#5f5f59]" : "text-[#b0b0a9]"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    active ? "bg-[#171715] research-pulse" : done ? "bg-[#8a8a84]" : "bg-[#d8d8d2]"
                  }`}
                />
                {SCAN_STAGE_COPY[item]}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
