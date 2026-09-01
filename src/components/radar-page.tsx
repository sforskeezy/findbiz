"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BorderBeam } from "border-beam";
import { ChevronDown, Map as MapIcon } from "lucide-react";

import { ProspectHeader } from "@/components/prospect-header";
import { RadarMap } from "@/components/radar-map";
import { RadarScanProgress } from "@/components/radar-scan-progress";
import { RadarSignalCard } from "@/components/radar-signal-card";
import { cn } from "@/components/ui";
import { FILTERABLE_SIGNAL_TYPES, isProspectSignal, SEVERITY_COPY, SIGNAL_LABELS } from "@/lib/radar/catalog";
import { worthContacting } from "@/lib/radar/score";
import { PLACE_CATEGORIES } from "@/lib/place-candidate";
import type {
  RadarScanEvent,
  RadarScanResult,
  RadarScanStage,
  RadarSignal,
  RadarSignalAction,
  RadarTerritory,
  SignalSeverity,
  SignalType,
} from "@/lib/radar/types";
import { RADAR_RADII } from "@/lib/radar/types";

type Filters = {
  signalType: SignalType | "all";
  severity: SignalSeverity | "all";
  industry: string | "all";
  newSinceLastScan: boolean;
  saved: "all" | "saved" | "unsaved";
  hasContact: boolean;
  hasWebsite: boolean;
  worthContacting: boolean;
  showDismissed: boolean;
};

const emptyFilters: Filters = {
  signalType: "all",
  severity: "all",
  industry: "all",
  newSinceLastScan: false,
  saved: "all",
  hasContact: false,
  hasWebsite: false,
  worthContacting: false,
  showDismissed: false,
};

async function readScanStream(
  response: Response,
  onEvent: (event: RadarScanEvent) => void,
) {
  if (!response.body) throw new Error("Radar did not return a live scan stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";
    for (const chunk of chunks) {
      const line = chunk.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      onEvent(JSON.parse(line.slice(6)) as RadarScanEvent);
    }
  }
}

function filterSignals(signals: RadarSignal[], filters: Filters) {
  return signals.filter((signal) => {
    if (!isProspectSignal(signal.type)) return false;
    if (!filters.showDismissed && signal.dismissed) return false;
    if (filters.signalType !== "all" && signal.type !== filters.signalType) return false;
    if (filters.severity !== "all" && signal.severity !== filters.severity) return false;
    if (filters.industry !== "all" && signal.observation.category !== filters.industry) return false;
    if (filters.newSinceLastScan && !signal.newSinceLastScan) return false;
    if (filters.saved === "saved" && !signal.saved) return false;
    if (filters.saved === "unsaved" && signal.saved) return false;
    if (filters.hasContact && !signal.observation.phone) return false;
    if (filters.hasWebsite && !signal.observation.website) return false;
    if (
      filters.worthContacting &&
      !worthContacting({
        severity: signal.severity,
        score: signal.score.total,
        hasPhone: Boolean(signal.observation.phone),
        hasWebsite: Boolean(signal.observation.website),
        dismissed: signal.dismissed,
      })
    ) {
      return false;
    }
    return true;
  });
}

