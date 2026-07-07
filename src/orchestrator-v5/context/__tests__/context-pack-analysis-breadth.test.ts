/**
 * Lane 21 (P0-A) — ContextPack analysis projection breadth.
 *
 * The orchestrator LLM was starved of analysis context: the projection
 * carried only the leading pair, 3 driver labels, and 3 fragile-edge label
 * pairs while the UI rendered 4 options / 5 factors. These tests pin the
 * widened RAW projection (`ContextPackAnalysis`): every option represented,
 * a 5-driver cap on the routed path, tipping-point carriage, an uncapped
 * fragile-edge count, and the VOI / goal-fit signal passthrough.
 *
 * Display-safe banding of these fields is covered separately in
 * `../../format/__tests__/format-analysis-for-context.test.ts` (Stage B).
 */

import { describe, expect, it } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';

import type { AnalysisResponseSummary, DriverSummary } from '../../../orchestrator/context/analysis-compact.js';
import type { AnalysisResponseSummaryWithSignals } from '../analysis-signals.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';

const BASE_PAYLOAD = Object.freeze(makeMessagePayload());

const FOUR_OPTIONS: AnalysisResponseSummary['options'] = [
  { option_id: 'opt-a', option_label: 'Hire locally', win_probability: 0.72, outcome_mean: 1 },
  { option_id: 'opt-b', option_label: 'Offshore partner', win_probability: 0.05, outcome_mean: 1 },
  { option_id: 'opt-c', option_label: 'Status quo', win_probability: 0.22, outcome_mean: 1 },
  { option_id: 'opt-d', option_label: 'Tiered pricing', win_probability: 0.01, outcome_mean: 1 },
];

function driver(id: string, label: string, sensitivity: number, direction: DriverSummary['direction'] = 'positive'): DriverSummary {
  return { factor_id: id, factor_label: label, sensitivity, direction };
}

function makeSummary(
  overrides: Partial<AnalysisResponseSummaryWithSignals> = {},
): AnalysisResponseSummaryWithSignals {
  return {
    winner: { option_id: 'opt-a', option_label: 'Hire locally', win_probability: 0.72 },
    options: FOUR_OPTIONS,
    top_drivers: [driver('f1', 'Engineering Capacity', 0.43)],
    robustness_level: 'moderate',
    fragile_edge_count: 2,
    top_fragile_edges: [
      { from_label: 'Engineering Capacity', to_label: 'Delivery Throughput', from_id: 'f1' },
    ],
    margin: 0.5,
    margin_pp: 50,
    analysis_status: 'complete',
    ...overrides,
  };
}

function assemble(analysis: AnalysisResponseSummaryWithSignals, extra: Record<string, unknown> = {}) {
  return assembleContextPack({
    payload: BASE_PAYLOAD,
    priorTurns: [],
    analysis,
    ...extra,
  });
}

