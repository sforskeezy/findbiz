"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";

import { DataAttribution } from "@/components/data-attribution";
import { ProspectFit } from "@/components/prospect-fit";
import { ProspectHeader } from "@/components/prospect-header";
import { cn } from "@/components/ui";
import { buildFallbackBrief } from "@/lib/brief-fallback";
import { buildBriefRequest } from "@/lib/brief-schema";
import { currentProspect, currentSearch } from "@/lib/client-session";
import { classifyServiceability, displayServiceability, isCharterSpectrumObservation } from "@/lib/serviceability";
import type {
  AiBriefResult,
  BroadbandObservation,
  FccLookupResponse,
  Prospect,
  ServiceabilitySignal,
} from "@/lib/types";

type ResearchStep = "business" | "fcc" | "profile" | "complete";
type Tab = "research" | "availability" | "outreach";

const MISSING_ADDRESS = new Set([
  "Address not listed in public data",
  "Address unavailable",
]);

function briefToPlainText(brief: AiBriefResult, prospect: Prospect) {
  return [
    `${prospect.name} — ${prospect.category}`,
    prospect.address,
    "",
    brief.summary,
    "",
    "Working hypotheses",
    ...brief.hypothesizedNeeds.slice(0, 3).map((item) => `- ${item}`),
    "",
    "Sales angle",
    brief.topOpportunity,
    "",
    "Public data is context only. Confirm the business's needs, current setup, and service availability directly.",
  ].join("\n");
}

