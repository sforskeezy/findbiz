import { NextResponse } from "next/server";

import { NO_STORE_HEADERS, checkRateLimit, fccRequestSchema, parseBoundedJson, validationMessage } from "@/lib/api-safety";
import { lookupFccAvailability } from "@/lib/fcc";
import { classifyServiceability } from "@/lib/serviceability";

export const runtime = "nodejs";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE_HEADERS, ...headers } });
}

export async function POST(request: Request) {
  const rate = checkRateLimit(request, "fcc", 30);
  if (!rate.allowed) return json({ error: "Too many FCC lookups.", code: "RATE_LIMITED" }, 429, { "Retry-After": String(rate.retryAfterSeconds) });
  let raw: unknown;
  try {
    raw = await parseBoundedJson(request, 8_192);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
    return json({ error: tooLarge ? "Request payload is too large." : "Request body must be valid JSON.", code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON" }, tooLarge ? 413 : 400);
  }
  const parsed = fccRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: validationMessage(parsed.error), code: "INVALID_REQUEST" }, 400);
  const result = await lookupFccAvailability(parsed.data);
  return json({ ...result, serviceability: classifyServiceability(result) }, result.status === "error" ? 502 : 200);
}
