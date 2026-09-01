"use client";

import { ArrowUpRight, SearchX } from "lucide-react";

import { StatusPill, cn } from "@/components/ui";
import { displayPhone } from "@/lib/phone";
import type {
  CompanyIntelligence,
  PublicFact,
  PublicFactKind,
  ResearchDiagnostics,
  SearchSourceKind,
  WebSearchResult,
} from "@/lib/types";

const SOURCE_KIND_LABEL: Record<SearchSourceKind, string> = {
  official_site: "Official site",
  government_registry: "Government",
  professional_registry: "Registry",
  news: "News",
  directory: "Directory",
  social: "Social",
  other: "Web",
};

const SOURCE_KIND_TONE: Record<SearchSourceKind, string> = {
  official_site: "border-[#cdd7f5] bg-[#eef2fe] text-[#274ab5]",
  government_registry: "border-[#bfdccc] bg-[#edf7f1] text-[#17653f]",
  professional_registry: "border-[#d5cdea] bg-[#f3effc] text-[#5236a4]",
  news: "border-[#e9d6a7] bg-[#fbf6e8] text-[#7d570d]",
  directory: "border-[#e2e2db] bg-[#f5f5f0] text-[#55554f]",
  social: "border-[#e2e2db] bg-[#f5f5f0] text-[#55554f]",
  other: "border-[#e2e2db] bg-[#f5f5f0] text-[#55554f]",
};

const FACT_GROUPS: Array<{ label: string; kinds: PublicFactKind[] }> = [
  { label: "Contact", kinds: ["address", "phone", "email", "website"] },
  { label: "Profile", kinds: ["rating", "hours", "description", "social", "team_size", "founded"] },
  { label: "Identity", kinds: ["legal_name", "company_id"] },
];

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] || url;
  }
}

function formatRetrievedAt(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function groupFacts(facts: PublicFact[]) {
  const remaining = new Set(facts.map((fact) => fact.id));
  const groups = FACT_GROUPS.map((group) => {
    const items = facts.filter((fact) => group.kinds.includes(fact.kind));
    items.forEach((fact) => remaining.delete(fact.id));
    return { label: group.label, items };
  }).filter((group) => group.items.length > 0);

  const leftover = facts.filter((fact) => remaining.has(fact.id));
  if (leftover.length) groups.push({ label: "Other", items: leftover });
  return groups;
}

/** The badge reports what the run produced, not just whether it finished. */
function describeRun(research: ResearchDiagnostics | undefined) {
  if (!research) {
    return { label: "Not run", pill: "border-[#e2e2db] bg-[#f5f5f0] text-[#6f6f69]", ring: "#c4c4bc" };
  }
  if (research.queriesCompleted === 0) {
    return { label: "Blocked", pill: "border-[#f0cdc8] bg-[#fdf1ef] text-[#a4362a]", ring: "#b42318" };
  }
  if (research.uniqueResults === 0) {
    return { label: "No matches", pill: "border-[#e9d6a7] bg-[#fbf6e8] text-[#7d570d]", ring: "#95640c" };
  }
  if (research.queriesCompleted < research.queriesPlanned) {
    return { label: "Partial", pill: "border-[#e9d6a7] bg-[#fbf6e8] text-[#7d570d]", ring: "#95640c" };
  }
  return { label: "Complete", pill: "border-[#bfdccc] bg-[#edf7f1] text-[#17653f]", ring: "#19734a" };
}

function Card({
  children,
  className,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-[28px] border border-[#e4e4de] bg-white shadow-[0_1px_0_rgba(20,20,16,0.04)]",
        padded && "px-6 py-6 sm:px-8 sm:py-7",
        className,
      )}
    >
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f8f88]">{children}</p>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  const isZero = value === "0" || value === "0/0";
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.13em] text-[#9a9a93]">{label}</dt>
      <dd
        className={cn(
          "mt-2 text-[30px] font-semibold leading-none tracking-[-0.045em] tabular-nums",
          isZero ? "text-[#c2c2ba]" : "text-[#141412]",
        )}
      >
        {value}
      </dd>
      <p className="mt-2 text-[11px] leading-4 text-[#a3a39c]">{hint}</p>
    </div>
  );
}

function QueryRing({ completed, planned, color }: { completed: number; planned: number; color: string }) {
  const ratio = planned > 0 ? Math.min(1, completed / planned) : 0;
  const radius = 27;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative h-[68px] w-[68px] shrink-0">
      <svg viewBox="0 0 68 68" className="h-full w-full -rotate-90">
        <circle cx="34" cy="34" r={radius} fill="none" stroke="#eaeae4" strokeWidth="5" />
        <circle
          cx="34"
          cy="34"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ratio)}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[15px] font-semibold leading-none tabular-nums text-[#22221f]">{completed}</span>
        <span className="mt-0.5 text-[9px] font-medium tabular-nums text-[#a3a39c]">of {planned}</span>
      </div>
    </div>
  );
}

