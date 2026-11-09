// Cloud build for Vercel: assembles the static site in public/ with the same URL layout as the
// laptop server, so the browser code does not care where it runs.
//
//   npm run build:web
//
//   public/vr, public/panel, public/assets   <- client/
//   public/shared                            <- shared/
//   public/data/city/baku, public/data/scenario  <- data/ (no session logs, no learners)
//   public/vendor/three/...                  <- the three.js files the app imports
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public');

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true });
  fs.cpSync(path.join(ROOT, from), path.join(OUT, to), { recursive: true });
};

fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['vr', 'panel', 'guide', 'assets']) copy(`client/${d}`, d);
copy('shared', 'shared');
copy('data/city/baku/network.json', 'data/city/baku/network.json');
copy('data/city/baku/rules.json', 'data/city/baku/rules.json');
copy('data/scenario', 'data/scenario');
for (const f of ['build/three.module.js', 'build/three.core.js', 'examples/jsm/effects/StereoEffect.js']) copy(`node_modules/three/${f}`, `vendor/three/${f}`);

let files = 0;
let bytes = 0;
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else {
      files += 1;
      bytes += fs.statSync(p).size;
    }
  }
};
walk(OUT);
console.log(`[build:web] ${files} files, ${(bytes / 1048576).toFixed(1)} MB -> public/`);
