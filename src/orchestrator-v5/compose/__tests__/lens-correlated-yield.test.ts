/**
 * ROADMAP 2.211-① — the CORRELATED-ONLY YIELD amendment to rule 1's trigger.
 *
 * The priority ORDER is unchanged (flip-risk → pre-mortem → EVPI → what-if) and
 * is not up for change here. What is narrowed is rule 1's TRIGGER: when
 * flip-risk's hit is `FLIP_RISK_CORRELATED` (which, by evaluator precedence,
 * already means NO isolated flip factor exists) AND at least one other lens is
 * triggered with an available executor on the same turn, flip-risk YIELDS the
 * head slot — it steps to the END of this turn's eligible ladder, and the
 * no-immediate-repeat tie-break then runs unchanged over the adjusted ladder.
 *
 * Ratified design (founder ruling, 2.211-①):
 *   - CORRELATED-only + another lens triggered → flip-risk yields to the next
 *     triggered lens in the locked order.
 *   - ISOLATED trigger → flip-risk keeps priority 1 unconditionally.
 *   - CORRELATED-only + NOTHING else triggered → flip-risk still emits
 *     (yielding to nothing would be suppression, which is not the ruling).
 *
 * Evidence of record: `PHASE0-EVIDENCE-2026-07-28/probe-premortem-chain-final.md`
 * — a 12-turn live walk on staging: `sensitivity_flip_risk` won the lens race
 * 12/12 (10 `FLIP_RISK_CORRELATED`, 2 `FLIP_RISK_ISOLATED`); pre_mortem emitted
 * 0/12 with its own trigger simultaneously true on the correlated turns.
 *
 * These tests are the mutation witnesses for the amendment:
 *   - delete the yield clause                → §1 / §5 / §6 walk pins RED
 *   - yield on ISOLATED too (over-broad)     → §2 pins RED
 *   - yield with no other lens (suppression) → §3 pins RED
 *   - remove flip-risk instead of demoting   → §4 steady-state alternation RED
 *   - drop the displacement bookkeeping      → §1 cause/displaced pins RED
 */

import { describe, expect, it } from 'vitest';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { selectLens, type LensId } from '../lens-selector.js';
import { derivePreviousAnalysisLens } from '../lens-history.js';

// ============================================================================
// Fixtures — same shape as lens-no-immediate-repeat.test.ts's `makeFact`.
// ============================================================================

interface FactorInput {
  readonly factor_id?: string;
  readonly influence_score?: number;
  readonly influence_rank?: number;
  readonly evpi_percentage_points?: number;
  readonly confidence?: number | null;
  readonly flip_risk_category?: string;
}

interface EnrichmentInput {
  readonly factor_sensitivity?: readonly FactorInput[];
  readonly option_comparison?: readonly { readonly win_probability?: number }[];
  readonly confidence_tier?: string;
}

function makeFact(input: EnrichmentInput = {}, computedAt = '2026-07-31T10:00:00.000Z'): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (input.factor_sensitivity !== undefined) enrichment.factor_sensitivity = input.factor_sensitivity;
  if (input.option_comparison !== undefined) enrichment.option_comparison = input.option_comparison;
  if (input.confidence_tier !== undefined) enrichment.confidence_tier = input.confidence_tier;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-2211a',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      graph_hash_at_run: 'gh_2211a_yield_0001',
      computed_at: computedAt,
      enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

/**
 * The walk's dominant shape (10 of 12 turns): rule 1a-ii fires (`correlated`
 * factor, and NO isolated one) AND rule 2c fires (max win_probability inside
 * [0.4, 0.7)). Diffuse influence keeps rule 1b silent; mid confidences keep
 * rules 2a/2b silent. Identical trigger state to the no-repeat suite's
 * BOTH_TRIGGER fixture.
 */
const CORRELATED_PLUS_PREMORTEM: EnrichmentInput = {
  confidence_tier: 'fair',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 1.0, influence_rank: 1, confidence: 0.45, flip_risk_category: 'correlated' },
    { factor_id: 'fac_b', influence_score: 0.9, influence_rank: 2, confidence: 0.45 },
    { factor_id: 'fac_c', influence_score: 0.8, influence_rank: 3, confidence: 0.45 },
  ],
  option_comparison: [{ win_probability: 0.62 }, { win_probability: 0.38 }],
};

