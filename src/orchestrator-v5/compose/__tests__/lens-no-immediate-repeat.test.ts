/**
 * ROADMAP 2.211 — the NO-IMMEDIATE-REPEAT amendment to the locked lens priority.
 *
 * The priority ORDER is unchanged (flip-risk → pre-mortem → EVPI → what-if).
 * What is added: when the SAME lens fired on the immediately-preceding analysis
 * turn of this scenario AND at least one other lens's trigger is currently
 * true (with an available executor), the selector takes the NEXT-priority
 * triggered lens instead.
 *
 * Evidence of record: `PHASE0-EVIDENCE-2026-07-28/probe-premortem-live.md` —
 * `sensitivity_flip_risk` won 6/6 measured live turns, and on 5 of those 6 the
 * pre-mortem lens's own trigger was simultaneously TRUE and discarded.
 *
 * These tests are the mutation witnesses for the amendment:
 *   - delete the no-repeat clause  → the two-turn fixture + the a5 golden RED
 *   - make it displace unconditionally (repeat-never) → the SINGLE-TRIGGER
 *     REPEAT pin REDs
 *   - the may-recommend-nothing negative control is asserted untouched.
 */

import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { selectLens } from '../lens-selector.js';

// ============================================================================
// Fixtures — same shape as lens-selector.test.ts's `makeFact`.
// ============================================================================

interface FactorInput {
  readonly factor_id?: string;
  readonly influence_score?: number;
  readonly influence_rank?: number;
  readonly evpi_percentage_points?: number;
  readonly evpi_status?: string;
  readonly confidence?: number | null;
  readonly flip_risk_category?: string;
}

interface EnrichmentInput {
  readonly factor_sensitivity?: readonly FactorInput[];
  readonly option_comparison?: readonly { readonly win_probability?: number }[];
  readonly confidence_tier?: string;
}

function makeFact(input: EnrichmentInput = {}): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (input.factor_sensitivity !== undefined) enrichment.factor_sensitivity = input.factor_sensitivity;
  if (input.option_comparison !== undefined) enrichment.option_comparison = input.option_comparison;
  if (input.confidence_tier !== undefined) enrichment.confidence_tier = input.confidence_tier;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-2211',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      graph_hash_at_run: 'gh_2211aaaabbbbcccc',
      computed_at: '2026-07-31T10:00:00.000Z',
      enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

/**
 * BOTH TRIGGER. Rule 1a-ii fires (a `correlated` factor) AND rule 2c fires
 * (max win_probability inside [0.4, 0.7)). Diffuse influence so rule 1b stays
 * silent. This is the state the live walk measured on 5 of 6 turns.
 */
const BOTH_TRIGGER: EnrichmentInput = {
  confidence_tier: 'fair',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 1.0, influence_rank: 1, confidence: 0.45, flip_risk_category: 'correlated' },
    { factor_id: 'fac_b', influence_score: 0.9, influence_rank: 2, confidence: 0.45 },
    { factor_id: 'fac_c', influence_score: 0.8, influence_rank: 3, confidence: 0.45 },
  ],
  option_comparison: [{ win_probability: 0.62 }, { win_probability: 0.38 }],
};

/**
 * ONLY flip-risk triggers. Rule 2 is silent on all three doors (tier `strong`,
 * rank-1 confidence bands `medium`, max win_probability 0.85 ≥ MAX) and rule 3
 * is silent (no EVPI). Repeating IS correct here.
 */
const ONLY_FLIP_RISK_TRIGGERS: EnrichmentInput = {
  confidence_tier: 'strong',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 1.0, influence_rank: 1, confidence: 0.9, flip_risk_category: 'isolated' },
    { factor_id: 'fac_b', influence_score: 0.9, influence_rank: 2, confidence: 0.9 },
    { factor_id: 'fac_c', influence_score: 0.8, influence_rank: 3, confidence: 0.9 },
  ],
  option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
};

