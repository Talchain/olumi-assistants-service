/**
 * The loop carries messages and executes tools. It never composes an answer.
 */

import { describe, it, expect } from 'vitest';
import { runAgentTurn, type CallModel } from '../runtime/agent-loop.js';
import type { AgentCapabilities, AgentToolContext, ToolResult } from '../runtime/agent-tools.js';

const ctx: AgentToolContext = { scenario_id: 'scn', authenticated_user_id: null, request_id: 'req' };

const caps = (over: Partial<AgentCapabilities> = {}): AgentCapabilities => ({
  getCanonicalState: async () => ({ ok: true, mutated: false, entities: [] }),
  proposeModelChange: async () => ({ ok: true, mutated: false, proposal_id: 'prop_1' }),
  authoriseChange: async () => ({ ok: true, mutated: true, applied: true }),
  runAnalysis: async () => ({ ok: true, mutated: false, verdict: 'blocked' }),
  buildModelFromBrief: async () => ({ ok: true, mutated: true }),
  ...over,
});

const say = (text: string) => [{ type: 'message', content: [{ type: 'output_text', text }] }];
const callTool = (name: string, args = '{}') => [
  { type: 'reasoning', id: 'rs_1' },
  { type: 'function_call', name, call_id: 'call_1', arguments: args },
];

describe('runAgentTurn', () => {
  it('returns the Agent’s own text and makes no tool call when none is chosen', async () => {
    const model: CallModel = async () => ({ output: say('Here is my answer.') });
    const r = await runAgentTurn({ ctx, history: [], message: 'hello', instructions: 'i', maxOutputTokens: 100 }, caps(), model);
    expect(r.assistant_text).toBe('Here is my answer.');
    expect(r.tool_calls).toHaveLength(0);
    expect(r.mutated).toBe(false);
    expect(r.stopped_reason).toBe('answered');
  });

  it('echoes the REASONING item back with the call — the API refuses otherwise', async () => {
    const seen: unknown[][] = [];
    let hop = 0;
    const model: CallModel = async (req) => {
      seen.push([...req.input]);
      return { output: hop++ === 0 ? callTool('get_canonical_state', '{"reason":"x"}') : say('done') };
    };
    await runAgentTurn({ ctx, history: [], message: 'what is in the model?', instructions: 'i', maxOutputTokens: 100 }, caps(), model);
    const second = seen[1] as Record<string, unknown>[];
    expect(second.some((i) => i.type === 'reasoning'), 'reasoning item must be replayed').toBe(true);
    expect(second.some((i) => i.type === 'function_call')).toBe(true);
    const idx = second.findIndex((i) => i.type === 'function_call');
    expect(second[idx + 1].type, 'the tool result follows the call').toBe('function_call_output');
  });

  it('reports mutation ONLY when a tool actually changed something', async () => {
    let hop = 0;
    const model: CallModel = async () => ({ output: hop++ === 0 ? callTool('authorise_change', '{"proposal_id":"p"}') : say('applied') });
    const applied = await runAgentTurn({ ctx, history: [], message: 'yes', instructions: 'i', maxOutputTokens: 100 }, caps(), model);
    expect(applied.mutated).toBe(true);

    hop = 0;
    const refusedCaps = caps({ authoriseChange: async (): Promise<ToolResult> => ({ ok: false, mutated: false, refusal: 'not_applied' }) });
    const refused = await runAgentTurn({ ctx, history: [], message: 'yes', instructions: 'i', maxOutputTokens: 100 }, refusedCaps, model);
    expect(refused.mutated, 'a refused write is not a mutation').toBe(false);
  });

  it('never lets the Agent supply the scenario or the user — context is bound', async () => {
    let seenCtx: AgentToolContext | undefined;
    const model: CallModel = async () => ({ output: callTool('get_canonical_state', '{"reason":"x","scenario_id":"someone-elses"}') });
    const spy = caps({ getCanonicalState: async (c) => { seenCtx = c; return { ok: true, mutated: false }; } });
    await runAgentTurn({ ctx, history: [], message: 'x', instructions: 'i', maxOutputTokens: 100, maxHops: 1 }, spy, model);
    expect(seenCtx).toEqual(ctx);
  });

  it('an unknown tool is refused explicitly, not ignored', async () => {
    let hop = 0;
    const model: CallModel = async () => ({ output: hop++ === 0 ? callTool('delete_everything') : say('ok') });
    const r = await runAgentTurn({ ctx, history: [], message: 'x', instructions: 'i', maxOutputTokens: 100 }, caps(), model);
    // The record now also names WHY it was refused — an unknown tool must not
    // read the same as a tool that ran and honestly returned ok:false.
    expect(r.tool_calls[0]).toEqual({ name: 'delete_everything', ok: false, mutated: false, refusal: 'unknown_tool' });
  });

  it('a hop limit is REPORTED, never disguised as an empty answer', async () => {
    const model: CallModel = async () => ({ output: callTool('get_canonical_state', '{"reason":"loop"}') });
    const r = await runAgentTurn({ ctx, history: [], message: 'x', instructions: 'i', maxOutputTokens: 100, maxHops: 3 }, caps(), model);
    expect(r.stopped_reason).toBe('hop_limit');
    expect(r.hops).toBe(3);
    expect(r.tool_calls).toHaveLength(3);
  });

  it('carries prior history so context is retained across turns', async () => {
    const seen: unknown[][] = [];
    const model: CallModel = async (req) => { seen.push([...req.input]); return { output: say('ok') }; };
    const history = [{ role: 'user', content: [{ type: 'input_text', text: 'earlier turn' }] }];
    await runAgentTurn({ ctx, history, message: 'later turn', instructions: 'i', maxOutputTokens: 100 }, caps(), model);
    expect(JSON.stringify(seen[0])).toContain('earlier turn');
    expect(JSON.stringify(seen[0])).toContain('later turn');
  });
});

describe('the tool-call record carries the identity a witness needs', () => {
  it('surfaces proposal_id, so an authorisation can be bound to the offer', async () => {
    // ⛔ WITHOUT THIS THE WIRE CANNOT DISTINGUISH the contract holding from the
    // contract being broken: an `authorise_change` that applied the offered
    // proposal and one that regenerated a mutation after "yes" both record
    // `{name, ok, mutated}` and nothing else. Matching the prose is not a bind.
    const caps = {
      getCanonicalState: async () => ({ ok: true, mutated: false }),
      proposeModelChange: async () => ({ ok: true, mutated: false, proposal_id: 'prop_abc' }),
      authoriseChange: async () => ({ ok: true, mutated: true, proposal_id: 'prop_abc', outcome: 'execute' }),
      runAnalysis: async () => ({ ok: true, mutated: false }),
      buildModelFromBrief: async () => ({ ok: true, mutated: true }),
    };
    let turn = 0;
    const callModel = async () => {
      turn += 1;
      if (turn === 1) {
        return { output: [{ type: 'function_call', name: 'authorise_change', call_id: 'c1', arguments: '{"proposal_id":"prop_abc"}' }] };
      }
      return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'done' }] }] };
    };
    const r = await runAgentTurn(
      { ctx: { scenario_id: 's', authenticated_user_id: 'u', request_id: 'r' }, history: [], message: 'yes', instructions: 'i', maxOutputTokens: 100 },
      caps as never,
      callModel as never,
    );
    const applied = r.tool_calls.find((c) => c.name === 'authorise_change');
    expect(applied?.proposal_id).toBe('prop_abc');
    expect(applied?.outcome).toBe('execute');
  });
});
