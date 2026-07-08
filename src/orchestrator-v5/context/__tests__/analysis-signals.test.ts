/**
 * Lane 21 (P0-A) — analysis-signal derivations from the raw enrichment
 * passthrough (staging envelope shape). These signals feed the widened
 * ContextPack analysis projection: tipping points (top-level
 * `flip_thresholds[]`), evidence-gap VOI (`m1_coaching.evidence_gaps[]`),
 * and goal-fit provenance (PLoT #204 `goal_fit_basis` / the
 * CONSTRAINT_GOALFIT_MODELLED_BASIS note code).
 */

import { describe, expect, it } from 'vitest';

import {
  deriveEvidenceGapsFromEnrichment,
  deriveGoalFitFromEnrichment,
  deriveOptionGoalFitsFromEnrichment,
  deriveTippingPointsFromTopLevel,
  EVIDENCE_GAP_SIGNAL_CAP,
  OPTION_GOAL_FIT_SIGNAL_CAP,
  TIPPING_POINT_SIGNAL_CAP,
} from '../analysis-signals.js';

describe('deriveTippingPointsFromTopLevel', () => {
  it('keeps real flip pairs and producer-attested no-flips; drops ambiguous rows', () => {
    const out = deriveTippingPointsFromTopLevel({
      flip_thresholds: [
        // Real tipping point.
        { factor_id: 'f1', factor_label: 'Engineering Capacity', current_value: 0.3, flip_value: 0.24, unit: 'engineers' },
        // Producer-attested no-flip (staging shape: flip_value null + reason).
        { factor_id: 'f2', factor_label: 'Offshore Engagement', current_value: 0, flip_value: null, flip_reason: 'no_effect_within_bounds' },
        // Ambiguous: flip null, no reason → dropped (no claim projected).
        { factor_id: 'f3', factor_label: 'Hiring Cost', current_value: 5, flip_value: null },
        // Malformed: no label → dropped.
        { factor_id: 'f4', current_value: 1, flip_value: 2 },
      ],
    });
    expect(out).toEqual([
      // Lane 30 (#369 audit P1): factor_id is carried through so the
      // projection can suppress option-controlled levers structurally.
      { factor_id: 'f1', factor_label: 'Engineering Capacity', current_value: 0.3, flip_value: 0.24, unit: 'engineers', no_flip_within_bounds: false },
      { factor_id: 'f2', factor_label: 'Offshore Engagement', current_value: 0, flip_value: null, unit: null, no_flip_within_bounds: true },
    ]);
  });

  it('dedupes by label (first wins) and caps the output', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      factor_label: i < 2 ? 'Duplicated' : `Factor ${i}`,
      current_value: 10,
      flip_value: 8 + i,
      unit: null,
    }));
    const out = deriveTippingPointsFromTopLevel({ flip_thresholds: rows });
    expect(out.length).toBeLessThanOrEqual(TIPPING_POINT_SIGNAL_CAP);
    // Rows without any id resolve factor_id: null (the consumer fails closed
    // on such rows when a controlled-lever set exists).
    expect(out[0]).toMatchObject({ factor_label: 'Duplicated', flip_value: 8, factor_id: null });
  });

  it('returns [] when flip_thresholds is absent or not an array', () => {
    expect(deriveTippingPointsFromTopLevel({})).toEqual([]);
    expect(deriveTippingPointsFromTopLevel({ flip_thresholds: 'nope' })).toEqual([]);
  });
});

describe('deriveEvidenceGapsFromEnrichment', () => {
  it('projects labelled finite voi_score entries in upstream (VOI-ranked) order', () => {
    const out = deriveEvidenceGapsFromEnrichment({
      m1_coaching: {
        evidence_gaps: [
          { factor_id: 'f1', factor_label: 'Talent Market Tightness', voi_score: 0.6327, confidence: 0.37 },
          { factor_id: 'f2', factor_label: 'Hiring Cost', voi_score: 0.2, confidence: 0.8 },
          // Non-finite / negative / missing → dropped.
          { factor_id: 'f3', factor_label: 'Bad NaN', voi_score: Number.NaN },
          { factor_id: 'f4', factor_label: 'Bad Negative', voi_score: -0.1 },
          { factor_id: 'f5', factor_label: 'No Score' },
        ],
      },
    });
    expect(out).toEqual([
      // Lane 30 (#369 audit P1): factor_id carried for structural lever suppression.
      { factor_id: 'f1', factor_label: 'Talent Market Tightness', voi_score: 0.6327 },
      { factor_id: 'f2', factor_label: 'Hiring Cost', voi_score: 0.2 },
    ]);
  });

  it('caps at EVIDENCE_GAP_SIGNAL_CAP entries', () => {
    const gaps = Array.from({ length: 6 }, (_, i) => ({
      factor_label: `Factor ${i}`,
      voi_score: 0.9 - i * 0.1,
    }));
    const out = deriveEvidenceGapsFromEnrichment({ m1_coaching: { evidence_gaps: gaps } });
    expect(out).toHaveLength(EVIDENCE_GAP_SIGNAL_CAP);
  });

  it('returns [] when m1_coaching or evidence_gaps is missing/malformed', () => {
    expect(deriveEvidenceGapsFromEnrichment({})).toEqual([]);
    expect(deriveEvidenceGapsFromEnrichment({ m1_coaching: null })).toEqual([]);
    expect(deriveEvidenceGapsFromEnrichment({ m1_coaching: { evidence_gaps: 'x' } })).toEqual([]);
  });
});

