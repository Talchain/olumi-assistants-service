/**
 * ⭐ PATH-B: an ordinary `core` turn on the OpenAI Agents SDK (`core/sdk-turn.ts`). The SDK runs the loop; these rows pin
 * what Olumi keeps around it: the witness on every provider row (returned model, tools sent, input digest), ONE durable
 * OpenAI Conversation per scenario, the turn's state given fresh on every call (never stored), the approval pause and its
 * resume from the saved RunState, streaming and the trace. Scripted provider (global fetch), fake adapters; SYNTHETIC
 * wording; 0 provider calls.
 */
import { createRequire } from 'node:module';
import { setTraceProcessors, setTracingDisabled, tool, type Span, type Trace } from '@openai/agents';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z as z4 } from 'zod-v4';
import { ForbiddenProviderError, OPENAI_ONLY, recordedProviderCalls, runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';
import { ledgeredAgentsClient } from '../../../adapters/llm/openai-agents-client.js';
import { runWithStageStream } from '../../../cee/unified-pipeline/stage-stream-context.js';
import { acquireCoreTurnSlot, AGENTS_SDK, CoreDeliveryUnknownError, CORE_COMPACT_THRESHOLD, corePromptCacheKey, CoreStateUnavailableError, PAUSE_DECLINED, PAUSE_SUPERSEDED, replyOnlyTurn, runCoreTurn, STATE_BLOCK_PREFIX, type ConversationIdStore, type CoreToolRecorder, type PausedRunStore } from '../core/sdk-turn.js';
import type { OpenAiPausedRun } from '../../session/store.js';
import { budgetFor, type CallBudget } from '../model-budgets.js';
import type { AgentToolContext } from '../runtime/agent-tools.js';
import { streamWhenAsked } from './stream-when-asked.js';

type Json = Record<string, any>;
const PID = `prop_${'a'.repeat(32)}`;
const RETURNED_MODEL = 'gpt-scripted-returned';
const SCENARIO = '0b6f2c1e-7d4a-4c8e-9f21-5a3b7c9d1e00';
const ctx = (message: string): AgentToolContext => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: `req-${message.length}`,
  verified_user_messages: [message], user_turn_text: message });

