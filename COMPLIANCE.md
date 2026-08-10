# Compliance and intended use

PAI Places / FindBiz is an independent, unofficial, open-source helper for discovering local businesses and organizing public facts. It is not legal advice, employer approval, or an official product of Charter Communications, Spectrum, the FCC, Overture Maps Foundation, OpenStreetMap Foundation, or any data provider.

## Hard boundaries

- Use public or properly licensed external business data only.
- Never connect to employer credentials, cookies, CRM records, internal APIs, internal serviceability systems, proprietary surveys, pricing systems, customer records, lead lists, or confidential information.
- Never scrape or automate Spectrum websites or Google Maps.
- Never automate calls, email, texts, or outreach.
- Never claim affiliation, endorsement, legal approval, employer approval, serviceability, a current provider, a subscription, pricing, or contract status.
- Never persist prospect searches, selected businesses, notes, addresses, phone numbers, provider payloads, or generated briefs.

The UI's optional outreach text is a draft for a human to review and copy. It does not send anything.

## Business discovery sources

PAI Places is a product layer over disclosed sources:

- Overture Maps Places: local bounded GeoParquet; display `Overture Maps Foundation` and follow the [current attribution requirements](https://docs.overturemaps.org/attribution/), including applicable upstream licenses.
- OpenStreetMap: supplemental contributor data; display `© OpenStreetMap contributors` and follow ODbL and public-service usage policies.
- Optional commercial provider: disabled until a written contract expressly permits business discovery and sales prospecting and its attribution, display, export, retention, directory, and lead-generation conditions are documented.
- Optional manual entry: current in-memory request/session only, never a persisted cache.

An API returning business information does not, by itself, establish permission for this use.

Google Maps may be opened by the user in a normal browser link for manual verification. FindBiz does not ingest, parse, scrape, automate, save, or bulk-extract Google results.

## Eligibility and research limits

Structured categories and status fields drive exclusion before name keywords. The primary list excludes banks/ATMs, traditional schools, permanently closed businesses, government-only facilities, configured national enterprises, and apartment properties authoritatively confirmed above nine units.

Apartment unit counts are never inferred from a name, imagery, review count, rooms, bedrooms, or building count. An apartment with unknown units is hidden in an eligibility-unknown group. A chain brand does not alone prove corporate ownership; franchise-uncertain locations remain uncertain unless evidence supports exclusion.

Ranking is a prospect-research heuristic, not a probability of sale, need, qualification, or serviceability. Category-based operations are hypotheses to test.

## FCC evidence

Only current Broadband Data Collection information from a locally prepared official index is supported. There is no June 2021 Form 477 fallback.

- `exact_location`: filing evidence tied to an FCC Location ID; still not orderability.
- `nearby_area`: `Nearby market context—not availability at this address`.
- `no_report`: no row in the loaded current dataset; not proof of unavailability.
- `Data unavailable`: current BDC data is absent or could not be queried.

Maximum-advertised download/upload pairs are preserved as filed. Residential or nearby evidence is never represented as business availability. Exact full-address Fabric matching requires a separate CostQuest license.

Required FCC notice: **This product uses the FCC Data API but is not endorsed or certified by the FCC.**

## Zero retention and API safety

- Search inputs are sent with POST and not encoded into application URLs.
- Browser `localStorage` and `sessionStorage` are not used for research data.
- No prospect database schema or CSV export is included.
- Research state lives only in memory and clears on refresh.
- Sensitive routes use `Cache-Control: no-store`, bounded strict schemas, payload limits, timeouts, rate limits, cancellation, provider isolation, and redacted errors.
- API keys remain server-side and status responses expose no keys or local paths.
- Short-lived process-memory cache/coalescing is allowed only to protect providers and is not durable storage.

Third-party providers may retain requests under their own policies. Review those policies before configuration.

## Human responsibility

Verify facts and eligibility before outreach. Generated text treats external business text as untrusted data, uses a strict response schema, and cannot change deterministic eligibility. A human remains responsible for every representation and communication.
