/**
 * V5 Phase 2 workstream D — sensitivity sign contract.
 *
 * Pins that the derive path (`compactAnalysis`) honours the `direction`
 * enum (`negative` / `neutral`) rather than the sign of the unsigned
 * elasticity, and reproduces the producer-side inconsistency captured in
 * `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`.
 *
 * Phase 2 audit found that the OUTER PLoT envelope uses unsigned
 * elasticity + a `direction` discriminant, while the INNER raw ISL
 * payload (`_meta.payloads.isl_response.factor_sensitivity[*]`) uses
 * signed elasticity. CEE consumes only outer-envelope paths so the
 * documented signing rule is correct as written. This file pins the
 * direction enum on the derive path and the producer inconsistency for
 * ops visibility — the inconsistency is an upstream bug, not a CEE
 * adapter problem.
 *
 * No normaliser is added. See
 * src/orchestrator-v5/types/sensitivity-contract.md for the full
 * contract documentation and rationale.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { compactAnalysis } from '../../src/orchestrator/context/analysis-compact.js';
import type { V2RunResponseEnvelope } from '../../src/orchestrator/types.js';

// ─── derive path: compactAnalysis honours the enum, not the magnitude sign ─

describe('Sensitivity sign — derive path honours the direction enum', () => {
  function envelopeWith(
    factors: ReadonlyArray<Record<string, unknown>>,
  ): V2RunResponseEnvelope {
    return {
      meta: { seed_used: 1, n_samples: 1000, response_hash: 'h-derive' },
      results: [
        {
          option_id: 'opt_a',
          option_label: 'Option A',
          win_probability: 0.6,
          outcome_mean: 1,
          factor_sensitivity: factors,
        },
        { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.4, outcome_mean: 0.8 },
      ],
      analysis_status: 'complete',
    } as unknown as V2RunResponseEnvelope;
  }

  it('unsigned elasticity + direction "negative" resolves negative (not sign-derived positive)', () => {
    // The core bug: pre-fix, deriveTopDrivers read the sign of the unsigned
    // elasticity (0.6 >= 0) and emitted 'positive'. The enum must win.
    const summary = compactAnalysis(
      envelopeWith([{ node_id: 'fac_cost', label: 'Cost', elasticity: 0.6, direction: 'negative', influence_score: 0.6 }]),
    );
    expect(summary?.top_drivers[0]?.factor_label).toBe('Cost');
    expect(summary?.top_drivers[0]?.direction).toBe('negative');
  });

  it('direction "neutral" survives the derive path', () => {
    const summary = compactAnalysis(
      envelopeWith([{ node_id: 'fac_mix', label: 'Mixed', elasticity: 0.5, direction: 'neutral', influence_score: 0.5 }]),
    )!;
    expect(summary.top_drivers[0]?.direction).toBe('neutral');
  });
});

// ─── producer-side inconsistency reproduction ─────────────────────────────

describe('Sensitivity sign — producer-side inconsistency (staging fixture)', () => {
  /**
   * The staging capture exhibits a direct contradiction inside one
   * envelope: `factor_sensitivity[*]` reports several factors with
   * `direction: 'negative'`, while the matching
   * `decision_brief.top_drivers[*]` entries all have
   * `direction: 'positive'`. This test pins the inconsistency so any
   * future producer-side fix is visible (the test then needs an update),
   * and so ops have a grep target if the same pattern is observed in
   * production logs.
   */
  it('top_drivers vs factor_sensitivity disagree on direction within a single envelope', () => {
    const fixture = JSON.parse(
      readFileSync('tests/fixtures/cross-service/v5-turn.run-analysis.staging.json', 'utf8'),
    );

    const blocks = fixture.blocks as Array<Record<string, unknown>>;
    const enrichment = blocks[0]?.enrichment as Record<string, unknown>;
    const factorSensitivity = enrichment?.factor_sensitivity as Array<{
      direction?: string;
    }>;
    const decisionBrief = enrichment?.decision_brief as Record<string, unknown>;
    const topDrivers = decisionBrief?.top_drivers as Array<{ direction?: string }>;

    expect(Array.isArray(factorSensitivity)).toBe(true);
    expect(Array.isArray(topDrivers)).toBe(true);

    const factorNegativeCount = factorSensitivity.filter(
      (f) => f.direction === 'negative',
    ).length;
    const topDriverNegativeCount = topDrivers.filter(
      (d) => d.direction === 'negative',
    ).length;

    // Pin the exact inconsistency observed in the captured fixture.
    // factor_sensitivity reports 3 negative directions; top_drivers
    // reports zero. If a producer fix lands and aligns these counts,
    // this test will start failing — that's a deliberate reminder to
    // re-evaluate sensitivity-contract.md.
    expect(factorNegativeCount).toBeGreaterThan(0);
    expect(topDriverNegativeCount).toBe(0);
    expect(factorNegativeCount).not.toBe(topDriverNegativeCount);
  });
});
