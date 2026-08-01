/**
 * ROADMAP 2.228 F1 — the decision_review enricher must derive
 * `flip_threshold_data` from the shape PLoT ACTUALLY EMITS.
 *
 * THE DEFECT THESE TESTS PIN (byte-verified at staging tip 6766b540):
 * `readFlipThresholdData` delegated to `collectFactorFlipEntries`, which walks
 * `results[].factor_sensitivity[].flip_threshold | flip_value`. That shape has
 * zero occurrences in the producer; the LIVE shape is the TOP-LEVEL
 * `enrichment.flip_thresholds[]` array that the coach path
 * (`../../context/analysis-signals.ts:deriveTippingPointsFromTopLevel`) has
 * been reading all along. Consequence: `flip_threshold_data` was `undefined`
 * on every live turn, `enrichment.decision_review.flip_thresholds` was
 * present-and-empty, and no flip card could ever fire.
 *
 * RED-FIRST: every `top-level` case below fails against the pre-fix enricher —
 * a realistic live enrichment yields NO flip_threshold_data at all.
 *
 * The fixture bytes are taken from two committed artefacts rather than
 * invented, so a producer shape change cannot leave these tests passing
 * against a shape nobody emits:
 *   - `tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`
 *     (a real staging turn: three rows, ALL `no_effect_within_bounds`)
 *   - `tests/fixtures/cross-service/plot-to-cee.doctrine-b.code-derived.json`
 *     (the found-flip row, carrying `margin_sensitivity.value_scale`)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildInvokeInputForTests } from '../decision-review-enricher.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const BRIEF = 'Do we engage an offshore partner or hire two senior engineers locally?';

/**
 * The minimum enrichment the enricher needs to reach the flip projection: a
 * winner it can name plus the graph label/unit maps. Deliberately carries NO
 * `results[].factor_sensitivity` — that is the dead shape, and its absence
 * here is what makes the top-level cases genuinely RED before the fix.
 */
function baseEnrichment(flipThresholds: unknown): Record<string, unknown> {
  return {
    graph: {
      nodes: [
        { id: 'opt_partner', kind: 'option', label: 'Engage Offshore Partner', data: {} },
        { id: 'opt_hire', kind: 'option', label: 'Hire Two Senior Engineers Locally', data: {} },
        { id: 'fac_budget', kind: 'factor', label: 'Hiring Budget', data: { unit: 'GBP' } },
        { id: 'fac_ramp', kind: 'factor', label: 'Ramp-up Time', data: { unit: 'weeks' } },
        { id: 'fac_eng_capacity', kind: 'factor', label: 'Engineering Capacity', data: {} },
      ],
      edges: [],
    },
    results: [
      { option_id: 'opt_partner', option_label: 'Engage Offshore Partner', win_probability: 0.61 },
      { option_id: 'opt_hire', option_label: 'Hire Two Senior Engineers Locally', win_probability: 0.39 },
    ],
    ...(flipThresholds === undefined ? {} : { flip_thresholds: flipThresholds }),
  };
}

function build(enrichment: Record<string, unknown>) {
  const input = buildInvokeInputForTests(BRIEF, enrichment, 'opt_partner');
  expect(input).not.toBeNull();
  return input!;
}

// ---------------------------------------------------------------------------
// The live shape — the defect
// ---------------------------------------------------------------------------

