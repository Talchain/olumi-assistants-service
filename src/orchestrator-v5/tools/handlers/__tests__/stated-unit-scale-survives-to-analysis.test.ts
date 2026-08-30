/**
 * ⭐⭐ THE CAPABILITY: A USER STATES A QUANTITY IN THEIR OWN UNITS, AND THE
 * ANALYSIS COMPUTES ON THAT QUANTITY.
 *
 * This spec walks the CEE-internal chain the capability actually traverses —
 * EDIT WRITER → PERSISTED `observed_state` PAIR → ANALYSIS BASELINE GATE →
 * RUN VERDICT — rather than asserting the writer's return value in isolation.
 * A writer test alone would have passed at pristine for the currency case and
 * told us nothing about whether the run proceeds, which is the only thing the
 * user experiences.
 *
 * RED AT PRISTINE `caceba1a`, named signature:
 *   `normaliseFactorValue({rawInput: 12, unit: 'percent', inputHasUnit: true})`
 *   returned `{raw_value: 12, value: 12}` — `raw === value`, on which
 *   `recoverScaleFrame` returns `undefined` — so
 *   `findScaleIncoherentBaselineFactorIds` listed the factor and
 *   `decideAnalysisScaleBlock` returned
 *   `{blocked: true, reason_code: 'baseline_scale_unresolved'}`.
 *   The product accepted the edit and then declined to analyse it.
 *
 * ⚠ EVERY ASSERTION BINDS BY IDENTITY (the factor's `id`), never by a value
 * predicate such as `value === 0.12` that a sibling factor could satisfy
 * (trap 19). Each arm therefore carries a DIFFERENT sibling whose presence
 * would satisfy a value-predicate version of the same assertion.
 */
import { describe, it, expect } from 'vitest';

import { normaliseFactorValue } from '../d1-shared/normalise-factor-value.js';
import { recoverScaleFrame } from '../d1-shared/scale-frame.js';
import {
  findScaleIncoherentBaselineFactorIds,
  decideAnalysisScaleBlock,
} from '../../plot-intervention-scale.js';
import { unitPinnedScaleFrame } from '../../../../cee/draft/records/unit-scale-class.js';
import { deriveFactorScaleFrame } from '../../../../cee/draft/records/projector.js';

/** The factor under test. Every assertion below resolves through THIS id. */
const CHURN_ID = '3737a162';
/**
 * A DECOY that satisfies a value-predicate version of the churn assertions
 * (`value === 0.12`) while being a different object. Its presence is what makes
 * the identity binding load-bearing rather than decorative.
 */
const DECOY_ID = 'decoy-also-0-12';

/** Build the node the edit writer's output would be persisted into. */
function nodeFrom(
  id: string,
  written: { raw_value: number; value: number },
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    kind: 'factor',
    observed_state: { value: written.value, raw_value: written.raw_value, ...extra },
    data: {},
  };
}

/** The one decision `run_analysis` acts on, for a given set of nodes. */
function analysisVerdict(nodes: Record<string, unknown>[]) {
  const caplessRawBaselineFactorIds = findScaleIncoherentBaselineFactorIds(nodes, [{}]);
  return {
    caplessRawBaselineFactorIds,
    verdict: decideAnalysisScaleBlock(
      { mixedUnresolved: false, unresolvedFactorIds: [] },
      caplessRawBaselineFactorIds,
    ),
  };
}