describe('ContextPack analysis projection breadth (Lane 21)', () => {
  it('carries ALL options — label + probability, sorted by probability descending', () => {
    const pack = assemble(makeSummary());
    expect(pack.analysis?.options).toEqual([
      { label: 'Hire locally', probability: 0.72 },
      { label: 'Status quo', probability: 0.22 },
      { label: 'Offshore partner', probability: 0.05 },
      { label: 'Tiered pricing', probability: 0.01 },
    ]);
  });

  it('drops options that fail the probability scale guard but keeps the rest', () => {
    const pack = assemble(
      makeSummary({
        options: [
          ...FOUR_OPTIONS,
          { option_id: 'opt-x', option_label: 'Broken', win_probability: 47, outcome_mean: 0 },
        ],
      }),
    );
    expect(pack.analysis?.options).toHaveLength(4);
    expect(pack.analysis?.options?.map((o) => o.label)).not.toContain('Broken');
  });

  it('widens the routed top-driver cap to 5 (was 3), preserving |signed| ordering', () => {
    const pack = assemble(
      makeSummary({
        top_drivers: [
          driver('f1', 'D1', 0.9),
          driver('f2', 'D2', 0.8, 'negative'),
          driver('f3', 'D3', 0.7),
          driver('f4', 'D4', 0.6),
          driver('f5', 'D5', 0.5),
          driver('f6', 'D6', 0.4),
        ],
      }),
    );
    expect(pack.analysis?.top_drivers).toHaveLength(5);
    expect(pack.analysis?.top_drivers?.map((d) => d.factor_label)).toEqual([
      'D1', 'D2', 'D3', 'D4', 'D5',
    ]);
    expect(pack.analysis?.top_drivers?.[1]?.sensitivity_value).toBeCloseTo(-0.8, 5);
  });

  it('projects tipping points from attached signals (top-level staging shape wins)', () => {
    const pack = assemble(
      makeSummary({
        tipping_points: [
          {
            factor_label: 'Engineering Capacity',
            current_value: 0.3,
            flip_value: 0.24,
            unit: 'engineers',
            no_flip_within_bounds: false,
          },
          {
            factor_label: 'Offshore Engagement',
            current_value: 0,
            flip_value: null,
            unit: null,
            no_flip_within_bounds: true,
          },
        ],
      }),
    );
    expect(pack.analysis?.flip_thresholds).toEqual([
      {
        factor_label: 'Engineering Capacity',
        current_value: 0.3,
        flip_value: 0.24,
        unit: 'engineers',
        no_flip_within_bounds: false,
      },
      {
        factor_label: 'Offshore Engagement',
        current_value: 0,
        flip_value: null,
        unit: null,
        no_flip_within_bounds: true,
      },
    ]);
  });

  it('falls back to summary.flip_thresholds (per-option derivation) when no signals are attached', () => {
    const pack = assemble(
      makeSummary({
        flip_thresholds: [
          { factor_label: 'Churn', current_value: 12, flip_value: 9, unit: '%' },
        ],
      }),
    );
    expect(pack.analysis?.flip_thresholds).toEqual([
      {
        factor_label: 'Churn',
        current_value: 12,
        flip_value: 9,
        unit: '%',
        no_flip_within_bounds: false,
      },
    ]);
  });

  it('emits an empty flip_thresholds array when neither source exists', () => {
    const pack = assemble(makeSummary());
    expect(pack.analysis?.flip_thresholds).toEqual([]);
  });

  it('carries the UNCAPPED fragile_edge_count alongside the capped label list', () => {
    const pack = assemble(makeSummary({ fragile_edge_count: 7 }));
    expect(pack.analysis?.fragile_edge_count).toBe(7);
    expect(pack.analysis?.fragile_edges).toHaveLength(1);
  });

  it('fails safe on fragile_edge_count when lever suppression drops an edge (filtered length, not the stale count)', () => {
    const pack = assemble(
      makeSummary({
        fragile_edge_count: 5,
        top_fragile_edges: [
          { from_label: 'Lever Factor', to_label: 'Outcome', from_id: 'lever-1' },
          { from_label: 'Honest Factor', to_label: 'Outcome', from_id: 'f-ok' },
        ],
      }),
      { interventionControlledFactorIds: new Set(['lever-1']) },
    );
    // The lever-sourced edge is suppressed from the label list…
    expect(pack.analysis?.fragile_edges).toEqual([
      { from_label: 'Honest Factor', to_label: 'Outcome' },
    ]);
    // …and the count collapses to what we can actually attest (fail-closed),
    // never the pre-suppression producer count.
    expect(pack.analysis?.fragile_edge_count).toBe(1);
  });

  it('passes evidence-gap VOI signals through raw (banding happens in the formatter)', () => {
    const pack = assemble(
      makeSummary({
        evidence_gaps: [
          { factor_label: 'Talent Market Tightness', voi_score: 0.63 },
          { factor_label: 'Hiring Cost', voi_score: 0.2 },
        ],
      }),
    );
    expect(pack.analysis?.evidence_gaps).toEqual([
      { factor_label: 'Talent Market Tightness', voi_score: 0.63 },
      { factor_label: 'Hiring Cost', voi_score: 0.2 },
    ]);
  });

  it('passes the goal-fit basis signal through, null when absent', () => {
    const withGoalFit = assemble(
      makeSummary({ goal_fit: { scored: true, basis: 'modelled_outcome_distribution' } }),
    );
    expect(withGoalFit.analysis?.goal_fit).toEqual({
      scored: true,
      basis: 'modelled_outcome_distribution',
    });

    const without = assemble(makeSummary());
    expect(without.analysis?.goal_fit).toBeNull();
  });

  it('widened projection still validates against the strict ContextPack schema', () => {
    const pack = assemble(
      makeSummary({
        tipping_points: [
          { factor_label: 'X', current_value: 1, flip_value: 2, unit: null, no_flip_within_bounds: false },
        ],
        evidence_gaps: [{ factor_label: 'X', voi_score: 0.5 }],
        goal_fit: { scored: true, basis: 'modelled_outcome_distribution' },
      }),
    );
    const parsed = ContextPackSchema.safeParse(pack);
    expect(parsed.success).toBe(true);
  });
});
