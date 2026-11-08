// Trainer panel + projector view.
// The live view renders the SAME shared scene locally, driven by the phone's head pose, so no video
// is streamed. The right column shows the trip as a metro line (one stop per step), the judge's
// challenge buttons, and tabs for the conversation, the learner's progress and the raw events.
import * as THREE from 'three';
import { buildWorld, EYE } from '/shared/world.js';
import { loadFonts } from '/shared/ui3d.js';
import { loadTripData } from '/shared/data.js';
import { createTrip } from '/shared/engine.js';
import { loadRuntime, makeNet, useKey, setKey, apiFetch, panelRoom } from '/shared/runtime.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const STEPS = ['topup', 'gate', 'platform', 'ride'];
const STEP_NAMES = { topup: 'Top up', gate: 'Turnstile', platform: 'Platform', ride: 'Ride' };

// ---------- live view ----------
const [, tripData, runtime] = await Promise.all([loadFonts(), loadTripData(), loadRuntime()]);
// Cloud (Vercel + Supabase): this panel owns a room code; the phone joins it through the QR code.
// The access key protects the API; it is asked once per computer (or given as ?k= in the link).
const CLOUD = runtime.mode === 'cloud';
// Asks for the access key in a dialog (not the browser prompt, which looks broken on a projector).
function askKey(rejected = false) {
  const dlg = $('#key-dialog');
  $('#key-error').hidden = !rejected;
  $('#key-input').value = '';
  return new Promise((resolve) => {
    const done = () => {
      dlg.removeEventListener('close', done);
      const k = dlg.returnValue === 'cancel' ? '' : $('#key-input').value.trim();
      resolve(k || null);
    };
    dlg.returnValue = '';
    dlg.addEventListener('close', done);
    dlg.showModal();
    $('#key-input').focus();
  });
}
$('#key-dialog').addEventListener('cancel', () => ($('#key-dialog').returnValue = 'cancel'));
if (CLOUD) {
  runtime.room = panelRoom();
  if (!runtime.key) {
    const k = await askKey();
    if (k) setKey((runtime.key = k));
  }
}
useKey(runtime.key);
const keep = (k, v) => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {}
  return null;
};
// API call that asks for the key again if the cloud refuses it
async function api(path, opts) {
  let r = await apiFetch(path, opts);
  if (r.status === 401 && CLOUD) {
    const k = await askKey(true);
    if (k) {
      setKey((runtime.key = k));
      useKey(runtime.key);
      refreshInfo();
      r = await apiFetch(path, opts);
    }
  }
  return r;
}
const trip = createTrip(tripData);
$('#trip-title').textContent = `${trip.from.name_az} to ${trip.to.name_az}`;
const canvas = $('#spectator');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 60);
camera.position.set(0, EYE, 0);
const world = buildWorld({ trip });
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
const HOVER_NAMES = { kiosk: 'the top-up machine', gate: 'the turnstile', 'go:platform': 'the way to the platform', 'sign:left': 'the left sign', 'sign:right': 'the right sign', exit: 'the doors', buddy: 'the buddy' };

const hoverText = $('#hover span');
const hoverBar = $('#hover .dwell i');
const timer = new THREE.Timer();
renderer.setAnimationLoop((ts) => {
  timer.update(ts);
  const dt = Math.min(timer.getDelta(), 0.1);
  camera.position.lerp(targetPos, Math.min(1, dt * 12));
  camera.quaternion.slerp(targetQuat, Math.min(1, dt * 14));
  world.update(dt, timer.getElapsed(), camera.position, camera.quaternion);
  renderer.render(world.scene, camera);
  $('#waiting').hidden = performance.now() - lastPose < 3000;
  // what the learner is looking at, with a bar that fills while the look selects it
  const ov = $('#hover');
  const live = hoverInfo?.hover && performance.now() - lastPose < 3000;
  ov.classList.toggle('idle', !live);
  if (live) {
    const name = HOVER_NAMES[hoverInfo.hover] || (hoverInfo.hover.startsWith('kiosk:') ? 'the machine screen' : hoverInfo.hover);
    hoverText.textContent = `Looking at ${name}`;
    hoverBar.style.width = `${Math.round((hoverInfo.dwell || 0) * 100)}%`;
  }
});

