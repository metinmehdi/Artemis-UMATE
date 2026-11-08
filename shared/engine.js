// Scenario engine: a pure, deterministic state machine for the metro trip.
//
//   const trip = createTrip({ network, rules, scenario });
//   let state = initialState(trip, t0);
//   ({ state, events } = reduce(trip, state, { type: 'gate_tap', t }));
//
// The same code runs on the phone (VR app) and in the Node tests. It never reads the clock or the
// network: every action carries its own time `t` (milliseconds), so the same actions always give the
// same states and events. Money is counted in qəpik (integers) to avoid rounding errors.

export const STEPS = ['topup', 'gate', 'platform', 'ride'];
export const FAULTS = ['insufficient_balance', 'card_unreadable', 'train_delay', 'crowd_noise'];

const qepik = (azn) => Math.round(azn * 100);
const azn = (q) => q / 100;

/** Pre-compute everything about the trip that does not change while it runs. */
export function createTrip({ network, rules, scenario }) {
  const line = network.lines.find((l) => l.ref === scenario.line);
  if (!line) throw new Error(`line ${scenario.line} is not in the network data`);
  const station = (id) => {
    const s = network.stations.find((x) => x.id === id);
    if (!s) throw new Error(`station ${id} is not in the network data`);
    return s;
  };
  const fromIdx = line.stations.indexOf(scenario.from);
  const toIdx = line.stations.indexOf(scenario.to);
  if (fromIdx < 0 || toIdx < 0) throw new Error(`${scenario.from} and ${scenario.to} must both be on line ${line.ref}`);
  if (fromIdx === toIdx) throw new Error('the trip must start and end at different stations');
  const dir = toIdx > fromIdx ? 1 : -1;
  const terminusId = dir > 0 ? line.stations[line.stations.length - 1] : line.stations[0];
  const otherTerminusId = dir > 0 ? line.stations[0] : line.stations[line.stations.length - 1];
  // In the VR platform scene the sign towards the start of the line hangs on the left.
  const correctSide = dir < 0 ? 'left' : 'right';
  return {
    id: scenario.id,
    line: { ref: line.ref, name_en: line.name_en, colour: line.colour, stations: line.stations },
    from: station(scenario.from),
    to: station(scenario.to),
    terminus: station(terminusId),
    otherTerminus: station(otherTerminusId),
    dir,
    correctSide,
    stops: Math.abs(toIdx - fromIdx),
    fromIdx,
    toIdx,
    // next stations shown on each platform sign, closest first
    signs: {
      left: { towards: station(line.stations[0]), next: line.stations.slice(0, fromIdx).reverse().map(station) },
      right: { towards: station(line.stations[line.stations.length - 1]), next: line.stations.slice(fromIdx + 1).map(station) },
    },
    station,
    fare: qepik(rules.fare),
    topupAmounts: rules.topup_amounts.map(qepik),
    startBalance: qepik(rules.start_balance ?? 0),
    hintDelays: scenario.hint_delays_s.map((s) => s * 1000),
    steps: scenario.steps,
    faults: scenario.faults,
  };
}

export function initialState(trip, t = 0) {
  return {
    t,
    step: 0,
    location: 'hall', // hall | platform | train | arrived
    balance: trip.startBalance, // qəpik
    kiosk: 'idle', // idle | amount | done
    gate: null, // null | open | rejected | unread
    direction: null, // terminus id the learner chose
    ride: null, // { idx, dir, doorsOpen, passed }
    hint: { level: 0, since: t },
    faults: { insufficient_balance: false, card_unreadable: 0, train_delay: false, crowd_noise: false },
    stepStats: { startT: t, errors: 0, maxHint: 0, askedHelp: false },
    lastProgressT: t,
    done: false,
  };
}

