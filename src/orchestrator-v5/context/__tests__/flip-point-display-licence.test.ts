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

/**
 * The base-case pack. AMENDED: it now supplies a FRESH verdict, because after
 * amendment A1(a) the licence is gated on freshness and a pack with no verdict
 * is correctly closed. The no-verdict and stale cases are pinned explicitly in
 * the A1(a) block below — they are behaviour under test, not a default.
 */
function packFrom(enr: Record<string, unknown>) {
  return packAt(enr, 'fresh');
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

// ===========================================================================
// AMENDMENT ROUND (review of PR #776) — one describe per finding, each a gate
// the first cut did not have. Every one of these is RED before its fix.
// ===========================================================================

/** A pack built with an explicit freshness verdict. */
function packAt(enr: Record<string, unknown>, freshness: string | null) {
  const { summary } = reconcileAnalysisSummaryWithEnrichment(makeSummary(), enr);
  const pack = assembleContextPack({
    payload: BASE_PAYLOAD,
    priorTurns: [],
    analysis: summary,
    ...(freshness !== null
      ? {
          coachingContext: {
            analysis_present: true,
            freshness,
            readiness_status: null,
            rerun_required: freshness !== 'fresh',
            usable_for_prose: true,
            usable_for_chips: freshness === 'fresh',
            blocked: false,
            actionable_blocker_count: 0,
          },
        }
      : {}),
  } as Parameters<typeof assembleContextPack>[0]);
  expect(() => ContextPackSchema.parse(pack)).not.toThrow();
  return pack;
}

describe('A1(a) — the licence is gated on the FRESH verdict', () => {
  it('a FRESH turn licenses the flip point', () => {
    const t = packAt(enrichment(), 'fresh').display_analysis?.tipping_points;
    expect(t?.[0]?.flip_point).toBe('currently 40000 GBP; flips at 34500 GBP');
  });

  it('a STALE turn does NOT — compose ships no review card, so no screen carries the digits', () => {
    const t = packAt(enrichment(), 'stale').display_analysis?.tipping_points;
    expect(t?.[0]).not.toHaveProperty('flip_point');
    expect(t?.[0]?.risk).toBe('a moderate decrease could flip the result');
    expect(JSON.stringify(t)).not.toContain('34500');
  });

  it.each(['unknown', 'none'])('a %s verdict does NOT license', (v) => {
    const t = packAt(enrichment(), v).display_analysis?.tipping_points;
    expect(t?.[0]).not.toHaveProperty('flip_point');
  });

  it('NO verdict at all does NOT license — absence is closed, never open', () => {
    const t = packAt(enrichment(), null).display_analysis?.tipping_points;
    expect(t?.[0]).not.toHaveProperty('flip_point');
  });
});

describe('A1 core — the licence uses the CARD\'S predicate, not a near-copy', () => {
  it('D1: a row keyed by `node_id` instead of `factor_id` cards NOTHING, so licenses nothing', () => {
    const { factor_id: _drop, ...noFactorId } = CARDED_FLIP_ROW;
    const t = packAt(
      enrichment({
        decision_review: {
          flip_thresholds: [{ ...noFactorId, node_id: 'fac_marketing_budget' }],
        },
      }),
      'fresh',
    ).display_analysis?.tipping_points;
    expect(t?.[0]).not.toHaveProperty('flip_point');
  });

  it('D2: a row with no `factor_label` cards NOTHING, so licenses nothing', () => {
    const t = packAt(
      enrichment({
        decision_review: { flip_thresholds: [{ ...CARDED_FLIP_ROW, factor_label: '  ' }] },
      }),
      'fresh',
    ).display_analysis?.tipping_points;
    expect(t?.[0]).not.toHaveProperty('flip_point');
  });
});

describe('A1(b) / D4 — the digits must survive BODY_MAX truncation', () => {
  it('a narrative long enough to push the flip value past the card body loses the licence', () => {
    const longNarrative = `${'Context. '.repeat(40)}It flips at 34500 GBP from 40000 GBP.`;
    expect(longNarrative.length).toBeGreaterThan(300);
    const t = packAt(
      enrichment({
        decision_review: { flip_thresholds: [{ ...CARDED_FLIP_ROW, narrative: longNarrative }] },
      }),
      'fresh',
    ).display_analysis?.tipping_points;
    expect(t?.[0]).not.toHaveProperty('flip_point');
  });

  it('a narrative that keeps the digits INSIDE the body keeps the licence', () => {
    const shortEnough = 'If Marketing budget moves from 40000 GBP to 34500 GBP, the result changes.';
    expect(shortEnough.length).toBeLessThan(300);
    const t = packAt(
      enrichment({
        decision_review: { flip_thresholds: [{ ...CARDED_FLIP_ROW, narrative: shortEnough }] },
      }),
      'fresh',
    ).display_analysis?.tipping_points;
    expect(t?.[0]?.flip_point).toBe('currently 40000 GBP; flips at 34500 GBP');
  });
});

describe('A2 — model scale fails closed, and the cage sees unit-suffixed decimals', () => {
  it('an uninverted model-scale pair with a unit is REFUSED ("0.8625 GBP" is not £34,500)', () => {
    const t = packAt(
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
      'fresh',
    ).display_analysis?.tipping_points;
    expect(t?.[0]).not.toHaveProperty('flip_point');
    expect(JSON.stringify(t)).not.toContain('0.8625');
  });

  it('ISOLATES THE CAGE: even an ATTESTED display-scale sub-unit decimal is refused', () => {
    // This case exists because the first version of the "0.8625 GBP" test above
    // passed with the cage REVERTED — the scale gate was catching it, so the
    // cage assertion was vacuous (trap 13). Here `value_scale: 'display'` is
    // attested and the strings agree with the raw values, so the scale gate and
    // the agreement gate BOTH pass and only the widened cage can refuse.
    const t = packAt(
      enrichment({
        flip_thresholds: [
          { ...PLOT_FLIP_ROW, current_value: 0.4, flip_value: 0.8625, value_scale: 'display' },
        ],
        decision_review: {
          flip_thresholds: [
            { ...CARDED_FLIP_ROW, current_display: '0.4 GBP', flip_display: '0.8625 GBP',
              narrative: 'If Marketing budget moves from 0.4 GBP to 0.8625 GBP, the result changes.' },
          ],
        },
      }),
      'fresh',
    ).display_analysis?.tipping_points;
    expect(t?.[0]).not.toHaveProperty('flip_point');
    expect(JSON.stringify(t)).not.toContain('0.8625');
  });

  it('CONTROL for the cage: the same shape with user-scale integers IS licensed', () => {
    // Proves the isolating test above fails for the CAGE and not because this
    // whole configuration is unlicensable.
    const t = packAt(
      enrichment({
        flip_thresholds: [{ ...PLOT_FLIP_ROW, value_scale: 'display' }],
      }),
      'fresh',
    ).display_analysis?.tipping_points;
    expect(t?.[0]?.flip_point).toBe('currently 40000 GBP; flips at 34500 GBP');
  });

  it('an explicit value_scale of "model" is REFUSED even when the values look user-scale', () => {
    const t = packAt(
      enrichment({ flip_thresholds: [{ ...PLOT_FLIP_ROW, value_scale: 'model' }] }),
      'fresh',
    ).display_analysis?.tipping_points;
    expect(t?.[0]).not.toHaveProperty('flip_point');
  });

  it('an UNRECOGNISED value_scale token is REFUSED (never guessed)', () => {
    const t = packAt(
      enrichment({ flip_thresholds: [{ ...PLOT_FLIP_ROW, value_scale: 'normalised' }] }),
      'fresh',
    ).display_analysis?.tipping_points;
    expect(t?.[0]).not.toHaveProperty('flip_point');
  });

  it('an explicit value_scale of "display" nested under margin_sensitivity is honoured', () => {
    const t = packAt(
      enrichment({
        flip_thresholds: [
          { ...PLOT_FLIP_ROW, margin_sensitivity: { movement: 'weakened', value_scale: 'display' } },
        ],
      }),
      'fresh',
    ).display_analysis?.tipping_points;
    expect(t?.[0]?.flip_point).toBe('currently 40000 GBP; flips at 34500 GBP');
  });

  it('the display strings must DESCRIBE these raw values — they come from a different array', () => {
    const t = packAt(
      enrichment({
        decision_review: {
          flip_thresholds: [
            { ...CARDED_FLIP_ROW, current_display: '12000 GBP', flip_display: '7800 GBP',
              narrative: 'If Marketing budget moves from 12000 GBP to 7800 GBP, the result changes.' },
          ],
        },
      }),
      'fresh',
    ).display_analysis?.tipping_points;
    expect(t?.[0]).not.toHaveProperty('flip_point');
    expect(JSON.stringify(t)).not.toContain('7800');
  });
});