// ---------- the trip as a metro line ----------
let steps = {};
function resetSteps() {
  steps = Object.fromEntries(STEPS.map((k) => [k, { status: 'pending', ms: 0, hints: 0, errors: 0, startedAt: 0 }]));
  renderSteps();
}
function renderSteps() {
  for (const li of document.querySelectorAll('#steps li')) {
    const s = steps[li.dataset.step];
    li.className = s.status;
    const help = [s.hints ? `hint ${s.hints}` : '', s.errors ? `${s.errors} ${s.errors === 1 ? 'mistake' : 'mistakes'}` : ''].filter(Boolean).join(', ');
    let txt = '';
    if (s.status === 'done') txt = `${help || 'Done alone'}<br>${Math.round(s.ms / 1000)} s`;
    else if (s.status === 'current') txt = help ? `Now<br>${help}` : 'Now';
    li.querySelector('small').innerHTML = txt;
    li.setAttribute('aria-label', `${STEP_NAMES[li.dataset.step]}: ${s.status}${help ? ', ' + help : ''}`);
  }
}
resetSteps();

function onState(st) {
  world.applyState(st);
  renderFaults(st.faults);
  $('#short-ride').setAttribute('aria-pressed', String(!!st.shortRide));
  $('#balance').textContent = `${(st.balance ?? 0).toFixed(2)} AZN`;
  const idx = st.step ?? 0;
  const kicker = $('#now-step');
  kicker.textContent = idx >= STEPS.length ? 'Trip complete' : `Step ${idx + 1} of ${STEPS.length}: ${STEP_NAMES[STEPS[idx]]}`;
  kicker.classList.remove('off');
  STEPS.forEach((k, i) => {
    if (i < idx) steps[k].status = 'done';
    else if (i === idx) steps[k].status = 'current';
    else steps[k].status = 'pending';
  });
  renderSteps();
  const now = $('#now');
  const t = st.task || {};
  now.innerHTML = t.title ? `<b>${esc(t.title)}</b><span>${esc(t.sub || '')}</span>` : '';
  now.closest('.caption').classList.toggle('warn', t.tone === 'warn');
}

function onEvent(m) {
  const d = m.data || {};
  const cur = steps[STEPS[m.step]];
  switch (m.name) {
    case 'session_start':
      resetSteps();
      $('#events').innerHTML = '';
      break;
    case 'step_complete':
      if (steps[d.id]) Object.assign(steps[d.id], { status: 'done', ms: d.ms, hints: d.maxHintLevel, errors: d.errors });
      break;
    case 'hint_shown':
      if (cur) cur.hints = Math.max(cur.hints, d.level || 0);
      break;
    case 'error':
      if (cur) cur.errors += 1;
      break;
    case 'session_end':
      if ($('#progress-dialog').open) setTimeout(() => loadProgress(), 1500);
      break;
  }
  renderSteps();
  if (m.name !== 'hover') addEvent(m);
}

// ---------- network ----------
const net = await makeNet(runtime, {
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
        onState(m.state);
        break;
      case 'status':
        if (m.ai) setAi(m.ai);
        break;
      case 'roster':
        renderRoster(m.clients);
        break;
      case 'transcript':
        addTranscript(m.who, m.text);
        break;
      case 'event':
        onEvent(m);
        break;
      case 'learner':
        loadLearners();
        break;
    }
  },
});

function renderRoster(clients) {
  const phones = clients.filter((c) => c.role === 'phone');
  $('#phone-pill').classList.toggle('on', phones.length > 0);
  if (CLOUD && phones.length) announceLearner(); // a phone joined: tell it who is training
  $('#phone-text').textContent = phones.length ? `${phones[0].device} connected${phones.length > 1 ? ` (+${phones.length - 1})` : ''}` : 'No phone';
}
function setAi(mode) {
  const label = { offline: 'Buddy offline', connecting: 'Buddy connecting', idle: 'Buddy ready', listening: 'Buddy listening', speaking: 'Buddy speaking' }[mode] || `Buddy ${mode}`;
  $('#ai-text').textContent = label;
  $('#ai-pill').classList.toggle('on', mode === 'idle');
  $('#ai-pill').classList.toggle('talking', mode === 'listening' || mode === 'speaking');
}

