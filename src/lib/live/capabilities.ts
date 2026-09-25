import { googleMapsScraperEnabled } from "@/lib/google-maps-scraper";
import { hasGooglePlacesKey } from "@/lib/google-places";
import { hasRapidApiKey } from "@/lib/rapidapi-local-business";
import { isServerlessFilesystem } from "@/lib/writable-store";
import { cloudConfigured } from "@/lib/swarm/cloud-store";

/** Public runtime facts only. Never expose keys, secrets, or environment values. */
export function liveCapabilities() {
  return {
    modes: { normal: "Single-address discovery and business profiles", live: "Conversation, public research, call prep and cross-chat memory", swarm: "Batch discovery, deduplication, reviewed geographic clusters, territory map, saved businesses with editable notes, a Funnel at /swarm?view=funnel for customer and account details, blue/red/yellow/green sales stages, Excel and text imports, follow-up dates, filtering and export, an Opportunity Finder across all saved Swarms with industry/provider/contact filters, same-industry lookalikes and call-sheet export, CSV export and selected-business research at /swarm. Double-click hides a business with Undo. Batch settings support rename, pause, removal and restore." },
    swarmStorage: { backend: cloudConfigured() ? 'durable Convex database and snapshots' : 'local workspace files; serverless hosts require Convex', retains: ['batches','saved and hidden businesses','contact notes','call outcomes and callbacks','reviewed clusters'], scope: 'One shared rep workspace' },
    discovery: { mapsScraper: googleMapsScraperEnabled(), googlePlaces: hasGooglePlacesKey(), rapidApi: hasRapidApiKey(), openStreetMapAndLocalCache: true },
    research: "Public company websites and indexed web search; no private personal dossiers or direct access to a business's ISP account.",
    broadband: { localIndexConfigured: Boolean(process.env.FCC_AVAILABILITY_DB_PATH), legacyPublicFallback: true, currentProviderKnown: false, note: "FCC availability describes reported providers at an address/area, NOT who a business subscribes to or guaranteed orderability. Legacy fallback is June 2021 and must be dated." },
    memory: { crossChatSearch: true, resumePriorChat: true, seenBusinessesAcrossChats: true, storage: isServerlessFilesystem() ? "temporary host storage; durable memory requires a persistent deployment" : "saved on this installation's disk", scope: "This installation is a single-rep workspace; it is not an authenticated multi-user service." },
    limitations: ["No backend source-code or shell access inside Live. Use these runtime facts and the provided tools.", "Swarm batches are operated in /swarm; Live can explain them but does not start a batch through chat.", "Never claim internet subscriptions, Spectrum orderability, or competitor customers from availability data."],
  };
}
