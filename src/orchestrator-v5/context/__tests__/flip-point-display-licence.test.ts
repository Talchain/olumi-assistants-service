/**
 * THE DISPLAY LICENCE for flip points — ROADMAP 2.205 practical resolution.
 *
 * THE DEFECT. On the same analysis the USER'S SCREEN carries the flip point's
 * digits — `buildFlipThresholdCards` (compose/phase3-blocks.ts:1799) ships the
 * producer `narrative`, and the producing prompt (prompts/defaults.ts:1412-1424)
 * ORDERS that narrative to restate the current and flip values unrounded — while
 * the COACH's ContextPack carried only the band ("a moderate decrease could flip
 * the result"). The coach could not discuss what the user was looking at.
 *
 * THE RULE (adjudicated; Paul veto open): a number already DISPLAY-LICENSED to
 * the user on the same turn is speakable by the coach — same licence, same
 * register. The Tier-3 deny (claim-safety-cage.ts:116-121) continues to bind
 * every value NOT shown to the user.
 *
 * These tests pin BOTH halves. The positive: a licensed flip point reaches the
 * pack as a pre-formatted display string. The negatives, which are the whole
 * point of a licence — every way a value can FAIL to be display-licensed must
 * leave the band in place, never the number:
 *
 *   - no decision_review flip row at all            → band
 *   - a row for a DIFFERENT factor (no id join)     → band
 *   - a row whose `narrative` is empty (no card shipped) → band
 *   - a display string that is a bare decimal       → band (the float cage)
 *   - a producer-attested no-flip entry             → band
 *
 * And the two Tier-3 values that are NOT display-licensed anywhere — the
 * sensitivity magnitude and the VOI score — stay banded, pinned here so a later
 * "finish the set" edit goes RED instead of shipping a Tier-3 breach.
 */

import { describe, expect, it } from 'vitest';

import type { AnalysisResponseSummary, DriverSummary } from '../../../orchestrator/context/analysis-compact.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { reconcileAnalysisSummaryWithEnrichment } from '../analysis-fallback.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import { ContextPackSchema } from '../context-pack-schema.js';

const BASE_PAYLOAD = Object.freeze(makeMessagePayload());

function driver(id: string, label: string, sensitivity: number): DriverSummary {
  return { factor_id: id, factor_label: label, sensitivity, direction: 'negative' };
}

function makeSummary(): AnalysisResponseSummary {
  return {
    winner: { option_id: 'opt-a', option_label: 'Hire locally', win_probability: 0.72 },
    options: [
      { option_id: 'opt-a', option_label: 'Hire locally', win_probability: 0.72, outcome_mean: 1 },
      { option_id: 'opt-b', option_label: 'Offshore partner', win_probability: 0.28, outcome_mean: 1 },
    ],
    top_drivers: [driver('fac_marketing_budget', 'Marketing budget', -0.4)],
    robustness_level: 'moderate',
    fragile_edge_count: 0,
    margin: 0.44,
    margin_pp: 44,
    analysis_status: 'complete',
  };
}

/** The deterministic PLoT row — the SAME row `buildFlipProposalEmit` reads. */
const PLOT_FLIP_ROW = Object.freeze({
  factor_id: 'fac_marketing_budget',
  factor_label: 'Marketing budget',
  current_value: 40000,
  flip_value: 34500,
  direction: 'decrease',
  unit: 'GBP',
  flip_reason: 'found',
});

/** The decision_review row `buildFlipThresholdCards` turns into the user's card. */
const CARDED_FLIP_ROW = Object.freeze({
  factor_id: 'fac_marketing_budget',
  factor_label: 'Marketing budget',
  current_display: '40000 GBP',
  flip_display: '34500 GBP',
  narrative:
    'If Marketing budget moves from 40000 GBP to 34500 GBP, the result changes.',
});

function enrichment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    flip_thresholds: [PLOT_FLIP_ROW],
    decision_review: { flip_thresholds: [CARDED_FLIP_ROW] },
    ...overrides,
  };
}

function packFrom(enr: Record<string, unknown>) {
  const { summary } = reconcileAnalysisSummaryWithEnrichment(makeSummary(), enr);
  const pack = assembleContextPack({ payload: BASE_PAYLOAD, priorTurns: [], analysis: summary });
  // The pack must stay valid against the STRICT schema — a new key that the
  // schema rejects would be a silent contract break, not a feature.
  expect(() => ContextPackSchema.parse(pack)).not.toThrow();
  return pack;
}