document.querySelectorAll('[data-cmd]').forEach((b) =>
  b.addEventListener('click', () => net.send({ type: 'cmd', cmd: b.dataset.cmd, text: b.dataset.text, voice: b.dataset.voice })),
);
// Challenge buttons: the first click starts the challenge, a second click (while it is on) stops it.
let activeFaults = {};
document.querySelectorAll('[data-fault]').forEach((b) =>
  b.addEventListener('click', () => {
    const f = b.dataset.fault;
    net.send({ type: 'cmd', cmd: activeFaults[f] ? 'fault_clear' : 'fault', fault: f });
  }),
);
$('#short-ride').addEventListener('click', () => net.send({ type: 'cmd', cmd: 'pace', short: $('#short-ride').getAttribute('aria-pressed') !== 'true' }));
function renderFaults(faults = {}) {
  activeFaults = faults;
  document.querySelectorAll('[data-fault]').forEach((b) => b.setAttribute('aria-pressed', String(!!faults[b.dataset.fault])));
}

// ---------- lists ----------
function addTranscript(who, text) {
  const el = $('#transcript');
  el.querySelector('.empty')?.remove();
  const p = document.createElement('p');
  p.className = who === 'buddy' ? 'buddy' : 'learner-line';
  p.innerHTML = `<span class="who">${who === 'buddy' ? 'Buddy' : 'Learner'}:</span>${esc(text)}`;
  el.prepend(p);
  while (el.childNodes.length > 200) el.lastChild.remove();
}
const EVENT_TEXT = {
  session_start: () => 'Trip started',
  step_enter: (d) => `Step: ${STEP_NAMES[d.id] || d.id}`,
  step_complete: (d) => `${STEP_NAMES[d.id] || d.id} done in ${Math.round(d.ms / 1000)} s`,
  wallet: (d) => (d.tx === 'topup' ? `Topped up ${d.amount} AZN` : d.tx === 'fare' ? (d.ok ? `Paid ${d.amount} AZN` : 'Payment refused, balance unchanged') : 'Balance changed by the trainer'),
  error: (d) => `Mistake: ${String(d.reason).replace(/_/g, ' ')}`,
  hint_shown: (d) => `Hint ${d.level} (${d.trigger === 'ask' ? 'asked the buddy' : d.trigger === 'trainer' ? 'trainer' : 'waited'})`,
  help_asked: () => 'Asked the buddy for help',
  fault_injected: (d) => `Challenge started: ${String(d.fault).replace(/_/g, ' ')}`,
  fault_resolved: (d) => `Challenge over: ${String(d.fault).replace(/_/g, ' ')}`,
  arrive_station: (d) => `Train at ${trip.station(d.station).name_az}`,
  session_end: () => 'Arrived. Trip complete',
};
function addEvent(m) {
  const f = EVENT_TEXT[m.name];
  if (!f && ['select', 'ai_log', 'device', 'recenter', 'announcement', 'choice', 'boarded', 'return_trip'].includes(m.name)) return;
  const el = $('#events');
  const d = document.createElement('div');
  const bad = m.name === 'error' || m.data?.ok === false;
  if (bad) d.className = 'ev-error';
  d.innerHTML = `<time>${new Date().toLocaleTimeString([], { hour12: false })}</time>${bad ? '<svg class="i"><use href="#i-alert"/></svg>' : ''}<span>${esc(f ? f(m.data || {}) : m.name)}</span>`;
  el.prepend(d);
  while (el.childNodes.length > 300) el.lastChild.remove();
}

// ---------- tabs ----------
const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const t of tabs) {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  }
}
$('#progress-open').addEventListener('click', () => {
  $('#progress-dialog').showModal();
  loadProgress();
});
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    selectTab(next);
  });
});

