import { NextResponse } from "next/server";

import { fccRuntimeConfigured } from "@/lib/fcc";
import { googleMapsScraperEnabled } from "@/lib/google-maps-scraper";
import { hasGooglePlacesKey } from "@/lib/google-places";
import { googleResearchStatus } from "@/lib/google-research-engine";
import { PAI_PLACES_LABEL } from "@/lib/pai-places";
import { placesCacheStatus } from "@/lib/places-cache";
import { hasRapidApiKey } from "@/lib/rapidapi-local-business";
import { liveAssistantStatus } from "@/lib/live/engine";
import { liveStoreStatus } from "@/lib/live/store";
import { radarBriefStatus } from "@/lib/radar/brief";
import { radarStoreStatus } from "@/lib/radar/store";
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
    businessDataMode: "multi_source",
    discoveryProviders: {
      googleMapsScraper: googleMapsScraperEnabled() ? "active" : "disabled",
      googlePlaces: googleOptIn ? "active" : "not_configured",
      rapidApiMapsData: rapidOptIn ? "active" : "not_configured",
      paiPlaces: "active",
      note: "Research prefers the first-party Google Maps scraper, merges any optional licensed feeds, and keeps PAI Places as the not-on-Google backstop.",
    },
    googleMapsScraperApi: "/api/maps/search",
    publicWebResearch: {
      officialWebsite: "active",
      googleResearchEngine: googleResearchStatus(),
      allowedSearchDomains: (process.env.RESEARCH_SEARCH_DOMAINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    },
    live: {
      chatApi: "/api/live/chat",
      store: await liveStoreStatus(),
      assistant: liveAssistantStatus(),
    },
    radar: {
      scanApi: "/api/radar/scan",
      store: await radarStoreStatus(),
      brief: radarBriefStatus(),
    },
    databaseConfigured: Boolean(process.env.DATABASE_URL),
    fccMode: fccRuntimeConfigured()
      ? process.env.COSTQUEST_API_TOKEN
        ? "official_exact_and_area"
        : "official_area"
      : "not_configured",
  });
}
