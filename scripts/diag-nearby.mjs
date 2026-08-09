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
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, url: url.toString() };
}

function miles(bLat, bLng) {
  const R = 3958.8;
  const dLat = ((bLat - LAT) * Math.PI) / 180;
  const dLng = ((bLng - LNG) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((LAT * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function show(label, r) {
  const d = r.json?.data ?? [];
  console.log(`\n### ${label} [HTTP ${r.status}] n=${d.length}`);
  if (!d.length) { console.log("   ", r.text.replace(/\s+/g, " ").slice(0, 200)); return d; }
  const rows = d.filter((p) => p.latitude != null).map((p) => ({ d: miles(p.latitude, p.longitude), n: p.name, t: p.type }));
  rows.sort((a, b) => a.d - b.d);
  for (const row of rows) console.log(`   ${row.d.toFixed(2).padStart(7)} mi  ${row.n}  [${row.t}]`);
  return d;
}

// Inspect full shape of one nearby.php result
console.log("========== /nearby.php RAW SHAPE ==========");
const raw = await call("/nearby.php", { query: "business", lat: LAT, lng: LNG, limit: 3 });
console.log(JSON.stringify(raw.json, null, 2).slice(0, 2500));

console.log("\n\n========== /nearby.php PARAM PROBES ==========");
const probes = [
  ["query=business limit=20", { query: "business", lat: LAT, lng: LNG, limit: 20 }],
  ["query=business limit=100", { query: "business", lat: LAT, lng: LNG, limit: 100 }],
  ["query=business +radius=1600", { query: "business", lat: LAT, lng: LNG, limit: 50, radius: 1600 }],
  ["query=(empty)", { query: "", lat: LAT, lng: LNG, limit: 50 }],
  ["no query param", { lat: LAT, lng: LNG, limit: 50 }],
  ["query=contractor", { query: "contractor", lat: LAT, lng: LNG, limit: 50 }],
  ["query=horse", { query: "horse", lat: LAT, lng: LNG, limit: 50 }],
  ["query=welder", { query: "welder", lat: LAT, lng: LNG, limit: 50 }],
  ["subtypes=Welder", { subtypes: "Welder", lat: LAT, lng: LNG, limit: 50 }],
];
for (const [label, params] of probes) {
  show(label, await call("/nearby.php", params));
}

console.log("\n\n========== /searchmaps.php limit + zoom sensitivity ==========");
for (const [label, params] of [
  ["searchmaps contractor limit=100 zoom=14", { query: "contractor", lat: LAT, lng: LNG, limit: 100, country: "us", lang: "en", zoom: 14 }],
  ["searchmaps contractor limit=20 zoom=17", { query: "contractor", lat: LAT, lng: LNG, limit: 20, country: "us", lang: "en", zoom: 17 }],
  ["searchmaps equestrian", { query: "equestrian", lat: LAT, lng: LNG, limit: 20, country: "us", lang: "en", zoom: 14 }],
  ["searchmaps horse boarding", { query: "horse boarding", lat: LAT, lng: LNG, limit: 20, country: "us", lang: "en", zoom: 14 }],
  ["searchmaps welding", { query: "welding", lat: LAT, lng: LNG, limit: 20, country: "us", lang: "en", zoom: 14 }],
  ["searchmaps no-query", { lat: LAT, lng: LNG, limit: 20, country: "us", lang: "en", zoom: 14 }],
]) {
  show(label, await call("/searchmaps.php", params));
}

console.log("\n\n========== RATE LIMIT: 10 parallel searchmaps ==========");
const qs = ["business", "office", "restaurant", "medical", "dentist", "lawyer", "store", "auto repair", "school", "contractor"];
const t0 = Date.now();
const res = await Promise.all(qs.map((q) => call("/searchmaps.php", { query: q, lat: LAT, lng: LNG, limit: 20, country: "us", lang: "en", zoom: 14 })));
console.log(`elapsed ${Date.now() - t0}ms`);
for (let i = 0; i < qs.length; i++) {
  const h = res[i];
  console.log(`  ${qs[i].padEnd(12)} HTTP ${h.status} n=${h.json?.data?.length ?? 0}`);
}
console.log("rate headers of last:", JSON.stringify(raw.status));
