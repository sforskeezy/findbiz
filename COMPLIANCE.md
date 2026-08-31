# Compliance and intended use

This document states what PAI / ProspectIQ is, what it is not, and how it is meant to be used. It is written so a manager, compliance reviewer, or legal reviewer can evaluate the project quickly from the public GitHub repository.

**This is not legal advice.** Open-sourcing the code makes the project transparent; it does not by itself approve workplace use under every employer policy. If you use this at work, get written approval from your manager or compliance contact.

## One-sentence summary

PAI / ProspectIQ is an **independent, unofficial, open-source** local research helper that uses **public business listings** and **official public FCC broadband availability data**. It has **no connection** to Spectrum/Charter internal systems, does **not** access Spectrum confidential data, and is **not** an official Spectrum Business product.

## Not affiliated with Spectrum / Charter

- Not owned, operated, endorsed, certified, or sponsored by Charter Communications, Spectrum, Spectrum Business, Spectrum Enterprise, or affiliates.
- Does not use Spectrum logos or Spectrum trademarks as the product brand. The product brand is PAI / ProspectIQ.
- Mentions of “Spectrum Business” in optional outreach templates exist only so an **already-authorized** Spectrum Business representative can paste language they are permitted to use. Do not use those templates if you are not authorized to represent Spectrum Business.
- Do not present this tool as an official Spectrum system, CRM, or availability engine.

## What the software does

1. Accepts an address from the user.
2. Finds nearby businesses from public/licensed directory sources configured by the operator.
3. Shows a research brief built from those public facts.
4. Looks up **provider-reported FCC availability** observations for the location/area.
5. Helps draft outreach language from those public facts.

## What the software does not do

- Connect to any Spectrum/Charter internal network, CRM, provisioning, or inventory system.
- Scrape Spectrum websites, portals, or employee tools.
- Store or display Spectrum confidential customer, pricing, network, or employee data.
- Claim that a business currently subscribes to Spectrum or any provider.
- Guarantee that service is orderable at an address.
- Autodial, send email, or push leads into company systems unless the user does that themselves.
- Impersonate Spectrum systems or FCC systems.

## Data sources and rules

### FCC public broadband data

- Availability rows are official **provider-reported** public FCC records (Broadband Data Collection / related public downloads or APIs).
- They are **availability observations**, not subscriptions and not orderability guarantees.
- Required attribution (FCC API Terms):  
  **“This product uses the FCC Data API but is not endorsed or certified by the FCC.”**
- Exact rooftop Fabric matching may require a separate CostQuest commercial license. Without that license, the app must stay on the permitted public-index / area-level path and must not scrape the FCC map UI.
- Do not modify FCC content and still claim the FCC as the source.

### FCC serviceability signal

- The in-app **FCC serviceability signal** is a confidence ladder from FCC match quality for Charter/Spectrum brand filings (exact vs area vs not reported).
- It is **not** Spectrum’s internal or customer-facing serviceability tool, not an orderability guarantee, and not proof of an active customer.
- **Active** and **Do not touch** colors are optional notes the user sets locally on their device. The app never infers those from FCC data and must not store Spectrum account details.
- Absence of a Charter/Spectrum FCC row means **not reported**, not “impossible to serve.”

### Business directory / map data

- Default public discovery may use OpenStreetMap ecosystem services. Follow their usage policies, identify your client, and respect rate limits.
- The built-in Google Maps discovery path reads public Maps search responses directly without the official Places API. It uses conservative concurrency, request spacing, short-lived caching, response-size limits, and stops when Google returns a block or CAPTCHA response. It does not bypass access controls. Google can change the page format or applicable terms at any time; the operator is responsible for confirming that their deployment and use are permitted.
- Google Places, RapidAPI, and other commercial directory providers are optional, operator-configured enrichment feeds. Enable them only if your license expressly allows the intended display, temporary storage, scoring, export, and sales-research workflow.
- Do not enable a directory provider whose terms forbid lead generation or persistent storage.

### Public website research

- The app reads only publicly reachable business pages and configured search-result sources. It blocks private/local network targets and limits crawl depth and page size.
- A phone number, email address, company identifier, founding date, or team size is shown only when a public page or structured record publishes it. The app does not infer hidden contact details, bypass access controls, or claim a missing value exists.
- Search snippets and pattern-matched identifiers are labeled Estimated and link to the page that must be verified before use.
- Follow each site's terms, robots policy, privacy rules, and applicable outreach laws. Public visibility does not automatically authorize bulk marketing or automated contact.

### Generated outreach copy

- Drafting assistance is optional and uses only the public facts already loaded for the prospect.
- Prompts forbid inventing missing business facts and forbid claiming a current provider relationship.
- The numeric fit score is owned by application code, not the drafting step.
- User remains responsible for every call, email, and representation made to a prospect.

## Workplace-use checklist

Before using this day to day at Spectrum Business / Charter (or any employer):

1. Show this public GitHub repo and `COMPLIANCE.md` to your manager or compliance contact.
2. Confirm you may run an independent open-source helper that uses only public data.
3. Confirm any third-party API keys you configure are licensed for sales research use.
4. Keep Spectrum credentials and internal data out of this app.
5. Use outreach templates only if you are authorized to represent Spectrum Business.
6. Treat FCC rows as public availability context, then qualify on the call.

## Why the GitHub link is on the front page

The public repository exists so anyone asking “what is this?” can see the source, license, data boundaries, and non-affiliation statement without needing a private demo. Transparency is intentional.

## License

Source code is released under the MIT License. See `LICENSE` and `NOTICE`.
