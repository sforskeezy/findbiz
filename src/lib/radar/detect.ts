import { isProspectSignal, SIGNAL_LABELS } from "@/lib/radar/catalog";
import { hashKey, normalizedAddress, phoneDigits, websiteHost } from "@/lib/radar/identity";
import { scoreSignal } from "@/lib/radar/score";
import { daysBetween, recencyLabel } from "@/lib/radar/time";
import type {
  BusinessObservation,
  DatePrecision,
  RadarSignal,
  SignalEvidence,
  SignalType,
  TerritorySnapshot,
  TimelineEvent,
} from "@/lib/radar/types";
import type { BusinessEnrichment } from "@/lib/radar/enrich";
import { evidenceFromHit } from "@/lib/radar/enrich";
import { distanceMiles } from "@/lib/place-candidate";
import type { Prospect } from "@/lib/types";

type Draft = {
  businessKey: string;
  companyKey: string;
  type: SignalType;
  verified: boolean;
  why: string[];
  evidence: SignalEvidence[];
  occurredAt: string | null;
  precision: DatePrecision;
  hiringCount: number | null;
  observation: BusinessObservation;
  prospect: Prospect;
  newSinceLastScan: boolean;
  sincePreviousScanDays: number | null;
};

function snapshotEvidence(label: string, snippet: string, observedAt: string): SignalEvidence {
  return {
    id: hashKey("snapshot", label, snippet.slice(0, 80), observedAt),
    label,
    snippet,
    url: null,
    sourceLabel: "Territory snapshot comparison",
    observedAt,
    confidence: "Verified",
  };
}

function reasonForHit(hit: import("@/lib/radar/enrich").EnrichmentHit) {
  switch (hit.type) {
    case "grand_opening":
      return "Grand opening language found in a public source.";
    case "coming_soon":
      return "Coming soon language found in a public source.";
    case "expanding":
      return "Public language suggests an additional or expanded location.";
    case "renovation":
      return "Renovation language found in a public source.";
    case "new_ownership":
      return "Public language suggests new ownership or management.";
    case "reopened":
      return "Public language suggests the business has reopened.";
    case "newly_registered":
      return "A public registry or filing mention was found.";
    default:
      return `${SIGNAL_LABELS[hit.type].short} evidence was found in a public source.`;
  }
}

function uniqueEvidence(evidence: SignalEvidence[]) {
  const kept: SignalEvidence[] = [];
  for (const item of evidence) {
    const duplicate = kept.some(
      (existing) =>
        existing.id === item.id ||
        (existing.label === item.label && existing.snippet === item.snippet) ||
        (existing.label === item.label && existing.sourceLabel === item.sourceLabel && Boolean(existing.url) && existing.url === item.url),
    );
    if (!duplicate) kept.push(item);
  }
  return kept.slice(0, 6);
}

function independentSources(evidence: SignalEvidence[]) {
  const keys = new Set(
    evidence.map((item) => {
      if (!item.url) return item.sourceLabel.toLowerCase();
      try {
        return new URL(item.url).hostname.replace(/^www\./, "");
      } catch {
        return item.sourceLabel.toLowerCase();
      }
    }),
  );
  return keys.size;
}

