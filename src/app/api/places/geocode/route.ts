import { NextResponse } from "next/server";
import { z } from "zod";

import { NO_STORE_HEADERS, checkRateLimit, parseBoundedJson, validationMessage } from "@/lib/api-safety";
import { paiGeocode } from "@/lib/pai-places";
import { redactError } from "@/lib/request-safety";

const schema = z.object({ address: z.string().trim().min(6).max(300) }).strict();

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function POST(request: Request) {
  const rate = checkRateLimit(request, "geocode", 30);
  if (!rate.allowed) return json({ error: "Too many geocoding requests.", code: "RATE_LIMITED" }, 429);
  let raw: unknown;
  try {
    raw = await parseBoundedJson(request, 4_096);
  } catch (error) {
    return json({ error: error instanceof Error && error.message === "PAYLOAD_TOO_LARGE" ? "Request payload is too large." : "Request body must be valid JSON.", code: "INVALID_JSON" }, 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return json({ error: validationMessage(parsed.error), code: "INVALID_REQUEST" }, 400);
  try {
    const result = await paiGeocode(parsed.data.address);
    return json({
      provider: "pai_places",
      geocoder: result.provider,
      attribution: "US Census Geocoder; Photon and Nominatim / OpenStreetMap contributors",
      formattedAddress: result.formattedAddress,
      coordinates: result.coordinates,
      confidence: result.confidence,
      retrievedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = redactError(error, "Geocoding failed.");
    const notFound = error instanceof Error && error.message.includes("could not be located");
    return json({ error: message, code: notFound ? "LOCATION_NOT_FOUND" : "GEOCODE_FAILED", retryable: !notFound }, notFound ? 422 : 502);
  }
}
