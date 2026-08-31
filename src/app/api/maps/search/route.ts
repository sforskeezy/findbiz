import { NextResponse } from "next/server";

import { researchWithGoogleMapsScraper } from "@/lib/google-maps-scraper";

export const runtime = "nodejs";

const allowedRadii = new Set([0.25, 0.5, 1, 2, 5]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      address?: unknown;
      radiusMiles?: unknown;
      queries?: unknown;
    };
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const radiusMiles = Number(body.radiusMiles ?? 0.5);
    const queries = Array.isArray(body.queries)
      ? body.queries.filter((value): value is string => typeof value === "string").slice(0, 40)
      : undefined;

    if (address.length < 6 || address.length > 300) {
      return NextResponse.json({ error: "Enter a complete street address between 6 and 300 characters." }, { status: 400 });
    }
    if (!allowedRadii.has(radiusMiles)) {
      return NextResponse.json({ error: "Choose a supported search radius." }, { status: 400 });
    }
    if (queries?.some((query) => query.trim().length < 2 || query.length > 80)) {
      return NextResponse.json({ error: "Each Maps keyword must be between 2 and 80 characters." }, { status: 400 });
    }

    return NextResponse.json(await researchWithGoogleMapsScraper(address, radiusMiles, queries));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Maps scraping failed.";
    const blocked = /blocked|captcha|access control/i.test(message);
    return NextResponse.json({ error: message, blocked, retryable: !blocked }, { status: blocked ? 429 : 502 });
  }
}