export function detectSnapshotSignals(input: {
  current: BusinessObservation[];
  previous: TerritorySnapshot | null;
  prospects: Map<string, Prospect>;
  scannedAt: string;
}): Draft[] {
  const drafts: Draft[] = [];
  const previousByKey = new Map((input.previous?.observations ?? []).map((item) => [item.key, item]));
  const previousByCompany = new Map<string, BusinessObservation[]>();
  for (const item of input.previous?.observations ?? []) {
    const list = previousByCompany.get(item.companyKey) ?? [];
    list.push(item);
    previousByCompany.set(item.companyKey, list);
  }

  const currentByCompany = new Map<string, BusinessObservation[]>();
  for (const item of input.current) {
    const list = currentByCompany.get(item.companyKey) ?? [];
    list.push(item);
    currentByCompany.set(item.companyKey, list);
  }

  const sincePreviousScanDays = input.previous ? daysBetween(input.previous.scannedAt, input.scannedAt) : null;
  const hasHistory = Boolean(input.previous);

  for (const observation of input.current) {
    const prospect = input.prospects.get(observation.key);
    if (!prospect) continue;
    const prior = previousByKey.get(observation.key);
    const priorCompany = previousByCompany.get(observation.companyKey) ?? [];
    const currentCompany = currentByCompany.get(observation.companyKey) ?? [];

    if (hasHistory && !prior) {
      const nearbyPrior = priorCompany.find((item) => distanceMiles(item.coordinates, observation.coordinates) <= 0.35);
      if (!nearbyPrior && priorCompany.length) {
        drafts.push({
          businessKey: observation.key,
          companyKey: observation.companyKey,
          type: "new_location",
          verified: priorCompany.length >= 1,
          why: ["This address was not in the previous territory snapshot.", "The same company already had another observed location."],
          evidence: [
            snapshotEvidence(
              "New location since last scan",
              `${observation.name} at ${observation.address} was not present in the ${input.previous?.scannedAt.slice(0, 10)} snapshot.`,
              input.scannedAt,
            ),
          ],
          occurredAt: null,
          precision: "relative",
          hiringCount: null,
          observation,
          prospect,
          newSinceLastScan: true,
          sincePreviousScanDays,
        });
      } else if (!nearbyPrior) {
        drafts.push({
          businessKey: observation.key,
          companyKey: observation.companyKey,
          type: "new_business",
          verified: true,
          why: ["This business was not present in the previous territory snapshot."],
          evidence: [
            snapshotEvidence(
              "New since last scan",
              `${observation.name} first appeared in this territory after the ${input.previous?.scannedAt.slice(0, 10)} scan.`,
              input.scannedAt,
            ),
          ],
          occurredAt: null,
          precision: "relative",
          hiringCount: null,
          observation,
          prospect,
          newSinceLastScan: true,
          sincePreviousScanDays,
        });
      }
    }

    if (prior && normalizedAddress(prior.address) && normalizedAddress(observation.address)) {
      if (normalizedAddress(prior.address) !== normalizedAddress(observation.address)) {
        const moved = distanceMiles(prior.coordinates, observation.coordinates) > 0.4;
        drafts.push({
          businessKey: observation.key,
          companyKey: observation.companyKey,
          type: moved ? "moved" : "address_changed",
          verified: true,
          why: moved
            ? [`Public listing moved from ${prior.address} to ${observation.address}.`]
            : [`Listed address changed from ${prior.address} to ${observation.address}.`],
          evidence: [
            snapshotEvidence(
              moved ? "Location moved" : "Address changed",
              `Previously listed as ${prior.address}. Now listed as ${observation.address}.`,
              input.scannedAt,
            ),
          ],
          occurredAt: null,
          precision: "relative",
          hiringCount: null,
          observation,
          prospect,
          newSinceLastScan: true,
          sincePreviousScanDays,
        });
      }
    }

    if (prior && !prior.website && observation.website) {
      drafts.push({
        businessKey: observation.key,
        companyKey: observation.companyKey,
        type: "new_website",
        verified: true,
        why: ["A website appeared on the public listing since the last scan."],
        evidence: [
          snapshotEvidence("Website added", `Website ${observation.website} was not present in the previous snapshot.`, input.scannedAt),
        ],
        occurredAt: null,
        precision: "relative",
        hiringCount: null,
        observation,
        prospect,
        newSinceLastScan: true,
        sincePreviousScanDays,
      });
    } else if (prior?.website && observation.website && websiteHost(prior.website) !== websiteHost(observation.website)) {
      drafts.push({
        businessKey: observation.key,
        companyKey: observation.companyKey,
        type: "website_changed",
        verified: true,
        why: ["The listed website domain changed since the last scan."],
        evidence: [
          snapshotEvidence(
            "Website changed",
            `Previous website ${prior.website}. Current website ${observation.website}.`,
            input.scannedAt,
          ),
        ],
        occurredAt: null,
        precision: "relative",
        hiringCount: null,
        observation,
        prospect,
        newSinceLastScan: true,
        sincePreviousScanDays,
      });
    }

    if (prior && !phoneDigits(prior.phone) && phoneDigits(observation.phone)) {
      drafts.push({
        businessKey: observation.key,
        companyKey: observation.companyKey,
        type: "phone_added",
        verified: true,
        why: ["A public phone number appeared since the last scan."],
        evidence: [
          snapshotEvidence("Phone added", `Phone ${observation.phone} was not present in the previous snapshot.`, input.scannedAt),
        ],
        occurredAt: null,
        precision: "relative",
        hiringCount: null,
        observation,
        prospect,
        newSinceLastScan: true,
        sincePreviousScanDays,
      });
    }

    if (prior && prior.operatingStatus === "Temporarily closed" && observation.operatingStatus === "Open") {
      drafts.push({
        businessKey: observation.key,
        companyKey: observation.companyKey,
        type: "reopened",
        verified: true,
        why: ["The listing moved from temporarily closed to open since the last scan."],
        evidence: [
          snapshotEvidence("Reopened", `${observation.name} was temporarily closed in the previous snapshot and is now listed as open.`, input.scannedAt),
        ],
        occurredAt: null,
        precision: "relative",
        hiringCount: null,
        observation,
        prospect,
        newSinceLastScan: true,
        sincePreviousScanDays,
      });
    }

    if (currentCompany.length >= 2 && currentCompany[0]?.key === observation.key) {
      const distinct = currentCompany.filter((item, index, list) => {
        return list.findIndex((other) => distanceMiles(other.coordinates, item.coordinates) > 0.45) === index || index === 0;
      });
      if (distinct.length >= 2 && (!hasHistory || (priorCompany.length < distinct.length))) {
        drafts.push({
          businessKey: observation.key,
          companyKey: observation.companyKey,
          type: "multiple_locations",
          verified: distinct.length >= 2,
          why: [`Radar currently sees ${distinct.length} distinct locations for this company in the territory.`],
          evidence: [
            snapshotEvidence(
              "Multiple locations",
              distinct.map((item) => item.address).join(" · "),
              input.scannedAt,
            ),
          ],
          occurredAt: null,
          precision: hasHistory ? "relative" : "unknown",
          hiringCount: null,
          observation,
          prospect,
          newSinceLastScan: hasHistory && priorCompany.length < distinct.length,
          sincePreviousScanDays: hasHistory ? sincePreviousScanDays : null,
        });
      }
    }

  }

  return drafts;
}