/**
 * CORRELATED + EVPI, pre-mortem silent on all three doors (tier `strong`,
 * bands medium+, leader decisive at 0.85 ≥ MAX). The yield must land on the
 * NEXT triggered lens in the locked order — EVPI, not pre-mortem.
 */
const CORRELATED_PLUS_EVPI: EnrichmentInput = {
  confidence_tier: 'strong',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 1.0, influence_rank: 1, confidence: 0.9, flip_risk_category: 'correlated' },
    { factor_id: 'fac_b', influence_score: 0.9, influence_rank: 2, confidence: 0.9, evpi_percentage_points: 5 },
    { factor_id: 'fac_c', influence_score: 0.8, influence_rank: 3, confidence: 0.9 },
  ],
  option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
};

/**
 * CORRELATED and nothing else: pre-mortem silent (strong / medium bands /
 * decisive leader), EVPI absent. The what-if evaluator fires (a rank-1 factor
 * exists) but its executor is gated closed, so flip-risk is the ONLY eligible
 * lens. Ruling bullet 3: it still emits.
 */
const CORRELATED_ONLY: EnrichmentInput = {
  confidence_tier: 'strong',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9, flip_risk_category: 'correlated' },
    { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
    { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
  ],
  option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
};

/** ISOLATED + pre-mortem triggered — the ruling keeps flip-risk at priority 1. */
const ISOLATED_PLUS_PREMORTEM: EnrichmentInput = {
  confidence_tier: 'fair',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 1.0, influence_rank: 1, confidence: 0.45, flip_risk_category: 'isolated' },
    { factor_id: 'fac_b', influence_score: 0.9, influence_rank: 2, confidence: 0.45 },
    { factor_id: 'fac_c', influence_score: 0.8, influence_rank: 3, confidence: 0.45 },
  ],
  option_comparison: [{ win_probability: 0.62 }, { win_probability: 0.38 }],
};

/** MIXED isolated + correlated (+ pre-mortem triggered): isolated wins the
 *  evaluator, so flip-risk keeps the slot — the yield must key on the HIT, not
 *  on the mere presence of a correlated factor somewhere in the bag. */
const MIXED_ISOLATED_AND_CORRELATED: EnrichmentInput = {
  confidence_tier: 'fair',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 1.0, influence_rank: 1, confidence: 0.45, flip_risk_category: 'correlated' },
    { factor_id: 'fac_b', influence_score: 0.9, influence_rank: 2, confidence: 0.45, flip_risk_category: 'isolated' },
    { factor_id: 'fac_c', influence_score: 0.8, influence_rank: 3, confidence: 0.45 },
  ],
  option_comparison: [{ win_probability: 0.62 }, { win_probability: 0.38 }],
};

/** All three core lenses triggered, flip-risk via CORRELATED: the yield must
 *  respect the locked order among the others (pre-mortem before EVPI). */
const CORRELATED_PLUS_PREMORTEM_PLUS_EVPI: EnrichmentInput = {
  confidence_tier: 'needs_work',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 1.0, influence_rank: 1, confidence: 0.9, flip_risk_category: 'correlated' },
    { factor_id: 'fac_b', influence_score: 0.9, influence_rank: 2, confidence: 0.9, evpi_percentage_points: 5 },
    { factor_id: 'fac_c', influence_score: 0.8, influence_rank: 3, confidence: 0.9 },
  ],
  option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
};

/**
 * The rule-1b shadow edge (disclosed in the PR body): a correlated flip factor
 * COEXISTS with a would-be dominant driver (0.7/(0.7+0.2+0.1) = 0.7 share).
 * The evaluator's precedence emits `FLIP_RISK_CORRELATED` (1b is shadowed), and
 * per the ratified parenthetical — "only" ≡ no ISOLATED flip trigger — the
 * turn yields.
 */
const CORRELATED_SHADOWING_DOMINANT: EnrichmentInput = {
  confidence_tier: 'fair',
  factor_sensitivity: [
    { factor_id: 'fac_a', influence_score: 0.7, influence_rank: 1, confidence: 0.45, flip_risk_category: 'correlated' },
    { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.45 },
    { factor_id: 'fac_c', influence_score: 0.1, influence_rank: 3, confidence: 0.45 },
  ],
  option_comparison: [{ win_probability: 0.62 }, { win_probability: 0.38 }],
};

