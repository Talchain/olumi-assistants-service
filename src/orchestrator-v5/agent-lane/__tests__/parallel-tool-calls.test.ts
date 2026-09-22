/**
 * Every function call the model makes must get an output back.
 *
 * ⛔ THE DEFECT THIS PINS, found in the deployed service's own logs:
 *
 *     Error: openai_400: { "error": { "message":
 *       "No tool output found for function call call_NFIf3sTg5c8kq5Mg…" } }
 *     POST /agent/v1/turn status=502 duration_ms=27505
 *
 * The loop took the FIRST function call (`out.find`) but pushed the WHOLE
 * output array into the conversation. When the model emitted two calls in one
 * turn, the second went into history with no `function_call_output` beside it —
 * and the Responses API rejects the NEXT request outright. So the session was
 * poisoned permanently: turn 1 returned 200, and every turn after it 502'd.
 *
 * That is exactly what the estate's live-journey gate measured — turn 1 HTTP
 * 200 in 92.7 s, turn 2 HTTP 502 in 27.7 s, 4 of 5 samples.
 */

import { describe, it, expect } from 'vitest';
import { runAgentTurn, type CallModel } from '../runtime/agent-loop.js';
import type { AgentCapabilities, AgentToolContext } from '../runtime/agent-tools.js';

const ctx: AgentToolContext = { scenario_id: 'scn', authenticated_user_id: null, request_id: 'req' };

const caps = (): AgentCapabilities => ({
  getCanonicalState: async () => ({ ok: true, mutated: false, entities: [] }),
  proposeModelChange: async () => ({ ok: true, mutated: false, proposal_id: 'prop_1' }),
  proposeAssumptions: async () => ({ ok: true, mutated: false, proposal_id: 'prop_a' }),
  proposeOptionInterventions: async () => ({ ok: true, mutated: false, proposal_id: 'prop_i' }),
  authoriseChange: async () => ({ ok: true, mutated: true, applied: true }),
  runAnalysis: async () => ({ ok: true, mutated: false, verdict: 'blocked' }),
  buildModelFromBrief: async () => ({ ok: true, mutated: true }),
} as unknown as AgentCapabilities);

/** One turn that emits TWO calls at once, then answers. */
const twoCallsThenAnswer = (): CallModel => {
  let hop = 0;
  return async () => {
    hop += 1;
    if (hop === 1) {
      return {
        output: [
          { type: 'function_call', name: 'get_canonical_state', arguments: '{}', call_id: 'call_A' },
          { type: 'function_call', name: 'run_analysis', arguments: '{"reason":"x"}', call_id: 'call_B' },
        ],
      } as never;
    }
    return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }] } as never;
  };
};

const outputsIn = (items: readonly unknown[]) =>
  items.filter((i) => (i as { type?: string }).type === 'function_call_output')
    .map((i) => (i as { call_id: string }).call_id);
const callsIn = (items: readonly unknown[]) =>
  items.filter((i) => (i as { type?: string }).type === 'function_call')
    .map((i) => (i as { call_id: string }).call_id);

describe('parallel tool calls', () => {
  it('answers EVERY call the model made — a dangling one poisons the next turn', async () => {
    const r = await runAgentTurn({
      instructions: 'i', message: 'm', history: [], ctx, maxHops: 4, maxOutputTokens: 100,
    } as never, caps(), twoCallsThenAnswer());

    // ⛔ THE INVARIANT, stated against the API contract rather than the bug:
    // every function_call in the conversation has an output with its call_id.
    expect(callsIn(r.items).sort()).toEqual(['call_A', 'call_B']);
    expect(outputsIn(r.items).sort()).toEqual(['call_A', 'call_B']);
    expect(r.tool_calls.map((c) => c.name)).toEqual(['get_canonical_state', 'run_analysis']);
    expect(r.assistant_text).toBe('done');
  });

  it('holds for a SINGLE call too — the contrast control', async () => {
    let hop = 0;
    const single: CallModel = async () => {
      hop += 1;
      if (hop === 1) {
        return { output: [{ type: 'function_call', name: 'get_canonical_state', arguments: '{}', call_id: 'only' }] } as never;
      }
      return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }] } as never;
    };
    const r = await runAgentTurn({ instructions: 'i', message: 'm', history: [], ctx, maxHops: 4, maxOutputTokens: 100 } as never, caps(), single);
    expect(callsIn(r.items)).toEqual(['only']);
    expect(outputsIn(r.items)).toEqual(['only']);
  });

  it('leaves no dangling call even at the HOP LIMIT', async () => {
    const forever: CallModel = async () => ({
      output: [
        { type: 'function_call', name: 'get_canonical_state', arguments: '{}', call_id: `a${Math.floor(Math.random() * 1e9)}` },
        { type: 'function_call', name: 'run_analysis', arguments: '{"reason":"x"}', call_id: `b${Math.floor(Math.random() * 1e9)}` },
      ],
    } as never);
    const r = await runAgentTurn({ instructions: 'i', message: 'm', history: [], ctx, maxHops: 2, maxOutputTokens: 100 } as never, caps(), forever);
    expect(r.stopped_reason).toBe('hop_limit');
    // The history it hands on must still be valid input for the NEXT request.
    expect(outputsIn(r.items).sort()).toEqual(callsIn(r.items).sort());
  });
});
