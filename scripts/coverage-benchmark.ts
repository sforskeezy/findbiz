import { runCoverageBenchmark } from "../src/lib/coverage-benchmark";

async function main() {
  const metrics = await runCoverageBenchmark();
  console.log("Synthetic public-area coverage benchmark (no live APIs; no Google Maps data)");
  console.table(metrics.map((row) => ({
    Scenario: row.scenario,
    Mode: row.mode,
    Raw: row.rawRecords,
    Eligible: row.eligibleBusinesses,
    Merged: row.duplicatesMerged,
    Excluded: row.excluded,
    Unknown: row.eligibilityUnknown,
    Addresses: row.completeAddresses,
    "Phone/site": row.phoneOrWebsite,
    Requests: row.requestCount,
    Sources: JSON.stringify(row.sourceContribution),
    Partial: row.partial ? "yes" : "no",
    "Duration ms": row.durationMs,
  })));

  const totals = (mode: typeof metrics[number]["mode"]) => metrics
    .filter((row) => row.mode === mode)
    .reduce((sum, row) => ({ raw: sum.raw + row.rawRecords, eligible: sum.eligible + row.eligibleBusinesses, merged: sum.merged + row.duplicatesMerged, excluded: sum.excluded + row.excluded, unknown: sum.unknown + row.eligibilityUnknown, addresses: sum.addresses + row.completeAddresses, contacts: sum.contacts + row.phoneOrWebsite, requests: sum.requests + row.requestCount }), { raw: 0, eligible: 0, merged: 0, excluded: 0, unknown: 0, addresses: 0, contacts: 0, requests: 0 });

  console.log(JSON.stringify({ osmOnly: totals("OSM only"), combined: totals("PAI Places combined") }, null, 2));
}

void main();
