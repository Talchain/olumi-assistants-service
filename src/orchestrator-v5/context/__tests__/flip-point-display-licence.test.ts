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

/*
 * ⚠ DELETION 8 (track2, 22 Oct 2026): `assembleContextPack` and the pack's
 * `display_analysis` are deleted, and `formatAnalysisForContext` (which held the
 * freshness gate, the float cage and the Tier-3 bands) has no served caller. The
 * rows below are the licence negatives that are decided at the SERVED seam,
 * `reconcileAnalysisSummaryWithEnrichment` → `deriveTippingPointsFromTopLevel`
 * (`../analysis-signals.ts`): a refused licence means the tipping-point signal
 * carries NO `current_display` / `flip_display`. Rows that only the formatter
 * could decide were dropped with the assembler; the originals are kept in
 * `evidence/track2-deletion8-20261022/deleted/`.
 */

import { describe, expect, it } from 'vitest';

import type { AnalysisResponseSummary, DriverSummary } from '../../../orchestrator/context/analysis-compact.js';
import { reconcileAnalysisSummaryWithEnrichment } from '../analysis-fallback.js';

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

/** The tipping-point signals the served reconcile seam attaches for `enr`. */
function tippingFrom(enr: Record<string, unknown>) {
  const { summary } = reconcileAnalysisSummaryWithEnrichment(makeSummary(), enr);
  const tipping = summary.tipping_points ?? [];
  // Non-vacuity: the row under test is present, so an absent licence is a
  // refusal and never a missing row.
  expect(tipping[0]?.factor_label).toBe('Marketing budget');
  return tipping;
}

function expectNoLicence(enr: Record<string, unknown>) {
  const tipping = tippingFrom(enr);
  expect(tipping[0]).not.toHaveProperty('current_display');
  expect(tipping[0]).not.toHaveProperty('flip_display');
  return tipping;
}

function expectLicence(enr: Record<string, unknown>) {
  const tipping = tippingFrom(enr);
  expect(tipping[0]).toMatchObject({
    current_display: '40000 GBP',
    flip_display: '34500 GBP',
  });
}

describe('flip point — display licence at the served signal seam (ROADMAP 2.205)', () => {
  it('POSITIVE CONTROL: a display-licensed flip point carries the producer display strings', () => {
    expectLicence(enrichment());
  });

  it('NEGATIVE: no decision_review flip row at all ⇒ no licence', () => {
    expectNoLicence(enrichment({ decision_review: {} }));
  });

  it('NEGATIVE: a decision_review row for a DIFFERENT factor does not license this one', () => {
    expectNoLicence(
      enrichment({
        decision_review: {
          flip_thresholds: [{ ...CARDED_FLIP_ROW, factor_id: 'fac_something_else' }],
        },
      }),
    );
  });

  it('NEGATIVE: an empty `narrative` ⇒ no card shipped ⇒ no licence', () => {
    expectNoLicence(
      enrichment({
        decision_review: { flip_thresholds: [{ ...CARDED_FLIP_ROW, narrative: '   ' }] },
      }),
    );
  });

  it('NEGATIVE: a bare-decimal display string that does not describe the raw value is not licensed', () => {
    const tipping = expectNoLicence(
      enrichment({
        decision_review: {
          flip_thresholds: [
            { ...CARDED_FLIP_ROW, current_display: '0.40', flip_display: '0.345' },
          ],
        },
      }),
    );
    expect(JSON.stringify(tipping)).not.toContain('0.345');
  });

  it('NEGATIVE: a producer-attested no-flip entry is never given a flip point', () => {
    const tipping = expectNoLicence(
      enrichment({
        flip_thresholds: [
          { ...PLOT_FLIP_ROW, flip_value: null, flip_reason: 'no_effect_within_bounds' },
        ],
      }),
    );
    expect(tipping[0]?.no_flip_within_bounds).toBe(true);
  });
});

