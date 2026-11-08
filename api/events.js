// POST /api/events: the phone's session log, in batches, into the Supabase "events" table.
import { checkKey, fail, readJson, send, sb } from './_lib.js';

const ID = /^[\w-]{4,64}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!checkKey(req, res)) return;
  try {
    const body = await readJson(req);
    const room = String(body.room || '').slice(0, 16);
    const events = Array.isArray(body.events) ? body.events.slice(0, 200) : [];
    const rows = events
      .filter((e) => e && ID.test(e.sessionId || '') && (e.type === 'event' || e.type === 'transcript'))
      .map((e) => ({
        t: Number(e.t) || Date.now(),
        room,
        session_id: e.sessionId,
        learner_id: e.learner?.id ? String(e.learner.id).slice(0, 64) : null,
        learner_nickname: e.learner?.nickname ? String(e.learner.nickname).slice(0, 40) : null,
        type: e.type,
        name: e.type === 'event' ? String(e.name || '').slice(0, 40) : 'transcript',
        step: Number.isInteger(e.step) ? e.step : null,
        node: e.node ? String(e.node).slice(0, 20) : null,
        data: e.type === 'event' ? e.data || {} : { who: e.who, text: String(e.text || '').slice(0, 2000) },
      }));
    if (rows.length) await sb('events', { method: 'POST', body: rows, prefer: 'return=minimal' });
    send(res, 200, { saved: rows.length });
  } catch (e) {
    fail(res, e);
  }
}
