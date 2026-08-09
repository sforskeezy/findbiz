import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const KEY = env.RAPIDAPI_KEY;
const HOST = env.RAPIDAPI_HOST || "maps-data.p.rapidapi.com";

const LAT = 34.1219185;
const LNG = -80.7149121;

async function call(path, params) {
  const url = new URL(`https://${HOST}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST, Accept: "application/json" },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text: text.slice(0, 400) };
}

function miles(aLat, aLng, bLat, bLng) {
  const R = 3958.8;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function summarize(label, r) {
  const n = r.json?.data?.length ?? 0;
  console.log(`\n### ${label}  [HTTP ${r.status}] results=${n}`);
  if (!n) {
    console.log("   raw:", r.text.replace(/\s+/g, " ").slice(0, 300));
    return [];
  }
  const rows = r.json.data.map((p) => ({
    name: p.name,
    d: p.latitude != null ? miles(LAT, LNG, p.latitude, p.longitude).toFixed(2) : "?",
    type: p.type || (p.types || [])[0] || "",
  }));
  rows.sort((a, b) => Number(a.d) - Number(b.d));
  for (const row of rows.slice(0, 25)) console.log(`   ${row.d.padStart(6)} mi  ${row.name}  [${row.type}]`);
  return r.json.data;
}

console.log("KEY len:", KEY?.length, "HOST:", HOST);

// 1. Which endpoints exist?
console.log("\n========== ENDPOINT DISCOVERY ==========");
for (const ep of ["/searchmaps.php", "/nearbymaps.php", "/searchnearby.php", "/nearby.php", "/place.php"]) {
  const r = await call(ep, { query: "business", lat: LAT, lng: LNG, limit: 5, country: "us", lang: "en", zoom: 14 });
  console.log(`${ep.padEnd(20)} HTTP ${r.status}  data=${r.json?.data?.length ?? "n/a"}  ${r.text.replace(/\s+/g, " ").slice(0, 140)}`);
}

// 2. Current production behavior: searchmaps with the fixed query list at zoom 14
console.log("\n========== CURRENT STRATEGY (searchmaps, zoom 14) ==========");
const QUERIES = ["business", "office", "restaurant", "medical", "dentist", "lawyer", "store", "auto repair", "school", "contractor"];
const all = new Map();
for (const q of QUERIES) {
  const r = await call("/searchmaps.php", { query: q, limit: 20, country: "us", lang: "en", lat: LAT, lng: LNG, zoom: 14 });
  const data = summarize(`searchmaps query="${q}"`, r);
  for (const p of data) all.set(p.business_id || p.place_id || p.name, p);
}
console.log(`\nTOTAL DEDUPED: ${all.size}`);
const within1 = [...all.values()].filter((p) => p.latitude != null && miles(LAT, LNG, p.latitude, p.longitude) <= 1);
console.log(`WITHIN 1 MILE: ${within1.length}`);
for (const p of within1) console.log("  -", p.name, miles(LAT, LNG, p.latitude, p.longitude).toFixed(2));

// 3. Do the target businesses exist in the API at all?
console.log("\n========== TARGET BUSINESS LOOKUP ==========");
for (const q of ["Backyard Customs", "Flying E Performance Horses", "Greenway Drive by Great Southern Homes", "Backyard Customs Lugoff SC"]) {
  const r = await call("/searchmaps.php", { query: q, limit: 10, country: "us", lang: "en", lat: LAT, lng: LNG, zoom: 12 });
  summarize(`lookup "${q}"`, r);
}
