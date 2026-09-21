/**
 * ⭐⭐ THE OPPOSITE-DIRECTION CONTROL — written and made to pass BEFORE any
 * judging logic existed, and the most important file in this lane.
 *
 * ## Why it exists
 *
 * The defect being fixed is UNDER-generation: a draft that funnels five options
 * through one shared factor. The cheapest way to "fix" under-generation is to
 * demand a minimum number of factors — and that fabricates filler into models
 * that are legitimately simple. A genuinely single-factor decision ("should we
 * raise the price, yes or no?") MUST remain legal, must not be nominated for
 * rejection, and must ship byte-identical.
 *
 * Without this control, the impoverishment logic would have been written and
 * measured against impoverished inputs only — a corpus that shares the code's
 * blind spot cannot see the code's defect (trap 13d).
 *
 * ## What it pins, precisely
 *
 * 1. A genuine single-dimension model is NOMINATED by the deterministic
 *    pre-filter (it has the same structural signature as the defect), and
 * 2. the JUDGE — which has read the brief — passes it, and
 * 3. the pass therefore ships the ORIGINAL GRAPH, byte-identical, with no
 *    redraw and no mutation of any kind.
 *
 * Point 1 is deliberate and load-bearing: the pre-filter is a cost gate, not a
 * verdict. If a future change made the pre-filter "smarter" by excluding
 * single-dimension graphs structurally, this test would go GREEN for the wrong
 * reason — so it asserts the nomination explicitly rather than only asserting
 * the outcome.
 */

import { describe, it, expect, vi } from 'vitest';
import { computeDraftCoverage, nominatesForReview } from '../coverage.js';
import { assessDraftQuality } from '../index.js';
import type { DraftQualityVerdict } from '../types.js';

/**
 * A GENUINELY SINGLE-FACTOR DECISION.
 *
 * Brief: "Should we raise our subscription price by 10%? The only thing that
 * matters to us is monthly revenue."
 *
 * One decision, two options (raise / hold), ONE causal dimension the user
 * actually asserted (price sensitivity), one outcome, one goal. This is a
 * correct, faithful, complete model of that brief. `causal_waist` is 1 — the
 * SAME structural signature as the five-option defect.
 */
const SINGLE_FACTOR_BRIEF =
  'Should we raise our subscription price by 10%? The only thing that matters to us is monthly revenue.';

