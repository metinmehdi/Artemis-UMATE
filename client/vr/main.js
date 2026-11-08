// Phone VR app: photoreal Baku Metro panoramas + gaze input + AI buddy + live link to the panel.
// The trip logic lives in the shared scenario engine (shared/engine.js); this file only turns
// gaze selections into engine actions and engine events into visuals, sounds and buddy lines.
import * as THREE from 'three';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
import { buildWorld, EYE, yawOfU } from '/shared/world.js';
import { loadFonts } from '/shared/ui3d.js';
import { loadTripData } from '/shared/data.js';
import { Engine } from '/shared/engine.js';
import { Gyro, DragLook } from './gyro.js';
import { Gaze } from './gaze.js';
import { Net } from './net.js';
import { Companion } from './companion.js';
import { OfflineVoice } from './voice.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#c');
const fadeEl = $('#fade');
const logEl = $('#log');
const now = () => Math.round(performance.now());

const [, tripData] = await Promise.all([loadFonts(), loadTripData()]);

// ---------- scenario engine ----------
const engine = new Engine(tripData, (e) => onEngineEvent(e));
const trip = engine.trip;

// ---------- renderer / camera / rig ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 60);
camera.position.y = EYE;
const rig = new THREE.Group();
rig.add(camera);

const world = buildWorld({ trip });
world.scene.add(rig);

const stereo = new StereoEffect(renderer);
stereo.setEyeSeparation(0.064);

let vrMode = true;
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  stereo.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = vrMode ? 85 : 72;
  camera.updateProjectionMatrix();
  document.body.classList.toggle('portrait', vrMode && innerHeight > innerWidth);
}
addEventListener('resize', resize);
resize();

// ---------- input ----------
const gyro = new Gyro();
const drag = new DragLook(canvas);
const gaze = new Gaze(camera, { dwell: 1.5 });
gaze.targets = world.interactives;

canvas.addEventListener('pointerup', () => {
  if (started && drag.moved < 8) gaze.fire();
});
addEventListener('keydown', (e) => {
  if (!started || e.repeat) return;
  if (e.key === 'r' || e.key === 'R') return recenter();
  gaze.fire();
});
let padPrev = false;
function pollGamepad() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const pressed = pads.some((p) => p.buttons.some((b) => b.pressed));
  if (pressed && !padPrev) gaze.fire();
  padPrev = pressed;
}

// ---------- session / network ----------
const deviceId = (() => {
  try {
    let id = localStorage.getItem('umate-device');
    if (!id) localStorage.setItem('umate-device', (id = 'phone-' + Math.random().toString(36).slice(2, 8)));
    return id;
  } catch {
    return 'phone-' + Math.random().toString(36).slice(2, 8);
  }
})();
const deviceName = /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android' : 'Desktop';
let sessionId = null;

const net = new Net({
  role: 'phone',
  id: deviceId,
  device: deviceName,
  onStatus: (ok) => setStatus('server', ok ? 'ok' : 'down'),
  onMessage: (m) => {
    if (m.type !== 'cmd') return;
    if (m.cmd === 'recenter') recenter();
    if (m.cmd === 'say' && (m.text || m.voice)) speak(m.voice, m.text);
    if (m.cmd === 'reset') resetFlow();
    if (m.cmd === 'reload') location.reload();
    if (m.cmd === 'fault' && m.fault) act({ type: 'fault', fault: m.fault, by: 'trainer' });
    if (m.cmd === 'fault_clear' && m.fault) act({ type: 'fault_clear', fault: m.fault });
    if (m.cmd === 'hint') act({ type: 'trainer_hint' });
    if (m.cmd === 'pace') {
      Object.assign(RIDE, m.short ? RIDE_SHORT : RIDE_NORMAL);
      state.shortRide = !!m.short;
      pushState();
    }
  },
});

function event(name, data = {}) {
  if (!sessionId) return;
  net.send({ type: 'event', sessionId, name, step: state.step, node: state.node, data });
}

