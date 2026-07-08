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

// Lane 30 (#369 audit P1) — lever suppression must cover ALL projection
// sections. top_drivers + fragile_edges already filtered by the
// intervention-controlled set; flip_thresholds (section 5) and
// evidence_gaps (section 7) did NOT — an option-controlled lever excluded
// from the driver list could still surface as a tipping point or an
// evidence gap ("gather data on X to reduce uncertainty" → implies the
// user can tune X). These tests pin the closed bypass.
describe('ContextPack tipping/VOI lever suppression (Lane 30, #369 audit P1)', () => {
  const CONTROLLED = new Set(['fac_lever']);

  const TIPPING_SIGNALS = [
    { factor_id: 'fac_lever', factor_label: 'Factory Capacity', current_value: 10, flip_value: 8, unit: null, no_flip_within_bounds: false },
    { factor_id: 'fac_market', factor_label: 'Market Demand', current_value: 5, flip_value: 7, unit: null, no_flip_within_bounds: false },
  ];
  const EVIDENCE_GAPS = [
    { factor_id: 'fac_lever', factor_label: 'Factory Capacity', voi_score: 0.9 },
    { factor_id: 'fac_market', factor_label: 'Market Demand', voi_score: 0.4 },
  ];

  it('excludes an option-controlled lever from flip_thresholds (signals path)', () => {
    const pack = assemble(
      makeSummary({ tipping_points: TIPPING_SIGNALS }),
      { interventionControlledFactorIds: CONTROLLED },
    );
    expect(pack.analysis?.flip_thresholds?.map((t) => t.factor_label)).toEqual([
      'Market Demand',
    ]);
  });

  it('excludes an option-controlled lever from the per-option flip fallback path', () => {
    const pack = assemble(
      makeSummary({
        flip_thresholds: [
          { factor_id: 'fac_lever', factor_label: 'Factory Capacity', current_value: 10, flip_value: 8, unit: null },
          { factor_id: 'fac_market', factor_label: 'Market Demand', current_value: 5, flip_value: 7, unit: null },
        ],
      }),
      { interventionControlledFactorIds: CONTROLLED },
    );
    expect(pack.analysis?.flip_thresholds?.map((t) => t.factor_label)).toEqual([
      'Market Demand',
    ]);
  });

  it('excludes an option-controlled lever from evidence_gaps (VOI)', () => {
    const pack = assemble(
      makeSummary({ evidence_gaps: EVIDENCE_GAPS }),
      { interventionControlledFactorIds: CONTROLLED },
    );
    expect(pack.analysis?.evidence_gaps).toEqual([
      { factor_label: 'Market Demand', voi_score: 0.4 },
    ]);
  });

  it('fails closed: an entry with no resolvable factor_id is dropped when levers exist', () => {
    const pack = assemble(
      makeSummary({
        tipping_points: [
          { factor_id: null, factor_label: 'Unidentified Factor', current_value: 1, flip_value: 2, unit: null, no_flip_within_bounds: false },
        ],
        evidence_gaps: [{ factor_label: 'Unidentified Gap', voi_score: 0.5 }],
      }),
      { interventionControlledFactorIds: CONTROLLED },
    );
    expect(pack.analysis?.flip_thresholds).toEqual([]);
    expect(pack.analysis?.evidence_gaps).toEqual([]);
  });

  it('does not suppress by label — structural factor_id is the only authority', () => {
    const pack = assemble(
      makeSummary({
        tipping_points: [
          // Same label as a lever, DIFFERENT id → must survive.
          { factor_id: 'fac_lookalike', factor_label: 'Factory Capacity', current_value: 10, flip_value: 8, unit: null, no_flip_within_bounds: false },
        ],
      }),
      { interventionControlledFactorIds: CONTROLLED },
    );
    expect(pack.analysis?.flip_thresholds?.map((t) => t.factor_label)).toEqual([
      'Factory Capacity',
    ]);
  });

  it('is a no-op when no controlled set is supplied (id-less entries still project)', () => {
    const pack = assemble(
      makeSummary({ tipping_points: TIPPING_SIGNALS, evidence_gaps: EVIDENCE_GAPS }),
    );
    expect(pack.analysis?.flip_thresholds).toHaveLength(2);
    expect(pack.analysis?.evidence_gaps).toHaveLength(2);
  });

  it('projected entries still carry NO factor_id (internal match key only)', () => {
    const pack = assemble(
      makeSummary({ tipping_points: TIPPING_SIGNALS, evidence_gaps: EVIDENCE_GAPS }),
      { interventionControlledFactorIds: CONTROLLED },
    );
    for (const entry of pack.analysis?.flip_thresholds ?? []) {
      expect(entry).not.toHaveProperty('factor_id');
    }
    for (const entry of pack.analysis?.evidence_gaps ?? []) {
      expect(entry).not.toHaveProperty('factor_id');
    }
    const parsed = ContextPackSchema.safeParse(pack);
    expect(parsed.success).toBe(true);
  });
});

