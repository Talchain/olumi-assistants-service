import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { buildAnalysisResultBlock } from '../../compose.js';

const rows = [
  { option_id: 'unearned', probability_of_goal: 1, goal_probability: 1, outcome: { mean: 90_993 } },
  { option_id: 'unrecorded', probability_of_goal: 0, outcome: { mean: 74_000 } },
  { option_id: 'interior', probability_of_goal: 0.73, outcome: { mean: 82_000 } },
  { option_id: 'earned', probability_of_goal: 0, outcome: { mean: 86_000 } },
];

function fact(goalCertainty: unknown): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      leading_option_id: 'interior', summary: 'The options were analysed.',
      graph_hash_at_run: '1234567890abcdef', computed_at: '2026-09-30T11:02:22.019Z',
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: {
        option_comparison: structuredClone(rows),
        results: structuredClone(rows),
      },
      goal_certainty: goalCertainty,
    },
  } as unknown as RunAnalysisHandlerFact;
}

const decisions = [
  {
    option_id: 'unearned', probability_of_goal: 1, earned: false,
    unsized_path: { from: 'price', enters_goal_through: 'subscribers' },
    no_break_even: 'not_an_identity', say: 'Olumi cannot yet say how likely this is.',
  },
  { option_id: 'earned', probability_of_goal: 0, earned: true },
];

describe('exact goal probability at the shared Run block boundary', () => {
  it('withholds unearned and unrecorded exact values in both public option arrays without changing the stored Run', () => {
    const stored = fact(decisions);
    const before = structuredClone(stored.result);
    const block = buildAnalysisResultBlock(stored);
    for (const key of ['option_comparison', 'results']) {
      const exposed = (block.enrichment as Record<string, unknown>)[key] as Array<Record<string, unknown>>;
      expect(exposed.find((r) => r.option_id === 'unearned')).not.toHaveProperty('probability_of_goal');
      expect(exposed.find((r) => r.option_id === 'unearned')).not.toHaveProperty('goal_probability');
      expect(exposed.find((r) => r.option_id === 'unrecorded')).not.toHaveProperty('probability_of_goal');
      expect(exposed.find((r) => r.option_id === 'interior')?.probability_of_goal).toBe(0.73);
      expect(exposed.find((r) => r.option_id === 'earned')?.probability_of_goal).toBe(0);
      expect(exposed.find((r) => r.option_id === 'unearned')?.outcome).toEqual({ mean: 90_993 });
    }
    expect(stored.result).toEqual(before);
  });

  it('fails closed for absent, malformed and mismatched certainty decisions', () => {
    for (const goalCertainty of [
      undefined, [],
      [{ option_id: 'unearned', probability_of_goal: 0, earned: true }],
      [decisions[0], { option_id: 'unearned', probability_of_goal: 1, earned: true }],
    ]) {
      const block = buildAnalysisResultBlock(fact(goalCertainty));
      const exposed = (block.enrichment as Record<string, unknown>).option_comparison as Array<Record<string, unknown>>;
      expect(exposed.find((r) => r.option_id === 'unearned')).not.toHaveProperty('probability_of_goal');
      expect(exposed.find((r) => r.option_id === 'interior')?.probability_of_goal).toBe(0.73);
    }
  });
});