function formatDate(value: string | null) {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function BusinessResearchPage({ prospectId }: { prospectId: string }) {
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [brief, setBrief] = useState<AiBriefResult | null>(null);
  const [broadband, setBroadband] = useState<BroadbandObservation[]>([]);
  const [fcc, setFcc] = useState<FccLookupResponse | null>(null);
  const [signal, setSignal] = useState<ServiceabilitySignal | null>(null);
  const [step, setStep] = useState<ResearchStep>("business");
  const [tab, setTab] = useState<Tab>("research");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function researchBusiness() {
      try {
        const selected = currentProspect(prospectId);
        const search = currentSearch();
        if (!selected || !search) throw new Error("This in-memory research session ended. Return to the search page and start a new search.");
        if (cancelled) return;
        setProspect(selected);
        setStep("fcc");

        let observations: BroadbandObservation[] = [];
        try {
          const fccResponse = await fetch("/api/fcc/availability", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: MISSING_ADDRESS.has(selected.address) ? search.address : selected.address,
              coordinates: selected.coordinates,
            }),
            cache: "no-store",
          });
          const fccPayload = (await fccResponse.json()) as FccLookupResponse;
          const nextSignal = fccPayload.serviceability ?? classifyServiceability(fccPayload);
          if (!cancelled) {
            setFcc(fccPayload);
            setSignal(nextSignal);
          }
          if (fccResponse.ok && fccPayload.status === "available") observations = fccPayload.observations;
        } catch {
          if (!cancelled) {
            const fallback: FccLookupResponse = {
              status: "error",
              observations: [],
              message: "The FCC lookup failed. No provider claim was generated.",
              sourceUrl: "https://broadbandmap.fcc.gov/home",
              asOfDate: null,
              datasetVintage: null,
              matchedLocationId: null,
              matchQuality: "none",
            };
            setFcc(fallback);
            setSignal(classifyServiceability(fallback));
          }
        }
        if (cancelled) return;
        setBroadband(observations);
        setStep("profile");

        try {
          const aiResponse = await fetch("/api/brief", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildBriefRequest(selected, observations)),
            cache: "no-store",
          });
          const aiPayload = (await aiResponse.json()) as { brief?: AiBriefResult; error?: string };
          if (!aiResponse.ok || !aiPayload.brief) {
            throw new Error(aiPayload.error || "Profile generation did not return a brief.");
          }
          if (!cancelled) setBrief(aiPayload.brief);
        } catch {
          // Fall back to the source-bounded template quietly — never surface env/config errors in the UI.
          if (!cancelled) setBrief(buildFallbackBrief(selected, observations));
        }
        if (!cancelled) setStep("complete");
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Business research failed.");
          setStep("complete");
        }
      }
    }
    void researchBusiness();
    return () => {
      cancelled = true;
    };
  }, [prospectId]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const statusCopy = useMemo(() => {
    if (step === "business") return "Reviewing public business information";
    if (step === "fcc") return "Checking broadband availability";
    if (step === "profile") return "Building a profile on this business";
    return "Building a profile on this business";
  }, [step]);

  const displayedSignal = useMemo(() => {
    if (!signal) return null;
    // Status is derived from FCC filings automatically — no manual rep notes.
    return displayServiceability(signal, null);
  }, [signal]);

  const providerChart = useMemo(() => {
    return [...broadband].sort((a, b) => (b.downloadMbps ?? 0) - (a.downloadMbps ?? 0));
  }, [broadband]);
  const uniqueProviderCount = useMemo(
    () => new Set(broadband.map((item) => item.providerId || item.provider)).size,
    [broadband],
  );

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setToast(`${label} copied.`);
  }

  if (error || (step === "complete" && !prospect)) {
    return (
      <main className="min-h-screen bg-[#f5f5f2]">
        <ProspectHeader backHref="/search" backLabel="Back to results" />
        <div className="mx-auto flex min-h-[600px] max-w-lg items-center justify-center px-5 text-center">
          <div>
            <h1 className="text-2xl font-semibold text-[#22221f]">Research could not be completed.</h1>
            <p className="mt-3 text-sm leading-6 text-[#777771]">{error}</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f5f5f2]">
      <ProspectHeader backHref="/search" backLabel="Back to results" />

      <div className="mx-auto w-full max-w-[940px] px-5 pb-24 pt-6 sm:px-8 sm:pt-12">
        {prospect ? (
          <>
            <header className="border-b border-[#dcdcd7] pb-8 sm:pb-10">
              <div>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">{prospect.category}</p>
                  <h1 className="mt-3 text-[38px] font-semibold leading-[1.05] tracking-[-0.05em] text-[#141412] sm:text-[56px]">
                    {prospect.name}
                  </h1>
                  <p className="mt-4 max-w-[680px] text-sm leading-6 text-[#70706a]">
                    {[
                      prospect.address,
                      `${prospect.distanceMiles.toFixed(2)} miles from the search address`,
                      prospect.phone,
                      prospect.operatingStatus === "Temporarily closed" ? "Temporarily closed" : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-medium text-[#65655f]">
                    {prospect.website && (
                      <a href={prospect.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-[#171715]">
                        Website <ExternalLink size={11} />
                      </a>
                    )}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${prospect.name} ${MISSING_ADDRESS.has(prospect.address) ? "" : prospect.address}`.trim())}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 hover:text-[#171715]"
                    >
                      Verify on Google Maps <ExternalLink size={11} />
                    </a>
                  </div>
                  <div className="mt-3"><DataAttribution sources={prospect.sources} /></div>
                </div>
              </div>
            </header>

            <div className="mt-6"><ProspectFit prospect={prospect} /></div>

            {step !== "complete" ? (
              <section className="flex flex-col items-center py-16 text-center sm:py-24">
                <ThinkingOrb state="solving" size={64} speed={0.85} theme="light" aria-label="Building business profile" />
                <p className="mt-8 text-[13px] font-medium tracking-[-0.01em] text-[#777771]">Building a profile</p>
                <p className="mt-3 text-lg font-semibold tracking-[-0.02em] text-[#1b1b18]">{statusCopy}</p>
              </section>
            ) : brief ? (
              <div className="animate-enter">
                <nav className="flex gap-7 border-b border-[#dcdcd7] pt-7" aria-label="Business research sections">
                  {(
                    [
                      ["research", "Research"],
                      ["availability", "Availability"],
                      ["outreach", "Outreach"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={cn(
                        "border-b-2 pb-3 text-xs font-semibold transition",
                        tab === id ? "border-[#171715] text-[#171715]" : "border-transparent text-[#81817b] hover:text-[#343430]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </nav>

                {tab === "research" && (
                  <section className="py-10">
                    <div className="max-w-[720px]">
                      <div className="flex items-start justify-between gap-6">
                        <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">Assessment</p>
                        <button
                          type="button"
                          onClick={() => void copy(briefToPlainText(brief, prospect), "Assessment")}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#666660] transition hover:text-[#171715]"
                        >
                          <Copy size={11} /> Copy assessment
                        </button>
                      </div>
                      <p className="mt-5 text-[17px] leading-8 tracking-[-0.015em] text-[#30302c]">{brief.summary}</p>

                      {brief.hypothesizedNeeds.length > 0 && (
                        <div className="mt-12 border-t border-[#dedad3] pt-6">
                          <div className="flex items-baseline justify-between gap-4"><p className="text-[13px] font-medium text-[#777771]">Working hypotheses</p><p className="text-[11px] text-[#a1a19a]">Questions to test</p></div>
                          <ul className="mt-5 grid gap-2 sm:grid-cols-3">
                            {brief.hypothesizedNeeds.slice(0, 3).map((need) => (
                              <li
                                key={need}
                                className="rounded-[14px] border border-[#dcdcd5] bg-white/75 px-4 py-3 text-[13px] font-medium leading-5 tracking-[-0.01em] text-[#4a4a44]"
                              >
                                {need.replace(/^Hypothesis(?: to test)?:\s*/i, "")}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {brief.topOpportunity && (
                        <div className="mt-10 rounded-2xl bg-[#171715] px-6 py-6 shadow-[0_18px_50px_rgba(20,20,16,0.14)]">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8f8f86]">Sales angle</p>
                          <p className="mt-3.5 text-[17px] font-medium leading-[1.65] tracking-[-0.015em] text-[#f3f3ed]">
                            {brief.topOpportunity}
                          </p>
                        </div>
                      )}

                    </div>
                  </section>
                )}

                {tab === "availability" && (
                  <section className="py-10">
                    <div className="max-w-[760px]">
                      <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">Availability</p>
                      <h2
                        className={cn(
                          "mt-4 max-w-[18ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.05em] sm:text-[52px]",
                          displayedSignal?.toneClass ?? "text-[#141412]",
                        )}
                      >
                        {displayedSignal?.tier === "data_unavailable" ? "Broadband data unavailable" : displayedSignal?.shortLabel ?? "Checking availability"}
                      </h2>
                      <p className="mt-4 max-w-[36rem] text-[15px] leading-7 text-[#6e6e68]">
                        {displayedSignal?.detail ?? "Looking up current FCC Broadband Data Collection filing context."}
                      </p>
                      {fcc?.asOfDate && (
                        <p className="mt-3 text-xs text-[#85857f]">FCC data as of {formatDate(fcc.asOfDate)}</p>
                      )}
                    </div>

                    <div className="mt-14 w-full max-w-[640px]">
                      {providerChart.length ? (
                        <div className="border-[3px] border-black bg-white text-black shadow-[6px_6px_0_#171715]">
                          <div className="border-b-[8px] border-black px-3.5 pb-2.5 pt-3">
                            <p className="text-[34px] font-black leading-none tracking-[-0.04em] sm:text-[40px]">
                              Broadband Facts
                            </p>
                            <p className="mt-1.5 text-[12px] font-bold leading-snug">
                              {fcc?.matchQuality === "exact"
                                ? "Provider-reported speeds at this location"
                                : fcc?.matchQuality === "user_supplied_location_id"
                                  ? "Provider-reported speeds for the supplied FCC location ID"
                                  : "Provider-reported speeds for this area"}
                            </p>
                          </div>

                          <div className="border-b-4 border-black px-3.5 py-2">
                            <div className="flex items-end justify-between gap-3">
                              <p className="text-[11px] font-bold uppercase tracking-[0.04em]">
                                Unique providers in loaded evidence
                              </p>
                              <p className="text-[13px] font-black tabular-nums">
                                {uniqueProviderCount}{" "}
                                <span className="text-[11px] font-bold">
                                  {uniqueProviderCount === 1 ? "provider" : "providers"}
                                </span>
                              </p>
                            </div>
                            {fcc?.asOfDate && (
                              <p className="mt-1 text-[11px] font-medium">
                                FCC data as of {formatDate(fcc.asOfDate)}
                              </p>
                            )}
                          </div>

                          <div className="border-b border-black px-3.5 py-1.5">
                            <p className="text-[11px] font-black uppercase tracking-[0.06em]">
                              Amount Per Provider
                            </p>
                          </div>

                          <ul>
                            {providerChart.map((item, index) => {
                              const isSpectrum = isCharterSpectrumObservation(item);
                              return (
                                <li
                                  key={item.id}
                                  className={cn(
                                    "px-3.5 py-3",
                                    index < providerChart.length - 1 && "border-b border-black",
                                    isSpectrum && "bg-[#f3faf5]",
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-[15px] font-black leading-tight tracking-[-0.02em]">
                                        {item.provider}
                                      </p>
                                      {isSpectrum && (
                                        <p className="mt-1 text-[10px] font-black uppercase tracking-[0.08em] text-[#17653f]">
                                          Configured provider identifier match
                                        </p>
                                      )}
                                    </div>
                                    <p className="shrink-0 text-[11px] font-bold uppercase tracking-[0.04em]">
                                      {item.classification}
                                    </p>
                                  </div>

                                  <div className="mt-2 space-y-1 border-t border-black/25 pt-2 text-[13px] leading-5">
                                    <div className="flex items-baseline justify-between gap-3">
                                      <span className="font-semibold">Technology</span>
                                      <span className="max-w-[60%] text-right font-medium">
                                        {item.technology || "Not listed"}
                                      </span>
                                    </div>
                                    <div className="flex items-baseline justify-between gap-3 border-t border-dotted border-black/35 pt-1">
                                      <span className="font-semibold">Maximum advertised download</span>
                                      <span className="font-black tabular-nums">
                                        {item.downloadMbps != null
                                          ? `${item.downloadMbps.toLocaleString()} Mbps`
                                          : "—"}
                                      </span>
                                    </div>
                                    <div className="flex items-baseline justify-between gap-3 border-t border-dotted border-black/35 pt-1">
                                      <span className="font-semibold">Maximum advertised upload</span>
                                      <span className="font-black tabular-nums">
                                        {item.uploadMbps != null
                                          ? `${item.uploadMbps.toLocaleString()} Mbps`
                                          : "—"}
                                      </span>
                                    </div>
                                  </div>
                                  <p className="mt-2 border-t border-dotted border-black/35 pt-2 text-[10px] font-medium leading-4">
                                    {fcc?.matchQuality === "user_supplied_location_id" ? "Supplied FCC location ID · Manually entered" : item.scope === "exact_location" ? "Exact FCC Location ID evidence" : "Nearby market context—not availability at this address"} · {item.matchMethod} · vintage {item.datasetVintage}
                                  </p>
                                </li>
                              );
                            })}
                          </ul>

                          <div className="border-t-4 border-black px-3.5 py-2.5">
                            <p className="text-[10px] font-medium leading-4">
                              Maximum advertised speed pairs are preserved exactly as filed. Residential or nearby
                              evidence does not prove business availability at this address.
                            </p>
                            <a
                              href={fcc?.sourceUrl || "https://broadbandmap.fcc.gov/home"}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold underline underline-offset-2"
                            >
                              FCC Broadband Map <ExternalLink size={9} />
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="border-[3px] border-black bg-white px-3.5 py-4 text-black shadow-[6px_6px_0_#171715]">
                          <p className="text-[28px] font-black leading-none tracking-[-0.04em]">Broadband Facts</p>
                          <div className="mt-3 border-t-4 border-black pt-3">
                            <p className="text-sm font-black">{displayedSignal?.tier === "data_unavailable" ? "Broadband data unavailable" : "No FCC provider records were returned."}</p>
                            <p className="mt-2 text-[12px] font-medium leading-5">
                              {fcc?.message ?? "The FCC lookup did not return availability for this location."}
                            </p>
                            <a
                              href={fcc?.sourceUrl || "https://broadbandmap.fcc.gov/home"}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold underline underline-offset-2"
                            >
                              Open the official FCC map <ExternalLink size={11} />
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {tab === "outreach" && (
                  <section className="py-10">
                    <div className="max-w-[720px]">
                      <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">Discovery questions</p>
                      <div className="mt-5 space-y-5">
                        {brief.discoveryQuestions.map((question) => (
                          <p key={question} className="text-[15px] leading-7 text-[#3f3f3a]">
                            {question}
                          </p>
                        ))}
                      </div>
                    </div>

                    <div className="mt-12 max-w-[760px]">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">Call opener</p>
                        <button
                          type="button"
                          onClick={() => void copy(brief.callOpener, "Call opener")}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#666660] hover:text-[#171715]"
                        >
                          <Copy size={11} /> Copy
                        </button>
                      </div>
                      <p className="mt-4 text-[15px] leading-7 text-[#2d2d29]">“{brief.callOpener}”</p>
                    </div>

                    <div className="mt-12 max-w-[760px]">
                      <div className="flex items-center justify-between gap-4">
                        <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">Follow-up email</p>
                        <button
                          type="button"
                          onClick={() => void copy(`Subject: ${brief.followUpEmail.subject}\n\n${brief.followUpEmail.body}`, "Email draft")}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#666660] hover:text-[#171715]"
                        >
                          <Copy size={11} /> Copy
                        </button>
                      </div>
                      <p className="mt-4 text-sm font-semibold text-[#2d2d29]">{brief.followUpEmail.subject}</p>
                      <p className="mt-4 whitespace-pre-line text-sm leading-7 text-[#555550]">{brief.followUpEmail.body}</p>
                    </div>
                  </section>
                )}

                <aside className="mb-10 border-t border-[#dcdcd7] pt-5 text-[11px] leading-5 text-[#777771]">
                  Public data is context only. Confirm the business’s needs, current setup, and service availability directly.
                </aside>
              </div>
            ) : null}
          </>
        ) : (
          <section className="flex flex-col items-center py-24 text-center">
            <ThinkingOrb state="solving" size={64} speed={0.85} theme="light" aria-label="Loading business" />
            <p className="mt-8 text-lg font-semibold tracking-[-0.02em] text-[#1b1b18]">Building a profile on this business</p>
          </section>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-5 right-5 z-50 rounded-full border border-[#d7d7d2] bg-white px-4 py-2.5 text-xs font-medium text-[#44443f] shadow-[0_12px_40px_rgba(20,20,16,0.13)]">
          {toast}
        </div>
      )}
    </main>
  );
}
