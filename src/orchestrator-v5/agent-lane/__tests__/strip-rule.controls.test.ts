import { describe, expect, it } from 'vitest';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { pruneSupersededToolOutputs } from '../history-store.js';
import { claimPermissionsFrom } from '../first-analysis.js';
import { GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED } from '../goal-chance-withheld.js';

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

async function canonicalState(kind: 'complete_current' | 'complete_stale', stored: unknown, res: unknown = result, extra: Record<string, unknown> = {}) {
  const analysis_state = { run_state: { kind, computed_at: COMPUTED_AT, graph_hash_at_run: HASH }, ...extra };
  const dispatch: InternalDispatch = async (path) => path.endsWith('/graph')
    ? { status: 200, json: { graph, graph_hash: HASH, analysis_state, analysis_result: res, analysis_goal_certainty: stored } }
    : { status: 500, json: {} };
  return createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState(ctx) as Promise<Record<string, any>>;
}



// P0 partner controls for the DL strip rule (#75 5902212789 / 5902287038 item 3). Public APIs only.
const RUN_FACT = /"(outcome|p10|p50|p90|mean|probability_of_goal|win_probabilit\w*|leader_may_be_named|withheld_reason|what_is_missing|goal_chance|goal_certainty|option_comparison|summary)"/;
const NARRATION = 'OLDNARRATION £59 meets the under-4% churn constraint in some simulated cases.';
const LEADER = { permitted: false, withheld_reason: 'constraint_verdict_withheld' };
const stateOf = (kind: string, computed_at = COMPUTED_AT) => ({ run_state: { kind, computed_at, graph_hash_at_run: HASH }, leader_claim: LEADER });
const runOutput = (computed_at = COMPUTED_AT) => ({
  ok: true, mutated: false, ran: true, status: 'ready', what_is_missing: NARRATION, blockers: [], options: [],
  result: { ...result, summary: 'OLDSUMMARY Raise price leads.' },
  claim_permissions: claimPermissionsFrom(stateOf('complete_current', computed_at), undefined, { requested: true }),
  run_identity: { scenario_id: SCENARIO, graph_hash_at_run: HASH, computed_at },
});
const readbackOf = (kind: 'complete_current' | 'complete_stale', computed_at = COMPUTED_AT) => ({
  scenarioId: SCENARIO,
  analysisState: stateOf(kind, computed_at),
  // A JSON round-trip: the persisted copy is never the tool output's own object.
  analysisResult: kind === 'complete_current' ? JSON.parse(JSON.stringify(result)) : undefined,
  goalCertainty: kind === 'complete_current' ? decisions : undefined,
});
const keptOf = (value: unknown, rb: unknown) => {
  const items = pruneSupersededToolOutputs([
    { type: 'function_call', name: 'run_analysis', call_id: 'run', arguments: '{}' },
    { type: 'function_call_output', call_id: 'run', output: JSON.stringify(value) },
  ], [], rb as never);
  return JSON.parse((items[1] as { output: string }).output) as Record<string, any>;
};

describe('P0 partner controls: DL strip rule', () => {
  it('POSITIVE CONTROL (fixture is live): the canonical current Run has a selected withheld permission', () => {
    expect(claimPermissionsFrom(stateOf('complete_current'), undefined, { requested: true }).leader_may_be_named).toBe(false);
  });
  it('T4 liveness: current Run -> history keeps 0 Run facts AND the canonical read still gives every saved outcome', async () => {
    const kept = keptOf(runOutput(), readbackOf('complete_current'));
    expect(JSON.stringify(kept)).not.toMatch(RUN_FACT);
    expect(JSON.stringify(kept)).not.toMatch(/OLDNARRATION|OLDSUMMARY/);
    const state = await canonicalState('complete_current', decisions);
    const withOutcome = (state.analysis.saved_run_options ?? []).filter((o: any) => o.outcome !== undefined);
    expect(withOutcome.map((o: any) => o.option_id)).toEqual(['hold', 'raise', 'split']);
  });
  it('STALE control: an old Run gives 0 figures in history AND in the canonical read', async () => {
    const kept = keptOf(runOutput(), readbackOf('complete_stale'));
    expect(JSON.stringify(kept)).not.toMatch(RUN_FACT);
    const state = await canonicalState('complete_stale', decisions);
    expect(state.analysis.saved_run_options).toBeUndefined();
    expect(JSON.stringify(state)).not.toMatch(/"p10"|"p50"|"p90"/);
  });
  it('SUPERSEDED control: a later Run on the same graph gives 0 figures from the old tool copy', () => {
    const kept = keptOf(runOutput('2026-09-29T12:00:00.000Z'), readbackOf('complete_current'));
    expect(JSON.stringify(kept)).not.toMatch(RUN_FACT);
  });
  it('D3: a PLoT #416-withheld current Run gives the rule and 0 goal values', async () => {
    const warned = { ...result, enrichment: { ...result.enrichment,
      inference_warnings: [{ code: GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED, message: 'Not shown. MRR adds price and subscribers.', node_ids: ['goal'] }] } };
    const state = await canonicalState('complete_current', undefined, warned);
    expect(state.analysis.goal_chance?.withheld).toBe(true);
    expect((state.analysis.saved_run_options ?? []).some((o: any) => o.outcome !== undefined)).toBe(false);
  });
  it('IDEMPOTENT: re-pruning the kept marker is byte-identical', () => {
    const once = keptOf(runOutput(), readbackOf('complete_current'));
    expect(keptOf(once, readbackOf('complete_current'))).toEqual(once);
  });
});

