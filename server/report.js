// Trainer report: a short, plain-English summary of one learner's progress.
// Gemini writes it from FACTS computed by shared/analytics.js (it never sees raw logs, names of real
// people beyond the nickname, or audio). If Gemini is not available (no key, no internet, busy),
// a template report is built from the same facts, so the panel always has something to show.
import { STEP_NAMES } from '../shared/analytics.js';

// read at call time: the server loads .env after its imports
const models = () => [process.env.GEMINI_MODEL, 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest'].filter(Boolean);

export function reportFacts(progress, nickname) {
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
  if (f.sample_data) lines.push('NOTE: this is NÜMUNƏ (sample) data, invented for the demo.');
  return lines.join(' ');
}

const SYSTEM = [
  'You write short progress notes for a trainer of a young person with cognitive differences who is learning to use the Baku Metro in a VR trainer.',
  'Use ONLY the facts given in JSON. Never invent numbers, dates, diagnoses or medical advice.',
  'Write in plain, warm, respectful English, 4 to 6 short sentences, no headings, no lists.',
  'Mention progress first, then the step to practise next, then one concrete idea for the next session.',
  'About readiness: say whether the readiness rule is met and that the trainer makes the final decision.',
  'If sample_data is true, end with: "NOTE: this is NÜMUNƏ (sample) data, invented for the demo."',
].join(' ');

export async function writeReport(facts) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: templateReport(facts), model: null, fallback: 'no Gemini key' };
  let lastError = null;
  for (const model of models()) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM }] },
          contents: [{ role: 'user', parts: [{ text: `Facts (JSON):\n${JSON.stringify(facts, null, 1)}\n\nWrite the progress note now.` }] }],
          generationConfig: {
            temperature: 0.4,
            // thinking tokens count against the output limit; a short note needs little thinking
            maxOutputTokens: 2048,
            thinkingConfig: /^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' },
          },
        }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
      const cand = j.candidates?.[0];
      if (cand?.finishReason && cand.finishReason !== 'STOP') throw new Error(`stopped: ${cand.finishReason}`);
      const text = cand?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      if (!text) throw new Error('empty answer');
      return { text, model: j.modelVersion || model, fallback: null };
    } catch (e) {
      lastError = `${model}: ${e.message}`;
    }
  }
  return { text: templateReport(facts), model: null, fallback: lastError };
}
