import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

function valueAfter(flag) {
  const inline = process.argv.find((value) => value.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const bbox = valueAfter("--bbox");
const output = valueAfter("--output") || "data/overture/places.parquet";

if (!bbox) {
  console.error("Usage: npm run overture:prepare -- --bbox=WEST,SOUTH,EAST,NORTH [--output=PATH]");
  process.exit(1);
}

const values = bbox.split(",").map(Number);
if (
  values.length !== 4 ||
  values.some((value) => !Number.isFinite(value)) ||
  values[0] >= values[2] ||
  values[1] >= values[3] ||
  values[0] < -180 || values[2] > 180 || values[1] < -90 || values[3] > 90
) {
  console.error("--bbox must be WEST,SOUTH,EAST,NORTH with valid ordered coordinates.");
  process.exit(1);
}

const resolvedOutput = path.resolve(output);
await mkdir(path.dirname(resolvedOutput), { recursive: true });

const hasUvx = spawnSync("uvx", ["--version"], { stdio: "ignore" }).status === 0;
const command = hasUvx ? "uvx" : "python3";
const args = hasUvx
  ? ["overturemaps", "download", `--bbox=${bbox}`, "-f", "geoparquet", "--type=place", "-o", resolvedOutput]
  : ["-m", "overturemaps", "download", `--bbox=${bbox}`, "-f", "geoparquet", "--type=place", "-o", resolvedOutput];

console.log("Downloading the latest Overture Places release through the official Python client and STAC catalog…");
const child = spawn(command, args, { stdio: "inherit" });
child.on("error", (error) => {
  console.error(hasUvx ? error.message : "Install the official client first: python3 -m pip install overturemaps");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  if (code !== 0) {
    if (!hasUvx) console.error("Install the official client first: python3 -m pip install overturemaps");
    process.exitCode = code ?? 1;
    return;
  }
  console.log(`Prepared ${resolvedOutput}`);
  console.log(`Set OVERTURE_PLACES_PATH=${output}`);
});
