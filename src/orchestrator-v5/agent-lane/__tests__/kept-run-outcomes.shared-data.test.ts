import { describe, expect, it } from 'vitest';
import { pruneSupersededToolOutputs, type KeptRunReadback } from '../history-store.js';

const SCENARIO = '550e8400-e29b-41d4-a716-446655440079';
const HASH = '7b53bf0ada890991';
const RUN_AT = '2026-09-29T13:07:48.159Z';
const LATER_AT = '2026-09-29T13:08:49.159Z';
const outcomes = [
  { p10: 72_000, p50: 75_000, p90: 78_000, mean: 75_000 },
  { p10: 75_000, p50: 76_250, p90: 77_500, mean: 76_250 },
  { p10: 75_000, p50: 77_450, p90: 79_900, mean: 77_450 },
];
const rows = [
  { option_id: 'p49', option_label: 'Keep £49', outcome: outcomes[0], win_probability: 0.1, probability_of_goal: 0 },
  { option_id: 'p54', option_label: 'Raise to £54', outcome: outcomes[1], win_probability: 0.3, probability_of_goal: 1 },
  { option_id: 'p59', option_label: 'Raise to £59', outcome: outcomes[2], win_probability: 0.6, probability_of_goal: 1 },
];
const result = {
  summary: 'No option can be put forward because the churn limit was not shown to be met.',
  computed_against_hash: HASH,
  win_probabilities: { p49: 0.1, p54: 0.3, p59: 0.6 },
  enrichment: { option_comparison: rows, conditional_winners: [{ option_id: 'p59' }], flip_thresholds: [1] },
};
const goal_certainty = { options: [
  { option_id: 'p49', option: 'Keep £49', earned: true, probability_of_goal: 0 },
  { option_id: 'p54', option: 'Raise to £54', earned: false, probability_of_goal: 1, say: 'The £54 route has an unsized path to the goal.' },
  { option_id: 'p59', option: 'Raise to £59', earned: false, probability_of_goal: 1, say: 'The £59 route has an unsized path to the goal.' },
] };
const run = {
  ok: true, ran: true, result,
  claim_permissions: { leader_may_be_named: false, withheld_reason: 'constraint_verdict_withheld' },
  goal_certainty,
  run_identity: { scenario_id: SCENARIO, graph_hash_at_run: HASH, computed_at: RUN_AT },
};
const readback = (computed_at = RUN_AT, kind = 'complete_current' as 'complete_current' | 'complete_stale') => ({
  scenarioId: SCENARIO,
  analysisState: { run_state: { kind, computed_at } },
  analysisResult: kind === 'complete_current' ? result : undefined,
});
const pair = (value: unknown) => [
  { type: 'function_call', name: 'run_analysis', call_id: 'run', arguments: '{}' },
  { type: 'function_call_output', call_id: 'run', output: JSON.stringify(value) },
];
const projected = (value: unknown, selected: KeptRunReadback | undefined) => {
  const items = pruneSupersededToolOutputs(pair(value), [], selected);
  return JSON.parse((items[1] as { output: string }).output) as Record<string, any>;
};

