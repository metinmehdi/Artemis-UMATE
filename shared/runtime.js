// Where is UMATE running? The browser asks /api/config:
//   laptop server -> { mode: 'local' }   WebSocket hub on the laptop, logs in data/sessions/
//   Vercel         -> { mode: 'cloud', supabaseUrl, supabaseAnonKey }
//                     Supabase Realtime connects phone and panel, logs go to the Supabase database
// The cloud API needs the access key; it comes once from the panel's QR code (?k=...) and is kept
// in this browser. The room code (?room=...) pairs one phone with one panel.

const KEY_STORE = 'umate-key';
const ROOM_STORE = 'umate-room';

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function loadRuntime() {
  let cfg = { mode: 'local' };
  try {
    const r = await fetch('/api/config', { cache: 'no-store' });
    if (r.ok) cfg = await r.json();
  } catch {}
  const url = new URL(location.href);
  const st = storage();
  const k = url.searchParams.get('k');
  if (k) st?.setItem(KEY_STORE, k);
  const room = url.searchParams.get('room');
  if (k) {
    // keep the key out of the address bar (and out of screenshots)
    url.searchParams.delete('k');
    history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
  }
  return { ...cfg, key: st?.getItem(KEY_STORE) || '', room };
}

export function setKey(key) {
  storage()?.setItem(KEY_STORE, key);
}

/** A panel keeps one room code, so a phone that reloads finds it again. */
export function panelRoom() {
  const st = storage();
  let room = st?.getItem(ROOM_STORE);
  if (!room) {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
    room = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => abc[b % abc.length]).join('');
    st?.setItem(ROOM_STORE, room);
  }
  return room;
}

let runtimeKey = '';
export function useKey(key) {
  runtimeKey = key || '';
}

/** fetch() for /api/... that sends the access key (the laptop server ignores it). */
export function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (runtimeKey) headers['x-umate-key'] = runtimeKey;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    opts = { ...opts, body: JSON.stringify(opts.json) };
  }
  return fetch(path, { cache: 'no-store', ...opts, headers });
}

/** The live link between phone and panel: WebSocket on the laptop, Supabase Realtime in the cloud. */
export async function makeNet(runtime, options) {
  if (runtime.mode === 'cloud') {
    const { NetCloud } = await import('/vr/net-cloud.js');
    return new NetCloud({ ...options, room: runtime.room, supabaseUrl: runtime.supabaseUrl, supabaseKey: runtime.supabaseAnonKey });
  }
  const { Net } = await import('/vr/net.js');
  return new Net(options);
}
