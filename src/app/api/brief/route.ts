import { NextResponse } from "next/server";

import { generateResearchBrief, researchBriefConfigured } from "@/lib/research-brief";
import type { BroadbandObservation, Prospect } from "@/lib/types";

export async function POST(request: Request) {
  if (!researchBriefConfigured()) {
    return NextResponse.json(
      { error: "Profile generation is not configured." },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as { prospect?: Prospect; broadband?: BroadbandObservation[] };
    if (!body.prospect) {
      return NextResponse.json({ error: "A prospect payload is required." }, { status: 400 });
    }

    return NextResponse.json({ brief: await generateResearchBrief(body.prospect, body.broadband ?? []) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile generation failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
