// Photos for the real-trip guide's step cards, taken from the same 360° panoramas the VR trip uses
// (so the guide shows the place the learner practised in). Drives the phone app in headless Edge,
// hides the UMATE guide layer (buddy, task card, hotspots, gaze ring) and keeps the real station:
// panorama, metro signs, in-car display.
//
//   npm start                 (laptop server, in another terminal)
//   node tools/snap-guide.mjs [https://localhost:8443]
//
// Writes client/assets/guide/{topup,gate,platform,ride}.jpg (900x600).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'client', 'assets', 'guide');
const BASE = process.argv[2] || 'https://localhost:8443';
const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9350;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'umate-snap-'));
const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`, '--ignore-certificate-errors', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let ver;
for (let i = 0; i < 60 && !ver; i++) {
  try {
    ver = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
  } catch {
    await sleep(250);
  }
}
if (!ver) throw new Error('Edge did not start');
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m), pending.delete(m.id);
};
const send = (method, params = {}, sessionId) => new Promise((res) => (pending.set(++id, res), ws.send(JSON.stringify({ id, method, params, sessionId }))));
const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
const { result: { sessionId: s } } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, s);
await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 600, deviceScaleFactor: 1, mobile: false }, s);
await send('Page.navigate', { url: `${BASE}/vr/` }, s);
const run = async (js) => (await send('Runtime.evaluate', { expression: `(async () => { const a = window.__app; ${js} })()`, awaitPromise: true, returnByValue: true }, s)).result?.result?.value;
for (let i = 0; i < 120 && !(await run('return !!a')); i++) await sleep(250);

await run(`
  a.RIDE.boardDelay = 300; a.RIDE.firstDeparture = 60000; a.RIDE.move = 600; a.RIDE.doors = 600; a.RIDE.destDoors = 60000;
  document.querySelector('#ai').checked = false;
  document.querySelector('#go-window').click();
  document.querySelector('#hud').style.display = 'none';
  // keep the real station, hide the UMATE guide layer
  const w = a.world, n = w.nodes;
  const hide = () => {
    for (const o of [w.buddy, w.taskCard, n.hall.kioskSpot, n.hall.gateSpot, n.hall.toPlatform, n.platform.feedback, n.train.doors, n.train.feedback, n.train.summary, a.gaze.cursor]) if (o) o.visible = false;
  };
  const up = w.update;
  w.update = (...x) => { up(...x); hide(); };
`);
await sleep(2500);

async function snap(name, u, pitch) {
  await run(`a.lookAtU(${u}, ${pitch})`);
  await sleep(1500);
  const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82 }, s);
  const file = path.join(OUT, `${name}.jpg`);
  fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log(`${path.relative(ROOT, file)}  ${Math.round(fs.statSync(file).size / 1024)} KB`);
}

await snap('topup', 0.215, -2);
await snap('gate', 0.54, -6);
await run(`a.select('kiosk'); a.select('kiosk:card'); a.select('kiosk:amount:1');`);
await sleep(3500);
await run(`a.select('gate');`);
await sleep(800);
await run(`a.select('go:platform');`);
await sleep(2500);
await snap('platform', 0.5, 14);
await run(`a.select('sign:' + a.engine.trip.correctSide);`);
for (let i = 0; i < 60 && (await run(`return a.engine.state.location`)) !== 'train'; i++) await sleep(250);
await sleep(3000); // let the cross-fade into the car finish
await snap('ride', 0.172, 4);

await send('Browser.close').catch(() => {});
edge.kill();
await sleep(1500);
try {
  fs.rmSync(profile, { recursive: true, force: true });
} catch {} // Edge may still hold the profile for a moment; it is only a temp folder
