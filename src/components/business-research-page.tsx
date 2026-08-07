"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Copy, ExternalLink } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";

import { ProspectHeader } from "@/components/prospect-header";
import { cn } from "@/components/ui";
import { classifyServiceability, displayServiceability } from "@/lib/serviceability";
import type {
  AiBriefResult,
  BroadbandObservation,
  FccLookupResponse,
  Prospect,
  RepDisposition,
  ResearchResponse,
  ServiceabilitySignal,
} from "@/lib/types";

type ResearchStep = "business" | "fcc" | "profile" | "complete";
type Tab = "research" | "availability" | "outreach";

const DISPOSITION_STORAGE_KEY = "prospectiq.serviceabilityDisposition";

function readDisposition(prospectId: string): RepDisposition | null {
  try {
    const raw = window.localStorage.getItem(DISPOSITION_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, RepDisposition>;
    return map[prospectId] ?? null;
  } catch {
    return null;
  }
}

function writeDisposition(prospectId: string, value: RepDisposition | null) {
  const raw = window.localStorage.getItem(DISPOSITION_STORAGE_KEY);
  const map = (raw ? JSON.parse(raw) : {}) as Record<string, RepDisposition>;
  if (value) map[prospectId] = value;
  else delete map[prospectId];
  window.localStorage.setItem(DISPOSITION_STORAGE_KEY, JSON.stringify(map));
}

function verdict(score: number) {
  if (score >= 70) return "Prioritize this call";
  if (score >= 55) return "Worth the conversation";
  return "Qualify carefully";
}

function verdictDetail(score: number) {
  if (score >= 70) {
    return "Public signals are strong enough to open with confidence and push for a discovery meeting.";
  }
  if (score >= 55) {
    return "Enough signal to call — lead with their likely connectivity pressure, then confirm what the network has to carry.";
  }
  return "Thin public signal. Keep the first touch short, learn the operation, and use FCC availability as supporting context only.";
}

// `used` is shared across the paragraphs of one assessment so each term is marked once.
function highlightSummary(summary: string, prospect: Prospect, used: Set<string>) {
  const needles = [prospect.name, prospect.category].filter(Boolean);
  const unique = [...new Set(needles.map((item) => item.trim()).filter((item) => item.length > 2))];
  if (!unique.length) return summary;
  unique.sort((a, b) => b.length - a.length);

  const pattern = new RegExp(`(${unique.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = summary.split(pattern);

  return parts.map((part, index) => {
    const term = part.toLowerCase();
    const matched = unique.some((needle) => needle.toLowerCase() === term) && !used.has(term);
    if (!matched) return <span key={`${part}-${index}`}>{part}</span>;
    used.add(term);
    return (
      <mark key={`${part}-${index}`} className="assessment-highlight">
        {part}
      </mark>
    );
  });
}

// A short opening line carries the verdict; the remaining sentences stay together so the
// assessment reads as a brief rather than a stack of disconnected statements.
function splitAssessment(summary: string) {
  const sentences = summary.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) return { lead: summary.trim(), body: "" };

  let lead = sentences[0];
  let next = 1;
  while (lead.length < 40 && next < sentences.length - 1) {
    lead = `${lead} ${sentences[next]}`;
    next += 1;
  }
  return { lead, body: sentences.slice(next).join(" ") };
}

function formatDate(value: string | null) {
  if (!value) return "Unavailable";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export function BusinessResearchPage({ prospectId }: { prospectId: string }) {
  const params = useSearchParams();
  const address = params.get("address") ?? "";
  const radius = Number(params.get("radius") ?? 0.5);
  const backQuery = new URLSearchParams({ address, radius: String(radius) }).toString();
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [brief, setBrief] = useState<AiBriefResult | null>(null);
  const [broadband, setBroadband] = useState<BroadbandObservation[]>([]);
  const [fcc, setFcc] = useState<FccLookupResponse | null>(null);
  const [signal, setSignal] = useState<ServiceabilitySignal | null>(null);
  const [disposition, setDisposition] = useState<RepDisposition | null>(null);
  const [step, setStep] = useState<ResearchStep>("business");
  const [tab, setTab] = useState<Tab>("research");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function researchBusiness() {
      try {
        let selected: Prospect | undefined;
        const stored = window.sessionStorage.getItem("prospectiq.selectedProspect");
        if (stored) {
          const parsed = JSON.parse(stored) as Prospect;
          if (parsed.id === prospectId) selected = parsed;
        }
        if (!selected) {
          const response = await fetch("/api/research", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ address, radiusMiles: radius }),
          });
          const payload = (await response.json()) as ResearchResponse & { error?: string };
          if (!response.ok) throw new Error(payload.error || "Could not reload the business search.");
          selected = payload.prospects.find((item) => item.id === prospectId);
        }
        if (!selected) throw new Error("This business was not found in the current search.");
        if (cancelled) return;
        setProspect(selected);
        setDisposition(readDisposition(selected.id));

        const existingSaved = JSON.parse(window.localStorage.getItem("prospectiq.saved") || "[]") as Prospect[];
        setSaved(existingSaved.some((item) => item.id === selected!.id));
        setStep("fcc");

        let observations: BroadbandObservation[] = [];
        try {
          const fccResponse = await fetch("/api/fcc/availability", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: selected.address !== "Address not listed in OpenStreetMap" && selected.address !== "Address unavailable"
                ? selected.address
                : address,
              coordinates: selected.coordinates,
              businessId: selected.id,
            }),
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
            body: JSON.stringify({ prospect: selected, broadband: observations }),
          });
          const aiPayload = (await aiResponse.json()) as { brief?: AiBriefResult; error?: string };
          if (!aiResponse.ok || !aiPayload.brief) {
            throw new Error(aiPayload.error || "Profile generation did not return a brief.");
          }
          if (!cancelled) setBrief(aiPayload.brief);
        } catch {
          // Fall back to the source-bounded template quietly — never surface env/config errors in the UI.
          if (!cancelled) {
            setBrief({
              summary: selected.summary,
              hypothesizedNeeds: selected.hypothesizedNeeds,
              topOpportunity: selected.topOpportunity,
              discoveryQuestions: selected.discoveryQuestions,
              callOpener: selected.callOpener,
              followUpEmail: selected.followUpEmail,
            });
          }
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
  }, [address, prospectId, radius]);

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

  const assessment = useMemo(() => {
    if (!brief || !prospect) return null;
    const { lead, body } = splitAssessment(brief.summary);
    const used = new Set<string>();
    return {
      lead: highlightSummary(lead, prospect, used),
      body: body ? highlightSummary(body, prospect, used) : null,
    };
  }, [brief, prospect]);

  const displayedSignal = useMemo(() => {
    if (!signal) return null;
    return displayServiceability(signal, disposition);
  }, [signal, disposition]);

  function setRepDisposition(next: RepDisposition | null) {
    if (!prospect) return;
    setDisposition(next);
    writeDisposition(prospect.id, next);
    setToast(next ? "Note saved on this device." : "Note cleared.");
  }

  function toggleSaved() {
    if (!prospect) return;
    const existing = JSON.parse(window.localStorage.getItem("prospectiq.saved") || "[]") as Prospect[];
    const next = saved
      ? existing.filter((item) => item.id !== prospect.id)
      : [prospect, ...existing.filter((item) => item.id !== prospect.id)];
    window.localStorage.setItem("prospectiq.saved", JSON.stringify(next));
    setSaved(!saved);
    setToast(saved ? "Removed from saved businesses." : "Business saved.");
  }

  async function copy(value: string, label: string) {
    await navigator.clipboard.writeText(value);
    setToast(`${label} copied.`);
  }

  if (error || (step === "complete" && !prospect)) {
    return (
      <main className="min-h-screen bg-[#f5f5f2]">
        <ProspectHeader backHref={`/search?${backQuery}`} backLabel="Back to results" />
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
      <ProspectHeader backHref={`/search?${backQuery}`} backLabel="Back to results" />

      <div className="mx-auto w-full max-w-[940px] px-5 pb-24 pt-6 sm:px-8 sm:pt-12">
        {prospect ? (
          <>
            <header className="border-b border-[#dcdcd7] pb-8 sm:pb-10">
              <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">{prospect.category}</p>
                  <h1 className="mt-3 text-[38px] font-semibold leading-[1.05] tracking-[-0.05em] text-[#141412] sm:text-[56px]">
                    {prospect.name}
                  </h1>
                  <p className="mt-4 max-w-[680px] text-sm leading-6 text-[#70706a]">
                    {prospect.address} · {prospect.distanceMiles.toFixed(2)} miles from the search address
                  </p>
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-[11px] font-medium text-[#65655f]">
                    {prospect.website && (
                      <a href={prospect.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-[#171715]">
                        Website <ExternalLink size={11} />
                      </a>
                    )}
                    {prospect.directoryUrl && (
                      <a href={prospect.directoryUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-[#171715]">
                        Source record <ExternalLink size={11} />
                      </a>
                    )}
                    {prospect.phone && <span>{prospect.phone}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <div className="text-right">
                    <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[#969690]">Initial fit</p>
                    <p className="mt-1 text-2xl font-semibold tabular-nums text-[#20201d]">
                      {prospect.score}
                      <span className="ml-1 text-xs font-medium text-[#85857f]">/ 100</span>
                    </p>
                    {displayedSignal && (
                      <p className={cn("mt-2 text-[11px] font-semibold", displayedSignal.toneClass)}>
                        {displayedSignal.shortLabel}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={toggleSaved}
                    className={cn(
                      "h-10 rounded-full px-4 text-xs font-semibold transition",
                      saved ? "bg-[#171715] text-white" : "border border-[#d2d2cd] bg-white text-[#373733] hover:border-[#aaa9a3]",
                    )}
                  >
                    {saved ? "Saved" : "Save business"}
                  </button>
                </div>
              </div>
            </header>

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
                    <div className="max-w-[760px]">
                      <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">Assessment</p>
                      <h2 className="mt-4 max-w-[16ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.05em] text-[#141412] sm:text-[52px]">
                        {verdict(prospect.score)}
                      </h2>
                      <p className="mt-4 max-w-[36rem] text-[15px] leading-7 text-[#6e6e68]">{verdictDetail(prospect.score)}</p>

                      {assessment && (
                        <div className="mt-10 max-w-[40rem]">
                          <p className="text-[19px] font-medium leading-8 tracking-[-0.022em] text-[#1c1c19]">
                            {assessment.lead}
                          </p>
                          {assessment.body && (
                            <p className="mt-4 text-[16px] leading-8 tracking-[-0.012em] text-[#5d5d57]">
                              {assessment.body}
                            </p>
                          )}
                        </div>
                      )}

                      {brief.topOpportunity && (
                        <div className="mt-10 max-w-[40rem] border-l-2 border-[#1d1d1a] pl-5">
                          <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">Sales angle</p>
                          <p className="mt-2.5 text-[16px] font-medium leading-7 tracking-[-0.015em] text-[#1f1f1c]">
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
                        {displayedSignal?.shortLabel ?? "Checking availability"}
                      </h2>
                      <p className="mt-4 max-w-[36rem] text-[15px] leading-7 text-[#6e6e68]">
                        {displayedSignal?.detail ?? "Looking up FCC provider-reported availability for this address."}
                      </p>
                      {fcc?.asOfDate && (
                        <p className="mt-3 text-xs text-[#85857f]">FCC data as of {formatDate(fcc.asOfDate)}</p>
                      )}

                      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-semibold">
                        <button
                          type="button"
                          onClick={() => setRepDisposition(disposition === "customer" ? null : "customer")}
                          className={cn(
                            "transition",
                            disposition === "customer" ? "text-[#17653f]" : "text-[#8a8a84] hover:text-[#171715]",
                          )}
                        >
                          Mark active
                        </button>
                        <button
                          type="button"
                          onClick={() => setRepDisposition(disposition === "do_not_contact" ? null : "do_not_contact")}
                          className={cn(
                            "transition",
                            disposition === "do_not_contact" ? "text-[#a63a31]" : "text-[#8a8a84] hover:text-[#171715]",
                          )}
                        >
                          Do not touch
                        </button>
                        {disposition && (
                          <button
                            type="button"
                            onClick={() => setRepDisposition(null)}
                            className="text-[#8a8a84] transition hover:text-[#171715]"
                          >
                            Clear note
                          </button>
                        )}
                      </div>

                      <p className="mt-8 max-w-[40rem] text-xs leading-5 text-[#85857f]">
                        FCC filings only — not Spectrum’s serviceability tool, not a subscription claim, and not an orderability
                        guarantee. Confirm in the official tool before quoting. This product uses the FCC Data API but is not
                        endorsed or certified by the FCC.
                      </p>
                    </div>

                    <div className="mt-12">
                      <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">Providers on file</p>
                      <h3 className="mt-2 text-xl font-semibold tracking-[-0.03em] text-[#1a1a17]">
                        {fcc?.matchQuality === "exact" || fcc?.matchedLocationId
                          ? "Reported at this location"
                          : "Reported for this area"}
                      </h3>
                    </div>

                    {broadband.length > 0 && fcc?.message && (
                      <p className="mt-3 max-w-[760px] text-xs leading-5 text-[#85857f]">{fcc.message}</p>
                    )}

                    {broadband.length ? (
                      <div className="mt-6 space-y-0 border-t border-[#e6e6e1]">
                        {broadband.map((item) => (
                          <div
                            key={item.id}
                            className="grid gap-4 border-b border-[#e6e6e1] py-5 sm:grid-cols-[minmax(0,1.4fr)_1fr_1fr] sm:items-start"
                          >
                            <div>
                              <p className="text-[15px] font-semibold text-[#252522]">{item.provider}</p>
                              <p className="mt-1 text-[12px] text-[#85857f]">
                                {item.technology}
                                {item.classification ? ` · ${item.classification}` : ""}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-[#999992]">Download</p>
                              <p className="mt-1 text-sm font-semibold tabular-nums text-[#292926]">
                                {item.downloadMbps != null ? `${item.downloadMbps.toLocaleString()} Mbps` : "—"}
                              </p>
                            </div>
                            <div>
                              <p className="text-[11px] text-[#999992]">Upload</p>
                              <p className="mt-1 text-sm font-semibold tabular-nums text-[#292926]">
                                {item.uploadMbps != null ? `${item.uploadMbps.toLocaleString()} Mbps` : "—"}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-6 max-w-[720px]">
                        <p className="text-sm font-semibold text-[#2d2d29]">No FCC provider records were returned.</p>
                        <p className="mt-2 text-sm leading-6 text-[#777771]">
                          {fcc?.message ?? "The FCC lookup did not return availability for this location."}
                        </p>
                        <a
                          href={fcc?.sourceUrl || "https://broadbandmap.fcc.gov/home"}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-[#2855e7]"
                        >
                          Open the official FCC map <ExternalLink size={11} />
                        </a>
                      </div>
                    )}
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
