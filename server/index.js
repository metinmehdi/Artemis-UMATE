// Laptop server: HTTPS static files + WebSocket hub + small API.
//   https://<laptop-ip>:8443/vr/     -> phone (VR box or hand-held)
//   https://<laptop-ip>:8443/panel/  -> trainer panel / projector
//   http://<laptop-ip>:8080/         -> one-time phone setup (download local CA certificate)
//   https://<random>.trycloudflare.com/k/<key> -> public link (any network, no certificate setup)
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { ensureCerts } from './certs.js';
import { createRealtimeSecret } from './realtime.js';
import { EventLog } from './events.js';
import { startTunnel } from './tunnel.js';
import { reportFacts, writeReport } from './report.js';
import { askPhoto, checkPhoto } from './ask-photo.js';
import { buildStar, progressReport } from '../shared/analytics.js';
import { readLogs } from '../tools/build-gold.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {}

const HTTPS_PORT = Number(process.env.PORT) || 8443;
const HTTP_PORT = Number(process.env.HTTP_PORT) || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// URL prefix -> directory. First match wins.
const STATIC = [
  ['/vendor/three/', path.join(ROOT, 'node_modules', 'three')],
  ['/shared/', path.join(ROOT, 'shared')],
  ['/data/', path.join(ROOT, 'data')],
  ['/', path.join(ROOT, 'client')],
];

function serveStatic(req, res, pathname) {
  for (const [prefix, dir] of STATIC) {
    if (!pathname.startsWith(prefix)) continue;
    if (prefix === '/data/' && pathname.startsWith('/data/sessions/')) return false;
    const file = path.resolve(dir, '.' + pathname.slice(prefix.length - 1));
    if (!file.startsWith(dir)) return false;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return false;
    }
    if (stat.isDirectory()) {
      if (!pathname.endsWith('/')) {
        res.writeHead(301, { Location: pathname + '/' });
        res.end();
        return true;
      }
      return serveFile(res, path.join(file, 'index.html'), req);
    }
    return serveFile(res, file, req);
  }
  return false;
}

// Text files are sent gzip-compressed (three.js shrinks from 2.1 MB to about 0.5 MB), which matters
// on a slow tunnel or venue Wi-Fi. Images, fonts and the three.js library may be cached by the phone;
// our own code is never cached, so a reload always gets the latest version.
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.webmanifest']);
const gzCache = new Map(); // file -> { mtimeMs, buf }
function serveFile(res, file, req) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return false;
  }
  const ext = path.extname(file).toLowerCase();
  // stylesheets (brand tokens) are not cached either, so a design change shows up on the next reload
  const cacheable = /[\\/](assets|three)[\\/]/.test(file) && !/[\\/]client[\\/](vr|panel|guide)[\\/]/.test(file) && ext !== '.css';
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': cacheable ? 'public, max-age=86400' : 'no-store',
  };
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(req?.headers['accept-encoding'] || '')) {
    let hit = gzCache.get(file);
    if (!hit || hit.mtimeMs !== stat.mtimeMs) {
      hit = { mtimeMs: stat.mtimeMs, buf: zlib.gzipSync(fs.readFileSync(file), { level: 6 }) };
      gzCache.set(file, hit);
    }
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': hit.buf.length, Vary: 'Accept-Encoding' });
    res.end(hit.buf);
    return true;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
  return true;
}

function sendDenied(res) {
  res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>UMATE</title>' +
      '<body style="font:20px system-ui;background:#0b0f16;color:#f7f8fa;padding:24px">' +
      '<h1>UMATE</h1><p>Please scan the QR code on the trainer\'s panel to open UMATE.</p></body>',
  );
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const certs = ensureCerts(path.join(ROOT, 'certs'));
const log = new EventLog(path.join(ROOT, 'data', 'sessions'));
const urls = (p) => certs.ips.map((ip) => `https://${ip}:${HTTPS_PORT}${p}`);

