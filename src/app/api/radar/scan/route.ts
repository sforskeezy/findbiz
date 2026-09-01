import { radarBriefStatus } from "@/lib/radar/brief";
import { runTerritoryScan } from "@/lib/radar/engine";
import { RADAR_RADII } from "@/lib/radar/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Request body must be valid JSON." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const locationQuery =
    typeof body === "object" && body !== null && "locationQuery" in body && typeof body.locationQuery === "string"
      ? body.locationQuery.trim()
      : "";
  const radiusMiles =
    typeof body === "object" && body !== null && "radiusMiles" in body ? Number(body.radiusMiles) : 5;
  const categoryFilter =
    typeof body === "object" && body !== null && "categoryFilter" in body && typeof body.categoryFilter === "string"
      ? body.categoryFilter.trim()
      : null;

  if (locationQuery.length < 3 || locationQuery.length > 300) {
    return new Response(JSON.stringify({ error: "Enter a city, ZIP, address, or territory between 3 and 300 characters." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!RADAR_RADII.includes(radiusMiles as (typeof RADAR_RADII)[number])) {
    return new Response(JSON.stringify({ error: "Choose a supported Radar radius." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  async function send(event: unknown) {
    await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }

  void (async () => {
    try {
      await runTerritoryScan({
        locationQuery,
        radiusMiles,
        categoryFilter,
        onEvent: send,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Radar scan failed.";
      try {
        await send({ type: "error", error: message });
      } catch {
        // The client may already be gone.
      }
    } finally {
      try {
        await writer.close();
      } catch {
        // Stream already closed.
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET() {
  return Response.json({
    radii: RADAR_RADII,
    brief: radarBriefStatus(),
  });
}
