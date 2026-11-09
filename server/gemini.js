// One Gemini call with fallbacks, shared by the trainer report and the guide's photo help.
// Tries the configured model first, then newer to older Flash models. A model that answers with an
// error, an empty text or a cut-off answer counts as failed, and the next one is tried.
export const geminiModels = () => [process.env.GEMINI_MODEL, 'gemini-3.5-flash', 'gemini-2.5-flash', 'gemini-flash-latest'].filter(Boolean);

/**
 * @param {{system: string, parts: object[], maxTokens?: number, temperature?: number, timeoutMs?: number}} req
 * @returns {Promise<{text: string, model: string}>} throws when no model could answer
 */
export async function geminiGenerate({ system, parts, maxTokens = 2048, temperature = 0.4, timeoutMs = 20000 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('no Gemini key');
  let lastError = 'no model tried';
  for (const model of geminiModels()) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature,
            // thinking tokens count against the output limit; these short answers need little thinking
            maxOutputTokens: maxTokens,
            thinkingConfig: /^gemini-2\./.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' },
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
      const cand = j.candidates?.[0];
      if (cand?.finishReason && cand.finishReason !== 'STOP') throw new Error(`stopped: ${cand.finishReason}`);
      const text = cand?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      if (!text) throw new Error('empty answer');
      return { text, model: j.modelVersion || model };
    } catch (e) {
      lastError = `${model}: ${e.message}`;
    }
  }
  throw new Error(lastError);
}
