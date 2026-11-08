// POST /api/realtime-token: a short-lived OpenAI Realtime secret for the phone's voice buddy.
import { checkKey, fail, send } from './_lib.js';
import { createRealtimeSecret } from '../server/realtime.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!checkKey(req, res)) return;
  try {
    send(res, 200, await createRealtimeSecret());
  } catch (e) {
    fail(res, e);
  }
}
