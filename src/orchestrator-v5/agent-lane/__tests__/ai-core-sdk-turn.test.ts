/**
 * ⭐ PATH-B: an ordinary `core` turn on the OpenAI Agents SDK (`core/sdk-turn.ts`). The SDK runs the loop; these rows pin
 * what Olumi keeps around it: the consent check on a tool call, the witness on every provider row (returned model, tools
 * sent, input digest), the SDK session as the conversation memory, and the turn's state given fresh on every call, never
 * stored. Scripted provider (global fetch), fake capabilities; SYNTHETIC wording; 0 provider calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPENAI_ONLY, recordedProviderCalls, runWithProviderPolicy } from '../../../adapters/llm/provider-policy.js';
import { AGENTS_SDK, resetCoreSessionsForTests, runCoreTurn } from '../core/sdk-turn.js';
import { budgetFor } from '../model-budgets.js';
import type { AgentCapabilities, AgentToolContext } from '../runtime/agent-tools.js';

type Json = Record<string, any>;
const PID = `prop_${'a'.repeat(32)}`;
const RETURNED_MODEL = 'gpt-scripted-returned';
const SCENARIO = '0b6f2c1e-7d4a-4c8e-9f21-5a3b7c9d1e00';
const ctx = (message: string): AgentToolContext => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: `req-${message.length}`,
  verified_user_messages: [message], user_turn_text: message });

let scripted: Json[][] = [];
const sent: Json[] = [];
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
  scripted = []; sent.length = 0; resetCoreSessionsForTests();
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
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
const turn = (message: string, c: ReturnType<typeof caps>) => runWithProviderPolicy(OPENAI_ONLY('agent_v1_turn'), async () => {
  const result = await runCoreTurn({ ctx: ctx(message), caps: c as unknown as AgentCapabilities, mode: 'core', message,
    instructions: 'Synthetic instructions.', budget: budgetFor('gpt-6.1-sol', 'conversation'), userId: null,
    canonicalState: { empty: true, entities: [] } });
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
    expect(result.sdk.session).toBe('sdk_memory_session');
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

  it('MEMORY: the SDK session carries the conversation to the next turn; the turn\'s state is given fresh and never stored', async () => {
    scripted = [[{ type: 'message', text: 'First answer.' }]];
    await turn('First synthetic question.', caps());
    scripted = [[{ type: 'message', text: 'Second answer.' }]];
    await turn('Second synthetic question.', caps());
    const second = JSON.stringify(sent[1]!.input);
    expect(second).toContain('First synthetic question.');
    expect(second).toContain('First answer.');
    expect(second).toContain('Second synthetic question.');
    // The state and today's date ride every call once: they are not piled up in the session.
    expect(second.split('CURRENT MODEL STATE').length - 1).toBe(1);
    expect(second.split('TODAY, from Olumi').length - 1).toBe(1);
  });
});