// ---------- learners ----------
let currentLearner = null;
async function loadLearners() {
  const r = await (await api('/api/learners')).json();
  if (!r.learners) return;
  // laptop: the server knows who is training; cloud: this panel remembers it and tells the phone
  const saved = CLOUD ? r.learners.find((l) => l.id === keep('umate-learner')) : null;
  currentLearner = saved || r.current || r.learners[0] || null;
  $('#learner-select').innerHTML = r.learners
    .map((l) => `<option value="${esc(l.id)}"${l.id === currentLearner?.id ? ' selected' : ''}>${esc(l.nickname)}</option>`)
    .join('');
  if (CLOUD) announceLearner();
}
function announceLearner() {
  if (currentLearner) net.send({ type: 'learner', learner: { id: currentLearner.id, nickname: currentLearner.nickname } });
}
async function selectLearner(id) {
  if (CLOUD) keep('umate-learner', id);
  else await api('/api/learner', { method: 'POST', json: { id } });
  progressFor = id;
  await loadLearners();
}
$('#learner-select').addEventListener('change', (e) => selectLearner(e.target.value));
$('#learner-add').addEventListener('click', () => {
  const f = $('#learner-form');
  f.hidden = !f.hidden;
  $('#learner-add').setAttribute('aria-expanded', String(!f.hidden));
  if (!f.hidden) $('#learner-name').focus();
});
$('#learner-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nickname = $('#learner-name').value.trim();
  if (!nickname) return;
  const r = await (await api('/api/learners', { method: 'POST', json: { nickname } })).json();
  $('#learner-name').value = '';
  $('#learner-form').hidden = true;
  $('#learner-add').setAttribute('aria-expanded', 'false');
  if (r.learner) await selectLearner(r.learner.id);
});
loadLearners();

// ---------- progress chart ----------
let progressFor = null;
async function loadProgress() {
  const id = progressFor || currentLearner?.id || 'demo';
  const p = await (await api(`/api/progress?learner=${encodeURIComponent(id)}`)).json();
  if (!p.progress) return;
  const real = p.learners.filter((l) => !l.is_sample);
  const sample = p.learners.filter((l) => l.is_sample);
  if (!p.learners.some((l) => l.id === id)) real.unshift({ id, nickname: p.learner.nickname || currentLearner?.nickname || id, sessions: 0 });
  const opt = (l) => `<option value="${esc(l.id)}"${l.id === id ? ' selected' : ''}>${esc(l.nickname)} (${l.sessions} ${l.sessions === 1 ? 'session' : 'sessions'})</option>`;
  $('#progress-select').innerHTML = `<optgroup label="Learners">${real.map(opt).join('')}</optgroup><optgroup label="NÜMUNƏ: invented sample">${sample.map(opt).join('')}</optgroup>`;
  renderChart(p);
}
$('#progress-select').addEventListener('change', (e) => {
  progressFor = e.target.value;
  $('#report').textContent = '';
  loadProgress();
});

