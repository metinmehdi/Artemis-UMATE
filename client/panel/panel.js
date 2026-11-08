// Trainer panel + projector spectator view.
// The spectator renders the SAME shared scene locally, driven by the phone's head pose,
// so no video is streamed and it stays smooth on any laptop.
import * as THREE from 'three';
import { buildWorld, EYE } from '/shared/world.js';
import { loadFonts } from '/shared/ui3d.js';
import { Net } from '../vr/net.js';

const $ = (s) => document.querySelector(s);

// ---------- spectator ----------
await loadFonts();
const canvas = $('#spectator');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 60);
camera.position.set(0, EYE, 0);
const world = buildWorld();
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
fetch('/api/info')
  .then((r) => r.json())
  .then((info) => {
    const url = info.vr[0];
    $('#urls').innerHTML = [
      ...info.setup.map((u) => `Setup (once): ${esc(u)}`),
      ...info.vr.map((u) => `VR: ${esc(u)}`),
      `AI keys: OpenAI ${info.ai.openai ? '✓' : '✗'} · Gemini ${info.ai.gemini ? '✓' : '✗'}`,
    ].join('<br>');
    if (url) $('#qr').src = '/api/qr?text=' + encodeURIComponent(url);
  })
  .catch(() => {});
