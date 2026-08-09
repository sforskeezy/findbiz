import { NextResponse } from "next/server";

import { NO_STORE_HEADERS, checkRateLimit, parseBoundedJson, placeSearchRequestSchema, validationMessage } from "@/lib/api-safety";
import { PAI_PLACES_LABEL, paiNearby } from "@/lib/pai-places";
import { redactError } from "@/lib/request-safety";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE_HEADERS, ...headers } });
}

export async function POST(request: Request) {
  const rate = checkRateLimit(request, "places-nearby", 20);
  if (!rate.allowed) return json({ error: "Too many searches. Try again shortly.", code: "RATE_LIMITED" }, 429, { "Retry-After": String(rate.retryAfterSeconds) });

  let raw: unknown;
  try {
    raw = await parseBoundedJson(request);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
    return json({ error: tooLarge ? "Request payload is too large." : "Request body must be valid JSON.", code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON" }, tooLarge ? 413 : 400);
  }
  const parsed = placeSearchRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: validationMessage(parsed.error), code: "INVALID_REQUEST" }, 400);

  try {
    const result = await paiNearby(parsed.data.address, parsed.data.radiusMiles);
    return json({
      provider: "pai_places",
      attribution: PAI_PLACES_LABEL,
      target: {
        formattedAddress: result.target.formattedAddress,
        coordinates: result.target.coordinates,
        geocodingConfidence: result.target.confidence,
        geocoder: result.target.provider,
      },
      radiusMiles: result.radiusMiles,
      count: result.prospects.length,
      places: result.prospects,
      eligibilityUnknown: result.eligibilityUnknown.length,
      diagnostics: result.diagnostics,
      partialCoverage: result.diagnostics.partialCoverage,
      retrievedAt: result.retrievedAt,
    });
  } catch (error) {
    const message = redactError(error, "Places lookup failed.");
    const notFound = error instanceof Error && error.message.includes("could not be located");
    return json({ error: message, code: notFound ? "LOCATION_NOT_FOUND" : "PLACES_FAILED", retryable: !notFound }, notFound ? 422 : 502);
  }
}