// ============================================================================
// 1. THE BAR — the ratified yield, on the walk's dominant shape. RED before fix.
// ============================================================================

describe('2.211-① — CORRELATED-only flip-risk yields to the next triggered lens', () => {
  it('CORRELATED-only + pre-mortem triggered → pre-mortem selected (no history needed)', () => {
    const selection = selectLens(makeFact(CORRELATED_PLUS_PREMORTEM));
    expect(selection?.lens).toBe('pre_mortem');
    expect(selection?.rationaleCode).toBe('WIN_PROB_MODERATE');
  });

  it('the yield records the displaced pair: flip-risk displaced, cause correlated_yield', () => {
    const selection = selectLens(makeFact(CORRELATED_PLUS_PREMORTEM));
    expect(selection?.displacedLens).toBe('sensitivity_flip_risk');
    expect(selection?.displacementCause).toBe('correlated_yield');
  });

  it('CORRELATED-only + EVPI triggered (pre-mortem not) → EVPI selected', () => {
    const selection = selectLens(makeFact(CORRELATED_PLUS_EVPI));
    expect(selection?.lens).toBe('evpi_evidence_priority');
    expect(selection?.rationaleCode).toBe('MATERIAL_EVPI');
    expect(selection?.displacedLens).toBe('sensitivity_flip_risk');
  });

  it('yields to the next lens in the LOCKED order when several others trigger (pre-mortem before EVPI)', () => {
    const selection = selectLens(makeFact(CORRELATED_PLUS_PREMORTEM_PLUS_EVPI));
    expect(selection?.lens).toBe('pre_mortem');
    expect(selection?.rationaleCode).toBe('CONFIDENCE_NEEDS_WORK');
  });

  it('a correlated hit that shadows a would-be dominant driver still yields (rule-1b shadow edge)', () => {
    const selection = selectLens(makeFact(CORRELATED_SHADOWING_DOMINANT));
    // The evaluator emits FLIP_RISK_CORRELATED here (1b shadowed) — the ruling's
    // parenthetical defines "only" as "no ISOLATED flip trigger", so this yields.
    expect(selection?.lens).toBe('pre_mortem');
  });
});

// ============================================================================
// 2. ISOLATED keeps priority 1 unconditionally — the yield must not over-reach.
// ============================================================================

describe('2.211-① — an ISOLATED trigger keeps the priority-1 slot', () => {
  it('ISOLATED + pre-mortem triggered → flip-risk selected', () => {
    const selection = selectLens(makeFact(ISOLATED_PLUS_PREMORTEM));
    expect(selection?.lens).toBe('sensitivity_flip_risk');
    expect(selection?.rationaleCode).toBe('FLIP_RISK_ISOLATED');
    expect(selection?.displacedLens).toBeUndefined();
    expect(selection?.displacementCause).toBeUndefined();
  });

  it('MIXED isolated + correlated (+ pre-mortem triggered) → flip-risk selected on the isolated hit', () => {
    const selection = selectLens(makeFact(MIXED_ISOLATED_AND_CORRELATED));
    expect(selection?.lens).toBe('sensitivity_flip_risk');
    expect(selection?.rationaleCode).toBe('FLIP_RISK_ISOLATED');
  });
});

// ============================================================================
// 3. CORRELATED-only + nothing else triggered → flip-risk still emits.
//    Yielding to nothing means suppression, which is NOT the ruling.
// ============================================================================

