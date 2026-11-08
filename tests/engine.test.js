// Scenario engine tests: the trip logic the phone runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrip, initialState, reduce, taskOf } from '../shared/engine.js';
import { loadData } from './helpers.js';

const data = loadData();

/** Run a list of actions; time advances 1 s per action unless an action sets t. */
function run(actions, trip = createTrip(data)) {
  let state = initialState(trip, 0);
  const events = [];
  let t = 0;
  for (const a of [{ type: 'start' }, ...actions]) {
    t = a.t ?? t + 1000;
    const r = reduce(trip, state, { ...a, t });
    state = r.state;
    events.push(...r.events);
  }
  return { trip, state, events, of: (type) => events.filter((e) => e.type === type) };
}

const TOP_UP = [{ type: 'kiosk_tap_card' }, { type: 'topup', amount: 1 }];
const THROUGH_GATE = [...TOP_UP, { type: 'gate_tap' }, { type: 'walk', to: 'platform' }];
const RIDE_4 = Array(4).fill({ type: 'train_next' });
const HAPPY = [...THROUGH_GATE, { type: 'choose_direction', side: 'left' }, ...RIDE_4, { type: 'exit' }];

test('the trip is Koroğlu -> 28 May, 4 stops towards İçərişəhər, left sign', () => {
  const trip = createTrip(data);
  assert.equal(trip.from.name_az, 'Koroğlu');
  assert.equal(trip.to.name_az, '28 May');
  assert.equal(trip.stops, 4);
  assert.equal(trip.terminus.name_az, 'İçərişəhər');
  assert.equal(trip.correctSide, 'left');
  assert.deepEqual(trip.signs.left.next.slice(0, 4).map((s) => s.name_az), ['Ulduz', 'Nəriman Nərimanov', 'Gənclik', '28 May']);
});

test('happy path: all 4 steps complete, the fare is paid once, the session ends', () => {
  const r = run(HAPPY);
  assert.equal(r.state.done, true);
  assert.equal(r.state.balance, 40); // 1.00 - 0.60, in qəpik
  assert.deepEqual(r.of('step_complete').map((e) => e.id), ['topup', 'gate', 'platform', 'ride']);
  assert.ok(r.of('step_complete').every((e) => e.errors === 0));
  assert.equal(r.of('session_end').length, 1);
  assert.deepEqual(r.of('arrive_station').map((e) => e.station), ['ulduz', 'nariman-narimanov', 'ganjlik', '28-may']);
  assert.equal(taskOf(r.trip, r.state).title, 'Well done!');
});

test('the same actions always give the same states and events (deterministic)', () => {
  const a = run(HAPPY);
  const b = run(HAPPY);
  assert.deepEqual(a.events, b.events);
  assert.deepEqual(a.state, b.state);
});

test('a refused payment never changes the balance', () => {
  const r = run([{ type: 'gate_tap' }]);
  const w = r.of('wallet')[0];
  assert.equal(w.ok, false);
  assert.equal(w.balanceBefore, w.balanceAfter);
  assert.equal(r.state.balance, 0);
  assert.equal(r.state.gate, 'rejected');
  assert.equal(r.of('error')[0].reason, 'insufficient_balance');
  assert.equal(r.state.step, 0);
});

test('fault: not enough balance after topping up, top up again, then pass', () => {
  const r = run([
    ...TOP_UP,
    { type: 'fault', fault: 'insufficient_balance' },
    { type: 'gate_tap' },
    { type: 'gate_reset' },
    { type: 'kiosk_tap_card' },
    { type: 'topup', amount: 1 },
    { type: 'gate_tap' },
    { type: 'walk', to: 'platform' },
  ]);
  assert.equal(r.state.location, 'platform');
  assert.equal(r.state.balance, 20 + 100 - 60);
  const gate = r.of('step_complete').find((e) => e.id === 'gate');
  assert.equal(gate.errors, 1);
  assert.ok(r.of('fault_resolved').some((e) => e.fault === 'insufficient_balance'));
});

test('fault: card not read fails once without charging, the second tap works', () => {
  const r = run([...TOP_UP, { type: 'fault', fault: 'card_unreadable' }, { type: 'gate_tap' }, { type: 'gate_reset' }, { type: 'gate_tap' }]);
  assert.equal(r.of('error')[0].reason, 'card_not_read');
  assert.equal(r.of('wallet').filter((w) => w.tx === 'fare').length, 1);
  assert.equal(r.state.balance, 40);
  assert.equal(r.state.gate, 'open');
});