describe('A1 core — the licence uses the CARD\'S predicate, not a near-copy', () => {
  it('D1: a row keyed by `node_id` instead of `factor_id` cards NOTHING, so licenses nothing', () => {
    const { factor_id: _drop, ...noFactorId } = CARDED_FLIP_ROW;
    expectNoLicence(
      enrichment({
        decision_review: {
          flip_thresholds: [{ ...noFactorId, node_id: 'fac_marketing_budget' }],
        },
      }),
    );
  });

  it('D2: a row with no `factor_label` cards NOTHING, so licenses nothing', () => {
    expectNoLicence(
      enrichment({
        decision_review: { flip_thresholds: [{ ...CARDED_FLIP_ROW, factor_label: '  ' }] },
      }),
    );
  });
});

describe('A1(b) / D4 — the digits must survive BODY_MAX truncation', () => {
  it('a narrative long enough to push the flip value past the card body loses the licence', () => {
    const longNarrative = `${'Context. '.repeat(40)}It flips at 34500 GBP from 40000 GBP.`;
    expect(longNarrative.length).toBeGreaterThan(300);
    expectNoLicence(
      enrichment({
        decision_review: { flip_thresholds: [{ ...CARDED_FLIP_ROW, narrative: longNarrative }] },
      }),
    );
  });

  it('a narrative that keeps the digits INSIDE the body keeps the licence', () => {
    const shortEnough = 'If Marketing budget moves from 40000 GBP to 34500 GBP, the result changes.';
    expect(shortEnough.length).toBeLessThan(300);
    expectLicence(
      enrichment({
        decision_review: { flip_thresholds: [{ ...CARDED_FLIP_ROW, narrative: shortEnough }] },
      }),
    );
  });
});

describe('A2 — model scale fails closed', () => {
  it('an uninverted model-scale pair with a unit is REFUSED ("0.8625 GBP" is not £34,500)', () => {
    const tipping = expectNoLicence(
      enrichment({
        flip_thresholds: [
          { ...PLOT_FLIP_ROW, current_value: 0.4, flip_value: 0.8625 },
        ],
        decision_review: {
          flip_thresholds: [
            { ...CARDED_FLIP_ROW, current_display: '0.4 GBP', flip_display: '0.8625 GBP',
              narrative: 'If Marketing budget moves from 0.4 GBP to 0.8625 GBP, the result changes.' },
          ],
        },
      }),
    );
    expect(JSON.stringify(tipping)).not.toContain('0.8625 GBP');
  });

  it('CONTROL: the same shape with user-scale integers and an attested display scale IS licensed', () => {
    expectLicence(enrichment({ flip_thresholds: [{ ...PLOT_FLIP_ROW, value_scale: 'display' }] }));
  });

  it('an explicit value_scale of "model" is REFUSED even when the values look user-scale', () => {
    expectNoLicence(enrichment({ flip_thresholds: [{ ...PLOT_FLIP_ROW, value_scale: 'model' }] }));
  });

  it('an UNRECOGNISED value_scale token is REFUSED (never guessed)', () => {
    expectNoLicence(
      enrichment({ flip_thresholds: [{ ...PLOT_FLIP_ROW, value_scale: 'normalised' }] }),
    );
  });

  it('an explicit value_scale of "display" nested under margin_sensitivity is honoured', () => {
    expectLicence(
      enrichment({
        flip_thresholds: [
          { ...PLOT_FLIP_ROW, margin_sensitivity: { movement: 'weakened', value_scale: 'display' } },
        ],
      }),
    );
  });

  it('the display strings must DESCRIBE these raw values — they come from a different array', () => {
    const tipping = expectNoLicence(
      enrichment({
        decision_review: {
          flip_thresholds: [
            { ...CARDED_FLIP_ROW, current_display: '12000 GBP', flip_display: '7800 GBP',
              narrative: 'If Marketing budget moves from 12000 GBP to 7800 GBP, the result changes.' },
          ],
        },
      }),
    );
    expect(JSON.stringify(tipping)).not.toContain('7800');
  });
});
