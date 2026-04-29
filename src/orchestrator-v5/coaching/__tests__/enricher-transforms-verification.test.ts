/**
 * Test N (verification) — decision_review enricher input shape transforms.
 *
 * Drives the full enrichment-to-invoke-input projection via the public test
 * helper `buildInvokeInputForTests` (decision-review-enricher.ts:183-189).
 *
 * Asserts the shipped behaviour:
 *   - flip_threshold_data populated when nested factor_sensitivity flip
 *     thresholds exist; direction derived from value-delta (flip > current
 *     → 'increase').
 *   - factor_sensitivity carries factor_id and factor_label.
 *   - fragile_edges resolves from_label / to_label via graph nodes when only
 *     *_node_id keys are present.
 *   - option_comparison normalises outcome.{mean,p10,p90} (nested shape).
 *   - deterministic_coaching defaults to readiness:'unknown' / headline_type:
 *     'neutral' for v11 prompt compatibility.
 *   - _meta.input_shape_version === 'v5-normalised'.
 *   - margin and robustness_level pinned on _meta.
 *
 * SCOPING NOTE on the prompt-stripping check: the brief asks for a sanity
 * check that the XML message sent to the LLM excludes `_meta`. The user
 * message builder is `buildDecisionReviewUserMessage` at
 * `src/cee/decision-review/invoke.ts:128`. The strict separation between
 * adapter input (`_meta`) and the user message is documented in the
 * DecisionReviewMeta jsdoc (invoke.ts:34-44). We assert the contract by
 * calling that builder against the same input and confirming `_meta` does
 * not appear in the rendered message.
 */

import { describe, it, expect } from 'vitest';
import {
  buildInvokeInputForTests,
} from '../decision-review-enricher.js';
import { buildDecisionReviewUserMessage } from '../../../cee/decision-review/invoke.js';

const ENRICHMENT: Record<string, unknown> = {
  graph: {
    nodes: [
      { id: 'fac_price', label: 'Price', kind: 'factor', data: { unit: 'USD' } },
      { id: 'fac_quality', label: 'Quality', kind: 'factor' },
      { id: 'fac_speed', label: 'Speed', kind: 'factor' },
      { id: 'opt_a', label: 'Premium plan', kind: 'option' },
      { id: 'opt_b', label: 'Budget plan', kind: 'option' },
    ],
  },
  results: [
    {
      option_id: 'opt_a',
      option_label: 'Premium plan',
      win_probability: 0.7,
      outcome: { mean: 0.65, p10: 0.5, p90: 0.8 },
      factor_sensitivity: [
        {
          factor_id: 'fac_price',
          factor_label: 'Price',
          current_value: 100,
          flip_threshold: 150, // flip > current → 'increase'
          unit: 'USD',
          elasticity: 0.4,
        },
      ],
    },
    {
      option_id: 'opt_b',
      option_label: 'Budget plan',
      win_probability: 0.3,
      outcome: { mean: 0.4, p10: 0.25, p90: 0.55 },
      factor_sensitivity: [
        {
          factor_id: 'fac_quality',
          factor_label: 'Quality',
          current_value: 0.8,
          flip_threshold: 0.5, // flip < current → 'decrease'
          elasticity: -0.3,
        },
      ],
    },
  ],
  // Top-level factor_sensitivity (the "v5-normalised" path)
  factor_sensitivity: [
    { factor_id: 'fac_price', factor_label: 'Price', elasticity: 0.4, confidence: 0.8 },
    { factor_id: 'fac_quality', factor_label: 'Quality', elasticity: -0.3, confidence: 0.6 },
  ],
  robustness: {
    level: 'moderate',
    recommendation_stability: 0.75,
    overall_confidence: 0.7,
    fragile_edges: [
      {
        edge_id: 'fac_speed->opt_a',
        from_node_id: 'fac_speed',
        to_node_id: 'opt_a',
        switch_probability: 0.15,
      },
    ],
  },
};

const BRIEF = 'Choose between Premium plan and Budget plan to maximise margin.';

