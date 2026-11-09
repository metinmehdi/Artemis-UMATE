// POST /api/ask-photo: the real-trip guide's "Show Buddy" (photo -> two calm sentences). Not stored.
import { checkKey, fail, readJson, send } from './_lib.js';
import { askPhoto, checkPhoto } from '../server/ask-photo.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  if (!checkKey(req, res)) return;
  try {
    const body = await readJson(req, 1_500_000);
    const bad = checkPhoto(body);
    if (bad) return send(res, 400, { error: bad });
    send(res, 200, await askPhoto(body));
  } catch (e) {
    fail(res, e);
  }
}