function FactRow({ fact }: { fact: PublicFact }) {
  return (
    <li className="flex items-start justify-between gap-5 border-b border-[#f2f2ed] py-3.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a3a39c]">{fact.label}</p>
        <p className="mt-1.5 break-words text-[15px] font-medium leading-6 tracking-[-0.015em] text-pretty text-[#1c1c19]">
          {fact.kind === "phone" ? displayPhone(fact.value) ?? fact.value.replace(/^\s*\+1/, "") : fact.value}
        </p>
        <a
          href={fact.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate text-[12px] text-[#8a8a84] transition hover:text-[#171715]"
        >
          {hostname(fact.sourceUrl)}
          <ArrowUpRight size={11} className="shrink-0" />
        </a>
      </div>
      <a
        href={fact.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-0.5 shrink-0"
        aria-label={`${fact.confidence} source for ${fact.label}`}
      >
        <StatusPill status={fact.confidence} />
      </a>
    </li>
  );
}

function SourceCard({ result }: { result: WebSearchResult }) {
  return (
    <a
      href={result.url}
      target="_blank"
      rel="noreferrer"
      className="group flex h-full flex-col rounded-[22px] border border-[#e4e4de] bg-white px-5 py-5 transition duration-200 hover:-translate-y-0.5 hover:border-[#d3d3cb] hover:shadow-[0_16px_38px_rgba(20,20,16,0.09)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.06em]",
            SOURCE_KIND_TONE[result.sourceKind],
          )}
        >
          {SOURCE_KIND_LABEL[result.sourceKind] ?? result.sourceKind}
        </span>
        <ArrowUpRight size={15} className="shrink-0 text-[#b8b8b1] transition group-hover:text-[#171715]" />
      </div>
      <p className="mt-4 text-[16px] font-semibold leading-6 tracking-[-0.022em] text-pretty text-[#171715]">
        {result.title}
      </p>
      {result.snippet ? (
        <p className="mt-2.5 flex-1 text-[13px] leading-6 text-pretty text-[#73736d]">{result.snippet}</p>
      ) : (
        <div className="flex-1" />
      )}
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-[#f0f0eb] pt-3.5">
        <p className="truncate text-[12px] font-medium text-[#5f5f59]">{hostname(result.url)}</p>
        <p className="shrink-0 text-[11px] text-[#a3a39c]">
          {result.matchedQueries.length > 1 ? `${result.matchedQueries.length} queries` : "1 query"}
        </p>
      </div>
      <p className="mt-2 line-clamp-1 text-[11px] text-[#a3a39c]">Found by {result.query}</p>
    </a>
  );
}

export function EvidencePanel({ intelligence }: { intelligence: CompanyIntelligence | null }) {
  const research = intelligence?.research;
  const facts = intelligence?.facts ?? [];
  const searchResults = intelligence?.searchResults ?? [];
  const factGroups = groupFacts(facts);
  const run = describeRun(research);

  return (
    <div className="space-y-4 py-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(330px,390px)] xl:items-stretch">
        <Card className="flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-4">
              <Label>Evidence ledger</Label>
              {intelligence?.retrievedAt ? (
                <p className="text-[11px] text-[#a3a39c]">Retrieved {formatRetrievedAt(intelligence.retrievedAt)}</p>
              ) : null}
            </div>
            <h2 className="mt-4 text-[32px] font-semibold leading-[1.06] tracking-[-0.045em] text-balance text-[#141412] sm:text-[40px]">
              Sourced public record
            </h2>
            <p className="mt-3 max-w-[44rem] text-[15px] leading-7 text-pretty text-[#6e6e68]">
              Every fact stays attached to the page that published it. Search hits are labeled by source kind, and
              missing values stay missing.
            </p>
          </div>

          <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-[#ecece7] pt-6 sm:grid-cols-3">
            <Stat
              label="Pages read"
              value={String(intelligence?.pagesScanned ?? 0)}
              hint="Official pages opened"
            />
            <Stat label="Public facts" value={String(facts.length)} hint="With a clickable source" />
            <Stat label="Google sources" value={String(searchResults.length)} hint="Ranked results kept" />
          </dl>
        </Card>

        <Card className="flex flex-col bg-[#faf9f6]">
          <div className="flex items-center justify-between gap-3">
            <Label>Research run</Label>
            <span
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.07em]",
                run.pill,
              )}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: run.ring }} />
              {run.label}
            </span>
          </div>

          <div className="mt-5 flex items-center gap-4">
            <QueryRing
              completed={research?.queriesCompleted ?? 0}
              planned={research?.queriesPlanned ?? 0}
              color={run.ring}
            />
            <div className="min-w-0">
              <p className="text-[17px] font-semibold tracking-[-0.03em] text-[#1c1c19]">Google engine</p>
              <p className="mt-1 text-[12px] leading-5 text-[#8a8a84]">
                {research?.queriesPlanned ? "Search queries completed" : "No query plan ran"}
              </p>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-3 gap-3 border-t border-[#e8e8e2] pt-5">
            {[
              { label: "Sources", value: String(research?.uniqueResults ?? 0) },
              { label: "Registry", value: `${research?.pagesRead ?? 0}/${research?.pagesSelected ?? 0}` },
              { label: "Raw hits", value: String(research?.rawResults ?? 0) },
            ].map((stat) => (
              <div key={stat.label}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a3a39c]">{stat.label}</dt>
                <dd className="mt-1.5 text-[19px] font-semibold leading-none tracking-[-0.035em] tabular-nums text-[#33332f]">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-auto border-t border-[#e8e8e2] pt-5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#a3a39c]">Providers</p>
            <p className="mt-1.5 text-[12px] leading-5 text-[#75756f]">
              {research?.providers.join(" · ") || "First-party search engine"}
            </p>
          </div>
        </Card>
      </div>

      {intelligence?.summary ? (
        <Card className="relative overflow-hidden">
          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[#c9c9c2]" />
          <div className="flex items-center justify-between gap-4">
            <Label>How they describe themselves</Label>
            <p className="text-[11px] font-medium text-[#a3a39c]">Official website</p>
          </div>
          <p className="mt-4 max-w-[62rem] text-[18px] font-medium leading-8 tracking-[-0.02em] text-pretty text-[#22221e] sm:text-[20px] sm:leading-9">
            {intelligence.summary}
          </p>
        </Card>
      ) : null}

      {facts.length ? (
        <Card padded={false}>
          <div className="flex items-end justify-between gap-4 border-b border-[#ecece7] px-6 py-5 sm:px-8">
            <div>
              <Label>Published facts</Label>
              <p className="mt-1.5 text-[15px] font-medium tracking-[-0.02em] text-[#1d1d1a]">
                Click through to verify each value
              </p>
            </div>
            <p className="shrink-0 text-[12px] tabular-nums text-[#8a8a84]">{facts.length} attached</p>
          </div>
          <div className="divide-y divide-[#ecece7]">
            {factGroups.map((group) => (
              <div key={group.label} className="px-6 py-5 sm:px-8">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b8b8b1]">{group.label}</p>
                <ul className="mt-1 grid gap-x-12 lg:grid-cols-2">
                  {group.items.map((fact) => (
                    <FactRow key={fact.id} fact={fact} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          <Label>Published facts</Label>
          <p className="mt-3 text-[16px] font-semibold tracking-[-0.02em] text-[#292926]">
            No additional public facts found.
          </p>
          <p className="mt-2 max-w-[40rem] text-[14px] leading-6 text-pretty text-[#777771]">
            The report kept the directory record as-is instead of filling gaps with guesses.
          </p>
        </Card>
      )}

      <Card padded={false}>
        <div className="flex items-end justify-between gap-4 border-b border-[#ecece7] px-6 py-5 sm:px-8">
          <div>
            <Label>Google research</Label>
            <p className="mt-1.5 text-[15px] font-medium tracking-[-0.02em] text-[#1d1d1a]">
              Sources the engine kept
            </p>
          </div>
          <p className="shrink-0 text-[12px] tabular-nums text-[#8a8a84]">
            {searchResults.length} {searchResults.length === 1 ? "source" : "sources"}
          </p>
        </div>

        <div className="rounded-b-[28px] bg-[#faf9f6] px-6 py-6 sm:px-8">
          {searchResults.length ? (
            <ul className={cn("grid gap-3 md:grid-cols-2", searchResults.length >= 3 && "xl:grid-cols-3")}>
              {searchResults.map((result) => (
                <li key={result.id}>
                  <SourceCard result={result} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-start gap-4 rounded-[22px] border border-dashed border-[#dcdcd5] bg-white px-6 py-7 sm:flex-row sm:items-center sm:gap-5">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#f4f4ef] text-[#8f8f88]">
                <SearchX size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold tracking-[-0.02em] text-[#292926]">
                  The engine kept no sources for this business.
                </p>
                <p className="mt-1.5 max-w-[48rem] text-[13px] leading-6 text-pretty text-[#777771]">
                  {research?.failures[0] ||
                    "Every query ran and nothing cleared the relevance bar, so the report stayed empty instead of inventing sources."}
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {intelligence?.warnings.length ? (
        <Card className="bg-[#faf9f6]">
          <Label>Research notes</Label>
          <ul className="mt-3 space-y-2">
            {intelligence.warnings.map((warning) => (
              <li key={warning} className="text-[13px] leading-6 text-pretty text-[#6f6f69]">
                {warning}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