function renderChart({ learner, progress, cohort }) {
  const el = $('#chart');
  const rows = progress.sessions;
  const name = learner.nickname || learner.id;
  if (!rows.length) {
    el.innerHTML = `<p class="empty">${esc(name)} has no sessions yet. Start a trip on the phone, or pick a NÜMUNƏ learner to see how the chart looks.</p>`;
    $('#verdict').innerHTML = '';
    return;
  }
  const W = Math.max(320, el.clientWidth || 420);
  const H = 260;
  const m = { l: 34, r: 120, t: 12, b: 30 };
  const maxN = Math.max(rows.length, cohort.at(-1)?.n || 0, 4);
  const x = (n) => m.l + ((n - 1) / Math.max(1, maxN - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - v / 4) * (H - m.t - m.b);
  // colours come from the brand tokens: learner = ink, NÜMUNƏ = dashed sample purple, grid = hairline
  const C = { grid: 'var(--line)', axis: 'var(--ink-2)', learner: 'var(--ink)', sample: 'var(--sample)', ring: 'var(--paper)' };
  const grid = [0, 1, 2, 3, 4].map((v) => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" style="stroke:${C.grid}" stroke-width="1"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" style="fill:${C.axis}" font-size="14">${v}</text>`).join('');
  const xt = Array.from({ length: maxN }, (_, i) => i + 1)
    .filter((n) => maxN <= 10 || n % 2 === 1)
    .map((n) => `<text x="${x(n)}" y="${H - 8}" text-anchor="middle" style="fill:${C.axis}" font-size="14">${n}</text>`)
    .join('');
  const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const lp = rows.map((r) => [x(r.n), y(r.independent_steps)]);
  const cp = cohort.map((c) => [x(c.n), y(c.avg_independent_steps)]);
  const lastL = lp.at(-1);
  const lastC = cp.at(-1);
  // keep the two end labels apart
  let lyL = lastL[1] + 4;
  let lyC = lastC ? lastC[1] + 4 : 0;
  if (lastC && Math.abs(lyL - lyC) < 16) (lyL < lyC ? (lyC = lyL + 16) : (lyL = lyC + 16));
  el.innerHTML = `
    <div class="legend"><span><i class="key"></i>${esc(name)}</span>${cohort.length ? '<span><i class="key sample"></i>NÜMUNƏ average (invented sample)</span>' : ''}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Steps done alone per session for ${esc(name)}, from 0 to 4">
      ${grid}${xt}
      <text x="${W - m.r + 26}" y="${H - 8}" style="fill:${C.axis}" font-size="14">session</text>
      ${cp.length ? `<path d="${path(cp)}" fill="none" style="stroke:${C.sample}" stroke-width="2.5" stroke-dasharray="7 5" stroke-linecap="round"/>` : ''}
      <path d="${path(lp)}" fill="none" style="stroke:${C.learner}" stroke-width="2.5" stroke-linejoin="round"/>
      ${lp.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="5" style="fill:${C.learner};stroke:${C.ring}" stroke-width="2"/>`).join('')}
      <text x="${lastL[0] + 12}" y="${lyL}" style="fill:${C.learner}" font-size="15" font-weight="600">${esc(name.length > 12 ? name.slice(0, 11) + '…' : name)}</text>
      ${lastC ? `<text x="${lastC[0] + 12}" y="${lyC}" style="fill:${C.axis}" font-size="15">NÜMUNƏ avg</text>` : ''}
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="stroke:${C.axis}" stroke-width="1" visibility="hidden"/>
      ${Array.from({ length: maxN }, (_, i) => i + 1).map((n) => `<rect data-n="${n}" x="${x(n) - (W - m.l - m.r) / Math.max(1, maxN - 1) / 2}" y="${m.t}" width="${(W - m.l - m.r) / Math.max(1, maxN - 1)}" height="${H - m.t - m.b}" fill="transparent"/>`).join('')}
    </svg>
    <div class="tip" hidden></div>
    <details><summary>Show as a table</summary>
      <table><thead><tr><th>Session</th><th>Date</th><th>Steps alone</th><th>Hints</th><th>Mistakes</th><th>Minutes</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td>${r.n}</td><td>${r.date}</td><td>${r.independent_steps} of 4</td><td>${r.hints}</td><td>${r.errors}</td><td>${r.minutes}</td></tr>`).join('')}</tbody></table>
    </details>`;
  const svg = el.querySelector('svg');
  const tip = el.querySelector('.tip');
  const cross = el.querySelector('.cross');
  svg.querySelectorAll('rect[data-n]').forEach((rect) => {
    rect.addEventListener('pointerenter', () => {
      const n = +rect.dataset.n;
      const r = rows.find((q) => q.n === n);
      const c = cohort.find((q) => q.n === n);
      if (!r && !c) return;
      cross.setAttribute('x1', x(n));
      cross.setAttribute('x2', x(n));
      cross.setAttribute('visibility', 'visible');
      tip.hidden = false;
      tip.innerHTML = `Session ${n}${r ? `, ${r.date}<br>${esc(name)}: ${r.independent_steps} of 4 alone, ${r.hints} hints` : ''}${c ? `<br>NÜMUNƏ average: ${c.avg_independent_steps}` : ''}`;
      const scale = svg.getBoundingClientRect().width / W;
      tip.style.left = `${x(n) * scale}px`;
      tip.style.top = `${(r ? y(r.independent_steps) : m.t) * scale + 24}px`;
    });
  });
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
  });

  const v = [];
  v.push(
    progress.ready
      ? '<span class="badge good"><svg class="i"><use href="#i-check"/></svg>Readiness rule met: the trainer may plan a first real trip</span>'
      : '<span class="badge wait"><svg class="i"><use href="#i-clock"/></svg>Not ready yet: keep practising in VR</span>',
  );
  if (progress.focus_step) v.push(`<span class="badge"><svg class="i"><use href="#i-route"/></svg>Practise next: ${esc(STEP_NAMES[progress.focus_step])}</span>`);
  if (progress.is_sample) v.push('<span class="badge sample">NÜMUNƏ: invented sample data, not evidence</span>');
  $('#verdict').innerHTML = v.join('');
}

$('#report-btn').addEventListener('click', async () => {
  const btn = $('#report-btn');
  const out = $('#report');
  const label = btn.querySelector('span');
  btn.disabled = true;
  label.textContent = 'Writing the report…';
  try {
    const id = progressFor || currentLearner?.id;
    const r = await (await api('/api/report', { method: 'POST', json: { learner: id } })).json();
    out.innerHTML = `${esc(r.text)}<span class="by">${r.model ? `Written by Gemini (${esc(r.model)}) from the numbers above. The trainer decides.` : 'Template report: Gemini is not available right now.'}</span>`;
  } catch {
    out.textContent = 'The report could not be written. Check that the laptop server is running.';
  } finally {
    btn.disabled = false;
    label.textContent = 'Write trainer report';
  }
});

// ---------- connect info + QR ----------
// The public link works from any network without installing a certificate, so the QR code uses it
// as soon as it exists; until then it shows the Wi-Fi link. Checked every 10 s because a free
// tunnel link can end and be replaced.
let qrFor = null;
async function refreshInfo() {
  try {
    if (CLOUD) {
      const url = `${location.origin}/vr/?room=${runtime.room}&k=${encodeURIComponent(runtime.key)}`;
      $('#urls').innerHTML = [
        `<b>Room ${runtime.room}</b>: scan the QR code with the phone (any network).`,
        `Link: ${esc(url)}`,
        `AI keys: OpenAI ${runtime.ai?.openai ? 'ready' : 'missing'}, Gemini ${runtime.ai?.gemini ? 'ready' : 'missing'}`,
      ].join('<br>');
      if (url !== qrFor) {
        qrFor = url;
        showQr('/api/qr?text=' + encodeURIComponent(url));
      }
      return;
    }
    const info = await (await fetch('/api/info', { cache: 'no-store' })).json();
    const url = info.public?.vr || info.vr[0];
    $('#urls').innerHTML = [
      info.public ? `<b>Any network:</b> ${esc(info.public.vr)}` : 'Public link: starting. Wi-Fi links below.',
      ...info.vr.map((u) => `Same Wi-Fi: ${esc(u)}`),
      ...info.setup.map((u) => `Same Wi-Fi, certificate (once): ${esc(u)}`),
      `AI keys: OpenAI ${info.ai.openai ? 'ready' : 'missing'}, Gemini ${info.ai.gemini ? 'ready' : 'missing'}`,
    ].join('<br>');
    if (url && url !== qrFor) {
      qrFor = url;
      showQr('/api/qr?text=' + encodeURIComponent(url));
    }
  } catch {}
}
// the same code in the header, in the QR dialog and large on the stage while no phone is connected
function showQr(src) {
  for (const id of ['#qr', '#qr-big', '#qr-stage']) $(id).src = src;
}
refreshInfo();
setInterval(refreshInfo, 10_000);
$('#qr-open').addEventListener('click', () => $('#qr-dialog').showModal());
