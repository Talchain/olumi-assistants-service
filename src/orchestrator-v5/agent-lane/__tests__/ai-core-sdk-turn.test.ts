/**
 * ⭐ PATH-B: an ordinary `core` turn on the OpenAI Agents SDK (`core/sdk-turn.ts`). The SDK runs the loop; these rows pin
 * what Olumi keeps around it: the consent check on a tool call, the witness on every provider row (returned model, tools
 * sent, input digest), ONE durable OpenAI Conversation per scenario as the conversation state, and the turn's state given
 * fresh on every call, never stored. Scripted provider (global fetch), fake capabilities; SYNTHETIC wording; 0 provider calls.
 */
import { createRequire } from 'node:module';
import { setTraceProcessors, setTracingDisabled, tool, type Span, type Trace } from '@openai/agents';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z as z4 } from 'zod-v4';
import { ForbiddenProviderError, OPENAI_ONLY, recordedProviderCalls, runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';
import { ledgeredAgentsClient } from '../../../adapters/llm/openai-agents-client.js';
import { AGENTS_SDK, CORE_COMPACT_THRESHOLD, CoreStateUnavailableError, PAUSE_DECLINED, PAUSE_SUPERSEDED, runCoreTurn, type ConversationIdStore, type PausedRunStore } from '../core/sdk-turn.js';
import type { OpenAiPausedRun } from '../../session/store.js';
import { budgetFor } from '../model-budgets.js';
import type { AgentCapabilities, AgentToolContext } from '../runtime/agent-tools.js';

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
      : { id: `fc_${served}_${i}`, status: 'completed', type: 'function_call', call_id: `call_${served}_${i}`, name: item.name, arguments: JSON.stringify(item.args) }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  };
};
beforeEach(() => {
  scripted = []; sent.length = 0; created.length = 0; column = new Map();
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    if (String(url).endsWith('/v1/conversations')) {
      created.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      return new Response(JSON.stringify({ id: `conv_${created.length}`, object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Json);
    return new Response(JSON.stringify(body(scripted.shift() ?? [{ type: 'message', text: 'Noted.' }])), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const caps = () => ({
  getCanonicalState: vi.fn(async () => ({ ok: true, mutated: false, empty: true, entities: [] })),
  proposeOptionStatus: vi.fn(async () => ({ ok: true, mutated: false, proposal_id: PID, public_label: 'Take option B out of the comparison' })),
  authoriseChange: vi.fn(async () => ({ ok: true, mutated: true, applied: true })),
});
type Extra = { briefText?: string; conversationStore?: ConversationIdStore; state?: unknown; tools?: Parameters<typeof runCoreTurn>[0]['tools'];
  pausedRunStore?: PausedRunStore; press?: { decision: 'approve' | 'decline'; proposal_id: string } };
const turn = (message: string, c: ReturnType<typeof caps>, extra: Extra & { traceMeta?: { revision?: string; run_id?: string } } = {}) =>
  runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), async () => {
  const result = await runCoreTurn({ ctx: ctx(message), caps: c as unknown as AgentCapabilities, mode: 'core', message,
    instructions: 'Synthetic instructions.', budget: budgetFor('gpt-6.1-sol', 'conversation'), userId: null,
    canonicalState: extra.state ?? { empty: true, entities: [] }, briefText: extra.briefText, conversationStore: 'conversationStore' in extra ? extra.conversationStore : columnStore(),
    ...(extra.tools !== undefined ? { tools: extra.tools } : {}), ...(extra.pausedRunStore !== undefined ? { pausedRunStore: extra.pausedRunStore } : {}),
    ...(extra.press !== undefined ? { press: extra.press } : {}), ...(extra.traceMeta !== undefined ? { traceMeta: extra.traceMeta } : {}) });
  return { result, calls: recordedProviderCalls() };
});

describe('PATH-B core turn on the Agents SDK', () => {
  it('⛔ CONSENT: the AI cannot approve the change it proposed in the same turn; the proposal still waits for the user', async () => {
    scripted = [
      [{ type: 'function_call', name: 'propose_option_status', args: { option_label: 'Option B', status: 'removed', rationale: 'They said drop it.' } }],
      [{ type: 'function_call', name: 'authorise_change', args: { proposal_id: PID } }],
      [{ type: 'message', text: 'I have prepared that change for you to approve.' }],
    ];
    const c = caps();
    const { result } = await turn('Please drop option B.', c);
    expect(c.proposeOptionStatus).toHaveBeenCalledTimes(1);
    expect(c.authoriseChange, 'the approval never reached the capability').not.toHaveBeenCalled();
    expect(result.tool_calls.map((t) => [t.name, t.ok, t.refusal ?? null])).toEqual([
      ['propose_option_status', true, null], ['authorise_change', false, 'not_on_narration']]);
    expect(result.mutated).toBe(false);
    expect(result.assistant_text).toBe('I have prepared that change for you to approve.');
    expect(result.reply_author).toBe('ai');
    // The refusal reached the model as the tool's typed result (the SDK fed it back on the next call).
    expect(JSON.stringify(sent[2]!.input)).toContain('not_on_narration');
  });

  it('WITNESS: each provider row carries the returned model, the tools sent and an input digest; the turn names its SDK and trace', async () => {
    scripted = [[{ type: 'function_call', name: 'get_canonical_state', args: {} }], [{ type: 'message', text: 'The model is empty.' }]];
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
      expect(row.tool_names).toEqual(expect.arrayContaining(['get_canonical_state', 'build_model_from_brief', 'authorise_change']));
      expect(row.input_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(calls[0]!.input_sha256, 'the second call sent more (the tool result)').not.toBe(calls[1]!.input_sha256);
    expect(sent[0]!.model).toBe('gpt-6.1-sol');
  });

  it('TRACE: the SDK\'s own trace carries the prompt, model, Conversation, revision and Run; each tool call is a native span', async () => {
    const traces: Trace[] = []; const spans: Span<any>[] = [];
    setTraceProcessors([{ onTraceStart: async (t) => { traces.push(t); }, onTraceEnd: async () => {}, onSpanStart: async () => {},
      onSpanEnd: async (sp) => { spans.push(sp); }, shutdown: async () => {}, forceFlush: async () => {} }]);
    setTracingDisabled(false);
    try {
      scripted = [[{ type: 'function_call', name: 'get_canonical_state', args: {} }], [{ type: 'message', text: 'The model is empty.' }]];
      const { result } = await turn('What is in my model?', caps(), { traceMeta: { revision: 'rev_7', run_id: 'run_3' } });
      expect(traces).toHaveLength(1);
      expect(result.sdk.trace_id).toBe(traces[0]!.traceId);
      expect(traces[0]!.groupId).toBe(SCENARIO);
      expect(traces[0]!.metadata).toMatchObject({ model: 'gpt-6.1-sol', conversation_id: 'conv_1', revision: 'rev_7', run_id: 'run_3',
        prompt_sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(spans.map((sp) => sp.spanData).filter((d) => d.type === 'function').map((d) => (d as { name: string }).name)).toEqual(['get_canonical_state']);
    } finally {
      setTraceProcessors([]);
      setTracingDisabled(true);
    }
  });

  it('⛔ A capability that throws ends the turn with ITS error (the route answers ownership and conflicts as today), never a string to the model', async () => {
    class OwnershipRefused extends Error {}
    const refusal = new OwnershipRefused('not your scenario');
    const c = { ...caps(), getCanonicalState: vi.fn(async () => { throw refusal; }) };
    scripted = [[{ type: 'function_call', name: 'get_canonical_state', args: {} }], [{ type: 'message', text: 'Should never be asked.' }]];
    await expect(turn('What is in my model?', c)).rejects.toBe(refusal);
    expect(sent, 'no further model call after the throw').toHaveLength(1);
  });

  it('CONVERSATION: ONE OpenAI Conversation per scenario; each turn sends only its new input; the state rides the instructions', async () => {
    const store = columnStore();
    scripted = [[{ type: 'message', text: 'First answer.' }]];
    const one = await turn('First synthetic question.', caps(), { conversationStore: store, briefText: 'A synthetic brief, written apart.', state: { revision: 1 } });
    expect(one.result.sdk).toMatchObject({ conversation_id: 'conv_1', conversation_created: true });
    expect(created).toHaveLength(1);
    // The brief written apart from the message goes in first on the turn that creates the Conversation, once, as the user's words.
    expect(sent[0]!.conversation).toBe('conv_1');
    expect(sent[0]!.input.map((i: Json) => i.role)).toEqual(['user', 'user']);
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
    expect(input, 'the state is never put in the Conversation').not.toContain('CURRENT MODEL STATE');
    // Today's facts, fresh: the CURRENT state (revision 2, not 1) and the date ride this call's instructions, once each.
    expect(second.instructions.split('CURRENT MODEL STATE').length - 1).toBe(1);
    expect(second.instructions).toContain('"revision":2');
    expect(second.instructions).not.toContain('"revision":1');
    expect(second.instructions.split('TODAY, from Olumi').length - 1).toBe(1);
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

  it('a failed attempt the SDK client resends is marked retried; the resend is its own row with the returned model', async () => {
    let first = true;
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_r', object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
      sent.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      if (first) { first = false; return new Response(JSON.stringify({ error: { message: 'busy' } }), { status: 500, headers: { 'content-type': 'application/json', 'retry-after-ms': '1' } }); }
      return new Response(JSON.stringify(body([{ type: 'message', text: 'Recovered.' }])), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const { result, calls } = await turn('A synthetic question.', caps());
    expect(result.assistant_text).toBe('Recovered.');
    expect(sent).toHaveLength(2);
    expect(calls.map((c) => [c.attempt?.outcome, c.attempt?.retry, c.returned_model ?? null])).toEqual([
      ['http_error', true, null], ['success', false, RETURNED_MODEL]]);
    expect(calls[0]!.input_sha256).toBe(calls[1]!.input_sha256);
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
      const { result } = await turn('Please drop option B.', caps(), { tools: applyTool(), pausedRunStore: pausedStore() });
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
      await turn('Please drop option B.', caps(), { tools: applyTool(), pausedRunStore: pausedStore() });
      const pausedCall = pausedColumn!.call_id;
      scripted = [[{ type: 'message', text: 'Done: option B is out of the comparison.' }]];
      const { result } = await turn('Approve', caps(), { tools: applyTool(), pausedRunStore: pausedStore(), press: { decision: 'approve', proposal_id: PID } });
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
      await turn('Approve', caps(), { tools: applyTool(), pausedRunStore: pausedStore(), press: { decision: 'approve', proposal_id: PID } });
      expect(applied, 'applied once in all').toBe(1);
    });

    it('a decline on the card answers the paused call with the decline; nothing is applied', async () => {
      scripted = [pausing()];
      await turn('Please drop option B.', caps(), { tools: applyTool(), pausedRunStore: pausedStore() });
      scripted = [[{ type: 'message', text: 'Understood; option B stays in.' }]];
      const { result } = await turn('Decline', caps(), { tools: applyTool(), pausedRunStore: pausedStore(), press: { decision: 'decline', proposal_id: PID } });
      expect(applied).toBe(0);
      expect(result.sdk.resumed).toMatchObject({ answer: 'declined' });
      expect(JSON.stringify(sent[1]!.input)).toContain(PAUSE_DECLINED);
    });

    it('⛔ a typed message instead of a press declines the paused call first, then the message; ONE reply; nothing applied', async () => {
      scripted = [pausing()];
      await turn('Please drop option B.', caps(), { tools: applyTool(), pausedRunStore: pausedStore() });
      scripted = [[{ type: 'message', text: 'Then let us look at the costs first.' }]];
      const { result } = await turn('Actually, what about the costs?', caps(), { tools: applyTool(), pausedRunStore: pausedStore() });
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

    it('⛔ a pause that cannot be kept is answered in the same turn: nothing applied, nothing left open, the AI says so', async () => {
      scripted = [pausing(), [{ type: 'message', text: 'I could not hold that change for your approval; nothing changed.' }]];
      const { result } = await turn('Please drop option B.', caps(), { tools: applyTool(), pausedRunStore: pausedStore({ save: async () => false }) });
      expect(applied).toBe(0);
      expect(result.sdk.paused).toBeUndefined();
      expect(result.assistant_text).toBe('I could not hold that change for your approval; nothing changed.');
      expect(JSON.stringify(sent[1]!.input)).toContain('could not hold this change');
      expect(pausedColumn).toBeNull();
    });
  });
});
