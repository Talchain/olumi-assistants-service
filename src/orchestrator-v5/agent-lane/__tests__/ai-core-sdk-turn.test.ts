/**
 * ⭐ PATH-B: an ordinary `core` turn on the OpenAI Agents SDK (`core/sdk-turn.ts`). The SDK runs the loop; these rows pin
 * what Olumi keeps around it: the consent check on a tool call, the witness on every provider row (returned model, tools
 * sent, input digest), ONE durable OpenAI Conversation per scenario as the conversation state, and the turn's state given
 * fresh on every call, never stored. Scripted provider (global fetch), fake capabilities; SYNTHETIC wording; 0 provider calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPENAI_ONLY, recordedProviderCalls, runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';
import { AGENTS_SDK, CORE_COMPACT_THRESHOLD, resetCoreConversationsForTests, runCoreTurn, type ConversationIdStore } from '../core/sdk-turn.js';
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
  scripted = []; sent.length = 0; created.length = 0; resetCoreConversationsForTests();
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    if (String(url).endsWith('/v1/conversations')) {
      created.push(JSON.parse(String(init?.body ?? '{}')) as Json);
      return new Response(JSON.stringify({ id: `conv_${created.length}`, object: 'conversation' }), { status: 200 });
    }
    sent.push(JSON.parse(String(init?.body ?? '{}')) as Json);
    return new Response(JSON.stringify(body(scripted.shift() ?? [{ type: 'message', text: 'Noted.' }])), { status: 200 });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

const caps = () => ({
  getCanonicalState: vi.fn(async () => ({ ok: true, mutated: false, empty: true, entities: [] })),
  proposeOptionStatus: vi.fn(async () => ({ ok: true, mutated: false, proposal_id: PID, public_label: 'Take option B out of the comparison' })),
  authoriseChange: vi.fn(async () => ({ ok: true, mutated: true, applied: true })),
});
const turn = (message: string, c: ReturnType<typeof caps>, extra: { briefText?: string; conversationStore?: ConversationIdStore; state?: unknown } = {}) =>
  runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), async () => {
  const result = await runCoreTurn({ ctx: ctx(message), caps: c as unknown as AgentCapabilities, mode: 'core', message,
    instructions: 'Synthetic instructions.', budget: budgetFor('gpt-6.1-sol', 'conversation'), userId: null,
    canonicalState: extra.state ?? { empty: true, entities: [] }, briefText: extra.briefText, conversationStore: extra.conversationStore });
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

  it('⛔ A capability that throws ends the turn with ITS error (the route answers ownership and conflicts as today), never a string to the model', async () => {
    class OwnershipRefused extends Error {}
    const refusal = new OwnershipRefused('not your scenario');
    const c = { ...caps(), getCanonicalState: vi.fn(async () => { throw refusal; }) };
    scripted = [[{ type: 'function_call', name: 'get_canonical_state', args: {} }], [{ type: 'message', text: 'Should never be asked.' }]];
    await expect(turn('What is in my model?', c)).rejects.toBe(refusal);
    expect(sent, 'no further model call after the throw').toHaveLength(1);
  });

  it('CONVERSATION: ONE OpenAI Conversation per scenario; each turn sends only its new input; the state rides the instructions', async () => {
    const saved = new Map<string, string>();
    const store: ConversationIdStore = {
      read: async (sid) => saved.get(sid) ?? null,
      claim: async (sid, id) => { if (!saved.has(sid)) saved.set(sid, id); return saved.get(sid)!; },
    };
    scripted = [[{ type: 'message', text: 'First answer.' }]];
    const one = await turn('First synthetic question.', caps(), { conversationStore: store, briefText: 'A synthetic brief, written apart.', state: { revision: 1 } });
    expect(one.result.sdk).toMatchObject({ conversation_id: 'conv_1', conversation_created: true, conversation_saved: true });
    expect(created).toHaveLength(1);
    // The brief written apart from the message is the Conversation's first item, once, as the user's words.
    expect(JSON.stringify(created[0]!.items)).toContain('A synthetic brief, written apart.');
    expect(created[0]!.items[0].role).toBe('user');
    expect(saved.get(SCENARIO)).toBe('conv_1');

    resetCoreConversationsForTests(); // a restart: the process forgets; the scenario remembers
    scripted = [[{ type: 'message', text: 'Second answer.' }]];
    const two = await turn('Second synthetic question.', caps(), { conversationStore: store, briefText: 'A synthetic brief, written apart.', state: { revision: 2 } });
    expect(two.result.sdk).toMatchObject({ conversation_id: 'conv_1', conversation_created: false, conversation_saved: true });
    expect(created, 'a reopen reuses the saved Conversation').toHaveLength(1);
    const second = sent[1]!;
    expect(second.conversation).toBe('conv_1');
    expect(second.previous_response_id, 'never combined with previous_response_id').toBeUndefined();
    const input = JSON.stringify(second.input);
    expect(input).toContain('Second synthetic question.');
    expect(input, 'no replay: the server holds turn 1').not.toContain('First synthetic question.');
    expect(input).not.toContain('First answer.');
    expect(input, 'the state is never put in the Conversation').not.toContain('CURRENT MODEL STATE');
    // Today's facts, fresh: the CURRENT state (revision 2, not 1) and the date ride this call's instructions, once each.
    expect(second.instructions.split('CURRENT MODEL STATE').length - 1).toBe(1);
    expect(second.instructions).toContain('"revision":2');
    expect(second.instructions).not.toContain('"revision":1');
    expect(second.instructions.split('TODAY, from Olumi').length - 1).toBe(1);
  });

  it('a store that cannot hold the id yet keeps it in process memory, and says so', async () => {
    const store: ConversationIdStore = { read: async () => undefined, claim: async () => undefined };
    const { result } = await turn('A synthetic question.', caps(), { conversationStore: store });
    expect(result.sdk).toMatchObject({ conversation_id: 'conv_1', conversation_created: true, conversation_saved: false });
    await turn('Another synthetic question.', caps(), { conversationStore: store });
    expect(created, 'reused within the process').toHaveLength(1);
  });
});
