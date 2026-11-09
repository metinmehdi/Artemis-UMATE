// Real-trip guide: "Show Buddy". The learner takes a photo of what confuses them (a machine, a sign,
// a turnstile) and gets two calm sentences back. Gemini sees the photo and the trip facts only;
// the photo is not stored anywhere. Without Gemini a safe, fixed answer is returned.
import { geminiGenerate } from './gemini.js';

export const PHOTO_FALLBACK = 'I cannot see the photo right now. Tap Remind me for the steps, or ask a metro worker in uniform.';
const MAX_BASE64 = 1_400_000; // about 1 MB of JPEG; the app sends about 100 KB

const SYSTEM = [
  'You help a young person with autism or an intellectual disability who is in the real Baku Metro right now.',
  'They took a photo of something they are unsure about. Look at the photo and the trip facts.',
  'Answer in English with at most 2 very short, calm sentences (max 12 words each).',
  'Say what the thing is, then the one next action. Concrete words, no idioms.',
  'Use only the trip facts given; never invent station names, prices or times. If the photo is unclear, say so kindly and suggest asking a metro worker in uniform.',
  'Safety first: never suggest going near the tracks or crossing the yellow line.',
].join(' ');

/** Checks the request body; returns an error message or null. */
export function checkPhoto(body) {
  const image = String(body?.image || '');
  if (!image) return 'image required';
  if (image.length > MAX_BASE64) return 'image too large';
  if (!/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) return 'image must be base64 JPEG';
  return null;
}

/**
 * @param {{image: string, step?: object, trip?: object}} body  image = base64 JPEG (no data: prefix)
 */
export async function askPhoto(body) {
  const facts = {
    step: body.step ? { id: String(body.step.id || ''), title: String(body.step.title || '').slice(0, 120) } : null,
    trip: body.trip ? { from: String(body.trip.from || '').slice(0, 60), to: String(body.trip.to || '').slice(0, 60), towards: String(body.trip.towards || '').slice(0, 60) } : null,
  };
  if (!process.env.GEMINI_API_KEY) return { text: PHOTO_FALLBACK, model: null, fallback: 'no Gemini key' };
  try {
    const { text, model } = await geminiGenerate({
      system: SYSTEM,
      parts: [{ inlineData: { mimeType: 'image/jpeg', data: body.image } }, { text: `Trip facts (JSON): ${JSON.stringify(facts)}\nWhat is this, and what should I do now?` }],
      maxTokens: 1024,
      temperature: 0.3,
    });
    return { text, model, fallback: null };
  } catch (e) {
    return { text: PHOTO_FALLBACK, model: null, fallback: e.message };
  }
}
