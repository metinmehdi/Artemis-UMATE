// UMATE real-trip guide: the phone in the learner's hand in the real Baku Metro (no VR box).
// The trip comes from the same data and scenario as the VR practice (shared/engine.js), with
// real-trip micro-steps and photos of the place they practised in.
// Works offline for the step cards, "Remind me", breathing, calling and the staff card; "Ask Buddy"
// (OpenAI Realtime, guide mode) and "Show Buddy" (Gemini looks at a photo) need the internet.
// Events go to the trainer: /api/events (laptop or cloud), live on the panel when a room is known.
import { loadTripData } from '/shared/data.js';
import { createTrip, fill, textVars } from '/shared/engine.js';
import { loadRuntime, useKey, apiFetch, makeNet } from '/shared/runtime.js';
import { Companion } from '/shared/companion.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const store = {
  get(k, fallback = null) {
    try {
      const v = localStorage.getItem(k);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {}
  },
};

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/guide/sw.js', { scope: '/guide/' }).catch(() => {});

const [runtime, tripData] = await Promise.all([loadRuntime(), loadTripData()]);
useKey(runtime.key);
const CLOUD = runtime.mode === 'cloud';
const trip = createTrip(tripData);
const scen = tripData.scenario;
const vars = { ...textVars(trip, {}, 'az'), fare: tripData.rules.fare.toFixed(2) };
const T = (s) => fill(s, vars);
const STEP_COUNT = trip.steps.length;

// ---------- who is travelling ----------
const url = new URL(location.href);
const fromLink = url.searchParams.get('learner');
let learner = store.get('umate-guide-learner');
if (fromLink && fromLink !== learner?.id) learner = { id: fromLink, nickname: url.searchParams.get('name') || fromLink };
if (fromLink) {
  url.searchParams.delete('learner');
  url.searchParams.delete('name');
  history.replaceState(null, '', url.pathname + url.search);
}
async function loadLearners() {
  try {
    const r = await apiFetch('/api/learners');
    if (!r.ok) throw new Error(r.status);
    const { learners } = await r.json();
    const known = learner && learners.find((l) => l.id === learner.id);
    if (known) learner = { id: known.id, nickname: known.nickname }; // the trainer's nickname, not the id from the link
    else if (learner) learners.unshift(learner);
    learner ||= learners[0] || null;
    $('#learner-select').innerHTML = learners.map((l) => `<option value="${esc(l.id)}"${l.id === learner?.id ? ' selected' : ''}>${esc(l.nickname)}</option>`).join('');
    $('#learner-select').onchange = (e) => {
      const l = learners.find((x) => x.id === e.target.value);
      if (l) learner = { id: l.id, nickname: l.nickname };
      store.set('umate-guide-learner', learner);
    };
    store.set('umate-guide-learner', learner);
  } catch {
    // offline, or opened without the trainer's key: keep who we know, or travel without a name
    if (learner) $('#learner-select').innerHTML = `<option>${esc(learner.nickname)}</option>`;
    else $('#learner-field').hidden = true;
    if (CLOUD && !runtime.key) showNote('To share this trip with your trainer, open the guide from the QR code on the trainer panel.');
  }
}
function showNote(text) {
  $('#home-note').textContent = text;
  $('#home-note').hidden = false;
}

// ---------- trip log (to the trainer) ----------
let sessionId = null;
let queue = store.get('umate-guide-queue', []);
let net = null;
if (CLOUD && runtime.room) makeNet(runtime, { role: 'guide', id: 'guide-' + Math.random().toString(36).slice(2, 6), device: 'guide' }).then((n) => (net = n)).catch(() => {});
function log(name, data = {}) {
  if (!sessionId) return;
  const t = Date.now();
  const ev = { type: 'event', sessionId, name, mode: 'guide', step: stepIdx, t, learner, data: { t, ...data } };
  queue.push(ev);
  if (queue.length > 500) queue = queue.slice(-500);
  store.set('umate-guide-queue', queue);
  net?.send?.(ev); // live on the trainer panel (cloud room)
  flush();
}
let flushing = false;
async function flush() {
  if (flushing || !queue.length || !navigator.onLine || (CLOUD && !runtime.key)) return;
  flushing = true;
  const batch = queue.slice(0, 100);
  try {
    const r = await apiFetch('/api/events', { method: 'POST', json: { room: runtime.room || '', events: batch } });
    if (r.ok) {
      queue = queue.slice(batch.length);
      store.set('umate-guide-queue', queue);
    }
  } catch {}
  flushing = false;
  if (queue.length && navigator.onLine) setTimeout(flush, 1500);
}
setInterval(flush, 10_000);
addEventListener('online', () => {
  flush();
  renderNet();
});
addEventListener('offline', renderNet);
function renderNet() {
  const off = !navigator.onLine;
  $('#net').hidden = !off;
  for (const id of ['#btn-ask', '#btn-photo']) $(id).classList.toggle('needs-net', off);
}
renderNet();

