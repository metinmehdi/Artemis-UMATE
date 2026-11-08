// Cloud API (Vercel functions): access key, event validation, Supabase calls (fetch is mocked).
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import eventsHandler from '../api/events.js';
import learnersHandler from '../api/learners.js';
import configHandler from '../api/config.js';

const KEY = 'test-key-123';
let calls;
let realFetch;

beforeEach(() => {
  process.env.UMATE_ACCESS_KEY = KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
  process.env.SUPABASE_ANON_KEY = 'sb_publishable_test';
  calls = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const body = String(url).includes('learners?select') ? JSON.stringify([{ id: 'demo', nickname: 'Demo (judge)' }]) : '';
    return new Response(body, { status: body ? 200 : 201 });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function req({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const r = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(r, { method, url, headers });
  return r;
}
function res() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    end(b = '') {
      this.body = b;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

test('without the access key the API refuses and never calls Supabase', async () => {
  const r = res();
  await learnersHandler(req({ headers: {} }), r);
  assert.equal(r.statusCode, 401);
  const r2 = res();
  await learnersHandler(req({ headers: { 'x-umate-key': 'wrong-key-12' } }), r2);
  assert.equal(r2.statusCode, 401);
  assert.equal(calls.length, 0);
});

test('events are validated, trimmed and stored with the service key (never sent as a JWT)', async () => {
  const r = res();
  await eventsHandler(
    req({
      method: 'POST',
      headers: { 'x-umate-key': KEY },
      body: {
        room: 'ABC123',
        events: [
          { type: 'event', sessionId: 's-abc-0001', name: 'step_enter', step: 0, t: 1, data: { id: 'topup' }, learner: { id: 'demo', nickname: 'Demo' } },
          { type: 'transcript', sessionId: 's-abc-0001', who: 'buddy', text: 'Hello' },
          { type: 'event', sessionId: 'bad id with spaces', name: 'x' },
          { type: 'pose', sessionId: 's-abc-0001' },
        ],
      },
    }),
    r,
  );
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { saved: 2 });
  assert.equal(calls.length, 1);
  const { url, opts } = calls[0];
  assert.equal(url, 'https://example.supabase.co/rest/v1/events');
  assert.equal(opts.headers.apikey, 'sb_secret_test');
  assert.equal(opts.headers.Authorization, undefined);
  const rows = JSON.parse(opts.body);
  assert.equal(rows[0].learner_id, 'demo');
  assert.equal(rows[0].room, 'ABC123');
  assert.deepEqual(rows[1].data, { who: 'buddy', text: 'Hello' });
  assert.equal(rows[1].name, 'transcript');
});

test('learner profiles are read from Supabase', async () => {
  const r = res();
  await learnersHandler(req({ headers: { 'x-umate-key': KEY } }), r);
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().learners[0].id, 'demo');
});

test('the public config holds only browser-safe values', () => {
  const r = res();
  configHandler(req(), r);
  const cfg = r.json();
  assert.equal(cfg.mode, 'cloud');
  assert.equal(cfg.supabaseAnonKey, 'sb_publishable_test');
  assert.ok(!JSON.stringify(cfg).includes('sb_secret'), 'the secret key must never reach the browser');
});
