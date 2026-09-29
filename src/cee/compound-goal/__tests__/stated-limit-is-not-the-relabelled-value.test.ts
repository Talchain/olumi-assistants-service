/**
 * ⭐⭐⭐ THE LIMIT A READER TYPED MUST NOT BE SHOWN AT A HUNDREDTH OF ITS SIZE.
 *
 * A reader writes *"keep monthly churn under 4%"*. The canvas showed them
 * **"≤ 0.04%"**.
 *
 * ⛔ THE MECHANISM, AND IT IS A TRAP-21 SHAPE — TWO QUESTIONS UNDER ONE NAME.
 * `normaliseConstraintUnits` fires only when `unit === '%'` and
 * `0 < |value| < 1`, i.e. ONLY when the value is ALREADY a fraction. It then
 * relabels the unit `'%' -> 'fraction'` and leaves the value untouched. So the
 * `original_value` it stamped was, BY CONSTRUCTION OF ITS OWN GUARD, always the
 * post-relabel fraction and never the figure the reader stated.
 *
 * The field answers *"what was this value before my relabel ran?"*. Every
 * declared consumer reads it as *"what did the reader actually state?"*:
 *
 *   - `@talchain/schemas@0.55.0` `dist/fixtures/index.js` exemplifies the field
 *     as `{ rule: 'percent_to_fraction', original_value: 15, original_unit: '%' }`
 *     — a whole-number percent, which this producer's guard can never emit.
 *   - the UI's `canvas/utils/goalConstraintText.ts` states it outright:
 *     *"`original_value` is the number the reader actually stated — 110, not
 *     1.1"*, and its read path OUTRANKS the `source_quote` fallback.
 *
 * ⚠ SO THE STAMP DID NOT MERELY MISLEAD — IT SUPPRESSED THE HONEST RENDERING.
 * With the stamp absent, `unit: 'fraction'` puts the row in the UI's
 * rewritten-scale set and the card quotes the reader's own sentence. The false
 * stamp outranked that and printed a number 100x too small instead.
 *
 * ⭐ THE REMEDY IS NOT ARITHMETIC. Multiplying by 100 is refused at the
 * consumer in terms this producer must respect
 * (`goalConstraintText.ts`): *"THE FIX IS NOT TO MULTIPLY BY 100 ... the exact
 * mechanism behind the 100x defect ... **Never infer scale from magnitude.**"*
 * The stated figure is not recoverable at this function: the model has already
 * emitted `0.04`, and only `sourceQuote` still contains the reader's "4" — as
 * TEXT. Recovering it would be a natural-language magnitude predicate, the
 * class this estate has repeatedly failed to bound (traps 22/22b/22f).
 *
 * So this producer STOPS MAKING THE CLAIM, and states only what it knows: the
 * unit LABEL was rewritten and the value was NOT changed.
 *
 * Every absence assertion below carries a CONTRAST CONTROL that must FIRE, so a
 * vacuous pass is distinguishable from a real absence (trap 13).
 */
import { describe, expect, it } from 'vitest';

import { DraftGoalConstraintSchema } from '@talchain/schemas/boundary';

import {
  normaliseConstraintUnits,
  toGoalConstraints,
  type ExtractedGoalConstraint,
} from '../extractor.js';
import { GoalConstraintSchema } from '../../../schemas/assist.js';

/**
 * The reader's sentence, and what the model emits for it. The "4" survives only
 * inside `sourceQuote`; `value` is already the fraction by the time any of this
 * runs, which is the whole reason `original_value` could never be truthful.
 */
const churnCeiling = (overrides: Partial<ExtractedGoalConstraint> = {}): ExtractedGoalConstraint =>
  ({
    targetName: 'monthly churn',
    targetNodeId: 'fac_monthly_churn',
    operator: '<=',
    value: 0.04,
    unit: '%',
    label: 'Keep monthly churn at or below 4%',
    sourceQuote: 'while keeping monthly churn under 4%',
    confidence: 0.85,
    provenance: 'explicit',
    valueFrame: 'level',
    ...overrides,
  }) as ExtractedGoalConstraint;

type Stamped = Record<string, unknown>;

