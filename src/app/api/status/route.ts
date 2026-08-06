import { NextResponse } from "next/server";

import { fccRuntimeConfigured } from "@/lib/fcc";
import { researchBriefConfigured } from "@/lib/research-brief";

export function GET() {
  const googleKey = Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());
  const googleEnabled = process.env.ENABLE_GOOGLE_PLACES !== "false";
  const googlePlacesConfigured = googleKey && googleEnabled;
  const rapidConfigured = Boolean(process.env.RAPIDAPI_KEY?.trim());

  return NextResponse.json({
    researchBriefConfigured: researchBriefConfigured(),
    googlePlacesConfigured,
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    businessDataMode: rapidConfigured
      ? "rapidapi_maps_data"
      : googlePlacesConfigured
        ? "google_places"
        : "openstreetmap",
    fccMode: fccRuntimeConfigured()
      ? process.env.COSTQUEST_API_TOKEN
        ? "official_exact_and_area"
        : "official_area"
      : "not_configured",
  });
}