/** Text helpers: visible text uses Azerbaijani station names, spoken hints use English names. */
export function fill(template, vars) {
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function textVars(trip, state, lang = 'az') {
  const n = (s) => (lang === 'az' ? s.name_az : s.name_en);
  const ride = state.ride;
  const stopsLeft = ride ? Math.abs(trip.toIdx - ride.idx) : trip.stops;
  const nextIdx = ride ? ride.idx + ride.dir : trip.fromIdx + trip.dir;
  const nextId = trip.line.stations[nextIdx];
  const hereId = ride ? trip.line.stations[ride.idx] : trip.from.id;
  return {
    here: n(trip.station(hereId)),
    from: n(trip.from),
    to: n(trip.to),
    terminus: n(trip.terminus),
    correct_side: trip.correctSide,
    stops_left: stopsLeft,
    next: nextId ? n(trip.station(nextId)) : '',
  };
}

/** The task card for the current step. */
export function taskOf(trip, state) {
  if (state.done) return { step: 4, total: 4, title: 'Well done!', sub: `You arrived at ${trip.to.name_az}` };
  const def = trip.steps[state.step];
  const vars = textVars(trip, state, 'az');
  let sub = def.sub;
  if (state.ride && !state.ride.passed) {
    if (vars.stops_left === 0 && def.sub_here) sub = def.sub_here;
    else if (vars.stops_left === 1 && def.sub_next) sub = def.sub_next;
  }
  return { step: state.step, total: STEPS.length, id: def.id, title: fill(def.title, vars), sub: fill(sub, vars), target: fill(def.target, vars) };
}

// ---------------------------------------------------------------------------------------------

function clone(s) {
  return JSON.parse(JSON.stringify(s));
}

/**
 * @param trip   from createTrip()
 * @param state  current state (not modified)
 * @param action { type, t, ... }
 * @returns {{ state, events: Array<{type: string, step: number, t: number}> }}
 */
export function reduce(trip, state, action) {
  const s = clone(state);
  const events = [];
  const t = typeof action.t === 'number' ? action.t : s.t;
  s.t = t;
  const emit = (type, data = {}) => events.push({ type, t, step: s.step, ...data });
  const stepId = () => STEPS[s.step];

  const error = (reason, data = {}) => {
    s.stepStats.errors += 1;
    emit('error', { reason, ...data });
  };
  const progress = () => {
    s.lastProgressT = t;
  };
  const completeStep = () => {
    const st = s.stepStats;
    emit('step_complete', { id: stepId(), ms: t - st.startT, errors: st.errors, maxHintLevel: st.maxHint, askedHelp: st.askedHelp });
    s.step += 1;
    s.stepStats = { startT: t, errors: 0, maxHint: 0, askedHelp: false };
    s.hint = { level: 0, since: t };
    progress();
    if (s.step >= STEPS.length) {
      s.done = true;
      s.location = 'arrived';
      emit('session_end', { completed: true });
    } else {
      emit('step_enter', { id: stepId() });
    }
  };
  const setHint = (level, trigger) => {
    if (level <= s.hint.level || level > 3 || s.done) return;
    s.hint = { level, since: t };
    s.stepStats.maxHint = Math.max(s.stepStats.maxHint, level);
    const def = trip.steps[s.step];
    emit('hint_shown', { level, trigger, text: fill(def.hints[level - 1], textVars(trip, s, 'en')), target: fill(def.target, textVars(trip, s, 'en')) });
  };
  const wallet = (tx, amount, before, ok) => emit('wallet', { tx, amount: azn(amount), balanceBefore: azn(before), balanceAfter: azn(s.balance), ok });
  const cardRead = (where) => {
    if (s.faults.card_unreadable > 0) {
      s.faults.card_unreadable -= 1;
      error('card_not_read', { where });
      if (s.faults.card_unreadable === 0) emit('fault_resolved', { fault: 'card_unreadable' });
      return false;
    }
    return true;
  };

  switch (action.type) {
    case 'start':
      emit('session_start', { trip: trip.id, from: trip.from.id, to: trip.to.id, stops: trip.stops });
      emit('step_enter', { id: stepId() });
      break;

    // ---- passing time: graduated hints ----
    case 'tick': {
      if (s.done) break;
      // On the train the only decision is where to get off, so idle hints only start once the
      // doors open at the destination (the arrival there resets the idle time).
      if (stepId() === 'ride' && !(s.ride && s.ride.doorsOpen && s.ride.idx === trip.toIdx)) break;
      const idle = t - s.lastProgressT;
      const due = trip.hintDelays.filter((d) => idle >= d).length;
      if (due > s.hint.level) setHint(due, 'idle');
      break;
    }
    case 'ask_help':
      s.stepStats.askedHelp = true;
      emit('help_asked', {});
      setHint(Math.min(3, s.hint.level + 1), 'ask');
      break;
    case 'trainer_hint':
      setHint(Math.max(1, Math.min(3, action.level || s.hint.level + 1)), 'trainer');
      break;

    // ---- step 0: top up ----
    case 'kiosk_tap_card':
      if (stepId() !== 'topup' && stepId() !== 'gate') break; // topping up again later is allowed
      if (!cardRead('kiosk')) break;
      s.kiosk = 'amount';
      progress();
      break;
    case 'topup': {
      const amount = qepik(action.amount);
      if (s.kiosk !== 'amount') break;
      if (!trip.topupAmounts.includes(amount)) {
        error('invalid_amount', { amount: action.amount });
        break;
      }
      const before = s.balance;
      s.balance += amount;
      s.kiosk = 'done';
      wallet('topup', amount, before, true);
      if (stepId() === 'topup') completeStep();
      else progress();
      break;
    }

    // ---- step 1: turnstile ----
    case 'gate_tap': {
      if (s.location !== 'hall' || s.gate === 'open') break;
      if (!cardRead('gate')) {
        s.gate = 'unread';
        break;
      }
      const before = s.balance;
      if (s.balance >= trip.fare) {
        s.balance -= trip.fare;
        s.gate = 'open';
        wallet('fare', trip.fare, before, true);
        progress();
      } else {
        s.gate = 'rejected';
        wallet('fare', trip.fare, before, false);
        error('insufficient_balance', { balance: azn(before), fare: azn(trip.fare) });
        if (s.faults.insufficient_balance) {
          s.faults.insufficient_balance = false;
          emit('fault_resolved', { fault: 'insufficient_balance' });
        }
        // let the learner use the top-up machine again (the step itself does not go back)
        if (s.kiosk === 'done') s.kiosk = 'idle';
      }
      break;
    }
    case 'gate_reset':
      if (s.gate === 'rejected' || s.gate === 'unread') s.gate = null;
      break;
    case 'walk':
      if (action.to === 'platform' && s.gate === 'open' && s.location === 'hall') {
        s.location = 'platform';
        if (stepId() === 'topup') completeStep(); // safety: should not happen, the gate needs money
        if (stepId() === 'gate') completeStep();
      }
      break;

    // ---- step 2: platform direction ----
    case 'choose_direction': {
      if (stepId() !== 'platform' || s.location !== 'platform') break;
      const towards = action.side ? trip.signs[action.side]?.towards.id : action.towards;
      const ok = towards === trip.terminus.id;
      emit('choice', { towards, ok });
      if (!ok) {
        error('wrong_direction', { towards });
        break;
      }
      s.direction = towards;
      completeStep();
      // the train comes; a delay fault holds it at the platform until it is cleared
      if (!s.faults.train_delay) board(s, trip, emit);
      else emit('announcement', { kind: 'delay', minutes: trip.faults.train_delay.minutes });
      break;
    }

    // ---- step 3: ride ----
    case 'train_next': {
      if (s.location !== 'train' || s.faults.train_delay) break;
      const r = s.ride;
      r.idx += r.dir;
      r.doorsOpen = true;
      const id = trip.line.stations[r.idx];
      const atDest = r.idx === trip.toIdx;
      progress();
      if (!atDest && (r.idx - trip.toIdx) * r.dir > 0 && !r.passed) {
        r.passed = true;
        error('missed_stop', { station: id });
      }
      emit('arrive_station', { station: id, stopsLeft: Math.abs(trip.toIdx - r.idx), atDestination: atDest });
      if (r.idx === 0 || r.idx === trip.line.stations.length - 1) {
        // end of the line: everybody gets off and takes the train back
        r.dir = -r.dir;
      }
      break;
    }
    case 'exit': {
      if (s.location !== 'train' || !s.ride.doorsOpen) break;
      const r = s.ride;
      if (r.idx === trip.toIdx) {
        completeStep();
      } else if (r.passed) {
        // got off after missing the stop: cross the platform and ride back
        emit('return_trip', { from: trip.line.stations[r.idx] });
        r.dir = trip.toIdx > r.idx ? 1 : -1;
        r.passed = false;
        progress();
      } else {
        error('exit_too_early', { station: trip.line.stations[r.idx], stopsLeft: Math.abs(trip.toIdx - r.idx) });
      }
      break;
    }
    case 'doors_close':
      if (s.ride) s.ride.doorsOpen = false;
      break;

    // ---- faults injected by the trainer ----
    case 'fault': {
      const f = action.fault;
      if (!FAULTS.includes(f)) break;
      emit('fault_injected', { fault: f, by: action.by || 'trainer' });
      if (f === 'insufficient_balance') {
        const before = s.balance;
        s.balance = Math.min(s.balance, qepik(trip.faults.insufficient_balance.set_balance));
        s.faults.insufficient_balance = true; // after the gate it only matters for the next trip
        wallet('fault_set_balance', 0, before, true);
      } else if (f === 'card_unreadable') {
        s.faults.card_unreadable = trip.faults.card_unreadable.failures;
      } else if (f === 'train_delay') {
        s.faults.train_delay = true;
        emit('announcement', { kind: 'delay', minutes: trip.faults.train_delay.minutes });
      } else if (f === 'crowd_noise') {
        s.faults.crowd_noise = true;
      }
      break;
    }
    case 'fault_clear': {
      const f = action.fault;
      if (f === 'train_delay' && s.faults.train_delay) {
        s.faults.train_delay = false;
        emit('fault_resolved', { fault: f });
        if (s.location === 'platform' && s.direction) board(s, trip, emit);
      } else if (f === 'crowd_noise' && s.faults.crowd_noise) {
        s.faults.crowd_noise = false;
        emit('fault_resolved', { fault: f });
      } else if (f === 'card_unreadable' && s.faults.card_unreadable) {
        s.faults.card_unreadable = 0;
        emit('fault_resolved', { fault: f });
      } else if (f === 'insufficient_balance' && s.faults.insufficient_balance) {
        s.faults.insufficient_balance = false;
        emit('fault_resolved', { fault: f });
      }
      break;
    }
    default:
      break;
  }
  return { state: s, events };
}

function board(s, trip, emit) {
  s.location = 'train';
  s.ride = { idx: trip.fromIdx, dir: trip.dir, doorsOpen: false, passed: false };
  emit('boarded', { towards: trip.terminus.id });
}

/** Convenience wrapper for the apps: keeps the state and hands every event to a listener. */
export class Engine {
  constructor(data, onEvent = () => {}) {
    this.trip = createTrip(data);
    this.onEvent = onEvent;
    this.state = initialState(this.trip, 0);
  }
  reset(t) {
    this.state = initialState(this.trip, t);
    return this.dispatch({ type: 'start', t });
  }
  dispatch(action) {
    const { state, events } = reduce(this.trip, this.state, action);
    this.state = state;
    for (const e of events) this.onEvent(e, state);
    return events;
  }
  get task() {
    return taskOf(this.trip, this.state);
  }
}