// ---------- public link (tunnel) + access key ----------
// Tunnels (Cloudflare quick tunnel, or SSH to localhost.run) connect to a plain-HTTP listener that
// only accepts connections from this laptop (127.0.0.1:TUNNEL_PORT); the tunnel provider does the
// public HTTPS. Everything that arrives there is public, so it needs the access key. The QR code on
// the panel carries it (/k/<key>); the server swaps it for a cookie. LAN requests stay open.
const TUNNEL_PORT = Number(process.env.TUNNEL_PORT) || 8081;
const ACCESS_KEY = process.env.UMATE_KEY || crypto.randomBytes(5).toString('hex');
const viaTunnel = (req) => req.socket.localPort === TUNNEL_PORT || Boolean(req.headers['cf-ray'] || req.headers['cf-connecting-ip']);
const cookieKey = (req) => /(?:^|;\s*)umate_k=([\w-]+)/.exec(req.headers.cookie || '')?.[1];
const allowed = (req) => !viaTunnel(req) || cookieKey(req) === ACCESS_KEY;
let publicUrl = null;
const publicLinks = () =>
  publicUrl ? { vr: `${publicUrl}/k/${ACCESS_KEY}`, panel: `${publicUrl}/k/${ACCESS_KEY}?to=panel` } : null;

// ---------- learner profiles (no accounts: the trainer picks who is training) ----------
// data/learners.json holds the demo profile (committed); profiles added from the panel go to
// data/learners.local.json, which git ignores (nicknames of real learners stay on this laptop).
const LEARNERS_FILE = path.join(ROOT, 'data', 'learners.json');
const LOCAL_LEARNERS_FILE = path.join(ROOT, 'data', 'learners.local.json');
const readJsonFile = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'));
  } catch {
    return fallback;
  }
};
const allLearners = () => [...readJsonFile(LEARNERS_FILE, []), ...readJsonFile(LOCAL_LEARNERS_FILE, [])];
let currentLearner = allLearners()[0] || { id: 'demo', nickname: 'Demo' };

function readBody(req, limit = 10_000) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => {
      s += c;
      if (s.length > limit) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(s ? JSON.parse(s) : {});
      } catch {
        reject(new Error('bad JSON'));
      }
    });
  });
}

function selectLearner(l) {
  currentLearner = { id: l.id, nickname: l.nickname };
  broadcast((c) => c.role === 'panel', { type: 'learner', learner: currentLearner });
}

// Progress of one learner + the NÜMUNƏ cohort average (computed fresh each time: a few thousand
// log lines take milliseconds). Same function as the cloud API.
const progressPayload = (learnerId) => progressReport(buildStar(readLogs(ROOT).lines), learnerId);

