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
  LENS_DSK_PROVENANCE,
  PREMORTEM_WINPROB_MAX,
  TITLE_BY_LENS,
  selectLens,
  type LensId,
} from '../lens-selector.js';
import { RAW_FRAGILE_LEVELS } from '../../coaching/robustness-honesty.js';
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
  readonly factor_evppi?: readonly Record<string, unknown>[];
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
  if (input.factor_evppi !== undefined) {
    enrichment.factor_evppi = input.factor_evppi;
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
 * no EVPPI — so rules 1/2b/3 stay silent and the DSK lenses are isolated.
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

  it('yields to every higher-priority lens (resolved EVPPI outranks it)', () => {
    const selection = selectLens(
      makeFact({
        ...DECISIVE_ATTESTED,
        factor_evppi: [{ factor_id: 'fac_a', evppi: 0.4, status: 'resolved' }],
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
  it('takes the displaced-sensitivity slot AHEAD of pre_mortem when dominance holds (2.490)', () => {
    // ⚠ THIS ASSERTION WAS INVERTED AT ROADMAP 2.490, DELIBERATELY. It read
    // `toBe('pre_mortem')` — devils_advocacy sat below pre_mortem on a
    // displaced sensitivity head, which (with devils' trigger being a strict
    // SUBSET of sensitivity rule 1b's) is what made the lens unreachable on
    // every live capture. The 2.490 SEQUENCE rule gives the displaced
    // sensitivity slot to the exercise about the driver it just named.
    // This is a change to shared 2.211 promotion order, on the record here and
    // evidenced against the live captures in `lens-dsk-sequence-2490.test.ts`.
    const displaced = selectLens(makeFact(DOMINANT), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(displaced).not.toBeNull();
    expect(displaced!.lens).toBe('devils_advocacy');
    expect(displaced!.displacedLens).toBe('sensitivity_flip_risk');
    expect(displaced!.displacementCause).toBe('no_repeat');
    // NON-VACUITY, AND EXACTLY WHAT IT DOES AND DOES NOT SHOW. It shows that
    // pre_mortem's rule 2c trigger is genuinely live on this option_comparison
    // (leader 0.55 ∈ [0.4, 0.7)) — so the lens devils displaced above is a real
    // competitor and not a lens that never fired.
    // ⚠ It does NOT show pre_mortem losing a DISPLACED slot: with BALANCED_
    // FACTORS neither rule 1b nor devils fires, so sensitivity is not eligible
    // at all and pre_mortem here is the HEAD, winning outright with no
    // displacement. An earlier version of this comment called that "not an
    // uncontested fallthrough", which is backwards — it IS one. The
    // displaced-slot claim is proven on the live capture instead, in
    // `lens-dsk-sequence-2490.test.ts` §5, where sensitivity IS the head and
    // pre_mortem IS the runner-up it takes the slot from.
    const withoutDominance = selectLens(
      makeFact({ ...DOMINANT, factor_sensitivity: BALANCED_FACTORS }),
      { previousAnalysisLens: 'sensitivity_flip_risk' },
    );
    expect(withoutDominance).not.toBeNull();
    expect(withoutDominance!.lens).toBe('pre_mortem');
  });

  it('wins the slot when dominance holds and the higher lenses are silent', () => {
    // Decisive leader (2c silent), strong tier (2a silent), high confidence
    // (2b silent), no flip categories, no EVPPI, robustness absent —
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

  it('FIRES on an ATTESTED fragile level — TR-005s robustness clause is overridden (2.490)', () => {
    // ⚠ THIS ASSERTION WAS INVERTED AT ROADMAP 2.490, DELIBERATELY. It read
    // `toBe('sensitivity_flip_risk')` — i.e. the lens was suppressed on a
    // fragile level, per DSK-TR-005's declared "...AND robustness != 'fragile'".
    // That clause is no longer implemented: in this platform `robustness.level`
    // is the LEADER'S WIN PROBABILITY banded against 0.7, so it means "no option
    // clearly wins" and says nothing about the dominant driver's weighting —
    // which is the only thing DSK-P-005 challenges. The clause's declared
    // purpose is not served by the field it was implemented against, and the
    // measured effect was a perfect anti-filter (0 of 5 live sessions). Full
    // reasoning: `evaluateDevilsAdvocacy`'s doc comment.
    const fact = makeFact({
      confidence_tier: 'strong',
      factor_sensitivity: [
        { factor_id: 'fac_dom', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
        { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 },
      ],
      option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
      robustness: { level: 'very_low' },
    });
    // PRECONDITION — the level really is one the shared truth table calls
    // fragile, so this test cannot rot into a no-op if the vocabulary moves.
    expect(RAW_FRAGILE_LEVELS.has('very_low')).toBe(true);
    const selection = selectLens(fact, { previousAnalysisLens: 'sensitivity_flip_risk' });
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('devils_advocacy');
    expect(selection!.subjectRef).toEqual({ id: 'fac_dom', kind: 'factor' });
  });

  it('the override is DEVILS-ONLY — consider_opposite still refuses a fragile level', () => {
    // Discriminating control (trap 13b): the same fragile level, on the lens
    // whose robustness condition is POSITIVE. If hunk 2 had disabled fragility
    // globally rather than removing one clause from one evaluator, this would
    // still emit consider_opposite.
    const fragile = selectLens(
      makeFact({ ...DECISIVE_ATTESTED, robustness: { level: 'very_low' } }),
    );
    expect(fragile?.lens).not.toBe('consider_opposite');
    // …and the ONLY difference is the level: with the attested one it fires.
    expect(selectLens(makeFact(DECISIVE_ATTESTED))!.lens).toBe('consider_opposite');
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
// DSK contraindications — "do not run IMMEDIATELY AFTER" (review F3)
// ============================================================================

/**
 * ⚠ THE 2.211 NO-IMMEDIATE-REPEAT TIE-BREAK RUNS THE WRONG WAY FOR THESE TWO
 * PROTOCOLS, AND SHIPPING WITHOUT THIS FILTER WOULD HAVE EMITTED THE EXACT
 * SEQUENCE OUR OWN BUNDLED SCIENCE FORBIDS.
 *
 * Bundle bytes (`data/dsk/v1.json`, protocol `contraindications`):
 *   DSK-P-003 — "Do not run immediately after the user has already run a
 *                pre-mortem on the same decision"
 *   DSK-P-005 — "Do not run immediately after a pre-mortem or disconfirmation
 *                exercise on the same decision"
 *
 * 2.211 hands a repeated head's slot to the RUNNER-UP. With these lenses on the
 * ladder, a `pre_mortem` turn followed by another `pre_mortem`-triggering turn
 * promotes `consider_opposite` — i.e. the platform emits disconfirmation
 * IMMEDIATELY AFTER a pre-mortem, precisely the contraindicated sequence. The
 * diversity rule and the protocol's own science point in opposite directions,
 * and the science wins.
 *
 * This needs NO new persistence: `previousAnalysisLens` is already threaded for
 * 2.211, so "immediately after" is answerable today. The GENERAL cooldown class
 * (a per-stage fired-ledger: "already run this exercise this stage", "already
 * completed a structured risk assessment") is genuinely beyond what the current
 * inputs can answer and stays slice-2 work.
 */
describe('selectLens — DSK "do not run immediately after" contraindications', () => {
  /** Fires pre_mortem 2a AND consider_opposite (decisive + attested stable). */
  const PREMORTEM_THEN_CONSIDER: EnrichmentInput = {
    confidence_tier: 'needs_work',
    factor_sensitivity: BALANCED_FACTORS,
    option_comparison: [{ win_probability: 0.75 }, { win_probability: 0.25 }],
    robustness: { level: 'high' },
  };

  it('the unfiltered ladder WOULD promote consider_opposite after a pre-mortem (premise control)', () => {
    // Non-vacuity: both lenses genuinely trigger on this fact, and pre_mortem
    // genuinely wins the slot when it is NOT the previous lens. Without this,
    // the suppression test below could pass because nothing fired at all.
    const fresh = selectLens(makeFact(PREMORTEM_THEN_CONSIDER), {
      previousAnalysisLens: null,
    });
    expect(fresh).not.toBeNull();
    expect(fresh!.lens).toBe('pre_mortem');
    // And consider_opposite is a genuine runner-up on the same fact.
    const withoutPreMortem = selectLens(
      makeFact({ ...PREMORTEM_THEN_CONSIDER, confidence_tier: 'strong' }),
    );
    expect(withoutPreMortem).not.toBeNull();
    expect(withoutPreMortem!.lens).toBe('consider_opposite');
  });

  it('DSK-P-003: consider_opposite does NOT run immediately after a pre-mortem', () => {
    const selection = selectLens(makeFact(PREMORTEM_THEN_CONSIDER), {
      previousAnalysisLens: 'pre_mortem',
    });
    // The contraindicated lens must not be selected AT ALL on this turn —
    // not merely denied the head slot (a runner-up promotion would emit it).
    expect(selection?.lens).not.toBe('consider_opposite');
  });

  /**
   * ⚠ THESE TWO FIXTURES NEED A CORRELATED FLIP HIT, AND THE FIRST DRAFT OF
   * THIS SPEC DID NOT HAVE ONE — SO BOTH TESTS PASSED VACUOUSLY (trap 13b: a
   * guard agreeing with itself). devils_advocacy REQUIRES dominance, and
   * dominance also fires sensitivity rule 1b, which outranks it — so on a plain
   * dominance fact the selection is `sensitivity_flip_risk` and "not
   * devils_advocacy" holds for a reason that has nothing to do with the filter.
   * The 2.211-① correlated yield is what actually lets devils_advocacy reach
   * the slot: correlated head yields to the end, the no-repeat tie-break then
   * promotes the runner-up. Each test asserts that promotion happens WITHOUT
   * the contraindicated predecessor (the premise control) before asserting it
   * does not happen WITH it.
   */
  /**
   * ONE base fact, three predecessors. The CURRENT turn need not fire the
   * contraindicated predecessor's own lens — `previousAnalysisLens` describes
   * the PREVIOUS analysis turn — so this fact is built to make
   * devils_advocacy the natural head (correlated hit yields under 2.211-①,
   * leaving dissent at the front), and each test varies only what ran before.
   */
  const DEVILS_IS_HEAD: EnrichmentInput = {
    confidence_tier: 'strong',
    factor_sensitivity: [
      {
        factor_id: 'fac_dom',
        influence_score: 0.8,
        influence_rank: 1,
        confidence: 0.9,
        flip_risk_category: 'correlated',
      },
      { factor_id: 'fac_b', influence_score: 0.2, influence_rank: 2, confidence: 0.9 },
    ],
    option_comparison: [{ win_probability: 0.85 }, { win_probability: 0.15 }],
  };

  it('premise control: devils_advocacy IS the selection on this fact after a neutral lens', () => {
    const reachable = selectLens(makeFact(DEVILS_IS_HEAD), {
      previousAnalysisLens: 'evpi_evidence_priority',
    });
    expect(reachable).not.toBeNull();
    expect(reachable!.lens).toBe('devils_advocacy');
  });

  it('DSK-P-005: devils_advocacy does NOT run immediately after a pre-mortem', () => {
    const selection = selectLens(makeFact(DEVILS_IS_HEAD), {
      previousAnalysisLens: 'pre_mortem',
    });
    expect(selection?.lens).not.toBe('devils_advocacy');
  });

  it('DSK-P-005: devils_advocacy does NOT run immediately after disconfirmation', () => {
    const selection = selectLens(makeFact(DEVILS_IS_HEAD), {
      previousAnalysisLens: 'consider_opposite',
    });
    expect(selection?.lens).not.toBe('devils_advocacy');
  });

  it('DSK-P-003 is NOT suppressed after a devil\'s advocate turn (asymmetry is the bundle\'s, verbatim)', () => {
    // DSK-P-003's contraindication names ONLY the pre-mortem; DSK-P-005's names
    // pre-mortem AND disconfirmation. The map must not be "tidied" into a
    // symmetric set — that would suppress a protocol its own science permits.
    const selection = selectLens(
      makeFact({ ...DECISIVE_ATTESTED, confidence_tier: 'strong' }),
      { previousAnalysisLens: 'devils_advocacy' },
    );
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('consider_opposite');
  });

  it('an unrelated previous lens suppresses neither (the filter is targeted, not blanket)', () => {
    const selection = selectLens(makeFact(DECISIVE_ATTESTED), {
      previousAnalysisLens: 'evpi_evidence_priority',
    });
    expect(selection).not.toBeNull();
    expect(selection!.lens).toBe('consider_opposite');
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

// ============================================================================
// ROADMAP 2.490 — devils_advocacy REACHABILITY when BOTH DSK triggers fire.
//
// THE GAP THIS CLOSES: before 2.490 no spec in this file made TR-003 and
// TR-005 fire on the SAME turn. `DECISIVE_ATTESTED` uses balanced factors (no
// dominance ⇒ devils dark); `DOMINANT` omits robustness (⇒ consider_opposite
// dark). So the ORDER between the two DSK lenses was never exercised, and the
// whole suite passed identically with the ladder entries either way round —
// verified by running it against both orders. The defect shipped through a
// hole shaped exactly like the fixtures.
//
// THE LIVE SHAPE (`PHASE0-EVIDENCE-2026-07-28/walk-dsk-raw/sessionA`): leader
// 0.8576, dominance share 0.5453, `robustness.level: 'high'`. Both triggers
// true. Measured over all five captured sessions BEFORE this change,
// devils_advocacy was selected ZERO times, on every `previousAnalysisLens`
// state and every turn of a cycle walk.
//
// ⚠ THE FIXTURES BELOW ARE HAND-BUILT, AND THAT IS THIS BLOCK'S LIMIT. They
// approximate sessionA but omit `flip_risk_category`, which is the single field
// deciding whether the 2.211-① correlated yield engages — i.e. exactly the
// field whose absence made the slice-1 suite blind. The reachability FIX is
// therefore measured against the VERBATIM captures in
// `lens-dsk-sequence-2490.test.ts`; what this block still owns is the
// both-triggers ORDER, which no capture happens to exercise on a non-yielding
// head. Keep both: one notices the ladder inverting, the other notices the wire
// moving.
// ============================================================================

/** sessionA's shape: a decisive leader AND a dominant driver AND an attested
 *  non-fragile level — the turn on which TR-003 and TR-005 are both true. */
const BOTH_TRIGGERS_FIRE: EnrichmentInput = {
  confidence_tier: 'strong',
  factor_sensitivity: [
    { factor_id: 'fac_dom', influence_score: 0.8, influence_rank: 1, confidence: 0.9 },
    { factor_id: 'fac_b', influence_score: 0.15, influence_rank: 2, confidence: 0.9 },
    { factor_id: 'fac_c', influence_score: 0.05, influence_rank: 3, confidence: 0.9 },
  ],
  option_comparison: [{ win_probability: 0.86 }, { win_probability: 0.08 }],
  robustness: { level: 'high' },
};

/**
 * Walk N consecutive analysis turns on the SAME enrichment, feeding each
 * selection back as `previousAnalysisLens` — the way the live path threads it.
 * Returns the lens sequence. A single-turn probe cannot see this defect: the
 * starvation is a property of the CYCLE, not of any one turn.
 */
function walkTurns(input: EnrichmentInput, turns = 6): (LensId | null)[] {
  const fact = makeFact(input);
  const seen: (LensId | null)[] = [];
  let previous: LensId | null = null;
  for (let t = 0; t < turns; t++) {
    const selection = selectLens(fact, { previousAnalysisLens: previous });
    const lens = selection === null ? null : selection.lens;
    seen.push(lens);
    previous = lens;
  }
  return seen;
}

/** BOTH_TRIGGERS_FIRE with the robustness attestation REMOVED. TR-003 requires
 *  a PRESENT non-fragile level, so consider_opposite goes dark; TR-005 only
 *  excludes an ATTESTED fragile level, so devils_advocacy may fire. One field
 *  apart from BOTH_TRIGGERS_FIRE, and that one field decides which protocol
 *  the user can ever be shown. */
const DOMINANT_DECISIVE_UNATTESTED: EnrichmentInput = {
  confidence_tier: 'strong',
  factor_sensitivity: BOTH_TRIGGERS_FIRE.factor_sensitivity,
  option_comparison: BOTH_TRIGGERS_FIRE.option_comparison,
};

describe('selectLens — devils_advocacy reachability (ROADMAP 2.490)', () => {
  it('THE PARTITION — a DECISIVE leader gives the slot to consider_opposite, not devils', () => {
    // ⚠ THIS TEST WAS NAMED "DEFECT — devils_advocacy is dark…" BEFORE 2.490.
    // The behaviour is unchanged and the assertion is byte-identical; what
    // changed is that it is no longer a defect. When BOTH DSK triggers fire,
    // TR-003's own observable (a decisive leader) is present, and the shipped
    // ladder ranks disconfirmation above dissent — the bundle names no priority
    // between them, so the 2.490 sequence rule must NOT silently invert it. The
    // sequence rule is therefore suppressed while consider_opposite is
    // eligible; devils_advocacy is reached on the COMPLEMENTARY shape (dominant
    // driver, no decisive leader) — see `lens-dsk-sequence-2490.test.ts`, which
    // measures both halves on the live captures.
    const walk = walkTurns(BOTH_TRIGGERS_FIRE, 8);
    expect(walk).not.toContain('devils_advocacy');
  });

  it('POSITIVE CONTROL — the same walk DOES see consider_opposite (it must not starve)', () => {
    // Non-vacuity, half 1 (trap 13): an absence assertion is worthless unless
    // the harness demonstrably observes SOMETHING in that slot. ⚠ This control
    // is also the one that REFUTED the first draft of the 2.490 sequence rule:
    // an unconditional `slotOrder.find(devils_advocacy)` turns this red, by
    // starving consider_opposite on exactly this shape. Do not weaken it.
    const walk = walkTurns(BOTH_TRIGGERS_FIRE, 8);
    expect(walk).toContain('consider_opposite');
  });

  it('POSITIVE CONTROL — the harness CAN observe devils_advocacy being selected', () => {
    // Non-vacuity, half 2, and the load-bearing one: the absence above must be
    // a property of the LADDER, not of a harness that could never see this
    // lens at all. Same walk helper, same fixture, ONE field removed — the
    // robustness attestation.
    const walk = walkTurns(DOMINANT_DECISIVE_UNATTESTED, 8);
    expect(walk).toContain('devils_advocacy');
  });

  it('the ONLY difference between those two walks is the robustness attestation', () => {
    // Pins the anti-filter directly. The fixtures differ in exactly one field,
    // and that field decides which DSK protocol is reachable at all:
    //   attested non-fragile => consider_opposite forever, devils never
    //   absent               => devils_advocacy
    // And `robustness.level` is upstream-derived from the leader's win
    // probability against 0.7 — the same 0.7 that is consider_opposite's own
    // decisive floor (PREMORTEM_WINPROB_MAX). See the ladder comment.
    const attested = walkTurns(BOTH_TRIGGERS_FIRE, 8);
    const unattested = walkTurns(DOMINANT_DECISIVE_UNATTESTED, 8);
    expect(attested).not.toContain('devils_advocacy');
    expect(unattested).toContain('devils_advocacy');
    expect(attested).toContain('consider_opposite');
    expect(unattested).not.toContain('consider_opposite');
  });

  it('binds the devils_advocacy selection to the dominating factor BY ID', () => {
    // Identity binding (trap 19): the exact factor id, never "a factor with a
    // high score" — `fac_b` / `fac_c` must not be able to satisfy this.
    const fact = makeFact(DOMINANT_DECISIVE_UNATTESTED);
    let previous: LensId | null = null;
    let devils: ReturnType<typeof selectLens> = null;
    for (let t = 0; t < 8 && devils === null; t++) {
      const selection = selectLens(fact, { previousAnalysisLens: previous });
      previous = selection === null ? null : selection.lens;
      if (selection !== null && selection.lens === 'devils_advocacy') devils = selection;
    }
    expect(devils).not.toBeNull();
    expect(devils!.rationaleCode).toBe('DOMINANT_FACTOR_DISSENT');
    expect(devils!.subjectRef).toEqual({ id: 'fac_dom', kind: 'factor' });
    expect(LENS_DSK_PROVENANCE.devils_advocacy).toEqual({
      protocolId: 'DSK-P-005',
      triggerId: 'DSK-TR-005',
    });
  });

  it('never runs devils_advocacy immediately after consider_opposite (DSK-P-005)', () => {
    // The bundle's contraindication, verbatim: "Do not run immediately after a
    // pre-mortem or disconfirmation exercise on the same decision." Any future
    // fix must surface devils_advocacy WITHOUT producing the sequence its own
    // protocol forbids — so this holds on both cycle shapes.
    for (const shape of [BOTH_TRIGGERS_FIRE, DOMINANT_DECISIVE_UNATTESTED]) {
      const walk = walkTurns(shape, 10);
      for (let i = 1; i < walk.length; i++) {
        if (walk[i] === 'devils_advocacy') expect(walk[i - 1]).not.toBe('consider_opposite');
      }
    }
  });

  it('ROOT — devils_advocacy firing IMPLIES sensitivity_flip_risk fires (subset)', () => {
    // Both call the same dominance derivation, so devils can never be the
    // eligible HEAD: it depends entirely on a displacement. Proven by turn 1
    // (no previous lens ⇒ no displacement) on a shape where devils' own
    // trigger is TRUE — the head is sensitivity, never devils.
    const firstTurn = selectLens(makeFact(BOTH_TRIGGERS_FIRE));
    expect(firstTurn).not.toBeNull();
    expect(firstTurn!.lens).not.toBe('devils_advocacy');
    // ...and devils' trigger really is satisfied on this fixture: it takes the
    // slot as soon as the higher lenses are removed from contention.
    const displaced = selectLens(makeFact(DOMINANT), {
      previousAnalysisLens: 'sensitivity_flip_risk',
    });
    expect(displaced).not.toBeNull();
  });

  it('does NOT hand devils_advocacy a slot its own trigger did not earn', () => {
    // Discriminating negative: same decisive leader, same attested level, but
    // NO dominant driver. TR-005 false ⇒ devils dark, consider_opposite still
    // surfaces. Without this, "devils appears" could be satisfied by a lens
    // that simply always wins.
    const walk = walkTurns(DECISIVE_ATTESTED, 8);
    expect(walk).not.toContain('devils_advocacy');
    expect(walk).toContain('consider_opposite');
  });
});

// ============================================================================
// ROADMAP 2.490 — the robustness LEVEL vocabulary, and why devils_advocacy's
// fragility clause is not the independent test it reads as.
//
// TRAP 12d SHAPE, DELIBERATE: the corpus below is HAND-WRITTEN and cannot be
// derived, because its source is a DIFFERENT REPO. Derivation would only prove
// this file agrees with itself; what is needed here is the thing that notices
// the list is SHORT. Pinned at the bytes so a reviewer can re-read it:
//
//   PLoT `src/integrations/isl/adapters/robustness-analysis.ts` @ 45e23f10
//     mapLevelToLabel(level: 'high' | 'medium' | 'low' | 'very_low')
//       high -> 'robust'   medium -> 'moderate'
//       low  -> 'fragile'  very_low -> 'fragile'
//
// The EXPECTATIONS are taken from that producer mapping, not from this lane's
// reading of what the words ought to mean (trap 13c — an oracle written from
// the consumer's intuition scores perfectly and is still wrong).
// ============================================================================

/** The producer's CLOSED level set, with the producer's OWN fragility verdict. */
const PRODUCER_LEVEL_IS_FRAGILE: ReadonlyArray<readonly [string, boolean]> = [
  ['high', false],
  ['medium', false],
  ['low', true],
  ['very_low', true],
];

describe('RAW_FRAGILE_LEVELS vs the producer level vocabulary (ROADMAP 2.490)', () => {
  it('classifies every level the producer can emit, agreeing with PLoT label mapping', () => {
    for (const [level, producerSaysFragile] of PRODUCER_LEVEL_IS_FRAGILE) {
      expect(
        RAW_FRAGILE_LEVELS.has(level),
        `level '${level}': CEE fragility verdict must match PLoT mapLevelToLabel`,
      ).toBe(producerSaysFragile);
    }
  });

  it('UNION — every producer level PLoT calls fragile is present in RAW_FRAGILE_LEVELS', () => {
    // Fails loud if a fragile level is added upstream and not mirrored here,
    // rather than that level silently reading as non-fragile and firing a lens
    // the bundle's negative condition forbids.
    const producerFragile = PRODUCER_LEVEL_IS_FRAGILE.filter(([, f]) => f).map(([l]) => l);
    expect(producerFragile.length).toBeGreaterThan(0);
    for (const level of producerFragile) expect(RAW_FRAGILE_LEVELS.has(level)).toBe(true);
  });

  it('carries the legacy synonym `fragile` beyond the producer closed set', () => {
    // `fragile` is NOT in ISL V2's closed set; it is a legacy/defensive
    // synonym. Pinned so a "tidy-up" against the V2 enum cannot drop it.
    expect(RAW_FRAGILE_LEVELS.has('fragile')).toBe(true);
    const extras = [...RAW_FRAGILE_LEVELS].filter(
      (l) => !PRODUCER_LEVEL_IS_FRAGILE.some(([p]) => p === l),
    );
    expect(extras).toEqual(['fragile']);
  });

  it('treats an UNRECOGNISED level as non-fragile — stated, not hidden', () => {
    // The accepted cost of not shipping the lens dark (see evaluateConsiderOpposite).
    // Pinned so the behaviour is a decision on the record, not a surprise.
    expect(RAW_FRAGILE_LEVELS.has('unknown')).toBe(false);
    expect(RAW_FRAGILE_LEVELS.has('insufficient_data')).toBe(false);
  });
});
