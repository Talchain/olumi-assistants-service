/**
 * ROADMAP 2.278 — the post-analysis advice gate must not tell the user that
 * small adjustments could change which option leads on a turn whose own flip
 * evidence attests that nothing changes it.
 *
 * Two composers emit flippability-implying robustness copy off the shared
 * `composeRobustnessVerdict`, whose `stability_category` is derived from
 * ROBUSTNESS MARGINALS only:
 *
 *   composeExplainResults  — "The picture appears fragile, so even small
 *                            adjustments to the strongest factor could change
 *                            which option leads."
 *   composeImprovement     — "…could shift it." / "The result is effectively
 *                            tied, so smaller adjustments could change which
 *                            option leads."
 *
 * `explanation-fallback.ts` already gates its OWN version of these clauses on
 * flip evidence (`stability_implies_flippability` + `margin_supports_flip`).
 * The advice gate never received the evidence to do the same — it takes only
 * the narrow `AdviceGateAnalysis` projection. This lane threads it.
 */

import { describe, expect, it } from 'vitest';

import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
  type AdviceGateInput,
} from '../post-analysis-advice-gate.js';

import { assertsFlippability } from '../../__tests__/support/flip-claim-matcher.support.js';
import { ATTESTED_NO_FLIP_SENTENCE } from '../../tools/handlers/explanation-fallback.js';

const FRAGILE_ANALYSIS: AdviceGateAnalysis = {
  status: 'success' as const,
  leading_option: { label: 'A', probability: 0.55 },
  runner_up: { label: 'B', probability: 0.45 },
  margin_pp: 10,
  robustness_band: 'moderate' as const,
  top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
};

const NEAR_TIE_ANALYSIS: AdviceGateAnalysis = {
  status: 'success' as const,
  leading_option: { label: 'A', probability: 0.505 },
  runner_up: { label: 'B', probability: 0.495 },
  margin_pp: 1,
  robustness_band: 'moderate' as const,
  top_drivers: [{ factor_label: 'Risk', sensitivity_value: 0.45 }],
};

function run(
  message: string,
  analysis: AdviceGateAnalysis,
  extra: Partial<AdviceGateInput> = {},
): string {
  const out = tryPostAnalysisAdviceGate({
    message,
    analysis,
    freshness: 'fresh',
    rawRobustness: { level: 'very_low', near_tie_is_tie: false },
    ...extra,
  });
  expect(out.matched).toBe(true);
  return out.matched ? out.assistant_text : '';
}

describe('positive control — the matcher can SEE the shipped claims', () => {
  // Trap 13: prove the presence before asserting any absence.
  it('explain_results emits a flippability claim with no flip evidence', () => {
    expect(assertsFlippability(run('Explain the results.', FRAGILE_ANALYSIS))).toBe(true);
  });

  it('improvement emits a flippability claim with no flip evidence', () => {
    expect(assertsFlippability(run('How can I improve this?', FRAGILE_ANALYSIS))).toBe(true);
  });
});

describe('RED-first — attested-no-flip suppresses the flippability claim', () => {
  const attested = { flipClaimPosture: 'attested_no_flip' as const };

  it('explain_results — fragile band, no flip claim', () => {
    expect(assertsFlippability(run('Explain the results.', FRAGILE_ANALYSIS, attested))).toBe(false);
  });

  it('improvement — fragile band, no flip claim', () => {
    expect(assertsFlippability(run('How can I improve this?', FRAGILE_ANALYSIS, attested))).toBe(false);
  });

  it('improvement — NEAR-TIE, no flip claim', () => {
    expect(assertsFlippability(run('How can I improve this?', NEAR_TIE_ANALYSIS, attested))).toBe(false);
  });

  it('the fragility CAVEAT itself survives — this is a re-aim, not a suppression', () => {
    // Over-correcting into silence would hide a true robustness caveat.
    expect(run('Explain the results.', FRAGILE_ANALYSIS, attested)).toMatch(/fragile/i);
  });
});

