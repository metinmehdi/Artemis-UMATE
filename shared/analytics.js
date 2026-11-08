// GOLD layer: session event logs (JSONL lines) -> star schema for learning analytics.
// Pure functions (no file access), used by tools/build-gold.js, the server (/api/progress) and tests.
//
// Star schema (see README section 5.3):
//   dim_learner, dim_step, dim_fault, dim_date
//   fact_session        one row per session
//   fact_step_attempt   one row per session x step that was entered
//   fact_fault          one row per trainer challenge injected in a session

export const STEP_ORDER = ['topup', 'gate', 'platform', 'ride'];
export const STEP_NAMES = { topup: 'Top up the card', gate: 'Turnstile', platform: 'Platform direction', ride: 'Ride and get off' };
export const FAULT_LABELS = {
  insufficient_balance: 'Not enough balance',
  card_unreadable: 'Card not read',
  train_delay: 'Train delayed',
  crowd_noise: 'Crowd and noise',
};
const UNKNOWN_LEARNER = { id: 'unassigned', nickname: 'Unassigned' };

const dateKey = (ms) => {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
};
function isoWeek(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

/** Parse JSONL text into event objects; broken lines are counted, not fatal. */
export function parseJsonl(text) {
  const events = [];
  let broken = 0;
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      broken += 1;
    }
  }
  return { events, broken };
}

/**
 * @param {object[]} lines  log lines: { t, sessionId, type: 'event'|'transcript', name, data, learner?, sample? }
 * @returns {{ dims: object, facts: object, quality: object }}
 */
export function buildStar(lines) {
  const bySession = new Map();
  for (const l of lines) {
    if (!l || !l.sessionId || l.type !== 'event') continue;
    if (!bySession.has(l.sessionId)) bySession.set(l.sessionId, []);
    bySession.get(l.sessionId).push(l);
  }

  const learners = new Map();
  const dates = new Map();
  const fact_session = [];
  const fact_step_attempt = [];
  const fact_fault = [];
  let skipped = 0;

  for (const [sessionId, evs] of bySession) {
    evs.sort((a, b) => (a.data?.t ?? 0) - (b.data?.t ?? 0) || a.t - b.t);
    const start = evs.find((e) => e.name === 'session_start');
    if (!start) {
      skipped += 1; // a page that was opened but never started a trip
      continue;
    }
    const learner = evs.find((e) => e.learner)?.learner || UNKNOWN_LEARNER;
    const isSample = evs.some((e) => e.sample === true);
    if (!learners.has(learner.id)) learners.set(learner.id, { learner_key: learner.id, nickname: learner.nickname || learner.id, is_sample: isSample });
    const dk = dateKey(start.t);
    if (!dates.has(dk)) {
      const d = new Date(start.t);
      dates.set(dk, { date_key: dk, date: d.toISOString().slice(0, 10), week: isoWeek(start.t), weekday: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }) });
    }
    const device = evs.find((e) => e.name === 'device')?.data || {};
    const end = evs.find((e) => e.name === 'session_end');
    const lastT = evs[evs.length - 1].data?.t ?? start.data.t;

    // steps: one row per step that was entered; open steps are marked as not completed
    const entered = new Map();
    for (const e of evs) {
      if (e.name === 'step_enter') entered.set(e.data.id, { t: e.data.t, hints: 0, errors: 0, asked: false });
      const cur = [...entered.values()].at(-1);
      if (cur && e.name === 'hint_shown') cur.hints = Math.max(cur.hints, e.data.level || 0);
      if (cur && e.name === 'error') cur.errors += 1;
      if (cur && e.name === 'help_asked') cur.asked = true;
      if (e.name === 'step_complete') {
        fact_step_attempt.push({
          session_key: sessionId,
          step_key: e.data.id,
          completed: true,
          ms: e.data.ms,
          errors: e.data.errors,
          max_hint_level: e.data.maxHintLevel,
          asked_help: !!e.data.askedHelp,
        });
        entered.delete(e.data.id);
      }
    }
    for (const [id, s] of entered) {
      fact_step_attempt.push({ session_key: sessionId, step_key: id, completed: false, ms: lastT - s.t, errors: s.errors, max_hint_level: s.hints, asked_help: s.asked });
    }

    // trainer challenges
    for (const e of evs.filter((x) => x.name === 'fault_injected')) {
      const resolved = evs.find((x) => x.name === 'fault_resolved' && x.data.fault === e.data.fault && x.data.t >= e.data.t);
      fact_fault.push({
        session_key: sessionId,
        fault_key: e.data.fault,
        step_key: STEP_ORDER[e.step] ?? null,
        resolved: !!resolved || !!end,
        ms_to_resolve: resolved ? resolved.data.t - e.data.t : null,
      });
    }

    const steps = fact_step_attempt.filter((r) => r.session_key === sessionId && r.completed);
    fact_session.push({
      session_key: sessionId,
      learner_key: learner.id,
      date_key: dk,
      started_at: new Date(start.t).toISOString(),
      completed: !!end?.data?.completed,
      total_ms: (end?.data?.t ?? lastT) - start.data.t,
      steps_completed: steps.length,
      independent_steps: steps.filter((r) => r.errors === 0 && r.max_hint_level === 0).length,
      device: device.device || null,
      mode: device.mode || null,
      is_sample: isSample,
    });
  }

  fact_session.sort((a, b) => a.started_at.localeCompare(b.started_at));
  return {
    dims: {
      dim_learner: [...learners.values()].sort((a, b) => a.learner_key.localeCompare(b.learner_key)),
      dim_step: STEP_ORDER.map((k, i) => ({ step_key: k, order: i + 1, name: STEP_NAMES[k] })),
      dim_fault: Object.entries(FAULT_LABELS).map(([k, label]) => ({ fault_key: k, label })),
      dim_date: [...dates.values()].sort((a, b) => a.date_key - b.date_key),
    },
    facts: { fact_session, fact_step_attempt, fact_fault },
    quality: { sessions_without_start: skipped },
  };
}

