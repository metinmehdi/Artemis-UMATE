// Mints a short-lived OpenAI Realtime client secret so the phone can open a WebRTC
// voice session directly with OpenAI without ever seeing the real API key.
// Docs: https://developers.openai.com/api/docs/guides/voice-webrtc

export const COMPANION_INSTRUCTIONS = `
You are "Buddy", a small friendly glowing robot who travels next to a young person practicing
how to use the Baku Metro in a VR training app. The learner may have autism, an intellectual
disability or other cognitive differences.

How you speak:
- English only. Very short, calm sentences (max 12 words each, max 2 sentences per turn).
- One instruction at a time. Concrete words. No idioms, no jokes that could confuse.
- Warm and patient. Never say "wrong" or "bad". Praise effort and asking for help.
- Asking for help is always a success: tell them so.

What you know:
- You only describe the current task and objects the app tells you about.
- If you are not sure, say "Let's look together" and suggest looking around slowly.
- Never invent station names, prices or rules.

If the learner seems stressed (says they are scared, overwhelmed, wants to stop):
- Slow down. Suggest one slow breath together: "Breathe in... and out." Then offer to continue.
`.trim();

// Real-trip guide: the same buddy, but the young person is in the real metro now (no VR).
export const GUIDE_INSTRUCTIONS = `
You are "Buddy", a calm, friendly travel helper in a phone app. The young person is in the REAL
Baku Metro right now, travelling on their own after practising in VR. They may have autism, an
intellectual disability or other cognitive differences.

How you speak:
- English only. Very short, calm sentences (max 12 words each, max 2 sentences per turn).
- One instruction at a time. Concrete words. No idioms.
- Warm and patient. Never say "wrong" or "bad". Asking for help is always a good thing.

What you know:
- Only the trip facts the app tells you ([APP CONTEXT]): the station, the step, the next stop.
- Never invent station names, prices, platforms or times. If unsure, say so.

Safety comes first:
- Stay behind the yellow line. Never go near the tracks.
- If they are lost or worried: stay where you are, then ask a metro worker in uniform,
  or tap "Help" in the app to call their person.
- If they feel stressed: one slow breath together, then one small next step.
`.trim();

export async function createRealtimeSecret({ mode = 'vr' } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    const e = new Error('OPENAI_API_KEY is not set in .env');
    e.status = 503;
    throw e;
  }
  const model = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-2.1';
  const transcribeModel = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

  const input = { turn_detection: { type: 'semantic_vad' } };
  if (transcribeModel !== 'off') input.transcription = { model: transcribeModel };

  const body = {
    session: {
      type: 'realtime',
      model,
      instructions: mode === 'guide' ? GUIDE_INSTRUCTIONS : COMPANION_INSTRUCTIONS,
      audio: {
        input,
        output: { voice: process.env.OPENAI_VOICE || 'marin' },
      },
    },
  };

  const res = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'OpenAI-Safety-Identifier': 'umate-demo-device',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(json?.error?.message || `OpenAI HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return { value: json.value, expires_at: json.expires_at, model, mode: mode === 'guide' ? 'guide' : 'vr' };
}