// ---------- speaking ----------
let companion = null;
function speakLocal(lines, onLine) {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const voice = speechSynthesis.getVoices().find((v) => /^en(-|_)(GB|US)/i.test(v.lang)) || null;
  lines.forEach((text, i) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    if (voice) u.voice = voice;
    u.rate = 0.9;
    u.onstart = () => onLine?.(i);
    if (i === lines.length - 1) u.onend = () => onLine?.(-1);
    speechSynthesis.speak(u);
  });
}
function speak(text) {
  if (companion?.ready) companion.say(`Say exactly this to the learner, calmly: "${text}"`);
  else speakLocal([text]);
}

// ---------- screens ----------
let stepIdx = 0;
let stepStart = 0;
let rideIdx = trip.fromIdx;
let rideHistory = [];
const screens = ['home', 'trip', 'done'];
function show(id) {
  for (const s of screens) $('#' + s).hidden = s !== id;
  $('#bar').hidden = id === 'home';
  scrollTo(0, 0);
}

$('#home-route').textContent = `${trip.from.name_az} to ${trip.to.name_az}`;
$('#trip-route').textContent = `${trip.from.name_az} to ${trip.to.name_az}`;
$('#home-facts').textContent = `${trip.stops} stops on the ${trip.line.name_en || 'Red line'}. One ride costs ${vars.fare} AZN.`;

$('#start-trip').addEventListener('click', () => {
  sessionId = 'g-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  stepIdx = 0;
  rideIdx = trip.fromIdx;
  rideHistory = [];
  show('trip');
  renderStep();
  log('guide_start', { trip: trip.id, from: trip.from.id, to: trip.to.id });
});

function renderStep() {
  const step = trip.steps[stepIdx];
  const g = step.guide || {};
  stepStart = Date.now();
  $('#kicker').textContent = `Step ${stepIdx + 1} of ${STEP_COUNT}`;
  document.querySelectorAll('#dots li').forEach((li, i) => (li.className = i < stepIdx ? 'done' : i === stepIdx ? 'current' : ''));
  $('#step-photo').src = g.photo || '';
  $('#step-photo').alt = T(step.title);
  $('#step-title').textContent = T(step.title);
  $('#how').innerHTML = (g.how || []).map((h) => `<li>${esc(T(h))}</li>`).join('');
  const isRide = step.id === 'ride';
  $('#ride').hidden = !isRide;
  $('#step-figure').hidden = isRide; // on the train the station line matters, not the photo
  if (isRide) renderRide();
  else {
    $('#next-btn').textContent = 'I did it';
    $('#undo-btn').hidden = true;
  }
  companion?.context(stepContext());
}
function stepContext() {
  const step = trip.steps[stepIdx];
  const parts = [`Real trip ${trip.from.name_en} to ${trip.to.name_en}. Step ${stepIdx + 1} of ${STEP_COUNT}: ${T(step.title)}.`, `What to do: ${(step.guide?.how || []).map(T).join(' ')}`];
  if (step.id === 'ride') {
    const here = trip.station(trip.line.stations[rideIdx]);
    parts.push(`The train is at or leaving ${here.name_en}. ${Math.abs(trip.toIdx - rideIdx)} stops left to ${trip.to.name_en}.`);
  }
  return parts.join(' ');
}

function renderRide() {
  const ids = [];
  for (let i = trip.fromIdx; trip.dir > 0 ? i <= trip.toIdx : i >= trip.toIdx; i += trip.dir) ids.push(i);
  $('#stations').innerHTML = ids
    .map((i) => {
      const s = trip.station(trip.line.stations[i]);
      const cls = (i - rideIdx) * trip.dir < 0 ? 'passed' : i === rideIdx ? 'here' : '';
      const tag = i === trip.toIdx ? '<span class="tag">Your stop</span>' : i === rideIdx ? '<span class="tag">Now</span>' : '';
      return `<li class="${cls}"><span class="st-dot"></span><span>${esc(s.name_az)}</span>${tag}</li>`;
    })
    .join('');
  const left = Math.abs(trip.toIdx - rideIdx);
  const banner = $('#ride-banner');
  banner.hidden = left > 1;
  banner.textContent = left === 1 ? `Next stop is ${trip.to.name_az}. Get ready to get off.` : left === 0 ? `This is ${trip.to.name_az}. Get off now.` : '';
  $('#next-btn').textContent = left === 0 ? 'I got off' : 'The train stopped';
  $('#undo-btn').hidden = rideHistory.length === 0;
}

