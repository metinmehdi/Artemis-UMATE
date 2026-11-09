// GOLD layer: data/sessions/*.jsonl (real) + data/sample/sessions.jsonl (NÜMUNƏ) -> data/gold/
//
//   npm run data:gold               real + sample (every row says is_sample true/false)
//   npm run data:gold -- --real     real sessions only
//
// Writes each table as JSON and CSV (for Excel / Power BI), checks every key, and prints a summary.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildStar, checkKeys, parseJsonl } from '../shared/analytics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realOnly = process.argv.includes('--real');

export function readLogs(root = ROOT, { sample = true } = {}) {
  const files = [];
  const sesDir = path.join(root, 'data', 'sessions');
  if (fs.existsSync(sesDir)) for (const f of fs.readdirSync(sesDir)) if (f.endsWith('.jsonl')) files.push(path.join(sesDir, f));
  const sampleFile = path.join(root, 'data', 'sample', 'sessions.jsonl');
  if (sample && fs.existsSync(sampleFile)) files.push(sampleFile);
  let broken = 0;
  const lines = [];
  for (const f of files) {
    const r = parseJsonl(fs.readFileSync(f, 'utf8'));
    broken += r.broken;
    lines.push(...r.events);
  }
  return { lines, files: files.length, broken };
}

const csv = (rows) => {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const str = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v)); // nested values (help_by_step) as JSON
  const esc = (v) => (v === null || v === undefined ? '' : /[",\n]/.test(str(v)) ? `"${str(v).replace(/"/g, '""')}"` : str(v));
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n';
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { lines, files, broken } = readLogs(ROOT, { sample: !realOnly });
  const star = buildStar(lines);
  const problems = checkKeys(star);
  const out = path.join(ROOT, 'data', 'gold');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, rows] of [...Object.entries(star.dims), ...Object.entries(star.facts)]) {
    fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(rows, null, 1) + '\n');
    fs.writeFileSync(path.join(out, `${name}.csv`), csv(rows));
  }
  const s = star.facts.fact_session;
  console.log(`[gold] ${files} log files, ${lines.length} lines (${broken} broken) -> data/gold/`);
  console.log(`  sessions: ${s.length} (real ${s.filter((x) => !x.is_sample).length}, NÜMUNƏ ${s.filter((x) => x.is_sample).length}); opened but never started: ${star.quality.sessions_without_start}`);
  console.log(`  learners: ${star.dims.dim_learner.length}, step attempts: ${star.facts.fact_step_attempt.length}, challenges: ${star.facts.fact_fault.length}, real trips (guide): ${star.facts.fact_real_trip.length}`);
  if (problems.length) {
    for (const p of problems) console.error('  KEY ERROR:', p);
    process.exit(1);
  }
  console.log('  key check: OK');
}
