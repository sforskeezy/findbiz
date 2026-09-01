import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { sanitizeRadarScan } from "@/lib/radar/sanitize";
import type {
  RadarScanResult,
  RadarSignal,
  RadarSignalAction,
  RadarTerritory,
  TerritorySnapshot,
  TimelineEvent,
} from "@/lib/radar/types";
import { ensureWritableStore, preferredStorePath } from "@/lib/writable-store";

type RadarIndex = {
  version: 1;
  territories: RadarTerritory[];
  latestScanByTerritory: Record<string, string>;
};

let resolvedRoot: string | null = null;

async function ensureRoot() {
  if (resolvedRoot) return resolvedRoot;
  resolvedRoot = await ensureWritableStore(preferredStorePath(process.env.RADAR_STORE_PATH, "radar"), [
    "scans",
    "snapshots",
    "timelines",
  ]);
  return resolvedRoot;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(/* turbopackIgnore: true */ file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(/* turbopackIgnore: true */ tmp, JSON.stringify(value), "utf8");
  await rename(/* turbopackIgnore: true */ tmp, file);
}

function emptyIndex(): RadarIndex {
  return { version: 1, territories: [], latestScanByTerritory: {} };
}

export async function loadRadarIndex() {
  const root = await ensureRoot();
  return readJson<RadarIndex>(path.join(root, "index.json"), emptyIndex());
}

async function saveRadarIndex(index: RadarIndex) {
  const root = await ensureRoot();
  await writeJson(path.join(root, "index.json"), index);
}

export async function upsertTerritory(territory: RadarTerritory) {
  const index = await loadRadarIndex();
  const existing = index.territories.findIndex((item) => item.id === territory.id);
  if (existing === -1) index.territories.unshift(territory);
  else {
    index.territories[existing] = {
      ...index.territories[existing],
      ...territory,
      createdAt: index.territories[existing].createdAt,
    };
  }
  index.territories = index.territories.slice(0, 40);
  await saveRadarIndex(index);
  return territory;
}

export async function listTerritories() {
  const index = await loadRadarIndex();
  return [...index.territories].sort((a, b) => {
    const aTime = a.lastScannedAt || a.createdAt;
    const bTime = b.lastScannedAt || b.createdAt;
    return bTime.localeCompare(aTime);
  });
}

export async function loadSnapshot(territoryId: string) {
  const root = await ensureRoot();
  return readJson<TerritorySnapshot | null>(path.join(root, "snapshots", `${territoryId}.json`), null);
}

export async function saveSnapshot(snapshot: TerritorySnapshot) {
  const root = await ensureRoot();
  await writeJson(path.join(root, "snapshots", `${snapshot.territoryId}.json`), snapshot);
}

export async function loadScan(scanId: string) {
  const root = await ensureRoot();
  const scan = await readJson<RadarScanResult | null>(path.join(root, "scans", `${scanId}.json`), null);
  return scan ? sanitizeRadarScan(scan) : null;
}

export async function loadLatestScan(territoryId: string) {
  const index = await loadRadarIndex();
  const scanId = index.latestScanByTerritory[territoryId];
  if (!scanId) return null;
  return loadScan(scanId);
}

export async function saveScan(result: RadarScanResult) {
  const root = await ensureRoot();
  await writeJson(path.join(root, "scans", `${result.id}.json`), result);
  const index = await loadRadarIndex();
  index.latestScanByTerritory[result.territory.id] = result.id;
  const territory = index.territories.find((item) => item.id === result.territory.id);
  if (territory) territory.lastScannedAt = result.scannedAt;
  await saveRadarIndex(index);
}

export async function loadTimeline(businessKey: string) {
  const root = await ensureRoot();
  return readJson<TimelineEvent[]>(path.join(root, "timelines", `${businessKey}.json`), []);
}

export async function appendTimeline(businessKey: string, events: TimelineEvent[]) {
  if (!events.length) return;
  const existing = await loadTimeline(businessKey);
  const merged = [...events, ...existing].filter((event, index, list) => {
    return list.findIndex((item) => item.id === event.id || (item.signalType === event.signalType && item.at === event.at)) === index;
  });
  const root = await ensureRoot();
  await writeJson(path.join(root, "timelines", `${businessKey}.json`), merged.slice(0, 80));
}

export async function applySignalAction(scanId: string, signalId: string, action: RadarSignalAction) {
  const scan = await loadScan(scanId);
  if (!scan) throw new Error("Radar scan was not found.");
  const signal = scan.signals.find((item) => item.id === signalId);
  if (!signal) throw new Error("Radar signal was not found.");

  if (action === "save") signal.saved = true;
  if (action === "unsave") signal.saved = false;
  if (action === "dismiss") signal.dismissed = true;
  if (action === "restore") signal.dismissed = false;
  if (action === "contacted") signal.contacted = true;
  if (action === "uncontacted") signal.contacted = false;

  await saveScan(scan);
  const snapshot = await loadSnapshot(scan.territory.id);
  if (snapshot) {
    const stored = snapshot.signals.find((item) => item.id === signalId);
    if (stored) {
      stored.saved = signal.saved;
      stored.dismissed = signal.dismissed;
      stored.contacted = signal.contacted;
      await saveSnapshot(snapshot);
    }
  }
  return signal;
}

export function compactSignals(signals: RadarSignal[]): TerritorySnapshot["signals"] {
  return signals.map((signal) => ({
    id: signal.id,
    businessKey: signal.businessKey,
    type: signal.type,
    evidence: signal.evidence,
    firstDetectedAt: signal.firstDetectedAt,
    saved: signal.saved,
    dismissed: signal.dismissed,
    contacted: signal.contacted,
  }));
}

export async function radarStoreStatus() {
  const root = await ensureRoot();
  const index = await loadRadarIndex();
  return {
    path: root,
    territories: index.territories.length,
    scans: Object.keys(index.latestScanByTerritory).length,
  };
}
