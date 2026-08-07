/**
 * Trust-spine board #1 (CEE half) — the OTHER two winner surfaces beyond the
 * compact summary: the decision-review enricher (config-gated) and the
 * run_analysis headline (pure). Proves the recommendation framing is suppressed
 * on both when the leading option violates a hard constraint, and that the
 * flag-OFF path is byte-identical.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildInvokeInputForTests } from '../decision-review-enricher.js';
import {
  buildAnalysisResultHeadline,
  describeAnalysisHeadline,
  type AnalysisResultHeadlineInput,
} from '../analysis-result-headline.js';

// LIVE doctrine-B wire shape (object constraint_probabilities, joint 0) — the
// over-budget leader from the real staging capture.
const LIVE_WIRE_ENRICHMENT: Record<string, unknown> = {
  analysis_status: 'ok',
  constraints_status: 'computed',
  option_comparison: [
    {
      option_id: 'opt_premium',
      option_label: 'Premium Vendor',
      id: 'opt_premium',
      label: 'Premium Vendor',
      win_probability: 1,
      probability_of_joint_goal: 0,
      constraint_probabilities: { c_budget: 0 },
      status: 'computed',
    },
    {
      option_id: 'opt_budget',
      option_label: 'Budget Vendor',
      id: 'opt_budget',
      label: 'Budget Vendor',
      win_probability: 0,
      probability_of_joint_goal: 1,
      constraint_probabilities: { c_budget: 1 },
      status: 'computed',
    },
  ],
};

describe('decision-review enricher — constraint-infeasible winner (config-gated)', () => {
  let prior: string | undefined;

  async function setGate(value: string | undefined): Promise<void> {
    if (value === undefined) delete process.env.CEE_CONSTRAINT_INFEASIBLE_GATE;
    else process.env.CEE_CONSTRAINT_INFEASIBLE_GATE = value;
    const { _resetConfigCache } = await import('../../../config/index.js');
    _resetConfigCache();
  }

  beforeEach(() => {
    prior = process.env.CEE_CONSTRAINT_INFEASIBLE_GATE;
  });
  afterEach(async () => {
    await setGate(prior);
  });

  /**
   * RE-POINTED 2026-07-26 (G-CEE-1 remediation). The two flags used to move
   * together, both keyed on `deriveWinnerConstraintInfeasibility` and both
   * behind `CEE_CONSTRAINT_INFEASIBLE_GATE`. They are now DIFFERENT CLAIMS with
   * different owners, and this suite asserts the split:
   *
   *   `constraint_infeasible`      — NARROW: "the leader breaks a limit we DID
   *                                  check". Still keyed on the infeasibility
   *                                  predicate, still behind its own gate.
   *   `recommendation_suppressed`  — WIDE: "we cannot stand behind naming a
   *                                  leader at all". Now keyed on the ONE
   *                                  constraint verdict, read off the stamp the
   *                                  run_analysis handler persisted, and
   *                                  deliberately NOT flag-gated.
   *
   * WHY. Keyed on the infeasibility predicate, `recommendation_suppressed`
   * fired for exactly one of the three withholding states —
   * `evaluated_infeasible` — and never for `unevaluated` or
   * `identity_unresolved`. On the live `unevaluated` staging run (build
   * 1c078f0) the flag existed, was correct, and simply did not fire: the
   * decision-review prompt was told to name a winner, and the review card came
   * back "The MacBook Pro leads by a margin of about 52 percentage points"
   * underneath "no option can be put forward yet".
   *
   * And it is not flag-gated because a claim-safety withhold a feature flag can
   * switch off is not a withhold.
   */
  it('flag ON: marks the over-budget winner infeasible + suppressed', async () => {
    await setGate('true');
    // The verdict is THREADED now, not re-read from `enrichment`: since
    // @talchain/schemas 0.25.0 it lives on `result.constraint_verdict`, a
    // SIBLING of the enrichment record that `buildInvokeInput` never sees.
    // `false` is what the production caller passes on a withheld turn.
    const input = buildInvokeInputForTests('brief', LIVE_WIRE_ENRICHMENT, 'opt_premium', undefined, false);
    expect(input).not.toBeNull();
    expect(input!.winner.id).toBe('opt_premium');
    expect(input!.winner.constraint_infeasible).toBe(true);
    expect(input!.winner.recommendation_suppressed).toBe(true);
  });

  it('flag OFF: the NARROW infeasibility flag is gated off; the WIDE withhold is not', async () => {
    await setGate('false');
    // The fact carries NO verdict at all (neither the typed
    // `result.constraint_verdict` nor the interim stamp), so
    // `readMayNameLeadingOptionFromResult` fails CLOSED at the call site and
    // threads `false` — the honest reading: "we did not record whether the
    // leader may be named" is not "verified feasible". The feature flag does
    // not, and must not, reach it.
    const input = buildInvokeInputForTests('brief', LIVE_WIRE_ENRICHMENT, 'opt_premium', undefined, false);
    expect(input).not.toBeNull();
    expect(input!.winner.id).toBe('opt_premium');
    expect(input!.winner.constraint_infeasible).toBeUndefined();
    expect(input!.winner.recommendation_suppressed).toBe(true);
  });

  it('POSITIVE CONTROL: a stamped, permitted verdict leaves the winner unflagged', async () => {
    // The byte-identical case the old "flag OFF" test was reaching for, now
    // stated precisely. Without this the suppression assertions above would
    // pass on an enricher that suppressed unconditionally — the exact
    // over-correction that would cost every healthy run its recommendation.
    await setGate('false');
    const input = buildInvokeInputForTests('brief', LIVE_WIRE_ENRICHMENT, 'opt_premium', undefined, true);
    expect(input).not.toBeNull();
    expect(input!.winner.id).toBe('opt_premium');
    expect(input!.winner.constraint_infeasible).toBeUndefined();
    expect(input!.winner.recommendation_suppressed).toBeUndefined();
  });
});

describe('run_analysis headline — suppresses the confident lead when infeasible', () => {
  const baseInput: AnalysisResultHeadlineInput = {
    enrichment: {
      option_comparison: [
        { option_id: 'opt_a', option_label: 'Option A', id: 'opt_a', label: 'Option A', win_probability: 0.7 },
        { option_id: 'opt_b', option_label: 'Option B', id: 'opt_b', label: 'Option B', win_probability: 0.3 },
      ],
    },
    leading_option_id: 'opt_a',
    status_kind: 'ok',
  };

  it('constraint_infeasible=true: withholds the headline (null → neutral template)', () => {
    const text = buildAnalysisResultHeadline({ ...baseInput, constraint_infeasible: true });
    expect(text).toBeNull();
    const descriptor = describeAnalysisHeadline({ ...baseInput, constraint_infeasible: true });
    expect(descriptor.case).toBeNull();
    expect(descriptor.reason).toBe('constraint_infeasible');
  });

  it('discriminates: without the flag the SAME envelope produces a lead headline', () => {
    const text = buildAnalysisResultHeadline({ ...baseInput, constraint_infeasible: false });
    expect(text).not.toBeNull();
    expect(text).toContain('leads');
  });
});
