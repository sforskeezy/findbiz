import { NextResponse } from "next/server";

import { lookupFccAvailability } from "@/lib/fcc";
import { classifyServiceability } from "@/lib/serviceability";
import type { Coordinates } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: {
    address?: string;
    coordinates?: Coordinates;
    locationId?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const address = body.address?.trim() || "";
  const locationId = body.locationId?.trim();
  if (address.length < 6 || address.length > 300) {
    return NextResponse.json({ error: "A complete, bounded business address is required." }, { status: 400 });
  }
  if (locationId && !/^\d+$/.test(locationId)) {
    return NextResponse.json({ error: "FCC Location ID must be numeric." }, { status: 400 });
  }
  if (
    body.coordinates &&
    (!Number.isFinite(body.coordinates.lat) ||
      !Number.isFinite(body.coordinates.lng) ||
      Math.abs(body.coordinates.lat) > 90 ||
      Math.abs(body.coordinates.lng) > 180)
  ) {
    return NextResponse.json({ error: "Business coordinates are invalid." }, { status: 400 });
  }

  const result = await lookupFccAvailability({
    address,
    coordinates: body.coordinates,
    locationId,
  });
  return NextResponse.json(
    {
      ...result,
      serviceability: classifyServiceability(result),
    },
    { status: result.status === "error" ? 502 : 200 },
  );
}