// ---------- AI buddy ----------
const companion = new Companion({
  onMode: (m) => {
    state.buddyMode = m;
    pushState();
    setStatus('ai', m);
    net.send({ type: 'status', ai: m });
    // the live voice could not start (no internet, no credit): greet with the recorded voice
    if (m === 'offline' && started && !greeted) {
      greeted = true;
      voice.play('greet');
    }
    if (m === 'idle') greeted = true; // the live buddy greets by itself
  },
  onTranscript: (who, text) => {
    net.send({ type: 'transcript', sessionId, who, text, step: state.step });
    log(`${who}: ${text}`);
  },
  onLog: (lvl, text) => {
    log(text);
    event('ai_log', { lvl, text });
  },
});

// Recorded lines for when the live voice is not available (client/assets/voice, made by
// tools/gen-voice.js). Every buddy line has a key; the live AI gets a richer instruction instead.
const voice = new OfflineVoice({
  onLine: (key, text) => {
    net.send({ type: 'transcript', sessionId, who: 'buddy', text: `${text} (recorded voice)`, step: state.step });
    log(`buddy (recorded): ${text}`);
  },
});
const voiceReady = voice.load(); // not awaited: the module must finish setting up first
let greeted = false;
function speak(key, instruction) {
  if (companion.ready && instruction) companion.say(instruction);
  else if (key) voice.play(key);
}

// ---------- view helpers ----------
const tmpE = new THREE.Euler();
function faceYaw(targetYaw) {
  tmpE.setFromQuaternion(camera.quaternion, 'YXZ');
  rig.rotation.y = targetYaw - tmpE.y;
}
function recenter() {
  faceYaw(world.forwardYaw(state.node));
  event('recenter');
}
let teleporting = false;
function teleport(after) {
  if (teleporting) return void setTimeout(() => teleport(after), 300); // queue, never drop
  teleporting = true;
  fadeEl.classList.add('on');
  setTimeout(() => {
    after();
    faceYaw(world.forwardYaw(state.node));
    fadeEl.classList.remove('on');
    teleporting = false;
  }, 260);
}

// ---------- view state (what the 3D world shows) ----------
// Derived from the engine state, plus a few purely visual things (kiosk screen open, payment
// animation, short feedback messages).
const state = {};
let taskOverride = null; // short-lived warning or praise on the task card
let overrideTimer = 0;
let hintInfo = null; // last hint_shown event of the current step
let inTrain = false; // boarded and the fade into the car has happened
let ridePhase = null; // 'moving' | 'doors' while riding
let rideTimer = 0;
let stats = { hints: 0, errors: 0, askedHelp: false }; // for the arrival summary
const en = (s) => s.name_en;
const az = (s) => s.name_az;

function flash(task, ms = 3500, then) {
  taskOverride = task;
  clearTimeout(overrideTimer);
  overrideTimer = setTimeout(() => {
    taskOverride = null;
    then?.();
    syncView();
  }, ms);
}

function syncView() {
  const e = engine.state;
  state.step = e.step;
  const onBoard = e.location === 'train' || e.location === 'arrived';
  state.node = e.location === 'hall' ? 'hall' : onBoard && inTrain ? 'train' : 'platform';
  state.ride = e.ride
    ? {
        idx: e.ride.idx,
        nextIdx: e.ride.idx + e.ride.dir,
        phase: e.faults.train_delay && onBoard ? 'delay' : ridePhase === 'moving' ? 'moving' : 'doors',
        doorsOpen: e.ride.doorsOpen && !e.done,
        atDest: e.ride.idx === trip.toIdx,
      }
    : null;
  state.balance = e.balance / 100;
  if (state.kiosk !== 'paying') state.kiosk = e.kiosk;
  state.gate = { open: 'ok', rejected: 'bad', unread: 'unread' }[e.gate] || null;
  state.targets = e.gate === 'open' && e.location === 'hall' ? ['platform'] : [];
  state.hint = hintInfo ? { level: hintInfo.level, target: hintInfo.target } : null;
  state.faults = e.faults;
  const task = { ...engine.task };
  if (hintInfo && !e.done) task.sub = hintInfo.text;
  state.task = taskOverride ? { ...task, ...taskOverride } : task;
  pushState();
}