// Lane 30 — per-option goal-fit carriage (raw projection). The display-safe
// rendering (percent strings, target-fit prose) is covered in
// `../../format/__tests__/format-analysis-for-context.test.ts`; these tests
// pin the raw value carriage + option-identity matching.
describe('ContextPack per-option goal-fit (Lane 30)', () => {
  const GOAL_FITS = [
    { option_id: 'opt-a', option_label: 'Hire locally', probability_of_joint_goal: 0.293 },
    { option_id: 'opt-c', option_label: 'Status quo', probability_of_joint_goal: 0.61 },
  ];

  it('attaches goal_fit_probability to matching options by structural option_id', () => {
    const pack = assemble(makeSummary({ option_goal_fits: GOAL_FITS }));
    expect(pack.analysis?.options).toEqual([
      { label: 'Hire locally', probability: 0.72, goal_fit_probability: 0.293 },
      { label: 'Status quo', probability: 0.22, goal_fit_probability: 0.61 },
      { label: 'Offshore partner', probability: 0.05 },
      { label: 'Tiered pricing', probability: 0.01 },
    ]);
    expect(pack.analysis?.leading_option).toEqual({
      label: 'Hire locally',
      probability: 0.72,
      goal_fit_probability: 0.293,
    });
    expect(pack.analysis?.runner_up).toEqual({
      label: 'Status quo',
      probability: 0.22,
      goal_fit_probability: 0.61,
    });
  });

  it('matches by option_id even when the option was relabelled from the current graph', () => {
    // buildAnalysisFromPriorFacts relabels options from the CURRENT graph by
    // id; the enrichment-derived signal keeps the enrichment label. Identity
    // must therefore be structural (id), not label equality.
    const pack = assemble(
      makeSummary({
        option_goal_fits: [
          { option_id: 'opt-a', option_label: 'Old Enrichment Label', probability_of_joint_goal: 0.293 },
        ],
      }),
    );
    expect(pack.analysis?.options?.[0]).toEqual({
      label: 'Hire locally',
      probability: 0.72,
      goal_fit_probability: 0.293,
    });
  });

  it('falls back to label matching only when the signal carries no option_id', () => {
    const pack = assemble(
      makeSummary({
        option_goal_fits: [
          { option_id: null, option_label: 'Status quo', probability_of_joint_goal: 0.4 },
        ],
      }),
    );
    const statusQuo = pack.analysis?.options?.find((o) => o.label === 'Status quo');
    expect(statusQuo).toEqual({ label: 'Status quo', probability: 0.22, goal_fit_probability: 0.4 });
  });

  it('drops an out-of-range goal-fit value rather than projecting a false probability', () => {
    const pack = assemble(
      makeSummary({
        option_goal_fits: [
          { option_id: 'opt-a', option_label: 'Hire locally', probability_of_joint_goal: 42 },
        ],
      }),
    );
    expect(pack.analysis?.options?.[0]).toEqual({ label: 'Hire locally', probability: 0.72 });
  });

  it('validates against the strict ContextPack schema with goal-fit values attached', () => {
    const pack = assemble(makeSummary({ option_goal_fits: GOAL_FITS }));
    const parsed = ContextPackSchema.safeParse(pack);
    expect(parsed.success).toBe(true);
  });
});

// Lane 30 fix 3 — confidence tier + per-option outcome carriage (raw).
describe('ContextPack confidence tier + option outcomes (Lane 30)', () => {
  it('passes the confidence_tier ordinal token through, null when absent', () => {
    const withTier = assemble(makeSummary({ confidence_tier: 'needs_work' }));
    expect(withTier.analysis?.confidence_tier).toBe('needs_work');

    const without = assemble(makeSummary());
    expect(without.analysis?.confidence_tier).toBeNull();
  });

  it('attaches outcome_mean to matching options by structural option_id', () => {
    const pack = assemble(
      makeSummary({
        option_outcomes: [
          { option_id: 'opt-a', option_label: 'Hire locally', outcome_mean: 0.237 },
          { option_id: 'opt-c', option_label: 'Status quo', outcome_mean: -0.0996 },
        ],
      }),
    );
    expect(pack.analysis?.options).toEqual([
      { label: 'Hire locally', probability: 0.72, outcome_mean: 0.237 },
      { label: 'Status quo', probability: 0.22, outcome_mean: -0.0996 },
      { label: 'Offshore partner', probability: 0.05 },
      { label: 'Tiered pricing', probability: 0.01 },
    ]);
    expect(pack.analysis?.leading_option).toEqual({
      label: 'Hire locally',
      probability: 0.72,
      outcome_mean: 0.237,
    });
  });

  it('validates against the strict ContextPack schema with tier + outcomes attached', () => {
    const pack = assemble(
      makeSummary({
        confidence_tier: 'fair',
        option_outcomes: [
          { option_id: 'opt-a', option_label: 'Hire locally', outcome_mean: 0.237 },
        ],
      }),
    );
    const parsed = ContextPackSchema.safeParse(pack);
    expect(parsed.success).toBe(true);
  });
});
