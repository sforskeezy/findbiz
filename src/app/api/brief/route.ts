import { NextResponse } from "next/server";

import { NO_STORE_HEADERS, checkRateLimit, parseBoundedJson, validationMessage } from "@/lib/api-safety";
import { briefRequestSchema } from "@/lib/brief-schema";
import { generateResearchBrief, researchBriefConfigured } from "@/lib/research-brief";

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...NO_STORE_HEADERS, ...headers } });
}

export async function POST(request: Request) {
  const rate = checkRateLimit(request, "brief", 12);
  if (!rate.allowed) return json({ error: "Too many brief requests.", code: "RATE_LIMITED" }, 429, { "Retry-After": String(rate.retryAfterSeconds) });
  if (!researchBriefConfigured()) return json({ error: "Profile generation is not configured.", code: "BRIEF_NOT_CONFIGURED" }, 503);
  let raw: unknown;
  try {
    raw = await parseBoundedJson(request, 24_576);
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
    return json({ error: tooLarge ? "Request payload is too large." : "Request body must be valid JSON.", code: tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON" }, tooLarge ? 413 : 400);
  }
  const parsed = briefRequestSchema.safeParse(raw);
  if (!parsed.success) return json({ error: validationMessage(parsed.error), code: "INVALID_REQUEST" }, 400);
  try {
    return json({ brief: await generateResearchBrief(parsed.data) });
  } catch {
    return json({ error: "Profile generation failed; use the deterministic fallback.", code: "BRIEF_FAILED" }, 502);
  }
}
