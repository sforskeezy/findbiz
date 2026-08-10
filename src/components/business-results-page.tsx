"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BorderBeam } from "border-beam";
import { ChevronDown, CircleAlert, MapPin, RotateCcw, Search } from "lucide-react";

import { DataAttribution } from "@/components/data-attribution";
import { ProspectHeader } from "@/components/prospect-header";
import { ProspectResultRow } from "@/components/prospect-result-row";
import { SearchProgress } from "@/components/search-progress";
import {
  beginSearch,
  currentResearch,
  currentSearch,
  selectProspect,
  setCurrentResearch,
  type InMemorySearch,
} from "@/lib/client-session";
import type { Prospect, ResearchResponse } from "@/lib/types";

type LoadState = "loading" | "success" | "error";

function shortAddress(value: string) {
  return value.split(",").map((item) => item.trim()).slice(0, 3).join(", ");
}

function diagnosticSummary(research: ResearchResponse) {
  const { eligibility } = research.diagnostics;
  return [
    `${eligibility.eligible} eligible`,
    `${research.diagnostics.duplicatesMerged} duplicates merged`,
    eligibility.banks ? `${eligibility.banks} banks excluded` : null,
    eligibility.schools ? `${eligibility.schools} schools excluded` : null,
    eligibility.enterprises ? `${eligibility.enterprises} enterprises excluded` : null,
    eligibility.apartmentsUnknownUnits ? `${eligibility.apartmentsUnknownUnits} apartments excluded pending unit count` : null,
    eligibility.permanentlyClosed ? `${eligibility.permanentlyClosed} closed places excluded` : null,
  ].filter(Boolean).join(" · ");
}

function diagnosticLabel(providerId: string) {
  if (providerId === "overture") return "Local place index";
  if (providerId === "openstreetmap") return "Public map supplement";
  if (providerId === "commercial") return "Optional business-data source";
  return "Additional place source";
}

function diagnosticMessage(provider: ResearchResponse["diagnostics"]["providers"][number]) {
  if (provider.code === "PROVIDER_TIMEOUT" || provider.code.endsWith("_TIMEOUT")) return "Timed out before completing the requested search area.";
  if (provider.code === "OVERTURE_OUTSIDE_CONFIGURED_COVERAGE") return "This search is outside the configured local data boundary.";
  if (provider.code === "OVERTURE_PARTIAL_CONFIGURED_COVERAGE") return "Only part of the search overlaps the configured local data boundary.";
  if (provider.status === "failed") return "The source did not complete; successful results from other sources were preserved.";
  if (provider.status === "unavailable") return "This source is not available for the current search.";
  if (provider.status === "partial") return "Usable results were returned before a coverage or request limit was reached.";
  return "Search completed successfully.";
}

function coverageLabel(research: ResearchResponse) {
  if (research.partialCoverage) return "Partial coverage";
  const localIndex = research.diagnostics.providers.find((provider) => provider.providerId === "overture");
  return localIndex?.coverage === "inside" ? "Configured coverage searched" : "Search completed";
}

