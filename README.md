# PAI / ProspectIQ

Independent, open-source business prospect research helper.

**Not affiliated with Charter Communications, Spectrum, or Spectrum Business.**

1. Enter an address.
2. Choose a nearby business from public/licensed directory data.
3. Review a public-business brief, official FCC broadband availability observations, and optional AI-assisted outreach draft.

There is no map dashboard and **no connection to Prism or any Spectrum internal system**.

- Public repo purpose: full transparency if a manager, compliance reviewer, or auditor asks what the tool is.
- Compliance statement: [`COMPLIANCE.md`](./COMPLIANCE.md)
- Legal notices: [`NOTICE`](./NOTICE) · [`LICENSE`](./LICENSE) (MIT)

> This product uses the FCC Data API but is not endorsed or certified by the FCC.

## Run locally

```powershell
npm install
npm run dev
```

Open `http://localhost:3000`.

Live nearby-business discovery uses OpenStreetMap contributors through Nominatim and Overpass by default. Set `OSM_CONTACT_EMAIL` in `.env.local` so public-service requests identify the operator. `USE_DEMO_DATA=true` is an explicit development-only opt-in.

Copy `.env.example` to `.env.local` and fill only the keys you are licensed to use.

## Qwen 3.5 Flash

Server-only Qwen configuration:

```dotenv
QWEN_API_KEY=
QWEN_MODEL=qwen3.5-flash
QWEN_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1
```

`DASHSCOPE_API_KEY` is also accepted. Qwen writes the brief and outreach copy; deterministic application code owns the numeric fit score. Prompts forbid invented business facts and current-provider claims.

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
