import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { buildAnalysisFromPriorFacts } from '../analysis-fallback.js';

const rows = [
  { option_id: 'unearned_zero', probability_of_goal: 0, win_probability: 0.28 },
  { option_id: 'unearned_one', probability_of_goal: 1, win_probability: 0.22 },
  { option_id: 'unrecorded', probability_of_goal: 0, win_probability: 0.18 },
  { option_id: 'earned_zero', probability_of_goal: 0, win_probability: 0.12 },
  { option_id: 'earned_one', probability_of_goal: 1, win_probability: 0.1 },
  { option_id: 'interior', probability_of_goal: 0.73, win_probability: 0.06 },
  { option_id: 'missing', win_probability: 0.04 },
];
const unearned = (option_id: string, probability_of_goal: number) => ({
  option_id, probability_of_goal, earned: false,
  unsized_path: { from: 'price', enters_goal_through: 'subscribers' },
  no_break_even: 'not_an_identity', say: 'Olumi cannot yet say how likely this is.',
});
const decisions = [
  unearned('unearned_zero', 0), unearned('unearned_one', 1),
  { option_id: 'earned_zero', probability_of_goal: 0, earned: true },
  { option_id: 'earned_one', probability_of_goal: 1, earned: true },
];
const carriers = [
  ['option_comparison', (options: unknown[]) => ({ option_comparison: options })],
  ['results[]', (options: unknown[]) => ({ results: options })],
  ['results.option_comparison', (options: unknown[]) => ({ results: { option_comparison: options } })],
  ['results.options', (options: unknown[]) => ({ results: { options } })],
  ['results.option_results', (options: unknown[]) => ({ results: { option_results: options } })],
  ['decision_brief.options', (options: unknown[]) => ({ decision_brief: { options } })],
] as const;
const fact = (enrichment: unknown, goal_certainty: unknown = decisions): HandlerFact => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: { scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', leading_option_id: 'unearned_zero',
    summary: 'The options were analysed.', graph_hash_at_run: '1234567890abcdef',
    computed_at: '2026-09-30T11:02:22.019Z', enrichment, goal_certainty },
} as HandlerFact);

describe('saved Run certainty at the follow-up analysis projection', () => {
  it.each(carriers)('confines %s before compaction without changing stored evidence', (_name, wrap) => {
    const stored = fact(wrap(structuredClone(rows)));
    const before = structuredClone(stored);
    const analysis = buildAnalysisFromPriorFacts([stored])!;
    expect(analysis).not.toBeNull();
    const byId = new Map(analysis.options.map((row) => [row.option_id, row]));
    for (const id of ['unearned_zero', 'unearned_one', 'unrecorded', 'missing']) {
      expect(byId.get(id)).not.toHaveProperty('probability_of_goal');
    }
    expect(byId.get('earned_zero')?.probability_of_goal).toBe(0);
    expect(byId.get('earned_one')?.probability_of_goal).toBe(1);
    expect(byId.get('interior')?.probability_of_goal).toBe(0.73);
    expect(byId.get('unearned_zero')?.win_probability).toBe(0.28);
    expect(stored).toEqual(before);
  });

  it.each([undefined, [], [{ option_id: 'unearned_zero', probability_of_goal: 1, earned: true }],
    [...decisions, { option_id: 'earned_one', probability_of_goal: 1, earned: true }]])(
    'does not turn an absent, mismatched or duplicate decision into earned certainty: %j', (goalCertainty) => {
      const stored = fact({ option_comparison: structuredClone(rows) });
      (stored.result as Record<string, unknown>).goal_certainty = goalCertainty;
      const options = buildAnalysisFromPriorFacts([stored])!.options;
      expect(options.find((row) => row.option_id === 'unearned_zero')).not.toHaveProperty('probability_of_goal');
      expect(options.find((row) => row.option_id === 'interior')?.probability_of_goal).toBe(0.73);
      if (Array.isArray(goalCertainty) && goalCertainty.length > decisions.length) {
        expect(options.find((row) => row.option_id === 'earned_one')).not.toHaveProperty('probability_of_goal');
      }
    });
});
