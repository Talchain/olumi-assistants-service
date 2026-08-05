/**
 * Capability layer — DSK-derived deterministic lens triggers (slice 1).
 *
 * Two new lenses, each a pure computable-fact reading of a DSK trigger
 * object's firing condition (data/dsk/v1.json — attested by identity in
 * dsk-provenance-attestation.test.ts):
 *
 *   consider_opposite (DSK-TR-003 → DSK-P-003 disconfirmation):
 *     ≥2 finite win probabilities AND leader ≥ PREMORTEM_WINPROB_MAX (the
 *     decisive region — boundary-complementary with pre_mortem rule 2c)
 *     AND leader − runner-up ≥ CONSIDER_OPPOSITE_MIN_SEPARATION (TR-003's
 *     own close-call negative condition) AND the raw robustness level is
 *     PRESENT and non-fragile (TR-003 states a POSITIVE robustness
 *     condition — an absent attestation must NOT fire) AND the raw
 *     near_tie.is_tie override is not set.
 *
 *   devils_advocacy (DSK-TR-005 → DSK-P-005 devil's advocate):
 *     one factor carries a strict-majority influence share (the SAME
 *     dominance derivation as sensitivity rule 1b — one derivation, two
 *     callers) AND robustness is not ATTESTED fragile (TR-005's negative
 *     condition only excludes shown-fragile — absent may fire).
 *
 * These tests are the mutation witnesses for every new trigger clause:
 * deleting a ladder entry, a separation guard, a robustness clause, or the
 * shared dominance derivation turns a named case RED.
 */

import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  BODY_BY_RATIONALE,
  CONSIDER_OPPOSITE_MIN_SEPARATION,
  PREMORTEM_WINPROB_MAX,
  TITLE_BY_LENS,
  selectLens,
} from '../lens-selector.js';
import {
  FORBIDDEN_HEADLINE_VOCABULARY_REGEX,
  RAW_DECIMAL_REGEX,
  ASSISTANT_TEXT_ID_REGEX,
} from '../../coaching/assistant-text-defences.js';

// ============================================================================
// Fixtures — extends the lens-selector.test.ts pattern with the raw
// enrichment.robustness object the DSK conditions read.
// ============================================================================

interface FactorInput {
  readonly factor_id?: string;
  readonly influence_score?: number;
  readonly influence_rank?: number;
  readonly evpi_percentage_points?: number;
  readonly confidence?: number | null;
  readonly flip_risk_category?: string;
}

interface OptionInput {
  readonly win_probability?: number;
}

interface RobustnessInput {
  readonly level?: string;
  readonly near_tie?: { readonly is_tie?: boolean };
}

interface EnrichmentInput {
  readonly factor_sensitivity?: readonly FactorInput[];
  readonly option_comparison?: readonly OptionInput[];
  readonly confidence_tier?: string;
  readonly robustness?: RobustnessInput;
}

function makeFact(input: EnrichmentInput = {}): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (input.factor_sensitivity !== undefined) {
    enrichment.factor_sensitivity = input.factor_sensitivity;
  }
  if (input.option_comparison !== undefined) {
    enrichment.option_comparison = input.option_comparison;
  }
  if (input.confidence_tier !== undefined) {
    enrichment.confidence_tier = input.confidence_tier;
  }
  if (input.robustness !== undefined) {
    enrichment.robustness = input.robustness;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      graph_hash_at_run: 'gh_a1b2c3d4e5f60001',
      computed_at: '2026-08-05T00:00:00.000Z',
      enrichment,
    },
  } as unknown as RunAnalysisHandlerFact;
}

/**
 * Balanced factor bank: no flip category, no dominance, no low confidence,
 * no EVPI — so rules 1/2b/3 stay silent and the DSK lenses are isolated.
 */
const BALANCED_FACTORS: readonly FactorInput[] = [
  { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9 },
  { factor_id: 'fac_b', influence_score: 0.33, influence_rank: 2, confidence: 0.9 },
  { factor_id: 'fac_c', influence_score: 0.33, influence_rank: 3, confidence: 0.9 },
];

/** Decisive, attested-stable base that fires ONLY consider_opposite. */
const DECISIVE_ATTESTED: EnrichmentInput = {
  confidence_tier: 'strong',
  factor_sensitivity: BALANCED_FACTORS,
  option_comparison: [{ win_probability: 0.75 }, { win_probability: 0.25 }],
  robustness: { level: 'high' },
};

