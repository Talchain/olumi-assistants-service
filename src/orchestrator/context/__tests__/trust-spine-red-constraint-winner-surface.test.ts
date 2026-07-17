/**
 * TRUST-SPINE RED — T1-CEE / board item #1 (CEE half): constraint-honest winner surface.
 *
 * Acceptance floor (Paul-approved plan agile-finding-harp.md §3 item 1):
 *   "a hard-constraint-violating option cannot be surfaced as leading unless the
 *    system explicitly states the constraint is unenforceable AND suppresses the
 *    recommendation."
 *
 * DEFECT (plan §1 CONFIRMED DEFECT #1): the CEE winner-surfacing code selects the
 * leader purely by `win_probability` and NEVER consults constraint feasibility.
 * `compactAnalysis` → `deriveWinner` sorts by win_probability
 * (analysis-compact.ts:173-187); the enricher `selectWinner`
 * (decision-review-enricher.ts:597-612) and the "X leads" headline
 * (analysis-result-headline.ts resolveWinner) do the same. Constraint feasibility
 * is computed side-by-side (`deriveConstraintTensions`) but never reconciled with
 * the winner — a £65k-constraint-violating £80k option still ranks first.
 *
 * it.fails semantics: the body asserts the HONEST-FUTURE behaviour (the infeasible
 * leader is suppressed / not surfaced as the plain winner), which THROWS today
 * (the winner IS the infeasible option) — so `it.fails` reports GREEN while the
 * defect stands. When board #1 (CEE half) lands, the body passes, `it.fails` fails
 * loudly, and the fixer converts it to `it()`.
 *
 * POSITIVE CONTROL (CLAUDE.md trap #13 — an absence assertion must first prove it
 * can see a presence): the SAME envelope the winner is drawn from provably carries
 * the detected hard-constraint infeasibility (`constraint_tensions === ['budget']`),
 * so "the winner ignores the constraint" is a real discriminator, not a vacuous
 * pass over an envelope with no constraint signal.
 */
import { describe, it, expect } from 'vitest';

import { compactAnalysis } from '../analysis-compact.js';
import type { V2RunResponseEnvelope } from '../../types.js';

/**
 * Option A wins the goal-outcome race (win_probability 0.6) BUT hard-violates the
 * budget constraint (joint 0.02 « individual 0.9 × 0.7 = 0.63 → infeasible).
 * Option B is feasible (joint 0.85) but ranks second by win_probability (0.4).
 * Both options live in `results[]`, the single array the winner reader AND
 * `deriveConstraintTensions` both consume — so the constraint IS visible where
 * the winner is chosen.
 */
const CONSTRAINT_INFEASIBLE_LEADER: V2RunResponseEnvelope = {
  meta: { seed_used: 1, n_samples: 1000, response_hash: 'h' },
  analysis_status: 'ok',
  results: [
    {
      option_id: 'A',
      option_label: 'Option A (£80k — over budget)',
      win_probability: 0.6,
      outcome_mean: 100,
      probability_of_joint_goal: 0.02,
      constraint_probabilities: [{ constraint_id: 'budget', probability: 0.9 }],
    },
    {
      option_id: 'B',
      option_label: 'Option B (£60k — within budget)',
      win_probability: 0.4,
      outcome_mean: 80,
      probability_of_joint_goal: 0.85,
      constraint_probabilities: [{ constraint_id: 'budget', probability: 0.9 }],
    },
  ],
} as unknown as V2RunResponseEnvelope;

describe('TRUST-SPINE T1-CEE — constraint-honest winner surface (board #1 CEE half)', () => {
  // POSITIVE CONTROL (regular it — GREEN today): the infeasibility IS present and
  // detected in the exact envelope the winner is drawn from.
  it('positive control: the hard-constraint infeasibility is visible in the same envelope', () => {
    const summary = compactAnalysis(CONSTRAINT_INFEASIBLE_LEADER)!;
    expect(summary).not.toBeNull();
    expect(summary.constraint_tensions).toEqual(['budget']);
    // And it really does pick A by win_probability today (documents current behaviour).
    expect(summary.winner!.option_id).toBe('A');
  });

  // TRUST-SPINE RED: flips to it() when board-item 1 (CEE half) lands.
  // Honest future: the constraint-infeasible option must NOT be surfaced as the
  // plain leader — either the winner is the feasible option, or the surface carries
  // an explicit unenforceable/infeasible flag. TODAY the winner is the infeasible
  // 'A' with no flag, so `not.toBe('A')` throws → RED body.
  it.fails(
    'the constraint-infeasible option is not surfaced as the plain leader',
    () => {
      const summary = compactAnalysis(CONSTRAINT_INFEASIBLE_LEADER)!;
      const winner = summary.winner!;
      // Honest future (either half satisfies the property):
      //  (a) the surfaced leader is not the infeasible option, OR
      //  (b) the leader is flagged infeasible / recommendation-suppressed.
      const flaggedInfeasible =
        (winner as Record<string, unknown>).constraint_infeasible === true ||
        (winner as Record<string, unknown>).recommendation_suppressed === true;
      expect(winner.option_id !== 'A' || flaggedInfeasible).toBe(true);
    },
  );
});
