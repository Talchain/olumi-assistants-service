/**
 * THE SENSITIVITY ANSWER MUST SURVIVE THE WITHHOLD.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, MEASURED ON TWO REAL SESSIONS — NOT HYPOTHESISED.
 *
 * `~/Downloads/olumi-debug-73d5c152-20260919.json` and
 * `olumi-debug-6edb1cdb-20260917.json`. In both, the user asks *"What could
 * change the outcome of this analysis?"*, the turn is `turn_kind:
 * what_would_flip` with `outcome: answered`, and the ENTIRE served reply is a
 * constraint notice about an unrelated limit. Not one word about sensitivity.
 *
 * Both captures carry, at
 * `payloads.cee_response.__additive__._diagnostic_trace.claim_safety`:
 *
 *     may_name_leading_option    = false
 *     withheld_projection_reason = "leader_claim_replaced"
 *
 * The CONTRAST session `olumi-debug-f51850fc-20260916.json` asks the identical
 * question and answers it properly ("This result is still fragile… • Strategic
 * focus capacity is the swing factor…"). It carries `may_name_leading_option =
 * true` and NO `withheld_projection_reason` key at all.
 *
 * ⇒ The capability exists and the data is there. The answer was collateral
 * damage from a correct suppression: the handler's answer named a leader, so
 * `projectExplanationAnswerForWithheldClaim` replaced it WHOLESALE, and the
 * sensitivity content went with it because the two rode one string.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHAT THIS FILE PINS, and what it deliberately does NOT.
 *
 *   - The suppression is UNCHANGED. Several cases below exist only to prove a
 *     leader claim still never survives — this change must not buy the answer
 *     back at the price of the guarantee.
 *   - The body is bound to its object BY IDENTITY (the factor labels the
 *     evidence carries), never by "the text got longer" — a length or
 *     `!== before` assertion would pass on any substitution whatsoever
 *     (CLAUDE.md trap 19).
 *   - Absent data yields SILENCE. Asserted as an exact-equality against
 *     today's copy, so a future hedge sentence ("we could not determine…")
 *     turns this red rather than reading as an improvement.
 */
import { describe, it, expect } from 'vitest';

import {
  projectExplanationAnswerForWithheldClaim,
  WITHHELD_EXPLANATION_OPENING,
  type WithheldSensitivityEvidence,
} from '../withheld-explanation-answer.js';
import { textAssertsLeadingOption } from '../leading-option-egress-guard.js';
import {
  composeWithheldSensitivityBody,
  ATTESTED_NO_FLIP_SENTENCE,
  ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE,
} from '../../tools/handlers/explanation-fallback.js';
import type { AnalysisProjectionSummary } from '../../context/projection-summaries.js';
import type { FlipSummary } from '../flip-proposal.js';
import type { RatifiedConstraint } from '../../../orchestrator/context/constraint-feasibility.js';

const CONSTRAINTS: readonly RatifiedConstraint[] = [
  { constraint_id: 'c1', label: 'Keep monthly churn at or below 4%' },
];
const BRIEF = 'grow ARR while keeping monthly churn under 4%';

/**
 * A leader-naming `what_would_flip` answer of the shape the live handler
 * produces — the sensitivity content and the leader claim in ONE string, which
 * is exactly why replacement costs the user the answer.
 */
const LEADER_ANSWER =
  '"Raise Pro Plan Price to £59" currently leads, with a probability of 61%. ' +
  'Movement on Cash Runway would shift this result the most.';

/** A clean, leader-free answer — the APPEND-branch population. */
const CLEAN_ANSWER = 'Two factors are worth pressure-testing before you commit.';

function projection(
  drivers: ReadonlyArray<{ factor_label: string; sensitivity_value: number }>,
): AnalysisProjectionSummary {
  return {
    status: 'ok',
    leading_option: { label: 'Raise Pro Plan Price to £59', probability: 0.61 },
    runner_up: { label: 'Bundle New Pro Feature at £49', probability: 0.39 },
    margin_pp: 22,
    robustness_band: 'fragile',
    top_drivers: drivers,
  } as AnalysisProjectionSummary;
}

function flipSummary(
  overall_status: FlipSummary['overall_status'],
  entries: ReadonlyArray<{ factor_id: string; factor_label: string; flip_value: number | null }>,
): FlipSummary {
  return {
    overall_status,
    // The alternative winner PLoT computed rides every row. It is supplied
    // here precisely because the permitted voice names it ("If that happened,
    // X would lead instead.") and this voice must not — a fixture without it
    // could not observe that sentence coming back.
    entries: entries.map((e) => ({
      ...e,
      alternative_winner_id: 'opt_bundle_pro_feature',
      alternative_winner_label: 'Bundle New Pro Feature at £49 (No Price Rise)',
    })),
    margin_supports_flip: true,
  } as FlipSummary;
}

