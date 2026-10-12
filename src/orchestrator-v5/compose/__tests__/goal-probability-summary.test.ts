import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import { buildAnalysisResultBlock } from '../../compose.js';
import { composeObjectiveContradictionDisclosure } from '../../coaching/objective-contradiction.js';

const rows = [
  { option_id: 'hold', option_label: 'Hold at £49', win_probability: 0.7, probability_of_goal: 0 },
  { option_id: 'raise', option_label: 'Raise to £59', win_probability: 0.3, probability_of_goal: 0.48 },
];
const rawDisclosure = composeObjectiveContradictionDisclosure(null, rows, true, 'goal_framed');
const unearned = [{ option_id: 'hold', probability_of_goal: 0, earned: false,
  unsized_path: { from: 'price', enters_goal_through: 'subscribers' },
  no_break_even: 'not_an_identity', say: 'Olumi cannot yet say how likely this is.' }];
const stored = (decisions: unknown): RunAnalysisHandlerFact => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: {
    scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', leading_option_id: 'hold',
    summary: 'The model was analysed.' + rawDisclosure,
    graph_hash_at_run: '1234567890abcdef', computed_at: '2026-09-30T11:02:22.019Z',
    constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
    enrichment: { option_comparison: structuredClone(rows), results: structuredClone(rows) },
    goal_certainty: decisions,
  },
} as unknown as RunAnalysisHandlerFact);

function goalClaimsIn(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => goalClaimsIn(item, `${path}[${index}]`));
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) =>
    /^(probability_of_goal|goal_probability|goalProbability)$/.test(key) && (item === 0 || item === 1)
      ? [`${path}.${key}`] : goalClaimsIn(item, `${path}.${key}`));
  return typeof value === 'string' && /\((?:0|100)% against|against (?:0|100)%\)/.test(value) ? [path] : [];
}

describe('same recorded Run certainty governs row, summary and whole public block', () => {
  it.each([undefined, [], unearned])('withholds unearned exact goal chances everywhere (%j)', (decisions) => {
    const fact = stored(decisions);
    const before = structuredClone(fact);
    const block = buildAnalysisResultBlock(fact);
    expect(rawDisclosure).toContain('(48% against 0%)');
    expect(goalClaimsIn(block)).toEqual([]);
    expect(block.summary).toBe('The model was analysed.');
    expect((block.enrichment as Record<string, unknown>).option_comparison).toEqual([
      { option_id: 'hold', option_label: 'Hold at £49', win_probability: 0.7 }, rows[1],
    ]);
    expect(fact).toEqual(before);
  });

  it('keeps earned arithmetic, interior chance, input labels and legitimate win shares', () => {
    const fact = stored([{ option_id: 'hold', probability_of_goal: 0, earned: true }]);
    const block = buildAnalysisResultBlock(fact);
    expect(block.summary).toContain('(48% against 0%)');
    expect(goalClaimsIn(block).length).toBeGreaterThan(0);
    expect(composeObjectiveContradictionDisclosure(null, rows, true, 'goal_framed',
      { goalCertainty: fact.result.goal_certainty })).toBe(rawDisclosure);
  });

  it('new summary composer reads the identical authority before making its words', () => {
    expect(composeObjectiveContradictionDisclosure(null, rows, true, 'goal_framed',
      { goalCertainty: unearned })).toBe('');
    expect(composeObjectiveContradictionDisclosure(null, rows, true, 'goal_framed',
      { goalCertainty: undefined })).toBe('');
  });
});
