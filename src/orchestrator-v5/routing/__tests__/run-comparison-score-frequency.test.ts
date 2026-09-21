import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { tryRunComparisonGate } from '../run-comparison-gate.js';
import { detectGoalAttainmentContradiction } from '../../coaching/objective-contradiction.js';

// Reviewer-derived counterexample: the highest-score frequency changes from
// Alpha to Beta, while Gamma remains most likely to meet the target.
function options(current: boolean, hasTargetProbabilities: boolean) {
  return [
    { option_id: 'a', option_label: 'Alpha', win_probability: current ? 0.3 : 0.6,
      ...(hasTargetProbabilities ? { probability_of_goal: 0.7 } : {}) },
    { option_id: 'b', option_label: 'Beta', win_probability: current ? 0.6 : 0.3,
      ...(hasTargetProbabilities ? { probability_of_goal: 0.7 } : {}) },
    { option_id: 'c', option_label: 'Gamma', win_probability: 0.1,
      ...(hasTargetProbabilities ? { probability_of_goal: 0.9 } : {}) },
  ];
}

function runFact(current: boolean, hasTargetProbabilities: boolean, permitted: boolean): HandlerFact {
  return {
    fact_type: 'run_analysis',
    noop: false,
    result: {
      enrichment: {
        analysis_status: 'completed',
        results: options(current, hasTargetProbabilities).map(option => ({
          ...option, outcome: { n_samples: 10_000 },
        })),
      },
      computed_at: current ? '2026-09-07T20:01:00.000Z' : '2026-09-07T20:00:00.000Z',
      graph_hash_at_run: current ? 'current-inputs' : 'prior-inputs',
      constraint_verdict: {
        may_name_leading_option: permitted,
        constraint_verdict_state: permitted ? 'evaluated_feasible' : 'evaluated_infeasible',
      },
    },
  } as unknown as HandlerFact;
}

function compare(hasTargetProbabilities: boolean, permitted: boolean) {
  const outcome = tryRunComparisonGate({
    message: 'What changed?',
    priorFacts: [runFact(true, hasTargetProbabilities, permitted), runFact(false, hasTargetProbabilities, permitted)],
    freshness: 'fresh',
    mayNameLeadingOption: permitted,
  });
  expect(outcome.matched).toBe(true);
  if (!outcome.matched) throw new Error('Expected the real comparison gate to execute');
  expect(outcome.mode).toBe('compared');
  return outcome;
}

describe('run comparison reports score frequency, not target attainment', () => {
  it.each([true, false])('scopes a changed comparison when target probabilities are present: %s', hasTargetProbabilities => {
    if (hasTargetProbabilities) {
      const prior = detectGoalAttainmentContradiction(options(false, true));
      const current = detectGoalAttainmentContradiction(options(true, true));
      expect(prior?.leader_label).toBe('Alpha');
      expect(current?.leader_label).toBe('Beta');
      expect(prior?.better_label).toBe('Gamma');
      expect(current?.better_label).toBe('Gamma');
      expect(prior?.better_probability_of_goal).toBe(0.9);
      expect(current?.better_probability_of_goal).toBe(0.9);
    } else {
      expect(detectGoalAttainmentContradiction(options(false, false))).toBeNull();
      expect(detectGoalAttainmentContradiction(options(true, false))).toBeNull();
    }

    const outcome = compare(hasTargetProbabilities, true);
    expect(outcome.leading_option_changed).toBe(true);
    expect(outcome.assistant_text).not.toContain('most likely to serve your goal');
    expect(outcome.assistant_text).toContain('The option that scored highest most often in the model simulations has changed.');
    expect(outcome.assistant_text).toContain('Alpha scored highest most often in the earlier run');
    expect(outcome.assistant_text).toContain('Beta scored highest most often in the latest run');
  });

  it('withholding still preserves a useful answer without either comparison identity', () => {
    const outcome = compare(true, false);
    expect(outcome.assistant_text.length).toBeGreaterThan(20);
    expect(outcome.assistant_text).not.toMatch(/Alpha|Beta|scored highest|most likely to serve/);
  });
});
