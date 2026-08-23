/**
 * The SEEN-BEFORE continuity arm of `hasFabricatedResultReference` — the ONE
 * owner of "does this prose attribute something to an analysis?".
 *
 * ── THE WITNESSED FAILURE (fresh-guest journey, 2026-08-21) ─────────────────
 * On a FIRST-EVER scenario — analyse affordance `disabled: true`, `results.report`
 * NULL, panel reading "No analysis yet." — the product said
 * "the analysis YOU HAVE ALREADY SEEN". There was no prior analysis. The product
 * asserted shared viewing history that did not exist.
 *
 * ── WHY THE OWNER DID NOT CATCH IT (trap 22: predicate BREADTH) ─────────────
 * Every pre-existing arm requires a RESULT to be attributed — a result-VERB
 * ("the analysis shows X"), a prepositional attribution ("according to our
 * analysis"), a first-person run claim, or a result-claiming figure. The
 * witnessed sentence attributes NO result. It attributes DELIVERY: "you have
 * seen this". Same harm — the user believes an analysis exists — different
 * sub-class, and the owner's domain did not reach it.
 *
 * ── THE TWO QUESTIONS, NAMED APART (CLAUDE.md trap #21) ─────────────────────
 *   "Is this turn ENTITLED to reference an analysis result?"
 *       → owned by the CALL SITES, derived from state, UNCHANGED by this PR:
 *         `!analysisResultExists` (coaching post-check) and `!hasAnalysisFact`
 *         (explanation validator). This is the durable predicate.
 *   "Does this prose reference one?"
 *       → owned by `hasFabricatedResultReference`. Widened here.
 * The entitlement gate decides WHETHER to police; the phrase set decides only
 * WHAT to rewrite. That is why the post-analysis half of every case below ships
 * untouched: the guard is never consulted once a result exists.
 */

import { describe, expect, it } from 'vitest';

import { hasFabricatedResultReference } from '../fabricated-result-reference.js';
import { validateExplanationAnswer } from '../validator-explanation.js';
import { checkCoachingOutput } from '../../coaching/coaching-output-postcheck.js';
import type { CoachingStatePack } from '../../context/canonical-analysis-state.js';

// ---------------------------------------------------------------------------
// Pack builders — mirrors coaching-output-postcheck.test.ts
// ---------------------------------------------------------------------------

function pack(overrides: Partial<CoachingStatePack> = {}): CoachingStatePack {
  return {
    analysis_present: true,
    freshness: 'fresh',
    readiness_status: 'ready',
    rerun_required: false,
    usable_for_prose: true,
    usable_for_chips: true,
    blocked: false,
    actionable_blocker_count: 0,
    ...overrides,
  };
}

/** A first-ever scenario: no analysis has ever run. The witnessed state. */
const NO_ANALYSIS = pack({
  analysis_present: false,
  freshness: 'none',
  readiness_status: null,
  usable_for_prose: false,
  usable_for_chips: false,
});
/** A completed, current analysis — a re-run turn, or a second turn after one. */
const ANALYSIS_FRESH = pack();
/** A restored scenario whose stored analysis predates a model edit. */
const ANALYSIS_STALE = pack({
  freshness: 'stale',
  rerun_required: true,
  usable_for_chips: false,
});

/** The exact witnessed sentence, in a turn-shaped sentence. */
const WITNESSED = 'This builds on the analysis you have already seen.';

// ===========================================================================
// 1. THE OWNER'S DOMAIN — the SEEN-BEFORE continuity arm
// ===========================================================================

describe('hasFabricatedResultReference — SEEN-BEFORE continuity arm', () => {
  it('fires on the WITNESSED sentence "the analysis you have already seen"', () => {
    expect(hasFabricatedResultReference(WITNESSED)).toBe(true);
  });

  it('fires on the witnessed sub-class: post-modified "<result-noun> you (have) seen/saw"', () => {
    for (const text of [
      'This builds on the analysis you have already seen.',
      'That lines up with the results you saw.',
      'The simulation you viewed put churn at the front.',
      'It matches the analysis you already saw.',
    ]) {
      expect(hasFabricatedResultReference(text), text).toBe(true);
    }
  });

  it('fires on the pre-modified twin: "you have already seen the analysis"', () => {
    for (const text of [
      'You have already seen the analysis, so I will keep this short.',
      "You've already seen the headline results for both options.",
      'You saw the analysis for the enterprise option last time.',
    ]) {
      expect(hasFabricatedResultReference(text), text).toBe(true);
    }
  });

  it('fires on the product-delivery twin: "(I|we) showed you the analysis"', () => {
    for (const text of [
      'I showed you the analysis and churn dominated it.',
      'We shared the results with you before this.',
      'The analysis I showed you put enterprise in front.',
    ]) {
      expect(hasFabricatedResultReference(text), text).toBe(true);
    }
  });

  it('fires on "as you saw in the analysis"', () => {
    expect(
      hasFabricatedResultReference('As you saw in the analysis, churn is the swing factor.'),
    ).toBe(true);
  });
});

// ===========================================================================
// 2. OPPOSITE DIRECTION — the legitimate prose that must STILL SHIP
//    (CLAUDE.md trap 22b: a fix that closes a gap and opens the inverse.)
// ===========================================================================