describe('POSITIVE CONTROL — permitted posture is byte-identical', () => {
  it.each([
    ['explicitly permitted', { flipClaimPosture: 'permitted' as const }],
    ['undefined (no evidence threaded)', {}],
  ])('explain_results, %s → unchanged', (_label, extra) => {
    const baseline = run('Explain the results.', FRAGILE_ANALYSIS);
    expect(run('Explain the results.', FRAGILE_ANALYSIS, extra)).toBe(baseline);
  });

  it.each([
    ['explicitly permitted', { flipClaimPosture: 'permitted' as const }],
    ['undefined (no evidence threaded)', {}],
  ])('improvement, %s → unchanged', (_label, extra) => {
    const baseline = run('How can I improve this?', FRAGILE_ANALYSIS);
    expect(run('How can I improve this?', FRAGILE_ANALYSIS, extra)).toBe(baseline);
  });
});

describe('A3 — the FOURTH surface: no answer may deny and assert flippability at once', () => {
  /**
   * Adversarial review found this in the file the PR already fixed.
   * `composeExplainResults` had `noFlip` bound and unused in its driver beat,
   * and `composeMeaning` never received the posture at all — so merging the
   * first draft would have shipped, in ONE answer:
   *
   *   "…though nothing we varied changed which option leads."
   *   "The order could shift with movement on “Risk”."
   *
   * A self-contradiction inside a fix for self-contradiction. The negation-aware
   * matcher is what makes this assertable: the honest half contains the claim's
   * own words, so a plain regex could not tell the two apart.
   */
  const attested = { flipClaimPosture: 'attested_no_flip' as const };

  it.each([
    ['explain_results', 'Explain the results.'],
    ['meaning', 'What does this mean?'],
    ['improvement', 'How can I improve this?'],
    ['advice', 'What should I do?'],
  ])('%s — near-tie + attested-no-flip makes NO flippability claim anywhere', (_label, message) => {
    const text = run(message, NEAR_TIE_ANALYSIS, attested);
    expect(assertsFlippability(text)).toBe(false);
  });

  it.each([
    ['explain_results', 'Explain the results.'],
    ['meaning', 'What does this mean?'],
    ['improvement', 'How can I improve this?'],
    ['advice', 'What should I do?'],
  ])('POSITIVE CONTROL — %s DOES claim it without the posture', (_label, message) => {
    expect(assertsFlippability(run(message, NEAR_TIE_ANALYSIS))).toBe(true);
  });

  it('the specific witnessed contradiction cannot recur in one answer', () => {
    const text = run('Explain the results.', NEAR_TIE_ANALYSIS, attested);
    expect(text).not.toMatch(/the order could shift with movement on/i);
    // and the honest denial is what replaced it
    expect(text).toMatch(/no single factor we tested would change the order on its own/i);
  });

  it('composeMeaning and composeAdvice are byte-identical without the posture', () => {
    for (const message of ['What does this mean?', 'What should I do?']) {
      expect(run(message, NEAR_TIE_ANALYSIS, { flipClaimPosture: 'permitted' as const })).toBe(
        run(message, NEAR_TIE_ANALYSIS),
      );
    }
  });
});