/** Check that every foreign key points to an existing dimension row (parquet-free star, so we test it). */
export function checkKeys(star) {
  const problems = [];
  const has = (rows, key) => new Set(rows.map((r) => r[key]));
  const learners = has(star.dims.dim_learner, 'learner_key');
  const steps = has(star.dims.dim_step, 'step_key');
  const faults = has(star.dims.dim_fault, 'fault_key');
  const datesK = has(star.dims.dim_date, 'date_key');
  const sessions = has(star.facts.fact_session, 'session_key');
  for (const s of star.facts.fact_session) {
    if (!learners.has(s.learner_key)) problems.push(`fact_session ${s.session_key}: unknown learner ${s.learner_key}`);
    if (!datesK.has(s.date_key)) problems.push(`fact_session ${s.session_key}: unknown date ${s.date_key}`);
  }
  const seen = new Set();
  for (const a of star.facts.fact_step_attempt) {
    if (!sessions.has(a.session_key)) problems.push(`fact_step_attempt: unknown session ${a.session_key}`);
    if (!steps.has(a.step_key)) problems.push(`fact_step_attempt: unknown step ${a.step_key}`);
    const pk = a.session_key + '|' + a.step_key;
    if (seen.has(pk)) problems.push(`fact_step_attempt: duplicate key ${pk}`);
    seen.add(pk);
  }
  for (const f of star.facts.fact_fault) {
    if (!sessions.has(f.session_key)) problems.push(`fact_fault: unknown session ${f.session_key}`);
    if (!faults.has(f.fault_key)) problems.push(`fact_fault: unknown fault ${f.fault_key}`);
  }
  return problems;
}

/**
 * Progress of one learner, session by session: what the trainer chart shows.
 * Readiness is a simple, explainable RULE (not a model): the last 3 completed sessions each had at
 * least 3 of 4 steps done alone (no hint, no mistake). The roadmap model replaces this rule.
 */
export function learnerProgress(star, learnerKey) {
  const sessions = star.facts.fact_session.filter((s) => s.learner_key === learnerKey);
  const rows = sessions.map((s, i) => {
    const steps = star.facts.fact_step_attempt.filter((a) => a.session_key === s.session_key);
    const byStep = Object.fromEntries(STEP_ORDER.map((k) => [k, steps.find((a) => a.step_key === k) || null]));
    return {
      n: i + 1,
      session_key: s.session_key,
      date: s.started_at.slice(0, 10),
      completed: s.completed,
      independent_steps: s.independent_steps,
      hints: steps.reduce((sum, a) => sum + (a.max_hint_level || 0), 0),
      errors: steps.reduce((sum, a) => sum + (a.errors || 0), 0),
      minutes: +(s.total_ms / 60000).toFixed(1),
      by_step: byStep,
    };
  });
  const last3 = rows.filter((r) => r.completed).slice(-3);
  const ready = last3.length === 3 && last3.every((r) => r.independent_steps >= 3);
  // the step that most often needed help in the last 5 sessions
  const recent = rows.slice(-5);
  const need = STEP_ORDER.map((k) => ({
    step: k,
    help: recent.reduce((s, r) => s + (r.by_step[k] ? (r.by_step[k].max_hint_level || 0) + (r.by_step[k].errors || 0) : 0), 0),
  })).sort((a, b) => b.help - a.help)[0];
  return { learner_key: learnerKey, sessions: rows, ready, focus_step: need && need.help > 0 ? need.step : null };
}
