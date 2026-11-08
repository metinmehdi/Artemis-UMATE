// Phone VR app: photoreal Baku Metro panoramas + gaze input + AI buddy + live link to the panel.
// The trip logic below is a temporary hand-written flow; Phase 1 moves it into the scenario engine.
import * as THREE from 'three';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
import { buildWorld, EYE, yawOfU } from '/shared/world.js';
import { loadFonts } from '/shared/ui3d.js';
import { Gyro, DragLook } from './gyro.js';
import { Gaze } from './gaze.js';
import { Net } from './net.js';
import { Companion } from './companion.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#c');
const fadeEl = $('#fade');
const logEl = $('#log');

await loadFonts();

// ---------- renderer / camera / rig ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 60);
camera.position.y = EYE;
const rig = new THREE.Group();
rig.add(camera);

const world = buildWorld();
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
    if (m.cmd === 'say' && m.text) companion.say(m.text);
    if (m.cmd === 'reset') resetFlow();
    if (m.cmd === 'reload') location.reload();
  },
});

function event(name, data = {}) {
  net.send({ type: 'event', sessionId, name, step: state.step, node: state.node, data });
}

// ---------- AI buddy ----------
const companion = new Companion({
  onMode: (m) => {
    state.buddyMode = m;
    pushState();
    setStatus('ai', m);
    net.send({ type: 'status', ai: m });
  },
  onTranscript: (who, text) => {
    net.send({ type: 'transcript', sessionId, who, text, step: state.step });
    log(`${who}: ${text}`);
  },
  onLog: (lvl, text) => {
    log(text);
    net.send({ type: 'event', sessionId, name: 'ai_log', data: { lvl, text } });
  },
});

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
function teleport(nodeId) {
  if (teleporting) return;
  teleporting = true;
  fadeEl.classList.add('on');
  setTimeout(() => {
    state.node = nodeId;
    faceYaw(world.forwardYaw(nodeId));
    onArrive(nodeId);
    fadeEl.classList.remove('on');
    teleporting = false;
  }, 260);
}

// ---------- TEMP trip flow (moves into the scenario engine in Phase 1) ----------
const FARE = 0.6; // ASSUMPTION: to be verified and moved to data/city/baku/rules.json
const TASKS = [
  { title: 'Top up your BakıKart', sub: 'Look at the top-up machine on your left' },
  { title: 'Tap your card at the turnstile', sub: 'Look at the turnstile in front of you' },
  { title: 'Find the train to 28 May', sub: 'Your trip: Koroğlu → 28 May' },
  { title: 'Well done!', sub: 'Next: ride the train (coming soon)' },
];
const state = {};
function setTask(step, extra = {}) {
  state.step = step;
  state.task = { step, total: 4, ...TASKS[Math.min(step, 3)], ...extra };
}
function resetFlow() {
  Object.assign(state, {
    node: 'hall',
    balance: 0,
    kiosk: 'idle',
    kioskOpen: false,
    amount: null,
    progress: 0,
    gate: null,
    targets: [],
    sign: null,
    feedback: null,
    buddyMode: companion.mode,
  });
  setTask(0);
  faceYaw(world.forwardYaw('hall'));
  pushState();
}
function pushState() {
  world.applyState(state);
  net.send({ type: 'state', state });
}
function onArrive(nodeId) {
  event('arrive', { node: nodeId });
  if (nodeId === 'platform') {
    setTask(2);
    companion.context(
      'Learner is on the Koroglu platform (Red line). Trip: Koroglu to 28 May, 4 stops. 28 May is towards Icherisheher: the LEFT sign. The right sign goes towards Hazi Aslanov (wrong way). Task: choose the correct direction sign.',
    );
  }
  pushState();
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
    const before = state.balance;
    state.balance = +(state.balance + amount).toFixed(2);
    state.kiosk = 'done';
    event('wallet', { tx: 'topup', amount, balanceBefore: before, balanceAfter: state.balance, ok: true });
    setTask(1);
    companion.context(`Top-up done. Balance now ${state.balance.toFixed(2)} AZN. Next task: tap the card at the turnstile straight ahead.`);
    beep(880, 120);
    pushState();
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
  if (id === 'kiosk' && state.kiosk !== 'done') {
    state.kioskOpen = true;
    companion.context('Learner opened the BakuKart top-up machine screen. Balance 0 AZN. They should hold the card to the reader, then choose an amount (1 AZN is enough).');
  } else if (id === 'kiosk:card' && state.kiosk === 'idle') {
    state.kiosk = 'amount';
  } else if (id.startsWith('kiosk:amount:') && state.kiosk === 'amount') {
    return payAnimation(Number(id.split(':')[2]));
  } else if (id === 'gate' && state.gate !== 'ok') {
    if (state.balance >= FARE) {
      const before = state.balance;
      state.balance = +(state.balance - FARE).toFixed(2);
      event('wallet', { tx: 'fare', amount: FARE, balanceBefore: before, balanceAfter: state.balance, ok: true });
      Object.assign(state, { gate: 'ok', targets: ['platform'] });
      setTask(1, { title: 'Walk through the turnstile', sub: 'Look at the circle on the floor ahead' });
      beep(990, 160);
    } else {
      event('wallet', { tx: 'fare', amount: FARE, balanceBefore: state.balance, balanceAfter: state.balance, ok: false });
      event('error', { reason: 'insufficient_balance' });
      state.gate = 'bad';
      setTask(state.step, { tone: 'warn', title: 'Not enough balance', sub: 'Top up your card at the machine first' });
      companion.say('The turnstile rejected the card: not enough balance. Calmly say this is okay and that they can top up at the machine on the left.');
      beep(220, 260);
      setTimeout(() => {
        if (state.gate === 'bad') {
          state.gate = null;
          setTask(state.step);
          pushState();
        }
      }, 3500);
    }
  } else if (id === 'go:platform') {
    state.targets = [];
    return teleport('platform');
  } else if (id.startsWith('sign:') && state.node === 'platform' && state.step < 3) {
    const ok = id === 'sign:left';
    state.sign = id.slice(5);
    event(ok ? 'choice_correct' : 'error', { choice: id });
    if (ok) {
      state.feedback = { ok: true, text: 'Right way: towards İçərişəhər' };
      setTask(3, { tone: 'good' });
      companion.say('The learner chose the correct direction. Praise them warmly in one short sentence.');
      beep(990, 160);
    } else {
      state.feedback = { ok: false, text: '28 May is the other way' };
      setTask(2, { tone: 'warn', sub: 'Look at the stations listed on each sign' });
      companion.say('The learner chose the wrong direction. Gently say it is okay. Tell them to read the station list on the signs and find 28 May.');
      beep(220, 260);
    }
  }
  pushState();
};
gaze.onHoverChange = (obj) => {
  world.setHover(obj?.userData.id || null);
  net.send({ type: 'event', sessionId, name: 'hover', data: { target: obj?.userData.id || null } });
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
  if ($('#ai').checked) companion.start(actx);
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
  net.send({ type: 'event', sessionId, name: 'session_start', data: { device: deviceName, mode: vrMode ? 'vr' : 'window' } });
  started = true;
  $('#start').hidden = true;
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
resetFlow();
// dev/test hook (used by the automated smoke test)
window.__app = {
  state,
  world,
  gaze,
  teleport,
  start,
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
  companion.setGaze(started && gaze.hover === world.buddy);
  world.buddy.userData.level = companion.outputLevel();
  world.buddy.userData.mic = companion.micLevel();
  world.update(dt, t, camPos, camQuat);

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
