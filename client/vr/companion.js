// AI travel buddy: OpenAI Realtime voice over WebRTC.
// The mic track is only enabled while the learner looks at the buddy (gaze-to-talk),
// so a noisy hall does not trigger it. If anything fails, the buddy goes "offline" and
// the app keeps working (pre-recorded lines can be added later).
import { apiFetch } from '/shared/runtime.js';

export class Companion {
  constructor({ onTranscript, onMode, onLog } = {}) {
    this.onTranscript = onTranscript || (() => {});
    this.onMode = onMode || (() => {});
    this.onLog = onLog || (() => {});
    this.mode = 'offline';
    this.pc = null;
    this.dc = null;
    this.mic = null;
    this.gazing = false;
    this.userSpeaking = false;
    this.releaseAt = 0;
    this.contextRole = 'system';
    this.aiTranscript = '';
  }

  setMode(m) {
    if (m === this.mode) return;
    this.mode = m;
    this.onMode(m);
  }

  // Voice levels (0..1) for the buddy orb animation.
  _level(an) {
    if (!an) return 0;
    const buf = this._buf || (this._buf = new Uint8Array(an.fftSize));
    an.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }
  outputLevel() {
    return this._level(this.outAnalyser);
  }
  micLevel() {
    return this.mic?.enabled ? this._level(this.micAnalyser) : 0;
  }
  _analyse(stream) {
    if (!this.actx) return null;
    try {
      const an = this.actx.createAnalyser();
      an.fftSize = 512;
      this.actx.createMediaStreamSource(stream).connect(an);
      return an;
    } catch {
      return null;
    }
  }

  // Call synchronously from a user tap (mic permission + iOS audio unlock).
  start(actx) {
    this.actx = actx || null;
    this.audio = document.createElement('audio');
    this.audio.autoplay = true;
    this.audio.setAttribute('playsinline', '');
    document.body.appendChild(this.audio);
    this.audio.play().catch(() => {});
    this.setMode('connecting');
    const micP = navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    return this._connect(micP).catch((e) => {
      this.onLog('error', `AI offline: ${e.message}`);
      this.setMode('offline');
    });
  }

  async _connect(micP) {
    const stream = await micP;
    this.mic = stream.getAudioTracks()[0];
    this.mic.enabled = false;
    this.micAnalyser = this._analyse(stream);

    const tokRes = await apiFetch('/api/realtime-token', { method: 'POST' });
    const tok = await tokRes.json();
    if (!tokRes.ok || !tok.value) throw new Error(tok.error || `token HTTP ${tokRes.status}`);
    this.onLog('info', `AI model: ${tok.model}`);

    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.ontrack = (e) => {
      this.audio.srcObject = e.streams[0];
      this.audio.play().catch((err) => this.onLog('warn', `audio play blocked: ${err.message}`));
      this.outAnalyser = this._analyse(e.streams[0]);
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
        this.onLog('error', `WebRTC ${pc.connectionState}`);
        this.setMode('offline');
      }
    };
    pc.addTrack(this.mic, stream);
    const dc = pc.createDataChannel('oai-events');
    this.dc = dc;
    dc.onmessage = (e) => this._handle(JSON.parse(e.data));
    dc.onopen = () => {
      this.setMode('idle');
      this.say('Greet the learner warmly in one short sentence. Say they can look at you any time to talk.');
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const sdpRes = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      body: offer.sdp,
      headers: { Authorization: `Bearer ${tok.value}`, 'Content-Type': 'application/sdp' },
    });
    if (!sdpRes.ok) throw new Error(`SDP HTTP ${sdpRes.status}: ${(await sdpRes.text()).slice(0, 200)}`);
    await pc.setRemoteDescription({ type: 'answer', sdp: await sdpRes.text() });
  }

  get ready() {
    return this.dc?.readyState === 'open';
  }

  send(obj) {
    if (this.ready) this.dc.send(JSON.stringify(obj));
  }

  // Ask the buddy to speak, guided by an instruction (not shown to the learner).
  // The API refuses a new response while one is active, so while the buddy is generating or
  // still talking we keep the latest instruction and send it as soon as the buddy is quiet.
  // Only the latest one is kept: an older hint is out of date by then.
  say(instructions) {
    if (!this.ready) return;
    const now = performance.now();
    const busy = this.busy && now - this.busySince < 15000;
    const playing = this.playing && now - this.playingSince < 30000;
    if (busy || playing) {
      this.pending = instructions;
      return;
    }
    this._sendSay(instructions);
  }

  _sendSay(instructions) {
    this.busy = true;
    this.busySince = performance.now();
    this.send({ type: 'response.create', response: { instructions } });
  }

  _flush() {
    if (!this.pending || this.busy || this.playing) return;
    const next = this.pending;
    this.pending = null;
    this._sendSay(next);
  }

  // Tell the buddy what is happening in the app (ground truth from the scenario engine).
  context(text) {
    this.send({
      type: 'conversation.item.create',
      item: { type: 'message', role: this.contextRole, content: [{ type: 'input_text', text: `[APP CONTEXT] ${text}` }] },
    });
  }

  // Gaze-to-talk: call every frame with whether the learner is looking at the buddy.
  setGaze(on) {
    const now = performance.now();
    if (on) this.releaseAt = now + 1500;
    this.gazing = on;
    const listen = this.ready && (on || this.userSpeaking || now < this.releaseAt);
    if (this.mic && this.mic.enabled !== listen) this.mic.enabled = listen;
    if (this.mode === 'idle' && listen) this.setMode('listening');
    else if (this.mode === 'listening' && !listen) this.setMode('idle');
  }

  _handle(ev) {
    switch (ev.type) {
      case 'input_audio_buffer.speech_started':
        this.userSpeaking = true;
        break;
      case 'input_audio_buffer.speech_stopped':
        this.userSpeaking = false;
        this.releaseAt = performance.now() + 600;
        break;
      case 'response.created':
        this.busy = true;
        this.busySince = performance.now();
        this.setMode('speaking');
        break;
      case 'output_audio_buffer.started':
        this.playing = true;
        this.playingSince = performance.now();
        this.setMode('speaking');
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.playing = false;
        this.setMode(this.mic?.enabled ? 'listening' : 'idle');
        this._flush();
        break;
      case 'response.done':
        this.busy = false;
        if (this.mode === 'speaking' && !this._audioEvents) this.setMode('idle');
        this._flush();
        break;
      case 'response.output_audio_transcript.done':
        if (ev.transcript) this.onTranscript('buddy', ev.transcript);
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (ev.transcript) this.onTranscript('learner', ev.transcript);
        break;
      case 'error': {
        const msg = ev.error?.message || JSON.stringify(ev.error);
        if (/role/i.test(msg) && this.contextRole === 'system') this.contextRole = 'user';
        this.onLog('error', `AI: ${msg}`);
        break;
      }
    }
    if (ev.type === 'output_audio_buffer.started') this._audioEvents = true;
  }
}
