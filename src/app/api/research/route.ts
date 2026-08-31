import { NextResponse } from "next/server";

import { generateDemoResearch } from "@/lib/demo-data";
import { researchAcrossSources } from "@/lib/discovery";

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

  if (process.env.USE_DEMO_DATA === "true") {
    return NextResponse.json(generateDemoResearch(address, radiusMiles));
  }

  try {
    return NextResponse.json(await researchAcrossSources(address, radiusMiles));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Research provider failed.";
    const notFound = message.includes("could not be located");
    return NextResponse.json({ error: message, retryable: !notFound }, { status: notFound ? 422 : 502 });
  }
}
