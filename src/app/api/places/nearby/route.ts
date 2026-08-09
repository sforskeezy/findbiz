import { NextResponse } from "next/server";

import { PAI_PLACES_LABEL, paiNearby } from "@/lib/pai-places";

const allowedRadii = new Set([0.25, 0.5, 1, 2, 5]);

/**
 * PAI Places nearby — FindBiz's own business discovery endpoint.
 * POST { address, radiusMiles } → businesses from OpenStreetMap + local cache.
 */
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
    typeof body === "object" && body !== null && "radiusMiles" in body ? Number(body.radiusMiles) : 0.5;

  if (address.length < 6 || address.length > 300) {
    return NextResponse.json(
      { error: "Enter a complete street address between 6 and 300 characters." },
      { status: 400 },
    );
  }
  if (!allowedRadii.has(radiusMiles)) {
    return NextResponse.json({ error: "Choose a supported search radius." }, { status: 400 });
  }

  try {
    const result = await paiNearby(address, radiusMiles);
    return NextResponse.json({
      provider: "pai_places",
      attribution: PAI_PLACES_LABEL,
      target: {
        inputAddress: address,
        formattedAddress: result.target.formattedAddress,
        coordinates: result.target.coordinates,
        geocodingConfidence: result.target.confidence,
        geocoder: result.target.provider,
      },
      radiusMiles: result.radiusMiles,
      count: result.prospects.length,
      counts: { openStreetMap: result.osmCount, localCache: result.cacheCount },
      nearestBeyondRadius: result.nearestBeyondRadius,
      places: result.prospects.map((place) => ({
        id: place.id,
        name: place.name,
        address: place.address,
        coordinates: place.coordinates,
        distanceMiles: place.distanceMiles,
        category: place.category,
        phone: place.phone,
        website: place.website,
        directoryUrl: place.directoryUrl,
        source: place.source,
        confidence: place.confidence,
        score: place.score,
      })),
      retrievedAt: result.retrievedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Places lookup failed.";
    const notFound = message.includes("could not be located");
    return NextResponse.json({ error: message, retryable: !notFound }, { status: notFound ? 422 : 502 });
  }
}