// =========================================================================
// ROADMAP 2.278 continued (14 Aug 2026) — THE FIFTH SURFACE:
// `what_would_flip_free_text`.
//
// Everything above sweeps composers that WRONGLY ASSERT flippability. This
// block closes the mirror-image defect on the one class whose question IS the
// flip question: `composeWhatWouldFlip` was the only class `composeForClass`
// did not hand `flipClaimPosture`, so on a POSITIVE producer attestation it
// said nothing about flip behaviour at all.
//
// ⭐ NOT A THEORY — WITNESSED ON THE DEPLOYED BUILD (CEE 41156fc, 14 Aug).
// `p1-conversation-derivation-2026-08-14/raw/run-1/step-Q2_WHAT_WOULD_CHANGE.json`:
// "What would have to change for another option to win?" → 0 LLM calls, zero
// flip content, on a run whose three `flip_thresholds` rows were ALL
// `flip_reason: "structurally_invariant"` / `no_flip_in_range: true`. The SAME
// run's chip-click path and a near-synonym question routed to the LLM both
// stated the attestation. One question, three paths, one silent.
// =========================================================================
describe('2.278 fifth surface — what_would_flip_free_text states the attestation', () => {
  const attested = { flipClaimPosture: 'attested_no_flip' as const };

  // The wording actually asked on the wire, plus the canonical short form.
  const FLIP_QUESTIONS: ReadonlyArray<readonly [string, string]> = [
    ['the witnessed wire phrasing', 'What would have to change for another option to win?'],
    ['the canonical short form', 'What would flip this?'],
  ];

  // ── POSITIVE CONTROL (trap 13): the probe must be able to see the sentence's
  // ABSENCE and its PRESENCE. Without the absence arm, the presence assertion
  // below could pass on copy that always carried it; without the presence arm,
  // a broken probe would report a clean absence forever.
  describe('positive control — the probe discriminates', () => {
    for (const [label, message] of FLIP_QUESTIONS) {
      it(`${label}: with NO posture threaded the attestation is absent`, () => {
        expect(run(message, FRAGILE_ANALYSIS)).not.toContain(ATTESTED_NO_FLIP_SENTENCE);
      });
    }

    it('the shared constant is non-empty (a blank would make every arm vacuous)', () => {
      expect(ATTESTED_NO_FLIP_SENTENCE.length).toBeGreaterThan(40);
    });
  });

  // ── RED-first: this is the behaviour that did not exist.
  describe('RED-first — the attestation is stated', () => {
    for (const [label, message] of FLIP_QUESTIONS) {
      it(`${label}: attested_no_flip → the answer states it`, () => {
        // Bound to the IMPORTED constant, never a retyped string: a hand-typed
        // copy here would be the mirror this change exists to remove, and it
        // would keep passing after the owner's copy was edited (trap 12).
        expect(run(message, FRAGILE_ANALYSIS, attested)).toContain(ATTESTED_NO_FLIP_SENTENCE);
      });
    }

    it('near-tie analysis also states it', () => {
      expect(run('What would flip this?', NEAR_TIE_ANALYSIS, attested)).toContain(
        ATTESTED_NO_FLIP_SENTENCE,
      );
    });

    it('and the answer still does not ASSERT flippability (2.278 A3 property)', () => {
      // The sentence is a DENIAL that contains the claim's own words; the
      // shared matcher must read it as such. If this fails, the copy is
      // outside `NEGATED_CLAIM_FORMS` and the answer now contradicts itself.
      expect(assertsFlippability(run('What would flip this?', FRAGILE_ANALYSIS, attested))).toBe(
        false,
      );
    });
  });

  // ── BACKWARD COMPATIBILITY: absent/ambiguous evidence ⇒ byte-identical.
  // This is `readFlipClaimPosture`'s stated conservatism, held at this surface.
  describe('POSITIVE CONTROL — non-attested postures are byte-identical', () => {
    for (const [label, message] of FLIP_QUESTIONS) {
      it.each([
        ['explicitly permitted', { flipClaimPosture: 'permitted' as const }],
        ['undefined (no evidence threaded)', {}],
      ])(`${label}, %s → unchanged`, (_posture, extra) => {
        expect(run(message, FRAGILE_ANALYSIS, extra)).toBe(run(message, FRAGILE_ANALYSIS));
      });
    }
  });

  // ── TRAP 21 — TWO CHANNELS, DIFFERENT QUESTIONS, FAIL-SAFE PRECEDENCE.
  // `deriveFlipStatus` reads `decision_review.flip_thresholds`; the posture is
  // derived from `enrichment.flip_thresholds[]`. Where they disagree the answer
  // must NOT deny flippability while naming a threshold to inspect — that is
  // precisely the self-contradiction A3 forbids. A named threshold wins.
  describe('trap 21 — a named threshold silences the attestation', () => {
    const REVIEW_WITH_FLIP: Record<string, unknown> = Object.freeze({
      flip_thresholds: Object.freeze([Object.freeze({ factor_label: 'Adoption Rate' })]),
    });

    it('flip_found + attested → threshold named, attestation withheld', () => {
      const text = run('What would flip this?', FRAGILE_ANALYSIS, {
        ...attested,
        decisionReview: REVIEW_WITH_FLIP,
      });
      expect(text).toContain('One threshold signal to inspect is');
      expect(text).not.toContain(ATTESTED_NO_FLIP_SENTENCE);
    });

    it('DISCRIMINATOR: the same posture with NO named threshold DOES state it', () => {
      // Pins the precondition in-test (trap 13b): proves the arm above was
      // silenced by the THRESHOLD and not by a posture that never fired.
      const text = run('What would flip this?', FRAGILE_ANALYSIS, attested);
      expect(text).not.toContain('One threshold signal to inspect is');
      expect(text).toContain(ATTESTED_NO_FLIP_SENTENCE);
    });
  });
});