$('#next-btn').addEventListener('click', () => {
  const step = trip.steps[stepIdx];
  if (step.id === 'ride' && rideIdx !== trip.toIdx) {
    rideHistory.push(rideIdx);
    rideIdx += trip.dir;
    const st = trip.station(trip.line.stations[rideIdx]);
    log('guide_stop', { station: st.id });
    renderRide();
    const left = Math.abs(trip.toIdx - rideIdx);
    if (left === 1) speak(`Next stop is ${trip.to.name_en}. Get ready to get off.`);
    else if (left === 0) speak(`This is ${trip.to.name_en}. Get off now.`);
    companion?.context(stepContext());
    return;
  }
  log('guide_step', { id: step.id, ms: Date.now() - stepStart });
  if (stepIdx + 1 < STEP_COUNT) {
    stepIdx += 1;
    renderStep();
  } else finish();
});
$('#undo-btn').addEventListener('click', () => {
  if (!rideHistory.length) return;
  rideIdx = rideHistory.pop();
  renderRide();
});

function finish() {
  show('done');
  $('#done-title').textContent = `You arrived at ${trip.to.name_az}!`;
  $('#self-choice').hidden = false;
  $('#self-q').hidden = false;
  $('#thanks').hidden = true;
  speak(`You arrived at ${trip.to.name_en}. Well done!`);
}
document.querySelectorAll('[data-self]').forEach((b) =>
  b.addEventListener('click', () => {
    log('guide_end', { completed: true, self_report: b.dataset.self });
    $('#self-choice').hidden = true;
    $('#self-q').hidden = true;
    $('#thanks').hidden = false;
  }),
);
$('#again').addEventListener('click', () => {
  // arrived but did not answer the question: the trip still counts as completed
  if (sessionId && $('#thanks').hidden) log('guide_end', { completed: true, self_report: null });
  sessionId = null;
  show('home');
});

// ---------- help: remind ----------
$('#btn-remind').addEventListener('click', () => {
  const items = [...document.querySelectorAll('#how li')];
  const lines = [T(trip.steps[stepIdx].title) + '.', ...items.map((li) => li.textContent)];
  log('guide_help', { kind: 'remind', step: trip.steps[stepIdx].id });
  const mark = (i) => items.forEach((li, k) => li.classList.toggle('speaking', k === i - 1));
  if (companion?.ready) {
    companion.say(`Remind the learner of these steps, slowly, one short sentence each: ${lines.join(' ')}`);
    items.forEach((li) => li.classList.add('speaking'));
    setTimeout(() => items.forEach((li) => li.classList.remove('speaking')), 9000);
  } else speakLocal(lines, mark);
});

// ---------- help: ask Buddy (voice) ----------
let talkTimer = 0;
let actx = null;
function addTalk(who, text) {
  const p = document.createElement('p');
  p.className = who === 'buddy' ? 'buddy' : '';
  p.textContent = text;
  $('#talk-log').append(p);
  $('#talk-log').scrollTop = 1e6;
}
const MODE_TEXT = { offline: 'Buddy is offline. Try Remind me, or Help.', connecting: 'Connecting to Buddy…', idle: 'Speak now. Buddy is listening.', listening: 'Speak now. Buddy is listening.', speaking: 'Buddy is talking…' };
$('#btn-ask').addEventListener('click', () => {
  if (!navigator.onLine) return speakLocal(['Buddy needs the internet. Tap Remind me, or Help.']);
  if (CLOUD && !runtime.key) return speakLocal(['Open the guide from the trainer QR code to talk with Buddy.']);
  log('guide_help', { kind: 'voice', step: trip.steps[stepIdx]?.id });
  $('#talk-sheet').showModal();
  if (!companion) {
    // must start inside the tap: microphone permission and audio unlock
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {}
    companion = new Companion({
      mode: 'guide',
      greeting: 'Say hello in one short sentence and ask what they need help with.',
      onMode: (m) => {
        $('#talk-status').textContent = MODE_TEXT[m] || '';
        $('#orb').className = 'orb' + (m === 'speaking' ? ' speaking' : m === 'listening' || m === 'idle' ? ' listening' : '');
      },
      onTranscript: (who, text) => {
        addTalk(who, text);
        if (sessionId) log('guide_talk', { who, text: text.slice(0, 300) });
      },
    });
    companion.start(actx).then(() => companion.context(stepContext()));
  } else companion.context(stepContext());
  clearInterval(talkTimer);
  talkTimer = setInterval(() => companion.listen(true), 200);
});
function stopTalk() {
  clearInterval(talkTimer);
  companion?.listen(false);
  if ($('#talk-sheet').open) $('#talk-sheet').close();
}
$('#talk-stop').addEventListener('click', stopTalk);
$('#talk-sheet').addEventListener('cancel', stopTalk);

