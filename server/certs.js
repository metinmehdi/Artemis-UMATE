// Local HTTPS certificates.
// A local CA is created once (certs/ca.crt) and installed on the phones one time.
// The server certificate is re-issued automatically whenever the laptop's LAN IPs change
// (new hotspot / Wi-Fi), so phones keep trusting it without reinstalling anything.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OPENSSL_CANDIDATES = [
  process.env.OPENSSL,
  'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'openssl',
].filter(Boolean);

function findOpenssl() {
  for (const c of OPENSSL_CANDIDATES) {
    try {
      execFileSync(c, ['version'], { stdio: 'ignore' });
      return c;
    } catch {}
  }
  throw new Error('openssl not found (install Git for Windows or set OPENSSL=path)');
}

const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Radmin|ZeroTier|Tailscale|Loopback|Docker/i;

// Real Wi-Fi / hotspot addresses first (192.168.x, 10.x), virtual adapters last.
export function lanIPs() {
  const rank = ({ name, address }) =>
    (VIRTUAL.test(name) ? 10 : 0) +
    (address.startsWith('192.168.') ? 0 : address.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(address) ? 2 : 3);
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, list]) => (list || []).map((i) => ({ name, ...i })))
    .filter((i) => i.family === 'IPv4' && !i.internal)
    .sort((a, b) => rank(a) - rank(b))
    .map((i) => i.address);
}

export function ensureCerts(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const openssl = findOpenssl();
  const run = (args) => execFileSync(openssl, args, { cwd: dir, stdio: 'pipe' });
  const file = (n) => path.join(dir, n);

  if (!fs.existsSync(file('ca.crt'))) {
    run([
      'req', '-x509', '-new', '-nodes', '-newkey', 'rsa:2048',
      '-keyout', 'ca.key', '-out', 'ca.crt', '-days', '825', '-sha256',
      '-subj', '/CN=UMATE Local CA',
      '-addext', 'basicConstraints=critical,CA:TRUE',
      '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
    ]);
  }

  const ips = ['127.0.0.1', ...lanIPs()];
  const want = [...ips].sort().join(',');
  let have = '';
  try {
    have = JSON.parse(fs.readFileSync(file('server.json'), 'utf8')).ips;
  } catch {}

  if (have !== want || !fs.existsSync(file('server.crt'))) {
    const san = ['DNS:localhost', ...ips.map((ip) => 'IP:' + ip)].join(',');
    fs.writeFileSync(
      file('ext.cnf'),
      [
        'basicConstraints=CA:FALSE',
        'keyUsage=critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage=serverAuth',
        `subjectAltName=${san}`,
        '',
      ].join('\n'),
    );
    run(['req', '-new', '-nodes', '-newkey', 'rsa:2048', '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=umate.local']);
    run([
      'x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial',
      '-out', 'server.crt', '-days', '397', '-sha256', '-extfile', 'ext.cnf',
    ]);
    fs.writeFileSync(file('server.json'), JSON.stringify({ ips: want }));
  }

  return {
    key: fs.readFileSync(file('server.key')),
    cert: fs.readFileSync(file('server.crt')),
    caPath: file('ca.crt'),
    ips: ips.filter((ip) => ip !== '127.0.0.1'),
  };
}
