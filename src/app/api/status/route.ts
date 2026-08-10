import { NextResponse } from "next/server";

import { NO_STORE_HEADERS } from "@/lib/api-safety";
import { commercialProviderStatus } from "@/lib/commercial-provider";
import { fccRuntimeConfigured } from "@/lib/fcc";
import { inspectOvertureReadiness } from "@/lib/overture";
import { researchBriefConfigured } from "@/lib/research-brief";

export async function GET() {
  const overture = await inspectOvertureReadiness();
  const commercial = commercialProviderStatus();
  return NextResponse.json(
    {
      researchBriefConfigured: researchBriefConfigured(),
      businessDataMode: "pai_places_v2",
      discoverySources: {
        overture: {
          status: overture.ready ? "ready" : "unavailable",
          code: overture.code,
          coverageBoundary: overture.coverageBoundaryConfigured ? "configured" : "unknown",
        },
        openStreetMap: { status: "supplemental", code: "OVERPASS_SEQUENTIAL_FALLBACK" },
        commercial: { status: commercial.configured ? "ready" : "disabled", code: commercial.code },
      },
      fccMode: fccRuntimeConfigured() ? "current_bdc_local_index" : "data_unavailable",
      zeroRetention: true,
    },
    { headers: NO_STORE_HEADERS },
  );
}
