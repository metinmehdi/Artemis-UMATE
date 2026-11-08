// GET /api/config: tells the browser it runs in the cloud and how to reach Supabase Realtime.
// Only public values: the Supabase URL and the publishable (anon) key are meant for browsers.
import { send } from './_lib.js';

export default function handler(req, res) {
  send(res, 200, {
    mode: 'cloud',
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
    ai: { openai: !!process.env.OPENAI_API_KEY, gemini: !!process.env.GEMINI_API_KEY },
  });
}
