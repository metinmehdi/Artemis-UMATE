// Data pipeline tests: raw OSM -> silver network table.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNetwork, cleanName, transliterate, slug } from '../tools/lib/osm-network.js';
import { readJson } from './helpers.js';

const raw = readJson('data/raw/osm/baku-metro.json');
const names = readJson('data/city/baku/names-en.json').names;
const committed = readJson('data/city/baku/network.json');

test('rebuilding from the committed raw data gives exactly the committed network.json', () => {
  const { network } = buildNetwork(raw, names, { osmTimestamp: raw.osm3s?.timestamp_osm_base ?? null });
  assert.deepEqual(network, committed);
});

test('the committed raw data passes the quality checks without errors', () => {
  const { quality } = buildNetwork(raw, names);
  assert.deepEqual(quality.errors, []);
});

test('Red line has the 12 stations in the real order', () => {
  const red = committed.lines.find((l) => l.ref === '1');
  assert.deepEqual(red.stations, [
    'icherisheher', 'sahil', '28-may', 'ganjlik', 'nariman-narimanov', 'ulduz',
    'koroglu', 'gara-garayev', 'neftchilar', 'khalglar-dostlugu', 'ahmadli', 'hazi-aslanov',
  ]);
  assert.equal(red.colour, '#EE1D23');
});

test('every station has a unique id, both names and coordinates inside Baku', () => {
  const ids = new Set();
  for (const s of committed.stations) {
    assert.ok(!ids.has(s.id), `duplicate id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.name_az && s.name_en, `${s.id} is missing a name`);
    assert.ok(s.lat > 40.3 && s.lat < 40.5 && s.lon > 49.7 && s.lon < 50.1, `${s.id} is outside Baku`);
  }
  for (const l of committed.lines) for (const id of l.stations) assert.ok(ids.has(id), `line ${l.ref} uses unknown ${id}`);
});

test('interchange stations belong to every line that stops there', () => {
  const memar = committed.stations.find((s) => s.name_az === 'Memar Əcəmi');
  assert.deepEqual(memar.lines, ['2', '3']);
});

test('names are cleaned and transliterated predictably', () => {
  assert.equal(cleanName('  20 Yanvar st. '), '20 Yanvar');
  assert.equal(cleanName('Nariman Narimanov station'), 'Nariman Narimanov');
  assert.equal(transliterate('Xalqlar Dostluğu'), 'Khalglar Dostlughu');
  assert.equal(slug('28 May'), '28-may');
});

test('a stop that is missing from the raw data is reported as an error', () => {
  const tiny = {
    elements: [
      { type: 'relation', id: 1, tags: { route: 'subway', ref: '9', name: 'Test' }, members: [
        { type: 'node', ref: 10, role: 'stop' },
        { type: 'node', ref: 11, role: 'stop' },
      ] },
      { type: 'node', id: 10, lat: 40.4, lon: 49.9, tags: { name: 'A' } },
    ],
  };
  const { quality } = buildNetwork(tiny, {});
  assert.ok(quality.errors.some((e) => e.includes('node/11 is missing')));
});
