// Phone VR app (Phase 0 spike): stereo view + gyro + gaze select + teleport + AI buddy + link to panel.
// The mini flow at the bottom is temporary; Phase 1 replaces it with the scenario engine.
import * as THREE from 'three';
import { StereoEffect } from 'three/addons/effects/StereoEffect.js';
import { buildStation } from '/shared/scene.js';
import { Gyro, DragLook } from './gyro.js';
import { Gaze } from './gaze.js';
import { Net } from './net.js';
import { Companion } from './companion.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#c');
const fadeEl = $('#fade');
const logEl = $('#log');

// ---------- renderer / camera / rig ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
const camera = new THREE.PerspectiveCamera(80, innerWidth / innerHeight, 0.05, 60);
camera.position.y = 1.55; // eye height
const rig = new THREE.Group();
rig.add(camera);

const world = buildStation();
world.scene.add(rig);

const stereo = new StereoEffect(renderer);
stereo.setEyeSeparation(0.064);

let vrMode = true;
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  stereo.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = vrMode ? 85 : 70;
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

// tap on screen (also the VR box's capacitive button), keyboard / BT remote keys, gamepad buttons
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
    if (m.cmd === 'style') {
      state.style = state.style === 'ai' ? 'lowpoly' : 'ai';
      event('style', { style: state.style });
      pushState();
    }
    if (m.cmd === 'reload') location.reload();
  },
});

function event(name, data = {}) {
  net.send({ type: 'event', sessionId, name, step: state.node, data });
}

// ---------- AI buddy ----------
const companion = new Companion({
  onMode: (m) => {
    state.buddyMode = m;
    world.applyState(state);
    setStatus('ai', m);
    net.send({ type: 'status', ai: m });
  },
  onTranscript: (who, text) => {
    net.send({ type: 'transcript', sessionId, who, text, step: state.node });
    log(`${who}: ${text}`);
  },
  onLog: (lvl, text) => {
    log(text);
    net.send({ type: 'event', sessionId, name: 'ai_log', data: { lvl, text } });
  },
});

// ---------- teleport / recenter ----------
const tmpE = new THREE.Euler();
function faceYaw(targetYaw) {
  tmpE.setFromQuaternion(camera.quaternion, 'YXZ');
  rig.rotation.y = targetYaw - tmpE.y;
}
function recenter() {
  faceYaw(world.nodes[state.node].yaw);
  event('recenter');
}
let teleporting = false;
function teleport(nodeId) {
  if (teleporting) return;
  teleporting = true;
  fadeEl.classList.add('on');
  setTimeout(() => {
    const n = world.nodes[nodeId];
    rig.position.set(n.pos.x, 0, n.pos.z);
    faceYaw(n.yaw);
    state.node = nodeId;
    onArrive(nodeId);
    fadeEl.classList.remove('on');
    teleporting = false;
  }, 280);
}

// ---------- TEMP mini flow (replaced by the scenario engine in Phase 1) ----------
const FARE = 0.6;
const state = {};
function resetFlow() {
  Object.assign(state, {
    node: 'entrance',
    balance: 0,
    gateOpen: false,
    readerText: 'Tap card',
    readerBg: '#203040',
    footprints: ['terminal'],
    feedback: null,
    buddyMode: companion.mode,
    style: state.style || 'lowpoly',
  });
  const n = world.nodes.entrance;
  rig.position.set(n.pos.x, 0, n.pos.z);
  faceYaw(n.yaw);
  pushState();
}
function pushState() {
  world.applyState(state);
  net.send({ type: 'state', state });
}
function onArrive(nodeId) {
  event('arrive', { node: nodeId });
  const ctx = {
    terminal: 'Learner is at the BakuKart top-up machine. Balance 0 AZN. Task: top up the card.',
    gate: `Learner is at the turnstiles. Balance ${state.balance.toFixed(2)} AZN, fare ${FARE} AZN. Task: tap the card on the reader.`,
    platform: 'Learner is on the platform. Trip: Koroglu to 28 May. 28 May is in the direction of Icherisheher (left sign). Task: choose the correct direction sign.',
  }[nodeId];
  if (ctx) companion.context(ctx);
  pushState();
}

gaze.onSelect = (obj) => {
  const id = obj.userData.id;
  beep(660);
  event('select', { target: id });
  if (id.startsWith('go:')) {
    state.footprints = [];
    state.feedback = null;
    return teleport(id.slice(3));
  }
  if (id === 'topup' && state.node === 'terminal') {
    const before = state.balance;
    state.balance = +(state.balance + 1).toFixed(2);
    event('wallet', { tx: 'topup', amount: 1, balanceBefore: before, balanceAfter: state.balance, ok: true });
    state.footprints = ['gate'];
    companion.context(`Top-up done. Balance now ${state.balance.toFixed(2)} AZN.`);
  }
  if (id === 'reader' && state.node === 'gate') {
    if (state.balance >= FARE) {
      const before = state.balance;
      state.balance = +(state.balance - FARE).toFixed(2);
      event('wallet', { tx: 'fare', amount: FARE, balanceBefore: before, balanceAfter: state.balance, ok: true });
      Object.assign(state, { gateOpen: true, readerText: 'OK ✓', readerBg: '#1f9d55', footprints: ['platform'] });
    } else {
      event('wallet', { tx: 'fare', amount: FARE, balanceBefore: state.balance, balanceAfter: state.balance, ok: false });
      Object.assign(state, { readerText: 'Not enough\nbalance', readerBg: '#b3261e' });
      companion.say('The card was rejected: not enough balance. Calmly tell the learner this is OK and they can go back to the top-up machine.');
    }
  }
  if (id.startsWith('sign:') && state.node === 'platform') {
    const ok = id === 'sign:left';
    event(ok ? 'choice_correct' : 'error', { choice: id });
    state.feedback = ok
      ? { ok: true, text: 'Correct! Trains to Icherisheher\nstop at 28 May' }
      : { ok: false, text: 'Not this way.\n28 May is towards Icherisheher' };
    companion.say(
      ok
        ? 'The learner chose the correct direction. Praise them in one short sentence.'
        : 'The learner chose the wrong direction. Gently say it is okay and that 28 May is towards Icherisheher, the left sign.',
    );
  }
  pushState();
};

gaze.onHoverChange = (obj) => net.send({ type: 'event', sessionId, name: 'hover', data: { target: obj?.userData.id || null } });

// ---------- sounds ----------
let actx = null;
function beep(freq = 660, ms = 90) {
  if (!actx) return;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.frequency.value = freq;
  g.gain.value = 0.08;
  o.connect(g).connect(actx.destination);
  o.start();
  o.stop(actx.currentTime + ms / 1000);
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
  if ($('#ai').checked) companion.start();
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    actx.resume();
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
window.__app = { state, world, gaze, teleport, select: (id) => gaze.onSelect(world.interactives.find((o) => o.userData.id === id)), start };
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
