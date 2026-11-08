// Offline voice for the AI buddy: every line the buddy may need, recorded once as a small mp3.
// When the live AI voice is not available (no internet, no OpenAI credit, busy), the phone plays
// these instead, so the learner still hears the hints, the calm-down lines and the praise.
//
//   npm run voice:gen        (needs GEMINI_API_KEY and ffmpeg; skips lines that already exist)
//
// The lines are built from the same scenario data as the app (station names, hint texts), so they
// always match the trip. Output: client/assets/voice/*.mp3 + lines.json (committed: needed offline).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTrip, initialState, fill, textVars, STEPS } from '../shared/engine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'client', 'assets', 'voice');
const VOICE = process.env.VOICE_NAME || 'Sulafat'; // a warm Gemini voice
// 2.5 follows the style instruction without reading it aloud; 3.8 sometimes reads it (see below)
const MODELS = ['gemini-2.5-flash-preview-tts', 'gemini-3.8-flash-tts'];
const STYLE = 'Say this in a warm, calm, friendly voice, a little slowly and very clearly, to a young person who is learning to travel by metro alone:';

const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

export function buildLines() {
  const data = { network: read('data/city/baku/network.json'), rules: read('data/city/baku/rules.json'), scenario: read('data/scenario/metro-trip.json') };
  const trip = createTrip(data);
  const vars = textVars(trip, initialState(trip), 'en');
  const to = trip.to.name_en;
  const lines = {
    greet: "Hi! I'm your travel buddy. Look at me any time if you need help.",
    hello: 'Hello! How are you feeling today?',
    calm: "Let's take one slow breath together. In... and out. You're doing well. Ready to go on?",
    'praise:direction': "Great choice! That's the right way.",
    'praise:arrived': `You did it! You arrived at ${to}. Well done!`,
    'err:insufficient_balance': "That's okay. The card does not have enough money yet. Let's top it up at the machine on the left.",
    'err:card_not_read': 'That happens sometimes. Hold the card still on the reader, and try again.',
    'err:wrong_direction': `That's okay. Read the station names on the signs, and find ${to}.`,
    'err:exit_too_early': `Not yet. Listen to the announcements. We get off at ${to}.`,
    'err:missed_stop': "We passed our stop. That's okay, it happens to everyone. Let's get off here and take the train back.",
    'ride:get_ready': `The next station is ${to}. Get ready to get off.`,
    'ride:return': `Now we take the train back to ${to}. Well done for staying calm.`,
    'fault:delay': "The train is a little late. That's okay. We can wait here together. Let's take one slow breath.",
    'fault:crowd': "It's busy and noisy here. Let's breathe together. In for four... and out for four. You're doing well.",
  };
  for (const [i, def] of data.scenario.steps.entries()) {
    def.hints.forEach((h, j) => {
      lines[`hint:${STEPS[i]}:${j + 1}`] = fill(h, vars);
    });
  }
  return lines;
}

const fileFor = (key, text) => `${key.replace(/[^a-z0-9]+/gi, '-')}-${crypto.createHash('sha1').update(VOICE + '|' + text).digest('hex').slice(0, 8)}.mp3`;

async function tts(text) {
  let last = null;
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${STYLE} ${text}` }] }],
            generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } } },
          }),
          signal: AbortSignal.timeout(60000),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(`${r.status} ${j.error?.message?.slice(0, 80)}`);
        const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
        if (!part) throw new Error('no audio in the answer');
        return { model, mime: part.mimeType, data: Buffer.from(part.data, 'base64') };
      } catch (e) {
        last = `${model}: ${e.message}`;
        await new Promise((res) => setTimeout(res, 2000 * attempt));
      }
    }
  }
  throw new Error(last);
}

// gemini-3.8-flash-tts sometimes reads the style instruction aloud before the line (about 10 s,
// then a pause). If a clip is much longer than its words need, cut at the pause closest to where
// the line should start (total length minus about 0.45 s per word).
export function stripSpokenInstruction(file, text) {
  const dur = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
  const words = text.split(/\s+/).length;
  if (dur / words <= 0.8) return false;
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-40dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8' });
  const pauses = [...r.stderr.matchAll(/silence_end: ([0-9.]+) \| silence_duration: ([0-9.]+)/g)].map((m) => ({ end: +m[1], start: +m[1] - +m[2] }));
  const target = dur - words * 0.45;
  const cut = pauses.filter((p) => p.start > 5).sort((a, b) => Math.abs(a.end - target) - Math.abs(b.end - target))[0];
  if (!cut) return false;
  const tmp = file.replace(/\.mp3$/, '.cut.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(Math.max(0, cut.end - 0.12)), '-i', file, '-ac', '1', '-ar', '24000', '-b:a', '48k', tmp]);
  fs.renameSync(tmp, file);
  return true;
}

function toMp3(audio, outFile) {
  const tmp = outFile + '.tmp';
  fs.writeFileSync(tmp, audio.data);
  // wav has a header; raw "audio/L16;...rate=24000" needs the format spelled out
  const raw = /L16|pcm/i.test(audio.mime) && !/wav/i.test(audio.mime);
  const rate = /rate=(\d+)/.exec(audio.mime)?.[1] || '24000';
  const input = raw ? ['-f', 's16le', '-ar', rate, '-ac', '1', '-i', tmp] : ['-i', tmp];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...input, '-ac', '1', '-ar', '24000', '-b:a', '48k', outFile]);
  fs.rmSync(tmp);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.loadEnvFile(path.join(ROOT, '.env'));
  } catch {}
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY is missing in .env');
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const lines = buildLines();
  const manifest = { voice: VOICE, note: 'Generated by tools/gen-voice.js with Gemini text-to-speech. Played when the live AI voice is not available.', lines: {} };
  let made = 0;
  const missing = [];
  for (const [key, text] of Object.entries(lines)) {
    const file = fileFor(key, text);
    const full = path.join(OUT, file);
    if (!fs.existsSync(full)) {
      try {
        const audio = await tts(text);
        toMp3(audio, full);
        if (stripSpokenInstruction(full, text)) console.log(`[voice] ${key}: removed the spoken instruction`);
        made += 1;
        console.log(`[voice] ${key.padEnd(26)} ${audio.model}  ${Math.round(fs.statSync(full).size / 1024)} KB`);
      } catch (e) {
        // keep going; the phone speaks a missing line with its own speech engine
        missing.push(key);
        console.warn(`[voice] ${key.padEnd(26)} NOT recorded: ${e.message.slice(0, 120)}`);
        manifest.lines[key] = { text, file: null };
        continue;
      }
    }
    manifest.lines[key] = { text, file };
  }
  // remove recordings of lines that no longer exist
  const keep = new Set(Object.values(manifest.lines).map((l) => l.file).filter(Boolean));
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.mp3') && !keep.has(f)) fs.rmSync(path.join(OUT, f));
  fs.writeFileSync(path.join(OUT, 'lines.json'), JSON.stringify(manifest, null, 2) + '\n');
  const total = [...keep].reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
  console.log(`[voice] ${Object.keys(lines).length} lines (${made} new), ${Math.round(total / 1024)} KB -> client/assets/voice/`);
  if (missing.length) {
    console.warn(`[voice] ${missing.length} lines are not recorded yet (${missing.join(', ')}). Run the script again later.`);
    process.exitCode = 1;
  }
}