async function handleApi(req, res, url) {
  if (url.pathname === '/api/config') return sendJson(res, 200, { mode: 'local' });
  if (url.pathname === '/api/learners' && req.method === 'GET') {
    return sendJson(res, 200, { learners: allLearners(), current: currentLearner });
  }
  if (url.pathname === '/api/learners' && req.method === 'POST') {
    const body = await readBody(req);
    const nickname = String(body.nickname || '').trim().slice(0, 40);
    if (!nickname) return sendJson(res, 400, { error: 'nickname required' });
    const id = nickname.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'learner';
    const local = readJsonFile(LOCAL_LEARNERS_FILE, []);
    const uniqueId = allLearners().some((l) => l.id === id) ? `${id}-${Date.now().toString(36).slice(-4)}` : id;
    const learner = { id: uniqueId, nickname };
    fs.writeFileSync(LOCAL_LEARNERS_FILE, JSON.stringify([...local, learner], null, 2) + '\n');
    selectLearner(learner);
    return sendJson(res, 200, { learner });
  }
  if (url.pathname === '/api/learner' && req.method === 'POST') {
    const body = await readBody(req);
    const l = allLearners().find((x) => x.id === body.id);
    if (!l) return sendJson(res, 404, { error: 'unknown learner' });
    selectLearner(l);
    return sendJson(res, 200, { learner: l });
  }
  if (url.pathname === '/api/progress') {
    return sendJson(res, 200, progressPayload(url.searchParams.get('learner') || currentLearner.id));
  }
  if (url.pathname === '/api/report' && req.method === 'POST') {
    const body = await readBody(req);
    const p = progressPayload(body.learner || currentLearner.id);
    const facts = reportFacts(p.progress, p.learner.nickname || p.learner.id, p.real_trips);
    const report = await writeReport(facts);
    if (report.fallback) console.warn('[report] template used:', report.fallback);
    return sendJson(res, 200, { ...report, facts });
  }
  if (url.pathname === '/api/info') {
    return sendJson(res, 200, {
      public: publicLinks(),
      vr: urls('/vr/'),
      panel: urls('/panel/'),
      setup: certs.ips.map((ip) => `http://${ip}:${HTTP_PORT}/`),
      ai: { openai: !!process.env.OPENAI_API_KEY, gemini: !!process.env.GEMINI_API_KEY },
    });
  }
  if (url.pathname === '/api/qr') {
    const text = url.searchParams.get('text') || '';
    const svg = await QRCode.toString(text, { type: 'svg', margin: 2, width: 220, color: { dark: '#230d37', light: '#fffdf6' } });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(svg);
  }
  if (url.pathname === '/api/realtime-token' && req.method === 'POST') {
    try {
      const body = await readBody(req).catch(() => ({}));
      return sendJson(res, 200, await createRealtimeSecret({ mode: body.mode === 'guide' ? 'guide' : 'vr' }));
    } catch (e) {
      console.error('[realtime] token failed:', e.message);
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }
  // real-trip guide: photo help, and its session log (same shape as the cloud's /api/events)
  if (url.pathname === '/api/ask-photo' && req.method === 'POST') {
    const body = await readBody(req, 1_500_000).catch(() => null);
    const bad = body ? checkPhoto(body) : 'body too large';
    if (bad) return sendJson(res, 400, { error: bad });
    return sendJson(res, 200, await askPhoto(body));
  }
  if (url.pathname === '/api/events' && req.method === 'POST') {
    const body = await readBody(req, 300_000).catch(() => ({}));
    const events = (Array.isArray(body.events) ? body.events.slice(0, 200) : []).filter((e) => e && /^[\w-]{4,64}$/.test(e.sessionId || '') && (e.type === 'event' || e.type === 'transcript'));
    for (const e of events) {
      log.append(e.sessionId, e);
      broadcast((c) => c.role === 'panel', e);
    }
    return sendJson(res, 200, { saved: events.length });
  }
  return sendJson(res, 404, { error: 'not found' });
}

async function handleRequest(req, res) {
  const url = new URL(req.url, 'https://localhost');
  try {
    if (url.pathname.startsWith('/k/')) {
      const ok = url.pathname.slice(3).replace(/\/$/, '') === ACCESS_KEY;
      if (!ok) return sendDenied(res);
      res.writeHead(302, {
        'Set-Cookie': `umate_k=${ACCESS_KEY}; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`,
        Location: url.searchParams.get('to') === 'panel' ? '/panel/' : '/vr/',
      });
      return res.end();
    }
    if (!allowed(req)) return sendDenied(res);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (url.pathname === '/') {
      res.writeHead(302, { Location: '/vr/' });
      return res.end();
    }
    if (!serveStatic(req, res, decodeURIComponent(url.pathname))) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  } catch (e) {
    console.error('[http]', e);
    if (!res.headersSent) sendJson(res, 500, { error: 'server error' });
  }
}

const server = https.createServer({ key: certs.key, cert: certs.cert }, handleRequest);
const tunnelServer = http.createServer(handleRequest); // 127.0.0.1 only, for the tunnel

// ---------- WebSocket hub ----------
// Phones send: hello, pose (not logged), event / transcript (logged), status.
// Panels send: cmd -> forwarded to phones.
const wss = new WebSocketServer({ noServer: true });
for (const s of [server, tunnelServer]) {
  s.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname !== '/ws' || !allowed(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}
const clients = new Map(); // ws -> { role, id, device }

function broadcast(filter, msg) {
  const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const [ws, info] of clients) {
    if (ws.readyState === ws.OPEN && filter(info)) ws.send(data);
  }
}

function roster() {
  return [...clients.values()].map(({ role, id, device }) => ({ role, id, device }));
}

wss.on('connection', (ws) => {
  clients.set(ws, { role: 'unknown', id: null, device: null });
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const info = clients.get(ws);
    switch (msg.type) {
      case 'hello':
        info.role = msg.role === 'panel' ? 'panel' : msg.role === 'guide' ? 'guide' : 'phone';
        info.id = String(msg.id || '').slice(0, 64);
        info.device = String(msg.device || '').slice(0, 120);
        broadcast((c) => c.role === 'panel', { type: 'roster', clients: roster() });
        break;
      case 'pose':
        broadcast((c) => c.role === 'panel', { ...msg, from: info.id });
        break;
      case 'event':
      case 'transcript':
        log.append(msg.sessionId, { ...msg, learner: msg.learner || currentLearner });
        broadcast((c) => c.role === 'panel', { ...msg, from: info.id });
        break;
      case 'status':
      case 'state':
        broadcast((c) => c.role === 'panel', { ...msg, from: info.id });
        break;
      case 'cmd':
        if (info.role !== 'panel') return;
        broadcast((c) => c.role === 'phone' && (!msg.to || c.id === msg.to), msg);
        break;
    }
  });
  ws.on('close', () => {
    clients.delete(ws);
    broadcast((c) => c.role === 'panel', { type: 'roster', clients: roster() });
  });
});

