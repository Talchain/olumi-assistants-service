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
