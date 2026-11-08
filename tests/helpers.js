import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

export function loadData() {
  return {
    network: readJson('data/city/baku/network.json'),
    rules: readJson('data/city/baku/rules.json'),
    scenario: readJson('data/scenario/metro-trip.json'),
  };
}
