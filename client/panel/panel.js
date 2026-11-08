// Trainer panel + projector spectator view.
// The spectator renders the SAME shared scene locally, driven by the phone's head pose,
// so no video is streamed and it stays smooth on any laptop.
import * as THREE from 'three';
import { buildWorld, EYE } from '/shared/world.js';
import { loadFonts } from '/shared/ui3d.js';
import { loadTripData } from '/shared/data.js';
import { createTrip } from '/shared/engine.js';
import { Net } from '../vr/net.js';

const $ = (s) => document.querySelector(s);

// ---------- spectator ----------
const [, tripData] = await Promise.all([loadFonts(), loadTripData()]);
const canvas = $('#spectator');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 60);
camera.position.set(0, EYE, 0);
const world = buildWorld({ trip: createTrip(tripData) });
world.scene.add(camera);
world.applyState({ node: 'hall', balance: 0, kiosk: 'idle', task: {} });

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(1, r.height);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas.parentElement);
resize();

const targetPos = new THREE.Vector3(0, EYE, 0);
const targetQuat = new THREE.Quaternion();
let lastPose = 0;
let hoverInfo = null;

const timer = new THREE.Timer();
renderer.setAnimationLoop((ts) => {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.1);
  camera.position.lerp(targetPos, Math.min(1, dt * 12));
  camera.quaternion.slerp(targetQuat, Math.min(1, dt * 14));
  world.update(dt, timer.getElapsed(), camera.position, camera.quaternion);
  renderer.render(world.scene, camera);
  $('#waiting').hidden = performance.now() - lastPose < 3000;
  const ov = $('#hover');
  if (hoverInfo && hoverInfo.hover) {
    ov.style.display = 'block';
    ov.textContent = `Looking at: ${hoverInfo.hover}  ${hoverInfo.dwell > 0 ? Math.round(hoverInfo.dwell * 100) + '%' : ''}`;
  } else ov.style.display = 'none';
});

// ---------- network ----------
const net = new Net({
  role: 'panel',
  id: 'panel-' + Math.random().toString(36).slice(2, 6),
  device: 'panel',
  onMessage: (m) => {
    switch (m.type) {
      case 'pose':
        targetPos.fromArray(m.p);
        targetQuat.fromArray(m.q);
        hoverInfo = m;
        if (performance.now() - lastPose > 3000) {
          camera.position.copy(targetPos);
          camera.quaternion.copy(targetQuat);
        }
        lastPose = performance.now();
        break;
      case 'state':
        world.applyState(m.state);
        renderFaults(m.state.faults);
        break;
      case 'status':
        if (m.ai) $('#ai-mode').textContent = m.ai;
        break;
      case 'roster':
        renderRoster(m.clients);
        break;
      case 'transcript':
        addLine('#transcript', `<span class="who-${m.who}">${m.who === 'buddy' ? 'Buddy' : 'Learner'}:</span> ${esc(m.text)}`);
        break;
      case 'event':
        if (m.name === 'hover') break;
        addLine(
          '#events',
          `<span class="${m.name === 'error' || m.data?.ok === false || m.data?.lvl === 'error' ? 'ev-error' : ''}">${time()} ${esc(m.name)} ${esc(short(m.data))}</span>`,
        );
        break;
    }
  },
});

function renderRoster(clients) {
  const phones = clients.filter((c) => c.role === 'phone');
  $('#roster').innerHTML = phones.length
    ? phones.map((p) => `<span class="dev">📱 ${esc(p.device)} · ${esc(p.id)}</span>`).join('')
    : 'No phone connected';
}

document.querySelectorAll('[data-cmd]').forEach((b) =>
  b.addEventListener('click', () => net.send({ type: 'cmd', cmd: b.dataset.cmd, text: b.dataset.text })),
);

// Fault buttons: the first click injects the fault, a second click (while it is active) clears it.
let activeFaults = {};
document.querySelectorAll('[data-fault]').forEach((b) =>
  b.addEventListener('click', () => {
    const f = b.dataset.fault;
    net.send({ type: 'cmd', cmd: activeFaults[f] ? 'fault_clear' : 'fault', fault: f });
  }),
);
function renderFaults(faults = {}) {
  activeFaults = faults;
  document.querySelectorAll('[data-fault]').forEach((b) => b.setAttribute('aria-pressed', String(!!faults[b.dataset.fault])));
}

// ---------- helpers ----------
function addLine(sel, html) {
  const el = $(sel);
  const d = document.createElement('div');
  d.innerHTML = html;
  el.prepend(d);
  while (el.childNodes.length > 200) el.lastChild.remove();
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
function short(d) {
  if (!d || !Object.keys(d).length) return '';
  return JSON.stringify(d).slice(0, 120);
}
function time() {
  return new Date().toLocaleTimeString([], { hour12: false });
}

// ---------- connect info + QR ----------
// The public link (Cloudflare tunnel) works from any network without installing a certificate,
// so the QR code uses it as soon as it exists; until then it shows the Wi-Fi link.
let qrFor = null;
async function refreshInfo() {
  try {
    const info = await (await fetch('/api/info', { cache: 'no-store' })).json();
    const url = info.public?.vr || info.vr[0];
    $('#urls').innerHTML = [
      info.public ? `<b>Public (any network):</b> ${esc(info.public.vr)}` : 'Public link: starting… (Wi-Fi links below)',
      ...info.setup.map((u) => `Wi-Fi setup (once): ${esc(u)}`),
      ...info.vr.map((u) => `Wi-Fi VR: ${esc(u)}`),
      `AI keys: OpenAI ${info.ai.openai ? 'OK' : 'missing'} · Gemini ${info.ai.gemini ? 'OK' : 'missing'}`,
    ].join('<br>');
    if (url && url !== qrFor) {
      qrFor = url;
      $('#qr').src = '/api/qr?text=' + encodeURIComponent(url);
    }
    return !!info.public;
  } catch {
    return false;
  }
}
// keep checking: a free tunnel link can end and be replaced by a new one
refreshInfo();
setInterval(refreshInfo, 10_000);
