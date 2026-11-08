// WebSocket link to the laptop (auto-reconnect). Same module is used by the panel.
export class Net {
  constructor({ role, id, device, onMessage, onStatus }) {
    this.role = role;
    this.id = id;
    this.device = device;
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.connect();
  }

  connect() {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.onStatus(true);
      this.send({ type: 'hello', role: this.role, id: this.id, device: this.device });
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data));
      } catch {}
    };
    ws.onclose = () => {
      this.onStatus(false);
      setTimeout(() => this.connect(), 1000);
    };
    ws.onerror = () => ws.close();
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
