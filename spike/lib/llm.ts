/**
 * Minimal LLM call for the planner. Uses whichever key is in .env:
 *   ANTHROPIC_API_KEY (default model claude-sonnet-5-5) or OPENAI_API_KEY (default gpt-4.1).
 * Override the model with PLANNER_MODEL. No SDKs: plain fetch.
 */
import 'dotenv/config';

export async function complete(system: string, user: string): Promise<string> {
  // Test hook: replay a canned reply instead of calling a model.
  if (process.env.PLANNER_FAKE_REPLY) {
    const { readFileSync } = await import('node:fs');
    return readFileSync(process.env.PLANNER_FAKE_REPLY, 'utf8');
  }
  const model = process.env.PLANNER_MODEL?.trim();
  if (process.env.ANTHROPIC_API_KEY) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: model || 'claude-sonnet-5-5', max_tokens: 16000, system, messages: [{ role: 'user', content: user }] }),
    });
    const json = (await res.json()) as { content?: { type: string; text?: string }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${json.error?.message ?? JSON.stringify(json)}`);
    return (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  }
  if (process.env.OPENAI_API_KEY) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: model || 'gpt-4.1',
        response_format: { type: 'json_object' },
        temperature: 0.2,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };
    if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${json.error?.message ?? JSON.stringify(json)}`);
    return json.choices?.[0]?.message?.content ?? '';
  }
  throw new Error('No LLM key: add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env');
}

/** Pull the first JSON object out of a model reply (handles ```json fences). */
export function parseJsonReply<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(raw) as T;
}