function project(answer: string, sensitivity?: WithheldSensitivityEvidence | null) {
  return projectExplanationAnswerForWithheldClaim(
    answer,
    'unevaluated',
    CONSTRAINTS,
    true,
    true,
    BRIEF,
    sensitivity,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THE TWO REAL CAPTURED STATES, reconstructed from the banked evidence.
// Field names and values below are taken from the captures; the paths are
// named in each comment so a reviewer can re-read them at source.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠ THESE TWO FIXTURES WERE CORRECTED BY MEASUREMENT, AND THE CORRECTION IS
 * WORTH MORE THAN THE FIXTURES.
 *
 * They were first written by READING the captures and inferring what the
 * selectors would make of them. Both inferences were wrong, and both were
 * caught by running the REAL selectors —
 * `summariseFlipEntries(readFlipEntries(enrichment))` — over the captures'
 * actual enrichment bytes:
 *
 *   - 73d5c152 was assumed `insufficient_data`, because its rows carry
 *     `flip_reason: 'structurally_invariant'` and the `FlipOverallStatus`
 *     union's own comment (flip-proposal.ts:429) says `no_practical_flip` means
 *     *"ALL null with reason 'no_effect_within_bounds'"*. **That comment is
 *     stale.** The predicate is `isAttestedNoFlipReason`, an OPEN vocabulary
 *     that includes `structurally_invariant` — widened deliberately by ROADMAP
 *     2.228 F1 so one such row could not demote an attested certainty into
 *     uncertainty. MEASURED: `no_practical_flip`.
 *   - 6edb1cdb was assumed to carry a `Pro Plan Price` driver, read across from
 *     `factor_sensitivity`. MEASURED: `decision_brief.top_drivers` is `[]`.
 *
 * Both runs therefore resolve to `no_practical_flip`. The `insufficient_data`
 * branch is still covered below, but as a clearly-labelled SYNTHETIC case — it
 * is not what either real session produced, and saying otherwise in a fixture
 * comment is the kind of false premise that outlives the test.
 */

/**
 * `olumi-debug-6edb1cdb-20260917.json`, MEASURED.
 *   enrichment.decision_brief.top_drivers              = []            ← no driver rung
 *   enrichment.flip_thresholds[].factor_label          = 'Monthly Churn Rate', 'Pro Plan Price'
 *   enrichment.flip_thresholds[].flip_value            = null, null
 *   enrichment.flip_thresholds[].flip_reason           = 'no_effect_within_bounds',
 *                                                        'structurally_invariant'
 *   summariseFlipEntries(readFlipEntries(...)).overall_status = 'no_practical_flip'
 */
const CAPTURE_6EDB1CDB: WithheldSensitivityEvidence = {
  projection: projection([]),
  flipSummary: flipSummary('no_practical_flip', [
    { factor_id: 'ab78e513', factor_label: 'Monthly Churn Rate', flip_value: null },
    { factor_id: 'ed5b5711', factor_label: 'Pro Plan Price', flip_value: null },
  ]),
};

/**
 * `olumi-debug-73d5c152-20260919.json`, MEASURED.
 *   enrichment.decision_brief.top_drivers[0].factor_label = 'Cash Runway'
 *   enrichment.decision_brief.top_drivers[0].sensitivity  = 0.3214285714285715 ← material
 *   enrichment.flip_thresholds[] = 4 rows, every flip_value null, every
 *                                  flip_reason 'structurally_invariant'
 *   summariseFlipEntries(readFlipEntries(...)).overall_status = 'no_practical_flip'
 */
const CAPTURE_73D5C152: WithheldSensitivityEvidence = {
  projection: projection([
    { factor_label: 'Cash Runway', sensitivity_value: 0.3214285714285715 },
  ]),
  flipSummary: flipSummary('no_practical_flip', [
    { factor_id: '1105d9e3', factor_label: 'Sales Cycle Duration', flip_value: null },
    { factor_id: '2e6a7049', factor_label: 'Cash Runway', flip_value: null },
    { factor_id: 'e3c11a02', factor_label: 'Engineering Capacity Allocated', flip_value: null },
    { factor_id: 'a71f0d55', factor_label: 'Integration Depth', flip_value: null },
  ]),
};

/**
 * SYNTHETIC — not either captured session. Keeps the `insufficient_data` branch
 * covered now that both real runs are known to resolve `no_practical_flip`.
 */
const SYNTHETIC_INSUFFICIENT: WithheldSensitivityEvidence = {
  projection: projection([{ factor_label: 'Cash Runway', sensitivity_value: 0.4 }]),
  flipSummary: flipSummary('insufficient_data', [
    { factor_id: 'f1', factor_label: 'Sales Cycle Duration', flip_value: null },
  ]),
};

describe('the two real captured states now answer the question that was asked', () => {
  it('6edb1cdb: the user gets the run\'s flip verdict AND the disclosure', () => {
    const out = project(LEADER_ANSWER, CAPTURE_6EDB1CDB);

    expect(out.reason).toBe('leader_claim_replaced');
    // THE ANSWER. Bound to the derived constant, never a literal copy of it.
    expect(out.text).toContain(ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE);
    // This run's `decision_brief.top_drivers` is EMPTY (measured), so the
    // driver rung stands down and the flip rung carries the answer alone —
    // the per-rung independence this composer is built on.
    expect(out.text).not.toContain('Movement on');
    // THE DISCLOSURE, still there and still naming the condition.
    expect(out.text).toContain('Keep monthly churn at or below 4%');
    // …and in that order: answer first, then the limit that could not be checked.
    expect(out.text.indexOf(ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE)).toBeLessThan(
      out.text.indexOf('Keep monthly churn at or below 4%'),
    );
  });

  it('73d5c152: the user gets the material driver BY NAME and the flip verdict', () => {
    const out = project(LEADER_ANSWER, CAPTURE_73D5C152);

    expect(out.reason).toBe('leader_claim_replaced');
    // IDENTITY, not a value predicate: this factor, named.
    expect(out.text).toContain('Cash Runway');
    expect(out.text).toContain(ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE);
    expect(out.text).toContain('Keep monthly churn at or below 4%');
  });

  it('SYNTHETIC: the insufficient_data branch speaks its own, weaker sentence', () => {
    // Neither real session produces this status (both measure
    // `no_practical_flip`), so it is pinned separately rather than smuggled
    // into a fixture that claims to be a capture.
    const out = project(LEADER_ANSWER, SYNTHETIC_INSUFFICIENT);

    expect(out.text).toContain('The analysis did not isolate a single-factor tipping point here.');
    // …and it must NOT claim the stronger, producer-attested certainty.
    expect(out.text).not.toContain(ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE);
    expect(textAssertsLeadingOption(out.text)).toBe(false);
  });

  it('neither served answer names or ranks an option', () => {
    for (const evidence of [CAPTURE_6EDB1CDB, CAPTURE_73D5C152]) {
      const out = project(LEADER_ANSWER, evidence);
      // The gate's own predicate, applied to the gate's own output.
      expect(textAssertsLeadingOption(out.text)).toBe(false);
      // The option labels the run holds must not appear anywhere.
      expect(out.text).not.toContain('Raise Pro Plan Price');
      expect(out.text).not.toContain('Bundle New Pro Feature');
    }
  });

  it("POSITIVE CONTROL: the replaced answer really did assert a leader, and the disclosure-only reply really is what ships today", () => {
    // Without this arm the three cases above could pass against an input that
    // never tripped the gate, or against a baseline that already carried the
    // body — either would make them vacuous (trap 13).
    expect(textAssertsLeadingOption(LEADER_ANSWER)).toBe(true);
    const today = project(LEADER_ANSWER);
    expect(today.reason).toBe('leader_claim_replaced');
    expect(today.text).not.toContain('Cash Runway');
    expect(today.text).not.toContain('tipping point');
    expect(today.text.startsWith(WITHHELD_EXPLANATION_OPENING)).toBe(true);
  });
});

describe('the withhold guarantee is unchanged', () => {
  it('a leader-naming answer never survives verbatim, with or without evidence', () => {
    for (const evidence of [undefined, null, CAPTURE_73D5C152, CAPTURE_6EDB1CDB]) {
      const out = project(LEADER_ANSWER, evidence);
      expect(out.changed).toBe(true);
      expect(out.reason).toBe('leader_claim_replaced');
      expect(out.text).not.toContain('currently leads');
      expect(textAssertsLeadingOption(out.text)).toBe(false);
    }
  });

  it('a CLEAN answer is still only appended to — the body never joins that branch', () => {
    const out = project(CLEAN_ANSWER, CAPTURE_73D5C152);

    expect(out.reason).toBe('disclosure_appended');
    // The original survives byte-for-byte at the front…
    expect(out.text.startsWith(CLEAN_ANSWER)).toBe(true);
    // …and the sensitivity body is NOT bolted on: the handler's own answer
    // already addressed the question, so adding ours would be a second account
    // of one thing. Bound by identity to the body's own content.
    expect(out.text).not.toContain('Cash Runway');
    expect(out.text).not.toContain('tipping point');
  });

  it('the alternative-winner sentence the permitted voice emits is never reproduced', () => {
    // `concrete` is the only status whose permitted-voice branch names the
    // option that would lead. This is the case that would catch it coming back.
    const concrete: WithheldSensitivityEvidence = {
      projection: projection([{ factor_label: 'Cash Runway', sensitivity_value: 0.4 }]),
      flipSummary: flipSummary('concrete', [
        { factor_id: 'f1', factor_label: 'Monthly Churn Rate', flip_value: 0.041 },
      ]),
    };
    const out = project(LEADER_ANSWER, concrete);

    expect(out.text).toContain('Monthly Churn Rate');
    expect(out.text).not.toContain('would lead instead');
    expect(out.text).not.toContain('Bundle New Pro Feature');
    expect(textAssertsLeadingOption(out.text)).toBe(false);
  });

  /**
   * ⭐⭐⭐ A FINITE THRESHOLD IS NOT A LIKELIHOOD, AND PRODUCER ORDER IS NOT A
   * RANKING.
   *
   * The first cut of the concrete branch called the first two entries "the most
   * likely single factors to reach a tipping point, so they are the clearest
   * ones to test". `FlipEntry` carries no likelihood, no probability of
   * reaching a threshold and no investigation priority; `readFlipEntries`
   * preserves PRODUCER ORDER and `summariseFlipEntries` establishes only that
   * at least one finite threshold exists. The claim was manufactured by
   * `.slice(0, 2)`.
   *
   * The reordered twin is the discriminator: the SAME measured entries in a
   * different producer order must not change what the product CLAIMS about
   * them. Which factors are named may still follow order — that is a subset,
   * and the copy now says so — but no factor may be called most likely or best
   * to test on the strength of where the producer happened to put it.
   */
  const THREE = [
    { factor_id: 'f1', factor_label: 'Monthly Churn Rate', flip_value: 0.041 },
    { factor_id: 'f2', factor_label: 'Engineering Capacity', flip_value: 12 },
    { factor_id: 'f3', factor_label: 'Cash Runway', flip_value: 7 },
  ];
  const REORDERED = [THREE[2]!, THREE[0]!, THREE[1]!];

  const PRIORITY_CLAIM = /most likely|clearest|best to test|worth testing first|top factor/i;

  it.each([
    ['producer order [A,B,C]', THREE],
    ['⭐ THE REORDERED TWIN [C,A,B]', REORDERED],
  ])('%s: names factors without claiming a likelihood or an investigation priority', (_name, entries) => {
    const out = project(LEADER_ANSWER, {
      projection: projection([{ factor_label: 'Cash Runway', sensitivity_value: 0.4 }]),
      flipSummary: flipSummary('concrete', entries),
    } as WithheldSensitivityEvidence);

    // The supported claim, and only it.
    expect(out.text).toContain('The analysis found single-factor tipping points');
    expect(out.text).not.toMatch(PRIORITY_CLAIM);
    // Three exist and two are named, so the copy must disclose the subset
    // rather than let two stand in for the set.
    expect(out.text).toContain('several factors, including');
    // The withheld voice's standing bans are untouched by this delta.
    expect(out.text).not.toContain('would lead instead');
    expect(textAssertsLeadingOption(out.text)).toBe(false);
  });

  it('a single finite threshold states the found tipping point, with no superlative', () => {
    const out = project(LEADER_ANSWER, {
      projection: projection([{ factor_label: 'Cash Runway', sensitivity_value: 0.4 }]),
      flipSummary: flipSummary('concrete', [THREE[0]!]),
    } as WithheldSensitivityEvidence);
    expect(out.text).toContain('The analysis found a single-factor tipping point for Monthly Churn Rate.');
    expect(out.text).not.toMatch(PRIORITY_CLAIM);
    expect(out.text).not.toContain('several factors');
  });

  it('exactly two, with none omitted, does not say "including"', () => {
    const out = project(LEADER_ANSWER, {
      projection: projection([{ factor_label: 'Cash Runway', sensitivity_value: 0.4 }]),
      flipSummary: flipSummary('concrete', [THREE[0]!, THREE[1]!]),
    } as WithheldSensitivityEvidence);
    expect(out.text).toContain('tipping points for Monthly Churn Rate and Engineering Capacity.');
    expect(out.text).not.toContain('including');
    expect(out.text).not.toMatch(PRIORITY_CLAIM);
  });
});

describe('the body may not presuppose a result the read could not establish', () => {
  it('stands down entirely when analysisExistenceProven is false', () => {
    // The body says "would shift THIS RESULT the most" — a deixis, so a claim
    // that a result exists. This module removed the same presupposition from
    // its cause-free tail on 2026-07-31 ("…on this result yet") for exactly
    // this population, and the body must not reintroduce it.
    const withExistence = projectExplanationAnswerForWithheldClaim(
      LEADER_ANSWER, 'unevaluated', CONSTRAINTS, true, /* exists */ true, BRIEF, CAPTURE_73D5C152,
    );
    const withoutExistence = projectExplanationAnswerForWithheldClaim(
      LEADER_ANSWER, 'unevaluated', CONSTRAINTS, true, /* exists */ false, BRIEF, CAPTURE_73D5C152,
    );

    // POSITIVE CONTROL — the SAME evidence does produce a body when existence
    // is proven, so the silence below is the gate's doing, not an inert fixture.
    expect(withExistence.text).toContain('Cash Runway');

    expect(withoutExistence.text).not.toContain('Cash Runway');
    expect(withoutExistence.text).not.toContain('this result');
    // …and it degrades to exactly what ships today on that population.
    expect(withoutExistence.text).toBe(
      projectExplanationAnswerForWithheldClaim(
        LEADER_ANSWER, 'unevaluated', CONSTRAINTS, true, false, BRIEF,
      ).text,
    );
  });
});

describe('absent data yields silence, never a hedge', () => {
  const NOTHING: ReadonlyArray<readonly [string, WithheldSensitivityEvidence]> = [
    ['no projection and no flip summary', { projection: null, flipSummary: null }],
    ['empty drivers, no flip summary', { projection: projection([]), flipSummary: null }],
    [
      'flip status none',
      { projection: projection([]), flipSummary: flipSummary('none', []) },
    ],
    [
      'a near-zero driver only — below the materiality threshold',
      {
        projection: projection([{ factor_label: 'Cash Runway', sensitivity_value: 0.001 }]),
        flipSummary: null,
      },
    ],
    [
      'concrete status but no entry carries a finite threshold',
      {
        projection: projection([]),
        flipSummary: flipSummary('concrete', [
          { factor_id: 'f1', factor_label: 'Monthly Churn Rate', flip_value: null },
        ]),
      },
    ],
  ];

  it.each(NOTHING)('composes nothing for %s', (_label, evidence) => {
    expect(composeWithheldSensitivityBody(evidence.projection, evidence.flipSummary)).toBeNull();
  });

  it.each(NOTHING)('ships today\'s copy EXACTLY for %s — no hedge sentence', (_label, evidence) => {
    // Exact equality against the no-evidence baseline. A future "we could not
    // determine what would change this" sentence fails here, which is the
    // point: a disclosure asserting something the code has not established is
    // worse than silence.
    expect(project(LEADER_ANSWER, evidence).text).toBe(project(LEADER_ANSWER).text);
  });

  it('POSITIVE CONTROL: the same harness DOES produce a body when data is present', () => {
    // Proves the five cases above are silent because the DATA is absent, not
    // because the composer is inert or the harness is mis-wired.
    expect(
      composeWithheldSensitivityBody(
        CAPTURE_73D5C152.projection,
        CAPTURE_73D5C152.flipSummary,
      ),
    ).not.toBeNull();
    expect(project(LEADER_ANSWER, CAPTURE_73D5C152).text).not.toBe(
      project(LEADER_ANSWER).text,
    );
  });
});

describe('the leader-free no-flip sentence is DERIVED from the shared constant', () => {
  it('is the shared sentence minus its leader clause, and the shared one still trips the gate', () => {
    // If someone rewords the shared constant, the module throws at load. This
    // pins the RELATIONSHIP so the two voices cannot drift into two sentences.
    expect(ATTESTED_NO_FLIP_SENTENCE).toContain(ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE.slice(0, -1));
    // POSITIVE CONTROL — the clause really is what makes the original unusable.
    expect(textAssertsLeadingOption(ATTESTED_NO_FLIP_SENTENCE)).toBe(true);
    expect(textAssertsLeadingOption(ATTESTED_NO_FLIP_SENTENCE_LEADER_FREE)).toBe(false);
  });
});
