const hosts = [
  "https://maps-data.p.rapidapi.com/searchmaps.php",
  "https://photon.komoot.io/api/?q=test",
  "https://overpass-api.de/api/status",
  "https://geocoding.geo.census.gov/",
];

for (const h of hosts) {
  try {
    const r = await fetch(h, { signal: AbortSignal.timeout(10000) });
    console.log(h, "->", r.status);
  } catch (e) {
    console.log(h, "-> ERR", e.cause?.code || e.message);
  }
}
