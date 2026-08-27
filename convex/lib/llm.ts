/**
 * Minimal JSON-mode LLM client. Gemini Flash is the primary lane because this
 * runs over every earnings release for every watchlist name; Anthropic is the
 * fallback. Both are called with a strict schema and a temperature of 0 —
 * this is an extraction task, not a generation task.
 */

export type LlmResult<T> = { ok: true; value: T; model: string } | { ok: false; error: string };

const GEMINI_MODEL = "gemini-2.5-flash";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";

export async function extractJson<T>(args: {
  system: string;
  user: string;
  maxTokens?: number;
}): Promise<LlmResult<T>> {
  const { system, user, maxTokens = 1400 } = args;

  if (process.env.GEMINI_API_KEY) {
    try {
      return await gemini<T>(system, user, maxTokens);
    } catch (e) {
      if (!process.env.ANTHROPIC_API_KEY) {
        return { ok: false, error: `gemini: ${String(e)}` };
      }
    }
  }
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      return await anthropic<T>(system, user, maxTokens);
    } catch (e) {
      return { ok: false, error: `anthropic: ${String(e)}` };
    }
  }
  return { ok: false, error: "no LLM key configured (set GEMINI_API_KEY or ANTHROPIC_API_KEY)" };
}

function parseJson<T>(raw: string): T {
  // Models occasionally wrap JSON in a fenced block despite being told not to.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned) as T;
}

async function gemini<T>(system: string, user: string, maxTokens: number): Promise<LlmResult<T>> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": process.env.GEMINI_API_KEY as string,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: maxTokens,
          responseMimeType: "application/json",
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("empty gemini response");
  return { ok: true, value: parseJson<T>(text), model: GEMINI_MODEL };
}

async function anthropic<T>(system: string, user: string, maxTokens: number): Promise<LlmResult<T>> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      temperature: 0,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { content?: { text?: string }[] };
  const text = json.content?.map((c) => c.text ?? "").join("") ?? "";
  if (!text) throw new Error("empty anthropic response");
  return { ok: true, value: parseJson<T>(text), model: ANTHROPIC_MODEL };
}