function pushState() {
  world.applyState(state);
  net.send({ type: 'state', state });
}

function act(action) {
  const events = engine.dispatch({ t: now(), ...action });
  syncView();
  return events;
}

function resetFlow() {
  clearTimeout(overrideTimer);
  taskOverride = null;
  hintInfo = null;
  stopCrowd();
  stopRide();
  voice.stop();
  inTrain = false;
  stats = { hints: 0, errors: 0, askedHelp: false };
  Object.assign(state, { kioskOpen: false, kiosk: 'idle', amount: null, progress: 0, sign: null, feedback: null, trainFeedback: null, summary: null, buddyMode: companion.mode });
  engine.reset(now());
  faceYaw(world.forwardYaw('hall'));
  syncView();
}

// ---------- engine events -> feedback, sounds, buddy, log ----------
const balance = () => (engine.state.balance / 100).toFixed(2); // engine state is current inside events
const STEP_CONTEXT = {
  topup: () => `New trip: ${en(trip.from)} to ${en(trip.to)} on the ${trip.line.name_en}. Task: top up the BakuKart at the machine on the left. Balance ${balance()} AZN, a ride costs ${(trip.fare / 100).toFixed(2)} AZN.`,
  gate: () => `Top-up done. Balance ${balance()} AZN. Next task: tap the card at the turnstile straight ahead.`,
  platform: () =>
    `Learner is on the ${en(trip.from)} platform (${trip.line.name_en}). Trip: ${en(trip.from)} to ${en(trip.to)}, ${trip.stops} stops. ${en(trip.to)} is towards ${en(trip.terminus)}: the ${trip.correctSide.toUpperCase()} sign. The other sign goes towards ${en(trip.otherTerminus)} (wrong way). Task: choose the correct direction sign.`,
  ride: () => `Learner is on the train towards ${en(trip.terminus)}. They get off at ${en(trip.to)} after ${trip.stops} stops.`,
};

// ---------- train ride: doors close -> moving -> arrival announcement -> doors open ----------
// Timings are short on purpose (a real stop-to-stop ride is ~2 min). At the destination the doors
// stay open longer so the graduated hints have time to help.
// "Short ride" (panel) is for a stage demo with little time: about 25 s for 4 stations instead of 55 s.
const RIDE_NORMAL = { boardDelay: 2500, firstDeparture: 3500, move: 7000, doors: 6000, destDoors: 30000 };
const RIDE_SHORT = { boardDelay: 1500, firstDeparture: 1500, move: 3000, doors: 3000, destDoors: 25000 };
const RIDE = { ...RIDE_NORMAL };

function stopRide() {
  clearTimeout(rideTimer);
  ridePhase = null;
  rumble?.stop();
  rumble = null;
}
function startRide() {
  ridePhase = 'doors';
  syncView();
  rideTimer = setTimeout(depart, RIDE.firstDeparture);
}
function depart() {
  const e = engine.state;
  if (e.done || e.location !== 'train') return;
  if (e.faults.train_delay) {
    // held at the station with the doors open until the delay ends
    syncView();
    rideTimer = setTimeout(depart, 1000);
    return;
  }
  if (e.ride.doorsOpen) act({ type: 'doors_close' });
  chime();
  ridePhase = 'moving';
  state.trainFeedback = null;
  rumble = rumble || noise({ freq: 260, gain: 0.22, fadeIn: 1.2 });
  const nextIdx = e.ride.idx + e.ride.dir;
  const next = trip.station(trip.line.stations[nextIdx]);
  setTimeout(() => announce(`Next station: ${next.name_en}.`), 1200);
  if (nextIdx === trip.toIdx) {
    speak('ride:get_ready', `The next station is ${en(trip.to)}, where the learner gets off. Tell them kindly, in one short sentence, to get ready.`);
  }
  syncView();
  rideTimer = setTimeout(arrive, RIDE.move);
}
function arrive() {
  const e = engine.state;
  if (e.done || e.location !== 'train') return;
  if (e.faults.train_delay) {
    // stopped in the tunnel until the delay ends
    rumble?.stop();
    rumble = null;
    syncView();
    rideTimer = setTimeout(arrive, 1000);
    return;
  }
  rumble?.stop();
  rumble = null;
  ridePhase = 'doors';
  act({ type: 'train_next' });
  const r = engine.state.ride;
  rideTimer = setTimeout(depart, r.idx === trip.toIdx ? RIDE.destDoors : RIDE.doors);
}

