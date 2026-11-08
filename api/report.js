// POST /api/report {learner}: the trainer note written by Gemini (template if Gemini is not available).
import { checkKey, fail, readJson, send } from './_lib.js';
import { progressFor } from './progress.js';
import { reportFacts, writeReport } from '../server/report.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!checkKey(req, res)) return;
  try {
    const body = await readJson(req);
    const p = await progressFor(String(body.learner || 'demo'));
    const facts = reportFacts(p.progress, p.learner.nickname || p.learner.id);
    const report = await writeReport(facts);
    send(res, 200, { ...report, facts });
  } catch (e) {
    fail(res, e);
  }
}