// Lane 30 — per-option goal-fit values (PLoT #204 live shape: see the
// staging capture at acceptance-evidence/goal-fit/, where each
// option_comparison[] entry carries probability_of_joint_goal +
// goal_fit_basis). These are the values whose ABSENCE from the ContextPack
// let the LLM pass win% off as target-fit (scenario 90385279).
describe('deriveOptionGoalFitsFromEnrichment', () => {
  it('projects per-option probability_of_joint_goal with option identity (live #204 shape)', () => {
    const out = deriveOptionGoalFitsFromEnrichment({
      option_comparison: [
        {
          option_id: 'opt_relocate',
          option_label: 'Relocate to Manchester',
          id: 'opt_relocate',
          label: 'Relocate to Manchester',
          outcome: { mean: 0.1, std: 0.14, p10: -0.27, p50: -0.12, p90: 0.1 },
          status: 'computed',
          win_probability: 0.8706666666666666,
          probability_of_joint_goal: 0.043,
          constraint_probabilities: { 'gc-cd88d633': 0.043 },
          goal_fit_basis: { scored_from: 'modelled_outcome_distribution', node_ids: ['goal_cost'] },
        },
        {
          option_id: 'opt_stay',
          option_label: 'Stay in London (Status Quo)',
          win_probability: 0.12891666666666668,
          probability_of_joint_goal: 0.07375,
          goal_fit_basis: { scored_from: 'modelled_outcome_distribution', node_ids: ['goal_cost'] },
        },
      ],
    });
    expect(out).toEqual([
      { option_id: 'opt_relocate', option_label: 'Relocate to Manchester', probability_of_joint_goal: 0.043 },
      { option_id: 'opt_stay', option_label: 'Stay in London (Status Quo)', probability_of_joint_goal: 0.07375 },
    ]);
  });

  it('drops rows with out-of-range / non-finite / missing probability_of_joint_goal', () => {
    const out = deriveOptionGoalFitsFromEnrichment({
      option_comparison: [
        { option_id: 'a', option_label: 'A', probability_of_joint_goal: 1.5 },
        { option_id: 'b', option_label: 'B', probability_of_joint_goal: -0.1 },
        { option_id: 'c', option_label: 'C', probability_of_joint_goal: Number.NaN },
        { option_id: 'd', option_label: 'D', win_probability: 0.5 },
        { option_id: 'e', option_label: 'E', probability_of_joint_goal: 0 },
        { option_id: 'f', option_label: 'F', probability_of_joint_goal: 1 },
      ],
    });
    expect(out).toEqual([
      { option_id: 'e', option_label: 'E', probability_of_joint_goal: 0 },
      { option_id: 'f', option_label: 'F', probability_of_joint_goal: 1 },
    ]);
  });

  it('drops unidentifiable rows (no id AND no label) and dedupes by identity', () => {
    const out = deriveOptionGoalFitsFromEnrichment({
      option_comparison: [
        { probability_of_joint_goal: 0.5 },
        { option_id: 'a', option_label: 'A', probability_of_joint_goal: 0.2 },
        { option_id: 'a', option_label: 'A again', probability_of_joint_goal: 0.9 },
        // Label-only rows still project (id null) — the consumer matches by label then.
        { label: 'Label Only', probability_of_joint_goal: 0.3 },
      ],
    });
    expect(out).toEqual([
      { option_id: 'a', option_label: 'A', probability_of_joint_goal: 0.2 },
      { option_id: null, option_label: 'Label Only', probability_of_joint_goal: 0.3 },
    ]);
  });

  it('caps at OPTION_GOAL_FIT_SIGNAL_CAP and returns [] on missing/malformed input', () => {
    const rows = Array.from({ length: OPTION_GOAL_FIT_SIGNAL_CAP + 3 }, (_, i) => ({
      option_id: `opt-${i}`,
      option_label: `Option ${i}`,
      probability_of_joint_goal: 0.5,
    }));
    expect(deriveOptionGoalFitsFromEnrichment({ option_comparison: rows })).toHaveLength(
      OPTION_GOAL_FIT_SIGNAL_CAP,
    );
    expect(deriveOptionGoalFitsFromEnrichment({})).toEqual([]);
    expect(deriveOptionGoalFitsFromEnrichment({ option_comparison: 'nope' })).toEqual([]);
  });
});

describe('deriveGoalFitFromEnrichment', () => {
  it('reads the top-level goal_fit_basis.scored_from', () => {
    expect(
      deriveGoalFitFromEnrichment({
        goal_fit_basis: { scored_from: 'modelled_outcome_distribution' },
      }),
    ).toEqual({ scored: true, basis: 'modelled_outcome_distribution' });
  });

  it('reads per-option constraint_delivery.goal_fit_basis (PLoT #204 shape)', () => {
    expect(
      deriveGoalFitFromEnrichment({
        option_comparison: [
          { option_id: 'opt-a' },
          {
            option_id: 'opt-b',
            constraint_delivery: {
              goal_fit_basis: { scored_from: 'modelled_outcome_distribution' },
            },
          },
        ],
      }),
    ).toEqual({ scored: true, basis: 'modelled_outcome_distribution' });
  });

  it('falls back to the CONSTRAINT_GOALFIT_MODELLED_BASIS note code in critiques[]', () => {
    expect(
      deriveGoalFitFromEnrichment({
        critiques: [
          { code: 'NORMALIZATION_WARNING', severity: 'info' },
          { code: 'CONSTRAINT_GOALFIT_MODELLED_BASIS', severity: 'info' },
        ],
      }),
    ).toEqual({ scored: true, basis: 'modelled_outcome_distribution' });
  });

  it('returns null when nothing attests goal-fit scoring', () => {
    expect(deriveGoalFitFromEnrichment({})).toBeNull();
    expect(deriveGoalFitFromEnrichment({ critiques: [{ code: 'OTHER' }] })).toBeNull();
  });
});
