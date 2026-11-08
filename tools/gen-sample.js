// SAMPLE ("NÜMUNƏ") cohort: invented session logs in exactly the same format as the real ones, so the
// same gold transform and the same panel chart run on them. Use it to show how the progress view will
// look with many sessions. It is NOT evidence that the method works: every learner is called
// "NÜMUNƏ ..." and every line carries "sample": true.
//
//   npm run data:sample            -> data/sample/sessions.jsonl (git-ignored, deterministic)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'sample', 'sessions.jsonl');

// small deterministic PRNG (mulberry32), so every run gives the same sample
function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSample({ learners = 10, seed = 2026, start = Date.UTC(2026, 8, 14, 9, 0) } = {}) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const STEPS = ['topup', 'gate', 'platform', 'ride'];
  // how hard each step is at the beginning (hint levels); the platform direction is the hardest
  const BASE = { topup: 1.6, gate: 1.0, platform: 2.4, ride: 1.8 };
  const FAULTS = ['insufficient_balance', 'card_unreadable', 'train_delay', 'crowd_noise'];
  const lines = [];

  for (let li = 0; li < learners; li++) {
    const learner = { id: `sample-${String(li + 1).padStart(2, '0')}`, nickname: `NÜMUNƏ ${String(li + 1).padStart(2, '0')}` };
    const ability = (r() - 0.35) * 2.2; // < 0 learns faster
    const speed = 0.1 + r() * 0.3; // how fast hints drop per session
    const nSessions = 4 + Math.floor(r() * 7);
    for (let k = 0; k < nSessions; k++) {
      const day = Math.floor(k * 3.5 + r() * 2); // about two sessions a week
      const t0 = start + day * 86400000 + Math.floor(r() * 6) * 3600000 + li * 600000;
      const sessionId = `sample-${learner.id.slice(7)}-${String(k + 1).padStart(2, '0')}`;
      let et = 0; // engine time (ms since the trip started)
      let step = 0;
      const push = (name, data = {}) =>
        lines.push({ t: t0 + et, sessionId, type: 'event', name, step, node: step < 2 ? 'hall' : step === 2 ? 'platform' : 'train', data: { type: name, t: et, step, ...data }, learner, sample: true });
      push('device', { device: pick(['Android', 'iPhone']), mode: 'vr' });
      push('session_start', { trip: 'baku-red-koroglu-28may', from: 'koroglu', to: '28-may', stops: 4 });
      const fault = r() < 0.35 ? pick(FAULTS) : null;
      const faultStep = fault ? (fault === 'train_delay' ? 2 : fault === 'crowd_noise' ? Math.floor(r() * 4) : 1) : -1;
      let completed = true;
      for (step = 0; step < STEPS.length; step++) {
        const id = STEPS[step];
        push('step_enter', { id });
        const stepStart = et;
        if (step === faultStep) {
          push('fault_injected', { fault, by: 'trainer' });
        }
        const level = Math.max(0, Math.min(3, Math.round(BASE[id] + ability - speed * k + (r() - 0.5) * 1.1 + (step === faultStep ? 0.6 : 0))));
        const errors = Math.max(0, Math.round((BASE[id] - 0.8) * 0.6 + ability * 0.5 - speed * k * 0.6 + (r() - 0.4) * 1.2 + (step === faultStep ? 0.7 : 0)));
        const asked = level > 0 && r() < 0.45;
        if (asked) {
          et += 2000;
          push('help_asked');
        }
        for (let h = 1; h <= level; h++) {
          et += [8000, 7000, 10000][h - 1];
          push('hint_shown', { level: h, trigger: asked && h === 1 ? 'ask' : 'idle' });
        }
        for (let e = 0; e < errors; e++) {
          et += 3000 + Math.floor(r() * 4000);
          const reason = { topup: 'invalid_amount', gate: 'insufficient_balance', platform: 'wrong_direction', ride: 'exit_too_early' }[id];
          push('error', { reason });
        }
        if (step === faultStep) {
          et += 4000 + Math.floor(r() * 9000);
          push('fault_resolved', { fault });
        }
        // a few early sessions end before the ride is finished
        if (k < 2 && step === 3 && r() < 0.25) {
          completed = false;
          et += 20000;
          break;
        }
        et += 9000 + Math.floor(r() * 9000) + (step === 3 ? 28000 : 0);
        push('step_complete', { id, ms: et - stepStart, errors, maxHintLevel: level, askedHelp: asked });
      }
      if (completed) {
        step = 4;
        push('session_end', { completed: true });
      }
    }
  }
  return lines;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lines = generateSample();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const sessions = new Set(lines.map((l) => l.sessionId)).size;
  console.log(`[sample] ${lines.length} events, ${sessions} sessions -> ${path.relative(ROOT, OUT)} (every line is marked "sample": true)`);
}