let scripted: Json[][] = [];
/** Every Responses request body, in order. */
const sent: Json[] = [];
/** Every Conversation the code created (request bodies). */
const created: Json[] = [];
/** Every item the code added to a Conversation directly (request bodies). */
const added: Json[] = [];
let served = 0;
/** The scenario store's saved Conversation ids (the `scenarios.openai_conversation_id` column), fresh per test. */
let column = new Map<string, string>();
const columnStore = (): ConversationIdStore => ({
  read: async (sid) => column.get(sid) ?? null,
  claim: async (sid, id) => { if (!column.has(sid)) column.set(sid, id); return column.get(sid)!; },
});
const body = (output: Json[]): Json => {
  served += 1;
  return {
    id: `resp_${served}`, object: 'response', model: RETURNED_MODEL, status: 'completed',
    output: output.map((item, i) => item.type === 'message'
      ? { id: `msg_${served}_${i}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: item.text, annotations: [] }] }
      : item.type === 'compaction' ? { id: `cmp_${served}_${i}`, type: 'compaction', encrypted_content: 'opaque' }
      : { id: `fc_${served}_${i}`, status: 'completed', type: 'function_call', call_id: `call_${served}_${i}`, name: item.name, arguments: JSON.stringify(item.args) }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  };
};
beforeEach(() => {
  scripted = []; sent.length = 0; created.length = 0; added.length = 0; column = new Map();
  vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
    if (/\/v1\/conversations\/[^/]+\/items$/.test(String(url))) {
      added.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      return new Response(JSON.stringify({ object: 'list', data: [], first_id: null, last_id: null, has_more: false }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (String(url).endsWith('/v1/conversations')) {
      created.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      return new Response(JSON.stringify({ id: `conv_${created.length}`, object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Json);
    return new Response(JSON.stringify(body(scripted.shift() ?? [{ type: 'message', text: 'Noted.' }])), { status: 200, headers: { 'content-type': 'application/json' } });
  })));
});
afterEach(() => { vi.unstubAllGlobals(); });

/** A fake adapter set: the canonical read only, which records its own row once as the typed adapters do. */
const caps = () => ({ read: vi.fn(async (): Promise<string> => JSON.stringify({ status: 'ok', mutated: false, ran: false, data: { empty: true } })) });
const readTools = (c: ReturnType<typeof caps>) => (onCall: CoreToolRecorder) => [tool({
  name: 'read_canonical_context', description: 'Read the saved scenario as it stands now.', parameters: z4.object({}),
  execute: async () => {
    const out = await c.read();
    onCall({ name: 'read_canonical_context', ok: true, mutated: false, outcome: 'ok', refusal: null, ran: null }, { ok: true, mutated: false });
    return out;
  },
  errorFunction: null,
})];
type Extra = { briefText?: string; conversationStore?: ConversationIdStore; state?: unknown; tools?: Parameters<typeof runCoreTurn>[0]['tools'];
  pausedRunStore?: PausedRunStore; press?: { decision: 'approve' | 'decline'; proposal_id: string }; replyBudget?: CallBudget; firstTool?: string;
  withheldTools?: readonly string[]; scenarioId?: string; instructions?: string };
const turn = (message: string, c: ReturnType<typeof caps>, extra: Extra & { traceMeta?: { revision?: string; run_id?: string } } = {}) =>
  runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), async () => {
  const result = await runCoreTurn({ ctx: { ...ctx(message), scenario_id: extra.scenarioId ?? SCENARIO }, message, tools: extra.tools ?? readTools(c),
    instructions: extra.instructions ?? 'Synthetic instructions.', budget: budgetFor('gpt-6.1-sol', 'conversation'), userId: null,
    canonicalState: extra.state ?? { empty: true, entities: [] }, briefText: extra.briefText, conversationStore: 'conversationStore' in extra ? extra.conversationStore : columnStore(),
    ...(extra.pausedRunStore !== undefined ? { pausedRunStore: extra.pausedRunStore } : {}),
    ...(extra.press !== undefined ? { press: extra.press } : {}), ...(extra.traceMeta !== undefined ? { traceMeta: extra.traceMeta } : {}),
    ...(extra.replyBudget !== undefined ? { replyBudget: extra.replyBudget } : {}), ...(extra.firstTool !== undefined ? { firstTool: extra.firstTool } : {}),
    ...(extra.withheldTools !== undefined ? { withheldTools: extra.withheldTools } : {}) });
  return { result, calls: recordedProviderCalls() };
});


/**
 * The tools a request lets the model call (DL 22 Oct, the caching split): the ONE fixed list is always sent, so what a turn
 * withholds is told by `tool_choice` — a forced call names its one tool, `allowed_tools` lists the rest — never by its absence.
 */
const callable = (b: Record<string, any>): string[] => {
  const choice = b.tool_choice as Record<string, any> | string | undefined;
  if (choice !== null && typeof choice === 'object' && choice.type === 'function') return [String(choice.name)];
  if (choice !== null && typeof choice === 'object' && choice.type === 'allowed_tools') return (choice.tools as Record<string, any>[]).map((t) => String(t.name)).sort();
  return ((b.tools ?? []) as Record<string, any>[]).map((t) => String(t.name)).sort();
};

describe('PATH-B core turn on the Agents SDK', () => {
  it('WITNESS: each provider row carries the returned model, the tools sent and an input digest; the turn names its SDK and trace', async () => {
    scripted = [[{ type: 'function_call', name: 'read_canonical_context', args: {} }], [{ type: 'message', text: 'The model is empty.' }]];
    const { result, calls } = await turn('What is in my model?', caps());
    expect(result.sdk.runtime).toBe(AGENTS_SDK);
    expect(result.sdk.state).toBe('openai_conversation');
    expect(result.sdk.conversation_id).toBe('conv_1');
    // Native compaction is requested on every call; the threshold is on the wire for the witness.
    expect(sent[0]!.context_management).toEqual([{ type: 'compaction', compact_threshold: CORE_COMPACT_THRESHOLD }]);
    // The SDK's own trace id (tests run with tracing off, so the SDK reports its no-op trace).
    expect(result.sdk.trace_id).toBe('no-op');
    expect(calls).toHaveLength(2);
    for (const row of calls) {
      expect(row.site).toBe('agent-core.sdk');
      expect(row.model, 'requested').toBe('gpt-6.1-sol');
      expect(row.returned_model, 'returned').toBe(RETURNED_MODEL);
      expect(row.tool_names, 'the adapters are the tools sent').toEqual(['read_canonical_context']);
      expect(row.input_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(calls[0]!.input_sha256, 'the second call sent more (the tool result)').not.toBe(calls[1]!.input_sha256);
    expect(sent[0]!.model).toBe('gpt-6.1-sol');
  });

  it('STREAM: on the streamed entry the SDK streams; "writing" is shown only once the AI\'s first words arrive; each row is recorded when its stream ends', async () => {
    /** The Responses SSE stream for one scripted body: created → each item (text as a delta) → completed. */
    const sse = (resp: Json): string => {
      const ev = (o: Json) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
      let out = ev({ type: 'response.created', sequence_number: 0, response: { ...resp, status: 'in_progress', output: [] } });
      (resp.output as Json[]).forEach((item, i) => {
        out += ev({ type: 'response.output_item.added', output_index: i, item: item.type === 'message' ? { ...item, status: 'in_progress', content: [] } : item });
        if (item.type === 'message') out += ev({ type: 'response.output_text.delta', item_id: item.id, output_index: i, content_index: 0, delta: item.content[0].text });
        out += ev({ type: 'response.output_item.done', output_index: i, item });
      });
      return out + ev({ type: 'response.completed', response: resp });
    };
    vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) {
        return new Response(JSON.stringify({ id: 'conv_s', object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const req = JSON.parse(String(init?.body ?? '{}')) as Json;
      sent.push(req);
      const resp = body(scripted.shift() ?? [{ type: 'message', text: 'Noted.' }]);
      return req.stream === true
        ? new Response(sse(resp), { status: 200, headers: { 'content-type': 'text/event-stream' } })
        : new Response(JSON.stringify(resp), { status: 200, headers: { 'content-type': 'application/json' } });
    })));
    scripted = [[{ type: 'function_call', name: 'read_canonical_context', args: {} }], [{ type: 'message', text: 'The model is empty.' }]];
    const frames: Json[] = [];
    const { result, calls } = await runWithStageStream((e) => { frames.push(e as Json); }, () => turn('What is in my model?', caps()));
    expect(sent.map((b) => b.stream), 'every model call streamed').toEqual([true, true]);
    expect(result.assistant_text).toBe('The model is empty.');
    expect(result.tool_calls.map((t) => t.name)).toEqual(['read_canonical_context']);
    expect(frames.filter((f) => f.kind === 'PROGRESS').map((f) => f.phase), 'writing once, when the words arrive').toEqual(['writing']);
    expect(calls.map((c) => [c.attempt?.outcome, c.returned_model])).toEqual([['success', RETURNED_MODEL], ['success', RETURNED_MODEL]]);
    // The buffered entry streams too (#3594: a Conversation call never sits idle on a buffered transport), with no frame.
    sent.length = 0; scripted = [[{ type: 'message', text: 'Buffered.' }]]; frames.length = 0;
    const buffered = await turn('What is in my model?', caps());
    expect(sent.map((b) => b.stream ?? false)).toEqual([true]);
    expect(buffered.result.assistant_text).toBe('Buffered.');
    expect(frames).toEqual([]);
  });

  it('TRACE: the SDK\'s own trace carries the prompt, model, Conversation, revision and Run; each tool call is a native span', async () => {
    const traces: Trace[] = []; const spans: Span<any>[] = [];
    setTraceProcessors([{ onTraceStart: async (t) => { traces.push(t); }, onTraceEnd: async () => {}, onSpanStart: async () => {},
      onSpanEnd: async (sp) => { spans.push(sp); }, shutdown: async () => {}, forceFlush: async () => {} }]);
    setTracingDisabled(false);
    try {
      scripted = [[{ type: 'function_call', name: 'read_canonical_context', args: {} }], [{ type: 'message', text: 'The model is empty.' }]];
      const { result } = await turn('What is in my model?', caps(), { traceMeta: { revision: 'rev_7', run_id: 'run_3' } });
      expect(traces).toHaveLength(1);
      expect(result.sdk.trace_id).toBe(traces[0]!.traceId);
      expect(traces[0]!.groupId).toBe(SCENARIO);
      expect(traces[0]!.metadata).toMatchObject({ model: 'gpt-6.1-sol', conversation_id: 'conv_1', revision: 'rev_7', run_id: 'run_3',
        prompt_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(spans.map((sp) => sp.spanData).filter((d) => d.type === 'function').map((d) => (d as { name: string }).name)).toEqual(['read_canonical_context']);
    } finally {
      setTraceProcessors([]);
      setTracingDisabled(true);
    }
  });

  it('⛔ An adapter that throws ends the turn with ITS error (the route answers ownership and conflicts as today), never a string to the model', async () => {
    class OwnershipRefused extends Error {}
    const refusal = new OwnershipRefused('not your scenario');
    const c = { read: vi.fn(async (): Promise<string> => { throw refusal; }) };
    scripted = [[{ type: 'function_call', name: 'read_canonical_context', args: {} }], [{ type: 'message', text: 'Should never be asked.' }]];
    await expect(turn('What is in my model?', c)).rejects.toBe(refusal);
    expect(sent, 'no further model call after the throw').toHaveLength(1);
  });

  it('CONVERSATION: ONE OpenAI Conversation per scenario; each turn sends only its new input, with its ONE state block', async () => {
    const store = columnStore();
    scripted = [[{ type: 'message', text: 'First answer.' }]];
    const one = await turn('First synthetic question.', caps(), { conversationStore: store, briefText: 'A synthetic brief, written apart.', state: { revision: 1 } });
    expect(one.result.sdk).toMatchObject({ conversation_id: 'conv_1', conversation_created: true });
    expect(created).toHaveLength(1);
    // The brief written apart from the message goes in first on the turn that creates the Conversation, once, as the user's words.
    expect(sent[0]!.conversation).toBe('conv_1');
    expect(sent[0]!.input.map((i: Json) => i.role)).toEqual(['user', 'user', 'system']);
    expect(JSON.stringify(sent[0]!.input[0])).toContain('A synthetic brief, written apart.');
    expect(JSON.stringify(sent[0]!.input[1])).toContain('First synthetic question.');
    expect(column.get(SCENARIO), 'saved on the scenario before the turn used it').toBe('conv_1');

    // No process copy: the next turn (or a restarted process) finds the Conversation only on the scenario.
    scripted = [[{ type: 'message', text: 'Second answer.' }]];
    const two = await turn('Second synthetic question.', caps(), { conversationStore: store, briefText: 'A synthetic brief, written apart.', state: { revision: 2 } });
    expect(two.result.sdk).toMatchObject({ conversation_id: 'conv_1', conversation_created: false });
    expect(created, 'a reopen reuses the saved Conversation').toHaveLength(1);
    const second = sent[1]!;
    expect(second.conversation).toBe('conv_1');
    expect(second.previous_response_id, 'never combined with previous_response_id').toBeUndefined();
    const input = JSON.stringify(second.input);
    expect(input).toContain('Second synthetic question.');
    expect(input, 'no replay: the server holds turn 1').not.toContain('First synthetic question.');
    expect(input, 'the brief was seeded once').not.toContain('A synthetic brief, written apart.');
    expect(input).not.toContain('First answer.');
    // Today's facts, fresh: the CURRENT state (revision 2, not 1) and the date, once each, in this turn's one state block.
    expect(second.instructions, 'the agent\'s own instructions, the same bytes on every call').toBe('Synthetic instructions.');
    const blocks = (second.input as Json[]).filter((i) => i.role === 'system').map((i) => JSON.stringify(i.content));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toContain(STATE_BLOCK_PREFIX);
    expect(blocks[0]).toContain('supersedes every earlier state block');
    expect(blocks[0]!.split('CURRENT MODEL STATE').length - 1).toBe(1);
    expect(blocks[0]).toContain('\\"revision\\":2');
    expect(blocks[0]).not.toContain('\\"revision\\":1');
    expect(blocks[0]!.split('TODAY, from Olumi').length - 1).toBe(1);
  });

  it('⛔ the SDK client obeys the request policy: a route that does not allow OpenAI never gets one, so nothing leaves', async () => {
    const ledger = { site: 'agent-core.sdk', detailOf: () => ({ model: 'm' }) };
    expect(() => runWithProviderPolicy({ ...OPENAI_ONLY('refused'), allowed: new Set() }, () => ledgeredAgentsClient(ledger)))
      .toThrow(ForbiddenProviderError);
    // Contrast: the same client under OPENAI_ONLY creates the Conversation natively, with no model row (it is not a model call).
    const id = await runWithProviderPolicy(OPENAI_ONLY('allowed'), async () => {
      const conv = await ledgeredAgentsClient(ledger).conversations.create({});
      expect(recordedProviderCalls()).toHaveLength(0);
      return conv.id;
    });
    expect(id).toBe('conv_1');
    expect(sent).toHaveLength(0);
  });

  it("Paul's served test (21 Oct, 31711a9): a Conversation call is never resent; a lost transport ends the turn as delivery UNKNOWN, never a locked-conversation retry", async () => {
    const reply = (status: number, b: Json) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' } });
    const conv = (url: unknown) => String(url).endsWith('/v1/conversations') ? reply(200, { id: 'conv_r', object: 'conversation' }) : undefined;
    // A server error on a Conversation call: one attempt, no resend, the provider's error.
    vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => conv(url)
      ?? (sent.push(JSON.parse(String(init?.body ?? '{}')) as Json), reply(500, { error: { message: 'busy' } })))));
    await expect(turn('A synthetic question.', caps())).rejects.toMatchObject({ status: 500 });
    expect(sent, 'never resent').toHaveLength(1);
    // A lost transport (the served case: a TypeError at 110 s): one attempt, no resend, delivery UNKNOWN, not retry-safe.
    sent.length = 0;
    vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => conv(url)
      ?? (() => { sent.push(JSON.parse(String(init?.body ?? '{}')) as Json); throw new TypeError('fetch failed'); })())));
    const lost = await turn('A synthetic question.', caps()).then(() => undefined, (e: unknown) => e);
    expect(lost).toBeInstanceOf(CoreDeliveryUnknownError);
    expect(lost).toMatchObject({ code: 'CORE_DELIVERY_UNKNOWN', delivery_outcome: 'UNKNOWN', retry_safe: false });
    expect(sent, 'never resent into a Conversation the provider may still hold').toHaveLength(1);
    // CONTRAST: a stateless call (no Conversation, e.g. the critic) keeps the client's native retry.
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async () => (attempts += 1) === 1 ? reply(500, { error: { message: 'busy' } }) : reply(200, body([{ type: 'message', text: 'ok' }]))));
    await runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), () => ledgeredAgentsClient({ site: 'critic', detailOf: () => ({ model: 'gpt-6.1-sol', purpose: 'critic' }) as never })
      .responses.create({ model: 'gpt-6.1-sol', input: 'x' }));
    expect(attempts, 'the stateless call is resent once after a 500').toBe(2);
  });

  it('⛔ a Conversation left holding an unanswered tool call (a restart mid-tool; served 22 Oct, "No tool output found for function call") is answered once as interrupted, then the turn runs', async () => {
    const items: Json[] = [];
    let refusedOnce = false;
    const json = { 'content-type': 'application/json' };
    // `refuseAt`: which Responses request is refused (0 = the turn's first); `first`: what the requests before it answer.
    const install = (refusal: string, status = 400, refuseAt = 0, first: Json[] = []) => vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
      const u = String(url);
      if (u.endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_cut', object: 'conversation' }), { status: 200, headers: json });
      if (u.endsWith('/v1/conversations/conv_cut/items')) {
        items.push(JSON.parse(String(init?.body ?? '{}')) as Json);
        return new Response(JSON.stringify({ object: 'list', data: [], first_id: null, last_id: null, has_more: false }), { status: 200, headers: json });
      }
      sent.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      if (!refusedOnce && sent.length - 1 === refuseAt) {
        refusedOnce = true;
        return new Response(JSON.stringify({ error: { message: refusal, type: 'invalid_request_error', param: 'input', code: null } }), { status, headers: json });
      }
      if (sent.length - 1 < refuseAt) return new Response(JSON.stringify(body(first)), { status: 200, headers: json });
      return new Response(JSON.stringify(body([{ type: 'message', text: 'Noted.' }])), { status: 200, headers: json });
    })));
    install('No tool output found for function call call_lost1.');
    const { result } = await turn('A synthetic question.', caps());
    expect(result.assistant_text, 'the turn runs after the answer').toBe('Noted.');
    expect(items, 'exactly that call is answered, once').toEqual([{ items: [expect.objectContaining({ type: 'function_call_output', call_id: 'call_lost1' })] }]);
    expect(String(items[0]!.items[0].output)).toContain('interrupted');
    expect(sent, 'the refused request, then the turn').toHaveLength(2);
    // CONTRAST: any other refusal is the provider's answer: nothing is answered and nothing is resent.
    items.length = 0; sent.length = 0; refusedOnce = false; column = new Map();
    install('Invalid value for input.');
    await expect(turn('A synthetic question.', caps())).rejects.toMatchObject({ status: 400 });
    expect(items).toHaveLength(0);
    expect(sent).toHaveLength(1);
    // CONTRAST (Codex r1): the same words on a 500 are not a refusal that accepted nothing: never answered, never resent.
    items.length = 0; sent.length = 0; refusedOnce = false; column = new Map();
    install('No tool output found for function call call_lost1.', 500);
    await expect(turn('A synthetic question.', caps())).rejects.toBeDefined();
    expect(items).toHaveLength(0);
    // CONTRAST (Codex r1): a later hop refused after a tool already ran this turn: resending would repeat it.
    items.length = 0; sent.length = 0; refusedOnce = false; column = new Map();
    const c = caps();
    install('No tool output found for function call call_lost1.', 400, 1, [{ type: 'function_call', name: 'read_canonical_context', args: {} }]);
    await expect(turn('A synthetic question.', c)).rejects.toMatchObject({ status: 400 });
    expect(c.read, 'the tool ran once').toHaveBeenCalledTimes(1);
    expect(items, 'nothing answered after accepted work').toHaveLength(0);
    expect(sent, 'nothing resent').toHaveLength(2);
  });

  it('zod isolation: the SDK and the adapters share ONE zod 4 (`zod-v4`); the service stays on zod 3; a zod schema is the tool\'s schema', () => {
    const service = createRequire(`${process.cwd()}/package.json`);
    const sdkCore = createRequire(createRequire(service.resolve('@openai/agents')).resolve('@openai/agents-core'));
    const sdkZod = sdkCore.resolve('zod');
    expect(service.resolve('zod-v4'), 'the adapters\' zod IS the SDK\'s (one instance: types and runtime agree)').toBe(sdkZod);
    expect((sdkCore('zod/package.json') as { version: string }).version).toMatch(/^4\./);
    expect((service('zod/package.json') as { version: string }).version).toMatch(/^3\./);
    // Typed: `parameters` accepts the zod object (tsc in CI), and the SDK turns it into the tool's JSON schema.
    const probe = tool({ name: 'probe', description: 'A synthetic probe.', parameters: z4.object({ reason: z4.string() }), execute: async ({ reason }) => reason });
    expect(probe.parameters).toMatchObject({ type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] });
  });

  it('⛔ NO FALLBACK: a store that cannot hold the id, or a save that fails, stops the turn before any model call', async () => {
    const cannotHold: ConversationIdStore = { read: async () => undefined, claim: async () => undefined };
    await expect(turn('A synthetic question.', caps(), { conversationStore: cannotHold })).rejects.toMatchObject({ reason: 'store_cannot_hold_id' });
    expect(created, 'no Conversation the next turn could not find').toHaveLength(0);
    await expect(turn('A synthetic question.', caps(), { conversationStore: undefined })).rejects.toBeInstanceOf(CoreStateUnavailableError);
    const saveFails: ConversationIdStore = { read: async () => null, claim: async () => { throw new Error('write refused'); } };
    await expect(turn('A synthetic question.', caps(), { conversationStore: saveFails })).rejects.toMatchObject({ reason: 'id_not_saved' });
    expect(sent, 'no model call on any of them').toHaveLength(0);
  });

  it('a race on the first turn continues the Conversation the scenario saved first', async () => {
    column.set(SCENARIO, 'conv_winner');
    const lateRead: ConversationIdStore = { read: async () => null, claim: async (sid) => column.get(sid)! };
    const { result } = await turn('A synthetic question.', caps(), { conversationStore: lateRead });
    expect(result.sdk).toMatchObject({ conversation_id: 'conv_winner', conversation_created: false });
    expect(sent[0]!.conversation).toBe('conv_winner');
  });

  it('a typed adapter records its own row: the kit\'s fields reach `tool_calls`, its result reaches `tool_results`, an unknown write is no claim', async () => {
    const adapters = (onCall: CoreToolRecorder) => [
      tool({ name: 'run_analysis', description: 'Run the analysis.', parameters: z4.object({ reason: z4.string() }),
        execute: async () => { onCall({ name: 'run_analysis', ok: true, mutated: false, outcome: 'ok', refusal: null, ran: true }, { ok: true, mutated: false, ran: true }); return '{"ran":true}'; } }),
      tool({ name: 'apply_change', description: 'Apply.', parameters: z4.object({ proposal_id: z4.string() }),
        execute: async () => { onCall({ name: 'apply_change', ok: false, mutated: null, outcome: 'unavailable', refusal: 'not_confirmed', ran: null },
          { ok: false, mutated: false, outcome: 'unavailable', refusal: 'not_confirmed', proposal_id: PID }); return '{"outcome":"unavailable"}'; } }),
    ];
    scripted = [[{ type: 'function_call', name: 'run_analysis', args: { reason: 'asked' } }],
      [{ type: 'function_call', name: 'apply_change', args: { proposal_id: PID } }], [{ type: 'message', text: 'Ran; the save is not confirmed.' }]];
    const { result } = await turn('Run it and apply that.', caps(), { tools: adapters });
    expect(result.tool_calls).toEqual([
      { name: 'run_analysis', ok: true, mutated: false, outcome: 'ok', ran: true },
      { name: 'apply_change', ok: false, mutated: false, outcome: 'unavailable', refusal: 'not_confirmed', proposal_id: PID },
    ]);
    expect(result.tool_results.map((r) => r['ran'] ?? null)).toEqual([true, null]);
    expect(result.mutated).toBe(false);
    // The interim wrapper is not used when the adapters are given: only their tools were sent.
    expect(sent[0]!.tools.map((t: Json) => t.name)).toEqual(['run_analysis', 'apply_change']);
  });

  describe('APPROVAL: a tool that needs approval pauses the SDK run; the press resumes that same saved RunState', () => {
    let pausedColumn: OpenAiPausedRun | null = null;
    const pausedStore = (overrides: Partial<PausedRunStore> = {}): PausedRunStore => ({
      read: async () => pausedColumn,
      save: async (_sid, run) => { if (pausedColumn !== null) return false; pausedColumn = run; return true; },
      take: async (_sid, id) => { if (pausedColumn?.pause_id !== id) return false; pausedColumn = null; return true; },
      ...overrides,
    });
    let applied = 0;
    const applyTool = () => [tool({
      name: 'apply_change', description: 'Apply a proposed change once the person approves it on its card.',
      parameters: z4.object({ proposal_id: z4.string() }), needsApproval: true,
      execute: async ({ proposal_id }) => { applied += 1; return JSON.stringify({ outcome: 'ok', mutated: true, proposal_id }); },
    })];
    const pausing = () => [
      { type: 'message', text: 'I propose taking option B out of the comparison; approve it on the card.' },
      { type: 'function_call', name: 'apply_change', args: { proposal_id: PID } },
    ];
    beforeEach(() => { pausedColumn = null; applied = 0; });

    it('⭐ PAUSE: the run stops at the approval, its state is saved on the scenario, nothing is applied, and the AI\'s words are the reply', async () => {
      scripted = [pausing()];
      const { result } = await turn('Please drop option B.', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore() });
      expect(applied, 'nothing applied before the press').toBe(0);
      expect(result.assistant_text).toBe('I propose taking option B out of the comparison; approve it on the card.');
      expect(result.reply_author).toBe('ai');
      expect(result.tool_calls).toEqual([{ name: 'apply_change', ok: true, mutated: false, outcome: 'awaiting_approval', proposal_id: PID }]);
      expect(result.mutated).toBe(false);
      expect(result.sdk.paused).toMatchObject({ proposal_id: PID, tool: 'apply_change' });
      expect(pausedColumn).toMatchObject({ pause_id: result.sdk.paused!.pause_id, proposal_id: PID, tool: 'apply_change', call_id: `call_${served}_1` });
      expect(JSON.parse(pausedColumn!.state)).toMatchObject({ currentStep: { type: 'next_step_interruption' } });
      expect(sent, 'one model call').toHaveLength(1);
    });

    it('⭐ RESUME: the press approves the SAME saved run; the tool runs once; a second press finds nothing to resume and applies nothing', async () => {
      scripted = [pausing()];
      await turn('Please drop option B.', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore() });
      const pausedCall = pausedColumn!.call_id;
      scripted = [[{ type: 'message', text: 'Done: option B is out of the comparison.' }]];
      const { result } = await turn('Approve', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore(), press: { decision: 'approve', proposal_id: PID } });
      expect(applied).toBe(1);
      expect(result.sdk.resumed).toMatchObject({ answer: 'approved' });
      expect(result.assistant_text).toBe('Done: option B is out of the comparison.');
      expect(pausedColumn, 'taken by the press').toBeNull();
      // The resume sends only the tool's answer to the Conversation: no replay of the earlier message, no press text.
      const resumeInput = JSON.stringify(sent[1]!.input);
      expect(sent[1]!.conversation).toBe('conv_1');
      expect(resumeInput).toContain(pausedCall);
      expect(resumeInput).toContain('function_call_output');
      expect(resumeInput).not.toContain('Please drop option B.');
      expect(resumeInput).not.toContain('Approve');
      // A duplicate press: the run was taken, so there is nothing to resume and the tool never runs again.
      scripted = [[{ type: 'message', text: 'That change is already applied.' }]];
      await turn('Approve', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore(), press: { decision: 'approve', proposal_id: PID } });
      expect(applied, 'applied once in all').toBe(1);
    });

    it('Codex r1 on #3695: an approving press binds the tools to its card for EVERY caller (both routes build tools here); no other turn does', async () => {
      const bound: unknown[] = [];
      const tools = (_onCall: unknown, press?: { approves: string }) => { bound.push(press); return applyTool(); };
      scripted = [[{ type: 'message', text: 'Noted.' }]];
      await turn('Please drop option B.', caps(), { tools, pausedRunStore: pausedStore() });
      scripted = [[{ type: 'message', text: 'Noted.' }]];
      await turn('Decline', caps(), { tools, pausedRunStore: pausedStore(), press: { decision: 'decline', proposal_id: PID } });
      scripted = [[{ type: 'message', text: 'Noted.' }]];
      await turn('Approve', caps(), { tools, pausedRunStore: pausedStore(), press: { decision: 'approve', proposal_id: PID } });
      expect(bound).toEqual([undefined, undefined, { approves: PID }]);
    });

    it('a decline on the card answers the paused call with the decline; nothing is applied', async () => {
      scripted = [pausing()];
      await turn('Please drop option B.', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore() });
      scripted = [[{ type: 'message', text: 'Understood; option B stays in.' }]];
      const { result } = await turn('Decline', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore(), press: { decision: 'decline', proposal_id: PID } });
      expect(applied).toBe(0);
      expect(result.sdk.resumed).toMatchObject({ answer: 'declined' });
      expect(JSON.stringify(sent[1]!.input)).toContain(PAUSE_DECLINED);
      expect(pausedColumn, 'cleared by the decline (the conditional take)').toBeNull();
    });

    it('the paused state is replaced by a new pause, and never written to a log', async () => {
      const { log } = await import('../../../utils/telemetry.js');
      const logged = (['debug', 'info', 'warn', 'error'] as const).map((m) => vi.spyOn(log, m));
      try {
        log.info({ probe: 'spies-are-wired' }, 'positive control');
        scripted = [pausing()];
        await turn('Please drop option B.', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore() });
        const first = pausedColumn!;
        // The person writes instead; the AI proposes again and pauses on a new call.
        scripted = [[{ type: 'message', text: 'Then only option C; approve it on the card.' }, { type: 'function_call', name: 'apply_change', args: { proposal_id: PID } }]];
        await turn('No, take out option C instead.', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore() });
        expect(pausedColumn, 'a new pause is held').not.toBeNull();
        expect(pausedColumn!.pause_id).not.toBe(first.pause_id);
        expect(pausedColumn!.call_id).not.toBe(first.call_id);
        expect(applied).toBe(0);
        const everyLogArgument = JSON.stringify(logged.flatMap((spy) => spy.mock.calls));
        expect(everyLogArgument, 'positive control: the spies see log lines').toContain('spies-are-wired');
        expect(everyLogArgument, 'no paused state in any log line').not.toContain(first.state.slice(0, 40));
        expect(everyLogArgument).not.toContain('Please drop option B.');
        expect(everyLogArgument).not.toContain('No, take out option C instead.');
      } finally {
        logged.forEach((spy) => spy.mockRestore());
      }
    });

    it('⛔ a typed message instead of a press declines the paused call first, then the message; ONE reply; nothing applied', async () => {
      scripted = [pausing()];
      await turn('Please drop option B.', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore() });
      scripted = [[{ type: 'message', text: 'Then let us look at the costs first.' }]];
      const { result } = await turn('Actually, what about the costs?', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore() });
      expect(applied).toBe(0);
      expect(result.sdk.resumed).toMatchObject({ answer: 'superseded' });
      expect(result.assistant_text).toBe('Then let us look at the costs first.');
      const input = sent[1]!.input as Json[];
      const answered = input.findIndex((i) => JSON.stringify(i).includes(PAUSE_SUPERSEDED));
      const typed = input.findIndex((i) => JSON.stringify(i).includes('Actually, what about the costs?'));
      expect(answered, 'the paused call is answered').toBeGreaterThanOrEqual(0);
      expect(typed, 'the typed message follows its answer, in the same call').toBeGreaterThan(answered);
      expect(sent, 'one model call for the typed turn').toHaveLength(2);
      expect(pausedColumn).toBeNull();
    });

    // Lenses on served 0ce7ae88 (22 Oct): a Run press while a card awaited approval answered 502, "UserError: Tool apply_change
    // not found" (the press withholds apply_change, and the SDK cannot restore a paused call to a tool the agent lacks).
    it('⛔ a Run press while a card awaits approval answers the paused call as superseded, then RUNS: its first call is forced to the Run (Codex r1 #3644); nothing applied', async () => {
      scripted = [pausing()];
      await turn('Please drop option B.', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore() });
      const pausedCall = pausedColumn!.call_id;
      let ran = 0;
      const runTool = tool({ name: 'run_analysis', description: 'Run the saved model.', parameters: z4.object({}), execute: async () => { ran += 1; return '{"status":"ok"}'; }, errorFunction: null });
      scripted = [[{ type: 'function_call', name: 'run_analysis', args: {} }], [{ type: 'message', text: 'Here is the Run on the saved model.' }]];
      const { result } = await turn('Run it.', caps(), { tools: () => [...applyTool(), runTool], pausedRunStore: pausedStore(), withheldTools: ['apply_change'], firstTool: 'run_analysis' });
      expect(applied).toBe(0);
      expect(ran, 'the press ran').toBe(1);
      expect(result.sdk.resumed).toMatchObject({ answer: 'superseded' });
      expect(result.assistant_text).toBe('Here is the Run on the saved model.');
      expect(added, 'the paused call is answered once, as superseded').toEqual([{ items: [{ type: 'function_call_output', call_id: pausedCall, output: PAUSE_SUPERSEDED }] }]);
      expect(sent[1]!.tool_choice, 'the press\'s first call is forced to the Run').toEqual({ type: 'function', name: 'run_analysis' });
      expect(callable(sent[1]!), 'the withheld tool is not callable').not.toContain('apply_change');
      expect(JSON.stringify(sent[1]!.input), 'the press\'s own words, no replay').toContain('Run it.');
      expect(pausedColumn, 'taken by the press').toBeNull();
    });

    it('CONTROL: a typed message (nothing withheld) still answers the pause from its saved run, never directly', async () => {
      scripted = [pausing()];
      await turn('Please drop option B.', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore() });
      scripted = [[{ type: 'message', text: 'Then let us look at the costs first.' }]];
      await turn('Actually, what about the costs?', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore() });
      expect(added).toHaveLength(0);
      expect(JSON.stringify(sent[1]!.input)).toContain(PAUSE_SUPERSEDED);
    });

    it('CONTROL: with no paused run, a withheld tool is not offered and nothing is answered', async () => {
      scripted = [[{ type: 'message', text: 'Here is the Run.' }]];
      await turn('Run it.', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore(), withheldTools: ['apply_change'] });
      expect(callable(sent[0]!), 'the withheld tool is not callable').not.toContain('apply_change');
      expect(JSON.stringify(sent[0]!.tools ?? []), 'it is still in the one fixed list').toContain('apply_change');
      expect(added).toHaveLength(0);
    });

    it('⛔ a pause that cannot be kept is answered in the same turn: nothing applied, nothing left open, the AI says so', async () => {
      scripted = [pausing(), [{ type: 'message', text: 'I could not hold that change for your approval; nothing changed.' }]];
      const { result } = await turn('Please drop option B.', caps(), { tools: () => applyTool(), pausedRunStore: pausedStore({ save: async () => false }) });
      expect(applied).toBe(0);
      expect(result.sdk.paused).toBeUndefined();
      expect(result.assistant_text).toBe('I could not hold that change for your approval; nothing changed.');
      expect(JSON.stringify(sent[1]!.input)).toContain('could not hold this change');
      expect(pausedColumn).toBeNull();
    });
  });

  describe('⭐ CACHING (DL 22 Oct, ruling B): one tool list, standing instructions, the full state block every turn', () => {
    /** The turn's system items: its state block (or the one line), then any guidance. */
    const systemItems = (b: Json): string[] => ((b.input ?? []) as Json[]).filter((i) => i.role === 'system').map((i) => String(i.content));
    let written = 0;
    const writerTool = () => tool({ name: 'propose_change', description: 'Prepare a change to the model.', parameters: z4.object({}),
      execute: async () => { written += 1; return '{"status":"ok","mutated":true}'; }, errorFunction: null });
    beforeEach(() => { written = 0; });

    it('(2) a withheld tool stays in the list; the provider is told it may not call it; called anyway, it refuses in execute and nothing is written', async () => {
      scripted = [[{ type: 'function_call', name: 'propose_change', args: {} }], [{ type: 'message', text: 'That is not available on this turn.' }]];
      const c = caps();
      const { result } = await turn('Run it.', c, { tools: (onCall) => [...readTools(c)(onCall), writerTool()], withheldTools: ['propose_change'] });
      expect(written, 'the withheld tool never ran').toBe(0);
      expect(result.tool_calls).toEqual([expect.objectContaining({ name: 'propose_change', ok: false, mutated: false, refusal: 'withheld_on_chip_turn' })]);
      expect(result.mutated).toBe(false);
      expect(JSON.stringify(sent[1]!.input), 'the AI is told nothing was changed').toContain('Nothing was changed or run');
      for (const b of sent) {
        expect((b.tools as Json[]).map((t) => t.name), 'still in the one fixed list').toEqual(['read_canonical_context', 'propose_change']);
        expect(b.tool_choice).toEqual({ type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'read_canonical_context' }] });
      }
    });

    it('(3) a Run press\'s first call is still forced to the Run; its later calls go back to the turn\'s allowed tools', async () => {
      let ran = 0;
      const runTool = tool({ name: 'run_analysis', description: 'Run the saved model.', parameters: z4.object({}), execute: async () => { ran += 1; return '{"status":"ok"}'; }, errorFunction: null });
      scripted = [[{ type: 'function_call', name: 'run_analysis', args: {} }], [{ type: 'message', text: 'Here is the Run.' }]];
      const c = caps();
      await turn('Run it.', c, { tools: (onCall) => [...readTools(c)(onCall), runTool, writerTool()], withheldTools: ['propose_change'], firstTool: 'run_analysis' });
      expect(ran).toBe(1);
      expect(sent[0]!.tool_choice, 'forced, never widened to the allowed list').toEqual({ type: 'function', name: 'run_analysis' });
      expect(sent[1]!.tool_choice).toEqual({ type: 'allowed_tools', mode: 'auto',
        tools: [{ type: 'function', name: 'read_canonical_context' }, { type: 'function', name: 'run_analysis' }] });
      expect(JSON.stringify(sent[0]!.tools)).toBe(JSON.stringify(sent[1]!.tools));
    });

    it('(4) one cache key and 24 h retention for one model and standing prompt, across scenarios; a changed prompt changes the key', async () => {
      const other = '7d1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';
      await turn('First synthetic question.', caps());
      await turn('Second synthetic question.', caps(), { scenarioId: other, state: { revision: 9 } });
      await turn('Third synthetic question.', caps(), { scenarioId: other, instructions: 'Synthetic instructions, revised.' });
      expect(sent.map((b) => b.conversation), 'two scenarios, two Conversations').toEqual(['conv_1', 'conv_2', 'conv_2']);
      const key = corePromptCacheKey('gpt-6.1-sol', 'Synthetic instructions.');
      expect(sent.map((b) => b.prompt_cache_key)).toEqual([key, key, corePromptCacheKey('gpt-6.1-sol', 'Synthetic instructions, revised.')]);
      expect(sent[2]!.prompt_cache_key).not.toBe(key);
      expect(sent.map((b) => b.prompt_cache_retention)).toEqual(['24h', '24h', '24h']);
    });

    it('(B) the instructions are the agent\'s own bytes on every call; the state block is sent once per turn, headed with its revision and Run', async () => {
      scripted = [[{ type: 'function_call', name: 'read_canonical_context', args: {} }], [{ type: 'message', text: 'Read.' }]];
      await turn('What is in my model?', caps(), { state: { revision: 4 }, traceMeta: { revision: 'rev-4', run_id: 'run-7' } });
      expect(sent).toHaveLength(2);
      expect(sent.map((b) => b.instructions)).toEqual(['Synthetic instructions.', 'Synthetic instructions.']);
      const first = systemItems(sent[0]!);
      expect(first).toHaveLength(1);
      expect(first[0]!.startsWith(`${STATE_BLOCK_PREFIX}: model revision rev-4, run run-7. It supersedes every earlier state block in this conversation.`)).toBe(true);
      expect(first[0]).toContain('"revision":4');
      expect(systemItems(sent[1]!), 'the later call reads it from the Conversation: never sent twice').toEqual([]);
      expect(JSON.stringify(sent[0]!.input).indexOf('What is in my model?'), 'the block follows the turn\'s own words').toBeLessThan(JSON.stringify(sent[0]!.input).indexOf(STATE_BLOCK_PREFIX));
    });

    /** The turn's first request's system items, read as: the full block of this revision, or the text itself. */
    const blockOf = (b: Json): string[] => systemItems(b).map((t) => (t.startsWith(STATE_BLOCK_PREFIX) ? `block ${/"revision":(\d+)/.exec(t)?.[1]}` : t.slice(0, 40)));
    const noOneLine = () => { for (const b of sent) for (const t of systemItems(b)) expect(t, 'the old one-line text is gone').not.toMatch(/^State unchanged/); };

    it('(B) every turn sends the full block, whatever its kind and whether the state changed: typed, a Run press, a card press', async () => {
      const meta = { revision: 'rev-4', run_id: 'run-7' };
      let ran = 0;
      const runTool = tool({ name: 'run_analysis', description: 'Run the saved model.', parameters: z4.object({}), execute: async () => { ran += 1; return '{"status":"ok"}'; }, errorFunction: null });
      const c = caps();
      const tools = (onCall: CoreToolRecorder) => [...readTools(c)(onCall), runTool];
      await turn('One.', c, { state: { revision: 4 }, traceMeta: meta, tools });
      await turn('Two, the same state.', c, { state: { revision: 4 }, traceMeta: meta, tools });
      scripted = [[{ type: 'function_call', name: 'run_analysis', args: {} }], [{ type: 'message', text: 'Here is the Run.' }]];
      await turn('Run it.', c, { state: { revision: 4 }, traceMeta: meta, tools, firstTool: 'run_analysis' });
      await turn('', c, { state: { revision: 4 }, traceMeta: meta, tools, press: { decision: 'decline', proposal_id: PID } });
      expect(ran).toBe(1);
      const firsts = [sent[0]!, sent[1]!, sent[2]!, sent[4]!];
      expect(firsts.map(blockOf)).toEqual([['block 4'], ['block 4'], ['block 4'], ['block 4']]);
      expect(blockOf(sent[3]!), 'the Run press\'s later call reads it from the Conversation').toEqual([]);
      noOneLine();
    });

    it('⛔ Codex r2 #3656: after a partial failure (a later call of the turn fails), the next turn still sends its own full block', async () => {
      // rev-1 delivered; rev-2's block is accepted, then a later call of that turn fails; the model is back at rev-1 (an Undo).
      let failAt = -1;
      const json = { 'content-type': 'application/json' };
      vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
        const u = String(url);
        if (u.endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_partial', object: 'conversation' }), { status: 200, headers: json });
        if (u.endsWith('/items')) return new Response(JSON.stringify({ object: 'list', data: [], first_id: null, last_id: null, has_more: false }), { status: 200, headers: json });
        sent.push(JSON.parse(String(init?.body ?? '{}')) as Json);
        if (sent.length - 1 === failAt) return new Response(JSON.stringify({ error: { message: 'busy', type: 'server_error', param: null, code: null } }), { status: 500, headers: json });
        return new Response(JSON.stringify(body(scripted.shift() ?? [{ type: 'message', text: 'Noted.' }])), { status: 200, headers: json });
      })));
      await turn('One.', caps(), { state: { revision: 1 }, traceMeta: { revision: 'rev-1', run_id: 'run-1' } });
      failAt = 2;
      scripted = [[{ type: 'function_call', name: 'read_canonical_context', args: {} }]];
      await expect(turn('Two.', caps(), { state: { revision: 2 }, traceMeta: { revision: 'rev-2', run_id: 'run-1' } })).rejects.toBeDefined();
      expect(blockOf(sent[1]!), 'rev-2\'s block was accepted before the failure').toEqual(['block 2']);
      await turn('Three.', caps(), { state: { revision: 1 }, traceMeta: { revision: 'rev-1', run_id: 'run-1' } });
      expect(blockOf(sent[sent.length - 1]!), 'the restored state, in full: never "unchanged since rev-1"').toEqual(['block 1']);
      noOneLine();
    });

    it('⛔ Codex r1 #3656: a first request refused before anything was accepted is resent WITH the state block, and the next turn sends its own', async () => {
      // Revision 1 is in the Conversation; revision 2 is saved; the turn's first request is refused ("No tool output found…").
      let refuseAt = -1;
      const json = { 'content-type': 'application/json' };
      vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
        const u = String(url);
        if (u.endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_recover', object: 'conversation' }), { status: 200, headers: json });
        if (u.endsWith('/items')) return new Response(JSON.stringify({ object: 'list', data: [], first_id: null, last_id: null, has_more: false }), { status: 200, headers: json });
        sent.push(JSON.parse(String(init?.body ?? '{}')) as Json);
        if (sent.length - 1 === refuseAt) {
          return new Response(JSON.stringify({ error: { message: 'No tool output found for function call call_lost1.', type: 'invalid_request_error', param: 'input', code: null } }), { status: 400, headers: json });
        }
        return new Response(JSON.stringify(body([{ type: 'message', text: 'Noted.' }])), { status: 200, headers: json });
      })));
      await turn('One.', caps(), { state: { revision: 1 }, traceMeta: { revision: 'rev-1', run_id: 'run-1' } });
      refuseAt = 1;
      const two = await turn('Two.', caps(), { state: { revision: 2 }, traceMeta: { revision: 'rev-2', run_id: 'run-1' } });
      expect(two.result.assistant_text, 'the turn ran after the answer').toBe('Noted.');
      expect(sent, 'turn 1, the refused request, its resend').toHaveLength(3);
      await turn('Three.', caps(), { state: { revision: 2 }, traceMeta: { revision: 'rev-2', run_id: 'run-1' } });
      expect({ refused: blockOf(sent[1]!), resend: blockOf(sent[2]!), next: blockOf(sent[3]!) })
        .toEqual({ refused: ['block 2'], resend: ['block 2'], next: ['block 2'] });
      noOneLine();
    });
  });

  describe('one turn at a time per scenario (R1 run 20261020T220553Z: "No tool output found for function call")', () => {
    it('a second slot on the same scenario is granted only after the first is released; another scenario never waits', async () => {
      const first = await acquireCoreTurnSlot('scenario-a');
      let granted = false;
      const second = acquireCoreTurnSlot('scenario-a').then((slot) => { granted = true; return slot; });
      const other = await acquireCoreTurnSlot('scenario-b');
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(granted, 'the second turn waits while the first holds the scenario').toBe(false);
      expect([first.waited, other.waited]).toEqual([false, false]);
      first.release();
      first.release();
      const next = await second;
      expect(next.waited, 'the turn that waited knows an earlier turn may have saved').toBe(true);
      next.release();
      other.release();
      const again = await acquireCoreTurnSlot('scenario-a');
      expect(again.waited).toBe(false);
      again.release();
    });
  });

  describe('MULTI-MODEL (Paul, 20 Oct): a turn that only reads, runs and explains is answered on the fast model', () => {
    const REPLY = budgetFor('gpt-5.6-terra', 'conversation');
    const BUILDER = budgetFor('gpt-6.1-sol', 'conversation');
    const WRITERS = ['build_model_from_brief', 'propose_change'];
    /** The read adapter plus synthetic stand-ins named as the Run, apply and the two model writers. */
    const namedTools = (c: ReturnType<typeof caps>) => (onCall: CoreToolRecorder) => [...readTools(c)(onCall),
      ...['run_analysis', 'apply_change', ...WRITERS].map((name) => tool({ name, description: `Synthetic ${name}.`, parameters: z4.object({}),
        execute: async () => '{}', errorFunction: null }))];
    const toolNames = (b: Json): string[] => (b.tools as Json[] ?? []).map((t) => String(t.name)).sort();
    it('a Run-opened turn goes to the reply model, at its own effort, with no model writer on the wire', async () => {
      scripted = [[{ type: 'message', text: 'Synthetic answer.' }]];
      const c = caps();
      await turn('Run it.', c, { replyBudget: REPLY, firstTool: 'run_analysis', tools: namedTools(c) });
      expect(sent.map((b) => b.model)).toEqual([REPLY.model]);
      expect(sent[0]!.reasoning?.effort).toBe(REPLY.reasoning_effort);
      expect(toolNames(sent[0]!), 'the one fixed list').toEqual(['apply_change', 'build_model_from_brief', 'propose_change', 'read_canonical_context', 'run_analysis']);
      expect(callable(sent[0]!), 'its forced first call can call the Run alone: no model writer').toEqual(['run_analysis']);
    });
    it('buddy #3526 R1: a press resumes on the reply model with no model writer, so no continuation can write the model fast', async () => {
      scripted = [[{ type: 'message', text: 'Synthetic answer.' }]];
      const c = caps();
      await turn('', c, { replyBudget: REPLY, press: { decision: 'decline', proposal_id: PID }, tools: namedTools(c) });
      expect(sent.length).toBeGreaterThan(0);
      for (const b of sent) {
        expect(b.model).toBe(REPLY.model);
        expect(callable(b), 'no model writer is callable').toEqual(['apply_change', 'read_canonical_context', 'run_analysis']);
      }
    });
    it('M4 (DL 22 Oct): with no reply budget given (the core route), a press keeps the typed budget and still offers no writer', async () => {
      scripted = [[{ type: 'message', text: 'Synthetic answer.' }]];
      const c = caps();
      await turn('', c, { press: { decision: 'decline', proposal_id: PID }, tools: namedTools(c) });
      expect(sent.length).toBeGreaterThan(0);
      for (const b of sent) {
        expect(b.model).toBe(BUILDER.model);
        expect(b.reasoning?.effort, 'the typed turn\'s effort, so it reads their cached prefix').toBe(BUILDER.reasoning_effort);
        expect(b.max_output_tokens).toBe(BUILDER.max_output_tokens);
        expect(callable(b), 'no model writer is callable').toEqual(['apply_change', 'read_canonical_context', 'run_analysis']);
      }
    });
    it('CONTROL: a typed message, which may change the model, stays on the builder with every writer', async () => {
      scripted = [[{ type: 'message', text: 'Synthetic answer.' }]];
      const c = caps();
      await turn('Change the target to 120.', c, { replyBudget: REPLY, tools: namedTools(c) });
      expect(sent.map((b) => b.model)).toEqual([BUILDER.model]);
      expect(toolNames(sent[0]!)).toEqual(['apply_change', 'build_model_from_brief', 'propose_change', 'read_canonical_context', 'run_analysis']);
    });
    it('the routing: presses and Run/apply-opened turns reply fast; drafting, changing and typed turns stay on the builder', () => {
      expect(replyOnlyTurn({ press: { decision: 'approve', proposal_id: PID } })).toBe(true);
      expect(replyOnlyTurn({ firstTool: 'run_analysis' })).toBe(true);
      expect(replyOnlyTurn({ firstTool: 'apply_change' })).toBe(true);
      expect(replyOnlyTurn({ firstTool: 'build_model_from_brief' })).toBe(false);
      expect(replyOnlyTurn({ firstTool: 'propose_change' })).toBe(false);
      expect(replyOnlyTurn({ firstTool: 'read_canonical_context' }), 'only the known reply entries, never any other tool').toBe(false);
      expect(replyOnlyTurn({})).toBe(false);
    });
  });
});
