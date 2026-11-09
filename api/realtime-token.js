// POST /api/realtime-token: a short-lived OpenAI Realtime secret for the phone's voice buddy.
import { checkKey, fail, readJson, send } from './_lib.js';
import { createRealtimeSecret } from '../server/realtime.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!checkKey(req, res)) return;
  try {
    const body = await readJson(req).catch(() => ({}));
    send(res, 200, await createRealtimeSecret({ mode: body.mode === 'guide' ? 'guide' : 'vr' }));
  } catch (e) {
    fail(res, e);
  }
}
