import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResponsesStreamObserver } from '../../../adapters/llm/openai-agents-client.js';
import { OPENAI_ONLY, runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';
import { responsesSse } from '../../agent-lane/__tests__/stream-when-asked.js';
import { draftCanonicalModel, draftRequestBody, ledgeredResponsesCall, type ResponsesCall } from '../draft.js';
import { DRAFTING_INSTRUCTIONS, todayLine } from '../prompt.js';
import { bakery, bakeryWithDefect, BRIEF } from './bakery.fixture.js';

type NativeEvent = Parameters<ResponsesStreamObserver>[0];
const event = (type: string, extra = {}): NativeEvent => ({ type, ...extra }) as NativeEvent;
const output = (model = bakery(), usage: unknown = { input_tokens_details: { cached_tokens: 768 } }) =>
  ({ text: JSON.stringify(model), status: 'completed', incomplete: null, usage });

describe('native draft observations are measurements, never model or UI progress', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('carries real SDK deltas and usage through the ledgered call into the draft attempt', async () => {
    const response = { id: 'resp_synthetic', object: 'response', model: 'gpt-6.1-sol', status: 'completed',
      output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(bakery()), annotations: [] }] }],
      usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 768 }, output_tokens: 100, total_tokens: 1100 } };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(responsesSse(response), { headers: { 'content-type': 'text/event-stream' } })));
    const policy = OPENAI_ONLY('agent_v1_turn');
    const draft = await runWithProviderPolicy(policy, () => draftCanonicalModel(BRIEF, ledgeredResponsesCall()));
    expect(draft.compiled?.errors).toEqual([]);
    expect(draft.attempts[0]?.observation).toEqual({ first_output_ms: expect.any(Number), response_ms: expect.any(Number), compile_ms: expect.any(Number), cached_input_tokens: 768 });
    expect(draft.attempts[0]!.observation.response_ms!).toBeGreaterThanOrEqual(draft.attempts[0]!.observation.first_output_ms!);
    expect(policy.calls).toHaveLength(1);
    expect(policy.calls[0]?.attempt?.outcome).toBe('success');
    expect(draft.model).toEqual(bakery());
  });

  it('separates the first nonempty delta, terminal response and compile; reads reported cache use', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(12).mockReturnValueOnce(40)
      .mockReturnValueOnce(50).mockReturnValueOnce(65);
    const call: ResponsesCall = async (_body, observe) => {
      observe?.(event('response.created'));
      observe?.(event('response.output_text.delta', { delta: '' }));
      observe?.(event('response.output_text.delta', { delta: '{' }));
      observe?.(event('response.output_text.delta', { delta: 'more' }));
      observe?.(event('response.completed'));
      return output();
    };
    const draft = await draftCanonicalModel(BRIEF, call);
    expect(draft.compiled?.errors).toEqual([]);
    expect(draft.attempts[0]?.observation).toEqual({ first_output_ms: 12, response_ms: 40, compile_ms: 15, cached_input_tokens: 768 });
    expect(draft.model).toEqual(bakery());
  });

  it('unobserved deltas and missing cache usage stay unknown, including on injected calls', async () => {
    const draft = await draftCanonicalModel(BRIEF, async () => output(bakery(), null));
    expect(draft.attempts[0]?.observation).toEqual({ first_output_ms: null, response_ms: null, compile_ms: expect.any(Number), cached_input_tokens: null });
  });

  it('retains partial-output evidence on a failed call without implying a response or compile', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValueOnce(9);
    const draft = await draftCanonicalModel(BRIEF, async (_body, observe) => {
      observe?.(event('response.output_text.delta', { delta: '{' }));
      throw Object.assign(new Error('synthetic'), { status: 503 });
    });
    expect(draft.model).toBeNull();
    expect(draft.attempts[0]?.provider_error?.status).toBe(503);
    expect(draft.attempts[0]?.observation).toEqual({ first_output_ms: 9, response_ms: null, compile_ms: null, cached_input_tokens: null });
  });

  it('keeps repair attempts separate and preserves the same stable request prefix as context changes', async () => {
    const bodies: unknown[] = [];
    const draft = await draftCanonicalModel(BRIEF, async (body, observe) => {
      bodies.push(body);
      observe?.(event('response.output_text.delta', { delta: '{' }));
      observe?.(event('response.completed'));
      return output(bodies.length === 1 ? bakeryWithDefect() : bakery(), { input_tokens_details: { cached_tokens: bodies.length === 1 ? 0 : 768 } });
    });
    expect(draft.attempts).toHaveLength(2);
    expect(draft.attempts.map((a) => a.observation.cached_input_tokens)).toEqual([0, 768]);
    expect(draft.compiled?.errors).toEqual([]);
    const first = draftRequestBody([{ role: 'user', content: 'first' }], false, '2026-10-26');
    const next = draftRequestBody([{ role: 'user', content: 'other' }], false, '2026-10-26');
    expect(first.instructions).toBe(`${DRAFTING_INSTRUCTIONS}\n\n${todayLine('2026-10-26')}`);
    expect(next.instructions).toBe(first.instructions);
    expect(next.text).toEqual(first.text);
    expect(next.input).not.toEqual(first.input);
  });
});
