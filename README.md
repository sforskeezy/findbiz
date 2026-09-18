# PAI / ProspectIQ

Independent, open-source business prospect research helper.

**Not affiliated with Charter Communications, Spectrum, or Spectrum Business.**

1. Enter an address.
2. Choose a nearby business from public/licensed directory data.
3. Review a public-business brief, official FCC broadband availability observations, and optional outreach draft.

There is no map dashboard and **no connection to any Spectrum internal system**.

- Public repo purpose: full transparency if a manager, compliance reviewer, or auditor asks what the tool is.
- Compliance statement: [`COMPLIANCE.md`](./COMPLIANCE.md)
- Legal notices: [`NOTICE`](./NOTICE) · [`LICENSE`](./LICENSE) (MIT)

> This product uses the FCC Data API but is not endorsed or certified by the FCC.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`. The built-in Google Maps scraper and PAI Places both work without an API key. The scraper is enabled by default and retrieves public listing names, addresses, phones, websites, hours, ratings, descriptions, coordinates, Place IDs, and source links.

Copy `.env.example` to `.env.local` and fill only the keys you are licensed to use. Optional profile/outreach drafting uses Claude Opus 5 by default (`RESEARCH_MODEL=claude-opus-5`) via the Anthropic Messages API (`RESEARCH_BASE_URL=https://api.anthropic.com/v1`) or any OpenAI-compatible proxy that serves the same model. Deterministic application code owns the numeric fit score.

## Multi-source business discovery

`POST /api/research` now queries every source the operator enables, merges likely duplicates, and retains source attribution on each business:

1. **Built-in Google Maps scraper** — primary, keyless discovery through Google Maps' public search responses.
2. **Google Places API (New)** — optional licensed enrichment when explicitly configured.
3. **RapidAPI Maps Data** — optional licensed enrichment when explicitly configured.
4. **PAI Places** — always-on public-data backstop using the local cache and OpenStreetMap, including operator-entered companies and businesses that may not have a Google listing.

The built-in scraper first loads the public Maps search page, follows its same-origin map-search data link, parses the returned listing records, discards permanently closed and non-business infrastructure entries, applies the requested radius strictly, and deduplicates businesses by Place ID. It runs a configurable set of 28 business-intent searches so it can find contractors, farms, manufacturers, professional offices, services, retail, hospitality, and other companies that one generic query often misses.

Configure the direct scraper:

```dotenv
ENABLE_GOOGLE_MAPS_SCRAPER=true
GOOGLE_MAPS_SCRAPER_MAX_QUERIES=28
GOOGLE_MAPS_SCRAPER_CONCURRENCY=2
GOOGLE_MAPS_SCRAPER_DELAY_MS=250
GOOGLE_MAPS_SCRAPER_CACHE_TTL_SECONDS=900
GOOGLE_MAPS_SCRAPER_QUERIES=
```

`GOOGLE_MAPS_SCRAPER_QUERIES` can replace the default keywords with a comma-separated list. The defaults deliberately keep concurrency conservative, add a delay between work items, cache identical searches, coalesce concurrent duplicates, and stop on a block response. The implementation does not solve CAPTCHAs, rotate identities, or bypass access controls. Public page formats and provider rules can change, so operators should verify results and review the provider's current terms before production or high-volume use.

The dedicated endpoint is:

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/maps/search` | `{ address, radiusMiles, queries? }` | Direct Google Maps results plus query diagnostics and source attribution |

To merge licensed official Places data as an additional source, set `ENABLE_GOOGLE_PLACES=true` and `GOOGLE_MAPS_API_KEY`. That key is not required for direct scraping.

### Public website and indexed-web research

Selecting a business calls `POST /api/company-intelligence`. The server reads up to five public pages from the business's official website (home plus linked about/contact/company pages) and extracts only published evidence:

- phone numbers and email addresses;
- legal name, founding date, and published team size;
- structured identifiers such as LEI, D-U-N-S, NAICS, tax/VAT ID, or an explicitly labeled company/registration/entity number;
- official profiles and the company's own meta description.

Every fact in the Evidence tab links to its source and is labeled Verified or Estimated. The crawler blocks local/private network destinations, validates redirects, limits response size and page count, and never guesses a hidden phone number or identifier.

Existing Google Custom Search JSON API customers can add indexed results. Google has closed that API to new customers and announced a January 1, 2027 discontinuation, so this integration is optional:

```dotenv
GOOGLE_SEARCH_API_KEY=
GOOGLE_SEARCH_ENGINE_ID=
RESEARCH_SEARCH_DOMAINS=example-state-registry.gov,trusted-directory.example
```

When `RESEARCH_SEARCH_DOMAINS` is empty, the configured Programmable Search Engine controls scope. When it is set, the query is limited to those domains.

## PAI Places — keyless public-data backstop

PAI Places remains a first-party API owned by this app. It needs no third-party key and calls no commercial map provider.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/places/geocode` | `{ address }` | Coordinates from the US Census geocoder, Photon, or Nominatim |
| `POST /api/places/nearby` | `{ address, radiusMiles }` | Nearby businesses, their distances, and source attribution |

