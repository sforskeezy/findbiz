import type { Confidence } from "@/lib/types";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

const statusStyles: Record<Confidence, string> = {
  Verified: "border-[#bfdccc] bg-[#edf7f1] text-[#17653f]",
  Estimated: "border-[#e9d6a7] bg-[#fbf6e8] text-[#7d570d]",
  "Manually entered": "border-[#cbd6f8] bg-[#f0f3ff] text-[#274ab5]",
  Unavailable: "border-[#ddddda] bg-[#f5f5f2] text-[#73746f]",
  "Potentially stale": "border-[#efd0b1] bg-[#fdf2e8] text-[#995311]",
};

export function StatusPill({ status, short = false }: { status: Confidence; short?: boolean }) {
  const labels: Record<Confidence, string> = {
    Verified: "Verified",
    Estimated: "Estimated",
    "Manually entered": short ? "Manual" : "Manually entered",
    Unavailable: "Unavailable",
    "Potentially stale": short ? "Stale" : "Potentially stale",
  };

  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-[10px] font-semibold tracking-[0.04em]",
        statusStyles[status],
      )}
    >
      {labels[status]}
    </span>
  );
}

export function scoreTone(score: number) {
  return score >= 75 ? "#19734a" : score >= 55 ? "#2855e7" : "#76776f";
}

export function ScoreMark({ score, compact = false }: { score: number; compact?: boolean }) {
  const color = scoreTone(score);
  return (
    <div className={cn("flex items-center", compact ? "gap-2" : "gap-3")}>
      <span className={cn("font-semibold tabular-nums text-[#141412]", compact ? "text-sm" : "text-xl")}>{score}</span>
      <span className={cn("overflow-hidden rounded-full bg-[#e7e7e2]", compact ? "h-1 w-9" : "h-1.5 w-12")}>
        <span className="block h-full rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
      </span>
    </div>
  );
}

export function EmptyValue({ children = "Unavailable" }: { children?: React.ReactNode }) {
  return <span className="text-[#95958f]">{children}</span>;
}