describe('SEEN-BEFORE continuity arm — legitimate prose still ships', () => {
  it('a HYPOTHETICAL / conditional continuity reference ships (conditional screen)', () => {
    for (const text of [
      'Once you have seen the analysis, we can compare the two options properly.',
      'When you saw the analysis last time, did churn stand out?',
      'If you have already seen the results, tell me what surprised you.',
    ]) {
      expect(hasFabricatedResultReference(text), text).toBe(false);
    }
  });

  it('a QUESTION about prior viewing ships (question screen)', () => {
    expect(
      hasFabricatedResultReference('Have you already seen an analysis of this decision?'),
    ).toBe(false);
  });

  it('a FUTURE / prospective reference ships (no past-tense viewing claim)', () => {
    for (const text of [
      "You'll see the analysis as soon as it finishes running.",
      'You will see the results in a moment.',
      'Want me to run it so you can see the analysis?',
    ]) {
      expect(hasFabricatedResultReference(text), text).toBe(false);
    }
  });

  it("the USER'S OWN external analysis ships (user-own screen, unchanged)", () => {
    for (const text of [
      'Your own analysis you have already seen may use different churn assumptions.',
      'Based on the analysis you shared, churn is the swing factor.',
    ]) {
      expect(hasFabricatedResultReference(text), text).toBe(false);
    }
  });

  it('ordinary pre-analysis coaching that merely says "seen" ships', () => {
    for (const text of [
      'I have seen decisions like this hinge on churn more often than on price.',
      'You have already told me churn worries you most.',
      'You have already seen enough of this market to have a view on churn.',
    ]) {
      expect(hasFabricatedResultReference(text), text).toBe(false);
    }
  });
});

// ===========================================================================
// 3. IDENTITY BINDING — the pre-existing arms are untouched
//    (Contrast control: these must stay TRUE, proving the module still works;
//     they are a DIFFERENT arm, so a mutant on the continuity arm must not
//     move them.)
// ===========================================================================

describe('SEEN-BEFORE continuity arm — pre-existing arms unchanged', () => {
  it('CONTRAST: result-attribution arms still fire', () => {
    expect(hasFabricatedResultReference('The analysis shows Enterprise is stronger.')).toBe(
      true,
    );
    expect(hasFabricatedResultReference('I ran the analysis and SMB came out on top.')).toBe(
      true,
    );
    expect(hasFabricatedResultReference('Enterprise wins with 68%')).toBe(true);
  });

  it('CONTRAST: the #450 pre-analysis coaching exemptions still ship', () => {
    expect(
      hasFabricatedResultReference(
        'Working with that 30% chance of churn, enterprise is worth exploring',
      ),
    ).toBe(false);
    expect(
      hasFabricatedResultReference(
        'The analysis will show how the options compare once it runs.',
      ),
    ).toBe(false);
  });
});

// ===========================================================================
// 4. ENTITLEMENT DECIDES — coaching post-check, both directions
// ===========================================================================

describe('coaching post-check — phantom prior analysis', () => {
  it('DEGRADES the witnessed continuity claim on a FIRST-EVER scenario', () => {
    expect(checkCoachingOutput(WITNESSED, NO_ANALYSIS)).toEqual({
      safe: false,
      violation: 'fabricated_result_reference',
    });
  });

  it('GENUINE CONTINUITY IS STILL STATED once a completed analysis exists', () => {
    // A re-run turn, and a second turn after a completed analysis: the
    // entitlement gate is open, so the guard is never consulted and the
    // product can still say "the analysis you have already seen".
    expect(checkCoachingOutput(WITNESSED, ANALYSIS_FRESH)).toEqual({ safe: true });
    expect(
      checkCoachingOutput('You have already seen the analysis for this model.', ANALYSIS_FRESH),
    ).toEqual({ safe: true });
    expect(
      checkCoachingOutput('I showed you the results on the last run.', ANALYSIS_FRESH),
    ).toEqual({ safe: true });
  });

  it('a RESTORED scenario with a stale stored analysis may still reference it', () => {
    expect(checkCoachingOutput(WITNESSED, ANALYSIS_STALE)).toEqual({ safe: true });
  });
});

// ===========================================================================
// 5. ENTITLEMENT DECIDES — explanation validator, both directions
// ===========================================================================

const CONTINUITY_ANSWER =
  'This builds on the analysis you have already seen, and the structure of the model ' +
  'explains why churn sits upstream of every option in the current draft.';

describe('validateExplanationAnswer — phantom prior analysis', () => {
  it('marks the continuity answer INVALID with no run_analysis fact', () => {
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      { answer_text: CONTINUITY_ANSWER, evidence_used: [], cited_fields: [] },
      [],
    );
    expect(verdict).toMatchObject({
      skip: false,
      payload: {
        answer_text_valid: false,
        answer_validation_error: 'fabricated_result_reference',
      },
    });
  });

  it('keeps the SAME answer VALID once a non-noop run_analysis fact exists', () => {
    const verdict = validateExplanationAnswer(
      'explain_from_structure',
      { answer_text: CONTINUITY_ANSWER, evidence_used: [], cited_fields: [] },
      [{ fact_type: 'run_analysis', noop: false }],
    );
    expect(verdict).toMatchObject({
      skip: false,
      payload: { answer_text_valid: true },
    });
  });
});