/** Recursive walk: no `number` at any depth in the LLM-facing projection. */
function assertNoNumbersAnywhere(value: unknown, path = '$'): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'number') throw new Error(`Found number at ${path}: ${value}`);
  if (typeof value === 'string' || typeof value === 'boolean') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoNumbersAnywhere(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      assertNoNumbersAnywhere(v, `${path}.${k}`);
    }
  }
}

describe('flip point — display licence (ROADMAP 2.205 practical resolution)', () => {
  it('POSITIVE: a display-licensed flip point reaches the pack as a pre-formatted string, band retained', () => {
    const tipping = packFrom(enrichment()).display_analysis?.tipping_points;
    expect(tipping).toEqual([
      {
        label: 'Marketing budget',
        // The band is NOT replaced — disclosed-absence doctrine in reverse:
        // the licensed number is ADDITIVE to the honest qualitative read.
        risk: 'a moderate decrease could flip the result',
        flip_point: 'currently 40000 GBP; flips at 34500 GBP',
      },
    ]);
  });

  it('POSITIVE: the licensed string survives the whole pack serialisation', () => {
    const pack = packFrom(enrichment());
    expect(JSON.stringify(pack.display_analysis)).toContain(
      'currently 40000 GBP; flips at 34500 GBP',
    );
  });

  it('the licensed string is a STRING — no raw float enters the display projection', () => {
    assertNoNumbersAnywhere(packFrom(enrichment()).display_analysis);
  });

  it('NEGATIVE: no decision_review flip row at all ⇒ band only, no number', () => {
    const tipping = packFrom(enrichment({ decision_review: {} })).display_analysis?.tipping_points;
    expect(tipping).toEqual([
      { label: 'Marketing budget', risk: 'a moderate decrease could flip the result' },
    ]);
  });

  it('NEGATIVE: a decision_review row for a DIFFERENT factor does not license this one', () => {
    const tipping = packFrom(
      enrichment({
        decision_review: {
          flip_thresholds: [{ ...CARDED_FLIP_ROW, factor_id: 'fac_something_else' }],
        },
      }),
    ).display_analysis?.tipping_points;
    expect(tipping?.[0]).not.toHaveProperty('flip_point');
    expect(tipping?.[0]?.risk).toBe('a moderate decrease could flip the result');
  });

  it('NEGATIVE: an empty `narrative` ⇒ no card shipped ⇒ no licence', () => {
    const tipping = packFrom(
      enrichment({
        decision_review: { flip_thresholds: [{ ...CARDED_FLIP_ROW, narrative: '   ' }] },
      }),
    ).display_analysis?.tipping_points;
    expect(tipping?.[0]).not.toHaveProperty('flip_point');
  });

  it('NEGATIVE: a bare-decimal display string is refused by the float cage', () => {
    const tipping = packFrom(
      enrichment({
        decision_review: {
          flip_thresholds: [
            { ...CARDED_FLIP_ROW, current_display: '0.40', flip_display: '0.345' },
          ],
        },
      }),
    ).display_analysis?.tipping_points;
    expect(tipping?.[0]).not.toHaveProperty('flip_point');
    expect(JSON.stringify(tipping)).not.toContain('0.345');
  });

  it('NEGATIVE: a producer-attested no-flip entry is never given a flip point', () => {
    const tipping = packFrom(
      enrichment({
        flip_thresholds: [
          { ...PLOT_FLIP_ROW, flip_value: null, flip_reason: 'no_effect_within_bounds' },
        ],
      }),
    ).display_analysis?.tipping_points;
    expect(tipping).toEqual([
      { label: 'Marketing budget', risk: 'no flip point found within the tested range' },
    ]);
  });
});

describe('the Tier-3 values that are NOT display-licensed stay banded', () => {
  it('the sensitivity MAGNITUDE stays a band — no CEE surface renders it to the user', () => {
    const drivers = packFrom(enrichment()).display_analysis?.top_drivers;
    expect(drivers).toEqual([
      { label: 'Marketing budget', influence: 'moderate negative influence' },
    ]);
    expect(JSON.stringify(drivers)).not.toContain('0.4');
  });

  it('the VOI SCORE stays a band — m1_coaching is transport-banned, so it never reaches a screen', () => {
    const pack = packFrom(
      enrichment({
        m1_coaching: {
          evidence_gaps: [{ factor_id: 'fac_churn', factor_label: 'Churn rate', voi_score: 0.82 }],
        },
      }),
    );
    expect(pack.display_analysis?.value_of_information).toEqual([
      { label: 'Churn rate', value_of_information: 'strong' },
    ]);
    expect(JSON.stringify(pack.display_analysis?.value_of_information)).not.toContain('0.82');
  });
});