describe('2.211-① — the yield never suppresses (guard against over-suppression)', () => {
  it('CORRELATED-only + no other trigger → flip-risk still selected', () => {
    const selection = selectLens(makeFact(CORRELATED_ONLY));
    expect(selection?.lens).toBe('sensitivity_flip_risk');
    expect(selection?.rationaleCode).toBe('FLIP_RISK_CORRELATED');
    expect(selection?.displacedLens).toBeUndefined();
  });

  it('an executor-unavailable lens is NOT "another triggered lens" — the what-if evaluator firing under a closed gate does not cause a yield', () => {
    // CORRELATED_ONLY has a rank-1 factor, so the what-if evaluator fires; its
    // executor is gated closed by default. Yield must key on ELIGIBLE lenses.
    const selection = selectLens(makeFact(CORRELATED_ONLY), {
      executorAvailable: { what_if_counterfactual: false },
    });
    expect(selection?.lens).toBe('sensitivity_flip_risk');
  });

  it('with the extension executor injected available, the same shape DOES yield onto it', () => {
    const selection = selectLens(makeFact(CORRELATED_ONLY), {
      executorAvailable: { what_if_counterfactual: true },
    });
    expect(selection?.lens).toBe('what_if_counterfactual');
    expect(selection?.displacedLens).toBe('sensitivity_flip_risk');
    expect(selection?.displacementCause).toBe('correlated_yield');
  });

  it('may-recommend-nothing is untouched: a healthy analysis still returns null', () => {
    const healthy: EnrichmentInput = {
      confidence_tier: 'strong',
      factor_sensitivity: [
        { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
        { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    };
    expect(selectLens(makeFact(healthy))).toBeNull();
  });
});

// ============================================================================
// 4. Composition with no-immediate-repeat — yield is a DEMOTION, not a removal.
//    The steady state alternates (P F P F…), never P P P P (monotony) and never
//    F F F F (the measured starvation).
// ============================================================================

describe('2.211-① — composition with the no-immediate-repeat tie-break', () => {
  it('after a yield to pre-mortem, the next turn (prev = pre_mortem) alternates onto flip-risk via no-repeat', () => {
    const selection = selectLens(makeFact(CORRELATED_PLUS_PREMORTEM), {
      previousAnalysisLens: 'pre_mortem',
    });
    expect(selection?.lens).toBe('sensitivity_flip_risk');
    expect(selection?.rationaleCode).toBe('FLIP_RISK_CORRELATED');
    // This is a no-repeat displacement of pre_mortem, and is recorded as such.
    expect(selection?.displacedLens).toBe('pre_mortem');
    expect(selection?.displacementCause).toBe('no_repeat');
  });

  it('prev = flip-risk on a correlated turn: the yield already moves the slot, no double bookkeeping', () => {
    const selection = selectLens(makeFact(CORRELATED_PLUS_PREMORTEM), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(selection?.lens).toBe('pre_mortem');
    expect(selection?.displacedLens).toBe('sensitivity_flip_risk');
    expect(selection?.displacementCause).toBe('correlated_yield');
  });

  it('three-lens turn with prev = pre_mortem: no-repeat lands on EVPI (locked order among the others)', () => {
    const selection = selectLens(makeFact(CORRELATED_PLUS_PREMORTEM_PLUS_EVPI), {
      previousAnalysisLens: 'pre_mortem',
    });
    expect(selection?.lens).toBe('evpi_evidence_priority');
    expect(selection?.displacedLens).toBe('pre_mortem');
    expect(selection?.displacementCause).toBe('no_repeat');
  });

  it('steady state on the walk shape is alternation: P F P F, never monotony in either lens', () => {
    const emitted: (LensId | null)[] = [];
    let previous: LensId | null = null;
    for (let turn = 0; turn < 6; turn += 1) {
      const selection = selectLens(makeFact(CORRELATED_PLUS_PREMORTEM), {
        previousAnalysisLens: previous,
      });
      emitted.push(selection?.lens ?? null);
      previous = selection?.lens ?? null;
    }
    expect(emitted).toStrictEqual([
      'pre_mortem',
      'sensitivity_flip_risk',
      'pre_mortem',
      'sensitivity_flip_risk',
      'pre_mortem',
      'sensitivity_flip_risk',
    ]);
  });

  it('CORRELATED-only shape (nothing else triggered): the repeat stands — no-repeat has nothing to move to', () => {
    const selection = selectLens(makeFact(CORRELATED_ONLY), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(selection?.lens).toBe('sensitivity_flip_risk');
  });
});

// ============================================================================
// 5. The shipped history replay sees the YIELDED-TO lens, not flip-risk.
//    (lens-history replays selectLens itself, so this pins the real path.)
// ============================================================================

describe('2.211-① — derivePreviousAnalysisLens replays the yield', () => {
  it('a prior correlated+pre-mortem turn replays as pre_mortem, and the next turn no-repeats onto flip-risk', () => {
    const prior: HandlerFact[] = [
      makeFact(CORRELATED_PLUS_PREMORTEM, '2026-07-31T10:00:00.000Z') as unknown as HandlerFact,
    ];
    const previous = derivePreviousAnalysisLens(prior);
    expect(previous).toBe('pre_mortem');

    const next = selectLens(makeFact(CORRELATED_PLUS_PREMORTEM, '2026-07-31T10:05:00.000Z'), {
      previousAnalysisLens: previous,
    });
    expect(next?.lens).toBe('sensitivity_flip_risk');
  });

  it('two prior turns replay the alternation (P then F), so turn 3 emits pre_mortem again', () => {
    const prior: HandlerFact[] = [
      makeFact(CORRELATED_PLUS_PREMORTEM, '2026-07-31T10:00:00.000Z') as unknown as HandlerFact,
      makeFact(CORRELATED_PLUS_PREMORTEM, '2026-07-31T10:05:00.000Z') as unknown as HandlerFact,
    ];
    const previous = derivePreviousAnalysisLens(prior);
    expect(previous).toBe('sensitivity_flip_risk');

    const next = selectLens(makeFact(CORRELATED_PLUS_PREMORTEM, '2026-07-31T10:10:00.000Z'), {
      previousAnalysisLens: previous,
    });
    expect(next?.lens).toBe('pre_mortem');
  });
});

// ============================================================================
// 6. THE WALK PIN — the 12-turn shape of probe-premortem-chain-final.md.
//    10 CORRELATED turns (another lens triggered) must now yield; the 2
//    ISOLATED turns (b5, b8) must not. Each turn was a fresh chip-driven
//    scenario on the walk, so each is evaluated without history.
// ============================================================================

describe('2.211-① — the 12-turn walk shape no longer starves', () => {
  // b5 was ISOLATED with no pre-mortem signal; b8 ISOLATED with one. Both keep
  // flip-risk under the ruling.
  const ISOLATED_NO_PREMORTEM: EnrichmentInput = {
    confidence_tier: 'strong',
    factor_sensitivity: [
      { factor_id: 'fac_a', influence_score: 1.0, influence_rank: 1, confidence: 0.9, flip_risk_category: 'isolated' },
      { factor_id: 'fac_b', influence_score: 0.9, influence_rank: 2, confidence: 0.9 },
    ],
    option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
  };

  const WALK: readonly { turn: string; shape: EnrichmentInput; expected: LensId }[] = [
    { turn: 'b2', shape: CORRELATED_PLUS_PREMORTEM, expected: 'pre_mortem' },
    { turn: 'b5', shape: ISOLATED_NO_PREMORTEM, expected: 'sensitivity_flip_risk' },
    { turn: 'b7', shape: CORRELATED_PLUS_PREMORTEM, expected: 'pre_mortem' },
    { turn: 'b8', shape: ISOLATED_PLUS_PREMORTEM, expected: 'sensitivity_flip_risk' },
    { turn: 'c1', shape: CORRELATED_PLUS_PREMORTEM, expected: 'pre_mortem' },
    { turn: 'd1', shape: CORRELATED_PLUS_PREMORTEM, expected: 'pre_mortem' },
    { turn: 'e1', shape: CORRELATED_PLUS_PREMORTEM, expected: 'pre_mortem' },
    { turn: 'e2', shape: CORRELATED_PLUS_PREMORTEM, expected: 'pre_mortem' },
    { turn: 'f1', shape: CORRELATED_PLUS_PREMORTEM, expected: 'pre_mortem' },
    { turn: 'f2', shape: CORRELATED_PLUS_PREMORTEM, expected: 'pre_mortem' },
    { turn: 'g1', shape: CORRELATED_PLUS_PREMORTEM, expected: 'pre_mortem' },
    { turn: 'g1r2', shape: CORRELATED_PLUS_PREMORTEM, expected: 'pre_mortem' },
  ];

  it('every CORRELATED turn yields, every ISOLATED turn keeps flip-risk', () => {
    for (const { turn, shape, expected } of WALK) {
      const selection = selectLens(makeFact(shape));
      expect(selection?.lens, `walk turn ${turn}`).toBe(expected);
    }
  });

  it('the emission tally is 10 pre_mortem / 2 flip-risk — not 12/12 flip-risk', () => {
    const tally = new Map<string, number>();
    for (const { shape } of WALK) {
      const lens = selectLens(makeFact(shape))?.lens ?? 'none';
      tally.set(lens, (tally.get(lens) ?? 0) + 1);
    }
    expect(tally.get('pre_mortem')).toBe(10);
    expect(tally.get('sensitivity_flip_risk')).toBe(2);
    expect(tally.get('none')).toBeUndefined();
  });
});
