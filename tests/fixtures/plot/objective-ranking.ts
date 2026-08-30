import type { EnrichmentObjectiveRanking } from '@talchain/schemas/boundary';

/** Cross-service discriminating fixture agreed with the PLoT producer owner. */
export function objectiveRankingFixture() {
  return {
    analysis_status: 'computed',
    response_hash: 'objective-ranking-fixture',
    meta: { seed_used: 42, n_samples: 1000, response_hash: 'objective-ranking-fixture' },
    objective_ranking: {
      direction: 'maximise', attested: true, status: 'computed',
      ranked_options: [
        { option_id: 'expensive', rank: 1, win_probability: 0.8 },
        { option_id: 'affordable', rank: 2, win_probability: 0.2 },
      ],
    } satisfies EnrichmentObjectiveRanking,
    option_comparison: [
      { option_id: 'expensive', option_label: 'Expensive', status: 'computed', win_probability: 0.8,
        outcome: { mean: 80, p10: 70, p90: 90 },
        constraints_decision_grade: true, constraint_probabilities: { budget: 0 } },
      { option_id: 'affordable', option_label: 'Affordable', status: 'computed', win_probability: 0.2,
        outcome: { mean: 20, p10: 10, p90: 30 },
        constraints_decision_grade: true, constraint_probabilities: { budget: 1 } },
    ],
    robustness: { level: 'stable', recommended_option_id: 'affordable',
      recommended_option_label: 'Affordable', recommended_option_compliance: 'compliant' },
  };
}

export function withheldObjectiveRankingFixture(): Record<string, unknown> {
  const fixture = objectiveRankingFixture();
  return {
    ...fixture,
    objective_ranking: {
      attested: false, status: 'withheld', withheld_reason: 'goal_direction_absent', ranked_options: [],
    } satisfies EnrichmentObjectiveRanking,
    option_comparison: fixture.option_comparison.map(({ win_probability: _share, ...option }) => option),
    robustness: { level: 'stable' },
  };
}
