// Append-only JSONL event log: one file per session in data/sessions/.
// This log is the source of truth; every number on the panel is computed from it.
import fs from 'node:fs';
import path from 'node:path';

export class EventLog {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  append(sessionId, event) {
    if (!sessionId || !/^[\w-]{4,64}$/.test(sessionId)) return;
    const line = JSON.stringify({ t: Date.now(), sessionId, ...event }) + '\n';
    fs.appendFile(path.join(this.dir, `${sessionId}.jsonl`), line, (err) => {
      if (err) console.error('[log] write failed', err.message);
    });
  }
}
