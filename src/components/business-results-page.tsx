"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BorderBeam } from "border-beam";
import { ChevronDown, ChevronRight, Download, MapPin, Search } from "lucide-react";

import { ProspectHeader } from "@/components/prospect-header";
import { SearchProgress } from "@/components/search-progress";
import { scoreTone } from "@/components/ui";
import type { Prospect, ResearchResponse } from "@/lib/types";

type LoadState = "loading" | "success" | "error";

const missingAddress = new Set(["Address not listed in OpenStreetMap", "Address unavailable"]);

function shortAddress(value: string) {
  const parts = value.split(",").map((item) => item.trim());
  return parts.slice(0, 3).join(", ");
}

// Source records often carry a placeholder instead of a street, which reads as noise in the list.
function placeLine(prospect: Prospect) {
  return missingAddress.has(prospect.address) ? null : prospect.address;
}

function contactLine(prospect: Prospect) {
  if (prospect.phone) return prospect.phone;
  if (!prospect.website) return null;
  try {
    return new URL(prospect.website).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function MetaDot() {
  return <span aria-hidden="true" className="h-[3px] w-[3px] shrink-0 rounded-full bg-[#cbcbc4]" />;
}

function csvCell(value: string | number | null) {
  if (value === null || value === undefined) return "";
  let text = String(value).replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function exportResults(prospects: Prospect[]) {
  const rows = [
    ["Initial fit", "Business", "Category", "Distance miles", "Address", "Phone", "Website", "Source"],
    ...prospects.map((item) => [item.score, item.name, item.category, item.distanceMiles.toFixed(2), item.address, item.phone, item.website, item.source]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `prospectiq-nearby-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function BusinessResultsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const address = params.get("address")?.trim() ?? "";
  const radius = Number(params.get("radius") ?? 0.5);
  const [queryAddress, setQueryAddress] = useState(address);
  const [queryRadius, setQueryRadius] = useState(String(radius));
  const [focused, setFocused] = useState(false);
  const [state, setState] = useState<LoadState>("loading");
  const [research, setResearch] = useState<ResearchResponse | null>(null);
  const [error, setError] = useState("");
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState<"fit" | "distance" | "name">("fit");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (address.length < 6 || ![0.25, 0.5, 1, 2, 5].includes(radius)) {
        if (!cancelled) {
          setError("Enter a complete address and supported radius.");
          setState("error");
        }
        return;
      }
      try {
        const cached = JSON.parse(window.sessionStorage.getItem("prospectiq.currentResearch") || "null") as ResearchResponse | null;
        const age = cached ? Date.now() - new Date(cached.retrievedAt).getTime() : Number.POSITIVE_INFINITY;
        if (
          cached?.target.inputAddress === address &&
          cached.radiusMiles === radius &&
          age < 15 * 60 * 1_000
        ) {
          if (!cancelled) {
            setResearch(cached);
            setState("success");
          }
          return;
        }
      } catch {
        window.sessionStorage.removeItem("prospectiq.currentResearch");
      }
      try {
        const response = await fetch("/api/research", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, radiusMiles: radius }),
        });
        const payload = (await response.json()) as ResearchResponse & { error?: string };
        if (!response.ok || payload.error) throw new Error(payload.error || "Business search failed.");
        if (!cancelled) {
          setResearch(payload);
          setState("success");
          window.sessionStorage.setItem("prospectiq.currentResearch", JSON.stringify(payload));
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Business search failed.");
          setState("error");
        }
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [address, radius]);

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
    if (queryAddress.trim().length < 6) return;
    setState("loading");
    setResearch(null);
    setError("");
    setCategory("All");
    router.push(`/search?address=${encodeURIComponent(queryAddress.trim())}&radius=${queryRadius}`);
  }

  function openBusiness(prospect: Prospect) {
    window.sessionStorage.setItem("prospectiq.selectedProspect", JSON.stringify(prospect));
    const query = new URLSearchParams({ address, radius: String(radius) });
    router.push(`/business/${encodeURIComponent(prospect.id)}?${query.toString()}`);
  }

  if (state === "loading") {
    return (
      <main className="min-h-screen bg-[#f5f5f2]">
        <ProspectHeader backHref="/" backLabel="Change address" />
        <SearchProgress />
      </main>
    );
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
          <BorderBeam
            size="md"
            colorVariant="ocean"
            theme="light"
            active={focused || Boolean(queryAddress)}
            duration={2.4}
            brightness={1.05}
            strength={focused ? 1 : 0.65}
            borderRadius={18}
            className="w-full"
          >
            <div className="rounded-[18px] border border-white/80 bg-white/80 p-2 shadow-[0_16px_50px_rgba(20,20,16,0.07)] backdrop-blur-2xl">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label className="flex h-12 min-w-0 flex-1 items-center gap-3 px-3">
                  <Search size={16} className="shrink-0 text-[#777771]" />
                  <span className="sr-only">Search address</span>
                  <input
                    value={queryAddress}
                    onChange={(event) => setQueryAddress(event.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    className="min-w-0 flex-1 bg-transparent text-sm text-[#282825] outline-none"
                    placeholder="Street address or street + ZIP"
                  />
                </label>
                <label className="relative flex h-11 items-center sm:w-[120px]">
                  <span className="sr-only">Search radius</span>
                  <select
                    value={queryRadius}
                    onChange={(event) => setQueryRadius(event.target.value)}
                    className="h-full w-full appearance-none rounded-full border border-[#e8e8e3] bg-[#f7f7f4] pl-3.5 pr-8 text-xs font-semibold text-[#292926] outline-none"
                  >
                    <option value="0.25">0.25 mi</option>
                    <option value="0.5">0.5 mi</option>
                    <option value="1">1 mi</option>
                    <option value="2">2 mi</option>
                    <option value="5">5 mi</option>
                  </select>
                  <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8a8a84]" />
                </label>
                <button type="submit" className="h-11 rounded-full bg-[#171715] px-5 text-xs font-semibold text-white hover:bg-black">
                  Search
                </button>
              </div>
            </div>
          </BorderBeam>
        </form>

        {state === "error" ? (
          <section className="flex min-h-[520px] items-center justify-center text-center">
            <div className="max-w-md">
              <p className="text-[13px] font-medium tracking-[-0.01em] text-[#8b8b85]">Search</p>
              <p className="mt-3 text-[28px] font-semibold leading-[1.1] tracking-[-0.04em] text-[#191916]">The search did not complete.</p>
              <p className="mt-4 text-sm leading-6 text-[#777771]">{error}</p>
              <button type="button" onClick={() => window.location.reload()} className="mt-7 rounded-full bg-[#171715] px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-black">Try again</button>
            </div>
          </section>
        ) : research ? (
          <div className="animate-enter">
            <header className="mt-10 sm:mt-14">
              <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">
                Nearby businesses · {radius} mi radius
              </p>
              <h1 className="mt-3.5 max-w-[820px] text-[34px] font-semibold leading-[1.04] tracking-[-0.05em] text-[#141412] sm:text-[46px]">
                {research.prospects.length} businesses{" "}
                <span className="text-shimmer-once text-[#a6a69e]">
                  near {shortAddress(research.target.formattedAddress)}
                </span>
              </h1>
              <p className="mt-4 max-w-[520px] text-sm leading-6 text-[#70706a]">
                Choose a business to research its fit and address-specific broadband options.
              </p>
            </header>

            {research.demoMode && (
              <p className="mt-6 border-l-2 border-[#e2c78a] py-1 pl-4 text-xs leading-5 text-[#8a6613]">
                Sample businesses are being shown and are not related to this address.
              </p>
            )}

            <div className="mt-9 flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-[#e0e0da] pb-3">
              <label className="-ml-2.5 inline-flex h-8 items-center gap-2 rounded-[10px] px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9a93] transition hover:bg-white/70">
                Category
                <span className="relative inline-flex items-center">
                  <select
                    value={category}
                    onChange={(event) => setCategory(event.target.value)}
                    className="max-w-[170px] appearance-none truncate bg-transparent pr-4 text-[12px] font-semibold normal-case tracking-normal text-[#22221f] outline-none"
                  >
                    <option>All</option>{categories.map((item) => <option key={item}>{item}</option>)}
                  </select>
                  <ChevronDown size={12} className="pointer-events-none absolute right-0 text-[#a3a39c]" />
                </span>
              </label>
              <label className="inline-flex h-8 items-center gap-2 rounded-[10px] px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9a93] transition hover:bg-white/70">
                Sort
                <span className="relative inline-flex items-center">
                  <select
                    value={sort}
                    onChange={(event) => setSort(event.target.value as typeof sort)}
                    className="appearance-none bg-transparent pr-4 text-[12px] font-semibold normal-case tracking-normal text-[#22221f] outline-none"
                  >
                    <option value="fit">Best fit</option><option value="distance">Closest</option><option value="name">Name</option>
                  </select>
                  <ChevronDown size={12} className="pointer-events-none absolute right-0 text-[#a3a39c]" />
                </span>
              </label>
              {category !== "All" && (
                <span className="px-2 text-[11px] tabular-nums text-[#9a9a93]">
                  {visible.length} of {research.prospects.length}
                </span>
              )}
              <button
                type="button"
                onClick={() => exportResults(visible)}
                disabled={!visible.length}
                className="ml-auto inline-flex h-8 items-center gap-2 rounded-full border border-[#dcdcd6] bg-white/70 px-3.5 text-[11px] font-semibold text-[#55554f] backdrop-blur transition hover:border-[#c6c6c0] hover:bg-white hover:text-[#1c1c19] disabled:opacity-40"
              >
                <Download size={12} /> Export
              </button>
            </div>

            <section>
              {visible.length ? (
                <ul className="border-b border-[#e5e5e0]">
                  {visible.map((prospect, index) => {
                    const place = placeLine(prospect);
                    const contact = contactLine(prospect);
                    const delay = `${Math.min(index, 10) * 45}ms`;
                    return (
                      <li
                        key={prospect.id}
                        className="animate-enter border-t border-[#e5e5e0] first:border-t-0"
                        style={{ animationDelay: delay }}
                      >
                        <button
                          type="button"
                          onClick={() => openBusiness(prospect)}
                          className="group relative block w-full py-4 text-left sm:py-[18px]"
                        >
                          <span className="pointer-events-none absolute -inset-x-3 -inset-y-px rounded-[16px] border border-[#e6e6e0] bg-white/90 opacity-0 shadow-[0_14px_36px_rgba(20,20,16,0.07)] backdrop-blur-sm transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100 sm:-inset-x-5" />

                          <span className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
                            <span className="min-w-0 flex-1 transition-transform duration-200 group-hover:translate-x-[3px]">
                              <span className="flex items-baseline gap-2.5">
                                <span className="truncate text-[16px] font-semibold tracking-[-0.02em] text-[#1a1a17] sm:text-[17px]">
                                  {prospect.name}
                                </span>
                                {sort === "fit" && index === 0 && (
                                  <span className="hidden shrink-0 text-[9px] font-bold uppercase tracking-[0.14em] text-[#a4a49d] sm:inline">
                                    Top fit
                                  </span>
                                )}
                              </span>
                              <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] leading-4 text-[#85857f]">
                                <span className="font-medium text-[#6d6d67]">{prospect.category}</span>
                                {place && (
                                  <>
                                    <MetaDot />
                                    <span className="min-w-0 max-w-full truncate">{place}</span>
                                  </>
                                )}
                                {contact && (
                                  <>
                                    <MetaDot />
                                    <span className="truncate tabular-nums">{contact}</span>
                                  </>
                                )}
                              </span>
                            </span>

                            <span className="flex items-center justify-between gap-5 sm:justify-end sm:gap-6">
                              <span className="text-[12px] font-medium tabular-nums text-[#6c6c66] sm:w-[62px] sm:text-right">
                                {prospect.distanceMiles.toFixed(2)} mi
                              </span>
                              <span className="flex items-center gap-2.5 sm:w-[112px]">
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#a4a49d]">Fit</span>
                                <span className="text-[14px] font-semibold tabular-nums text-[#1f1f1c]">{prospect.score}</span>
                                <span className="h-[3px] w-9 shrink-0 overflow-hidden rounded-full bg-[#e3e3dd]">
                                  <span
                                    className="fit-bar block h-full rounded-full"
                                    style={{
                                      width: `${prospect.score}%`,
                                      backgroundColor: scoreTone(prospect.score),
                                      animationDelay: delay,
                                    }}
                                  />
                                </span>
                              </span>
                              <ChevronRight
                                size={16}
                                className="shrink-0 text-[#b9b9b2] transition duration-200 group-hover:translate-x-1 group-hover:text-[#1f1f1c]"
                              />
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full border border-[#e4e4de] bg-white/80">
                    <MapPin size={17} strokeWidth={1.7} className="text-[#9a9a93]" />
                  </span>
                  <p className="mt-5 text-[17px] font-semibold tracking-[-0.025em] text-[#22221f]">
                    {category === "All" ? "No nearby businesses found." : "No businesses in this category."}
                  </p>
                  <p className="mt-2 max-w-[340px] text-[13px] leading-6 text-[#7d7d77]">
                    {category === "All"
                      ? "Try a larger radius or check the address."
                      : "Clear the category filter or widen the search radius."}
                  </p>
                </div>
              )}
            </section>

            <p className="mt-5 text-[10px] leading-5 text-[#9d9d96]">Verify business facts before outreach.</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