describe('AIQ #72: one selected Run, outcome ranges without a leader', () => {
  it('R1 current: each recorded range stays in source order, an unearned range carries its own say, and ranking stays dropped', () => {
    const kept = projected(run, readback());
    expect(kept.stale).toBeUndefined();
    expect(kept.result.option_comparison).toEqual([
      { option_id: 'p49', label: 'Keep £49', outcome: outcomes[0] },
      { option_id: 'p54', label: 'Raise to £54', outcome: outcomes[1], say: goal_certainty.options[1]!.say },
      { option_id: 'p59', label: 'Raise to £59', outcome: outcomes[2], say: goal_certainty.options[2]!.say },
    ]);
    expect(kept.result.win_probabilities).toBeUndefined();
    expect(kept.result.conditional_winners).toBeUndefined();
    expect(kept.result.flip_thresholds).toBeUndefined();
    expect(kept.result.enrichment).toBeUndefined();
    expect(kept.claim_permissions.withheld_reason).toBe('constraint_verdict_withheld');
    expect(projected(kept, readback())).toEqual(kept);
  });

  it('R3 stale after edit: the kept copy has no outcome and asks for a rerun', () => {
    const kept = projected(run, readback(RUN_AT, 'complete_stale'));
    expect(kept.stale).toBe(true);
    expect(kept.stale_note).toMatch(/Offer to run the analysis again/);
    expect(kept.result.option_comparison.every((row: Record<string, unknown>) => !('outcome' in row))).toBe(true);
    expect(kept.goal_certainty).toBeUndefined();
  });

  it('R4 absent stays absent on an otherwise current Run', () => {
    const noOutcome = { ...result, enrichment: { ...result.enrichment, option_comparison: rows.map((row, i) => i === 1 ? { option_id: row.option_id, option_label: row.option_label } : row) } };
    const kept = projected({ ...run, result: noOutcome }, { ...readback(), analysisResult: noOutcome });
    expect(kept.result.option_comparison[1]).toEqual({ option_id: 'p54', label: 'Raise to £54' });
    expect(kept.result.option_comparison[0].outcome).toEqual(outcomes[0]);
  });

  it('a same-identity tool copy cannot refill or override the selected Run’s outcomes', () => {
    const selectedRows = [
      { ...rows[2], outcome: { p10: 1, p90: 2 } },
      { option_id: 'p54', option_label: 'Raise to £54' },
      rows[0],
    ];
    const selected = { ...result, enrichment: { ...result.enrichment, option_comparison: selectedRows } };
    const kept = projected(run, { ...readback(), analysisResult: selected });
    expect(kept.result.option_comparison.map((row: Record<string, unknown>) => row.option_id)).toEqual(['p59', 'p54', 'p49']);
    expect(kept.result.option_comparison[0].outcome).toEqual({ p10: 1, p90: 2 });
    expect(kept.result.option_comparison[1]).not.toHaveProperty('outcome');
    expect(kept.result.option_comparison[2].outcome).toEqual(outcomes[0]);
  });

  it('R5 earned zero stays, unearned 0/1 does not', () => {
    const kept = projected(run, readback());
    expect(kept.goal_certainty.options).toEqual([
      { option: 'Keep £49', option_id: 'p49', earned: true, probability_of_goal: 0 },
      { option: 'Raise to £54', option_id: 'p54', earned: false, say: goal_certainty.options[1]!.say },
      { option: 'Raise to £59', option_id: 'p59', earned: false, say: goal_certainty.options[2]!.say },
    ]);
  });

  it('two Runs with the same graph hash: the older kept Run is never current', () => {
    const kept = projected(run, readback(LATER_AT));
    expect(kept.stale).toBe(true);
    expect(kept.stale_note).toMatch(/different analysis run/);
    expect(kept.result.option_comparison.every((row: Record<string, unknown>) => !('outcome' in row))).toBe(true);
    expect(kept.goal_certainty).toBeUndefined();
  });

  it('an unconfirmed or foreign-scenario read never vouches for the Run', () => {
    for (const selected of [undefined, { ...readback(), scenarioId: undefined }, { ...readback(), scenarioId: 'another-scenario' }]) {
      const kept = projected(run, selected);
      expect(kept.stale).toBe(true);
      expect(kept.result.option_comparison.every((row: Record<string, unknown>) => !('outcome' in row))).toBe(true);
    }
    expect(projected({ ...run, run_identity: undefined }, readback()).stale).toBe(true);
  });

  it('a stale projection can recover the same selected Run’s recorded ranges when readback proves identity again', () => {
    const stale = projected(run, readback(RUN_AT, 'complete_stale'));
    const current = projected(stale, readback());
    expect(current.stale).toBeUndefined();
    expect(current.result.option_comparison.map((row: Record<string, unknown>) => row.outcome)).toEqual(outcomes);
  });
});
