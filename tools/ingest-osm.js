// RAW layer: download the Baku Metro routes and stops from OpenStreetMap (Overpass API)
// and store the response exactly as returned, plus a small metadata file.
//
//   npm run data:ingest
//
// Output (committed, so the rest of the pipeline also works offline):
//   data/raw/osm/baku-metro.json       the Overpass response, untouched
//   data/raw/osm/baku-metro.meta.json  when, from where, with which query, under which licence
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUERY_FILE = path.join(ROOT, 'tools', 'queries', 'baku-metro.overpassql');
const OUT_DIR = path.join(ROOT, 'data', 'raw', 'osm');
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const ATTEMPTS_PER_ENDPOINT = 2;

const query = fs
  .readFileSync(QUERY_FILE, 'utf8')
  .split('\n')
  .filter((l) => !l.trim().startsWith('//'))
  .join('\n');

async function fetchOverpass(endpoint) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'UMATE-data-pipeline/0.1' },
    body: 'data=' + encodeURIComponent(query),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`${endpoint} answered HTTP ${res.status}`);
  const text = await res.text();
  const json = JSON.parse(text); // fail early if the answer is not JSON
  if (!Array.isArray(json.elements) || json.elements.length === 0) throw new Error(`${endpoint} returned no elements`);
  return { text, json };
}

let result = null;
let usedEndpoint = null;
let fetchedAt = new Date();

// --from-file <path>: import a response saved earlier (for example from overpass-turbo.eu, or when
// every public server is busy). The metadata records that it was imported and when it was saved.
const fileArg = process.argv.indexOf('--from-file');
if (fileArg > 0) {
  const file = process.argv[fileArg + 1];
  const text = fs.readFileSync(file, 'utf8');
  result = { text, json: JSON.parse(text) };
  usedEndpoint = `imported from a saved Overpass response (${path.basename(file)})`;
  fetchedAt = fs.statSync(file).mtime;
}

outer: for (const endpoint of result ? [] : ENDPOINTS) {
  for (let attempt = 1; attempt <= ATTEMPTS_PER_ENDPOINT; attempt++) {
    try {
      result = await fetchOverpass(endpoint);
      usedEndpoint = endpoint;
      break outer;
    } catch (e) {
      console.warn(`[ingest] attempt ${attempt} at ${endpoint} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 3000 * attempt)); // public servers are often busy for a moment
    }
  }
}
if (!result) {
  console.error('[ingest] every Overpass endpoint failed. The committed raw file is left unchanged.');
  process.exit(1);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'baku-metro.json'), result.text);
const counts = result.json.elements.reduce((acc, e) => ((acc[e.type] = (acc[e.type] || 0) + 1), acc), {});
const meta = {
  fetchedAt: fetchedAt.toISOString(),
  endpoint: usedEndpoint,
  queryFile: 'tools/queries/baku-metro.overpassql',
  osmTimestamp: result.json.osm3s?.timestamp_osm_base ?? null,
  elements: counts,
  licence: 'ODbL 1.0, (c) OpenStreetMap contributors, https://www.openstreetmap.org/copyright',
};
fs.writeFileSync(path.join(OUT_DIR, 'baku-metro.meta.json'), JSON.stringify(meta, null, 2) + '\n');
console.log(`[ingest] saved ${result.json.elements.length} elements (${JSON.stringify(counts)}) from ${usedEndpoint}`);
