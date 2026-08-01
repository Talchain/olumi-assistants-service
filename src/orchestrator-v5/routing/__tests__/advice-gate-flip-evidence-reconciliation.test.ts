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

/** Asserts the result COULD change — the claim contradicted by the evidence. */
const FLIPPABILITY_CLAIM_REGEX =
  /\b(?:could|can|would|might|may)\s+(?:\w+\s+){0,3}?(?:change\s+which\s+option\s+leads|shift\s+it|flip)/i;

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
    expect(run('Explain the results.', FRAGILE_ANALYSIS)).toMatch(FLIPPABILITY_CLAIM_REGEX);
  });

  it('improvement emits a flippability claim with no flip evidence', () => {
    expect(run('How can I improve this?', FRAGILE_ANALYSIS)).toMatch(FLIPPABILITY_CLAIM_REGEX);
  });
});

describe('RED-first — attested-no-flip suppresses the flippability claim', () => {
  const attested = { flipClaimPosture: 'attested_no_flip' as const };

  it('explain_results — fragile band, no flip claim', () => {
    expect(run('Explain the results.', FRAGILE_ANALYSIS, attested)).not.toMatch(
      FLIPPABILITY_CLAIM_REGEX,
    );
  });

  it('improvement — fragile band, no flip claim', () => {
    expect(run('How can I improve this?', FRAGILE_ANALYSIS, attested)).not.toMatch(
      FLIPPABILITY_CLAIM_REGEX,
    );
  });

  it('improvement — NEAR-TIE, no flip claim', () => {
    expect(run('How can I improve this?', NEAR_TIE_ANALYSIS, attested)).not.toMatch(
      FLIPPABILITY_CLAIM_REGEX,
    );
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
