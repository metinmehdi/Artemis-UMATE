// Shared helpers for the Vercel functions (files starting with "_" are not routes).
import crypto from 'node:crypto';

export function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

/** The access key from the panel's QR code protects everything that costs money or holds data. */
export function checkKey(req, res) {
  const want = process.env.UMATE_ACCESS_KEY || '';
  const got = String(req.headers['x-umate-key'] || '');
  const ok = want && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) send(res, 401, { error: 'Access key missing or wrong. Scan the QR code on the trainer panel.' });
  return ok;
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body; // Vercel already parsed it
  let s = '';
  for await (const c of req) {
    s += c;
    if (s.length > 200_000) throw new Error('body too large');
  }
  return s ? JSON.parse(s) : {};
}

/** Supabase REST (PostgREST) with the service key: only the server can read and write the tables. */
export async function sb(path, { method = 'GET', body, prefer } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Object.assign(new Error('Supabase is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)'), { status: 503 });
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // legacy JWT keys; new sb_secret_ keys go in apikey only
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw Object.assign(new Error(data?.message || `Supabase HTTP ${r.status}`), { status: 502 });
  return data;
}

/** All logged events as log lines in the same shape as the laptop's JSONL files. */
export async function loadLogLines() {
  const lines = [];
  const page = 1000;
  for (let from = 0; from < 50_000; from += page) {
    const rows = await sb(`events?select=t,session_id,learner_id,learner_nickname,type,name,step,node,data&order=id.asc&offset=${from}&limit=${page}`);
    for (const r of rows) {
      lines.push({
        t: Number(r.t),
        sessionId: r.session_id,
        type: r.type,
        name: r.name,
        step: r.step,
        node: r.node,
        data: r.data,
        learner: r.learner_id ? { id: r.learner_id, nickname: r.learner_nickname || r.learner_id } : undefined,
      });
    }
    if (rows.length < page) break;
  }
  return lines;
}

export function fail(res, e) {
  console.error('[api]', e.message);
  send(res, e.status || 500, { error: e.message });
}
