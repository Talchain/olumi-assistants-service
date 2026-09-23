/**
 * NARRATED FIGURES KEEP THEIR MEANING — the shape check's number grounding must
 * bind a "holds" / "flips" percentage to the ONE field that carries that meaning.
 *
 * ## The defect (Paul's manual test, 23 Sep 2026, scenario `58af9704`)
 *
 * The run carried NO `robustness.recommendation_stability` (PLoT stopped sending
 * it on 7 Jul) and `fragile_edges[0].switch_probability = 0.6968`. The review
 * told the user the ordering "holds in about 70%" — the FLIP probability, with
 * the opposite meaning. `isGrounded` accepted it because 70% is within ±10% of
 * 0.6968: the rule asked whether the number was NEAR an input, never what it
 * MEANT.
 *
 * ## RED-first at staging `c3e3f187` — MEASURED
 *
 * This file imports only `shape-check.ts`, so it runs unchanged at the base.
 * The two cases marked RED-FIRST fail there with
 * `expected [] to include 'UNGROUNDED_NUMBER…'` — the flip probability grounds
 * the holds claim. The contrast cases pass at base and after: they pin that the
 * fix does not refuse a figure its own field DOES ground.
 */

import { describe, expect, it } from 'vitest';

import { performShapeCheck, type ReviewInputForGrounding } from '../shape-check.js';

/** Production-shaped: the fields of Paul's run that matter, and no stability. */
function paulsRunInput(robustness: Record<string, unknown> = {}): ReviewInputForGrounding {
  return {
    winner: { label: 'Reduce scope', win_probability: 0.52, outcome_mean: 0.41 },
    runner_up: { label: 'Hire a contractor', win_probability: 0.33, outcome_mean: 0.36 },
    margin: 0.19,
    isl_results: {
      option_comparison: [
        { option_label: 'Reduce scope', win_probability: 0.52, outcome: { mean: 0.41, p10: 0.22, p90: 0.6 } },
        { option_label: 'Hire a contractor', win_probability: 0.33, outcome: { mean: 0.36, p10: 0.18, p90: 0.55 } },
        { option_label: 'Status quo', win_probability: 0.15, outcome: { mean: 0.29, p10: 0.12, p90: 0.47 } },
      ],
      factor_sensitivity: [],
      fragile_edges: [
        { from_label: 'Scope', to_label: 'Delivery date', switch_probability: 0.6968 },
      ],
      robustness,
    },
    flip_threshold_data: [],
  };
}

function review(summary: string, narrative = 'Reduce scope scored highest against your goal in 52% of runs.'): Record<string, unknown> {
  return {
    narrative_summary: narrative,
    story_headlines: { opt_scope: 'Protects the delivery date' },
    robustness_explanation: { summary, primary_risk: 'The link from Scope to Delivery date.' },
    readiness_rationale: 'Evidence on scope is thin.',
    evidence_enhancements: {},
    bias_findings: [],
    key_assumptions: [],
    decision_quality_prompts: [],
  };
}

const HOLDS_70 = 'The ordering holds in about 70% of variations.';

const ungrounded = (warnings: readonly string[]) =>
  warnings.filter((w) => w.startsWith('UNGROUNDED_NUMBER'));

describe('shape-check — narrated figures keep their meaning', () => {
  it('RED-FIRST: stability ABSENT — "holds in about 70%" grounded only by switch_probability 0.6968 is UNGROUNDED', () => {
    // Precondition (trap 13b): the only input near 70% is the FLIP probability.
    const input = paulsRunInput();
    expect(input.isl_results?.robustness?.recommendation_stability).toBeUndefined();
    expect(input.isl_results?.fragile_edges?.[0]?.switch_probability).toBe(0.6968);

    const result = performShapeCheck(review(HOLDS_70), input);

    expect(result.valid).toBe(true);
    const bad = ungrounded(result.warnings);
    expect(bad).toHaveLength(1);
    // The retry prompt extracts the quoted token, so the prefix + quote shape is load-bearing.
    expect(bad[0]).toMatch(/^UNGROUNDED_NUMBER: "70%" in robustness_explanation /);
    expect(bad[0]).toContain('recommendation_stability');
  });

  it('NO DERIVED EQUIVALENCE: a holds figure equal to 1 − switch_probability is still refused', () => {
    // Not RED-first evidence (the base rule never derived a complement either).
    // It pins the forbidden "fix": treating 1 − 0.30 = 70% as a stability. The
    // run's stability is 0.45; the ONLY route to 70% is the invented complement.
    const input = paulsRunInput({ recommendation_stability: 0.45 });
    input.isl_results!.fragile_edges = [{ switch_probability: 0.3 }];

    const result = performShapeCheck(review(HOLDS_70), input);
    const bad = ungrounded(result.warnings);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatch(/^UNGROUNDED_NUMBER: "70%" in robustness_explanation /);
  });

  it('CONTRAST: stability PRESENT at 0.71 — "holds in about 71%" passes', () => {
    const result = performShapeCheck(
      review('The ordering holds in about 71% of variations.'),
      paulsRunInput({ recommendation_stability: 0.71 }),
    );
    expect(ungrounded(result.warnings)).toEqual([]);
  });

  it('CONTRAST: "could flip in about 70%" grounded in switch_probability 0.6968 passes', () => {
    const result = performShapeCheck(
      review('The ordering could flip in about 70% of variations if the Scope link is weaker.'),
      paulsRunInput(),
    );
    expect(ungrounded(result.warnings)).toEqual([]);
  });

  it('CONTRAST: an unbound percentage in the same sentence keeps the general rule', () => {
    // "52%" is a win probability; the flip phrase carries no figure. Nothing is bound,
    // nothing is refused.
    const result = performShapeCheck(
      review('Reduce scope scored highest in 52% of runs, but the ordering could flip if the Scope link is weaker.'),
      paulsRunInput(),
    );
    expect(ungrounded(result.warnings)).toEqual([]);
  });

  it('RED-FIRST: a flips figure is grounded ONLY by switch probabilities, never by stability', () => {
    // 80% matches the stability (0.8) and no switch probability (0.12) or other input. At base the
    // stability grounds the flip claim — the same inversion, the other way round.
    const input = paulsRunInput({ recommendation_stability: 0.8 });
    input.isl_results!.fragile_edges = [{ switch_probability: 0.12 }];
    const result = performShapeCheck(
      review('There is an 80% chance this flips.'),
      input,
    );
    const bad = ungrounded(result.warnings);
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatch(/^UNGROUNDED_NUMBER: "80%" in robustness_explanation /);
  });
});
