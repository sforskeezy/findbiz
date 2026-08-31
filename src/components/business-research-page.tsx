"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Copy, ExternalLink } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";

import { ProspectHeader } from "@/components/prospect-header";
import { cn } from "@/components/ui";
import { buildFallbackBrief } from "@/lib/brief-fallback";
import { classifyServiceability, displayServiceability, isCharterSpectrumProvider } from "@/lib/serviceability";
import type {
  AiBriefResult,
  BroadbandObservation,
  CompanyIntelligence,
  FccLookupResponse,
  Prospect,
  ResearchResponse,
  ServiceabilitySignal,
} from "@/lib/types";

type ResearchStep = "business" | "public_web" | "profile" | "complete";
type Tab = "research" | "evidence" | "availability" | "outreach";

const MISSING_ADDRESS = new Set([
  "Address not listed in public data",
  "Address not listed in OpenStreetMap",
  "Address unavailable",
]);

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
  // Longer Opus assessments get a two-sentence lead when the opener is short.
  while ((lead.length < 70 || next < 2) && next < Math.min(3, sentences.length - 1)) {
    lead = `${lead} ${sentences[next]}`;
    next += 1;
  }
  return { lead, body: sentences.slice(next).join(" ") };
}

function SectionHeading({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[#dedad3] pb-3">
      <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">{label}</p>
      <p className="text-[11px] font-medium tracking-[-0.005em] text-[#a1a19a]">{hint}</p>
    </div>
  );
}

function briefToPlainText(
  brief: AiBriefResult,
  prospect: Prospect,
  intelligence: CompanyIntelligence | null,
) {
  return [
    `${prospect.name} — ${prospect.category}`,
    prospect.address,
    "",
    brief.summary,
    ...(intelligence?.facts.length
      ? [
          "",
          "Public evidence",
          ...intelligence.facts.map(
            (fact) => `- ${fact.label}: ${fact.value} (${fact.sourceUrl})`,
          ),
        ]
      : []),
    "",
    "Reflect on",
    ...brief.reflectOn.map((item, index) => `${index + 1}. ${item}`),
    "",
    "Talk about",
    ...brief.talkAbout.map((item) => `- ${item}`),
    "",
    "Working hypotheses",
    ...brief.hypothesizedNeeds.map((item) => `- ${item}`),
    "",
    "Sales angle",
    brief.topOpportunity,
  ].join("\n");
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
  const [intelligence, setIntelligence] = useState<CompanyIntelligence | null>(null);
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
        setStep("public_web");

        let observations: BroadbandObservation[] = [];
        let companyIntelligence: CompanyIntelligence | null = null;
        const [fccResult, intelligenceResult] = await Promise.allSettled([
          fetch("/api/fcc/availability", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              address: MISSING_ADDRESS.has(selected.address) ? address : selected.address,
              coordinates: selected.coordinates,
              businessId: selected.id,
            }),
          }).then(async (response) => ({ response, payload: (await response.json()) as FccLookupResponse })),
          fetch("/api/company-intelligence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prospect: selected }),
          }).then(async (response) => ({
            response,
            payload: (await response.json()) as { intelligence?: CompanyIntelligence; error?: string },
          })),
        ]);

        if (fccResult.status === "fulfilled") {
          const { response: fccResponse, payload: fccPayload } = fccResult.value;
          const nextSignal = fccPayload.serviceability ?? classifyServiceability(fccPayload);
          if (!cancelled) {
            setFcc(fccPayload);
            setSignal(nextSignal);
          }
          if (fccResponse.ok && fccPayload.status === "available") observations = fccPayload.observations;
        } else {
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

        if (
          intelligenceResult.status === "fulfilled" &&
          intelligenceResult.value.response.ok &&
          intelligenceResult.value.payload.intelligence
        ) {
          companyIntelligence = intelligenceResult.value.payload.intelligence;
          if (!cancelled) setIntelligence(companyIntelligence);
        } else {
          const message =
            intelligenceResult.status === "fulfilled"
              ? intelligenceResult.value.payload.error || "Public web research did not complete."
              : "Public web research did not complete.";
          companyIntelligence = {
            status: "unavailable",
            summary: null,
            facts: [],
            searchResults: [],
            sources: [],
            pagesScanned: 0,
            retrievedAt: new Date().toISOString(),
            warnings: [message],
          };
          if (!cancelled) setIntelligence(companyIntelligence);
        }

        if (cancelled) return;
        const researchedPhone = companyIntelligence?.facts.find((fact) => fact.kind === "phone")?.value;
        const researchedProspect: Prospect = {
          ...selected,
          phone: selected.phone || researchedPhone || null,
          publicNotes: selected.publicNotes || companyIntelligence?.summary || null,
        };
        setProspect(researchedProspect);
        setBroadband(observations);
        setStep("profile");

        try {
          const aiResponse = await fetch("/api/brief", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prospect: researchedProspect,
              broadband: observations,
              intelligence: companyIntelligence,
            }),
          });
          const aiPayload = (await aiResponse.json()) as { brief?: AiBriefResult; error?: string };
          if (!aiResponse.ok || !aiPayload.brief) {
            throw new Error(aiPayload.error || "Profile generation did not return a brief.");
          }
          if (!cancelled) setBrief(aiPayload.brief);
        } catch {
          // Fall back to the source-bounded template quietly — never surface env/config errors in the UI.
          if (!cancelled) setBrief(buildFallbackBrief(researchedProspect, observations));
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
    if (step === "public_web") return "Reading the company website and public sources";
    if (step === "profile") return "Building a profile on this business";
    return "Building a profile on this business";
  }, [step]);

  const assessment = useMemo(() => {
    if (!brief || !prospect) return null;
    const { lead, body } = splitAssessment(brief.summary);
    const used = new Set<string>();
    const bodyParagraphs = body
      ? body
          .split(/(?<=[.!?])\s+/)
          .reduce<string[][]>((groups, sentence, index) => {
            if (index % 2 === 0) groups.push([sentence]);
            else groups[groups.length - 1]?.push(sentence);
            return groups;
          }, [])
          .map((group) => group.join(" "))
      : [];
    return {
      lead: highlightSummary(lead, prospect, used),
      bodyParagraphs: bodyParagraphs.map((paragraph) => highlightSummary(paragraph, prospect, used)),
    };
  }, [brief, prospect]);

  const displayedSignal = useMemo(() => {
    if (!signal) return null;
    // Status is derived from FCC filings automatically — no manual rep notes.
    return displayServiceability(signal, null);
  }, [signal]);

  const providerChart = useMemo(() => {
    return [...broadband].sort((a, b) => (b.downloadMbps ?? 0) - (a.downloadMbps ?? 0));
  }, [broadband]);

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
                  <h1
                    className={cn(
                      "mt-3 break-words font-semibold leading-[1.05] tracking-[-0.05em] text-[#141412]",
                      prospect.name.length > 80 ? "text-[30px] sm:text-[42px]" : "text-[38px] sm:text-[56px]",
                    )}
                  >
                    {prospect.name}
                  </h1>
                  <p className="mt-4 max-w-[680px] text-sm leading-6 text-[#70706a]">
                    {[
                      prospect.address,
                      `${prospect.distanceMiles.toFixed(2)} miles from the search address`,
                      prospect.phone,
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
                    {prospect.directoryUrl && (
                      <a href={prospect.directoryUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-[#171715]">
                        Source record <ExternalLink size={11} />
                      </a>
                    )}
                  </div>
                </div>
                <div className="shrink-0 text-right">
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
                <nav className="scrollbar-none flex gap-7 overflow-x-auto border-b border-[#dcdcd7] pt-7" aria-label="Business research sections">
                  {(
                    [
                      ["research", "Research"],
                      ["evidence", "Evidence"],
                      ["availability", "Availability"],
                      ["outreach", "Outreach"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={cn(
                        "shrink-0 border-b-2 pb-3 text-xs font-semibold transition",
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
                      <div className="flex items-start justify-between gap-6">
                        <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">Assessment</p>
                        <button
                          type="button"
                          onClick={() => void copy(briefToPlainText(brief, prospect, intelligence), "Assessment")}
                          className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#666660] transition hover:text-[#171715]"
                        >
                          <Copy size={11} /> Copy assessment
                        </button>
                      </div>
                      <h2 className="mt-4 max-w-[16ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.05em] text-[#141412] sm:text-[52px]">
                        {verdict(prospect.score)}
                      </h2>
                      <p className="mt-4 max-w-[36rem] text-[15px] leading-7 text-[#6e6e68]">{verdictDetail(prospect.score)}</p>

                      {assessment && (
                        <div className="mt-10 max-w-[42rem]">
                          <p className="text-[20px] font-medium leading-[1.45] tracking-[-0.022em] text-[#1c1c19] sm:text-[22px] sm:leading-[1.4]">
                            {assessment.lead}
                          </p>
                          {assessment.bodyParagraphs.length > 0 && (
                            <div className="mt-5 space-y-4 text-[16px] leading-8 tracking-[-0.012em] text-[#5d5d57]">
                              {assessment.bodyParagraphs.map((paragraph, index) => (
                                <p key={index}>{paragraph}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {brief.reflectOn.length > 0 && (
                        <div className="mt-14 max-w-[42rem]">
                          <SectionHeading label="Reflect on" hint="Before you dial" />
                          <ol className="mt-6 space-y-5">
                            {brief.reflectOn.map((item, index) => (
                              <li key={item} className="flex gap-5">
                                <span className="w-7 shrink-0 border-t border-[#c9c9c2] pt-2 text-[11px] font-semibold tabular-nums text-[#a4a49d]">
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <p className="text-[16px] font-medium leading-7 tracking-[-0.015em] text-[#252522]">
                                  {item}
                                </p>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {brief.talkAbout.length > 0 && (
                        <div className="mt-14 max-w-[42rem]">
                          <SectionHeading label="Talk about" hint="On the call" />
                          <ul className="mt-2 divide-y divide-[#e6e6e1]">
                            {brief.talkAbout.map((item) => (
                              <li key={item} className="flex gap-3.5 py-4">
                                <span aria-hidden className="mt-[11px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#b6b6ae]" />
                                <p className="text-[15px] leading-7 tracking-[-0.012em] text-[#33332f]">{item}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {brief.hypothesizedNeeds.length > 0 && (
                        <div className="mt-14 max-w-[42rem]">
                          <SectionHeading label="Working hypotheses" hint="Test, never assume" />
                          <ul className="mt-5 flex flex-wrap gap-2">
                            {brief.hypothesizedNeeds.map((need) => (
                              <li
                                key={need}
                                className="rounded-full border border-[#dcdcd5] bg-white px-3.5 py-1.5 text-[13px] font-medium tracking-[-0.01em] text-[#4a4a44]"
                              >
                                {need}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {brief.topOpportunity && (
                        <div className="mt-14 max-w-[42rem] rounded-2xl bg-[#171715] px-7 py-7 shadow-[0_18px_50px_rgba(20,20,16,0.16)]">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8f8f86]">Sales angle</p>
                          <p className="mt-3.5 text-[17px] font-medium leading-[1.65] tracking-[-0.015em] text-[#f3f3ed]">
                            {brief.topOpportunity}
                          </p>
                        </div>
                      )}

                      <p className="mt-6 max-w-[42rem] text-[11px] leading-5 text-[#9a9a93]">
                        Availability figures come from public FCC provider filings for this address or area — not a
                        subscription, quote, or serviceability guarantee. Confirm in the official tool before quoting.
                      </p>
                    </div>
                  </section>
                )}

                {tab === "evidence" && (
                  <section className="py-10">
                    <div className="max-w-[760px]">
                      <p className="text-[13px] font-medium tracking-[-0.01em] text-[#777771]">Evidence ledger</p>
                      <h2 className="mt-4 max-w-[17ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.05em] text-[#141412] sm:text-[52px]">
                        Facts you can trace.
                      </h2>
                      <p className="mt-4 max-w-[38rem] text-[15px] leading-7 text-[#6e6e68]">
                        Public facts stay attached to the page that published them. Estimated search-result matches are
                        labeled separately, and missing values stay missing.
                      </p>

                      <dl className="mt-10 grid grid-cols-3 border-y border-[#dcdcd7] py-5">
                        <div>
                          <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9a93]">Pages read</dt>
                          <dd className="mt-2 text-2xl font-semibold tabular-nums text-[#1d1d1a]">{intelligence?.pagesScanned ?? 0}</dd>
                        </div>
                        <div className="border-l border-[#deded8] pl-5">
                          <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9a93]">Public facts</dt>
                          <dd className="mt-2 text-2xl font-semibold tabular-nums text-[#1d1d1a]">{intelligence?.facts.length ?? 0}</dd>
                        </div>
                        <div className="border-l border-[#deded8] pl-5">
                          <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9a93]">Indexed results</dt>
                          <dd className="mt-2 text-2xl font-semibold tabular-nums text-[#1d1d1a]">{intelligence?.searchResults.length ?? 0}</dd>
                        </div>
                      </dl>

                      {intelligence?.summary && (
                        <div className="mt-12 max-w-[42rem]">
                          <SectionHeading label="How the company describes itself" hint="Official website" />
                          <p className="mt-5 text-[17px] leading-8 tracking-[-0.015em] text-[#33332f]">
                            {intelligence.summary}
                          </p>
                        </div>
                      )}

                      {intelligence?.facts.length ? (
                        <div className="mt-12 max-w-[46rem]">
                          <SectionHeading label="Published facts" hint="Click through to verify" />
                          <ul className="mt-2 divide-y divide-[#e3e3de]">
                            {intelligence.facts.map((fact) => (
                              <li key={fact.id} className="grid gap-2 py-4 sm:grid-cols-[170px_1fr_auto] sm:items-start sm:gap-5">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#96968f]">{fact.label}</p>
                                <p className="break-words text-[14px] font-medium leading-6 text-[#282825]">{fact.value}</p>
                                <a
                                  href={fact.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#6e6e68] transition hover:text-[#171715]"
                                >
                                  {fact.confidence} <ExternalLink size={10} />
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <div className="mt-12 max-w-[42rem] rounded-2xl border border-[#deded8] bg-white/60 px-6 py-6">
                          <p className="text-[15px] font-semibold text-[#292926]">No additional public facts found.</p>
                          <p className="mt-2 text-[13px] leading-6 text-[#777771]">
                            The report kept the directory record as-is instead of filling gaps with guesses.
                          </p>
                        </div>
                      )}

                      {intelligence?.searchResults.length ? (
                        <div className="mt-12 max-w-[46rem]">
                          <SectionHeading label="Indexed web results" hint="Google Programmable Search" />
                          <ul className="mt-2 divide-y divide-[#e3e3de]">
                            {intelligence.searchResults.map((result) => (
                              <li key={result.id} className="py-5">
                                <a
                                  href={result.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 text-[15px] font-semibold tracking-[-0.015em] text-[#242421] hover:underline"
                                >
                                  {result.title} <ExternalLink size={11} />
                                </a>
                                {result.snippet && <p className="mt-2 text-[13px] leading-6 text-[#73736d]">{result.snippet}</p>}
                                <p className="mt-2 truncate text-[10px] text-[#a0a099]">{result.url}</p>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      {intelligence?.warnings.length ? (
                        <div className="mt-12 max-w-[42rem] border-l-2 border-[#d1d1ca] pl-5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#92928b]">Research notes</p>
                          <ul className="mt-3 space-y-2">
                            {intelligence.warnings.map((warning) => (
                              <li key={warning} className="text-[12px] leading-5 text-[#777771]">{warning}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
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
                    </div>

                    <div className="mt-14 w-full max-w-[640px]">
                      {providerChart.length ? (
                        <div className="border-[3px] border-black bg-white text-black shadow-[6px_6px_0_#171715]">
                          <div className="border-b-[8px] border-black px-3.5 pb-2.5 pt-3">
                            <p className="text-[34px] font-black leading-none tracking-[-0.04em] sm:text-[40px]">
                              Broadband Facts
                            </p>
                            <p className="mt-1.5 text-[12px] font-bold leading-snug">
                              {fcc?.matchQuality === "exact" || fcc?.matchedLocationId
                                ? "Provider-reported speeds at this location"
                                : "Provider-reported speeds for this area"}
                            </p>
                          </div>

                          <div className="border-b-4 border-black px-3.5 py-2">
                            <div className="flex items-end justify-between gap-3">
                              <p className="text-[11px] font-bold uppercase tracking-[0.04em]">
                                Serving this census block
                              </p>
                              <p className="text-[13px] font-black tabular-nums">
                                {providerChart.length}{" "}
                                <span className="text-[11px] font-bold">
                                  {providerChart.length === 1 ? "provider" : "providers"}
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
                              const isSpectrum = isCharterSpectrumProvider(item.provider);
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
                                          Spectrum / Charter match
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
                                      <span className="font-semibold">Typical download speed</span>
                                      <span className="font-black tabular-nums">
                                        {item.downloadMbps != null
                                          ? `${item.downloadMbps.toLocaleString()} Mbps`
                                          : "—"}
                                      </span>
                                    </div>
                                    <div className="flex items-baseline justify-between gap-3 border-t border-dotted border-black/35 pt-1">
                                      <span className="font-semibold">Typical upload speed</span>
                                      <span className="font-black tabular-nums">
                                        {item.uploadMbps != null
                                          ? `${item.uploadMbps.toLocaleString()} Mbps`
                                          : "—"}
                                      </span>
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>

                          <div className="border-t-4 border-black px-3.5 py-2.5">
                            <p className="text-[10px] font-medium leading-4">
                              Speeds shown are FCC provider filings for the matched area — not a quote,
                              subscription claim, or orderability guarantee.
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
                            <p className="text-sm font-black">No FCC provider records were returned.</p>
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
