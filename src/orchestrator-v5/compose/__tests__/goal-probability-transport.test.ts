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

const carriers = [
  ['option_comparison', (options: unknown[]) => ({ option_comparison: options }), ['option_comparison']],
  ['results[]', (options: unknown[]) => ({ results: options }), ['results']],
  ['results.option_comparison', (options: unknown[]) => ({ results: { option_comparison: options } }), ['results', 'option_comparison']],
  ['results.options', (options: unknown[]) => ({ results: { options } }), ['results', 'options']],
  ['results.option_results', (options: unknown[]) => ({ results: { option_results: options } }), ['results', 'option_results']],
  ['decision_brief.options', (options: unknown[]) => ({ decision_brief: { options } }), ['decision_brief', 'options']],
] as const;
const probabilityKeys = ['probability_of_goal', 'goal_probability', 'goalProbability'] as const;

function readCarrier(enrichment: unknown, path: readonly string[]): Array<Record<string, unknown>> {
  let value = enrichment;
  for (const key of path) value = (value as Record<string, unknown>)[key];
  return value as Array<Record<string, unknown>>;
}

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

  it.each(carriers)('projects all probability aliases from %s without losing honest values or missingness', (_name, wrap, path) => {
    const options = [
      { option_id: 'unearned', probability_of_goal: 1, goal_probability: 1, goalProbability: 1, win_probability: 1 },
      { option_id: 'unrecorded', probability_of_goal: 0, goal_probability: 0, goalProbability: 0 },
      { option_id: 'interior', probability_of_goal: 0.73, goal_probability: 0.73, goalProbability: 0.73 },
      { option_id: 'earned', probability_of_goal: 0, goal_probability: 0, goalProbability: 0, outcome: { mean: 72_000, std: 0 } },
      { option_id: 'earned_one', probability_of_goal: 1, goal_probability: 1, goalProbability: 1 },
      { option_id: 'missing', label: 'No recorded chance' },
    ];
    const stored = fact([...decisions, { option_id: 'earned_one', probability_of_goal: 1, earned: true }]);
    stored.result.enrichment = wrap(options);
    const before = structuredClone(stored.result);

    const exposed = readCarrier(buildAnalysisResultBlock(stored).enrichment, path);
    for (const key of probabilityKeys) {
      expect(exposed.find((r) => r.option_id === 'unearned')).not.toHaveProperty(key);
      expect(exposed.find((r) => r.option_id === 'unrecorded')).not.toHaveProperty(key);
      expect(exposed.find((r) => r.option_id === 'interior')?.[key]).toBe(0.73);
      expect(exposed.find((r) => r.option_id === 'earned')?.[key]).toBe(0);
      expect(exposed.find((r) => r.option_id === 'earned_one')?.[key]).toBe(1);
      expect(exposed.find((r) => r.option_id === 'missing')).not.toHaveProperty(key);
    }
    expect(exposed.find((r) => r.option_id === 'earned')?.outcome).toEqual({ mean: 72_000, std: 0 });
    expect(exposed.find((r) => r.option_id === 'unearned')?.win_probability).toBe(1);
    expect(stored.result).toEqual(before);
    expect(stored.result.goal_certainty).toEqual(before.goal_certainty);
  });

  it('projects every simultaneous nested copy without rewriting the stored certainty audit or unrelated fields', () => {
    const stored = fact(decisions);
    stored.result.enrichment = {
      option_comparison: structuredClone(rows),
      results: {
        option_comparison: [{ option_id: 'unearned', goalProbability: 1 }],
        options: [{ option_id: 'unearned', goal_probability: 1 }],
        option_results: [{ option_id: 'unearned', probability_of_goal: 1 }],
        summary: 'Keep the saved summary',
      },
      decision_brief: { options: [{ option_id: 'unearned', goalProbability: 1 }], heading: 'Saved brief' },
    };
    const before = structuredClone(stored.result);
    const exposed = buildAnalysisResultBlock(stored).enrichment as Record<string, unknown>;
    for (const path of [
      ['option_comparison'], ['results', 'option_comparison'], ['results', 'options'],
      ['results', 'option_results'], ['decision_brief', 'options'],
    ]) {
      const row = readCarrier(exposed, path).find((r) => r.option_id === 'unearned');
      for (const key of probabilityKeys) expect(row).not.toHaveProperty(key);
    }
    expect((exposed.results as Record<string, unknown>).summary).toBe('Keep the saved summary');
    expect((exposed.decision_brief as Record<string, unknown>).heading).toBe('Saved brief');
    expect(stored.result).toEqual(before);
  });
});
