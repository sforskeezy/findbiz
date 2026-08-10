import { createHash } from "node:crypto";

import { z } from "zod";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff",
} as const;

export const placeSearchRequestSchema = z
  .object({
    address: z.string().trim().min(6).max(300),
    radiusMiles: z.union([z.literal(0.25), z.literal(0.5), z.literal(1), z.literal(2), z.literal(3), z.literal(5)]),
  })
  .strict();

export const fccRequestSchema = z
  .object({
    address: z.string().trim().min(6).max(300),
    coordinates: z
      .object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) })
      .strict()
      .optional(),
    locationId: z.string().regex(/^\d+$/).max(24).optional(),
  })
  .strict();

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function anonymousClientKey(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export function checkRateLimit(request: Request, scope: string, limit: number, windowMs = 60_000) {
  const key = `${scope}:${anonymousClientKey(request)}`;
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  current.count += 1;
  return {
    allowed: current.count <= limit,
    retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1_000)),
  };
}

export async function parseBoundedJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("INVALID_JSON");
  }
}

export function validationMessage(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return "Request validation failed.";
  const field = issue.path.join(".") || "request";
  return `Invalid ${field}.`;
}

export function clearRateLimitsForTests() {
  rateBuckets.clear();
}