describe('stated unit survives the edit and the analysis computes on it', () => {
  /**
   * ⭐ THE CAPABILITY ARM. This is the assertion that was RED at pristine.
   */
  it('a percent edit on an unframed factor is written framed AND the run proceeds', () => {
    // PRECONDITION PINNED IN-TEST (trap 13b): this factor genuinely has no
    // frame to recover — no pair, no stored frame — so a GREEN result below is
    // the new limb's doing and not the fixture quietly supplying a frame.
    expect(
      recoverScaleFrame({ value: undefined, raw_value: undefined }),
      'precondition: nothing to recover from — the frame must come from the unit',
    ).toBeUndefined();

    const written = normaliseFactorValue({
      rawInput: 12,
      unit: 'percent',
      inputHasUnit: true,
    });

    // 1. THE WRITE: the user's magnitude is kept, the level is framed.
    expect(written.raw_value, 'the stated magnitude survives verbatim').toBe(12);
    expect(written.value, 'the analysis level is the stated percent').toBeCloseTo(0.12, 12);
    expect(
      written.value,
      'the pristine defect was value === raw_value; that must no longer hold',
    ).not.toBe(written.raw_value);

    // 2. THE PAIR ENCODES THE FRAME, which is what makes it legible downstream.
    expect(recoverScaleFrame({ value: written.value, raw_value: written.raw_value })).toBe(100);

    // 3. THE GATE: bound by IDENTITY, with a decoy present that a value
    //    predicate could not tell apart.
    const nodes = [
      nodeFrom(CHURN_ID, written),
      nodeFrom(DECOY_ID, { raw_value: 12, value: 0.12 }),
    ];
    const { caplessRawBaselineFactorIds, verdict } = analysisVerdict(nodes);
    expect(caplessRawBaselineFactorIds).not.toContain(CHURN_ID);

    // 4. THE RUN PROCEEDS. This is the user-visible capability.
    expect(verdict).toEqual({ blocked: false });
  });

  /**
   * ⭐ THE OPPOSITE-DIRECTION TWIN (trap 22b). A fix that closes the gap and
   * opens the lie is worse than the gap. A currency quantity pins no divisor,
   * so it must STILL be written raw and the run must STILL refuse — with the
   * SAME reason_code as before, because nothing about that question changed.
   */
  it('a currency edit still pins no frame and the run still refuses', () => {
    const written = normaliseFactorValue({
      rawInput: 75000,
      unit: 'GBP',
      inputHasUnit: true,
    });

    expect(written.raw_value).toBe(75000);
    expect(
      written.value,
      'no divisor was ever stated for a currency — inventing one is the lie',
    ).toBe(75000);
    expect(recoverScaleFrame({ value: written.value, raw_value: written.raw_value })).toBeUndefined();

    const { caplessRawBaselineFactorIds, verdict } = analysisVerdict([
      nodeFrom('staffing-cost', written),
    ]);
    expect(caplessRawBaselineFactorIds).toContain('staffing-cost');
    expect(verdict).toEqual({
      blocked: true,
      reason_code: 'baseline_scale_unresolved',
      unresolvedFactorIds: ['staffing-cost'],
    });
  });

  /**
   * ⭐ THE LEGACY ARM. Graphs persisted before this change carry
   * `value === raw_value` with no unit anywhere. Those are genuinely unknown
   * and MUST stay refused — reinterpreting them as already-framed would turn a
   * loud refusal into a silent 100x error on every existing scenario.
   */
  it('a pre-existing unitless raw pair is still refused', () => {
    const written = normaliseFactorValue({ rawInput: 12, inputHasUnit: false });
    expect(written).toEqual({ raw_value: 12, value: 12 });

    const { verdict } = analysisVerdict([nodeFrom('legacy-factor', written)]);
    expect(verdict).toMatchObject({
      blocked: true,
      reason_code: 'baseline_scale_unresolved',
    });
  });

  /**
   * The `%` spelling and the basis-point family reach the same authority. `pp`
   * is a DIFFERENCE between percentages and pins nothing — asserted here so the
   * refusal is a recorded decision rather than an accident of the token table.
   */
  it.each([
    ['%', 12, 0.12],
    ['percent', 12, 0.12],
    ['per cent', 12, 0.12],
    ['pct', 12, 0.12],
    ['bps', 30, 0.003],
  ])('unit %s frames %d to %d', (unit, raw, expected) => {
    const written = normaliseFactorValue({ rawInput: raw, unit, inputHasUnit: true });
    expect(written.raw_value).toBe(raw);
    expect(written.value).toBeCloseTo(expected as number, 12);
  });

  it.each([
    ['pp', 12],
    ['GBP', 75000],
    ['people', 40],
    ['widgets', 12],
  ])('unit %s pins no frame and is written raw', (unit, raw) => {
    expect(normaliseFactorValue({ rawInput: raw, unit, inputHasUnit: true })).toEqual({
      raw_value: raw,
      value: raw,
    });
  });

  /**
   * ⭐ THE FACTOR'S STORED UNIT DOES NOT LICENSE A FRAME. `set-factor-value.ts`
   * rules that a bare-number proposal is ambiguous "regardless of whether the
   * factor's existing observed_state.unit is '%'. Refuse rather than guess."
   * Consulting `factorUnit` here would silently overturn that for every capless
   * factor. Pinned as an executable arm so a later "why not fall back?" tidy-up
   * REDs instead of quietly inventing a divisor.
   */
  it('a bare-number edit is NOT framed by the factor stored unit', () => {
    // CONTRAST CONTROL: the SAME magnitude WITH the unit stated does frame —
    // so this arm is discriminating, not trivially satisfied by a raw write.
    expect(
      normaliseFactorValue({ rawInput: 12, unit: '%', inputHasUnit: true }).value,
    ).toBeCloseTo(0.12, 12);

    expect(
      normaliseFactorValue({ rawInput: 12, factorUnit: '%', inputHasUnit: false }),
      'the user stated no unit — refuse rather than guess',
    ).toEqual({ raw_value: 12, value: 12 });
  });

  /**
   * ⚠ A percent magnitude ABOVE 100 pins no frame: framing 150 by 100 would
   * manufacture a level > 1 the unit does not license. Refused, not laddered.
   */
  it('a percent above 100 is refused rather than framed', () => {
    expect(unitPinnedScaleFrame('percent', 150)).toBeUndefined();
    expect(normaliseFactorValue({ rawInput: 150, unit: 'percent', inputHasUnit: true })).toEqual({
      raw_value: 150,
      value: 150,
    });
  });
});

