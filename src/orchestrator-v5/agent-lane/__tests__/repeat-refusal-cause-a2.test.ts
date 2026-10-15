import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { runAgentTurn, REPEATED_REFUSAL_NARRATION, type CallModel } from '../runtime/agent-loop.js';
import { ProposalStore } from '../proposal.js';

/**
 * ⭐ Lane A A2 / AIE-05 (founder run 34a4a4cb: nine propose_change refusals, one per turn, none remembered). A refused call is
 * remembered across turns in the existing history, with what its cause depended on: the same call on an unchanged saved
 * revision and unchanged typed words is not run again; a new revision, a new typed message, a recovered service or changed
 * arguments run it. A same-code refusal never blocks a changed-argument retry.
 */
const tool = 'propose_option_interventions';
const brief = 'We need to raise £250,000 in seed funding within six months.';
const DETAIL = 'The revised draft names no target for the goal.';
const RULE = 'Do not repeat the same call while its arguments and relevant cause remain unchanged';
const graph = { nodes: [{ id: 'goal', kind: 'goal', label: 'Funding raised' }], edges: [] };
const argsA = { interventions: [{ option_label: 'a', factor_label: 'goal', value: 1 }] };
const argsB = { interventions: [{ option_label: 'b', factor_label: 'goal', value: 2 }] };
const say = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'That change needs a target first.' }] }];

interface Turn { history?: readonly unknown[]; revision?: string | null; typed?: string[]; calls?: object[]; codes?: (string | null)[] }
async function turn({ history = [], revision = 'rev-1', typed = [brief], calls = [argsA], codes = ['revised_draft_has_no_target'] }: Turn) {
  const store = new ProposalStore();
  const d: InternalDispatch = async () => ({ status: 200, json: { graph, graph_hash: 'h0' } });
  const caps = createAgentCapabilities(d, store);
  let dispatches = 0;
  const guarded = { ...caps, proposeOptionInterventions: async () => {
    const code = codes[Math.min(dispatches++, codes.length - 1)];
    return code === null ? { ok: true, mutated: false, proposal_id: 'p1' } : { ok: false, mutated: false, refusal: code, detail: DETAIL };
  } };
  let hop = 0;
  const model: CallModel = async () => {
    const args = calls[hop];
    hop += 1;
    return { output: args === undefined ? say : [{ type: 'function_call', name: tool, call_id: `c${hop}-${history.length}`, arguments: JSON.stringify(args) }] };
  };
  const ctx = { scenario_id: '0a2a2a2a-0000-4000-8000-000000000000', authenticated_user_id: 'user', request_id: 'a2', user_text: typed.join('\n'),
    user_turn_text: typed[typed.length - 1], verified_user_messages: typed };
  const canonicalContext = revision === null ? undefined : { packet: null, expectation: {
    scenario_id: ctx.scenario_id, authenticated_user_id: 'user', graph_revision: revision, current_turn: 0, binding_secret: 's' } };
  const result = await runAgentTurn({ ctx, history, message: typed[typed.length - 1], instructions: 'i', maxOutputTokens: 200, maxHops: 6,
    ...(canonicalContext === undefined ? {} : { canonicalContext }) }, guarded, model);
  const outputs = result.items.filter((i) => (i as { type?: string }).type === 'function_call_output').map((i) => JSON.parse(String((i as { output: unknown }).output)));
  return { result, dispatches, outputs };
}