export function mergeEnrichment(
  drafts: Draft[],
  enrichments: BusinessEnrichment[],
  scannedAt: string,
  records: Array<{ observation: BusinessObservation; prospect: Prospect }>,
) {
  const extra: Draft[] = [];
  const existingKeys = new Set(drafts.map((item) => `${item.businessKey}:${item.type}`));
  const recordByProspect = new Map(records.map((item) => [item.prospect.id, item]));

  for (const draft of drafts) {
    const enrichment = enrichments.find((item) => item.prospectId === draft.prospect.id);
    if (!enrichment) continue;
    for (const hit of enrichment.hits) {
      if (!isProspectSignal(hit.type)) continue;
      if (hit.type === draft.type || (draft.type === "new_location" && (hit.type === "grand_opening" || hit.type === "expanding"))) {
        draft.evidence.push(evidenceFromHit(hit, scannedAt));
        draft.why.push(reasonForHit(hit));
        if (hit.occurredAt && (!draft.occurredAt || hit.precision === "exact")) {
          draft.occurredAt = hit.occurredAt;
          draft.precision = hit.precision;
        }
        if (hit.hiringCount) draft.hiringCount = hit.hiringCount;
        if (hit.url) draft.verified = true;
      }
    }
  }

  for (const enrichment of enrichments) {
    const record = recordByProspect.get(enrichment.prospectId);
    if (!record) continue;
    for (const hit of enrichment.hits) {
      if (!isProspectSignal(hit.type)) continue;
      const related = [...drafts, ...extra].find(
        (item) => item.observation.prospectId === enrichment.prospectId && item.type === hit.type,
      );
      if (related) {
        related.evidence.push(evidenceFromHit(hit, scannedAt));
        continue;
      }
      const key = `${record.observation.key}:${hit.type}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      extra.push({
        businessKey: record.observation.key,
        companyKey: record.observation.companyKey,
        type: hit.type,
        verified: Boolean(hit.url) && hit.precision !== "unknown",
        why: [reasonForHit(hit)],
        evidence: [evidenceFromHit(hit, scannedAt)],
        occurredAt: hit.occurredAt,
        precision: hit.precision,
        hiringCount: hit.hiringCount,
        observation: record.observation,
        prospect: record.prospect,
        newSinceLastScan: false,
        sincePreviousScanDays: null,
      });
    }
  }

  return [...drafts, ...extra];
}

function headlineFor(draft: Draft) {
  const labels = SIGNAL_LABELS[draft.type];
  return draft.verified ? labels.confirmed : labels.possible;
}

export function finalizeSignals(input: {
  drafts: Draft[];
  previous: TerritorySnapshot | null;
  territoryId: string;
  scannedAt: string;
  timelines: Map<string, TimelineEvent[]>;
}): RadarSignal[] {
  const previousSignals = input.previous?.signals ?? [];
  const built: RadarSignal[] = [];

  for (const draft of input.drafts) {
    if (!isProspectSignal(draft.type)) continue;
    draft.evidence = uniqueEvidence(draft.evidence);
    draft.why = [...new Set(draft.why.map((item) => item.trim()).filter(Boolean))].slice(0, 5);
    if (!draft.evidence.length || !draft.why.length) continue;

    const sources = independentSources(draft.evidence);
    if (sources >= 2) draft.verified = true;
    if (sources < 2 && ["new_location", "grand_opening", "moved", "new_ownership"].includes(draft.type)) {
      draft.verified = draft.verified && sources >= 2;
    }

    const scored = scoreSignal({
      type: draft.type,
      evidenceCount: draft.evidence.length,
      independentSources: sources,
      occurredAt: draft.occurredAt,
      detectedAt: input.scannedAt,
      precision: draft.precision,
      sincePreviousScanDays: draft.sincePreviousScanDays,
      hasPhone: Boolean(draft.observation.phone),
      hasWebsite: Boolean(draft.observation.website),
      verified: draft.verified,
      hiringCount: draft.hiringCount,
    });

    if (scored.score.total < 28) continue;

    const prior = previousSignals.find((item) => item.businessKey === draft.businessKey && item.type === draft.type);
    const firstDetectedAt = prior?.firstDetectedAt ?? input.scannedAt;
    const id = prior?.id ?? hashKey(input.territoryId, draft.businessKey, draft.type);
    const labels = SIGNAL_LABELS[draft.type];
    const priorEvidence = (prior?.evidence ?? []).filter((item) => {
      const urls = new Set(draft.evidence.map((entry) => entry.url).filter(Boolean));
      return !item.url || !urls.has(item.url);
    });
    const event: TimelineEvent = {
      id: hashKey(id, input.scannedAt),
      at: input.scannedAt,
      label: headlineFor(draft),
      signalType: draft.type,
      summary: draft.why[0],
    };
    const timeline = [
      event,
      ...(input.timelines.get(draft.businessKey) ?? []).filter((item) => item.signalType === draft.type),
    ].slice(0, 8);

    built.push({
      id,
      territoryId: input.territoryId,
      businessKey: draft.businessKey,
      companyKey: draft.companyKey,
      type: draft.type,
      severity: scored.severity,
      verified: draft.verified,
      title: draft.verified ? labels.confirmed : labels.possible,
      headline: headlineFor(draft),
      why: draft.why,
      recencyLabel: recencyLabel({
        occurredAt: draft.occurredAt,
        detectedAt: firstDetectedAt,
        precision: draft.precision,
        sincePreviousScanDays: draft.sincePreviousScanDays,
      }),
      occurredAt: draft.occurredAt,
      datePrecision: draft.precision,
      firstDetectedAt,
      lastDetectedAt: input.scannedAt,
      newSinceLastScan: Boolean(input.previous) && (draft.newSinceLastScan || !prior),
      score: scored.score,
      evidence: uniqueEvidence([...draft.evidence, ...priorEvidence]),
      timeline,
      observation: draft.observation,
      prospect: draft.prospect,
      saved: prior?.saved ?? false,
      dismissed: prior?.dismissed ?? false,
      contacted: prior?.contacted ?? false,
    });
  }

  built.sort((a, b) => {
    const rank = { hot: 0, active: 1, watch: 2 };
    return rank[a.severity] - rank[b.severity] || b.score.total - a.score.total || a.observation.distanceMiles - b.observation.distanceMiles;
  });

  const seenEvents = new Set<string>();
  const unique = built.filter((signal) => {
    const key = `${signal.businessKey}:${signal.type}`;
    if (seenEvents.has(key)) return false;
    seenEvents.add(key);
    if (!isProspectSignal(signal.type)) return false;
    return !signal.dismissed || signal.newSinceLastScan;
  });
  return unique;
}

export function buildDelta(
  signals: RadarSignal[],
  previousScannedAt: string | null,
): import("@/lib/radar/types").RadarDelta {
  const visible = signals.filter((item) => !item.dismissed);
  const since = previousScannedAt ? visible.filter((item) => item.newSinceLastScan) : visible;
  return {
    previousScannedAt,
    totalChanges: since.length,
    hot: since.filter((item) => item.severity === "hot").length,
    active: since.filter((item) => item.severity === "active").length,
    watch: since.filter((item) => item.severity === "watch").length,
    newBusinesses: since.filter((item) => item.type === "new_business").length,
    addressChanges: since.filter((item) => item.type === "address_changed" || item.type === "moved").length,
    newLocations: since.filter((item) => item.type === "new_location").length,
    hiring: since.filter((item) => item.type === "hiring").length,
    websiteChanges: since.filter((item) => item.type === "new_website" || item.type === "website_changed").length,
    newHighConfidence: since.filter((item) => item.severity === "hot" || (item.verified && item.score.total >= 70)).length,
  };
}
