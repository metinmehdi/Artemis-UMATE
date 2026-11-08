// Public HTTPS link for phones through a free tunnel (no account needed).
// Why: venue Wi-Fi often blocks phone-to-laptop traffic, and installing a local certificate on
// every phone is slow. With a tunnel the phone opens a normal https:// link from any network (even
// mobile data); the laptop only makes an outgoing connection.
//
// Providers, in order (measured from the camp network on 2026-11-08):
//   1. Cloudflare quick tunnel: fastest, no time limit; needs cloudflared ($CLOUDFLARED, tools/bin/, PATH)
//   2. Pinggy over SSH: 30-140 KB/s, free links last 60 minutes (then a new link is opened)
//   3. localhost.run over SSH: works but only a few KB/s
// The SSH ones use the ssh client that ships with Windows 10/11, macOS and Linux.
// Both forward to the local plain-HTTP tunnel listener (127.0.0.1:<port>); the provider does HTTPS.
// If both fail, the server keeps working on the local Wi-Fi links.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function cloudflaredBinary(root) {
  const local = path.join(root, 'tools', 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  for (const c of [process.env.CLOUDFLARED, local]) if (c && fs.existsSync(c)) return c;
  return 'cloudflared'; // PATH
}

// Pinggy asks for a password (any answer works). Git's ssh sends an empty one when there is no
// terminal; the Windows ssh client waits for a console prompt instead, so Git's ssh is preferred.
function sshBinary() {
  const candidates = [process.env.SSH_BIN, 'C:\\Program Files\\Git\\usr\\bin\\ssh.exe', 'C:\\Program Files (x86)\\Git\\usr\\bin\\ssh.exe'];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return 'ssh';
}

const PROVIDERS = [
  {
    name: 'Cloudflare',
    cmd: (root) => cloudflaredBinary(root),
    args: (port) => ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`],
    url: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
  },
  {
    // free links end after 60 minutes; the server then opens a new one and the panel shows the new QR
    name: 'Pinggy',
    cmd: () => sshBinary(),
    args: (port) => [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes',
      '-p', '443',
      `-R0:127.0.0.1:${port}`,
      'a.pinggy.io',
    ],
    url: /https:\/\/[a-z0-9-]+\.free\.pinggy\.net/,
  },
  {
    // slowest of the three (a few KB/s in our test), last resort
    name: 'localhost.run',
    cmd: () => sshBinary(),
    args: (port) => [
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes',
      '-R', `80:127.0.0.1:${port}`,
      'nokey@localhost.run',
    ],
    url: /https:\/\/[a-z0-9-]+\.lhr\.life/, // the banner also shows admin.localhost.run: not the tunnel
  },
];

export function startTunnel({ root, port, onUrl, onDown }) {
  let child = null;
  let stopping = false;
  let failures = 0;

  const run = (i) => {
    const p = PROVIDERS[i % PROVIDERS.length];
    let found = false;
    const startedAt = Date.now();
    child = spawn(p.cmd(root), p.args(port), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    const scan = (buf) => {
      // the link can arrive split over two chunks and wrapped in terminal colour codes
      out = (out + buf.toString()).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').slice(-4000);
      const m = p.url.exec(out);
      if (m && !found) {
        found = true;
        failures = 0;
        onUrl(m[0], p.name);
      }
    };
    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    // a provider that gives no link within 25 s is treated as failed
    const giveUp = setTimeout(() => !found && child.kill(), 25_000);
    let ended = false;
    const next = (why) => {
      if (ended) return;
      ended = true;
      clearTimeout(giveUp);
      if (stopping) return;
      onDown(`${p.name}: ${why}`);
      failures += 1;
      if (failures > 9) return; // give up; the Wi-Fi links still work
      // a link that worked for a while is retried with the same provider, otherwise try the next one
      const same = found && Date.now() - startedAt > 60_000;
      setTimeout(() => run(same ? i : i + 1), 3000);
    };
    child.on('error', (e) => next(e.code === 'ENOENT' ? 'not installed' : e.message));
    child.on('exit', (code) => next(`exited (${code})`));
  };
  run(0);

  const stop = () => {
    stopping = true;
    child?.kill();
  };
  process.once('exit', stop);
  process.once('SIGINT', () => {
    stop();
    process.exit(0);
  });
  return { stop };
}
