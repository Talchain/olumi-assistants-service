import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { pruneSupersededToolOutputs } from '../history-store.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440079';
const HASH = '7b53bf0ada890991';
const COMPUTED_AT = '2026-09-29T13:07:48.159Z';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'saved-run-context' };
const decisions = [
  { option_id: 'hold', probability_of_goal: 0, earned: true },
  { option_id: 'raise', probability_of_goal: 0, earned: false,
    unsized_path: { from: 'price', enters_goal_through: 'price' }, no_break_even: 'not_an_identity',
    say: 'Olumi cannot yet say how likely raising the price is to miss the goal.' },
];
const result = {
  computed_against_hash: HASH,
  enrichment: { option_comparison: [
    { option_id: 'hold', option_label: 'Hold price', probability_of_goal: 0, win_probability: 0.1,
      outcome: { mean: 75000, p10: 74000, p90: 76000 } },
    { option_id: 'raise', option_label: 'Raise price', probability_of_goal: 0, win_probability: 0.7,
      outcome: { mean: 77000, p10: 75000, p90: 79000 } },
    { option_id: 'split', option_label: 'Split difference', probability_of_goal: 0.42, win_probability: 0.2,
      outcome: { mean: 76500, p10: 74500, p90: 78500 } },
    { option_id: 'unknown', option_label: 'Unknown outcome', probability_of_goal: 0.3 },
  ] },
};
const graph = { nodes: [
  { id: 'price', kind: 'factor', label: 'Price' },
  { id: 'goal', kind: 'goal', label: 'MRR' },
  { id: 'hold', kind: 'option', label: 'Hold price' },
  { id: 'raise', kind: 'option', label: 'Raise price' },
  { id: 'split', kind: 'option', label: 'Split difference' },
  { id: 'unknown', kind: 'option', label: 'Unknown outcome' },
], edges: [] };

async function canonicalState(kind: 'complete_current' | 'complete_stale', stored: unknown) {
  const analysis_state = { run_state: { kind, computed_at: COMPUTED_AT, graph_hash_at_run: HASH } };
  const dispatch: InternalDispatch = async (path) => path.endsWith('/graph')
    ? { status: 200, json: { graph, graph_hash: HASH, analysis_state, analysis_result: result, analysis_goal_certainty: stored } }
    : { status: 500, json: {} };
  return createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState(ctx) as Promise<Record<string, any>>;
}

describe('saved Run reaches later Agent context without inventing certainty', () => {
  it('a current selected Run carries its recorded earned zero and unearned explanation', async () => {
    const state = await canonicalState('complete_current', decisions);
    expect(state.ok).toBe(true);
    expect(state.analysis.goal_certainty).toMatchObject({ options: [
      { option_id: 'hold', probability_of_goal: 0, earned: true },
      { option_id: 'raise', earned: false, say: decisions[1]!.say },
    ] });
    expect(state.analysis.goal_certainty.options[1]).not.toHaveProperty('probability_of_goal');
    expect(state.analysis.saved_run_options).toEqual([
      { option_id: 'hold', option_label: 'Hold price', outcome: result.enrichment.option_comparison[0]!.outcome,
        goal_certainty: state.analysis.goal_certainty.options[0] },
      { option_id: 'raise', option_label: 'Raise price', outcome: result.enrichment.option_comparison[1]!.outcome,
        goal_certainty: state.analysis.goal_certainty.options[1] },
      { option_id: 'split', option_label: 'Split difference', outcome: result.enrichment.option_comparison[2]!.outcome },
      { option_id: 'unknown', option_label: 'Unknown outcome' },
    ]);
    expect(JSON.stringify(state.analysis.saved_run_options)).not.toContain('win_probability');
    expect(state.analysis.saved_run_options[1].goal_certainty).not.toHaveProperty('probability_of_goal');
    expect(state.analysis.goal_certainty.note).toMatch(/never call its chance 100% or 0%/);
  });

  it.each([
    ['stale', 'complete_stale', decisions],
    ['record absent', 'complete_current', undefined],
    ['record refused', 'complete_current', [{ option_id: 'raise', probability_of_goal: 0, earned: true }]],
  ] as const)('%s Run certainty is unchecked', async (_label, kind, stored) => {
    const state = await canonicalState(kind, stored);
    expect(state.analysis.goal_certainty).toMatchObject({ unchecked: true });
    expect(state.analysis.goal_certainty).not.toHaveProperty('options');
    if (kind === 'complete_stale') expect(state.analysis).not.toHaveProperty('saved_run_options');
  });

  it('a withheld Run kept for a follow-up retains current outcomes and only earned certainty', () => {
    const goal_certainty = { options: [
      { option_id: 'hold', probability_of_goal: 0, earned: true },
      { option_id: 'raise', probability_of_goal: 0, earned: false, say: decisions[1]!.say },
    ] };
    const run = { ok: true, ran: true, result, claim_permissions: { leader_may_be_named: false }, goal_certainty,
      run_identity: { scenario_id: SCENARIO, graph_hash_at_run: HASH, computed_at: COMPUTED_AT } };
    const kept = pruneSupersededToolOutputs([
      { type: 'function_call', call_id: 'run-1', name: 'run_analysis', arguments: '{}' },
      { type: 'function_call_output', call_id: 'run-1', output: JSON.stringify(run) },
    ], [], { scenarioId: SCENARIO, analysisState: { run_state: { kind: 'complete_current', computed_at: COMPUTED_AT } }, analysisResult: result });
    const output = JSON.parse((kept[1] as { output: string }).output);
    expect(output.stale).toBeUndefined();
    expect(output.goal_certainty.options).toEqual([
      { option_id: 'hold', probability_of_goal: 0, earned: true },
      { option_id: 'raise', earned: false, say: decisions[1]!.say },
    ]);
    expect(output.result.option_comparison).toMatchObject([
      { option_id: 'hold', outcome: { mean: 75000 } },
      { option_id: 'raise', outcome: { mean: 77000 }, say: decisions[1]!.say },
      { option_id: 'split', outcome: { mean: 76500 } },
      { option_id: 'unknown' },
    ]);
    expect(output.result.option_comparison[3]).not.toHaveProperty('outcome');
    expect(JSON.stringify(output)).not.toContain('win_probability');
    expect(output.goal_certainty.options[1]).not.toHaveProperty('probability_of_goal');
  });
});
