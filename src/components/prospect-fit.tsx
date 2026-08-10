import type { Prospect } from "@/lib/types";

function conciseFitExplanation(prospect: Prospect) {
  const details = [
    prospect.distanceMiles <= 1 ? "nearby" : null,
    prospect.category !== "Other/Unknown" ? `a usable ${prospect.category.toLowerCase()} category` : "a limited category signal",
    prospect.phone || prospect.website ? "public contact details" : "limited public operating details",
  ].filter(Boolean);
  return `${details.join(", ")}, with ${prospect.dataConfidence.toLowerCase()} evidence confidence.`;
}

export function ProspectFit({ prospect }: { prospect: Prospect }) {
  return (
    <section aria-labelledby="prospect-fit-title" className="rounded-[18px] border border-[#deded8] bg-white/72 px-5 py-5 shadow-[0_12px_34px_rgba(20,20,16,0.05)] sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p id="prospect-fit-title" className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#777771]">Prospect fit</p>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <p className="text-[18px] font-semibold tracking-[-0.025em] text-[#20201d]">{prospect.priority}</p>
            <p className="text-[12px] font-medium tabular-nums text-[#777771]">{prospect.score}/100</p>
          </div>
          <p className="mt-1 text-[11px] font-medium text-[#777771]">{prospect.dataConfidence} confidence</p>
        </div>
        <div className="w-full sm:max-w-[270px]">
          <div
            role="progressbar"
            aria-label={`Prospect fit ${prospect.score} out of 100`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={prospect.score}
            className="h-2 overflow-hidden rounded-full bg-[#e8e8e2]"
          >
            <div className="fit-bar h-full rounded-full bg-[#2e5945]" style={{ width: `${prospect.score}%` }} />
          </div>
          <p className="mt-2 text-[11px] leading-5 text-[#666660]">{conciseFitExplanation(prospect)}</p>
        </div>
      </div>
      <p className="mt-4 border-t border-[#e5e5df] pt-3 text-[10px] leading-5 text-[#85857f]">
        This score helps prioritize public business leads. It does not predict whether the business will buy or whether service is available.
      </p>
    </section>
  );
}