describe('Test N — decision_review invoke-input transforms', () => {
  const input = buildInvokeInputForTests(BRIEF, ENRICHMENT, 'opt_a');

  it('returns a populated input (winner resolved by leadingOptionId)', () => {
    expect(input).not.toBeNull();
    expect(input!.winner.id).toBe('opt_a');
    expect(input!.winner.label).toBe('Premium plan');
    expect(input!.runner_up?.id).toBe('opt_b');
  });

  it('flip_threshold_data populated; direction derived from value delta', () => {
    expect(input!.flip_threshold_data).toBeDefined();
    expect(Array.isArray(input!.flip_threshold_data)).toBe(true);
    const entries = input!.flip_threshold_data!;
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const priceEntry = entries.find((e) => e.factor_id === 'fac_price')!;
    expect(priceEntry.factor_label).toBe('Price');
    expect(priceEntry.current_value).toBe(100);
    expect(priceEntry.flip_value).toBe(150);
    expect(priceEntry.direction).toBe('increase');
    expect(priceEntry.unit).toBe('USD');

    const qualityEntry = entries.find((e) => e.factor_id === 'fac_quality')!;
    expect(qualityEntry.flip_value).toBe(0.5);
    expect(qualityEntry.current_value).toBe(0.8);
    expect(qualityEntry.direction).toBe('decrease');
  });

  it('factor_sensitivity carries factor_id and factor_label (renamed from id/label)', () => {
    const fs = input!.isl_results.factor_sensitivity as ReadonlyArray<Record<string, unknown>>;
    expect(Array.isArray(fs)).toBe(true);
    expect(fs.length).toBe(2);
    for (const entry of fs) {
      expect(typeof entry.factor_id).toBe('string');
      expect(typeof entry.factor_label).toBe('string');
    }
  });

  it('fragile_edges resolves from_label / to_label via graph node labels', () => {
    const fragile = input!.isl_results.fragile_edges as ReadonlyArray<Record<string, unknown>>;
    expect(fragile.length).toBe(1);
    expect(fragile[0]!.from_label).toBe('Speed');
    expect(fragile[0]!.to_label).toBe('Premium plan');
  });

  it('option_comparison normalises outcome.{mean,p10,p90}', () => {
    const oc = input!.isl_results.option_comparison as ReadonlyArray<Record<string, unknown>>;
    expect(oc.length).toBe(2);
    const winner = oc.find((r) => r.option_id === 'opt_a')!;
    const winnerOutcome = winner.outcome as Record<string, unknown>;
    expect(winnerOutcome.mean).toBe(0.65);
    expect(winnerOutcome.p10).toBe(0.5);
    expect(winnerOutcome.p90).toBe(0.8);
  });

  it('deterministic_coaching defaults to neutral / unknown for v11 compat', () => {
    expect(input!.deterministic_coaching.headline_type).toBe('neutral');
    expect(input!.deterministic_coaching.readiness).toBe('unknown');
  });

  it('_meta.input_shape_version is v5-normalised + populated counts', () => {
    expect(input!._meta).toBeDefined();
    expect(input!._meta!.input_shape_version).toBe('v5-normalised');
    expect(input!._meta!.flip_threshold_count).toBeGreaterThanOrEqual(2);
    expect(input!._meta!.factor_sensitivity_count).toBe(2);
    expect(input!._meta!.fragile_edge_count).toBe(1);
    expect(input!._meta!.has_deterministic_coaching).toBe(false);
    expect(input!._meta!.robustness_level).toBe('moderate');
    // margin = winner.win_probability (0.7) - runner_up.win_probability (0.3) = 0.4
    expect(input!._meta!.margin).toBeCloseTo(0.4, 5);
  });

  it('user message builder strips _meta — no diagnostic field leaks to the LLM', () => {
    // Defense for the brief's "no _meta in the prompt" sanity check. The
    // strict separation between adapter input (_meta) and the rendered
    // user message is documented in DecisionReviewMeta jsdoc; here we
    // confirm the builder honours it.
    const margin = input!._meta?.margin ?? null;
    const message = buildDecisionReviewUserMessage(input!, margin);
    expect(message).not.toMatch(/_meta/);
    expect(message).not.toMatch(/input_shape_version/);
    expect(message).not.toMatch(/has_deterministic_coaching/);
  });

  it('no raw factor IDs leak into option_comparison or fragile_edges labels', () => {
    // Outputs that could surface to the user must use display labels, never
    // raw IDs (project memory note: ID prefixes fac_ / opt_ / dec_ must not
    // appear in any user-facing string).
    const fragile = input!.isl_results.fragile_edges as ReadonlyArray<Record<string, unknown>>;
    for (const e of fragile) {
      expect(String(e.from_label)).not.toMatch(/^fac_|^opt_|^dec_/);
      expect(String(e.to_label)).not.toMatch(/^fac_|^opt_|^dec_/);
    }
    const oc = input!.isl_results.option_comparison as ReadonlyArray<Record<string, unknown>>;
    for (const r of oc) {
      // option_label may be null in degenerate paths; assert only when present
      if (typeof r.option_label === 'string') {
        expect(r.option_label).not.toMatch(/^opt_/);
      }
    }
    const ftd = input!.flip_threshold_data ?? [];
    for (const e of ftd) {
      expect(String(e.factor_label)).not.toMatch(/^fac_|^opt_|^dec_/);
    }
  });
});
