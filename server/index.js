// Laptop server: HTTPS static files + WebSocket hub + small API.
//   https://<laptop-ip>:8443/vr/     -> phone (VR box or hand-held)
//   https://<laptop-ip>:8443/panel/  -> trainer panel / projector
//   http://<laptop-ip>:8080/         -> one-time phone setup (download local CA certificate)
import https from 'node:https';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { ensureCerts } from './certs.js';
import { createRealtimeSecret } from './realtime.js';
import { EventLog } from './events.js';

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
      return serveFile(res, path.join(file, 'index.html'));
    }
    return serveFile(res, file);
  }
  return false;
}

function serveFile(res, file) {
  if (!fs.existsSync(file)) return false;
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
  return true;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const certs = ensureCerts(path.join(ROOT, 'certs'));
const log = new EventLog(path.join(ROOT, 'data', 'sessions'));
const urls = (p) => certs.ips.map((ip) => `https://${ip}:${HTTPS_PORT}${p}`);

async function handleApi(req, res, url) {
  if (url.pathname === '/api/info') {
    return sendJson(res, 200, {
      vr: urls('/vr/'),
      panel: urls('/panel/'),
      setup: certs.ips.map((ip) => `http://${ip}:${HTTP_PORT}/`),
      ai: { openai: !!process.env.OPENAI_API_KEY, gemini: !!process.env.GEMINI_API_KEY },
    });
  }
  if (url.pathname === '/api/qr') {
    const text = url.searchParams.get('text') || '';
    const svg = await QRCode.toString(text, { type: 'svg', margin: 1, width: 220 });
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(svg);
  }
  if (url.pathname === '/api/realtime-token' && req.method === 'POST') {
    try {
      return sendJson(res, 200, await createRealtimeSecret());
    } catch (e) {
      console.error('[realtime] token failed:', e.message);
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }
  return sendJson(res, 404, { error: 'not found' });
}

const server = https.createServer({ key: certs.key, cert: certs.cert }, async (req, res) => {
  const url = new URL(req.url, 'https://localhost');
  try {
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
});

// ---------- WebSocket hub ----------
// Phones send: hello, pose (not logged), event / transcript (logged), status.
// Panels send: cmd -> forwarded to phones.
const wss = new WebSocketServer({ server, path: '/ws' });
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
        info.role = msg.role === 'panel' ? 'panel' : 'phone';
        info.id = String(msg.id || '').slice(0, 64);
        info.device = String(msg.device || '').slice(0, 120);
        broadcast((c) => c.role === 'panel', { type: 'roster', clients: roster() });
        break;
      case 'pose':
        broadcast((c) => c.role === 'panel', { ...msg, from: info.id });
        break;
      case 'event':
      case 'transcript':
        log.append(msg.sessionId, msg);
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
  });
});