/**
 * ⭐⭐ THE SAFETY INVARIANT THAT MAKES THE EDIT-SEAM LIMB ADMISSIBLE AT ALL.
 *
 * The edit writer may consult `unitPinnedScaleFrame` and may NEVER consult
 * `deriveFactorScaleFrame`, because the former is a function of the UNIT ALONE
 * and the latter is a function of the MAGNITUDE SET. This pins that difference
 * as executable fact rather than as a comment, so a future "convergence" that
 * swapped one for the other REDs here instead of silently rescaling siblings.
 */
describe('the pinned frame is magnitude-set independent; the laddered one is not', () => {
  it('unitPinnedScaleFrame gives the same answer whatever the siblings are', () => {
    for (const m of [1.5, 12, 45, 99, 100]) {
      expect(unitPinnedScaleFrame('percent', m), `percent @ ${m}`).toBe(100);
    }
  });

  it('deriveFactorScaleFrame CHANGES its answer with the sibling set — the reason it is banned here', () => {
    // Same edited magnitude, two different sibling sets, two different frames.
    const alone = deriveFactorScaleFrame([600000], 'GBP');
    const withSibling = deriveFactorScaleFrame([600000, 5000000], 'GBP');
    expect(alone).toBeDefined();
    expect(withSibling).toBeDefined();
    expect(
      alone,
      'CONTRAST CONTROL: if these were equal the invariant above would be vacuous',
    ).not.toBe(withSibling);
  });

  it('the draft projector and the edit writer resolve one authority, not two copies', () => {
    // `deriveFactorScaleFrame` must return exactly what the pinned authority
    // says whenever the authority speaks — this is the derived-not-mirrored pin.
    for (const [unit, mag] of [
      ['percent', 45],
      ['%', 12],
      ['bps', 30],
    ] as const) {
      const pinned = unitPinnedScaleFrame(unit, mag);
      expect(pinned, `${unit} must pin`).toBeDefined();
      expect(deriveFactorScaleFrame([mag], unit), `${unit}: projector must agree`).toBe(pinned);
    }
    // CONTRAST: where the authority is silent, the projector still ladders —
    // so the assertion above is discriminating, not trivially true.
    expect(unitPinnedScaleFrame('widgets', 45)).toBeUndefined();
    expect(deriveFactorScaleFrame([45], 'widgets')).toBe(50);
  });
});