function onEngineEvent(e) {
  event(e.type, e);
  if (e.type === 'hint_shown') stats.hints += 1;
  if (e.type === 'error') stats.errors += 1;
  if (e.type === 'help_asked') stats.askedHelp = true;
  switch (e.type) {
    case 'boarded':
      // the train pulls in, then we fade into the car
      noise({ freq: 220, gain: 0.25, fadeIn: 0.8, duration: RIDE.boardDelay / 1000 + 0.6 });
      setTimeout(() => {
        if (engine.state.location !== 'train') return;
        teleport(() => {
          inTrain = true;
          startRide();
        });
      }, RIDE.boardDelay);
      break;
    case 'arrive_station': {
      const st = trip.station(e.station);
      announce(`This is ${st.name_en}.`);
      if (e.atDestination) state.trainFeedback = { ok: true, text: `${st.name_az}: your stop!` };
      break;
    }
    case 'return_trip':
      state.trainFeedback = { ok: true, text: `Train back to ${az(trip.to)}` };
      speak('ride:return', `The learner got off after missing the stop. Calmly say: we cross to the other side and take the train back to ${en(trip.to)}. Well done for staying calm.`);
      teleport(() => {
        ridePhase = 'doors';
        clearTimeout(rideTimer);
        rideTimer = setTimeout(depart, RIDE.firstDeparture);
        syncView();
      });
      break;
    case 'step_complete':
      if (e.id === 'ride') {
        stopRide();
        teleport(() => {
          state.summary = { steps: 4, hints: stats.hints, errors: stats.errors, askedHelp: stats.askedHelp };
          state.trainFeedback = null;
          syncView();
        });
      }
      break;
  }
  switch (e.type) {
    case 'step_enter':
      hintInfo = null;
      companion.context(STEP_CONTEXT[e.id]());
      break;
    case 'hint_shown':
      hintInfo = e;
      log(`hint ${e.level}: ${e.text}`);
      if (e.level === 1 || e.level === 3 || e.trigger === 'ask') speak(`hint:${trip.steps[e.step]?.id}:${e.level}`, `Give the learner this hint kindly, in one short sentence: "${e.text}"`);
      break;
    case 'wallet':
      if (e.tx === 'topup') beep(880, 120);
      if (e.tx === 'fare' && e.ok) beep(990, 160);
      break;
    case 'error':
      beep(220, 260);
      if (e.reason === 'insufficient_balance') {
        flash({ tone: 'warn', title: 'Not enough balance', sub: 'Top up your card at the machine first' }, 3500, () => act({ type: 'gate_reset' }));
        speak('err:insufficient_balance', `The turnstile rejected the card: not enough balance (${e.balance.toFixed(2)} AZN, the fare is ${e.fare.toFixed(2)} AZN). Calmly say this is okay and that they can top up at the machine on the left.`);
      } else if (e.reason === 'card_not_read') {
        flash({ tone: 'warn', title: 'Card not read', sub: 'Hold the card still on the reader and try again' }, 3500, () => act({ type: 'gate_reset' }));
        speak('err:card_not_read', 'The card was not read. Calmly say this happens, and to hold the card still on the reader and try again.');
      } else if (e.reason === 'exit_too_early') {
        state.trainFeedback = { ok: false, text: `Not yet: ${e.stopsLeft} ${e.stopsLeft === 1 ? 'stop' : 'stops'} left` };
        speak('err:exit_too_early', `The learner tried to get off too early. Gently say: not yet, ${e.stopsLeft} more ${e.stopsLeft === 1 ? 'stop' : 'stops'} to ${en(trip.to)}. Listen to the announcements.`);
      } else if (e.reason === 'missed_stop') {
        state.trainFeedback = { ok: false, text: `We passed ${az(trip.to)}. Get off here` };
        speak('err:missed_stop', `The learner missed the stop ${en(trip.to)}. Calmly say it is okay and happens to everyone: get off at this station and take the train back one stop.`);
      } else if (e.reason === 'wrong_direction') {
        state.feedback = { ok: false, text: `${az(trip.to)} is the other way` };
        flash({ tone: 'warn', sub: 'Look at the stations listed on each sign' });
        speak('err:wrong_direction', `The learner chose the wrong direction. Gently say it is okay. Tell them to read the station list on the signs and find ${en(trip.to)}.`);
      }
      break;
    case 'choice':
      if (e.ok) {
        state.feedback = { ok: true, text: `Right way: towards ${az(trip.terminus)}` };
        flash({ tone: 'good', title: 'Right way!' }, 3000);
        speak('praise:direction', 'The learner chose the correct direction. Praise them warmly in one short sentence.');
        beep(990, 160);
      }
      break;
    case 'announcement':
      if (e.kind === 'delay') {
        const msg = { ok: false, text: `Train delayed: about ${e.minutes} min` };
        if (inTrain) state.trainFeedback = msg;
        else state.feedback = msg;
        announce(`Attention please. The train is delayed by about ${e.minutes} minutes.`);
        speak('fault:delay', `An announcement says the train is delayed by about ${e.minutes} minutes. Calmly explain that delays happen, that the learner can wait on the platform, and offer one slow breath together.`);
        // demo default: once the learner is waiting for the train (direction chosen) or sits in a
        // held train, the delay ends by itself after 12 s. The trainer can clear it earlier.
        const waiting = (engine.state.location === 'platform' && engine.state.direction) || engine.state.location === 'train';
        if (waiting) {
          setTimeout(() => engine.state.faults.train_delay && act({ type: 'fault_clear', fault: 'train_delay' }), 12_000);
        }
      }
      break;
    case 'fault_injected':
      log(`fault: ${e.fault}`);
      if (e.fault === 'crowd_noise') {
        startCrowd();
        speak('fault:crowd', 'The station suddenly became crowded and noisy. Calmly offer a short breathing exercise: breathe in for 4, out for 4. Then say they are doing well.');
      }
      break;
    case 'fault_resolved':
      if (e.fault === 'crowd_noise') stopCrowd();
      if (e.fault === 'train_delay') {
        if (inTrain) state.trainFeedback = { ok: true, text: 'The train is moving again' };
        else state.feedback = { ok: true, text: 'The train is arriving' };
      }
      break;
    case 'session_end':
      beep(1180, 220);
      speak('praise:arrived', `The learner arrived at ${en(trip.to)}. Congratulate them warmly in one sentence.`);
      break;
  }
}

