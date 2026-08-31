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
import { checkPairCoherence, recoverScaleFrame, resolveScaleFrame } from '../d1-shared/scale-frame.js';
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
   * ⭐⭐ THE OPPOSITE-DIRECTION TWIN FOR THE SUB-1 CLASS — the arm whose absence
   * let a 100× move ship silently.
   *
   * This class is LIVE in this repo, not hypothetical:
   * `compound-goal/extractor.ts:704-709` stores `"4%"` as
   * `{value: 0.04, unit: '%'}`, so a model editing such a factor and mirroring
   * the number it can see emits `{rawInput: 0.06, unit: '%'}`.
   *
   * MEASURED at base `caceba1a`: `{raw_value: 0.06, value: 0.06}`.
   * MEASURED at the unbounded head `853ec1b5`: `{raw_value: 0.06, value: 0.0006}`.
   * The analysis gate blocks NEITHER pair — so the number simply moved by 100×
   * with no refusal on either side of the change, which is the worst available
   * shape: silent, confident and wrong on one of the two live readings.
   *
   * This arm pins the write back to the BASE behaviour. Note what that means
   * for the merge rule: this direction is a LIE risk, not a GAP — nothing that
   * analysed before stops analysing, so restoring it costs the user nothing.
   */
  it('a sub-1 percent edit is written unchanged and the run is unaffected', () => {
    const written = normaliseFactorValue({ rawInput: 0.06, unit: '%', inputHasUnit: true });

    expect(written.raw_value, 'the stated magnitude survives verbatim').toBe(0.06);
    expect(
      written.value,
      'the number must NOT be divided by 100 — under this repo own extractor convention it is already a level',
    ).toBe(0.06);
    expect(written.value, 'and specifically NOT the 0.0006 the unbounded limb produced').not.toBe(
      0.0006,
    );

    // THE RUN IS UNAFFECTED — bound by IDENTITY, with a decoy present.
    const SUBONE_ID = 'sub-one-churn';
    const { caplessRawBaselineFactorIds, verdict } = analysisVerdict([
      nodeFrom(SUBONE_ID, written),
      nodeFrom(DECOY_ID, { raw_value: 0.06, value: 0.06 }),
    ]);
    expect(caplessRawBaselineFactorIds).not.toContain(SUBONE_ID);
    expect(verdict).toEqual({ blocked: false });

    // CONTRAST CONTROL: the SAME unit ABOVE the bound still frames, so this arm
    // is a bound and not a blanket refusal of the capability.
    expect(
      normaliseFactorValue({ rawInput: 12, unit: '%', inputHasUnit: true }).value,
    ).toBeCloseTo(0.12, 12);
  });

  /**
   * ⭐⭐ "NO SCALE WAS RECORDED" IS NOT "A SCALE WAS RECORDED AND IT IS
   * INCOMPATIBLE" — the conflation a sibling PR (#1230) was closed for, whose
   * root-cause insight this arm is now the only home for.
   *
   * `resolveScaleFrame` collapses BOTH states to `undefined`. Reading only that
   * collapsed answer let the stated unit OVERRIDE a recorded frame the code had
   * just refused to trust: measured at head `853ec1b5`, a "12 percent" edit on
   * `{storedFrame: 5, value: 7, raw_value: 7}` (`incoherent`) was written
   * `{12, 0.12}`. A contradicted frame is POSITIVE EVIDENCE of corruption, and
   * its siblings were framed by whatever the real frame was — so a unit-pinned
   * level there is not comparable to them.
   *
   * `checkPairCoherence` is three-valued and only `incoherent` suppresses, which
   * is what keeps this from re-closing the gap: see the contrast control.
   */
  it('a CONTRADICTED recorded frame suppresses the pinned limb; a merely ABSENT one does not', () => {
    const CONTRADICTED = { storedFrame: 5, value: 7, raw_value: 7 };

    // PRECONDITION PINNED IN-TEST (trap 13b): this fixture really is the
    // incoherent state, and the resolver really does collapse it to `undefined`
    // — so a GREEN result below is the new guard's doing, not the fixture
    // failing to reproduce the condition.
    expect(checkPairCoherence(CONTRADICTED), 'precondition: this pair contradicts its frame').toBe(
      'incoherent',
    );
    expect(
      resolveScaleFrame(CONTRADICTED),
      'precondition: the resolver collapses contradiction to the same undefined as absence',
    ).toBeUndefined();

    const onContradicted = normaliseFactorValue({
      rawInput: 12,
      unit: 'percent',
      inputHasUnit: true,
      factorUnit: 'percent',
      factorScaleFrame: 5,
      factorObservedValue: 7,
      factorObservedRawValue: 7,
    });

    expect(
      onContradicted,
      'the stated unit must not overturn a recorded frame the code refused to trust',
    ).toEqual({ raw_value: 12, value: 12 });

    // AND THE GATE STILL REFUSES IT, loudly — bound by identity.
    const CORRUPT_ID = 'corrupt-frame-factor';
    const { caplessRawBaselineFactorIds, verdict } = analysisVerdict([
      nodeFrom(CORRUPT_ID, onContradicted),
    ]);
    expect(caplessRawBaselineFactorIds).toContain(CORRUPT_ID);
    expect(verdict).toMatchObject({
      blocked: true,
      reason_code: 'baseline_scale_unresolved',
    });

    // ⭐ CONTRAST CONTROL — THE DISCRIMINATION, without which the guard above
    // would be indistinguishable from a blanket that re-closed the capability.
    // A factor with NO pair is `not_checkable`, NOT `incoherent`, and still
    // reaches the pinned limb.
    expect(
      checkPairCoherence({ storedFrame: undefined, value: undefined, raw_value: undefined }),
      'absence must classify differently from contradiction',
    ).toBe('not_checkable');
    expect(
      normaliseFactorValue({ rawInput: 12, unit: 'percent', inputHasUnit: true }),
      'the capability arm must be untouched by the contradiction guard',
    ).toEqual({ raw_value: 12, value: 0.12 });
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

  /**
   * ⭐⭐ THE ONE-AUTHORITY PIN, OVER A CORPUS THAT INCLUDES THE CLASS THE
   * ORIGINAL VERSION EXCLUDED.
   *
   * ⚠ WHY THIS TEST WAS REWRITTEN RATHER THAN EXTENDED. Its first version
   * iterated `{45, 12, 30}` and asserted `pinned === derive([m], unit)`. Both
   * halves were wrong for the same reason: the corpus contained only
   * magnitudes `> 1`, and `>` is exactly where the two authorities agreed. On
   * `m ∈ (0, 1]` the pinned authority returned 100 while the projector returned
   * `undefined` — so the guard carrying the change's central argument PASSED
   * while the property it named FAILED (trap 22: the corpus shared the code's
   * asymmetry). Adding a case would have left the equality claim overstated;
   * the CLAIM had to change too.
   *
   * The invariant asserted here is the one the code actually honours, over the
   * whole domain — **NEVER CONTRADICTS, MAY ABSTAIN**:
   *
   *     pinned === undefined  ||  pinned === deriveFactorScaleFrame([m], unit)
   *
   * Abstention is the safe direction at an edit seam, so the disjunction is not
   * a weakening — it is the honest shape of a guard that must never hand back a
   * frame the draft pipeline would not have written.
   *
   * ⚠ NON-FINITE MAGNITUDES ARE INCLUDED — AND THIS SENTENCE REPLACES ITS OWN
   * OPPOSITE, which is the point. It first read "deliberately EXCLUDED, because
   * `nextNiceNumberAbove` INFINITE-LOOPS on `NaN`/`Infinity`, so a differential
   * that fed them would hang rather than fail". That was true at this branch's
   * base `caceba1a` and it is FALSE at the merged tip: `staging` landed a domain
   * fix (`nextNiceNumberAbove` now returns `number | undefined`, refuses
   * non-finite and non-positive input, and bounds both walks), so the hazard
   * that justified the exclusion is gone. Re-derived after the merge rather than
   * inherited — a dependent claim survives its premise only by accident.
   */
  it('the two authorities never contradict, across a corpus that spans the sub-1 class', () => {
    const UNITS = ['percent', '%', 'per cent', 'pct', 'percentage', 'bps', 'basis points',
      '% NRR', 'pp', 'GBP', 'widgets', 'fraction'] as const;
    // ⭐ SPANS (0,1] — the class the previous corpus excluded — plus the
    //   agreeing band, the pinned bounds, and above them.
    const MAGS = [0, 0.0001, 0.04, 0.3, 0.5, 0.9, 0.999, 1, 1.0001, 1.5, 12, 45, 99, 100,
      100.001, 150, 4500, 9999, 10000, 10001, 123456,
      // Non-finite and negative — reachable here only because `staging`'s
      // domain fix made `nextNiceNumberAbove` total. Both authorities must
      // abstain rather than diverge.
      -30, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY] as const;

    let checked = 0;
    let abstentions = 0;
    let agreements = 0;
    for (const unit of UNITS) {
      for (const m of MAGS) {
        const pinned = unitPinnedScaleFrame(unit, m);
        checked += 1;
        if (pinned === undefined) {
          abstentions += 1;
          continue;
        }
        agreements += 1;
        expect(
          deriveFactorScaleFrame([m], unit),
          `${unit} @ ${m}: the pinned authority spoke, so the projector must say the same`,
        ).toBe(pinned);
      }
    }

    // THE CORPUS PINS ITS OWN SIZE (trap: a loop that silently iterates nothing
    // asserts nothing).
    expect(checked, 'corpus size').toBe(UNITS.length * MAGS.length);
    expect(checked).toBe(300);
    // AND ITS OWN DISCRIMINATION: both outcomes must actually occur, or the
    // invariant is satisfied vacuously by one branch.
    expect(agreements, 'the authority must SPEAK somewhere').toBeGreaterThan(0);
    expect(abstentions, 'the authority must ABSTAIN somewhere').toBeGreaterThan(0);
  });

  /**
   * ⭐⭐ THE SUB-1 ARM, NAMED RATHER THAN LEFT TO AN UNBOUNDED PREDICATE.
   *
   * A `%` value in `(0, 1]` is genuinely TWO states in this estate and nothing
   * at this seam can tell them apart:
   *   · `compound-goal/extractor.ts:704-709` stores `"4%"` as
   *     `{value: 0.04, unit: '%'}` — the number IS ALREADY a level;
   *   · a user stating "0.5 percent", where the true level is 0.005.
   * Framing it would be a silent 100× on the first reading. So the authority
   * ABSTAINS and the decision stays with the analysis seam.
   */
  it('a percent magnitude at or below 1 pins NOTHING, exactly as the projector does', () => {
    for (const m of [0.0001, 0.04, 0.3, 0.5, 0.9, 0.999, 1]) {
      expect(unitPinnedScaleFrame('percent', m), `percent @ ${m} must abstain`).toBeUndefined();
      expect(
        deriveFactorScaleFrame([m], 'percent'),
        `projector @ ${m}: the two must abstain together`,
      ).toBeUndefined();
      expect(unitPinnedScaleFrame('bps', m), `bps @ ${m} must abstain`).toBeUndefined();
    }
    // CONTRAST CONTROL, immediately above the bound: the abstention is a BOUND,
    // not a blanket that would have re-closed the gap this PR exists to open.
    expect(unitPinnedScaleFrame('percent', 1.0001), 'just above 1 must still pin').toBe(100);
    expect(unitPinnedScaleFrame('percent', 12)).toBe(100);
    // Non-finite and negative are refused directly, and the projector abstains
    // on them too since `staging`'s domain fix made `nextNiceNumberAbove` total.
    for (const m of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -30]) {
      expect(unitPinnedScaleFrame('percent', m), `percent @ ${m}`).toBeUndefined();
      expect(deriveFactorScaleFrame([m], 'percent'), `projector @ ${m}`).toBeUndefined();
    }
  });
});