describe('2.228 F1 — flip_threshold_data derives from top-level enrichment.flip_thresholds', () => {
  it('RED-FIRST: a real flip pair on the top-level array reaches flip_threshold_data', () => {
    const input = build(
      baseEnrichment([
        {
          factor_id: 'fac_budget',
          factor_label: 'Hiring Budget',
          current_value: 250_000,
          flip_value: 320_000,
          direction: 'increase',
          unit: 'GBP',
          flip_reason: 'found',
          margin_sensitivity: { movement: 'weakened', value_scale: 'display' },
        },
      ]),
    );

    expect(input.flip_threshold_data).toBeDefined();
    expect(input.flip_threshold_data).toHaveLength(1);
    expect(input.flip_threshold_data![0]).toEqual({
      factor_id: 'fac_budget',
      factor_label: 'Hiring Budget',
      current_value: 250_000,
      flip_value: 320_000,
      direction: 'increase',
      unit: 'GBP',
    });
    expect(input._meta?.flip_threshold_count).toBe(1);
    expect(input._meta?.flip_threshold_source).toBe('top_level');
  });

  it('RED-FIRST: the REAL staging capture (all rows no_effect_within_bounds) is read, not ignored', () => {
    const turn = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'tests/fixtures/cross-service/v5-turn.run-analysis.staging.json'),
        'utf8',
      ),
    ) as { blocks: Array<{ enrichment?: { flip_thresholds?: unknown[] } }> };
    const rows = turn.blocks[0]?.enrichment?.flip_thresholds;
    // Guard the fixture itself: if the capture stops carrying the array, these
    // assertions would pass by testing nothing.
    expect(Array.isArray(rows)).toBe(true);
    expect(rows!.length).toBe(3);

    const input = build(baseEnrichment(rows));

    // Attested no-flip rows assert something real, but they are not flip
    // PAIRS — so no row is forwarded, and the count is honest about why.
    expect(input.flip_threshold_data).toBeUndefined();
    expect(input._meta?.flip_threshold_count).toBe(0);
    expect(input._meta?.flip_threshold_source).toBe('top_level');
    expect(input._meta?.flip_no_effect_count).toBe(3);
  });

  it('RED-FIRST: direction is DERIVED from the value delta, never copied from the row', () => {
    const input = build(
      baseEnrichment([
        {
          factor_id: 'fac_ramp',
          factor_label: 'Ramp-up Time',
          current_value: 8,
          flip_value: 5,
          // The producer row disagrees with its own numbers. The derived
          // value must win: the prompt quotes the numbers, not this string.
          direction: 'increase',
          unit: 'weeks',
          value_scale: 'display',
        },
      ]),
    );
    expect(input.flip_threshold_data![0]).toMatchObject({
      direction: 'decrease',
      current_value: 8,
      flip_value: 5,
    });
  });

  it('RED-FIRST: unit falls back to the graph node when the row omits it', () => {
    const input = build(
      baseEnrichment([
        { factor_id: 'fac_budget', current_value: 100, flip_value: 140, value_scale: 'display' },
      ]),
    );
    expect(input.flip_threshold_data![0]).toMatchObject({
      factor_id: 'fac_budget',
      factor_label: 'Hiring Budget', // from graph node label
      unit: 'GBP', // from graph node data.unit
    });
  });

  it('RED-FIRST: value_scale nested under margin_sensitivity is honoured (doctrine-b bytes)', () => {
    const doctrineB = JSON.parse(
      readFileSync(
        join(REPO_ROOT, 'tests/fixtures/cross-service/plot-to-cee.doctrine-b.code-derived.json'),
        'utf8',
      ),
    ) as { enrichment: { flip_thresholds: Array<Record<string, unknown>> } };
    const rows = doctrineB.enrichment.flip_thresholds;
    expect(rows).toHaveLength(1);
    expect((rows[0]!.margin_sensitivity as Record<string, unknown>).value_scale).toBe('display');

    const input = build(baseEnrichment(rows));
    expect(input.flip_threshold_data).toHaveLength(1);
    expect(input.flip_threshold_data![0]).toMatchObject({
      factor_id: 'fac_x',
      current_value: 12,
      flip_value: 8.5,
      direction: 'decrease',
      unit: '%',
    });
    expect(input._meta?.flip_scale_refused_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The scale cage
// ---------------------------------------------------------------------------

describe('2.228 F1 — a positively-attested non-display scale is refused', () => {
  it("RED-FIRST: value_scale:'model' rows are dropped and counted", () => {
    const input = build(
      baseEnrichment([
        {
          factor_id: 'fac_budget',
          factor_label: 'Hiring Budget',
          current_value: 0.5,
          flip_value: 0.8625,
          unit: 'GBP',
          // The two-numbers case: the prompt is told these are user units and
          // would write "0.8625 GBP" while the chip path renders £34,500.
          value_scale: 'model',
        },
        {
          factor_id: 'fac_ramp',
          factor_label: 'Ramp-up Time',
          current_value: 8,
          flip_value: 5,
          unit: 'weeks',
          value_scale: 'display',
        },
      ]),
    );
    expect(input.flip_threshold_data).toHaveLength(1);
    expect(input.flip_threshold_data![0]).toMatchObject({ factor_id: 'fac_ramp' });
    expect(input._meta?.flip_scale_refused_count).toBe(1);
    expect(input._meta?.flip_threshold_count).toBe(1);
  });

  it('RED-FIRST: an UNRECOGNISED value_scale token fails closed too', () => {
    const input = build(
      baseEnrichment([
        {
          factor_id: 'fac_budget',
          current_value: 100,
          flip_value: 140,
          value_scale: 'percent_of_cap',
        },
      ]),
    );
    expect(input.flip_threshold_data).toBeUndefined();
    expect(input._meta?.flip_scale_refused_count).toBe(1);
  });

  it('RED-FIRST: an ABSENT value_scale with OUT-OF-BAND values is admitted', () => {
    const input = build(
      baseEnrichment([{ factor_id: 'fac_budget', current_value: 100, flip_value: 140 }]),
    );
    expect(input.flip_threshold_data).toHaveLength(1);
    expect(input._meta?.flip_scale_refused_count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // #784 review amendment 2 — the disclosed residual, closed.
  // -------------------------------------------------------------------------

  it('RED-FIRST (hazard): absent scale + a UNIT + an in-band value is REFUSED — the live "0.3 engineers" row', () => {
    // The exact shape of row 0 of the committed staging capture, given the
    // flip value the F3 mapping will supply. Absent `value_scale` is the
    // ORDINARY PLoT emission (only `source === 'explicit_cap'` is stamped
    // 'display'), so without this gate the prompt quotes "0.3 engineers".
    const input = build(
      baseEnrichment([
        {
          factor_id: 'fac_eng_capacity',
          factor_label: 'Engineering Capacity',
          current_value: 0.3,
          flip_value: 0.55,
          unit: 'engineers',
        },
      ]),
    );
    expect(input.flip_threshold_data).toBeUndefined();
    expect(input._meta?.flip_scale_refused_count).toBe(1);
    expect(input._meta?.flip_threshold_count).toBe(0);
  });

  it('RED-FIRST (hazard): EITHER value in band is enough — an out-of-band flip does not rescue an in-band current', () => {
    // Requiring BOTH values in band would leave the hazard open whenever the
    // flip landed above 1: "0.3 engineers" would still reach the prompt.
    const input = build(
      baseEnrichment([
        {
          factor_id: 'fac_eng_capacity',
          factor_label: 'Engineering Capacity',
          current_value: 0.3,
          flip_value: 4,
          unit: 'engineers',
        },
      ]),
    );
    expect(input.flip_threshold_data).toBeUndefined();
    expect(input._meta?.flip_scale_refused_count).toBe(1);
  });

  it('the gate does NOT delete the prompt\'s probability case: UNITLESS in-band rows stay admitted', () => {
    // `Prompts/canonical/decision_review.txt:416` — case 2 is gated on "The
    // value carries no unit". fac_seniority has no unit on the row and none on
    // its graph node, so this pair must survive.
    const input = build(
      baseEnrichment([
        {
          factor_id: 'fac_seniority',
          factor_label: 'Engineering Seniority',
          current_value: 0.35,
          flip_value: 0.62,
        },
      ]),
    );
    expect(input.flip_threshold_data).toHaveLength(1);
    expect(input.flip_threshold_data![0]).toMatchObject({
      factor_id: 'fac_seniority',
      current_value: 0.35,
      flip_value: 0.62,
    });
    expect(input.flip_threshold_data![0]).not.toHaveProperty('unit');
    expect(input._meta?.flip_scale_refused_count).toBe(0);
  });

  it('an explicit value_scale:"display" beats the band heuristic — a stamped row is never second-guessed', () => {
    const input = build(
      baseEnrichment([
        {
          factor_id: 'fac_eng_capacity',
          factor_label: 'Engineering Capacity',
          current_value: 0.3,
          flip_value: 0.55,
          unit: 'engineers',
          value_scale: 'display',
        },
      ]),
    );
    expect(input.flip_threshold_data).toHaveLength(1);
    expect(input._meta?.flip_scale_refused_count).toBe(0);
  });

  // -------------------------------------------------------------------------
  // #784 review amendment 3 — pin the NESTED value_scale lookup.
  // -------------------------------------------------------------------------

  it('RED-FIRST (M7 pin): a NESTED margin_sensitivity.value_scale:"normalised" refuses the row', () => {
    // The nested location is the one the PLoT build that introduced the signal
    // actually emits, and it was previously unpinned in the refusal direction:
    // deleting the `margin_sensitivity` lookup from `readRowValueScale` passed
    // the entire required suite. This row is deliberately UNITLESS and
    // OUT-OF-BAND so that neither the unit rule nor the band rule can catch it
    // — the nested lookup is the only thing standing between it and the prompt.
    const input = build(
      baseEnrichment([
        {
          factor_id: 'fac_live',
          factor_label: 'Live Factor',
          current_value: 3,
          flip_value: 9,
          margin_sensitivity: { movement: 'weakened', value_scale: 'normalised' },
        },
      ]),
    );
    expect(input.flip_threshold_data).toBeUndefined();
    expect(input._meta?.flip_scale_refused_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Precedence between the live shape and the legacy nested shape
// ---------------------------------------------------------------------------

describe('2.228 F1 — top-level presence is authoritative', () => {
  const NESTED_ONLY = {
    graph: { nodes: [{ id: 'fac_legacy', kind: 'factor', label: 'Legacy Factor', data: {} }], edges: [] },
    results: [
      {
        option_id: 'opt_partner',
        option_label: 'Engage Offshore Partner',
        win_probability: 0.61,
        factor_sensitivity: [
          { factor_id: 'fac_legacy', factor_label: 'Legacy Factor', current_value: 10, flip_threshold: 20 },
        ],
      },
      { option_id: 'opt_hire', option_label: 'Hire Two Senior Engineers Locally', win_probability: 0.39 },
    ],
  };

  it('legacy nested rows still project when the top-level key is ABSENT', () => {
    const input = build({ ...NESTED_ONLY });
    expect(input.flip_threshold_data).toHaveLength(1);
    expect(input.flip_threshold_data![0]).toMatchObject({ factor_id: 'fac_legacy', flip_value: 20 });
    expect(input._meta?.flip_threshold_source).toBe('nested_legacy');
  });

  it('RED-FIRST: a PRESENT-BUT-EMPTY top-level array wins — no silent fallback to the dead shape', () => {
    const input = build({ ...NESTED_ONLY, flip_thresholds: [] });
    expect(input.flip_threshold_data).toBeUndefined();
    expect(input._meta?.flip_threshold_source).toBe('top_level');
    expect(input._meta?.flip_threshold_count).toBe(0);
  });

  it('RED-FIRST: a PRESENT top-level array wins over disagreeing nested rows', () => {
    const input = build({
      ...NESTED_ONLY,
      flip_thresholds: [
        { factor_id: 'fac_live', factor_label: 'Live Factor', current_value: 3, flip_value: 9 },
      ],
    });
    expect(input.flip_threshold_data).toHaveLength(1);
    expect(input.flip_threshold_data![0]).toMatchObject({ factor_id: 'fac_live' });
    expect(input._meta?.flip_threshold_source).toBe('top_level');
  });

  it('no flip data from either shape reports source "none"', () => {
    const input = build(baseEnrichment(undefined));
    expect(input.flip_threshold_data).toBeUndefined();
    expect(input._meta?.flip_threshold_source).toBe('none');
    expect(input._meta?.flip_no_effect_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rows that assert nothing are projected as nothing
// ---------------------------------------------------------------------------

describe('2.228 F1 — unusable rows are dropped without being counted as no-flip', () => {
  it('RED-FIRST: flip_value null with NO flip_reason is neither forwarded nor counted as attested', () => {
    const input = build(
      baseEnrichment([
        { factor_id: 'fac_budget', factor_label: 'Hiring Budget', current_value: 100, flip_value: null },
        { factor_id: 'fac_ramp', factor_label: 'Ramp-up Time', current_value: 8, flip_value: null, flip_reason: 'no_effect_within_bounds' },
      ]),
    );
    expect(input.flip_threshold_data).toBeUndefined();
    expect(input._meta?.flip_no_effect_count).toBe(1);
    expect(input._meta?.flip_threshold_count).toBe(0);
  });

  it('RED-FIRST: rows without a true factor_id are dropped (a label is never promoted to an id)', () => {
    const input = build(
      baseEnrichment([
        { factor_label: 'No Id Here', current_value: 100, flip_value: 140 },
        { factor_id: 'fac_budget', current_value: 100, flip_value: 140 },
      ]),
    );
    expect(input.flip_threshold_data).toHaveLength(1);
    expect(input.flip_threshold_data![0]).toMatchObject({ factor_id: 'fac_budget' });
  });

  it('RED-FIRST: duplicate factor_ids dedupe to the first occurrence', () => {
    const input = build(
      baseEnrichment([
        { factor_id: 'fac_budget', factor_label: 'First', current_value: 100, flip_value: 140 },
        { factor_id: 'fac_budget', factor_label: 'Second', current_value: 200, flip_value: 240 },
      ]),
    );
    expect(input.flip_threshold_data).toHaveLength(1);
    expect(input.flip_threshold_data![0]).toMatchObject({ factor_label: 'First', current_value: 100 });
  });
});
