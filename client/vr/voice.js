// Recorded buddy lines (client/assets/voice), played when the live AI voice is not available.
// Lines are decoded once into Web Audio buffers, so they play instantly and without a network.
// Only one line plays at a time; a line that comes while another plays waits, and only the newest
// waiting line is kept (an older hint is out of date by then).
export class OfflineVoice {
  constructor({ onLine } = {}) {
    this.onLine = onLine || (() => {});
    this.lines = {};
    this.buffers = new Map();
    this.actx = null;
    this.playing = null;
    this.pending = null;
    this.analyser = null;
    this._buf = null;
  }

  async load() {
    try {
      const r = await fetch('/assets/voice/lines.json', { cache: 'no-store' });
      if (r.ok) this.lines = (await r.json()).lines || {};
    } catch {}
    return Object.keys(this.lines).length;
  }

  // Call after the user's tap (audio unlock). Decoding runs in the background.
  start(actx) {
    if (!actx) return;
    this.actx = actx;
    this.analyser = actx.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(actx.destination);
    for (const key of Object.keys(this.lines)) if (this.lines[key].file) this._decode(key);
  }

  async _decode(key) {
    if (this.buffers.has(key) || !this.actx || !this.lines[key]?.file) return this.buffers.get(key);
    const p = fetch(`/assets/voice/${this.lines[key].file}`)
      .then((r) => r.arrayBuffer())
      .then((b) => this.actx.decodeAudioData(b))
      .catch(() => null);
    this.buffers.set(key, p);
    return p;
  }

  has(key) {
    return !!this.lines[key];
  }

  async play(key) {
    if (!this.actx || !this.lines[key]) return false;
    if (this.playing) {
      this.pending = key;
      return true;
    }
    const buf = this.lines[key].file ? await this._decode(key) : null;
    if (!buf) return this._speak(key); // not recorded (yet): the phone's own speech engine
    this._play(key, buf);
    return true;
  }

  _speak(key) {
    try {
      if (!('speechSynthesis' in window)) return false;
      const u = new SpeechSynthesisUtterance(this.lines[key].text);
      u.lang = 'en-GB';
      u.rate = 0.92;
      this.playing = { stop: () => speechSynthesis.cancel() };
      u.onend = u.onerror = () => this._ended();
      speechSynthesis.speak(u);
      this.onLine(key, this.lines[key].text);
      return true;
    } catch {
      this.playing = null;
      return false;
    }
  }

  _ended() {
    this.playing = null;
    const next = this.pending;
    this.pending = null;
    if (next) setTimeout(() => this.play(next), 250);
  }

  _play(key, buf) {
    const src = this.actx.createBufferSource();
    src.buffer = buf;
    src.connect(this.analyser);
    this.playing = src;
    src.onended = () => this._ended();
    src.start();
    this.onLine(key, this.lines[key].text);
  }

  stop() {
    this.pending = null;
    try {
      this.playing?.stop();
    } catch {}
    this.playing = null;
  }

  // 0..1 loudness, for the buddy orb animation
  level() {
    if (!this.playing || !this.analyser) return 0;
    const buf = this._buf || (this._buf = new Uint8Array(this.analyser.fftSize));
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }
}
