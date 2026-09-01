import { researchAcrossSources } from "@/lib/discovery";
import { geocodeAddress } from "@/lib/geocode";
import { hashKey, observationFromProspect, territoryId } from "@/lib/radar/identity";
import { buildDelta, detectSnapshotSignals, finalizeSignals, mergeEnrichment } from "@/lib/radar/detect";
import { enrichBusinesses, numberEnv } from "@/lib/radar/enrich";
import { generateRadarBrief } from "@/lib/radar/brief";
import { SCAN_STAGE_COPY } from "@/lib/radar/catalog";
import { sanitizeRadarScan } from "@/lib/radar/sanitize";
import {
  appendTimeline,
  compactSignals,
  loadSnapshot,
  loadTimeline,
  saveScan,
  saveSnapshot,
  upsertTerritory,
} from "@/lib/radar/store";
import type { RadarScanEvent, RadarScanResult, RadarScanStage, RadarTerritory } from "@/lib/radar/types";
import { RADAR_RADII } from "@/lib/radar/types";
import type { Prospect } from "@/lib/types";

const MAX_OBSERVATIONS = 180;

export function radarRadii() {
  return RADAR_RADII;
}

function shortTerritoryLabel(formatted: string, query: string) {
  const parts = formatted
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && !/^(united states|usa|us)$/i.test(part) && !/^\d{5}(?:-\d{4})?$/.test(part));
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const state = parts[index].split(/\s+/)[0];
    if (/^[A-Z]{2}$/i.test(state)) return `${parts[index - 1]}, ${state.toUpperCase()}`;
  }
  if (parts[0] && !/^\d+$/.test(parts[0])) return parts.slice(0, 2).join(", ");
  return query;
}

function pickEnrichmentTargets(
  prospects: Prospect[],
  previousKeys: Set<string>,
  observationKeys: Map<string, string>,
) {
  const maximum = numberEnv("RADAR_MAX_ENRICH", 12, 4, 24);
  const ranked = [...prospects].sort((a, b) => {
    const aKey = observationKeys.get(a.id);
    const bKey = observationKeys.get(b.id);
    const aNew = aKey && !previousKeys.has(aKey) ? 1 : 0;
    const bNew = bKey && !previousKeys.has(bKey) ? 1 : 0;
    const aWeb = a.website ? 1 : 0;
    const bWeb = b.website ? 1 : 0;
    return bNew - aNew || bWeb - aWeb || a.distanceMiles - b.distanceMiles;
  });
  return ranked.filter((item) => item.website || item.phone).slice(0, maximum);
}

async function emit(onEvent: ((event: RadarScanEvent) => Promise<void> | void) | undefined, event: RadarScanEvent) {
  await onEvent?.(event);
}

export async function runTerritoryScan(input: {
  locationQuery: string;
  radiusMiles: number;
  categoryFilter?: string | null;
  onEvent?: (event: RadarScanEvent) => Promise<void> | void;
}): Promise<RadarScanResult> {
  const query = input.locationQuery.trim();
  if (query.length < 3 || query.length > 300) {
    throw new Error("Enter a city, ZIP, address, or territory between 3 and 300 characters.");
  }
  if (!RADAR_RADII.includes(input.radiusMiles as (typeof RADAR_RADII)[number])) {
    throw new Error("Choose a supported Radar radius.");
  }

  const sendStage = async (stage: RadarScanStage) => {
    await emit(input.onEvent, { type: "stage", stage, message: SCAN_STAGE_COPY[stage] });
  };

  await sendStage("scanning");
  const geo = await geocodeAddress(query);
  const scannedAt = new Date().toISOString();
  const territory: RadarTerritory = {
    id: territoryId(query, input.radiusMiles, geo.coordinates),
    label: shortTerritoryLabel(geo.formattedAddress, query),
    locationQuery: query,
    formattedAddress: geo.formattedAddress,
    coordinates: geo.coordinates,
    radiusMiles: input.radiusMiles,
    categoryFilter: input.categoryFilter?.trim() || null,
    createdAt: scannedAt,
    lastScannedAt: scannedAt,
  };
  await upsertTerritory(territory);

  await sendStage("discovering");
  const research = await researchAcrossSources(query, input.radiusMiles);
  const filtered = input.categoryFilter
    ? research.prospects.filter((item) => item.category === input.categoryFilter)
    : research.prospects;
  const limited = [...filtered]
    .sort((a, b) => a.distanceMiles - b.distanceMiles)
    .slice(0, MAX_OBSERVATIONS);

  await sendStage("comparing");
  const previous = await loadSnapshot(territory.id);
  const observations = limited.map((prospect) => {
    const draft = observationFromProspect(prospect, { firstSeenAt: scannedAt, lastSeenAt: scannedAt });
    const prior = previous?.observations.find((item) => item.key === draft.key);
    return { ...draft, firstSeenAt: prior?.firstSeenAt ?? scannedAt };
  });
  const prospectsByKey = new Map(observations.map((observation, index) => [observation.key, limited[index]]));
  const observationKeyByProspect = new Map(observations.map((item) => [item.prospectId, item.key]));

  const drafts = detectSnapshotSignals({
    current: observations,
    previous,
    prospects: prospectsByKey,
    scannedAt,
  });

  await sendStage("web");
  const previousKeys = new Set(previous?.observations.map((item) => item.key) ?? []);
  const targets = pickEnrichmentTargets(limited, previousKeys, observationKeyByProspect);

  await sendStage("expansion");
  const enrichments = targets.length ? await enrichBusinesses(targets) : [];

  await sendStage("evidence");
  const records = observations.map((observation) => ({
    observation,
    prospect: prospectsByKey.get(observation.key)!,
  }));
  const merged = mergeEnrichment(drafts, enrichments, scannedAt, records);
  const timelines = new Map(
    await Promise.all(merged.map(async (draft) => [draft.businessKey, await loadTimeline(draft.businessKey)] as const)),
  );

  await sendStage("ranking");
  const signals = finalizeSignals({
    drafts: merged,
    previous,
    territoryId: territory.id,
    scannedAt,
    timelines: new Map(timelines),
  });
  const delta = buildDelta(signals, previous?.scannedAt ?? null);
  const brief = await generateRadarBrief(territory, signals, delta, !previous);
  const result = sanitizeRadarScan({
    id: hashKey(territory.id, scannedAt),
    territory,
    scannedAt,
    firstScan: !previous,
    observationsCount: observations.length,
    enrichedCount: targets.length,
    delta,
    brief,
    signals,
    warnings: research.warnings ?? [],
  });

  await saveScan(result);
  await saveSnapshot({
    territoryId: territory.id,
    scannedAt,
    scanId: result.id,
    observations,
    signals: compactSignals(result.signals),
  });
  for (const signal of signals) {
    const latest = signal.timeline[0];
    if (latest) await appendTimeline(signal.businessKey, [latest]);
  }

  await emit(input.onEvent, { type: "complete", result });
  return result;
}
