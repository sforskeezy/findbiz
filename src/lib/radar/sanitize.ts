import { isProspectSignal } from "@/lib/radar/catalog";
import { buildDelta } from "@/lib/radar/detect";
import { buildDeterministicBrief } from "@/lib/radar/brief";
import type { RadarScanResult, RadarSignal } from "@/lib/radar/types";

const NON_PROSPECT_LANGUAGE =
  /\b(hiring|now hiring|job opening|careers?|we(?:'re| are) hiring|actively hiring|possible new listing)\b/i;

export function prospectSignals(signals: RadarSignal[]) {
  return signals.filter((item) => isProspectSignal(item.type));
}

export function sanitizeRadarScan(scan: RadarScanResult): RadarScanResult {
  const signals = prospectSignals(scan.signals);
  const briefMentionsHiring = NON_PROSPECT_LANGUAGE.test(scan.brief.summary);
  if (signals.length === scan.signals.length && !briefMentionsHiring) {
    return { ...scan, delta: { ...scan.delta, hiring: 0 } };
  }
  const delta = { ...buildDelta(signals, scan.delta.previousScannedAt), hiring: 0 };
  return {
    ...scan,
    signals,
    delta,
    brief: buildDeterministicBrief(scan.territory, signals, delta, scan.firstScan),
  };
}