function payAnimation(amount) {
  state.kiosk = 'paying';
  state.amount = amount;
  state.progress = 0;
  const t0 = performance.now();
  const tick = () => {
    state.progress = Math.min(1, (performance.now() - t0) / 1600);
    pushState();
    if (state.progress < 1) return requestAnimationFrame(tick);
    state.kiosk = 'done';
    act({ type: 'topup', amount });
    setTimeout(() => {
      state.kioskOpen = false;
      pushState();
    }, 2200);
  };
  requestAnimationFrame(tick);
}

gaze.onSelect = (obj) => {
  const id = obj.userData.id;
  beep(660);
  event('select', { target: id });
  if (id === 'kiosk' && engine.state.kiosk !== 'done') {
    state.kioskOpen = true;
    companion.context(`Learner opened the BakuKart top-up machine screen. Balance ${balance()} AZN. They should hold the card to the reader, then choose an amount (1 AZN is enough).`);
    syncView();
  } else if (id === 'kiosk:card' && engine.state.kiosk === 'idle') {
    act({ type: 'kiosk_tap_card' });
  } else if (id.startsWith('kiosk:amount:') && engine.state.kiosk === 'amount' && state.kiosk !== 'paying') {
    payAnimation(Number(id.split(':')[2]));
  } else if (id === 'gate' && engine.state.gate !== 'open') {
    act({ type: 'gate_tap' });
  } else if (id === 'go:platform' && engine.state.gate === 'open') {
    teleport(() => act({ type: 'walk', to: 'platform' }));
  } else if (id.startsWith('sign:') && engine.state.location === 'platform') {
    state.sign = id.slice(5);
    act({ type: 'choose_direction', side: state.sign });
  } else if (id === 'exit' && engine.state.location === 'train') {
    act({ type: 'exit' });
  }
};
gaze.onHoverChange = (obj) => {
  world.setHover(obj?.userData.id || null);
  event('hover', { target: obj?.userData.id || null });
};

