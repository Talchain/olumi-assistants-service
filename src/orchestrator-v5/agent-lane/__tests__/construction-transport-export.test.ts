/**
 * The construction transport is exported so an evaluation harness drives THE SERVED call, never a side client
 * (DL 5 Oct, live 3×3: "utilise the OpenAI harness"). Two rows:
 *  1. the exported transport sends exactly the served request bytes (Responses API, strict `whole_candidate` schema);
 *  2. the route's `callStructured` IS that export, and the route holds no second construction transport.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROUTE = new URL('../../../routes/agent-v1-turn.ts', import.meta.url);

afterEach(() => { vi.unstubAllGlobals(); });

describe('construction transport export', () => {
  it('sends the served request bytes: model, instructions, input, cap, effort and the strict whole_candidate schema', async () => {
    const seen: { url: string; body: string }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { body?: unknown }) => {
      seen.push({ url, body: String(init.body) });
      return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] }], usage: { output_tokens: 3 } }), { status: 200 });
    }));
    const { constructionCallStructured } = await import('../../../routes/agent-v1-turn.js');
    const { runWithProviderPolicy, OPENAI_ONLY } = await import('../../../adapters/llm/provider-policy.js');
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
    const out = await runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), () => constructionCallStructured(
      { model: 'gpt-test', instructions: 'INSTRUCTIONS', input: 'BRIEF', max_output_tokens: 1234, reasoning_effort: 'low', schema } as never,
      Date.now() + 60_000,
    ));
    expect(out.text).toBe('{"ok":true}');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://api.openai.com/v1/responses');
    // Byte-for-byte: key order is the served object literal's.
    expect(seen[0]!.body).toBe(JSON.stringify({
      model: 'gpt-test', instructions: 'INSTRUCTIONS', input: 'BRIEF', max_output_tokens: 1234,
      reasoning: { effort: 'low' },
      text: { format: { type: 'json_schema', name: 'whole_candidate', strict: true, schema } },
    }));
  }, 120_000); // the route module's cold import is the slow part

  it('the route constructs through the export and holds no second construction transport', () => {
    const route = readFileSync(ROUTE, 'utf8');
    expect(route).toContain('const callStructured = constructionCallStructured;');
    expect(route.match(/name: 'whole_candidate'/g)).toHaveLength(1);
    expect(route.match(/export const constructionCallStructured = async \(/g)).toHaveLength(1);
  });
});
