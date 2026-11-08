// SILVER layer: data/raw/osm/baku-metro.json -> data/city/baku/network.json (+ quality report).
//
//   npm run data:build
//
// Runs offline. The output is deterministic (no build time inside), so a rebuild without new raw
// data gives no git diff. The build stops with an error if the data-quality checks find errors.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildNetwork } from './lib/osm-network.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const raw = read('data/raw/osm/baku-metro.json');
const names = read('data/city/baku/names-en.json').names;
const { network, quality } = buildNetwork(raw, names, { osmTimestamp: raw.osm3s?.timestamp_osm_base ?? null });

const outDir = path.join(ROOT, 'data', 'city', 'baku');
fs.writeFileSync(path.join(outDir, 'network.json'), JSON.stringify(network, null, 2) + '\n');
fs.writeFileSync(path.join(outDir, 'quality.json'), JSON.stringify(quality, null, 2) + '\n');

console.log(`[build] ${network.lines.length} lines, ${network.stations.length} stations -> data/city/baku/network.json`);
for (const l of network.lines) console.log(`  line ${l.ref.padEnd(3)} ${l.name_en.padEnd(19)} ${l.stations.length} stations, ${l.routes.length} routes`);
for (const w of quality.warnings) console.log('  warning:', w);
for (const e of quality.errors) console.error('  ERROR:', e);
if (quality.errors.length) process.exit(1);
