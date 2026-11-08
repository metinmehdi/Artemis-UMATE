// Run the cloud version on this computer, the way Vercel runs it: the static site from public/ and
// the functions from api/, with the keys from .env and the real Supabase project.
//
//   npm run dev:cloud        -> http://localhost:3000/panel/
//
// Only for testing before a deploy; the stage demo uses Vercel (or the laptop server as a backup).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.DEV_PORT) || 3000;
try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {}
execFileSync(process.execPath, [path.join(ROOT, 'tools', 'build-web.js')], { stdio: 'inherit' });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const name = url.pathname.slice(5).replace(/\/$/, '');
        const file = path.join(ROOT, 'api', `${name}.js`);
        if (!/^[a-z-]+$/.test(name) || !fs.existsSync(file)) {
          res.writeHead(404);
          return res.end('no such function');
        }
        const mod = await import(pathToFileURL(file).href);
        return await mod.default(req, res);
      }
      if (url.pathname === '/') {
        res.writeHead(302, { Location: '/panel/' });
        return res.end();
      }
      let file = path.join(PUBLIC, decodeURIComponent(url.pathname));
      if (!file.startsWith(PUBLIC)) throw new Error('bad path');
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) {
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.writeHead(500);
      res.end('error');
    }
  })
  .listen(PORT, () => console.log(`[dev:cloud] http://localhost:${PORT}/panel/  (Supabase: ${process.env.SUPABASE_URL ? 'configured' : 'MISSING'})`));
