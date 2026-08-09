import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#") && l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const KEY = env.RAPIDAPI_KEY;
const HOST = env.RAPIDAPI_HOST || "maps-data.p.rapidapi.com";
const LAT = 34.1219185, LNG = -80.7149121;

async function call(path, params) {
  const url = new URL(`https://${HOST}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url, { headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST, Accept: "application/json" } });
    const j = await res.json().catch(() => null);
    return { status: res.status, data: j?.data ?? [] };
  } catch (e) { return { status: 0, data: [], err: String(e) }; }
}
function miles(bLat, bLng) {
  const R = 3958.8;
  const dLat = ((bLat - LAT) * Math.PI) / 180, dLng = ((bLng - LNG) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((LAT * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

console.log("=== ZOOM SWEEP on searchmaps, query=contractor / equestrian ===");
for (const q of ["contractor", "equestrian", "welder", "business"]) {
  for (const zoom of [14, 16, 17, 18, 19, 20]) {
    const r = await call("/searchmaps.php", { query: q, lat: LAT, lng: LNG, limit: 20, country: "us", lang: "en", zoom });
    const near = r.data.filter((p) => p.latitude != null && miles(p.latitude, p.longitude) <= 1);
    console.log(`  q=${q.padEnd(11)} zoom=${String(zoom).padEnd(2)} n=${String(r.data.length).padStart(3)} within1mi=${near.length}  ${near.map((p) => p.name).join(" | ")}`);
  }
}

console.log("\n=== nearby.php vs searchmaps.php per query (within 1 mi) ===");
const testQueries = ["business", "contractor", "equestrian", "horses", "welder", "farm", "home builder", "landscaping"];
for (const q of testQueries) {
  const [a, b] = await Promise.all([
    call("/nearby.php", { query: q, lat: LAT, lng: LNG, limit: 100 }),
    call("/searchmaps.php", { query: q, lat: LAT, lng: LNG, limit: 100, country: "us", lang: "en", zoom: 17 }),
  ]);
  const f = (r) => r.data.filter((p) => p.latitude != null && miles(p.latitude, p.longitude) <= 1).map((p) => p.name);
  console.log(`  ${q.padEnd(14)} nearby: n=${String(a.data.length).padStart(3)} <1mi=[${f(a).join(", ")}]`);
  console.log(`  ${"".padEnd(14)} search: n=${String(b.data.length).padStart(3)} <1mi=[${f(b).join(", ")}]`);
}