/** The may-recommend-nothing baseline (verbatim from lens-selector.test.ts). */
const HEALTHY: EnrichmentInput = {
  confidence_tier: 'strong',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
    { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
    { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
  ],
  option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
};

/**
 * THE GOLDEN — attempt a5 of the 31 Jul live walk, reproduced at its measured
 * numbers (`probe-premortem-live.md` §"Attempt a5"). Every leg of the emission
 * conjunction was satisfied on that turn EXCEPT the lens race:
 *   - Σ others = 1.059 > 1.0  → rule 1b (DOMINANT_DRIVER) silent
 *   - one `isolated` factor    → rule 1a-i fires
 *   - max win_probability 0.6242 ∈ [0.4, 0.7) → rule 2c LIVE and preempted
 *   - confidence_tier 'fair', rank-1 confidence exactly 0.300 → bands 'medium',
 *     so rules 2a and 2b are both silent (as measured).
 */
const A5_GOLDEN: EnrichmentInput = {
  confidence_tier: 'fair',
  factor_sensitivity: [
    { factor_id: 'fac_sales_capacity', influence_score: 1.0, influence_rank: 1, confidence: 0.3, flip_risk_category: 'isolated' },
    { factor_id: 'fac_market_demand', influence_score: 0.74, influence_rank: 2, confidence: 0.448, flip_risk_category: 'correlated' },
    { factor_id: 'fac_product_investment', influence_score: 0.178, influence_rank: 3, confidence: 0.3, flip_risk_category: 'isolated' },
    { factor_id: 'fac_marketing_spend', influence_score: 0.141, influence_rank: 4, confidence: 0.3, flip_risk_category: 'correlated' },
  ],
  option_comparison: [
    { win_probability: 0.6242 },
    { win_probability: 0.2 },
    { win_probability: 0.1 },
    { win_probability: 0.0758 },
  ],
};

// ============================================================================
// 1. The two-turn fixture — THE BAR. Fails before the amendment.
// ============================================================================

describe('2.211 — no-immediate-repeat over two consecutive analysis turns', () => {
  it('turn 1: flip-risk wins the slot even though pre-mortem also triggers', () => {
    const selection = selectLens(makeFact(BOTH_TRIGGER));
    expect(selection?.lens).toBe('sensitivity_flip_risk');
    expect(selection?.rationaleCode).toBe('FLIP_RISK_CORRELATED');
    // No displacement happened, so nothing is recorded as displaced.
    expect(selection?.displacedLens).toBeUndefined();
  });

  it('turn 2: the SAME lens fired last turn and pre-mortem still triggers → pre-mortem is selected', () => {
    const selection = selectLens(makeFact(BOTH_TRIGGER), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(selection?.lens).toBe('pre_mortem');
    expect(selection?.rationaleCode).toBe('WIN_PROB_MODERATE');
  });

  it('turn 2 records the DISPLACED lens alongside the chosen one (telemetry pair)', () => {
    const selection = selectLens(makeFact(BOTH_TRIGGER), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(selection?.displacedLens).toBe('sensitivity_flip_risk');
    expect(selection?.lens).toBe('pre_mortem');
  });

  it('turn 3: the previous lens is now pre-mortem, so flip-risk takes the slot back', () => {
    const selection = selectLens(makeFact(BOTH_TRIGGER), {
      previousAnalysisLens: 'pre_mortem',
    });
    expect(selection?.lens).toBe('sensitivity_flip_risk');
    expect(selection?.displacedLens).toBeUndefined();
  });
});

// ============================================================================
// 2. THE SINGLE-TRIGGER REPEAT PIN — repeating is CORRECT when nothing else fires.
//    This is the mutant witness for a "repeat-never" implementation.
// ============================================================================

describe('2.211 — a single triggered lens repeats, and that is correct', () => {
  it('repeats sensitivity_flip_risk when it is the ONLY lens whose trigger is true', () => {
    const selection = selectLens(makeFact(ONLY_FLIP_RISK_TRIGGERS), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(selection?.lens).toBe('sensitivity_flip_risk');
    expect(selection?.rationaleCode).toBe('FLIP_RISK_ISOLATED');
    // Nothing was displaced — there was no alternative to displace it with.
    expect(selection?.displacedLens).toBeUndefined();
  });

  it('never returns null merely because the only triggered lens is a repeat', () => {
    expect(
      selectLens(makeFact(ONLY_FLIP_RISK_TRIGGERS), {
        previousAnalysisLens: 'sensitivity_flip_risk',
      }),
    ).not.toBeNull();
  });
});

// ============================================================================
// 3. may-recommend-nothing is UNTOUCHED by the amendment.
// ============================================================================

describe('2.211 — the may-recommend-nothing negative control still holds', () => {
  it('returns null on a healthy analysis whatever the previous lens was', () => {
    expect(selectLens(makeFact(HEALTHY), { previousAnalysisLens: 'sensitivity_flip_risk' })).toBeNull();
    expect(selectLens(makeFact(HEALTHY), { previousAnalysisLens: 'pre_mortem' })).toBeNull();
    expect(selectLens(makeFact(HEALTHY), { previousAnalysisLens: null })).toBeNull();
  });

  it('a null / absent previous lens is byte-identical to the pre-amendment selection', () => {
    const base = selectLens(makeFact(BOTH_TRIGGER));
    expect(selectLens(makeFact(BOTH_TRIGGER), {})).toStrictEqual(base);
    expect(selectLens(makeFact(BOTH_TRIGGER), { previousAnalysisLens: null })).toStrictEqual(base);
    expect(selectLens(makeFact(BOTH_TRIGGER), { previousAnalysisLens: undefined })).toStrictEqual(base);
  });

  it('a previous lens that is NOT the current head changes nothing', () => {
    const base = selectLens(makeFact(BOTH_TRIGGER));
    expect(
      selectLens(makeFact(BOTH_TRIGGER), { previousAnalysisLens: 'evpi_evidence_priority' }),
    ).toStrictEqual(base);
  });
});

// ============================================================================
// 4. THE GOLDEN — the walk's a5 turn.
// ============================================================================

describe('2.211 — the a5 golden (probe-premortem-live.md)', () => {
  it('reproduces the measured a5 outcome exactly: flip-risk ISOLATED took the slot', () => {
    const selection = selectLens(makeFact(A5_GOLDEN));
    expect(selection?.lens).toBe('sensitivity_flip_risk');
    expect(selection?.rationaleCode).toBe('FLIP_RISK_ISOLATED');
    expect(selection?.subjectRef).toStrictEqual({ id: 'fac_sales_capacity', kind: 'factor' });
  });

  it('a5 shape on a SECOND consecutive turn now emits pre_mortem — the fix, on the golden', () => {
    const selection = selectLens(makeFact(A5_GOLDEN), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(selection?.lens).toBe('pre_mortem');
    expect(selection?.rationaleCode).toBe('WIN_PROB_MODERATE');
    expect(selection?.displacedLens).toBe('sensitivity_flip_risk');
    // WIN_PROB_MODERATE has no single-factor subject — the directive ladder must
    // fall through to the v1 highlight rather than fabricate a target.
    expect(selection?.subjectRef).toBeUndefined();
  });
});

// ============================================================================
// 5. The displaced lens must still be a lens we can HONESTLY RUN.
//    (§2.6/2.7 — never suggest a lens whose executor is absent.)
// ============================================================================

describe('2.211 — displacement never selects an unavailable executor', () => {
  it('does not fall through to the executor-gated what-if lens on a repeat', () => {
    // Only flip-risk's trigger is true among the CORE lenses; the what-if
    // evaluator would fire (rank-1 factor present) but its executor is gated
    // closed, so the repeat must stand rather than surface an unrunnable lens.
    const selection = selectLens(makeFact(ONLY_FLIP_RISK_TRIGGERS), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(selection?.lens).toBe('sensitivity_flip_risk');
  });

  it('displaces onto an EXTENSION lens only when its executor is injected available', () => {
    const selection = selectLens(makeFact(ONLY_FLIP_RISK_TRIGGERS), {
      previousAnalysisLens: 'sensitivity_flip_risk',
      executorAvailable: { what_if_counterfactual: true },
    });
    expect(selection?.lens).toBe('what_if_counterfactual');
    expect(selection?.displacedLens).toBe('sensitivity_flip_risk');
  });
});
