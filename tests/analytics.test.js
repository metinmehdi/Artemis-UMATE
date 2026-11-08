// Gold layer tests: session logs -> star schema -> learner progress.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrip, initialState, reduce } from '../shared/engine.js';
import { buildStar, checkKeys, learnerProgress, parseJsonl } from '../shared/analytics.js';
import { generateSample } from '../tools/gen-sample.js';
import { loadData } from './helpers.js';

const trip = createTrip(loadData());
const learner = { id: 'aysel', nickname: 'Aysel' };

/** Turn engine actions into log lines exactly like the server writes them. */
function logOf(sessionId, actions, { day = 0, who = learner } = {}) {
  const t0 = Date.UTC(2026, 10, 1 + day, 10);
  let state = initialState(trip, 0);
  const lines = [{ t: t0, sessionId, type: 'event', name: 'device', step: 0, data: { device: 'Android', mode: 'vr' }, learner: who }];
  let t = 0;
  for (const a of [{ type: 'start' }, ...actions]) {
    t = a.t ?? t + 1000;
    const r = reduce(trip, state, { ...a, t });
    state = r.state;
    for (const e of r.events) lines.push({ t: t0 + t, sessionId, type: 'event', name: e.type, step: e.step, data: e, learner: who });
  }
  return lines;
}

const TOP_UP = [{ type: 'kiosk_tap_card' }, { type: 'topup', amount: 1 }];
const TO_PLATFORM = [...TOP_UP, { type: 'gate_tap' }, { type: 'walk', to: 'platform' }];
const FULL = [...TO_PLATFORM, { type: 'choose_direction', side: 'left' }, ...Array(4).fill({ type: 'train_next' }), { type: 'exit' }];

test('a full trip becomes one session row and 4 completed step rows with matching keys', () => {
  const star = buildStar(logOf('s1', FULL));
  assert.equal(star.facts.fact_session.length, 1);
  const s = star.facts.fact_session[0];
  assert.equal(s.completed, true);
  assert.equal(s.learner_key, 'aysel');
  assert.equal(s.steps_completed, 4);
  assert.equal(s.independent_steps, 4);
  assert.deepEqual(star.facts.fact_step_attempt.map((a) => a.step_key), ['topup', 'gate', 'platform', 'ride']);
  assert.deepEqual(checkKeys(star), []);
});

test('mistakes, hints and help requests are counted per step', () => {
  const star = buildStar(
    logOf('s2', [
      { type: 'gate_tap' }, // refused: no money yet
      { type: 'ask_help' },
      ...TOP_UP,
      { type: 'gate_tap' },
      { type: 'walk', to: 'platform' },
      { type: 'choose_direction', side: 'right' }, // wrong way
      { type: 'choose_direction', side: 'left' },
    ]),
  );
  const step = (k) => star.facts.fact_step_attempt.find((a) => a.step_key === k);
  assert.equal(step('topup').errors, 1);
  assert.equal(step('topup').asked_help, true);
  assert.equal(step('topup').max_hint_level, 1);
  assert.equal(step('platform').errors, 1);
  assert.equal(star.facts.fact_session[0].independent_steps, 1); // only the turnstile was done alone
});

test('an unfinished session keeps the open step as not completed', () => {
  const star = buildStar(logOf('s3', [...TOP_UP, { type: 'tick', t: 20_000 }]));
  const open = star.facts.fact_step_attempt.find((a) => a.step_key === 'gate');
  assert.equal(open.completed, false);
  assert.equal(open.max_hint_level, 2);
  assert.equal(star.facts.fact_session[0].completed, false);
});

test('trainer challenges are recorded with the step and whether they were resolved', () => {
  const star = buildStar(logOf('s4', [...TOP_UP, { type: 'fault', fault: 'card_unreadable' }, { type: 'gate_tap' }, { type: 'gate_reset' }, { type: 'gate_tap' }]));
  const f = star.facts.fact_fault[0];
  assert.equal(f.fault_key, 'card_unreadable');
  assert.equal(f.step_key, 'gate');
  assert.equal(f.resolved, true);
  assert.ok(f.ms_to_resolve >= 0);
});

test('pages that were opened but never started a trip are skipped and counted', () => {
  const star = buildStar([{ t: 1, sessionId: 'x', type: 'event', name: 'device', data: {} }]);
  assert.equal(star.facts.fact_session.length, 0);
  assert.equal(star.quality.sessions_without_start, 1);
});

test('broken JSONL lines are counted, not fatal', () => {
  const r = parseJsonl('{"a":1}\nnot json\n\n{"b":2}\n');
  assert.equal(r.events.length, 2);
  assert.equal(r.broken, 1);
});

test('readiness rule: the last 3 completed sessions each have at least 3 steps done alone', () => {
  const lines = [];
  for (let d = 0; d < 3; d++) lines.push(...logOf(`r${d}`, FULL, { day: d }));
  const ready = learnerProgress(buildStar(lines), 'aysel');
  assert.equal(ready.ready, true);
  assert.equal(ready.sessions.length, 3);

  lines.push(...logOf('r3', [{ type: 'ask_help' }, { type: 'ask_help' }, ...TOP_UP, { type: 'gate_tap' }, { type: 'gate_tap' }, { type: 'walk', to: 'platform' }, { type: 'choose_direction', side: 'right' }, { type: 'choose_direction', side: 'left' }, ...Array(4).fill({ type: 'train_next' }), { type: 'exit' }], { day: 5 }));
  const notYet = learnerProgress(buildStar(lines), 'aysel');
  assert.equal(notYet.ready, false);
  assert.ok(['topup', 'platform'].includes(notYet.focus_step));
});

test('the NÜMUNƏ sample is deterministic and clearly labelled', () => {
  const a = generateSample({ learners: 3 });
  const b = generateSample({ learners: 3 });
  assert.deepEqual(a, b);
  assert.ok(a.every((l) => l.sample === true && l.learner.nickname.startsWith('NÜMUNƏ')));
  const star = buildStar(a);
  assert.deepEqual(checkKeys(star), []);
  assert.ok(star.facts.fact_session.every((s) => s.is_sample));
  assert.ok(star.dims.dim_learner.every((l) => l.is_sample));
});

test('real and sample sessions stay separable in the same star', () => {
  const star = buildStar([...logOf('real1', FULL), ...generateSample({ learners: 1 })]);
  const real = star.facts.fact_session.filter((s) => !s.is_sample);
  assert.equal(real.length, 1);
  assert.equal(real[0].session_key, 'real1');
});