const SINGLE_FACTOR_GRAPH = Object.freeze({
  nodes: [
    { id: 'dec_1', kind: 'decision', label: 'Raise subscription price?' },
    { id: 'opt_raise', kind: 'option', label: 'Raise price by 10%' },
    { id: 'opt_hold', kind: 'option', label: 'Hold price' },
    { id: 'fac_price_sensitivity', kind: 'factor', label: 'Customer price sensitivity' },
    { id: 'out_revenue', kind: 'outcome', label: 'Monthly revenue' },
    { id: 'goal_1', kind: 'goal', label: 'Maximise monthly revenue' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_raise' },
    { from: 'dec_1', to: 'opt_hold' },
    { from: 'opt_raise', to: 'fac_price_sensitivity' },
    { from: 'opt_hold', to: 'fac_price_sensitivity' },
    { from: 'fac_price_sensitivity', to: 'out_revenue' },
    { from: 'out_revenue', to: 'goal_1' },
  ],
});

/**
 * THE MOTIVATING DEFECT, for contrast in the same file. Five options, all
 * funnelling through ONE shared factor, from a brief that plainly states more
 * than one dimension. Same `causal_waist` as the control above — which is
 * exactly why the structural signal alone must NEVER be the verdict.
 */
const FUNDING_BRIEF =
  'We need to raise a Series A. We can go with a top-tier VC on tough terms, a mid-tier VC on ' +
  'friendlier terms, a strategic investor who wants a commercial partnership, revenue-based ' +
  'financing, or bootstrap for another year. We care about dilution, speed to close, the ' +
  'strategic value of the investor, and how much control the board keeps.';

const SINGLE_WAIST_FUNDING_GRAPH = Object.freeze({
  nodes: [
    { id: 'dec_1', kind: 'decision', label: 'How do we raise the Series A?' },
    { id: 'opt_top_tier', kind: 'option', label: 'Top-tier VC' },
    { id: 'opt_mid_tier', kind: 'option', label: 'Mid-tier VC' },
    { id: 'opt_strategic', kind: 'option', label: 'Strategic investor' },
    { id: 'opt_rbf', kind: 'option', label: 'Revenue-based financing' },
    { id: 'opt_bootstrap', kind: 'option', label: 'Bootstrap another year' },
    { id: 'fac_dilution', kind: 'factor', label: 'Equity dilution' },
    { id: 'out_ownership', kind: 'outcome', label: 'Founder ownership' },
    { id: 'goal_1', kind: 'goal', label: 'Fund the company on the best terms' },
  ],
  edges: [
    { from: 'dec_1', to: 'opt_top_tier' },
    { from: 'dec_1', to: 'opt_mid_tier' },
    { from: 'dec_1', to: 'opt_strategic' },
    { from: 'dec_1', to: 'opt_rbf' },
    { from: 'dec_1', to: 'opt_bootstrap' },
    { from: 'opt_top_tier', to: 'fac_dilution' },
    { from: 'opt_mid_tier', to: 'fac_dilution' },
    { from: 'opt_strategic', to: 'fac_dilution' },
    { from: 'opt_rbf', to: 'fac_dilution' },
    { from: 'opt_bootstrap', to: 'fac_dilution' },
    { from: 'fac_dilution', to: 'out_ownership' },
    { from: 'out_ownership', to: 'goal_1' },
  ],
});

/** A judge that answers HONESTLY FROM THE BRIEF, the way the real one is asked
 *  to: it passes a model whose single dimension is the only one the brief
 *  asserts, and fails one that collapses several stated dimensions into one. */
function honestJudge(brief: string): DraftQualityVerdict {
  return /only thing that matters/i.test(brief)
    ? { kind: 'adequate' }
    : { kind: 'impoverished', grounds: ['collapsed_dimensions'] };
}

describe('draft-quality — the single-factor control (opposite direction)', () => {
  it('computes causal_waist = 1 for a genuine single-dimension model', () => {
    const facts = computeDraftCoverage(SINGLE_FACTOR_GRAPH);
    expect(facts).not.toBeNull();
    expect(facts?.option_count).toBe(2);
    expect(facts?.causal_waist).toBe(1);
    expect(facts?.factor_count).toBe(1);
    expect(facts?.shared_factor_count).toBe(1);
    expect(facts?.private_factor_count).toBe(0);
  });

  it('NOMINATES the genuine single-dimension model — the pre-filter is a cost gate, not a verdict', () => {
    // Deliberate. If this ever flips to false, the pre-filter has quietly
    // become a structural verdict and the judge is no longer the authority.
    expect(nominatesForReview(computeDraftCoverage(SINGLE_FACTOR_GRAPH))).toBe(true);
  });

  it('⭐ leaves a legitimately simple model ALONE — no redraw, graph byte-identical', async () => {
    const before = JSON.stringify(SINGLE_FACTOR_GRAPH);
    const redraw = vi.fn();

    const outcome = await assessDraftQuality({
      graph: SINGLE_FACTOR_GRAPH,
      brief: SINGLE_FACTOR_BRIEF,
      requestId: 'ctl-1',
      elapsedMs: 1_000,
      isRedraw: false,
      judge: async () => honestJudge(SINGLE_FACTOR_BRIEF),
    });

    expect(outcome.shouldRedraw).toBe(false);
    expect(outcome.noRedrawReason).toBe('judged_adequate');
    expect(outcome.assessment.nominated).toBe(true);
    expect(outcome.assessment.verdict.kind).toBe('adequate');
    expect(redraw).not.toHaveBeenCalled();
    // The pass must not have touched the graph in any way.
    expect(JSON.stringify(SINGLE_FACTOR_GRAPH)).toBe(before);
  });

  it('⭐ its TWIN: the five-option single-waist funding model IS caught', async () => {
    const outcome = await assessDraftQuality({
      graph: SINGLE_WAIST_FUNDING_GRAPH,
      brief: FUNDING_BRIEF,
      requestId: 'ctl-2',
      elapsedMs: 1_000,
      isRedraw: false,
      judge: async () => honestJudge(FUNDING_BRIEF),
    });

    expect(outcome.assessment.coverage?.option_count).toBe(5);
    expect(outcome.assessment.coverage?.causal_waist).toBe(1);
    expect(outcome.assessment.nominated).toBe(true);
    expect(outcome.assessment.verdict).toEqual({
      kind: 'impoverished',
      grounds: ['collapsed_dimensions'],
    });
    expect(outcome.shouldRedraw).toBe(true);
    expect(outcome.noRedrawReason).toBeNull();
  });

  it('the two models are structurally INDISTINGUISHABLE to the pre-filter — only the brief separates them', () => {
    const simple = computeDraftCoverage(SINGLE_FACTOR_GRAPH);
    const defect = computeDraftCoverage(SINGLE_WAIST_FUNDING_GRAPH);
    // Same signature, opposite verdicts. This is the whole argument for why the
    // judge must read the brief and why a structural quota would be wrong.
    expect(simple?.causal_waist).toBe(defect?.causal_waist);
    expect(nominatesForReview(simple)).toBe(nominatesForReview(defect));
  });
});

describe('draft-quality — a model whose options act through DIFFERENT dimensions is not nominated at all', () => {
  const RICH_GRAPH = Object.freeze({
    nodes: [
      { id: 'dec_1', kind: 'decision' },
      { id: 'opt_a', kind: 'option' },
      { id: 'opt_b', kind: 'option' },
      { id: 'fac_cost', kind: 'factor' },
      { id: 'fac_speed', kind: 'factor' },
      { id: 'out_1', kind: 'outcome' },
      { id: 'goal_1', kind: 'goal' },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_a' },
      { from: 'dec_1', to: 'opt_b' },
      { from: 'opt_a', to: 'fac_cost' },
      { from: 'opt_b', to: 'fac_speed' },
      { from: 'fac_cost', to: 'out_1' },
      { from: 'fac_speed', to: 'out_1' },
      { from: 'out_1', to: 'goal_1' },
    ],
  });

  it('costs no judge call', async () => {
    const facts = computeDraftCoverage(RICH_GRAPH);
    expect(facts?.causal_waist).toBe(2);
    expect(facts?.private_factor_count).toBe(2);
    expect(nominatesForReview(facts)).toBe(false);

    const judge = vi.fn();
    const outcome = await assessDraftQuality({
      graph: RICH_GRAPH,
      brief: 'anything',
      requestId: 'ctl-3',
      elapsedMs: 1_000,
      isRedraw: false,
      judge,
    });
    expect(judge).not.toHaveBeenCalled();
    expect(outcome.shouldRedraw).toBe(false);
    expect(outcome.noRedrawReason).toBe('not_nominated');
    // ...and the facts are still emitted, which is the whole point of the
    // continuous metric: an un-nominated draft is still measured.
    expect(outcome.assessment.coverage).not.toBeNull();
  });
});
