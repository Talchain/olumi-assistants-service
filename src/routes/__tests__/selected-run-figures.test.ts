import { describe, expect, it } from 'vitest';
import type { AnalysisStateV1, OlumiResponse } from '@talchain/schemas/boundary';
import served from './fixtures/r8r9-run2-figures.json';
import { projectSelectedRunFigures, type SelectedRunFiguresInput } from '../selected-run-figures.js';

const input = (): SelectedRunFiguresInput => ({
  scenarioId: served.scenario_id,
  runState: served.run_state as AnalysisStateV1['run_state'],
  currentResult: served.current_result as unknown as OlumiResponse['blocks'][number],
  selectedFact: served.selected_fact,
});

describe('figures from one selected saved Run', () => {
  it('keeps the served mean and conditional projection as different measures on the same Run', () => {
    const figures = projectSelectedRunFigures(input());
    expect(figures).toEqual([
      { option_id: 'raise_pro_price_to_59', value: 90993.23628890762, measure: 'mean',
        run_hash: 'e7d843f951477155', computed_at: '2026-09-30T11:02:22.019Z' },
      { option_id: 'raise_pro_price_to_59', value: 91836.73469387756, measure: 'projected_if_held',
        run_hash: 'e7d843f951477155', computed_at: '2026-09-30T11:02:22.019Z',
        condition: { kind: 'if_held', operand_id: 'paying_subscribers' } },
    ]);
    expect(figures).not.toContainEqual(expect.objectContaining({ measure: 'probability', value: 1 }));
  });

  it.each([
    ['stale', { kind: 'complete_stale', computed_at: served.run_state.computed_at, cause: 'graph_changed' }],
    ['never run', { kind: 'never_run' }],
    ['degraded', { kind: 'unknown_degraded', cause: 'store_unreadable' }],
    ['unreadable', null],
  ] as const)('%s exposes no current figure', (_label, runState) => {
    expect(projectSelectedRunFigures({ ...input(), runState: runState as AnalysisStateV1['run_state'] | null })).toEqual([]);
  });

  it('does not attach a certainty row from a different Run with the same hash', () => {
    const other = { ...served.selected_fact, computed_at: '2026-09-30T11:03:22.019Z' };
    expect(projectSelectedRunFigures({ ...input(), selectedFact: other })).toEqual([]);
  });

  it('exposes no figures when the current block is unbound or its hash disagrees with the selected fact', () => {
    expect(projectSelectedRunFigures({ ...input(), currentResult: null })).toEqual([]);
    const other = { ...served.selected_fact, graph_hash_at_run: '0123456789abcdef' };
    expect(projectSelectedRunFigures({ ...input(), selectedFact: other })).toEqual([]);
  });

  it('withholds a conditional value when its stored certainty decision is missing or disagrees', () => {
    const missing = { ...served.selected_fact, goal_certainty: undefined };
    expect(projectSelectedRunFigures({ ...input(), selectedFact: missing }).map((f) => f.measure)).toEqual(['mean']);
    const contradicted = { ...served.selected_fact, goal_certainty: [
      { ...served.selected_fact.goal_certainty[0], probability_of_goal: 0 },
    ] };
    expect(projectSelectedRunFigures({ ...input(), selectedFact: contradicted }).map((f) => f.measure)).toEqual(['mean']);
  });
});