PAI Places sources, in priority order:

1. **Your local cache** — `data/places-cache.json`, businesses you enter yourself.
2. **OpenStreetMap** via Overpass, queried across shop, craft, office, healthcare, industrial, farmyard, commercial-landuse, named commercial buildings, and operator tags.

Geocoding uses the US Census geocoder first, then Photon and Nominatim.

**Be aware of the coverage limit.** OpenStreetMap is volunteer-mapped and thin in rural areas. A business that appears on a commercial map may simply not exist in OSM, in which case PAI Places cannot invent it. When a radius comes back empty, the response reports how far away the nearest mapped business is instead of silently returning nothing.

Check coverage for any address before assuming a bug:

```powershell
npm run places:probe -- "46 Carina Ln, Lugoff, SC 29078" 1
```

### Adding businesses PAI Places cannot find

Copy `data/places-cache.example.json` to `data/places-cache.json` and add your own entries. Only `name` is required; supply `lat`/`lng` for exact placement, or just an `address` and PAI Places geocodes it at request time. Cached entries outrank map data during dedupe and are labeled "Manually entered" in the UI. The file is gitignored.

Record businesses you verified yourself. Do not paste listing data copied out of a commercial map provider.

`GET /api/status` reports which discovery, public-web research, brief-generation, database, and FCC paths are currently configured.

## Real FCC data

The supported FCC public API provides bulk downloads, not a documented per-address lookup endpoint. ProspectIQ therefore queries a local SQLite index built from official fixed-availability CSV downloads. It never scrapes the public map or treats availability as proof of a current subscription.

Get an FCC account email and API token from the National Broadband Map's **Manage API Access** screen, download the required state fixed-availability ZIPs, unzip the CSVs, then import them:

```powershell
npm run fcc:import -- --db data/fcc.sqlite --as-of 2025-12-31 --fabric-vintage 202512 C:\path\to\fixed-availability.csv
```

Use the actual FCC data date and corresponding six-digit Fabric vintage. Then configure:

```dotenv
FCC_AVAILABILITY_DB_PATH=data/fcc.sqlite
```

With only the official index, ProspectIQ returns provider-reported business availability from the business coordinate's FCC H3 resolution-8 area and labels it as area-level, not exact-address evidence.

Exact matching additionally requires a commercial CostQuest Fabric/API license:

```dotenv
COSTQUEST_API_TOKEN=
COSTQUEST_MATCH_MIN_SIMILARITY=0.95
```

Exact results are accepted only for one full-address match above the configured threshold and queried by the numeric FCC Location ID from the same vintage. If the index or address-matching credential is absent, the Broadband tab says so and generates no provider claim.

