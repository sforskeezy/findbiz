#!/usr/bin/env node
/**
 * Ground-truth probe for PAI Places coverage.
 *
 * Answers "is this business actually missing from OpenStreetMap, or is our
 * query too narrow?" by geocoding an address with the US Census geocoder and
 * dumping every business-like OSM element around it.
 *
 * Usage:
 *   node scripts/probe-osm-coverage.mjs "46 Carina Ln, Lugoff, SC 29078" 1
 *   npm run places:probe -- "46 Carina Ln, Lugoff, SC 29078" 1
 */

const address = process.argv[2];
const radiusMiles = Number(process.argv[3] || 1);

if (!address) {
  console.error('Usage: node scripts/probe-osm-coverage.mjs "<address>" [radiusMiles]');
  process.exit(1);
}

async function geocodeWithCensus(query) {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", query);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  const response = await fetch(url);
  if (!response.ok) return null;
  const payload = await response.json();
  const match = payload.result?.addressMatches?.[0];
  if (!match?.coordinates) return null;
  return {
    formatted: match.matchedAddress,
    lat: match.coordinates.y,
    lng: match.coordinates.x,
  };
}

async function geocodeWithPhoton(query) {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) return null;
  const payload = await response.json();
  const feature = payload.features?.[0];
  if (!feature?.geometry?.coordinates) return null;
  return {
    formatted: feature.properties?.name || query,
    lat: feature.geometry.coordinates[1],
    lng: feature.geometry.coordinates[0],
  };
}

function distanceMiles(a, b) {
  const earthRadiusMiles = 3958.8;
  const latDelta = ((b.lat - a.lat) * Math.PI) / 180;
  const lngDelta = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const haversine =
    Math.sin(latDelta / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

const center = (await geocodeWithCensus(address)) ?? (await geocodeWithPhoton(address));
if (!center) {
  console.error(`Could not geocode: ${address}`);
  process.exit(1);
}

console.log(`ADDRESS   ${address}`);
console.log(`MATCHED   ${center.formatted}`);
console.log(`CENTER    ${center.lat}, ${center.lng}`);
console.log(`RADIUS    ${radiusMiles} mi\n`);

const radiusMeters = Math.round(radiusMiles * 1609.344);
const a = `around:${radiusMeters},${center.lat},${center.lng}`;

// Intentionally broader than the app query so we can see everything OSM holds.
const query = `[out:json][timeout:90];
(
  nwr(${a})["name"];
  nwr(${a})["operator"];
  nwr(${a})["shop"];
  nwr(${a})["craft"];
  nwr(${a})["office"];
  nwr(${a})["company"];
  nwr(${a})["industrial"];
  nwr(${a})["healthcare"];
  nwr(${a})["club"];
  nwr(${a})["tourism"];
  nwr(${a})["leisure"];
  nwr(${a})["landuse"~"^(commercial|retail|industrial|farmyard|quarry)$"];
);
out center tags meta 500;`;

const endpoints = [
  process.env.OVERPASS_API_URL,
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
].filter(Boolean);

let elements = null;
for (const endpoint of endpoints) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": process.env.OSM_CONTACT_EMAIL
          ? `ProspectIQ-probe/0.3 (${process.env.OSM_CONTACT_EMAIL})`
          : "ProspectIQ-probe/0.3 (private single-user business research)",
        Accept: "application/json",
      },
      body: new URLSearchParams({ data: query }),
    });
    if (!response.ok) {
      console.error(`  ${endpoint} -> HTTP ${response.status}`);
      continue;
    }
    elements = (await response.json()).elements ?? [];
    console.log(`SOURCE    ${endpoint}\n`);
    break;
  } catch (error) {
    console.error(`  ${endpoint} -> ${error.message}`);
  }
}

if (!elements) {
  console.error("Every Overpass endpoint failed.");
  process.exit(1);
}

const NON_BUSINESS_KEYS = ["highway", "waterway", "railway", "power", "barrier", "boundary", "natural", "place"];

const rows = [];
for (const element of elements) {
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (lat === undefined || lng === undefined) continue;
  const tags = element.tags ?? {};
  rows.push({
    distance: distanceMiles(center, { lat, lng }),
    name: tags.name || tags.operator || tags.brand || "(unnamed)",
    business: !NON_BUSINESS_KEYS.some((key) => tags[key]),
    ref: `${element.type}/${element.id}`,
    tags: Object.entries(tags)
      .filter(([key]) => !key.startsWith("addr:") && !["name", "source"].includes(key))
      .map(([key, value]) => `${key}=${value}`)
      .join(" "),
  });
}

rows.sort((left, right) => left.distance - right.distance);
const businesses = rows.filter((row) => row.business);

console.log(`Elements returned: ${elements.length}`);
console.log(`With coordinates:  ${rows.length}`);
console.log(`Business-like:     ${businesses.length}\n`);

for (const row of businesses) {
  console.log(`${row.distance.toFixed(2)} mi  ${row.name}  [${row.ref}]`);
  console.log(`         ${row.tags.slice(0, 180)}`);
}

if (!businesses.length) {
  console.log("Nothing business-like is mapped here. Add entries to data/places-cache.json.");
}
