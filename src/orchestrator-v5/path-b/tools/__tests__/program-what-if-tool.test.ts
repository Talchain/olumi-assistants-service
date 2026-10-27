/**
 * HC5 in the chat (DL 27 Oct): the program board's `what_if` tool. 0 provider calls: the SDK function tool itself, on a real
 * saved program graph (the club) read through the stubbed graph route, runs the canvas what-if's engine (`runProgramWhatIf`).
 * Nothing is written: the only dispatch is the one graph read.
 */
import { describe, expect, it, vi } from 'vitest';
import { RunContext, type FunctionTool } from '@openai/agents';
import { pathBTools } from '../index.js';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import { seedOf } from '../../../model-program-turn/evaluate.js';
import { livingModelOf, MODEL_PROGRAM } from '../../../model-program-turn/program-store.js';
import { club, CLUB_BRIEF } from '../../../model-program-turn/__tests__/bakery.fixture.js';

type Rec = Record<string, any>;
const ctx = { scenario_id: '7d7bbf8f-578c-4843-8636-7e3df07c1063', authenticated_user_id: 'user-a', turn_id: 'turn-1', verified_user_messages: [], user_turn_text: '' };
const programGraph = (): Rec => ({ nodes: [], edges: [], living_model: livingModelOf({ model_program: MODEL_PROGRAM, canonical: club(), seed: seedOf(ctx.scenario_id), person_words: [CLUB_BRIEF], runs: [] }) });

function setup(scenario: 'program' | 'core', graph: Rec = programGraph()) {
  const dispatch = vi.fn(async () => ({ status: 200, json: { graph, graph_hash: 'h1', graph_identity_hash: 'i1' } }));
  const tools = pathBTools({ dispatch, proposals: new ProposalStore(), runAnalysis: vi.fn() } as never, ctx, 'core', () => {}, scenario);
  return { dispatch, tools };
}
const call = async (tools: ReturnType<typeof setup>['tools'], args: Rec): Promise<Rec> =>
  JSON.parse(await (tools.find((t) => t.name === 'what_if') as FunctionTool).invoke(new RunContext(), JSON.stringify(args)) as string);

describe('HC5: what_if in the chat on a program board', () => {
  it('a program board has five tools, what_if last; the Living Model\'s set is unchanged and has no what_if', () => {
    expect(setup('program').tools.map((t) => t.name)).toEqual(['read_canonical_context', 'propose_change', 'apply_change', 'run_analysis', 'what_if']);
    expect(setup('core').tools.map((t) => t.name)).toEqual(['read_canonical_context', 'build_model_from_brief', 'propose_change', 'apply_change', 'run_analysis', 'note_on_item', 'offer_public_research']);
    const t = setup('program').tools.find((x) => x.name === 'what_if') as FunctionTool;
    expect([t.strict, t.needsApproval === undefined || typeof t.needsApproval === 'function']).toEqual([true, true]);
  });

  it('a partner\'s figure: each option\'s chance on the saved model and with the what-if, on the same draws, nothing saved', async () => {
    const graph = programGraph(), before = structuredClone(graph);
    const { dispatch, tools } = setup('program', graph);
    const out = await call(tools, { changes: [{ quantity_id: 'base_joins', value: 24 }], whose: 'their partner\'s' });
    expect(out.status).toBe('ok');
    expect(out.mutated).toBe(false);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(graph).toEqual(before);
    const w = out.data.what_if;
    expect([w.persisted, w.whose, w.changes_refused, w.changes_applied]).toEqual([false, 'their partner\'s', [], [{ index: 0, target: { node_id: 'base_joins' } }]]);
    const carry = w.variants[0].options.find((o: Rec) => o.option_id === 'carry_on');
    expect([w.variants[0].change_index, w.variants[0].paired, carry.saved.display, carry.what_if.display, carry.variation]).toEqual(['all', true, '0%', '100%', 'beyond_ordinary_variation']);
  });

  it('a figure that is worked out is refused by name; nothing tried is a refusal; a board that is not a program is refused', async () => {
    const worked = await call(setup('program').tools, { changes: [{ quantity_id: 'members', value: 400 }], whose: 'a figure to test' });
    expect(worked).toMatchObject({ status: 'refused', reason: 'no_change_applied', data: { changes_refused: [{ index: 0, words: '"members" is worked out by its relation; change one of its inputs.' }] } });
    expect(await call(setup('program').tools, { changes: [], whose: 'x' })).toMatchObject({ status: 'refused', reason: 'invalid_arguments' });
    const legacy = setup('program', { nodes: [], edges: [] });
    expect(await call(legacy.tools, { changes: [{ quantity_id: 'base_joins', value: 24 }], whose: 'x' })).toMatchObject({ status: 'refused', reason: 'not_a_model_program' });
  });
});