// ---------- sounds ----------
let actx = null;
function beep(freq = 660, ms = 90) {
  if (!actx) return;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.08, actx.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + ms / 1000);
  o.connect(g).connect(actx.destination);
  o.start();
  o.stop(actx.currentTime + ms / 1000 + 0.02);
}

// Low noise (brown noise through a low-pass filter): crowd murmur, train rumble.
// Returns { stop() }; with `duration` it fades out by itself.
let brown = null;
function noise({ freq = 900, gain = 0.3, fadeIn = 1.5, duration = 0 } = {}) {
  if (!actx) return { stop() {} };
  if (!brown) {
    const len = actx.sampleRate * 2;
    brown = actx.createBuffer(1, len, actx.sampleRate);
    const d = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
  }
  const src = actx.createBufferSource();
  src.buffer = brown;
  src.loop = true;
  const lp = actx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.0001, actx.currentTime);
  g.gain.exponentialRampToValueAtTime(gain, actx.currentTime + fadeIn);
  src.connect(lp).connect(g).connect(actx.destination);
  src.start();
  let stopped = false;
  const stop = (fade = 1) => {
    if (stopped) return;
    stopped = true;
    g.gain.cancelScheduledValues(actx.currentTime);
    g.gain.setValueAtTime(Math.max(g.gain.value, 0.0001), actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + fade);
    src.stop(actx.currentTime + fade + 0.1);
  };
  if (duration) setTimeout(() => stop(0.8), duration * 1000);
  return { stop };
}
let crowd = null;
let rumble = null;
function startCrowd() {
  if (!crowd) crowd = noise({ freq: 900, gain: 0.35 });
}
function stopCrowd() {
  crowd?.stop();
  crowd = null;
}
// Door chime before the doors close.
function chime() {
  beep(784, 300);
  setTimeout(() => beep(622, 420), 320);
}
// Station announcements with the phone's own speech engine (works offline).
function announce(text) {
  try {
    if (!('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    u.rate = 0.95;
    u.volume = 0.9;
    speechSynthesis.speak(u);
  } catch {}
  log(`PA: ${text}`);
}

// ---------- start overlay ----------
let started = false;
function start(withBox) {
  vrMode = withBox;
  document.body.classList.toggle('vr', vrMode);
  resize();
  // everything below must be kicked off synchronously inside the tap (iOS rules)
  const gyroP = gyro.request().then(
    () => setStatus('gyro', 'ok'),
    (e) => setStatus('gyro', 'denied: ' + e.message),
  );
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    actx.resume();
  } catch {}
  voiceReady.then(() => voice.start(actx));
  if ($('#ai').checked) companion.start(actx);
  else {
    greeted = true;
    setTimeout(() => voice.play('greet'), 1200);
  }
  try {
    speechSynthesis.speak(new SpeechSynthesisUtterance('')); // unlock announcements on iOS
  } catch {}
  navigator.wakeLock?.request('screen').catch(() => {});
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').catch(() => {});
  });
  if (vrMode && document.documentElement.requestFullscreen) {
    document.documentElement
      .requestFullscreen({ navigationUI: 'hide' })
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }
  sessionId = 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  started = true;
  $('#start').hidden = true;
  event('device', { device: deviceName, mode: vrMode ? 'vr' : 'window' });
  resetFlow();
  gyroP.then(() => setTimeout(recenter, 400));
}
$('#go-vr').addEventListener('click', () => start(true));
$('#go-window').addEventListener('click', () => start(false));

