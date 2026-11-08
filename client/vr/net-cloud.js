// Cloud version of the live link (same interface as net.js): Supabase Realtime.
//   - broadcast on channel "umate-<room>": pose, state, events, commands between phone and panel
//   - presence on the same channel: who is connected (the panel's device list)
//   - the session log goes to the database through /api/events (batched every second)
// Supabase limits messages per second, so head pose is sent 10 times a second and "state" at most
// every 100 ms (only the latest one counts anyway).
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { apiFetch } from '/shared/runtime.js';

export class NetCloud {
  constructor({ role, id, device, room, supabaseUrl, supabaseKey, onMessage, onStatus }) {
    this.role = role;
    this.id = id;
    this.device = device;
    this.room = room;
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.learner = null; // set by the app when the panel says who is training
    this.queue = [];
    this.lastPose = 0;
    this.stateTimer = 0;
    this.pendingState = null;
    this.ready = false;
    if (!room) {
      this.onStatus(false);
      return;
    }
    this.client = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false }, realtime: { params: { eventsPerSecond: 40 } } });
    this.channel = this.client.channel(`umate-${room}`, { config: { broadcast: { self: false }, presence: { key: id } } });
    this.channel.on('broadcast', { event: 'm' }, ({ payload }) => this.onMessage(payload));
    this.channel.on('presence', { event: 'sync' }, () => {
      const clients = Object.values(this.channel.presenceState())
        .flat()
        .map((p) => ({ role: p.role, id: p.id, device: p.device }));
      this.onMessage({ type: 'roster', clients });
    });
    this.channel.subscribe(async (status) => {
      this.ready = status === 'SUBSCRIBED';
      this.onStatus(this.ready);
      if (this.ready) await this.channel.track({ role, id, device });
    });
    this.flushTimer = setInterval(() => this.flush(), 1000);
    addEventListener('pagehide', () => this.flush(true));
  }

  send(msg) {
    if (!this.channel) return;
    // hover events come many times a second and are only useful live, so they are not stored
    const logIt = msg.type === 'transcript' || (msg.type === 'event' && msg.name !== 'hover');
    if (logIt && this.queue.length < 2000) this.queue.push({ ...msg, t: Date.now(), learner: this.learner });
    if (msg.type === 'pose') {
      const now = performance.now();
      if (now - this.lastPose < 100) return;
      this.lastPose = now;
    }
    if (msg.type === 'state') {
      this.pendingState = msg;
      if (!this.stateTimer) {
        this.stateTimer = setTimeout(() => {
          this.stateTimer = 0;
          this._broadcast(this.pendingState);
        }, 100);
      }
      return;
    }
    this._broadcast(msg);
  }

  _broadcast(msg) {
    if (!this.ready) return;
    this.channel.send({ type: 'broadcast', event: 'm', payload: { ...msg, from: this.id } }).catch(() => {});
  }

  // Session log: only the phone writes it, in batches.
  flush(final = false) {
    if (!this.queue.length || this.role !== 'phone') return;
    const events = this.queue.splice(0, 200);
    apiFetch('/api/events', { method: 'POST', json: { room: this.room, events }, keepalive: final }).catch(() => {
      this.queue.unshift(...events); // try again with the next batch
    });
  }
}
