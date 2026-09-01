"use client";

import type { Coordinates } from "@/lib/types";
import type { RadarSignal, SignalSeverity } from "@/lib/radar/types";

const COLORS: Record<SignalSeverity, string> = {
  hot: "#171715",
  active: "#5f5f59",
  watch: "#b0b0a9",
};

export function RadarMap({
  center,
  radiusMiles,
  signals,
  selectedId,
  onSelect,
}: {
  center: Coordinates;
  radiusMiles: number;
  signals: RadarSignal[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const size = 360;
  const pad = 18;
  const usable = size - pad * 2;
  const unique = new Map<string, RadarSignal>();
  for (const signal of signals) {
    if (!unique.has(signal.businessKey)) unique.set(signal.businessKey, signal);
  }

  function project(coordinates: Coordinates) {
    const dx = ((coordinates.lng - center.lng) / (radiusMiles / 54)) * (usable / 2);
    const dy = ((center.lat - coordinates.lat) / (radiusMiles / 69)) * (usable / 2);
    return {
      x: size / 2 + dx,
      y: size / 2 + dy,
    };
  }

  return (
    <div className="overflow-hidden rounded-[22px] border border-[#e4e4de] bg-[#f7f7f3]">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-auto w-full" role="img" aria-label="Radar territory map">
        <circle cx={size / 2} cy={size / 2} r={usable / 2} fill="#eef0ea" stroke="#dddcd6" />
        <circle cx={size / 2} cy={size / 2} r={usable / 4} fill="none" stroke="#e3e3dd" strokeDasharray="3 5" />
        <circle cx={size / 2} cy={size / 2} r={4} fill="#11110f" />
        {[...unique.values()].map((signal) => {
          const point = project(signal.observation.coordinates);
          if (point.x < pad || point.x > size - pad || point.y < pad || point.y > size - pad) return null;
          const selected = signal.id === selectedId;
          return (
            <g key={signal.businessKey}>
              <circle
                cx={point.x}
                cy={point.y}
                r={selected ? 8 : 5.5}
                fill={selected ? "#11110f" : COLORS[signal.severity]}
                opacity={selected ? 1 : 0.88}
                className="cursor-pointer"
                onClick={() => onSelect(signal.id)}
              >
                <title>{signal.observation.name}</title>
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="flex items-center gap-4 border-t border-[#ecece7] px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8f8f88]">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#171715]" /> Contact now
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#5f5f59]" /> Changed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-[#b0b0a9]" /> Watch
        </span>
      </div>
    </div>
  );
}