// ---------- status / log ----------
const status = {};
function setStatus(k, v) {
  status[k] = v;
  $('#status').textContent = Object.entries(status)
    .map(([a, b]) => `${a}: ${b}`)
    .join('   ');
}
function log(t) {
  const d = document.createElement('div');
  d.textContent = t;
  logEl.prepend(d);
  while (logEl.childNodes.length > 6) logEl.lastChild.remove();
}
setStatus('server', 'connecting');

// ---------- main loop ----------
const timer = new THREE.Timer();
const camPos = new THREE.Vector3();
const camQuat = new THREE.Quaternion();
let poseT = 0;
let tickT = 0;
let buddyGaze = 0; // looking at the buddy for a moment counts as asking for help
let lastAsk = -1e9;
resetFlow();
// dev/test hook (used by the automated smoke test)
window.__app = {
  state,
  engine,
  world,
  gaze,
  start,
  act,
  RIDE, // timings, shortened by the automated test
  select: (id) => gaze.onSelect(world.interactives.find((o) => o.userData.id === id)),
  // point the (drag-look) camera at a panorama image coordinate
  lookAtU: (u, pitchDeg = 0) => {
    drag.lon = yawOfU(u) - rig.rotation.y;
    drag.lat = THREE.MathUtils.degToRad(pitchDeg);
  },
};
renderer.setAnimationLoop((ts) => {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.1);
  const t = timer.getElapsed();
  if (!gyro.apply(camera)) drag.apply(camera);
  pollGamepad();
  rig.updateMatrixWorld(true);
  camera.getWorldPosition(camPos);
  camera.getWorldQuaternion(camQuat);
  if (started && !teleporting) gaze.update(dt);
  const atBuddy = started && gaze.hover === world.buddy;
  companion.setGaze(atBuddy);
  buddyGaze = atBuddy ? buddyGaze + dt : 0;
  if (buddyGaze > 1.5 && performance.now() - lastAsk > 10_000) {
    lastAsk = performance.now();
    act({ type: 'ask_help' });
  }
  world.buddy.userData.level = Math.max(companion.outputLevel(), voice.level());
  if (voice.playing) world.buddy.userData.mode = 'speaking';
  else if (world.buddy.userData.mode === 'speaking' && companion.mode !== 'speaking') world.buddy.userData.mode = companion.mode;
  world.buddy.userData.mic = companion.micLevel();
  world.update(dt, t, camPos, camQuat);

  tickT += dt;
  if (started && tickT > 0.5) {
    tickT = 0;
    if (engine.dispatch({ type: 'tick', t: now() }).length) syncView();
  }

  poseT += dt;
  if (started && poseT > 0.05) {
    poseT = 0;
    net.send({
      type: 'pose',
      p: camPos.toArray().map((v) => +v.toFixed(3)),
      q: camQuat.toArray().map((v) => +v.toFixed(4)),
      hover: gaze.hover?.userData.id || null,
      dwell: +Math.max(0, gaze.t / gaze.dwell).toFixed(2),
    });
  }

  if (vrMode && started) stereo.render(world.scene, camera);
  else renderer.render(world.scene, camera);
});
