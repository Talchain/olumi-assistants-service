/**
 * #3594 LISTENER LEAK (CEE staging heap OOM ×3, 21 Oct 23:24Z / 23:34Z): every streamed call added an `abort` listener to its
 * request signal and never removed it, so Node kept each call's SSE text, request body and turn scope for the life of the
 * process (Render: memory per conversation roughly doubled since 1a67756c; a local repro grew about 1.15 MB per call).
 * A call that has ended must leave nothing on its signal.
 */
import { getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OPENAI_ONLY, runWithProviderPolicy } from '../provider-policy.js';
import { ledgeredAgentsClient } from '../openai-agents-client.js';
import { responsesSse, sseResponse } from '../../../orchestrator-v5/agent-lane/__tests__/stream-when-asked.js';

const RESPONSE = {
  id: 'resp_1', object: 'response', model: 'gpt-scripted-returned', status: 'completed',
  output: [{ id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
};

describe('the SDK client holds nothing once a streamed call has ended', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('⛔ a streamed call read to its end leaves no abort listener on its request signal, and is recorded', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { signal?: AbortSignal | null }) => {
      if (init?.signal) signals.push(init.signal);
      return sseResponse(responsesSse(RESPONSE), init);
    }));
    const pending: Promise<void>[] = [];
    const client = runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'),
      () => ledgeredAgentsClient({ site: 'core', pending, detailOf: () => ({ model: 'gpt-6.1-sol', purpose: 'test' }) as never }));
    const stream = await client.responses.create({ model: 'gpt-6.1-sol', input: 'x', stream: true });
    const types: string[] = [];
    for await (const event of stream) types.push(event.type);
    await Promise.all(pending);
    expect(types.at(-1), 'the stream was read to its terminal event').toBe('response.completed');
    expect(signals, 'one request, with a signal').toHaveLength(1);
    expect(getEventListeners(signals[0]!, 'abort'), 'nothing is left listening on an ended call').toHaveLength(0);
  });
});
