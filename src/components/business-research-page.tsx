"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Copy, ExternalLink, MapPin } from "lucide-react";
import { ThinkingOrb } from "thinking-orbs";

import { EvidencePanel } from "@/components/evidence-panel";
import { ProspectHeader } from "@/components/prospect-header";
import { cn, scoreTone } from "@/components/ui";
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

function Panel({
  children,
  compact = false,
  className,
}: {
  children: React.ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[28px] border border-[#e4e4de] bg-white shadow-[0_1px_0_rgba(20,20,16,0.04)]",
        compact ? "px-6 py-6" : "px-6 py-7 sm:px-8 sm:py-8",
        className,
      )}
    >
      {children}
    </section>
  );
}

function PanelLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f8f88]">{children}</p>;
}

function PanelHeading({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <PanelLabel>{label}</PanelLabel>
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
            research: {
              engine: "first_party_google_research",
              providers: [],
              queriesPlanned: 0,
              queriesCompleted: 0,
              rawResults: 0,
              uniqueResults: 0,
              pagesSelected: 0,
              pagesRead: 0,
              failures: [],
              cacheHit: false,
            },
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
    if (step === "public_web") return "Searching Google and reading public sources";
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
        <ProspectHeader backHref={`/search?${backQuery}`} backLabel="Back to results" wide />
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
      <ProspectHeader backHref={`/search?${backQuery}`} backLabel="Back to results" wide />

      <div className="mx-auto w-full max-w-[1400px] px-5 pb-24 pt-6 sm:px-8 sm:pt-12">
        {prospect ? (
          <>
            <header className="overflow-hidden rounded-[28px] border border-[#e4e4de] bg-white shadow-[0_1px_0_rgba(20,20,16,0.04)]">
              <div className="grid gap-8 px-6 py-7 sm:px-9 sm:py-9 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="inline-flex h-6 items-center rounded-full bg-[#f1f1ec] px-3 text-[11px] font-semibold tracking-[-0.005em] text-[#55554f]">
                      {prospect.category}
                    </span>
                    <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[#f1f1ec] px-3 text-[11px] font-semibold tabular-nums text-[#55554f]">
                      <MapPin size={11} className="text-[#8a8a84]" />
                      {prospect.distanceMiles.toFixed(2)} mi
                    </span>
                  </div>
                  <h1
                    className={cn(
                      "mt-4 break-words font-semibold leading-[1.04] tracking-[-0.045em] text-balance text-[#141412]",
                      prospect.name.length > 60 ? "text-[30px] sm:text-[38px]" : "text-[34px] sm:text-[46px]",
                    )}
                  >
                    {prospect.name}
                  </h1>
                  <p className="mt-3.5 max-w-[52rem] text-[14px] leading-6 text-pretty text-[#70706a]">
                    {[prospect.address, prospect.phone].filter(Boolean).join(" · ")}
                  </p>
                  {(prospect.website || prospect.directoryUrl) && (
                    <div className="mt-5 flex flex-wrap gap-2">
                      {prospect.website && (
                        <a
                          href={prospect.website}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#e0e0da] px-4 text-[12px] font-semibold text-[#3f3f3a] transition hover:border-[#c9c9c2] hover:bg-[#faf9f6] hover:text-[#171715]"
                        >
                          Website <ExternalLink size={11} />
                        </a>
                      )}
                      {prospect.directoryUrl && (
                        <a
                          href={prospect.directoryUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#e0e0da] px-4 text-[12px] font-semibold text-[#3f3f3a] transition hover:border-[#c9c9c2] hover:bg-[#faf9f6] hover:text-[#171715]"
                        >
                          Source record <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  )}
                </div>

                <div className="w-full rounded-[22px] bg-[#f7f7f3] px-6 py-6 lg:w-[268px]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f8f88]">Initial fit</p>
                  <p className="mt-2.5 text-[46px] font-semibold leading-none tracking-[-0.05em] tabular-nums text-[#141412]">
                    {prospect.score}
                    <span className="ml-1.5 text-[15px] font-medium tracking-[-0.02em] text-[#9a9a93]">/ 100</span>
                  </p>
                  <span className="mt-4 block h-1.5 overflow-hidden rounded-full bg-[#e5e5df]">
                    <span
                      className="fit-bar block h-full rounded-full"
                      style={{ width: `${prospect.score}%`, backgroundColor: scoreTone(prospect.score) }}
                    />
                  </span>
                  {displayedSignal && (
                    <p className={cn("mt-4 text-[12px] font-semibold leading-5", displayedSignal.toneClass)}>
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
                <nav
                  className="scrollbar-none mt-5 flex gap-1 overflow-x-auto rounded-full border border-[#e4e4de] bg-white p-1.5 sm:w-fit"
                  aria-label="Business research sections"
                >
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
                      aria-current={tab === id ? "page" : undefined}
                      className={cn(
                        "h-9 shrink-0 rounded-full px-5 text-[13px] font-semibold tracking-[-0.01em] transition duration-150",
                        tab === id
                          ? "bg-[#171715] text-[#f6f6f1] shadow-[0_6px_18px_rgba(20,20,16,0.18)]"
                          : "text-[#75756f] hover:bg-[#f4f4ef] hover:text-[#22221f]",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </nav>

                {tab === "research" && (
                  <section className="grid gap-4 py-6 xl:grid-cols-[minmax(0,1fr)_370px] xl:items-start">
                    <div className="min-w-0 space-y-4">
                      <Panel>
                        <div className="flex items-center justify-between gap-6">
                          <PanelLabel>Assessment</PanelLabel>
                          <button
                            type="button"
                            onClick={() => void copy(briefToPlainText(brief, prospect, intelligence), "Assessment")}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#e0e0da] px-3.5 text-[11px] font-semibold text-[#5f5f59] transition hover:border-[#c9c9c2] hover:bg-[#faf9f6] hover:text-[#171715]"
                          >
                            <Copy size={11} /> Copy
                          </button>
                        </div>
                        <h2 className="mt-4 text-[32px] font-semibold leading-[1.06] tracking-[-0.045em] text-balance text-[#141412] sm:text-[40px]">
                          {verdict(prospect.score)}
                        </h2>
                        <p className="mt-3 max-w-[46rem] text-[15px] leading-7 text-pretty text-[#6e6e68]">
                          {verdictDetail(prospect.score)}
                        </p>

                        {assessment && (
                          <div className="mt-8 border-t border-[#ecece7] pt-7">
                            <p className="max-w-[46rem] text-[19px] font-medium leading-[1.5] tracking-[-0.022em] text-pretty text-[#1c1c19] sm:text-[21px]">
                              {assessment.lead}
                            </p>
                            {assessment.bodyParagraphs.length > 0 && (
                              <div className="mt-5 max-w-[46rem] space-y-4 text-[15.5px] leading-[1.75] tracking-[-0.012em] text-pretty text-[#5d5d57]">
                                {assessment.bodyParagraphs.map((paragraph, index) => (
                                  <p key={index}>{paragraph}</p>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </Panel>

                      {brief.reflectOn.length > 0 && (
                        <Panel>
                          <PanelHeading label="Reflect on" hint="Before you dial" />
                          <ol className="mt-6 grid gap-x-8 gap-y-5 lg:grid-cols-2">
                            {brief.reflectOn.map((item, index) => (
                              <li key={item} className="flex gap-4">
                                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f1f1ec] text-[11px] font-semibold tabular-nums text-[#75756f]">
                                  {String(index + 1).padStart(2, "0")}
                                </span>
                                <p className="text-[15px] font-medium leading-7 tracking-[-0.015em] text-pretty text-[#33332f]">
                                  {item}
                                </p>
                              </li>
                            ))}
                          </ol>
                        </Panel>
                      )}

                      {brief.talkAbout.length > 0 && (
                        <Panel>
                          <PanelHeading label="Talk about" hint="On the call" />
                          <ul className="mt-2 divide-y divide-[#f0f0eb]">
                            {brief.talkAbout.map((item) => (
                              <li key={item} className="flex gap-3.5 py-3.5">
                                <span aria-hidden className="mt-[11px] h-[5px] w-[5px] shrink-0 rounded-full bg-[#c2c2ba]" />
                                <p className="text-[15px] leading-7 tracking-[-0.012em] text-pretty text-[#33332f]">{item}</p>
                              </li>
                            ))}
                          </ul>
                        </Panel>
                      )}
                    </div>

                    <aside className="space-y-4 xl:sticky xl:top-6">
                      {brief.topOpportunity && (
                        <div className="relative overflow-hidden rounded-[28px] border border-[#dfe3f4] bg-[#f4f6fd] px-6 py-6 sm:px-7">
                          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[#2855e7]" />
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5f6f9e]">Sales angle</p>
                          <p className="mt-3.5 text-[16px] font-medium leading-[1.65] tracking-[-0.015em] text-pretty text-[#22283a]">
                            {brief.topOpportunity}
                          </p>
                        </div>
                      )}

                      {brief.hypothesizedNeeds.length > 0 && (
                        <Panel compact>
                          <PanelLabel>Working hypotheses</PanelLabel>
                          <p className="mt-1.5 text-[12px] text-[#9a9a93]">Test, never assume</p>
                          <ul className="mt-4 flex flex-wrap gap-2">
                            {brief.hypothesizedNeeds.map((need) => (
                              <li
                                key={need}
                                className="rounded-full bg-[#f4f4ef] px-3.5 py-1.5 text-[13px] font-medium tracking-[-0.01em] text-[#4a4a44]"
                              >
                                {need}
                              </li>
                            ))}
                          </ul>
                        </Panel>
                      )}

                      <Panel compact>
                        <PanelLabel>Availability signal</PanelLabel>
                        <p
                          className={cn(
                            "mt-3 text-[17px] font-semibold tracking-[-0.025em]",
                            displayedSignal?.toneClass ?? "text-[#141412]",
                          )}
                        >
                          {displayedSignal?.shortLabel ?? "Not reported"}
                        </p>
                        <p className="mt-2.5 text-[13px] leading-6 text-pretty text-[#77776f]">
                          {displayedSignal?.detail ?? "FCC provider-reported availability for this address."}
                        </p>
                        <button
                          type="button"
                          onClick={() => setTab("availability")}
                          className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-full border border-[#e0e0da] px-4 text-[12px] font-semibold text-[#3f3f3a] transition hover:border-[#c9c9c2] hover:bg-[#faf9f6] hover:text-[#171715]"
                        >
                          See broadband facts <ArrowRight size={12} />
                        </button>
                      </Panel>

                      <p className="px-1 text-[11px] leading-5 text-[#9a9a93]">
                        Availability figures come from public FCC provider filings for this address or area — not a
                        subscription, quote, or serviceability guarantee. Confirm in the official tool before quoting.
                      </p>
                    </aside>
                  </section>
                )}

                {tab === "evidence" && <EvidencePanel intelligence={intelligence} />}

                {tab === "availability" && (
                  <section className="grid gap-4 py-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,560px)] xl:items-start">
                    <Panel className="xl:sticky xl:top-6">
                      <PanelLabel>Availability</PanelLabel>
                      <h2
                        className={cn(
                          "mt-4 text-[32px] font-semibold leading-[1.06] tracking-[-0.045em] text-balance sm:text-[40px]",
                          displayedSignal?.toneClass ?? "text-[#141412]",
                        )}
                      >
                        {displayedSignal?.shortLabel ?? "Checking availability"}
                      </h2>
                      <p className="mt-3 max-w-[40rem] text-[15px] leading-7 text-pretty text-[#6e6e68]">
                        {displayedSignal?.detail ?? "Looking up FCC provider-reported availability for this address."}
                      </p>
                      {fcc?.asOfDate && (
                        <p className="mt-4 inline-flex h-7 items-center rounded-full bg-[#f4f4ef] px-3 text-[11px] font-medium text-[#75756f]">
                          FCC data as of {formatDate(fcc.asOfDate)}
                        </p>
                      )}
                    </Panel>

                    <div className="w-full">
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
                  <section className="grid gap-4 py-6 xl:grid-cols-[minmax(0,1fr)_minmax(400px,440px)] xl:items-start">
                    <Panel>
                      <PanelHeading label="Discovery questions" hint="Ask, then listen" />
                      <ol className="mt-6 divide-y divide-[#f0f0eb]">
                        {brief.discoveryQuestions.map((question, index) => (
                          <li key={question} className="flex gap-4 py-4 first:pt-0">
                            <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f1f1ec] text-[11px] font-semibold tabular-nums text-[#75756f]">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <p className="text-[15px] leading-7 tracking-[-0.012em] text-pretty text-[#33332f]">{question}</p>
                          </li>
                        ))}
                      </ol>
                    </Panel>

                    <div className="space-y-4 xl:sticky xl:top-6">
                      <div className="relative overflow-hidden rounded-[28px] border border-[#dfe3f4] bg-[#f4f6fd] px-6 py-6 sm:px-7">
                        <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-[#2855e7]" />
                        <div className="flex items-center justify-between gap-4">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#5f6f9e]">Call opener</p>
                          <button
                            type="button"
                            onClick={() => void copy(brief.callOpener, "Call opener")}
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#cfd7f0] bg-white/70 px-3.5 text-[11px] font-semibold text-[#41507d] transition hover:border-[#b7c3e8] hover:bg-white hover:text-[#22283a]"
                          >
                            <Copy size={11} /> Copy
                          </button>
                        </div>
                        <p className="mt-4 text-[17px] font-medium leading-[1.6] tracking-[-0.02em] text-pretty text-[#22283a]">
                          “{brief.callOpener}”
                        </p>
                      </div>

                      <Panel compact>
                        <div className="flex items-center justify-between gap-4">
                          <PanelLabel>Follow-up email</PanelLabel>
                          <button
                            type="button"
                            onClick={() =>
                              void copy(
                                `Subject: ${brief.followUpEmail.subject}\n\n${brief.followUpEmail.body}`,
                                "Email draft",
                              )
                            }
                            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#e0e0da] px-3.5 text-[11px] font-semibold text-[#5f5f59] transition hover:border-[#c9c9c2] hover:bg-[#faf9f6] hover:text-[#171715]"
                          >
                            <Copy size={11} /> Copy
                          </button>
                        </div>
                        <div className="mt-4 rounded-[18px] bg-[#f7f7f3] px-4 py-3">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9a93]">Subject</p>
                          <p className="mt-1.5 text-[14px] font-semibold tracking-[-0.015em] text-pretty text-[#22221f]">
                            {brief.followUpEmail.subject}
                          </p>
                        </div>
                        <p className="mt-4 whitespace-pre-line text-[14px] leading-[1.75] text-pretty text-[#555550]">
                          {brief.followUpEmail.body}
                        </p>
                      </Panel>
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
