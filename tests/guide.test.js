// Real-trip guide: its events become fact_real_trip (never VR sessions), the photo help is checked
// and falls back safely, the buddy gets guide instructions, and the scenario has the guide content.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { buildStar, checkKeys, progressReport } from '../shared/analytics.js';
import { createTrip, fill, textVars } from '../shared/engine.js';
import { checkPhoto, askPhoto, PHOTO_FALLBACK } from '../server/ask-photo.js';
import { createRealtimeSecret, GUIDE_INSTRUCTIONS, COMPANION_INSTRUCTIONS } from '../server/realtime.js';
import { reportFacts, templateReport } from '../server/report.js';
import askPhotoHandler from '../api/ask-photo.js';
import { loadData } from './helpers.js';

const who = { id: 'aysel', nickname: 'Aysel' };
function guideLog(sessionId, { help = [], end = { completed: true, self_report: 'alone' } } = {}) {
  const t0 = Date.UTC(2026, 10, 9, 9);
  let t = t0;
  const ev = (name, data = {}) => ({ t: (t += 1000), sessionId, type: 'event', name, mode: 'guide', learner: who, data: { t, ...data } });
  const lines = [ev('guide_start', { trip: 'baku-red-koroglu-28may' })];
  for (const h of help) lines.push(ev('guide_help', h));
  for (const id of ['topup', 'gate', 'platform', 'ride']) lines.push(ev('guide_step', { id, ms: 60000 }));
  if (end) lines.push(ev('guide_end', end));
  return lines;
}

let realFetch;
beforeEach(() => {
  realFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
});

test('guide events become real trips, not VR sessions, and the keys stay clean', () => {
  const star = buildStar(guideLog('g-trip-0001', { help: [{ kind: 'remind', step: 'topup' }, { kind: 'photo', step: 'platform' }, { kind: 'photo', step: 'platform' }] }));
  assert.equal(star.facts.fact_session.length, 0);
  assert.equal(star.facts.fact_real_trip.length, 1);
  const r = star.facts.fact_real_trip[0];
  assert.equal(r.learner_key, 'aysel');
  assert.equal(r.completed, true);
  assert.equal(r.steps_done, 4);
  assert.equal(r.help_count, 3);
  assert.deepEqual(r.help_by_step, { topup: { remind: 1 }, platform: { photo: 2 } });
  assert.equal(r.self_report, 'alone');
  assert.deepEqual(checkKeys(star), []);
});

test('an unfinished real trip is kept as not completed; progress and the report include it', () => {
  const star = buildStar(guideLog('g-trip-0002', { end: null }));
  const p = progressReport(star, 'aysel');
  assert.equal(p.real_trips.length, 1);
  assert.equal(p.real_trips[0].completed, false);
  const facts = reportFacts(p.progress, 'Aysel', p.real_trips);
  assert.equal(facts.real_trips.length, 1);
  assert.match(templateReport({ ...facts, sessions: 1, first_session: 'x', last_session: 'x', completed_trips: 0 }), /Real trips with the phone guide: 1/);
});

test('the photo request is checked before anything is sent', () => {
  assert.equal(checkPhoto({}), 'image required');
  assert.equal(checkPhoto({ image: 'A'.repeat(1_500_000) }), 'image too large');
  assert.equal(checkPhoto({ image: '<script>' }), 'image must be base64 JPEG');
  assert.equal(checkPhoto({ image: '/9j/4AAQSkZJRgABAQ==' }), null);
});

test('photo help: Gemini answer when it works, a safe fixed answer when it does not', async () => {
  process.env.GEMINI_API_KEY = 'test';
  let body;
  globalThis.fetch = async (url, opts) => {
    body = JSON.parse(opts.body);
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'This is the top-up machine. Hold your card on the reader.' }] } }], modelVersion: 'gemini-test' }), { status: 200 });
  };
  const ok = await askPhoto({ image: '/9j/4AAQ', step: { id: 'topup', title: 'Top up' }, trip: { from: 'Koroğlu', to: '28 May' } });
  assert.equal(ok.model, 'gemini-test');
  assert.match(ok.text, /top-up machine/);
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
  globalThis.fetch = async () => new Response('{"error":{"message":"busy"}}', { status: 503 });
  const down = await askPhoto({ image: '/9j/4AAQ' });
  assert.equal(down.text, PHOTO_FALLBACK);
  assert.equal(down.model, null);
});

test('the cloud photo API needs the access key', async () => {
  process.env.UMATE_ACCESS_KEY = 'test-key-123';
  const r = Readable.from([JSON.stringify({ image: '/9j/4AAQ' })]);
  Object.assign(r, { method: 'POST', url: '/api/ask-photo', headers: {} });
  const res = { statusCode: 0, headers: {}, body: '', setHeader(k, v) { this.headers[k] = v; }, end(b = '') { this.body = b; } };
  await askPhotoHandler(r, res);
  assert.equal(res.statusCode, 401);
});

test('guide mode gives the buddy real-metro safety instructions', async () => {
  process.env.OPENAI_API_KEY = 'sk-test';
  let sent;
  globalThis.fetch = async (url, opts) => {
    sent = JSON.parse(opts.body);
    return new Response(JSON.stringify({ value: 'ek_test', expires_at: 1 }), { status: 200 });
  };
  const g = await createRealtimeSecret({ mode: 'guide' });
  assert.equal(g.mode, 'guide');
  assert.equal(sent.session.instructions, GUIDE_INSTRUCTIONS);
  assert.match(GUIDE_INSTRUCTIONS, /yellow line/);
  await createRealtimeSecret();
  assert.equal(sent.session.instructions, COMPANION_INSTRUCTIONS);
  delete process.env.OPENAI_API_KEY;
});

test('every step has real-trip micro-steps, a photo and no unfilled placeholders', () => {
  const data = loadData();
  const trip = createTrip(data);
  const vars = { ...textVars(trip, {}, 'az'), fare: data.rules.fare.toFixed(2) };
  for (const step of data.scenario.steps) {
    assert.ok(step.guide?.photo?.startsWith('/assets/guide/'), `${step.id} photo`);
    assert.ok(step.guide.how.length >= 3, `${step.id} micro-steps`);
    for (const h of step.guide.how) assert.doesNotMatch(fill(h, vars), /\{\w+\}/, h);
  }
  assert.match(fill(data.scenario.staff_card.az, vars), /28 May stansiyasına/);
});
