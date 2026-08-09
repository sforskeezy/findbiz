import { NextResponse } from "next/server";

import { fccRuntimeConfigured } from "@/lib/fcc";
import { hasGooglePlacesKey } from "@/lib/google-places";
import { PAI_PLACES_LABEL } from "@/lib/pai-places";
import { placesCacheStatus } from "@/lib/places-cache";
import { hasRapidApiKey } from "@/lib/rapidapi-local-business";
import { researchBriefConfigured } from "@/lib/research-brief";

export async function GET() {
  const cache = await placesCacheStatus();
  const googleOptIn = hasGooglePlacesKey();
  const rapidOptIn = hasRapidApiKey();

  return NextResponse.json({
    researchBriefConfigured: researchBriefConfigured(),
    paiPlaces: {
      geocodeApi: "/api/places/geocode",
      nearbyApi: "/api/places/nearby",
      attribution: PAI_PLACES_LABEL,
      discoverySources: ["OpenStreetMap (Overpass)", "Local PAI Places cache"],
      geocoders: ["US Census", "Photon", "Nominatim"],
      localCache: cache,
    },
    // /api/research always uses PAI Places. Deprecated providers are never primary.
    businessDataMode: "pai_places",
    deprecatedProviders: {
      googlePlaces: googleOptIn ? "opt_in_available_unused_by_research" : "disabled",
      rapidApiMapsData: rapidOptIn ? "opt_in_available_unused_by_research" : "disabled",
      note: "Research and /api/places/* always use PAI Places. Google/RapidAPI modules remain in the tree but are not called by default.",
    },
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    fccMode: fccRuntimeConfigured()
      ? process.env.COSTQUEST_API_TOKEN
        ? "official_exact_and_area"
        : "official_area"
      : "not_configured",
  });
}
