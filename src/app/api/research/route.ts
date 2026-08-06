import { NextResponse } from "next/server";

import { generateDemoResearch } from "@/lib/demo-data";
import { researchWithGoogle } from "@/lib/google-places";
import { researchWithOpenStreetMap } from "@/lib/openstreetmap";
import { hasRapidApiKey, researchWithRapidApi } from "@/lib/rapidapi-local-business";

const allowedRadii = new Set([0.25, 0.5, 1, 2, 5]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const address =
    typeof body === "object" && body !== null && "address" in body && typeof body.address === "string"
      ? body.address.trim()
      : "";
  const radiusMiles =
    typeof body === "object" && body !== null && "radiusMiles" in body
      ? Number(body.radiusMiles)
      : 0.25;

  if (address.length < 6 || address.length > 300) {
    return NextResponse.json(
      { error: "Enter a complete street address between 6 and 300 characters." },
      { status: 400 },
    );
  }
  if (!allowedRadii.has(radiusMiles)) {
    return NextResponse.json({ error: "Choose a supported search radius." }, { status: 400 });
  }

  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  const googleExplicitlyEnabled = process.env.ENABLE_GOOGLE_PLACES === "true";
  if (process.env.USE_DEMO_DATA === "true") {
    return NextResponse.json(generateDemoResearch(address, radiusMiles));
  }

  try {
    if (hasRapidApiKey()) {
      try {
        const rapid = await researchWithRapidApi(address, radiusMiles);
        if (rapid.prospects.length > 0) return NextResponse.json(rapid);
      } catch {
        // Quota, outages, or empty provider — fall through to OpenStreetMap.
      }
    }

    const result =
      googleKey && googleExplicitlyEnabled
        ? await researchWithGoogle(address, radiusMiles, googleKey)
        : await researchWithOpenStreetMap(address, radiusMiles);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research provider failed.";
    return NextResponse.json(
      { error: message, retryable: !message.includes("could not be located") },
      { status: message.includes("could not be located") ? 422 : 502 },
    );
  }
}
