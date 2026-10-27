/**
 * #3594 LISTENER LEAK (CEE staging heap OOM ×3, 21 Oct 23:24Z / 23:34Z): every streamed call added an `abort` listener to its
 * request signal and never removed it, so Node kept each call's SSE text, request body and turn scope for the life of the
 * process (Render: memory per conversation roughly doubled since 1a67756c; a local repro grew about 1.15 MB per call).
 * A call that has ended must leave nothing on its signal.
 */
import { getEventListeners } from 'node:events';
import OpenAI, { APIConnectionTimeoutError } from 'openai-v7';
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

  it('⛔ Codex r1 #3613: a streamed call whose body is never read still reaches its end: recorded, settled, nothing left listening', async () => {
    const signals: AbortSignal[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { signal?: AbortSignal | null }) => {
      if (init?.signal) signals.push(init.signal);
      return sseResponse(responsesSse(RESPONSE), init);
    }));
    const pending: Promise<void>[] = [];
    const client = runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'),
      () => ledgeredAgentsClient({ site: 'core', pending, detailOf: () => ({ model: 'gpt-6.1-sol', purpose: 'test' }) as never }));
    // The raw response is taken and dropped unread: no read, no cancel, no abort.
    await client.responses.create({ model: 'gpt-6.1-sol', input: 'x', stream: true }).asResponse();
    let settled = false;
    await Promise.race([Promise.all(pending).then(() => { settled = true; }), new Promise((resolve) => setTimeout(resolve, 500))]);
    expect(settled, 'the attempt settles without its consumer').toBe(true);
    expect(getEventListeners(signals[0]!, 'abort')).toHaveLength(0);
  });
});

/**
 * C14 BOUNDED OPERATION: the client's own timeout stops at the response's headers, and an idle timeout restarts on every chunk,
 * so a provider stream that keeps trickling and never ends held its turn (and its Conversation's slot) for ever. A streamed
 * call has one whole-time bound: the client's own timeout, from its request to the end of its stream.
 */
describe('C14: a streamed call ends within its timeout, however its stream trickles', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('⛔ C14: a stream that trickles for ever fails at the client timeout with its typed timeout: a timeout row, delivery unknown, the provider body cancelled, nothing left listening', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const enc = new TextEncoder();
    const ev = (o: Record<string, unknown>): Uint8Array => enc.encode(`event: ${String(o['type'])}\ndata: ${JSON.stringify(o)}\n\n`);
    const signals: AbortSignal[] = [];
    let chunks = 0;
    let bodyCancelled = false;
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { signal?: AbortSignal | null }) => {
      if (init?.signal) signals.push(init.signal);
      // A chunk every 10 s, for ever: never idle long enough for an idle timeout, and no terminal event ever comes.
      const body = new globalThis.ReadableStream<Uint8Array>({
        start(c) { c.enqueue(ev({ type: 'response.created', sequence_number: 0, response: { ...RESPONSE, status: 'in_progress', output: [] } })); },
        pull(c) {
          return new Promise<void>((resolve) => { setTimeout(() => { if (bodyCancelled) { resolve(); return; } chunks += 1;
            c.enqueue(ev({ type: 'response.output_text.delta', sequence_number: chunks, item_id: 'msg_1', output_index: 0, content_index: 0, delta: '.' })); resolve(); }, 10_000); });
        },
        cancel() { bodyCancelled = true; },
      });
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }));
    const policy = OPENAI_ONLY('agent_v1_turn');
    const unknown: unknown[] = [];
    let outcome: unknown = 'still streaming';
    await runWithProviderPolicy(policy, async () => {
      const pending: Promise<void>[] = [];
      const client = ledgeredAgentsClient({ site: 'agent-core.sdk', pending, conversationBound: true, onDeliveryUnknown: (cause) => { unknown.push(cause); },
        detailOf: () => ({ model: 'gpt-6.1-sol', purpose: 'conversation' }) as never });
      const stream = await client.responses.create({ model: 'gpt-6.1-sol', input: 'x', stream: true });
      // The SDK's own read of the stream: every event, until it ends or fails.
      void (async () => { for await (const event of stream) void event; })().then(() => { outcome = 'ended'; }, (err: unknown) => { outcome = err; });
      try {
        await vi.advanceTimersByTimeAsync(OpenAI.DEFAULT_TIMEOUT - 30_000);
        expect(outcome, 'inside its timeout the call still runs').toBe('still streaming');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(outcome, 'past its timeout the call has failed, with the client\'s own typed timeout').toBeInstanceOf(APIConnectionTimeoutError);
      } finally {
        if (outcome === 'still streaming') stream.controller.abort();
        await vi.advanceTimersByTimeAsync(0);
        await Promise.all(pending);
      }
    });
    expect(chunks, 'it trickled throughout').toBeGreaterThan(50);
    expect(policy.calls.map((c) => c.attempt?.outcome), 'its one attempt is recorded as a timeout').toEqual(['timeout']);
    expect(unknown, 'a Conversation call cut mid-stream leaves its delivery unknown (the turn\'s own unknown)').toHaveLength(1);
    expect(bodyCancelled, 'the provider\'s stream is cancelled, not left running').toBe(true);
    expect(getEventListeners(signals[0]!, 'abort'), 'nothing is left listening on the ended call').toHaveLength(0);
  });
});
