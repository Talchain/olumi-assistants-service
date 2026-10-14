import { expect, it } from 'vitest';
import { observedValueAuthorship, provenanceOf, valueAuthorshipOf } from '../provenance-of.js';
import { teamObservedState } from '../../../orchestrator-v5/goal-target/team-share-write.js';
import { projectRunGraphForDecisionReview } from '../../../orchestrator-v5/coaching/decision-review-graph-projection.js';

it('a stated 7 months stays the user’s; Olumi’s assumed range and its computed level stay Olumi’s in every label', () => {
  const time = { goal_id: 'goal', team_id: 'team', deadline: '2027-04-12', reference_date: '2026-10-12' };
  const estimated = teamObservedState({ ...time, low_months: 3.5, high_months: 10.5,
    forecast_months: 7, forecast_words: '7 months', range_origin: 'olumi_estimate', range_rule: 'low_confidence' }, '%');
  expect(estimated.stated_time).toMatchObject({ forecast: 7, forecast_origin: 'user', range_origin: 'olumi_estimate' });
  const rows = [
    { observed: { value: 7, unit: 'months', source: 'user_specified' }, origin: 'human', source: 'user', provenance: 'user_set', authorship: 'yours' },
    { observed: teamObservedState({ ...time, low_months: 6, high_months: 9 }, '%'), origin: 'human', source: 'user', provenance: 'user_set', authorship: 'yours' },
    { observed: estimated, origin: 'ai', source: 'system', provenance: 'ai_inferred', authorship: 'olumi_estimate' },
  ];
  for (const { observed, origin, source, provenance, authorship } of rows) {
    expect.soft(provenanceOf({ value: observed })).toMatchObject({ origin });
    expect.soft(observedValueAuthorship(observed)).toEqual({ source, provenance });
    expect.soft(valueAuthorshipOf(observed)).toBe(authorship);
    // Exercise the preserving projection used when the run snapshot fails strict parsing.
    const review = projectRunGraphForDecisionReview({}, {
      nodes: [{ id: 'team', kind: 'factor', label: 'Team progress', observed_state: observed }],
      edges: [{ from: 'team', to: 'goal', strength: 'unreadable' }],
    });
    expect(review.via).toBe('run_snapshot_preserving');
    expect.soft(review.graph.nodes).toEqual([expect.objectContaining({ id: 'team', source, provenance })]);
  }
});