export function RadarPage() {
  const router = useRouter();
  const [locationQuery, setLocationQuery] = useState("");
  const [radius, setRadius] = useState("5");
  const [category, setCategory] = useState("All");
  const [focused, setFocused] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [stage, setStage] = useState<RadarScanStage>("scanning");
  const [error, setError] = useState("");
  const [result, setResult] = useState<RadarScanResult | null>(null);
  const [territories, setTerritories] = useState<RadarTerritory[]>([]);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadTerritories() {
      try {
        const response = await fetch("/api/radar/territories");
        const payload = (await response.json()) as { territories?: RadarTerritory[] };
        if (!cancelled && payload.territories?.length) {
          setTerritories(payload.territories);
          const latest = payload.territories[0];
          setLocationQuery(latest.locationQuery);
          setRadius(String(latest.radiusMiles));
          if (latest.categoryFilter) setCategory(latest.categoryFilter);
          const latestScan = await fetch(`/api/radar/territories?territoryId=${encodeURIComponent(latest.id)}`);
          const scanPayload = (await latestScan.json()) as { scan?: RadarScanResult };
          if (!cancelled && scanPayload.scan) setResult(scanPayload.scan);
        }
      } catch {
        // First visit has no stored territories.
      }
    }
    void loadTerritories();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(() => (result ? filterSignals(result.signals, filters) : []), [result, filters]);
  const hotVisible = visible.filter((item) => item.severity === "hot");

  async function scanTerritory(event: React.FormEvent) {
    event.preventDefault();
    if (locationQuery.trim().length < 3) {
      setError("Enter a city, ZIP, address, or saved territory.");
      return;
    }
    setError("");
    setScanning(true);
    setStage("scanning");
    setSelectedId(null);
    try {
      const response = await fetch("/api/radar/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationQuery: locationQuery.trim(),
          radiusMiles: Number(radius),
          categoryFilter: category === "All" ? null : category,
        }),
      });
      if (!response.ok && response.headers.get("content-type")?.includes("application/json")) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "Radar scan failed.");
      }
      let completed: RadarScanResult | null = null;
      await readScanStream(response, (event) => {
        if (event.type === "stage") setStage(event.stage);
        if (event.type === "error") throw new Error(event.error);
        if (event.type === "complete") completed = event.result;
      });
      if (!completed) throw new Error("Radar scan ended before results were returned.");
      setResult(completed);
      setTerritories((current) => {
        const next = [completed!.territory, ...current.filter((item) => item.id !== completed!.territory.id)];
        return next.slice(0, 12);
      });
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Radar scan failed.");
    } finally {
      setScanning(false);
    }
  }

  function openResearch(signal: RadarSignal) {
    window.sessionStorage.setItem("prospectiq.selectedProspect", JSON.stringify(signal.prospect));
    const query = new URLSearchParams({
      address: result?.territory.formattedAddress || locationQuery,
      radius: String(Math.min(5, result?.territory.radiusMiles ?? Number(radius))),
    });
    router.push(`/business/${encodeURIComponent(signal.prospect.id)}?${query.toString()}`);
  }

  async function act(signal: RadarSignal, action: RadarSignalAction) {
    if (!result) return;
    setResult({
      ...result,
      signals: result.signals.map((item) =>
        item.id === signal.id
          ? {
              ...item,
              saved: action === "save" ? true : action === "unsave" ? false : item.saved,
              dismissed: action === "dismiss" ? true : action === "restore" ? false : item.dismissed,
              contacted: action === "contacted" ? true : action === "uncontacted" ? false : item.contacted,
            }
          : item,
      ),
    });
    try {
      await fetch("/api/radar/signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scanId: result.id, signalId: signal.id, action }),
      });
    } catch {
      // Keep the optimistic local state; the next scan reloads from disk.
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f4f4f1]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="ambient-orb absolute -left-[12%] top-[6%] h-[520px] w-[520px] rounded-full bg-[#d8dcea]/55 blur-[130px]" />
        <div className="ambient-orb-delayed absolute -right-[12%] bottom-[0%] h-[560px] w-[560px] rounded-full bg-white/85 blur-[110px]" />
      </div>
      <ProspectHeader />

      {scanning ? (
        <RadarScanProgress stage={stage} />
      ) : (
        <div className="relative z-10 mx-auto w-full max-w-[1040px] px-5 pb-24 pt-4 sm:px-8 sm:pt-8">
          <p className="text-[13px] font-medium tracking-[0.16em] text-[#6f6f69]">RADAR</p>
          <h1 className="mt-3 max-w-[760px] text-[40px] font-semibold leading-[1.04] tracking-[-0.055em] text-[#11110f] sm:text-[58px]">
            See what changed in your territory.
          </h1>
          <p className="mt-4 max-w-[560px] text-sm leading-6 text-[#6e6e68] sm:text-[15px]">
            Scan a city, ZIP, address, or saved territory. Radar looks for openings, moves, expansions, and other public change — not who is hiring.
          </p>

          <form onSubmit={(event) => void scanTerritory(event)} className="mt-8">
            <BorderBeam
              size="md"
              colorVariant="ocean"
              theme="light"
              active={focused || Boolean(locationQuery)}
              duration={2.4}
              brightness={1.05}
              strength={focused ? 1 : 0.7}
              borderRadius={24}
              className="w-full"
            >
              <div className="rounded-[24px] border border-white/80 bg-white/80 p-2.5 shadow-[0_24px_80px_rgba(25,25,20,0.08)] backdrop-blur-2xl">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
                  <label className="flex h-12 min-w-0 flex-1 items-center px-4">
                    <span className="sr-only">Location or territory</span>
                    <input
                      value={locationQuery}
                      onChange={(event) => setLocationQuery(event.target.value)}
                      onFocus={() => setFocused(true)}
                      onBlur={() => setFocused(false)}
                      list="radar-territories"
                      className="h-full min-w-0 flex-1 bg-transparent text-sm font-medium text-[#1c1c19] outline-none placeholder:font-normal placeholder:text-[#999992]"
                      placeholder="City, ZIP, address, or saved territory"
                    />
                  </label>
                  <datalist id="radar-territories">
                    {territories.map((item) => (
                      <option key={item.id} value={item.locationQuery}>
                        {item.label} · {item.radiusMiles} mi
                      </option>
                    ))}
                  </datalist>
                  <div className="flex flex-wrap gap-2 lg:flex-nowrap">
                    <label className="relative flex h-11 min-w-[108px] flex-1 items-center lg:flex-none">
                      <span className="sr-only">Radius</span>
                      <select
                        value={radius}
                        onChange={(event) => setRadius(event.target.value)}
                        className="h-full w-full appearance-none rounded-full border border-[#e4e4df] bg-[#f7f7f4] pl-4 pr-8 text-xs font-semibold text-[#252522] outline-none"
                      >
                        {RADAR_RADII.map((item) => (
                          <option key={item} value={item}>
                            {item} mi
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#8a8a84]" />
                    </label>
                    <label className="relative flex h-11 min-w-[150px] flex-1 items-center lg:w-[170px] lg:flex-none">
                      <span className="sr-only">Business filter</span>
                      <select
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                        className="h-full w-full appearance-none rounded-full border border-[#e4e4df] bg-[#f7f7f4] pl-4 pr-8 text-xs font-semibold text-[#252522] outline-none"
                      >
                        <option>All</option>
                        {PLACE_CATEGORIES.map((item) => (
                          <option key={item}>{item}</option>
                        ))}
                      </select>
                      <ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#8a8a84]" />
                    </label>
                    <button type="submit" className="h-11 flex-1 rounded-full bg-[#151513] px-5 text-xs font-semibold text-white hover:bg-black lg:flex-none">
                      Scan territory
                    </button>
                  </div>
                </div>
              </div>
            </BorderBeam>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-xs font-medium text-[#a63a31]">
              {error}
            </p>
          )}

          {!result && (
            <section className="mt-16 max-w-[560px]">
              <p className="text-[13px] leading-7 text-[#7a7a74]">
                Radar remembers each territory. The first scan builds a baseline. Every scan after that answers a sharper question: what changed, and who is newly worth contacting. Hiring, job posts, and low-review guesses stay out of the feed.
              </p>
            </section>
          )}

          {result && (
            <div className="animate-enter mt-12">
              {result.delta.previousScannedAt && (
                <section className="rounded-[28px] border border-[#e4e4de] bg-white px-6 py-6 sm:px-8">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f8f88]">Since your last scan</p>
                  <p className="mt-2 text-[34px] font-semibold tracking-[-0.045em] text-[#141412]">
                    {result.delta.totalChanges
                      ? `${result.delta.totalChanges} ${result.delta.totalChanges === 1 ? "change detected" : "changes detected"}`
                      : "No new changes"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-5 text-[13px] font-medium text-[#5f5f59]">
                    <span>{SEVERITY_COPY.hot.label} {result.delta.hot}</span>
                    <span>{SEVERITY_COPY.active.label} {result.delta.active}</span>
                    <span>{SEVERITY_COPY.watch.label} {result.delta.watch}</span>
                  </div>
                </section>
              )}

              <section className={cn("rounded-[28px] border border-[#e4e4de] bg-white px-6 py-6 sm:px-8", result.delta.previousScannedAt && "mt-4")}>
                <div className="flex items-baseline justify-between gap-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8f8f88]">Radar brief</p>
                  <p className="text-[11px] text-[#a1a19a]">
                    {result.territory.label} — {result.territory.radiusMiles} mile territory
                  </p>
                </div>
                <p className="mt-3 text-[13px] font-medium text-[#5f5f59]">
                  {result.firstScan
                    ? result.signals.filter((item) => !item.dismissed).length
                      ? `Radar found ${result.signals.filter((item) => !item.dismissed).length} public signal${result.signals.filter((item) => !item.dismissed).length === 1 ? "" : "s"}.`
                      : "No strong signals detected."
                    : result.delta.totalChanges
                      ? `Radar found ${result.delta.totalChanges} change${result.delta.totalChanges === 1 ? "" : "s"} since your last scan.`
                      : result.signals.filter((item) => !item.dismissed).length
                        ? `${result.signals.filter((item) => !item.dismissed).length} earlier signal${result.signals.filter((item) => !item.dismissed).length === 1 ? " remains" : "s remain"} on the board.`
                        : "No strong signals detected."}
                </p>
                <p className="mt-3 max-w-[720px] text-[16px] leading-8 text-[#2a2a26] sm:text-[17px]">{result.brief.summary}</p>
                {hotVisible.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setFilters((current) => ({ ...current, severity: "hot", worthContacting: false }));
                      document.getElementById("radar-feed")?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="mt-5 h-10 rounded-full bg-[#171715] px-4 text-[11px] font-semibold text-white hover:bg-black"
                  >
                    View businesses to contact now
                  </button>
                )}
              </section>

              <div className="mt-8 border-b border-[#e0e0da] pb-3">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
                <FilterSelect
                  label="Signal"
                  value={filters.signalType}
                  onChange={(value) => setFilters((current) => ({ ...current, signalType: value as Filters["signalType"] }))}
                >
                  <option value="all">All types</option>
                  {FILTERABLE_SIGNAL_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {SIGNAL_LABELS[type].short}
                    </option>
                  ))}
                </FilterSelect>
                <FilterSelect
                  label="Strength"
                  value={filters.severity}
                  onChange={(value) => setFilters((current) => ({ ...current, severity: value as Filters["severity"] }))}
                >
                  <option value="all">All</option>
                  <option value="hot">Contact now</option>
                  <option value="active">Recently changed</option>
                  <option value="watch">Watch</option>
                </FilterSelect>
                <FilterSelect
                  label="Industry"
                  value={filters.industry}
                  onChange={(value) => setFilters((current) => ({ ...current, industry: value }))}
                >
                  <option value="all">All</option>
                  {PLACE_CATEGORIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </FilterSelect>
                <button
                  type="button"
                  onClick={() => setFilters((current) => ({ ...current, worthContacting: !current.worthContacting }))}
                  className={cn(
                    "inline-flex h-8 items-center rounded-full px-3 text-[11px] font-semibold",
                    filters.worthContacting ? "bg-[#171715] text-white" : "text-[#6f6f69] hover:bg-white/70",
                  )}
                >
                  Only show things worth contacting
                </button>
                {!result.firstScan && (
                  <button
                    type="button"
                    onClick={() => setFilters((current) => ({ ...current, newSinceLastScan: !current.newSinceLastScan }))}
                    className={cn(
                      "inline-flex h-8 items-center rounded-full px-3 text-[11px] font-semibold",
                      filters.newSinceLastScan ? "bg-[#171715] text-white" : "text-[#6f6f69] hover:bg-white/70",
                    )}
                  >
                    New since last scan
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowMap((value) => !value)}
                  className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-[#6f6f69] hover:bg-white/70"
                >
                  <MapIcon size={12} /> {showMap ? "Hide map" : "Show map"}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setFilters((current) => ({
                      ...current,
                      saved: current.saved === "saved" ? "all" : "saved",
                    }))
                  }
                  className={cn(
                    "inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-medium",
                    filters.saved === "saved" ? "text-[#171715]" : "text-[#9a9a93] hover:text-[#5f5f59]",
                  )}
                >
                  Saved
                </button>
                <button
                  type="button"
                  onClick={() => setFilters((current) => ({ ...current, hasContact: !current.hasContact }))}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-medium",
                    filters.hasContact ? "text-[#171715]" : "text-[#9a9a93] hover:text-[#5f5f59]",
                  )}
                >
                  Phone available
                </button>
                <button
                  type="button"
                  onClick={() => setFilters((current) => ({ ...current, hasWebsite: !current.hasWebsite }))}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-medium",
                    filters.hasWebsite ? "text-[#171715]" : "text-[#9a9a93] hover:text-[#5f5f59]",
                  )}
                >
                  Website available
                </button>
              </div>
              </div>

              <div className={cn("mt-6 grid gap-6", showMap && "lg:grid-cols-[minmax(0,1fr)_300px]")}>
                <div id="radar-feed" className="space-y-4">
                  {visible.length ? (
                    visible.map((signal) => (
                      <RadarSignalCard
                        key={signal.id}
                        signal={signal}
                        selected={selectedId === signal.id}
                        onSelect={() => setSelectedId(signal.id)}
                        onResearch={() => openResearch(signal)}
                        onAction={(action) => void act(signal, action)}
                      />
                    ))
                  ) : (
                    <div className="rounded-[28px] border border-[#e4e4de] bg-white px-6 py-16 text-center">
                      <p className="text-[22px] font-semibold tracking-[-0.03em] text-[#191916]">No strong signals detected.</p>
                      <p className="mx-auto mt-3 max-w-[420px] text-[14px] leading-6 text-[#7a7a74]">
                        {result.firstScan
                          ? "Radar saved this territory as a baseline. The next scan can detect what actually changed."
                          : "Lower-confidence watch items stay hidden unless you loosen filters. Hiring and job posts are never shown."}
                      </p>
                      {result.signals.some((item) => item.severity === "watch") && filters.severity !== "watch" && (
                        <button
                          type="button"
                          onClick={() => setFilters((current) => ({ ...current, severity: "watch", worthContacting: false }))}
                          className="mt-6 text-[12px] font-semibold text-[#5f5f59] underline-offset-2 hover:underline"
                        >
                          Show watch items
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {showMap && result && (
                  <div className="lg:sticky lg:top-6 lg:self-start">
                    <RadarMap
                      center={result.territory.coordinates}
                      radiusMiles={result.territory.radiusMiles}
                      signals={visible}
                      selectedId={selectedId}
                      onSelect={(id) => {
                        setSelectedId(id);
                        document.getElementById(`radar-signal-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="inline-flex h-8 items-center gap-2 rounded-[10px] px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9a9a93] hover:bg-white/70">
      {label}
      <span className="relative inline-flex items-center">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="appearance-none bg-transparent pr-4 text-[12px] font-semibold normal-case tracking-normal text-[#22221f] outline-none"
        >
          {children}
        </select>
        <ChevronDown size={12} className="pointer-events-none absolute right-0 text-[#a3a39c]" />
      </span>
    </label>
  );
}
