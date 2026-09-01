import { SIGNAL_LABELS } from "@/lib/radar/catalog";
import type { RadarBrief, RadarDelta, RadarSignal, RadarTerritory } from "@/lib/radar/types";

type ChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

function namedSignals(signals: RadarSignal[]) {
  return signals.filter((item) => !item.dismissed);
}

export function buildDeterministicBrief(
  territory: RadarTerritory,
  signals: RadarSignal[],
  delta: RadarDelta,
  firstScan: boolean,
): RadarBrief {
  const visible = namedSignals(signals);
  const hot = visible.filter((item) => item.severity === "hot");
  const names = [...hot, ...visible.filter((item) => item.severity === "active")]
    .filter((item, index, list) => list.findIndex((other) => other.observation.name === item.observation.name) === index)
    .slice(0, 3)
    .map((item) => `${item.observation.name} (${SIGNAL_LABELS[item.type].short.toLowerCase()})`);

  let summary: string;
  if (!visible.length) {
    summary = firstScan
      ? `Radar finished a baseline scan of ${territory.label} (${territory.radiusMiles} mile territory) and did not find a strong public change. This snapshot is saved, so the next scan can detect what actually changes.`
      : `Radar did not find a strong public change in ${territory.label} since the last scan. Lower-confidence watch items, if any, stay out of the main briefing.`;
  } else if (firstScan) {
    summary = `Radar scanned the ${territory.radiusMiles} mile territory around ${territory.label} and found ${visible.length} public signal${visible.length === 1 ? "" : "s"} worth a look. ${
      names.length ? `The strongest current leads are ${names.join("; ")}.` : "None of them are confirmed openings; treat unverified items as possible until more evidence appears."
    }`;
  } else if (delta.totalChanges === 0) {
    summary = `No new public changes since the last scan of ${territory.label}. ${visible.length} earlier signal${visible.length === 1 ? " remains" : "s remain"} on the board${names.length ? `, including ${names.join("; ")}` : ""}.`;
  } else {
    summary = `Radar detected ${delta.totalChanges} meaningful change${delta.totalChanges === 1 ? "" : "s"} since your last scan of ${territory.label}. ${
      delta.hot ? `${delta.hot} look especially time-sensitive. ` : ""
    }${names.length ? `Standouts: ${names.join("; ")}.` : ""}`.trim();
  }

  return {
    territoryLabel: territory.label,
    radiusMiles: territory.radiusMiles,
    summary,
    generatedBy: "deterministic",
    model: null,
  };
}

function groqConfigured() {
  return Boolean(process.env.GROQ_API_KEY?.trim());
}

export function radarBriefStatus() {
  return {
    groq: groqConfigured() ? "active" : "not_configured",
    model: process.env.RADAR_BRIEF_MODEL?.trim() || "llama-3.1-8b-instant",
    fallback: "deterministic",
  };
}

export async function generateRadarBrief(
  territory: RadarTerritory,
  signals: RadarSignal[],
  delta: RadarDelta,
  firstScan: boolean,
): Promise<RadarBrief> {
  const fallback = buildDeterministicBrief(territory, signals, delta, firstScan);
  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey || !namedSignals(signals).length) return fallback;

  const model = process.env.RADAR_BRIEF_MODEL?.trim() || "llama-3.1-8b-instant";
  const baseUrl = (process.env.RADAR_BRIEF_BASE_URL?.trim() || "https://api.groq.com/openai/v1").replace(/\/$/, "");
  const allowedNames = new Set(namedSignals(signals).map((item) => item.observation.name));
  const facts = namedSignals(signals)
    .slice(0, 12)
    .map((item) => ({
      name: item.observation.name,
      category: item.observation.category,
      distanceMiles: item.observation.distanceMiles,
      signal: item.verified ? item.title : item.title,
      recency: item.recencyLabel,
      severity: item.severity,
      why: item.why.slice(0, 3),
    }));

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 280,
        messages: [
          {
            role: "system",
            content:
              "You write a 2-4 sentence briefing for a B2B sales prospecting tool. Use ONLY the supplied findings. Never invent businesses, dates, or events. Never mention hiring, jobs, recruiting, or careers. Focus on openings, moves, expansions, ownership, renovations, and other contact-relevant public change. If a finding is labeled possible, keep that hedge. Return JSON {\"summary\":\"...\"} only.",
          },
          {
            role: "user",
            content: JSON.stringify({
              territory: territory.label,
              radiusMiles: territory.radiusMiles,
              firstScan,
              delta,
              findings: facts,
            }),
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const payload = (await response.json()) as ChatResponse;
    if (!response.ok) return fallback;
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return fallback;
    const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    const parsed = JSON.parse(cleaned) as { summary?: unknown };
    if (typeof parsed.summary !== "string" || parsed.summary.trim().length < 40) return fallback;
    const summary = parsed.summary.trim();
    const mentioned = summary.match(/[A-Z][A-Za-z0-9'&.-]+(?:\s+[A-Z][A-Za-z0-9'&.-]+){0,4}/g) ?? [];
    const unknown = mentioned.filter((name) => {
      if (name.length < 4) return false;
      if (/Radar|Hot|Active|Watch|Territory|Greenville|Since/.test(name)) return false;
      return ![...allowedNames].some((allowed) => allowed.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(allowed.toLowerCase()));
    });
    if (unknown.length > 1) return fallback;
    return {
      territoryLabel: territory.label,
      radiusMiles: territory.radiusMiles,
      summary,
      generatedBy: "groq",
      model,
    };
  } catch {
    return fallback;
  }
}
