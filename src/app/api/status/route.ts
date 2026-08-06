import { NextResponse } from "next/server";

import { fccRuntimeConfigured } from "@/lib/fcc";
import { researchBriefConfigured } from "@/lib/research-brief";

export function GET() {
  return NextResponse.json({
    researchBriefConfigured: researchBriefConfigured(),
    googlePlacesConfigured:
      Boolean(process.env.GOOGLE_MAPS_API_KEY) && process.env.ENABLE_GOOGLE_PLACES === "true",
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    businessDataMode:
      Boolean(process.env.GOOGLE_MAPS_API_KEY) && process.env.ENABLE_GOOGLE_PLACES === "true"
        ? "google_places"
        : "openstreetmap",
    fccMode: fccRuntimeConfigured()
      ? process.env.COSTQUEST_API_TOKEN
        ? "official_exact_and_area"
        : "official_area"
      : "not_configured",
  });
}
