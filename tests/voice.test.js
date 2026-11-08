// Recorded buddy lines: every line the app asks for exists, and the recordings match the scenario text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildLines } from '../tools/gen-voice.js';
import { ROOT, readJson } from './helpers.js';

const lines = buildLines();
const main = fs.readFileSync(path.join(ROOT, 'client', 'vr', 'main.js'), 'utf8');
const panel = fs.readFileSync(path.join(ROOT, 'client', 'panel', 'index.html'), 'utf8');

test('every recorded-voice key used by the phone app and the panel has a line', () => {
  const used = new Set([...main.matchAll(/speak\('([^']+)'/g)].map((m) => m[1]));
  for (const m of main.matchAll(/voice\.play\('([^']+)'\)/g)) used.add(m[1]);
  for (const m of panel.matchAll(/data-voice="([^"]+)"/g)) used.add(m[1]);
  assert.ok(used.size >= 14, `found only ${used.size} keys`);
  for (const k of used) assert.ok(lines[k], `no line for "${k}"`);
});

test('there is a recorded hint for every step and level', () => {
  for (const step of ['topup', 'gate', 'platform', 'ride']) for (const level of [1, 2, 3]) assert.ok(lines[`hint:${step}:${level}`]);
});

test('the recordings on disk match the current scenario text (regenerate with npm run voice:gen)', (t) => {
  const file = path.join(ROOT, 'client', 'assets', 'voice', 'lines.json');
  assert.ok(fs.existsSync(file), 'client/assets/voice/lines.json is missing');
  const manifest = readJson('client/assets/voice/lines.json');
  const notRecorded = [];
  for (const [key, text] of Object.entries(lines)) {
    assert.equal(manifest.lines[key]?.text, text, `recording for "${key}" is out of date`);
    const f = manifest.lines[key].file;
    if (!f) notRecorded.push(key); // the phone falls back to its own speech engine for these
    else assert.ok(fs.existsSync(path.join(ROOT, 'client', 'assets', 'voice', f)), `missing file for "${key}"`);
  }
  if (notRecorded.length) t.diagnostic(`not recorded yet (speech-engine fallback): ${notRecorded.join(', ')}`);
});
