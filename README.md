# PAI Places / FindBiz

Independent, open-source local-business discovery and public-fact research.

**Not affiliated with, endorsed by, or connected to Charter Communications, Spectrum, or any employer system.** The application uses public or separately licensed external data only.

## What changed in PAI Places v2

PAI Places is the product name, not a claim that FindBiz owns an independent business database. Every result exposes its actual contributing sources and field provenance.

Discovery order:

1. A bounded local [Overture Maps Places](https://docs.overturemaps.org/guides/places/) GeoParquet dataset queried with DuckDB.
2. Supplemental OpenStreetMap data through conservative, sequential Overpass requests.
3. An optional generic commercial adapter that stays disabled until its contract is reviewed and acknowledged.
4. Optional request-scoped manual entries in memory only.

Results are deduplicated across sources, filtered for eligibility, ranked with an explained research heuristic, and returned with coverage/exclusion diagnostics. Permanently closed places, banks/ATMs, traditional schools, configured enterprises, government-only facilities, and confirmed apartment properties over nine units are removed from the primary list. Apartments with unknown unit counts are hidden in an eligibility-unknown group.

Google Maps is not scraped or ingested. A result can open a normal external “Verify on Google Maps” search for manual verification.

## Run locally

Node 22 LTS is the supported runtime.

```bash
nvm use
npm ci
npm run dev
```

Open `http://localhost:3000`. Copy `.env.example` to `.env.local` for optional sources.

## Configure Overture Places

Large Overture datasets are deliberately ignored by Git. The official `overturemaps` Python client reads the latest release from Overture's STAC catalog and transfers only a requested bounding box.

For a bounded public commercial area (this example covers part of Center City Philadelphia):

```bash
npm run overture:prepare -- \
  --bbox=-75.175,39.945,-75.145,39.965 \
  --output=data/overture/places.parquet
```

The script uses `uvx` when available. Otherwise install the official client first:

```bash
python3 -m pip install overturemaps
```

Then configure:

```dotenv
OVERTURE_PLACES_PATH=data/overture/places.parquet
OVERTURE_COVERAGE_BBOX=-75.175,39.945,-75.145,39.965
```

`OVERTURE_PLACES_PATH` may name one GeoParquet file or a directory of `.parquet` files. `OVERTURE_COVERAGE_BBOX` must match the exact boundary used for the extract; without it, status reports coverage as unknown rather than claiming the region is complete. At readiness time the application verifies that the file exists and that required Places fields can be queried. Searches are classified as inside, outside, or partially inside the configured boundary. A missing or incompatible dataset does not crash the search: PAI Places records `OVERTURE_FILE_MISSING` or `OVERTURE_SCHEMA_INVALID` and continues with successful supplemental sources without exposing the local path.

Official references:

- [Overture Python client](https://docs.overturemaps.org/getting-data/overturemaps-py/)
- [DuckDB access](https://docs.overturemaps.org/getting-data/duckdb/)
- [Places schema](https://docs.overturemaps.org/schema/reference/places/place/)
- [Attribution and licensing](https://docs.overturemaps.org/attribution/)

Display attribution is `Overture Maps Foundation`; upstream source requirements remain applicable. Overture source/update metadata is retained on normalized records when present.

## OpenStreetMap supplement

OSM requests use one Overpass endpoint at a time, bounded timeouts, sequential mirror fallback, retry/backoff, cancellation, coalescing, short memory caching, and an explicit request budget. Larger radiuses are split into controlled geographic cells. Core business categories run first; an extended commercial/industrial/agricultural pass runs when useful and budget permits. A capped search is labeled partial.

Configure an operator contact and optionally one preferred endpoint:

```dotenv
OSM_CONTACT_EMAIL=
OVERPASS_API_URL=https://overpass-api.de/api/interpreter
OVERPASS_MAX_REQUESTS=8
```

Follow the [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/), [Overpass public instance guidance](https://wiki.openstreetmap.org/wiki/Overpass_API), and display [OpenStreetMap attribution](https://www.openstreetmap.org/copyright). A record is not labeled freshly updated when OSM provides no timestamp.

## Optional licensed commercial source

The generic server-side adapter is disabled unless all configuration is present and `COMMERCIAL_PROVIDER_LICENSE_ACK` is set to the exact value below after contract review:

```dotenv
COMMERCIAL_PROVIDER_LICENSE_ACK=business-discovery-and-sales-prospecting-permitted
```

The reviewed contract must expressly permit business discovery and the intended sales-prospecting use. It must also define attribution, export, display, lead-generation, retention, directory, and storage rules. The adapter requests minimal fields, keeps its key server-side, rate-limits calls, uses timeouts and a circuit breaker, and cannot break Overture or OSM results. See `.env.example` for required metadata. No commercial provider has been approved by this repository.

## Current FCC Broadband Data Collection only

There is no Form 477 fallback. If a current local BDC index is missing, the UI says `Data unavailable`. Missing rows never prove that a provider cannot serve an address.

Import unzipped current fixed-availability CSVs downloaded through the official FCC process:

```bash
npm run fcc:import -- \
  --db data/fcc.sqlite \
  --as-of 2026-06-30 \
  --fabric-vintage 202606 \
  --dataset-vintage "BDC 2026-06-30" \
  /path/to/current-fixed-availability.csv
```

Use the actual dates from the files you download, then set:

```dotenv
FCC_AVAILABILITY_DB_PATH=data/fcc.sqlite
```

The application preserves filed maximum-advertised download/upload pairs. It distinguishes exact FCC Location ID evidence, CostQuest full-address matches, nearby H3-area evidence, no report in loaded data, and data unavailable. Nearby evidence is labeled `Nearby market context—not availability at this address`. Exact Fabric address matching requires a separate CostQuest license and server-side token.

## Zero retention

- Searches use POST bodies; searched addresses are not placed in application URLs.
- Prospects, selected businesses, notes, searches, and briefs are not written to browser storage or a database.
- Refresh clears the in-memory research session.
- Sensitive routes return `Cache-Control: no-store`.
- Prospect CSV export is disabled.
- Application code does not log addresses, coordinates, phone numbers, prospect payloads, or briefs.
- Short-lived server memory caching and request coalescing are used only to protect upstream services.

Third-party retention depends on each provider's own policy; this project does not claim otherwise.

## Coverage benchmark and verification

The repeatable benchmark uses synthetic fixtures representing downtown, suburban, industrial, and rural public-commercial scenarios. It never calls live APIs or uses Google Maps data.

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
npm run coverage:benchmark
```

## Compliance

Read [COMPLIANCE.md](./COMPLIANCE.md) before use. This repository does not provide legal or employer approval, automate outreach, connect to internal systems, or establish serviceability.