// ---------- help: show Buddy a photo ----------
$('#btn-photo').addEventListener('click', () => {
  if (!navigator.onLine) return speakLocal(['Buddy needs the internet to see a photo. Tap Remind me, or ask a metro worker.']);
  $('#photo-input').click();
});
$('#photo-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const step = trip.steps[stepIdx];
  log('guide_help', { kind: 'photo', step: step?.id });
  $('#photo-answer').textContent = 'Looking at the photo…';
  $('#photo-sheet').showModal();
  try {
    const { dataUrl, base64 } = await shrink(file, 768);
    $('#photo-preview').src = dataUrl;
    const r = await apiFetch('/api/ask-photo', {
      method: 'POST',
      json: { image: base64, step: { id: step?.id, title: step ? T(step.title) : '' }, trip: { from: trip.from.name_az, to: trip.to.name_az, towards: trip.terminus.name_az } },
    });
    const j = await r.json();
    const text = j.text || 'Buddy could not see the photo. Tap Remind me, or ask a metro worker.';
    $('#photo-answer').textContent = text;
    speak(text);
    companion?.context(`The learner showed Buddy a photo. The answer they got: ${text}`);
  } catch {
    $('#photo-answer').textContent = 'Buddy could not see the photo. Tap Remind me, or ask a metro worker.';
  }
});
// downscale on the phone: about 100 KB instead of several MB
function shrink(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.75);
      URL.revokeObjectURL(img.src);
      resolve({ dataUrl, base64: dataUrl.split(',')[1] });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ---------- help sheet: breathe, call, staff card ----------
$('#btn-help').addEventListener('click', () => {
  renderCall();
  $('#help-sheet').showModal();
});
let breathTimer = 0;
$('#help-breathe').addEventListener('click', () => {
  $('#help-sheet').close();
  log('guide_help', { kind: 'calm', step: trip.steps[stepIdx]?.id });
  $('#breathe').showModal();
  let inhale = true;
  const tick = () => {
    $('#breathe-word').textContent = inhale ? 'Breathe in' : 'Breathe out';
    $('.breath span').style.setProperty('--s', inhale ? '1.6' : '1');
    inhale = !inhale;
  };
  tick();
  breathTimer = setInterval(tick, 4000);
  if (companion?.ready) companion.say('The learner feels stressed. Very calmly guide one slow breath together, then tell them they are doing well.');
  else speakLocal(['Let us breathe together. Breathe in slowly. And breathe out. You are doing well.']);
});
$('#breathe').addEventListener('close', () => clearInterval(breathTimer));

function person() {
  return store.get('umate-guide-person', { name: '', phone: '' });
}
function renderCall() {
  const p = person();
  const a = $('#help-call');
  if (p.phone) {
    a.href = `tel:${p.phone.replace(/[^\d+]/g, '')}`;
    $('#call-label').textContent = `Call ${p.name || 'my person'}`;
    $('#call-sub').textContent = p.phone;
  } else {
    a.href = '#';
    $('#call-label').textContent = 'Call my person';
    $('#call-sub').textContent = 'Add a phone number in Settings';
  }
}
$('#help-call').addEventListener('click', (e) => {
  log('guide_help', { kind: 'call', step: trip.steps[stepIdx]?.id });
  if (!person().phone) {
    e.preventDefault();
    $('#help-sheet').close();
    openSettings();
  }
});
$('#help-staff').addEventListener('click', () => {
  $('#help-sheet').close();
  log('guide_help', { kind: 'staff', step: trip.steps[stepIdx]?.id });
  $('#staff-az').textContent = T(scen.staff_card?.az || '');
  $('#staff-en').textContent = T(scen.staff_card?.en || '');
  $('#staff').showModal();
});

// ---------- settings ----------
function openSettings() {
  const p = person();
  $('#person-name').value = p.name;
  $('#person-phone').value = p.phone;
  $('#settings').showModal();
}
$('#open-settings').addEventListener('click', openSettings);
$('#settings-form').addEventListener('submit', () => {
  store.set('umate-guide-person', { name: $('#person-name').value.trim(), phone: $('#person-phone').value.trim() });
  renderCall();
});

// tapping the dimmed area closes a sheet
for (const d of document.querySelectorAll('dialog.sheet')) d.addEventListener('click', (e) => e.target === d && (d.id === 'talk-sheet' ? stopTalk() : d.close()));

loadLearners();
show('home');
flush();
window.__guide = { trip, get state() { return { stepIdx, rideIdx, sessionId, queue: queue.length }; } };
