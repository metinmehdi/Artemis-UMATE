// GET /api/progress?learner=: the learner's progress from the Supabase log + the NÜMUNƏ sample cohort
// (generated on the fly, deterministic, never stored as real data).
import { checkKey, fail, loadLogLines, send } from './_lib.js';
import { buildStar, progressReport } from '../shared/analytics.js';
import { generateSample } from '../tools/gen-sample.js';

export async function progressFor(learnerId) {
  const lines = [...(await loadLogLines()), ...generateSample()];
  return progressReport(buildStar(lines), learnerId);
}

export default async function handler(req, res) {
  if (!checkKey(req, res)) return;
  try {
    const learner = String(new URL(req.url, 'http://x').searchParams.get('learner') || 'demo');
    send(res, 200, await progressFor(learner));
  } catch (e) {
    fail(res, e);
  }
}
