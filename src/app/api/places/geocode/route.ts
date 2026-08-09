import { NextResponse } from "next/server";

import { paiGeocode } from "@/lib/pai-places";

/**
 * PAI Places geocode — FindBiz's own endpoint.
 * POST { address } → coordinates from US Census / Photon / Nominatim.
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

  if (address.length < 6 || address.length > 300) {
    return NextResponse.json(
      { error: "Enter a complete street address between 6 and 300 characters." },
      { status: 400 },
    );
  }

  try {
    const result = await paiGeocode(address);
    return NextResponse.json({
      provider: "pai_places",
      geocoder: result.provider,
      attribution: "US Census Geocoder, Photon (OpenStreetMap), Nominatim (OpenStreetMap)",
      inputAddress: address,
      formattedAddress: result.formattedAddress,
      coordinates: result.coordinates,
      confidence: result.confidence,
      retrievedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Geocoding failed.";
    const notFound = message.includes("could not be located");
    return NextResponse.json({ error: message, retryable: !notFound }, { status: notFound ? 422 : 502 });
  }
}
