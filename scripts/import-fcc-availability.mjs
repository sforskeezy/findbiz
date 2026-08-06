import { createReadStream, mkdirSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";

function usage() {
  throw new Error(
    "Usage: npm run fcc:import -- --db <index.sqlite> --as-of <YYYY-MM-DD> --fabric-vintage <YYYYMM> <unzipped FCC CSV files...>",
  );
}

function argumentsFrom(argv) {
  const options = { files: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--db") options.db = argv[++index];
    else if (value === "--as-of") options.asOf = argv[++index];
    else if (value === "--fabric-vintage") options.fabricVintage = argv[++index];
    else if (value.startsWith("--")) usage();
    else options.files.push(value);
  }
  if (!options.db || !/^\d{4}-\d{2}-\d{2}$/.test(options.asOf || "") || !/^\d{6}$/.test(options.fabricVintage || "") || !options.files.length) usage();
  return options;
}

function parseCsvLine(line) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  fields.push(value);
  return fields;
}

function numeric(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const options = argumentsFrom(process.argv.slice(2));
const databasePath = path.resolve(options.db);
mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS fcc_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS fcc_availability (
    vintage TEXT NOT NULL,
    frn TEXT NOT NULL DEFAULT '',
    provider_id TEXT NOT NULL DEFAULT '',
    brand_name TEXT NOT NULL DEFAULT '',
    location_id TEXT NOT NULL,
    technology TEXT NOT NULL,
    max_advertised_download_speed REAL,
    max_advertised_upload_speed REAL,
    low_latency TEXT NOT NULL DEFAULT '',
    business_residential_code TEXT NOT NULL,
    state_usps TEXT NOT NULL DEFAULT '',
    block_geoid TEXT NOT NULL DEFAULT '',
    h3_res8_id TEXT NOT NULL DEFAULT '',
    UNIQUE(vintage, location_id, provider_id, technology, max_advertised_download_speed, max_advertised_upload_speed, business_residential_code)
  );
  CREATE INDEX IF NOT EXISTS idx_fcc_location ON fcc_availability(location_id);
  CREATE INDEX IF NOT EXISTS idx_fcc_h3 ON fcc_availability(h3_res8_id);
`);

const setMetadata = database.prepare("INSERT OR REPLACE INTO fcc_metadata(key, value) VALUES (?, ?)");
setMetadata.run("fcc_as_of_date", options.asOf);
setMetadata.run("fabric_vintage", options.fabricVintage);

const insert = database.prepare(`
  INSERT OR IGNORE INTO fcc_availability (
    vintage, frn, provider_id, brand_name, location_id, technology,
    max_advertised_download_speed, max_advertised_upload_speed, low_latency,
    business_residential_code, state_usps, block_geoid, h3_res8_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let imported = 0;
let skipped = 0;
database.exec("BEGIN");
try {
  for (const file of options.files) {
    const filePath = path.resolve(file);
    const lines = readline.createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
    let columns;
    for await (const line of lines) {
      if (!columns) {
        columns = parseCsvLine(line).map((value) => value.replace(/^\uFEFF/, "").trim().toLowerCase());
        continue;
      }
      if (!line.trim()) continue;
      const values = parseCsvLine(line);
      const row = Object.fromEntries(columns.map((column, index) => [column, values[index] ?? ""]));
      const classification = row.business_residential_code?.trim().toUpperCase();
      if (!row.location_id || !["B", "X"].includes(classification)) {
        skipped += 1;
        continue;
      }
      insert.run(
        options.asOf,
        row.frn || "",
        row.provider_id || "",
        row.brand_name || "",
        row.location_id,
        row.technology || "0",
        numeric(row.max_advertised_download_speed),
        numeric(row.max_advertised_upload_speed),
        row.low_latency || "",
        classification,
        row.state_usps || "",
        row.block_geoid || "",
        row.h3_res8_id || "",
      );
      imported += 1;
      if (imported % 25_000 === 0) {
        database.exec("COMMIT; BEGIN");
        process.stdout.write(`Imported ${imported.toLocaleString()} business-availability rows\r`);
      }
    }
  }
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}

process.stdout.write(`Imported ${imported.toLocaleString()} official FCC rows; skipped ${skipped.toLocaleString()} non-business/invalid rows.\n`);