/** Dominant-driver base (rule 1b fires too — sensitivity outranks). */
const DOMINANT: EnrichmentInput = {
  confidence_tier: 'strong',
  factor_sensitivity: [
    { factor_id: 'fac_dom', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
    { factor_id: 'fac_b', influence_score: 0.15, influence_rank: 2, confidence: 0.9 },
    { factor_id: 'fac_c', influence_score: 0.05, influence_rank: 3, confidence: 0.9 },
  ],
  // Moderate leader so pre_mortem 2c also fires (0.4 ≤ 0.55 < 0.7) — proves
  // devils_advocacy sits BELOW pre_mortem in the ladder on displacement.
  option_comparison: [{ win_probability: 0.55 }, { win_probability: 0.45 }],
};

// ============================================================================
// consider_opposite — DSK-TR-003
// ============================================================================

describe('selectLens — consider_opposite (DSK-TR-003 disconfirmation)', () => {
  it('fires on a decisive, attested-non-fragile leader when no higher lens triggers', () => {
    const selection = selectLens(makeFact(DECISIVE_ATTESTED));
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('consider_opposite');
    expect(selection!.rationaleCode).toBe('CLEAR_WINNER_DISCONFIRMATION');
    expect(selection!.groundingField).toBe('option_comparison');
    // Option-level subject: no single-factor subjectRef — the focus
    // directive falls back to the v1 winner-highlight.
    expect(selection!.subjectRef).toBeUndefined();
  });

  it('fires at EXACTLY the pre_mortem 2c boundary (leader == PREMORTEM_WINPROB_MAX)', () => {
    // Complementarity pin: 2c owns [MIN, MAX); consider_opposite owns [MAX, 1].
    const selection = selectLens(
      makeFact({
        ...DECISIVE_ATTESTED,
        option_comparison: [
          { win_probability: PREMORTEM_WINPROB_MAX },
          { win_probability: 0.2 },
        ],
      }),
    );
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('consider_opposite');
  });

  it('does NOT fire below the decisive threshold (pre_mortem 2c owns that region)', () => {
    const selection = selectLens(
      makeFact({
        ...DECISIVE_ATTESTED,
        option_comparison: [{ win_probability: 0.69 }, { win_probability: 0.31 }],
      }),
    );
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('pre_mortem');
    expect(selection!.rationaleCode).toBe('WIN_PROB_MODERATE');
  });

  it('does NOT fire when separation is under the close-call floor (non-normalised producer values)', () => {
    // TR-003's negative condition: separation <10% is a close call. Only
    // reachable with non-normalised win probabilities — exactly the
    // defensive case the guard exists for.
    const selection = selectLens(
      makeFact({
        ...DECISIVE_ATTESTED,
        option_comparison: [{ win_probability: 0.75 }, { win_probability: 0.68 }],
      }),
    );
    expect(selection).toBeNull();
  });

  it('fires at the separation floor', () => {
    // 0.8 − 0.7 evaluates to ≥ 0.1 in IEEE-754 (0.10000000000000009) — the
    // fixture pins the floor without manufacturing a float just under it
    // (0.8 − CONSIDER_OPPOSITE_MIN_SEPARATION is 0.7000000000000001, whose
    // separation reads 0.0999… and honestly does NOT clear the floor).
    expect(0.8 - 0.7).toBeGreaterThanOrEqual(CONSIDER_OPPOSITE_MIN_SEPARATION);
    const selection = selectLens(
      makeFact({
        ...DECISIVE_ATTESTED,
        option_comparison: [{ win_probability: 0.8 }, { win_probability: 0.7 }],
      }),
    );
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('consider_opposite');
  });

  it('does NOT fire without an ATTESTED robustness level (positive condition, fail-closed)', () => {
    const { robustness: _omitted, ...rest } = DECISIVE_ATTESTED;
    expect(selectLens(makeFact(rest))).toBeNull();
  });

  it('does NOT fire when robustness is attested fragile (any RAW_FRAGILE_LEVELS synonym)', () => {
    for (const level of ['very_low', 'low', 'fragile']) {
      expect(
        selectLens(makeFact({ ...DECISIVE_ATTESTED, robustness: { level } })),
        `level=${level} must suppress`,
      ).toBeNull();
    }
  });

  it('does NOT fire when the raw near_tie.is_tie override is set (upstream knows better)', () => {
    expect(
      selectLens(
        makeFact({
          ...DECISIVE_ATTESTED,
          robustness: { level: 'high', near_tie: { is_tie: true } },
        }),
      ),
    ).toBeNull();
  });

  it('does NOT fire on a single-entry option comparison (no alternative to argue against)', () => {
    expect(
      selectLens(
        makeFact({
          ...DECISIVE_ATTESTED,
          option_comparison: [{ win_probability: 0.9 }],
        }),
      ),
    ).toBeNull();
  });

  it('yields to every higher-priority lens (EVPI outranks it)', () => {
    const selection = selectLens(
      makeFact({
        ...DECISIVE_ATTESTED,
        factor_sensitivity: [
          ...BALANCED_FACTORS.slice(1),
          { factor_id: 'fac_a', influence_score: 0.34, influence_rank: 1, confidence: 0.9, evpi_percentage_points: 5 },
        ],
      }),
    );
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('evpi_evidence_priority');
  });
});

// ============================================================================
// devils_advocacy — DSK-TR-005
// ============================================================================

describe('selectLens — devils_advocacy (DSK-TR-005 structured dissent)', () => {
  it('is reachable via no-repeat displacement below pre_mortem when dominance holds', () => {
    // Dominance fires rule 1b (sensitivity head) AND 2c (pre_mortem) AND
    // devils_advocacy. Previous turn = sensitivity → head displaced to the
    // runner-up, which is pre_mortem — devils_advocacy stays below it.
    const displaced = selectLens(makeFact(DOMINANT), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(displaced).not.toBeNull();
    expect(displaced!.lens).toBe('pre_mortem');
  });

  it('wins the slot when dominance holds and the higher lenses are silent', () => {
    // Decisive leader (2c silent), strong tier (2a silent), high confidence
    // (2b silent), no flip categories, no EVPI, robustness absent —
    // sensitivity 1b still fires, so displace it via no-repeat.
    const fact = makeFact({
      confidence_tier: 'strong',
      factor_sensitivity: [
        { factor_id: 'fac_dom', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      // No robustness attestation: consider_opposite must NOT fire (positive
      // condition) while devils_advocacy MAY (negative condition).
    });
    const selection = selectLens(fact, { previousAnalysisLens: 'sensitivity_flip_risk' });
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('devils_advocacy');
    expect(selection!.rationaleCode).toBe('DOMINANT_FACTOR_DISSENT');
    expect(selection!.groundingField).toBe('factor_sensitivity');
    // Identity-bound subject: the dominating factor, by id.
    expect(selection!.subjectRef).toEqual({ id: 'fac_dom', kind: 'factor' });
    // The displacement pair is recorded (no_repeat moved the slot).
    expect(selection!.displacedLens).toBe('sensitivity_flip_risk');
    expect(selection!.displacementCause).toBe('no_repeat');
  });

  it('does NOT fire when robustness is ATTESTED fragile (the analysis already challenges)', () => {
    const fact = makeFact({
      confidence_tier: 'strong',
      factor_sensitivity: [
        { factor_id: 'fac_dom', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      robustness: { level: 'very_low' },
    });
    // With devils_advocacy suppressed and everything else silent, the
    // displaced head has NO runner-up — the repeat stands (2.211 condition 2).
    const selection = selectLens(fact, { previousAnalysisLens: 'sensitivity_flip_risk' });
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('sensitivity_flip_risk');
  });

  it('does NOT fire without a strict-majority driver (two equal halves)', () => {
    const fact = makeFact({
      confidence_tier: 'strong',
      factor_sensitivity: [
        { factor_id: 'fac_a', influence_score: 0.5, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.5, influence_rank: 2, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    // Nothing fires at all: 1b needs a STRICT majority, and so does
    // devils_advocacy (the same shared derivation).
    expect(selectLens(fact, { previousAnalysisLens: 'sensitivity_flip_risk' })).toBeNull();
  });

  it('is the 2.211-① correlated-yield beneficiary when dominance holds alongside a correlated hit', () => {
    // A correlated flip hit is the WEAKEST rule-1 door and yields the head
    // slot whenever any other lens fired (founder-ratified 2.211-①). With
    // devils_advocacy in the ladder, a correlated + dominant-factor turn now
    // has a beneficiary — the structured-dissent exercise on that factor.
    const selection = selectLens(
      makeFact({
        factor_sensitivity: [
          {
            factor_id: 'fac_dom',
            influence_score: 0.5,
            influence_rank: 1,
            confidence: 0.9,
            flip_risk_category: 'correlated',
          },
          { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 },
        ],
      }),
    );
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('devils_advocacy');
    expect(selection!.displacedLens).toBe('sensitivity_flip_risk');
    expect(selection!.displacementCause).toBe('correlated_yield');
  });

  it('ranks ABOVE what_if_counterfactual (a DSK-derived lens beats the generic explorer)', () => {
    const fact = makeFact({
      confidence_tier: 'strong',
      factor_sensitivity: [
        { factor_id: 'fac_dom', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
    });
    const selection = selectLens(fact, {
      previousAnalysisLens: 'sensitivity_flip_risk',
      executorAvailable: { what_if_counterfactual: true },
    });
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('devils_advocacy');
  });
});

// ============================================================================
// Copy bank — prose-guard-clean, like every other lens string
// ============================================================================

describe('DSK lens copy — clean against the assistant-text defences', () => {
  const NEW_COPY: readonly string[] = [
    TITLE_BY_LENS.consider_opposite,
    TITLE_BY_LENS.devils_advocacy,
    BODY_BY_RATIONALE.CLEAR_WINNER_DISCONFIRMATION,
    BODY_BY_RATIONALE.DOMINANT_FACTOR_DISSENT,
  ];

  it('carries no forbidden vocabulary, raw decimals, or entity ids', () => {
    for (const copy of NEW_COPY) {
      expect(copy.length).toBeGreaterThan(0);
      expect(copy).not.toMatch(FORBIDDEN_HEADLINE_VOCABULARY_REGEX);
      expect(copy).not.toMatch(RAW_DECIMAL_REGEX);
      expect(copy).not.toMatch(ASSISTANT_TEXT_ID_REGEX);
    }
  });
});