describe("the limit a reader typed is not restamped as the relabelled machine value", () => {
  it('does NOT claim a stated figure it cannot know — "4%" case', () => {
    const [row] = normaliseConstraintUnits([churnCeiling()]) as unknown as Stamped[];

    // PRECONDITION PINNED IN-TEST (trap 13b): the rule must actually have
    // fired, or "no audit stamp" would pass on a row that was never rewritten
    // and this test would assert nothing at all.
    expect(row.unit).toBe('fraction');
    expect(row.value).toBe(0.04);

    expect(row.provenance_unit_normalised).toBeUndefined();
  });

  it('CONTRAST CONTROL — the absence above is real, not a blind probe', () => {
    // The same read on the same shape returns a PRESENT object for the field
    // this producer does stamp. If this fires and the assertion above passes,
    // the absence is the code's doing rather than the probe's.
    const [row] = normaliseConstraintUnits([churnCeiling()]) as unknown as Stamped[];
    expect(row.provenance_unit_relabelled).toBeDefined();
  });

  it('states only what it knows: the unit label was rewritten, the value was not', () => {
    const [row] = normaliseConstraintUnits([churnCeiling()]) as unknown as Stamped[];
    expect(row.unit).toBe('fraction'); // precondition

    expect(row.provenance_unit_relabelled).toEqual({
      rule: 'percent_label_to_fraction_label',
      pre_normalisation_value: 0.04,
      pre_normalisation_unit: '%',
    });
  });

  /**
   * ⭐ WRITTEN AGAINST THE SPEC, NOT AGAINST THE CASE IN HAND (trap 13d).
   *
   * The guard is `unit === '%' && 0 < |value| < 1` and is SIGN-AGNOSTIC on
   * purpose (ROADMAP 1.52 — a reduction constraint's value is negative by
   * design). A corpus of only positive churn ceilings would share the blind
   * spot of the code it tests, so the window is walked at both signs and at
   * both edges of the band.
   *
   * The invariant is the one the consumers actually enforce: NO field this
   * producer emits may present the post-relabel machine value under a name a
   * reader-facing consumer renders as the stated figure.
   */
  it('over the WHOLE guard window, no stamp presents the machine value as the stated figure', () => {
    const window = [0.04, 0.5, 0.95, 0.999, 1e-6, -0.04, -0.15, -0.999];

    for (const value of window) {
      const [row] = normaliseConstraintUnits([
        churnCeiling({ value, sourceQuote: `stated ${value * 100}%` }),
      ]) as unknown as Stamped[];

      // precondition: this value really is inside the window the rule fires in
      expect(row.unit, `guard did not fire for ${value}`).toBe('fraction');

      expect(row.provenance_unit_normalised, `stated-figure claim emitted for ${value}`).toBeUndefined();

      const relabelled = row.provenance_unit_relabelled as Record<string, unknown>;
      expect(relabelled, `no relabel audit for ${value}`).toBeDefined();

      // ⛔ THE PAIR MOVES TOGETHER. `original_unit` carries the same
      // two-questions-one-name defect as its twin, and the consumer appends
      // '%' on a percent unit — so a surviving unit rebuilds `≤ 0.04%` at the
      // next consumer that pairs it with the value. NEITHER member may appear,
      // on the row or on the stamp.
      for (const key of ['original_value', 'original_unit'] as const) {
        expect(relabelled[key], `stamp carries reader-stated ${key} for ${value}`).toBeUndefined();
        expect(row[key], `row carries reader-stated ${key} for ${value}`).toBeUndefined();
      }

      // The audit number is THIS RULE'S INPUT, and is provably the machine
      // value rather than a stated figure: it equals the row's own value.
      expect(relabelled.pre_normalisation_value, `audit value drifted for ${value}`).toBe(row.value);
      expect(relabelled.pre_normalisation_unit).toBe('%');
    }
  });

  it('CONTRAST CONTROL — a row the rule does not touch carries neither stamp', () => {
    // By-presence, and never defaulted: absent means "no rewrite happened",
    // which is a different fact from "a rewrite happened and was lost".
    const [row] = normaliseConstraintUnits([
      churnCeiling({ value: 50000, unit: '£', sourceQuote: 'under £50,000' }),
    ]) as unknown as Stamped[];

    expect(row.unit).toBe('£'); // precondition: the rule really did not fire
    expect(row.provenance_unit_relabelled).toBeUndefined();
    expect(row.provenance_unit_normalised).toBeUndefined();
  });

  it('a value already in percentage points (>= 1) is untouched and unstamped', () => {
    // The 110% case named in the UI's comment: `1.1` sits OUTSIDE the window
    // and deciding what it means is a semantic judgement, not a carrier fix.
    const [row] = normaliseConstraintUnits([
      churnCeiling({ value: 1.1, unit: '%', operator: '>=' }),
    ]) as unknown as Stamped[];

    expect(row.unit).toBe('%');
    expect(row.value).toBe(1.1);
    expect(row.provenance_unit_relabelled).toBeUndefined();
    expect(row.provenance_unit_normalised).toBeUndefined();
  });

  describe('the honest stamp reaches the wire, and the false one is gone from it', () => {
    const wireRow = (): Stamped => {
      const normalised = normaliseConstraintUnits([churnCeiling()]);
      expect(normalised[0].unit).toBe('fraction'); // precondition
      const [wire] = toGoalConstraints(normalised);
      return wire as unknown as Stamped;
    };

    it('toGoalConstraints projects the relabel audit and no stated-figure claim', () => {
      const wire = wireRow();
      expect(wire.provenance_unit_relabelled).toEqual({
        rule: 'percent_label_to_fraction_label',
        pre_normalisation_value: 0.04,
        pre_normalisation_unit: '%',
      });
      expect(wire.provenance_unit_normalised).toBeUndefined();
    });

    it("POSITIVE CONTROL — CEE's own schema really does strip an undeclared field", () => {
      // Without this, "the field survived the parse" proves nothing about the
      // declaration: it would also pass if the schema stripped nothing.
      const parsed = GoalConstraintSchema.parse({
        ...wireRow(),
        a_field_no_producer_will_ever_declare: 'sentinel',
      }) as Stamped;
      expect(parsed.a_field_no_producer_will_ever_declare).toBeUndefined();
    });

    it('survives GoalConstraintSchema — it is declared, not passed through by luck', () => {
      const parsed = GoalConstraintSchema.parse(wireRow()) as Stamped;
      expect(parsed.provenance_unit_relabelled).toEqual({
        rule: 'percent_label_to_fraction_label',
        pre_normalisation_value: 0.04,
        pre_normalisation_unit: '%',
      });
    });

    it('satisfies the published egress contract rather than a local restatement of it', () => {
      // Bound to the pinned package, so a future stricter pin REDs here instead
      // of turning every percent constraint into an EGRESS_CONTRACT_VIOLATION
      // on the deployed wire.
      const parsed = DraftGoalConstraintSchema.parse(wireRow()) as Stamped;
      expect(parsed.provenance_unit_relabelled).toBeDefined();
      expect(parsed.provenance_unit_normalised).toBeUndefined();
    });
  });
});
