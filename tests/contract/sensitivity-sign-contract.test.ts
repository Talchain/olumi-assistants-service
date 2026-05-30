/**
 * V5 Phase 2 workstream D — sensitivity sign contract.
 *
 * Pins the documented three-way rule (sensitivity_value =
 * direction === 'neutral' ? 0 : direction === 'negative' ? -elasticity
 * : elasticity — `neutral` projects to 0) and reproduces the producer-side
 * inconsistency captured in
 * `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`.
 *
 * Phase 2 audit found that the OUTER PLoT envelope uses unsigned
 * elasticity + a `direction` discriminant, while the INNER raw ISL
 * payload (`_meta.payloads.isl_response.factor_sensitivity[*]`) uses
 * signed elasticity. CEE consumes only outer-envelope paths so the
 * documented signing rule is correct as written. This file pins both
 * the rule and the producer inconsistency for ops visibility — the
 * inconsistency is an upstream bug, not a CEE adapter problem.
 *
 * No normaliser is added. See
 * src/orchestrator-v5/types/sensitivity-contract.md for the full
 * contract documentation and rationale.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { assembleContextPackWithSummary } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import { compactAnalysis, type AnalysisResponseSummary } from '../../src/orchestrator/context/analysis-compact.js';
import type { V2RunResponseEnvelope } from '../../src/orchestrator/types.js';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

// ─── helpers ──────────────────────────────────────────────────────────────

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makePayload(): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: 'tttttttt-tttt-4ttt-8ttt-tttttttttttt',
    scenario_id: SCENARIO_ID,
    message: 'hello',
    turn_class: 'frame',
    stage: 'frame',
  };
}

function makeAnalysis(
  drivers: ReadonlyArray<{ id: string; label: string; sensitivity: number; direction: 'positive' | 'negative' }>,
): AnalysisResponseSummary {
  return {
    winner: { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.6 },
    options: [
      { option_id: 'opt_a', option_label: 'Option A', win_probability: 0.6, outcome_mean: 1, outcome_p10: 0.5, outcome_p90: 1.5 },
      { option_id: 'opt_b', option_label: 'Option B', win_probability: 0.4, outcome_mean: 0.8, outcome_p10: 0.3, outcome_p90: 1.2 },
    ],
    top_drivers: drivers.map((d) => ({
      factor_id: d.id,
      factor_label: d.label,
      sensitivity: d.sensitivity,
      direction: d.direction,
    })),
    robustness_level: 'moderate',
    fragile_edge_count: 0,
    margin: 0.2,
    margin_pp: 20,
    analysis_status: 'completed',
  } as AnalysisResponseSummary;
}

// ─── rule: signed sensitivity_value in ContextPack projection ─────────────

describe('Sensitivity sign — ContextPack projection rule', () => {
  it('direction === "negative" → sensitivity_value is the negative magnitude', () => {
    const analysis = makeAnalysis([
      { id: 'fac_cost', label: 'Cost', sensitivity: 0.42, direction: 'negative' },
    ]);
    const { contextPack } = assembleContextPackWithSummary({
      payload: makePayload(),
      priorTurns: [],
      analysis,
    });
    const driver = contextPack.analysis?.top_drivers?.[0];
    expect(driver?.factor_label).toBe('Cost');
    expect(driver?.sensitivity_value).toBe(-0.42);
  });

  it('direction === "positive" → sensitivity_value preserves the magnitude', () => {
    const analysis = makeAnalysis([
      { id: 'fac_quality', label: 'Quality', sensitivity: 0.55, direction: 'positive' },
    ]);
    const { contextPack } = assembleContextPackWithSummary({
      payload: makePayload(),
      priorTurns: [],
      analysis,
    });
    const driver = contextPack.analysis?.top_drivers?.[0];
    expect(driver?.sensitivity_value).toBe(0.55);
  });

  it('mixed factors retain consistent signs (abs sort by magnitude descending)', () => {
    const analysis = makeAnalysis([
      { id: 'fac_a', label: 'A', sensitivity: 0.42, direction: 'negative' },
      { id: 'fac_b', label: 'B', sensitivity: 0.65, direction: 'positive' },
      { id: 'fac_c', label: 'C', sensitivity: 0.10, direction: 'negative' },
    ]);
    const { contextPack } = assembleContextPackWithSummary({
      payload: makePayload(),
      priorTurns: [],
      analysis,
    });
    const drivers = contextPack.analysis?.top_drivers ?? [];
    expect(drivers).toHaveLength(3);
    // Sorted by abs magnitude desc: B (0.65) → A (-0.42) → C (-0.10)
    expect(drivers[0]?.factor_label).toBe('B');
    expect(drivers[0]?.sensitivity_value).toBe(0.65);
    expect(drivers[1]?.factor_label).toBe('A');
    expect(drivers[1]?.sensitivity_value).toBe(-0.42);
    expect(drivers[2]?.factor_label).toBe('C');
    expect(drivers[2]?.sensitivity_value).toBe(-0.10);
  });
});

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
      envelopeWith([{ node_id: 'fac_cost', label: 'Cost', elasticity: 0.6, direction: 'negative' }]),
    );
    expect(summary?.top_drivers[0]?.factor_label).toBe('Cost');
    expect(summary?.top_drivers[0]?.direction).toBe('negative');
  });

  it('direction "neutral" survives the derive path and projects to sensitivity_value 0', () => {
    const summary = compactAnalysis(
      envelopeWith([{ node_id: 'fac_mix', label: 'Mixed', elasticity: 0.5, direction: 'neutral' }]),
    )!;
    expect(summary.top_drivers[0]?.direction).toBe('neutral');

    // End-to-end: the reattachment maps neutral → 0 in the ContextPack so the
    // near-zero band renders "has little effect" rather than a directional claim.
    const { contextPack } = assembleContextPackWithSummary({
      payload: makePayload(),
      priorTurns: [],
      analysis: summary,
    });
    const driver = contextPack.analysis?.top_drivers?.find((d) => d.factor_label === 'Mixed');
    expect(driver?.sensitivity_value).toBe(0);
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