Official references: [FCC National Broadband Map](https://broadbandmap.fcc.gov/home), [FCC public data API specification](https://us-fcc.app.box.com/v/bdc-public-data-api-spec), [FCC API Terms of Service](https://www.fcc.gov/reports-research/developers/api-terms-service), and [CostQuest Match API](https://apidocs.costquest.com/guides/match/).

## Verification

```powershell
npm run lint
npm run typecheck
npm run build
```

Saved businesses remain in browser `localStorage`; selected search state uses `sessionStorage`. Secrets and local FCC indexes are ignored by Git.

## Swarm mode

`/swarm` replaces Auto. Paste up to 1,000 addresses, one per line with a city/state or ZIP. Discovery runs six addresses concurrently; availability runs twelve profiles concurrently, with one checkpoint per qualification group. Census-block FCC reports share in-flight requests for one minute. This is a bounded provider search, not an exhaustive census.

Swarm preserves source-address provenance and merges duplicate business locations. Results include ranked prospects, an interactive territory map, geographic clusters, CSV/copy export and public company research. Provider reports keep their vintage and matching quality; availability does not establish the current ISP or orderability. Spectrum/Charter reports are highlighted in green. Address and phone buttons copy values; phone output uses digits only.

**Saved businesses** retains complete profiles, research, contact names, editable notes and the latest call outcome in the workspace database. Existing browser IndexedDB records import once without overwriting newer server records. **Never see again** excludes that business location from all batches, maps, call queues and exports; Hidden provides a restore action.

**Call queue** replaces route building. It prioritizes due callbacks, then untouched prospects, ordered by opportunity rank. Reps copy the business number, edit notes and save Connected, No answer or Call back with a callback time. No calls are placed automatically. Call outcomes and notes are available in Saved businesses.

**Clusters** support right-click or the options button → Mark as already looked at. Review memory is keyed to the geographic cell across batches. Newly discovered businesses in reviewed cells remain visible, with a “new since review” count. The map outlines reviewed cells.

Double-click a business name or non-interactive row area to hide it across Swarms. Copy controls and checkboxes never trigger hiding. The row shakes while saving and fades away after success, with an Undo action. Keyboard users can hide from the profile. Saved businesses use the same behavior. Motion respects reduced-motion preferences.

The compact batch sidebar uses an animated orbit icon and scrolls long names on hover/focus. Right-click or open the options button to rename, pause/resume, copy a batch link, or remove. Removal pauses the worker and archives the batch; Undo and the Removed batches section restore it without losing research.

### Durable Convex storage

Swarm, lead books and territory review memory use Convex whenever `CONVEX_URL` and `FINDBIZ_STORAGE_SECRET` are configured. Compressed immutable snapshots use Convex file storage; indexed database records hold the current snapshot, summary and revision. Compare-and-set mutations atomically advance checkpoints and worker leases across server instances. Large batches avoid database document/write-throughput limits. Old snapshots are retained for an hour for in-flight readers, then removed. Public file URLs are only fetched on the server, never returned to the browser.

Serverless hosts **refuse to create temporary Swarm data** when Convex is missing. A storage outage preserves results already on screen and retries. Local development can still use `SWARM_STORE_PATH=data/swarm`. Previously expired serverless files cannot be reconstructed.

1. Run `npx convex dev` to connect a FindBiz project.
2. Configure `CONVEX_URL` and a randomly generated `FINDBIZ_STORAGE_SECRET` on the Next.js server. Set the same secret on Convex using `npx convex env set FINDBIZ_STORAGE_SECRET --from-file <secret-file>`. Never prefix the secret with `NEXT_PUBLIC_`.
3. Deploy production functions with `npx convex deploy`, then point Netlify's server variables to the **production** deployment and matching secret.
4. Set `FINDBIZ_APP_URL` on production Convex to the application's HTTPS origin. The one-minute Convex cron wakes up to four pending Swarms in oldest-updated order through an authenticated worker endpoint. Checkpoints recover interrupted jobs after the 90-second renewable lease expires. Work also advances from page requests.
5. To import existing local batches and lead records, run `node --env-file=.env.local --import ./scripts/test-register.mjs scripts/migrate-swarm.mjs`. It never overwrites an existing cloud record and retains local originals. Run it with the target deployment's URL and matching secret.

This installation is one shared rep workspace, not an authenticated multi-tenant application. Protect access to the deployment for private rep notes. Live's separate transcript store still uses `LIVE_STORE_PATH`; on serverless hosts those transcripts remain temporary unless placed on durable storage.

## Live memory

Live saves complete conversations without the previous 40-message/40-chat cutoff. Every turn retrieves relevant excerpts from saved chats, previous territory checks, seen businesses, and Swarm batches. Live can search older conversations, resume a previous chat's list and filters, and explain its actual configured capabilities without exposing credentials. New discovery excludes previously seen businesses unless the user explicitly requests a refresh/recheck. Multiple territory notes are retained, and concurrent saves are serialized to prevent lost history entries.

Historical evidence is dated and distinct from a fresh verification. Removing a chat deletes its transcript from history retrieval; explicit remembered facts can be removed separately. Previously truncated or lost serverless history cannot be reconstructed by this update.
