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

Open `http://localhost:3000`. No API key is required for business discovery.

Copy `.env.example` to `.env.local` and fill only the keys you are licensed to use. Optional profile/outreach drafting uses Claude Opus 5 by default (`RESEARCH_MODEL=claude-opus-5`) via the Anthropic Messages API (`RESEARCH_BASE_URL=https://api.anthropic.com/v1`) or any OpenAI-compatible proxy that serves the same model. Deterministic application code owns the numeric fit score.

## PAI Places — our own discovery API

Nearby-business discovery runs through **PAI Places**, a first-party API owned by this app. It needs no third-party key and calls no commercial map provider.

| Endpoint | Body | Returns |
| --- | --- | --- |
| `POST /api/places/geocode` | `{ address }` | Coordinates from the US Census geocoder, Photon, or Nominatim |
| `POST /api/places/nearby` | `{ address, radiusMiles }` | Nearby businesses, their distances, and source attribution |

`POST /api/research` uses PAI Places as its primary provider and adds scoring and outreach drafting on top.

Discovery sources, in priority order:

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

### Deprecated providers

Google Places and RapidAPI Maps Data remain in the tree for reference but are **off by default** and are **not used** by `/api/research` or `/api/places/*`. Setting `ENABLE_GOOGLE_PLACES=true` / `ENABLE_RAPIDAPI_PLACES=true` does not change the live discovery path — PAI Places is always primary. `GET /api/status` reports the live mode.

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
