// Trainer report: a short, plain-English summary of one learner's progress.
// Gemini writes it from FACTS computed by shared/analytics.js (it never sees raw logs, names of real
// people beyond the nickname, or audio). If Gemini is not available (no key, no internet, busy),
// a template report is built from the same facts, so the panel always has something to show.
import { STEP_NAMES } from '../shared/analytics.js';
import { geminiGenerate } from './gemini.js';

export function reportFacts(progress, nickname, realTrips = []) {
  const s = progress.sessions;
  const last = s.at(-1);
  const first = s[0];
  return {
    learner: nickname,
    sample_data: progress.is_sample,
    sessions: s.length,
    first_session: first?.date ?? null,
    last_session: last?.date ?? null,
    completed_trips: s.filter((x) => x.completed).length,
    steps_done_alone_first: first?.independent_steps ?? null,
    steps_done_alone_last: last?.independent_steps ?? null,
    hints_first: first?.hints ?? null,
    hints_last: last?.hints ?? null,
    minutes_last: last?.minutes ?? null,
    step_needing_most_help_recently: progress.focus_step ? STEP_NAMES[progress.focus_step] : null,
    readiness_rule_met: progress.ready,
    readiness_rule: 'last 3 completed sessions each had at least 3 of 4 steps done without hints or mistakes',
    // real trips made with the phone guide (no VR): what help was used, at which step
    real_trips: realTrips.map((r) => ({
      date: r.date,
      completed: r.completed,
      help_used: r.help_count,
      help_by_step: Object.fromEntries(Object.entries(r.help_by_step || {}).map(([k, v]) => [STEP_NAMES[k] || k, v])),
      learner_said: r.self_report === 'alone' ? 'done alone' : r.self_report === 'help' ? 'needed help' : null,
    })),
  };
}

export function templateReport(f) {
  if (!f.sessions) return `${f.learner} has no training sessions yet.`;
  const lines = [
    `${f.learner} trained ${f.sessions} time${f.sessions === 1 ? '' : 's'} (${f.first_session} to ${f.last_session}) and finished the whole trip ${f.completed_trips} time${f.completed_trips === 1 ? '' : 's'}.`,
    `Steps done alone went from ${f.steps_done_alone_first} to ${f.steps_done_alone_last} of 4; hints went from ${f.hints_first} to ${f.hints_last}.`,
  ];
  if (f.step_needing_most_help_recently) lines.push(`Recently the step that needed the most help was: ${f.step_needing_most_help_recently}. Practise this step next.`);
  lines.push(
    f.readiness_rule_met
      ? 'The readiness rule is met. The trainer can plan a first real trip with a companion nearby.'
      : 'The readiness rule is not met yet. Keep practising in VR before a real trip.',
  );
  if (f.real_trips?.length) {
    const r = f.real_trips.at(-1);
    lines.push(`Real trips with the phone guide: ${f.real_trips.length}. The last one (${r.date}) was ${r.completed ? 'completed' : 'not finished'} with ${r.help_used} help request${r.help_used === 1 ? '' : 's'}.`);
  }
  if (f.sample_data) lines.push('NOTE: this is NÜMUNƏ (sample) data, invented for the demo.');
  return lines.join(' ');
}

const SYSTEM = [
  'You write short progress notes for a trainer of a young person with cognitive differences who is learning to use the Baku Metro in a VR trainer.',
  'Use ONLY the facts given in JSON. Never invent numbers, dates, diagnoses or medical advice.',
  'Write in plain, warm, respectful English, 4 to 6 short sentences, no headings, no lists.',
  'Mention progress first, then the step to practise next, then one concrete idea for the next session.',
  'About readiness: say whether the readiness rule is met and that the trainer makes the final decision.',
  'If real_trips is not empty, add one sentence about the real trips made with the phone guide: completed or not, and at which step help was used.',
  'If sample_data is true, end with: "NOTE: this is NÜMUNƏ (sample) data, invented for the demo."',
].join(' ');

export async function writeReport(facts) {
  if (!process.env.GEMINI_API_KEY) return { text: templateReport(facts), model: null, fallback: 'no Gemini key' };
  try {
    const { text, model } = await geminiGenerate({
      system: SYSTEM,
      parts: [{ text: `Facts (JSON):\n${JSON.stringify(facts, null, 1)}\n\nWrite the progress note now.` }],
    });
    return { text, model, fallback: null };
  } catch (e) {
    return { text: templateReport(facts), model: null, fallback: e.message };
  }
}
