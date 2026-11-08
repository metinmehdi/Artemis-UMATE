// GET /api/learners: learner profiles from Supabase. POST /api/learners {nickname}: add one.
import { checkKey, fail, readJson, send, sb } from './_lib.js';

export default async function handler(req, res) {
  if (!checkKey(req, res)) return;
  try {
    if (req.method === 'GET') {
      const learners = await sb('learners?select=id,nickname&order=created_at.asc');
      return send(res, 200, { learners, current: learners[0] || null });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const nickname = String(body.nickname || '').trim().slice(0, 40);
      if (!nickname) return send(res, 400, { error: 'nickname required' });
      const base = nickname.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'learner';
      const id = `${base}-${Date.now().toString(36).slice(-4)}`;
      await sb('learners', { method: 'POST', body: { id, nickname }, prefer: 'return=minimal' });
      return send(res, 200, { learner: { id, nickname } });
    }
    send(res, 405, { error: 'GET or POST' });
  } catch (e) {
    fail(res, e);
  }
}
