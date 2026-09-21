/**
 * ⭐ THE FIXTURE THE LANE'S CORPUS COULD NOT SEE.
 *
 * `causal_waist` is defined on option → … → goal paths. Every fixture written
 * for this lane carries a goal node — so the corpus was STRUCTURALLY UNABLE to
 * observe what happens when there isn't one, which is the same shape as trap
 * 13d: a corpus that shares the code's blind spot cannot see the code's defect.
 *
 * What happens is that `reachesGoal` never finds a goal, so no factor joins the
 * waist and `causal_waist` is 0 for EVERY goal-less graph — a structurally
 * healthy one with three options acting through three private factors included.
 * `option_count >= 2 && causal_waist <= 1` then nominated it, and it paid for a
 * judge call on a signal that carried no information about it.
 *
 * ## The fix, and why it is a nomination guard and not a waist change
 *
 * Zero-because-no-goal-exists and zero-because-the-options-share-no-dimension
 * are TWO DIFFERENT FACTS under one number (trap 21 — write down the question
 * each answers before reconciling them). The waist is only interpretable
 * relative to a goal, so the honest move is to stop reading it when there is no
 * goal, not to redefine it:
 *
 *   `nominatesForReview` requires `goal_count >= 1`.
 *
 * Both zeros still reach telemetry, and `goal_count` rides every quality row, so
 * an analyst can still tell them apart — the hole is made MEASURABLE rather than
 * hidden, exactly as the pre-filter's documented recall limitation already is.
 *
 * ## Scope, stated precisely
 *
 * This is COST AND LATENCY exposure only. The pass is reject-only and fails
 * open, so the worst case before the fix was a wasted judge call on a healthy
 * graph — and the judge, which reads the brief, would pass it. No graph was
 * ever rejected by this. Both properties are asserted below rather than
 * asserted in prose.
 */

import { describe, it, expect, vi } from 'vitest';
import { computeDraftCoverage, nominatesForReview } from '../coverage.js';
import { assessDraftQuality } from '../index.js';

/**
 * STRUCTURALLY HEALTHY AND GOAL-LESS. Three options, three PRIVATE factors —
 * each option acts through a dimension of its own, which is the exact opposite
 * of the single-waist bowtie this pass exists to catch. It differs from the
 * healthy fixtures elsewhere in this directory in one respect only: no goal.
 */
const HEALTHY_NO_GOAL = Object.freeze({
  nodes: [
    { id: 'dec_1', kind: 'decision', label: 'Which supplier?' },
    { id: 'opt_a', kind: 'option', label: 'Supplier A' },
    { id: 'opt_b', kind: 'option', label: 'Supplier B' },
    { id: 'opt_c', kind: 'option', label: 'Supplier C' },
    { id: 'fac_cost', kind: 'factor', label: 'Unit cost' },
    { id: 'fac_lead', kind: 'factor', label: 'Lead time' },
    { id: 'fac_quality', kind: 'factor', label: 'Defect rate' },
    { id: 'out_margin', kind: 'outcome', label: 'Gross margin' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_a' },
    { from: 'dec_1', to: 'opt_b' },
    { from: 'dec_1', to: 'opt_c' },
    { from: 'opt_a', to: 'fac_cost' },
    { from: 'opt_b', to: 'fac_lead' },
    { from: 'opt_c', to: 'fac_quality' },
    { from: 'fac_cost', to: 'out_margin' },
    { from: 'fac_lead', to: 'out_margin' },
    { from: 'fac_quality', to: 'out_margin' },
  ],
});

/**
 * ITS OPPOSITE-DIRECTION TWIN — byte-for-byte the same graph with a goal node
 * and one edge into it. Only the goal separates them, so the pair isolates the
 * property under test and nothing else.
 */
const HEALTHY_WITH_GOAL = Object.freeze({
  nodes: [...HEALTHY_NO_GOAL.nodes, { id: 'goal_1', kind: 'goal', label: 'Best total cost' }],
  edges: [...HEALTHY_NO_GOAL.edges, { from: 'out_margin', to: 'goal_1' }],
});

describe('the goal-less blind spot in the pre-filter', () => {
  it('a goal-less graph scores causal_waist = 0 however healthy it is', () => {
    const facts = computeDraftCoverage(HEALTHY_NO_GOAL);
    expect(facts?.goal_count).toBe(0);
    expect(facts?.option_count).toBe(3);
    expect(facts?.factor_count).toBe(3);
    // Zero not because the options share a dimension, but because the waist is
    // undefined without a goal. Two facts, one number.
    expect(facts?.causal_waist).toBe(0);
    expect(facts?.private_factor_count).toBe(0);
  });

  it('⭐ it is NOT nominated — the waist carries no information about it', () => {
    expect(nominatesForReview(computeDraftCoverage(HEALTHY_NO_GOAL))).toBe(false);
  });

  it('⭐ OPPOSITE-DIRECTION TWIN — the same graph WITH a goal reads a real waist and is also not nominated', () => {
    // Proves the guard is `goal_count >= 1` and not a blanket "3 options never
    // nominate": with the goal present the waist is genuinely 3, so the
    // not-nominated verdict here is reached by a completely different route.
    const facts = computeDraftCoverage(HEALTHY_WITH_GOAL);
    expect(facts?.goal_count).toBe(1);
    expect(facts?.causal_waist).toBe(3);
    expect(facts?.private_factor_count).toBe(3);
    expect(nominatesForReview(facts)).toBe(false);
  });

  it('⭐ DISCRIMINATING TWIN — a goal-BEARING single-waist graph still nominates', () => {
    // The guard must not have disabled the pre-filter. A two-option graph whose
    // options share one factor, WITH a goal, is the motivating defect and must
    // still be nominated.
    const single = Object.freeze({
      nodes: [
        { id: 'opt_a', kind: 'option' },
        { id: 'opt_b', kind: 'option' },
        { id: 'fac_1', kind: 'factor' },
        { id: 'goal_1', kind: 'goal' },
      ],
      edges: [
        { from: 'opt_a', to: 'fac_1' },
        { from: 'opt_b', to: 'fac_1' },
        { from: 'fac_1', to: 'goal_1' },
      ],
    });
    const facts = computeDraftCoverage(single);
    expect(facts?.goal_count).toBe(1);
    expect(facts?.causal_waist).toBe(1);
    expect(nominatesForReview(facts)).toBe(true);
  });

  it('costs no judge call, and the coverage facts are still measured', async () => {
    const judge = vi.fn();
    const outcome = await assessDraftQuality({
      graph: HEALTHY_NO_GOAL,
      brief: 'Which supplier should we choose? Cost, lead time and defect rate all matter.',
      requestId: 'goalless-1',
      elapsedMs: 1_000,
      isRedraw: false,
      judge: judge as never,
    });
    expect(judge).not.toHaveBeenCalled();
    expect(outcome.shouldRedraw).toBe(false);
    expect(outcome.noRedrawReason).toBe('not_nominated');
    // The continuous metric does not lose the draft — `goal_count` is on the
    // row, so the two kinds of zero stay separable downstream.
    expect(outcome.assessment.coverage?.goal_count).toBe(0);
  });
});
