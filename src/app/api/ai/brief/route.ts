import { NextResponse } from "next/server";

import { generateWithQwen, qwenConfigured } from "@/lib/qwen";
import type { BroadbandObservation, Prospect } from "@/lib/types";

export async function POST(request: Request) {
  if (!qwenConfigured()) {
    return NextResponse.json(
      { error: "Profile generation is not configured. Add an AI API key to .env.local." },
      { status: 503 },
    );
  }

  let body: { prospect?: Prospect; broadband?: BroadbandObservation[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (!body.prospect?.id || !body.prospect.name || JSON.stringify(body).length > 100_000) {
    return NextResponse.json({ error: "A valid, bounded prospect fact pack is required." }, { status: 400 });
  }

  try {
    return NextResponse.json({ brief: await generateWithQwen(body.prospect, body.broadband ?? []) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Profile generation failed.";
    return NextResponse.json(
      { error: message.replace(/Qwen/gi, "Profile generation") },
      { status: 502 },
    );
  }
}