export function BusinessResultsPage() {
  const router = useRouter();
  const [request, setRequest] = useState<InMemorySearch | null>(() => currentSearch());
  const [queryAddress, setQueryAddress] = useState(() => currentSearch()?.address ?? "");
  const [queryRadius, setQueryRadius] = useState(() => String(currentSearch()?.radiusMiles ?? 0.5));
  const [focused, setFocused] = useState(false);
  const [state, setState] = useState<LoadState>(() => currentSearch() ? (currentResearch() ? "success" : "loading") : "error");
  const [research, setResearch] = useState<ResearchResponse | null>(() => currentResearch());
  const [error, setError] = useState(() => currentSearch() ? "" : "This search session ended on refresh. Start a new search; no address or prospect data was stored.");
  const [errorCode, setErrorCode] = useState(() => currentSearch() ? "" : "SESSION_ENDED");
  const [retryable, setRetryable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState<"fit" | "distance" | "name">("fit");

  useEffect(() => {
    if (!request) {
      return;
    }
    const activeRequest = request;
    const cached = currentResearch();
    if (cached?.target.inputAddress === activeRequest.address && cached.radiusMiles === activeRequest.radiusMiles) {
      return;
    }

    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address: activeRequest.address, radiusMiles: activeRequest.radiusMiles }),
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json()) as ResearchResponse & { error?: string; code?: string; retryable?: boolean };
        if (!response.ok || payload.error) {
          const apiError = new Error(payload.error || "Business search failed.") as Error & { code?: string; retryable?: boolean };
          apiError.code = payload.code;
          apiError.retryable = payload.retryable;
          throw apiError;
        }
        setCurrentResearch(payload);
        setResearch(payload);
        setErrorCode("");
        setRetryable(false);
        setState("success");
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : "Business search failed.");
        const responseError = loadError as Error & { code?: string; retryable?: boolean };
        setErrorCode(responseError.code ?? "SEARCH_FAILED");
        setRetryable(responseError.retryable ?? true);
        setState("error");
      }
    }
    void load();
    return () => controller.abort();
  }, [request, attempt]);

  const categories = useMemo(
    () => research ? [...new Set(research.prospects.map((item) => item.category))].sort() : [],
    [research],
  );

  const visible = useMemo(() => {
    if (!research) return [];
    const filtered = category === "All" ? research.prospects : research.prospects.filter((item) => item.category === category);
    return [...filtered].sort((a, b) => {
      if (sort === "distance") return a.distanceMiles - b.distanceMiles;
      if (sort === "name") return a.name.localeCompare(b.name);
      return b.score - a.score || a.distanceMiles - b.distanceMiles;
    });
  }, [research, category, sort]);

  function searchAgain(event: React.FormEvent) {
    event.preventDefault();
    const radiusMiles = Number(queryRadius);
    if (queryAddress.trim().length < 6 || ![0.25, 0.5, 1, 2, 3, 5].includes(radiusMiles)) return;
    const next = { address: queryAddress.trim(), radiusMiles };
    beginSearch(next);
    setRequest(next);
    setState("loading");
    setResearch(null);
    setError("");
    setErrorCode("");
    setRetryable(false);
    setCategory("All");
    router.replace("/search");
  }

  function retrySearch() {
    if (!request) return;
    setState("loading");
    setError("");
    setErrorCode("");
    setRetryable(false);
    setAttempt((value) => value + 1);
  }

  function openBusiness(prospect: Prospect) {
    selectProspect(prospect);
    router.push(`/business/${encodeURIComponent(prospect.id)}`);
  }

  if (state === "loading") {
    return <main className="min-h-screen bg-[#f5f5f2]"><ProspectHeader backHref="/" backLabel="Change address" /><SearchProgress /></main>;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f5f5f2]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="ambient-orb absolute -left-[16%] -top-[12%] h-[520px] w-[520px] rounded-full bg-[#d8dcea]/50 blur-[140px]" />
        <div className="ambient-orb-delayed absolute -right-[14%] top-[18%] h-[540px] w-[540px] rounded-full bg-white/75 blur-[120px]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(255,255,255,0.6),transparent_58%)]" />
      </div>

      <ProspectHeader backHref="/" backLabel="New search" />

      <div className="relative z-10 mx-auto w-full max-w-[1040px] px-5 pb-24 pt-5 sm:px-8 sm:pt-10">
        <form onSubmit={searchAgain}>
          <BorderBeam size="md" colorVariant="ocean" theme="light" active={focused || Boolean(queryAddress)} duration={2.4} brightness={1.05} strength={focused ? 1 : 0.65} borderRadius={18} className="w-full">
            <div className="rounded-[18px] border border-white/80 bg-white/80 p-2 shadow-[0_16px_50px_rgba(20,20,16,0.07)] backdrop-blur-2xl">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="flex h-12 min-w-0 flex-1 items-center gap-3 px-3">
                  <Search size={16} aria-hidden className="shrink-0 text-[#777771]" />
                  <span className="sr-only">Search address</span>
                  <input value={queryAddress} onChange={(event) => setQueryAddress(event.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} className="min-w-0 flex-1 bg-transparent text-sm text-[#282825] outline-none focus-visible:ring-2 focus-visible:ring-[#898983]" placeholder="Street address or street + ZIP" />
                </label>
                <label className="relative flex h-11 items-center sm:w-[120px]">
                  <span className="sr-only">Search radius</span>
                  <select value={queryRadius} onChange={(event) => setQueryRadius(event.target.value)} className="h-full w-full appearance-none rounded-full border border-[#e8e8e3] bg-[#f7f7f4] pl-3.5 pr-8 text-xs font-semibold text-[#292926] outline-none focus-visible:ring-2 focus-visible:ring-[#898983]">
                    <option value="0.25">0.25 mi</option><option value="0.5">0.5 mi</option><option value="1">1 mi</option><option value="2">2 mi</option><option value="3">3 mi</option><option value="5">5 mi</option>
                  </select>
                  <ChevronDown size={13} aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a8a84]" />
                </label>
                <button type="submit" className="h-11 rounded-full bg-[#171715] px-5 text-xs font-semibold text-white hover:bg-black focus-visible:outline-2 focus-visible:outline-offset-2">Search</button>
              </div>
            </div>
          </BorderBeam>
        </form>

        {state === "error" ? (
          <section className="flex min-h-[520px] items-center justify-center text-center">
            <div className="max-w-md">
              <p className="text-[13px] font-medium text-[#8b8b85]">{errorCode === "PLACES_PROVIDER_UNAVAILABLE" ? "Business discovery unavailable" : "Search"}</p>
              <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-[#191916]">{errorCode === "PLACES_PROVIDER_UNAVAILABLE" ? "The place sources did not respond." : "The search did not complete."}</h1>
              <p className="mt-4 text-sm leading-6 text-[#777771]">{error}</p>
              <div className="mt-7 flex flex-wrap justify-center gap-2">
                {retryable && request && <button type="button" onClick={retrySearch} className="inline-flex h-11 items-center gap-2 rounded-full bg-[#171715] px-5 text-xs font-semibold text-white"><RotateCcw size={13} aria-hidden /> Retry</button>}
                <button type="button" onClick={() => router.push("/")} className="h-11 rounded-full border border-[#d9d9d3] bg-white px-5 text-xs font-semibold text-[#33332f]">Start a new search</button>
              </div>
            </div>
          </section>
        ) : research ? (
          <div className="animate-enter">
            <header className="mt-10 sm:mt-14">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                <span className={research.partialCoverage ? "text-[#8a6613]" : "text-[#17653f]"}>{coverageLabel(research)}</span>
                <span aria-hidden="true" className="h-[3px] w-[3px] shrink-0 rounded-full bg-[#cbcbc4]" />
                <span className="text-[#777771]">{research.radiusMiles} mi radius</span>
              </div>
              <h1 className="mt-3.5 max-w-[820px] text-[34px] font-semibold leading-[1.04] tracking-[-0.05em] text-[#141412] sm:text-[46px]">
                {research.prospects.length} eligible businesses <span className="text-shimmer-once text-[#a6a69e]">near {shortAddress(research.target.formattedAddress)}</span>
              </h1>
              <p className="mt-4 text-xs leading-5 text-[#777771]">{diagnosticSummary(research)}</p>
            </header>

            <details className="mt-7 rounded-[14px] border border-[#dfdfd9] bg-white/55 px-4 py-3 text-xs text-[#666660]">
              <summary className="cursor-pointer list-none font-semibold text-[#33332f] focus-visible:outline-2">Search details</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {research.diagnostics.providers.map((provider) => (
                  <div key={provider.providerId} className="border-t border-[#e4e4df] pt-2.5">
                    <div className="flex items-center justify-between gap-3"><span className="font-semibold text-[#393935]">{diagnosticLabel(provider.providerId)}</span><span className="capitalize">{provider.status}</span></div>
                    <p className="mt-1 leading-5">{diagnosticMessage(provider)}</p>
                    <p className="mt-1 text-[10px] text-[#8a8a84]">{provider.recordCount} records · {provider.durationMs} ms{provider.coverage ? ` · ${provider.coverage} local coverage` : ""}</p>
                  </div>
                ))}
              </div>
              {research.eligibilityUnknown.length > 0 && <p className="mt-3 flex items-center gap-2 border-t border-[#e4e4df] pt-3"><CircleAlert size={13} aria-hidden /> {research.eligibilityUnknown.length} eligibility-unknown record(s) are hidden from the primary list.</p>}
            </details>

            <div className="mt-9 flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-[#e0e0da] pb-3">
              <label className="-ml-2.5 inline-flex h-10 items-center gap-2 rounded-[10px] px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#777771]">
                Category
                <span className="relative inline-flex items-center"><select value={category} onChange={(event) => setCategory(event.target.value)} className="max-w-[170px] appearance-none truncate bg-transparent pr-4 text-[12px] font-semibold normal-case tracking-normal text-[#22221f] outline-none"><option>All</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={12} aria-hidden className="pointer-events-none absolute right-0 text-[#777771]" /></span>
              </label>
              <label className="inline-flex h-10 items-center gap-2 rounded-[10px] px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#777771]">
                Sort
                <span className="relative inline-flex items-center"><select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="appearance-none bg-transparent pr-4 text-[12px] font-semibold normal-case tracking-normal text-[#22221f] outline-none"><option value="fit">Prospect fit</option><option value="distance">Closest</option><option value="name">Name</option></select><ChevronDown size={12} aria-hidden className="pointer-events-none absolute right-0 text-[#777771]" /></span>
              </label>
            </div>

            <section>
              {visible.length ? (
                <ul className="border-b border-[#e5e5e0]">
                  {visible.map((prospect, index) => <ProspectResultRow key={prospect.id} prospect={prospect} index={index} onOpen={openBusiness} />)}
                </ul>
              ) : (
                <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center"><span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#e4e4de] bg-white/80"><MapPin size={17} aria-hidden className="text-[#777771]" /></span><p className="mt-5 text-[17px] font-semibold text-[#22221f]">No eligible nearby businesses found.</p><p className="mt-2 max-w-[400px] text-[13px] leading-6 text-[#6f6f69]">{research.warnings[0] || "Widen the radius or review source diagnostics. Missing results do not prove no businesses exist."}</p></div>
              )}
            </section>
            <div className="mt-5 flex flex-col gap-2">
              <p className="text-[10px] leading-5 text-[#777771]">Verify business facts before outreach. Results stay in memory and clear on refresh.</p>
              <DataAttribution providers={research.diagnostics.providers} />
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