describe('A2: a refusal is remembered across turns with its cause, and only an unchanged call on an unchanged cause is not re-run', () => {
  it('RED→GREEN founder shape: the same call, same revision, same typed words → not dispatched; the remembered reason and the AIE-05 rule are returned', async () => {
    const first = await turn({});
    expect(first.dispatches).toBe(1);
    expect(first.outputs[0]).toMatchObject({ ok: false, refusal: 'revised_draft_has_no_target', retry_basis: { model_revision: 'rev-1' } });
    const again = await turn({ history: first.result.items });
    expect(again.dispatches, 'the unchanged call is not run again').toBe(0);
    expect(again.result.tool_results[0]).toMatchObject({ ok: false, mutated: false, refusal: 'revised_draft_has_no_target', repeat_unchanged: true });
    expect(String(again.result.tool_results[0]!.detail)).toContain(RULE);
    expect(String(again.result.tool_results[0]!.detail)).toContain(`${tool} returned revised_draft_has_no_target: ${DETAIL}`);
    expect(again.result.tool_calls.map((c) => c.mutated)).toEqual([false]);
    // A third unchanged turn returns the same words: the rule is never nested inside its own detail.
    const third = await turn({ history: again.result.items });
    expect(third.dispatches).toBe(0);
    expect(String(third.result.tool_results[0]!.detail).split(RULE)).toHaveLength(2);
    expect(String(third.result.tool_results[0]!.detail)).toContain(`returned revised_draft_has_no_target: ${DETAIL}`);
  });
  it('the narration is the AIE-05 text', () => {
    expect(REPEATED_REFUSAL_NARRATION).toBe('{tool} returned {refusal}: {detail}. Preserve its actual write/readback outcome. Reuse the supplied words, corrections and known source. Do not repeat the same call while its arguments and relevant cause remain unchanged. A changed relevant fact, saved revision or recovered service permits a new attempt; a new turn alone does not repair the cause. Explain once whether the obstacle is genuinely missing meaning or a drafting/application limitation, then give one supported next step.');
  });
  it('CONTRAST a new typed message (a changed relevant fact) runs the call', async () => {
    const first = await turn({});
    const again = await turn({ history: first.result.items, typed: [brief, 'The target is £250,000 by April.'] });
    expect(again.dispatches).toBe(1);
    expect(again.result.tool_results[0]).not.toHaveProperty('repeat_unchanged');
  });
  it('CONTRAST a new saved revision runs the call', async () => {
    const first = await turn({});
    expect((await turn({ history: first.result.items, revision: 'rev-2' })).dispatches).toBe(1);
  });
  it('CONTRAST changed arguments run the call', async () => {
    const first = await turn({});
    expect((await turn({ history: first.result.items, calls: [argsB] })).dispatches).toBe(1);
  });
  it('CONTRAST a transient refusal is never remembered: no basis on its output, and the next turn runs the call', async () => {
    const first = await turn({ codes: ['service_unavailable'] });
    expect(first.outputs[0]).not.toHaveProperty('retry_basis');
    expect((await turn({ history: first.result.items })).dispatches).toBe(1);
  });
  it('CONTRAST no known revision never blocks, and records no basis', async () => {
    const first = await turn({});
    expect((await turn({ history: first.result.items, revision: null })).dispatches).toBe(1);
    expect((await turn({ revision: null })).outputs[0]).not.toHaveProperty('retry_basis');
  });
  it('CONTRAST a later success of the same call clears the memory, even when the revision returns to the refused one (an undo)', async () => {
    const first = await turn({});
    const ok = await turn({ history: first.result.items, revision: 'rev-2', codes: [null] });
    expect(ok.dispatches).toBe(1);
    expect((await turn({ history: ok.result.items, revision: 'rev-1' })).dispatches).toBe(1);
  });
  it('within one turn: the same refusal code on CHANGED arguments never withholds the tool (AIE-05)', async () => {
    const r = await turn({ calls: [argsA, argsB, argsA] });
    expect(r.dispatches, 'both changed-argument attempts and the first repeat run').toBe(3);
    // The same call refused twice for the same code within the turn is the existing guard (R3); here only argsA repeats once.
    expect(r.result.tool_calls.map((c) => c.refusal)).toEqual(['revised_draft_has_no_target', 'revised_draft_has_no_target', 'revised_draft_has_no_target']);
  });
});