test('fault: a train delay holds the learner on the platform until it is cleared', () => {
  const r = run([
    ...THROUGH_GATE,
    { type: 'fault', fault: 'train_delay' },
    { type: 'choose_direction', side: 'left' },
    { type: 'train_next' },
  ]);
  assert.equal(r.state.location, 'platform');
  assert.ok(r.of('announcement').length >= 1);
  const trip = r.trip;
  let { state } = r;
  ({ state } = reduce(trip, state, { type: 'fault_clear', fault: 'train_delay', t: 99_000 }));
  assert.equal(state.location, 'train');
});

test('fault: crowd and noise does not block the trip', () => {
  const r = run([{ type: 'fault', fault: 'crowd_noise' }, ...HAPPY]);
  assert.equal(r.state.done, true);
  assert.equal(r.state.faults.crowd_noise, true);
});

test('wrong direction counts an error, then the right sign finishes the step', () => {
  const r = run([...THROUGH_GATE, { type: 'choose_direction', side: 'right' }, { type: 'choose_direction', side: 'left' }]);
  assert.equal(r.of('error')[0].reason, 'wrong_direction');
  assert.equal(r.of('step_complete').find((e) => e.id === 'platform').errors, 1);
  assert.equal(r.state.location, 'train');
});

test('getting off too early is refused; missing the stop leads to a ride back', () => {
  const early = run([...THROUGH_GATE, { type: 'choose_direction', side: 'left' }, { type: 'train_next' }, { type: 'exit' }]);
  assert.equal(early.of('error')[0].reason, 'exit_too_early');
  assert.equal(early.state.location, 'train');

  const missed = run([
    ...THROUGH_GATE,
    { type: 'choose_direction', side: 'left' },
    ...RIDE_4,
    { type: 'train_next' }, // passes 28 May, now at Sahil
    { type: 'exit' }, // get off and cross the platform
    { type: 'train_next' }, // back to 28 May
    { type: 'exit' },
  ]);
  assert.equal(missed.of('error')[0].reason, 'missed_stop');
  assert.equal(missed.of('return_trip').length, 1);
  assert.equal(missed.state.done, true);
});

test('hints rise with idle time (8 s, 15 s, 25 s), never above level 3, and reset on the next step', () => {
  const r = run([{ type: 'tick', t: 8_000 }, { type: 'tick', t: 15_000 }, { type: 'tick', t: 25_000 }, { type: 'tick', t: 60_000 }]);
  assert.deepEqual(r.of('hint_shown').map((h) => h.level), [1, 2, 3]);
  assert.ok(r.of('hint_shown').every((h) => h.trigger === 'idle' && h.text.length > 0));
  const after = run([{ type: 'tick', t: 9_000 }, { type: 'kiosk_tap_card', t: 10_000 }, { type: 'topup', amount: 1, t: 11_000 }]);
  assert.equal(after.state.hint.level, 0);
  assert.equal(after.of('step_complete')[0].maxHintLevel, 1);
});

test('asking the buddy for help raises the hint and is recorded as asked, not as an error', () => {
  const r = run([{ type: 'ask_help' }, ...TOP_UP]);
  const done = r.of('step_complete')[0];
  assert.equal(done.askedHelp, true);
  assert.equal(done.maxHintLevel, 1);
  assert.equal(done.errors, 0);
});

test('the platform hint names the right terminus in English', () => {
  const r = run([...THROUGH_GATE, { type: 'ask_help' }, { type: 'ask_help' }]);
  const h = r.of('hint_shown').filter((e) => e.step === 2);
  assert.match(h[1].text, /Icherisheher/);
  assert.equal(h[1].target, 'sign:left');
});

test('only the offered top-up amounts are accepted', () => {
  const r = run([{ type: 'kiosk_tap_card' }, { type: 'topup', amount: 3 }]);
  assert.equal(r.of('error')[0].reason, 'invalid_amount');
  assert.equal(r.state.balance, 0);
});

test('the rules file drives the behaviour: a higher fare makes 1 AZN not enough', () => {
  const trip = createTrip({ ...data, rules: { ...data.rules, fare: 1.5 } });
  const r = run(THROUGH_GATE, trip);
  assert.equal(r.state.gate, 'rejected');
  assert.equal(r.state.location, 'hall');
});

test('direction and stop count are right for every pair of Red line stations', () => {
  const red = data.network.lines.find((l) => l.ref === '1').stations;
  for (const from of red) {
    for (const to of red) {
      if (from === to) continue;
      const trip = createTrip({ ...data, scenario: { ...data.scenario, from, to } });
      const i = red.indexOf(from);
      const j = red.indexOf(to);
      assert.equal(trip.stops, Math.abs(i - j));
      assert.equal(trip.terminus.id, j < i ? red[0] : red[red.length - 1]);
      const sign = trip.signs[trip.correctSide];
      assert.equal(sign.towards.id, trip.terminus.id);
      assert.ok(sign.next.some((s) => s.id === to), `${to} must be listed on the ${trip.correctSide} sign at ${from}`);
    }
  }
});
