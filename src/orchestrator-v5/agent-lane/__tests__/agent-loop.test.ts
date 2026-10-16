/**
 * The loop carries messages and executes tools. It never composes an answer.
 */

import { describe, it, expect } from 'vitest';
import { runAgentTurn, type CallModel } from '../runtime/agent-loop.js';
import { RUN_FACTS_USE } from '../run-facts.js';
import type { AgentCapabilities, AgentToolContext, ToolResult } from '../runtime/agent-tools.js';

const ctx: AgentToolContext = { scenario_id: 'scn', authenticated_user_id: null, request_id: 'req' };

const caps = (over: Partial<AgentCapabilities> = {}): AgentCapabilities => ({
  getCanonicalState: async () => ({ ok: true, mutated: false, entities: [] }),
  proposeModelChange: async () => ({ ok: true, mutated: false, proposal_id: 'prop_1' }),
  authoriseChange: async () => ({ ok: true, mutated: true, applied: true }),
  runAnalysis: async () => ({ ok: true, mutated: false, verdict: 'blocked' }),
  // A REQUIRED member of AgentCapabilities. Omitting it made the whole object
  // unassignable (TS2322) — no test here dispatches it, but the stub must still
  // be the shape the interface declares, or it is not standing in for anything.
  buildModelFromBrief: async () => ({ ok: true, mutated: true }),
  // Same reason as buildModelFromBrief above: every member the interface
  // declares must be present, or the stub is not standing in for anything.
  proposeAssumptions: async () => ({ ok: true, mutated: false, proposal_id: 'prop_a' }),
  // #1788's add-option capability — a REQUIRED member; without it the typed mock no longer satisfies AgentCapabilities.
  proposeNewOption: async () => ({ ok: true, mutated: false, proposal_id: 'prop_n' }),
  proposeOptionInterventions: async () => ({ ok: true, mutated: false, proposal_id: 'prop_i' }),
  proposeStartingPoint: async () => ({ ok: true, mutated: false, proposal_id: 'prop_s' }),
  // The goal's current level (`goal-current-level.ts`) — a REQUIRED member, for the same reason as the rest.
  proposeGoalCurrentLevel: async () => ({ ok: true, mutated: false, proposal_id: 'prop_g' }),
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

describe('R2 Run instruction discovered by a tool', () => {
  it.each([
    { name: 'founder', brief: 'My current funding target is £250k within 60 hours per week.' },
    { name: 'capacity', brief: 'Capacity is 80 tickets per week; the target is at least 100.' },
  ].flatMap(brief => [1, 2].map(callCount => ({ ...brief, callCount }))))('$name ($callCount calls): the first instruction follows every paired function_call_output', async ({ brief, callCount }) => {
    const sent: unknown[][] = [];
    const facts = { current: true, must_say: ['These are provisional estimates.'], user_statements: [brief] };
    const model: CallModel = async req => {
      sent.push(structuredClone([...req.input]));
      const calls = callTool('get_canonical_state');
      if (callCount === 2) calls.push({ type: 'function_call', name: 'get_canonical_state', call_id: 'call_2', arguments: '{}' });
      return { output: sent.length === 1 ? calls : say('The model remains provisional.') };
    };
    const result = await runAgentTurn({ ctx, history: [], message: brief, briefText: brief,
      instructions: 'Use the supplied facts.', maxOutputTokens: 100 },
    caps({ getCanonicalState: async () => ({ ok: true, mutated: false, run_facts: { ...facts, use: RUN_FACTS_USE } }) }), model);
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent[0])).not.toContain(RUN_FACTS_USE);
    const hop2 = sent[1] as Record<string, any>[];
    const callIndex = hop2.findIndex(i => i.type === 'function_call' && i.call_id === 'call_1');
    const outputIndex = hop2.findIndex(i => i.type === 'function_call_output' && i.call_id === 'call_1');
    expect(callIndex).toBeGreaterThan(0);
    expect(outputIndex, 'the outputs immediately follow all calls, with no intervening instruction').toBe(callIndex + callCount);
    const instructionIndex = hop2.findIndex(i => i.role === 'developer' && i.content?.[0]?.text === RUN_FACTS_USE);
    expect(instructionIndex).toBeGreaterThan(outputIndex);
    if (callCount === 2) {
      const secondCallIndex = hop2.findIndex(i => i.type === 'function_call' && i.call_id === 'call_2');
      const secondOutputIndex = hop2.findIndex(i => i.type === 'function_call_output' && i.call_id === 'call_2');
      expect(secondCallIndex).toBe(callIndex + 1);
      expect(secondOutputIndex).toBe(outputIndex + 1);
      expect(instructionIndex, 'a discovered instruction must follow every output in the hop').toBeGreaterThan(secondOutputIndex);
      expect(JSON.parse(hop2[secondOutputIndex]!.output).run_facts).toEqual(facts);
    }
    expect(hop2.filter(i => i.content?.[0]?.text === RUN_FACTS_USE)).toHaveLength(1);
    expect(JSON.parse(hop2[outputIndex]!.output).run_facts).toEqual(facts);
    expect(JSON.stringify(result.items)).not.toContain(RUN_FACTS_USE);
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