// ---------- Plain-HTTP setup page (CA download) ----------
const setupServer = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/ca.crt') {
    res.writeHead(200, {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="umate-ca.crt"',
    });
    return fs.createReadStream(certs.caPath).pipe(res);
  }
  if (url.pathname === '/') return serveFile(res, path.join(ROOT, 'client', 'setup.html')) || res.end();
  res.writeHead(404);
  res.end();
});

server.listen(HTTPS_PORT, '0.0.0.0', () => {
  setupServer.listen(HTTP_PORT, '0.0.0.0', () => {
    console.log('\nUMATE server is running\n');
    for (const ip of certs.ips) {
      console.log(`  Phone setup (once): http://${ip}:${HTTP_PORT}/`);
      console.log(`  Phone VR:           https://${ip}:${HTTPS_PORT}/vr/`);
      console.log(`  Panel:              https://${ip}:${HTTPS_PORT}/panel/\n`);
    }
    console.log(`  Laptop panel:       https://localhost:${HTTPS_PORT}/panel/`);
    console.log(`  OpenAI key: ${process.env.OPENAI_API_KEY ? 'OK' : 'MISSING (.env)'}   Gemini key: ${process.env.GEMINI_API_KEY ? 'OK' : 'MISSING (.env)'}\n`);
    if (process.env.UMATE_TUNNEL === '0') return console.log('  Public link: off (UMATE_TUNNEL=0)\n');
    tunnelServer.listen(TUNNEL_PORT, '127.0.0.1');
    startTunnel({
      root: ROOT,
      port: TUNNEL_PORT,
      onUrl: (u, provider) => {
        publicUrl = u;
        console.log(`\n  PUBLIC link for phones via ${provider} (any network, no certificate needed):\n    ${publicLinks().vr}\n`);
      },
      onDown: (why) => {
        publicUrl = null;
        console.log(`  Public link: unavailable (${why}). Phones can still use the Wi-Fi links above.`);
      },
    });
  });
});
