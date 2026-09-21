/**
 * ⭐ THE PERCENT→FRACTION AUDIT TRAIL IS MINTED AND THEN SILENTLY DELETED.
 *
 * `normaliseConstraintUnits` (cee/compound-goal/extractor.ts:2088) stamps
 * `provenance_unit_normalised` whenever it rewrites a percent to a fraction,
 * and `toGoalConstraints` (:2120) carries it forward EXPLICITLY — a
 * by-presence projection written precisely so the field is not lost.
 *
 * `GoalConstraintSchema` never declared it. That object is a plain `z.object`
 * whose own closing comment reads "CIL Phase 1: strip unknown fields", so the
 * stamp is deleted at the first parse hop with no error anywhere.
 *
 * ⚠⚠ THIS IS THE DEFECT THE FILE ALREADY WARNS ABOUT, ONE FIELD OVER. Eight
 * lines above the gap, `value_frame`'s own docblock says:
 *
 *   "THIS DECLARATION IS LOAD-BEARING, NOT DOCUMENTATION. This object is a
 *    plain z.object ... so an undeclared `value_frame` is SILENTLY DELETED at
 *    every parse hop between the mint site and the PLoT payload, and the stamp
 *    would reach nothing with no error anywhere."
 *
 * The warning was written, `value_frame` was declared, and its SIBLING was
 * not. Knowing the class is not protection against committing it — so this
 * spec pins the sibling rather than trusting the prose.
 *
 * Reported by the Canvas lane, who measured `provenance_unit_normalised` in 0
 * files of the UI repo against a `source_quote` contrast of 28. That sweep was
 * of the CONSUMER and proves the UI does not read the field; it could not have
 * shown whether CEE emits it. CEE does emit it. It just never arrives.
 *
 * Every assertion carries a POSITIVE CONTROL proving the strip mechanism is
 * real and active at this tip (trap 13: a survival claim must first prove it
 * can see the opposite).
 */
import { describe, expect, it } from 'vitest';

import { GoalConstraintSchema } from '../assist.js';
import {
  normaliseConstraintUnits,
  toGoalConstraints,
} from '../../cee/compound-goal/extractor.js';

const mintedConstraint = () => ({
  constraint_id: 'gc-1',
  node_id: 'n1',
  operator: '<=' as const,
  value: 0.05,
  unit: 'fraction',
  value_frame: 'level' as const,
  provenance_unit_normalised: {
    rule: 'percent_to_fraction',
    original_value: 0.05,
    original_unit: '%',
  },
});

describe('the unit-normalisation audit trail survives GoalConstraintSchema', () => {
  it('POSITIVE CONTROL — the schema really does strip an undeclared field', () => {
    const parsed = GoalConstraintSchema.parse({
      ...mintedConstraint(),
      a_field_no_producer_will_ever_declare: 'sentinel',
    }) as Record<string, unknown>;
    expect(parsed.a_field_no_producer_will_ever_declare).toBeUndefined();
  });

  it('CONTRAST CONTROL — value_frame survives, because it IS declared', () => {
    const parsed = GoalConstraintSchema.parse(mintedConstraint());
    expect(parsed.value_frame).toBe('level');
  });

  it('provenance_unit_normalised SURVIVES the parse', () => {
    const parsed = GoalConstraintSchema.parse(mintedConstraint()) as Record<string, unknown>;
    expect(parsed.provenance_unit_normalised).toEqual({
      rule: 'percent_to_fraction',
      original_value: 0.05,
      original_unit: '%',
    });
  });

  it('END TO END — a real percent rewrite reaches the parsed constraint', () => {
    // Bound to the producer's OWN arithmetic, not to a hand-written literal:
    // 5% arrives as 0.05 with unit "%", which is the window the rule fires in.
    const [normalised] = normaliseConstraintUnits([
      {
        targetNodeId: 'n1',
        operator: '<=',
        value: 0.05,
        unit: '%',
        label: 'Churn cap',
        provenance: 'explicit',
      } as never,
    ]);
    // Precondition pinned in-test: the rule must actually have fired, or the
    // assertion below would pass on a constraint that was never rewritten
    // (trap 13b — a discriminator must pin its own precondition).
    expect(normalised.unit).toBe('fraction');

    const [wire] = toGoalConstraints([normalised]);
    const parsed = GoalConstraintSchema.parse(wire) as Record<string, unknown>;
    // ⛔ REPOINTED, AND THE REASON MATTERS. This rule no longer stamps
    // `provenance_unit_normalised`: its guard fires only when the value is
    // ALREADY a fraction, so `original_value` could only ever be the
    // post-relabel machine value — while the contract fixture and the UI both
    // declare that field to be the figure the READER stated. A reader who
    // wrote "under 4%" was shown "≤ 0.04%". The declaration this spec exists to
    // protect is unchanged and still load-bearing; only the producer's claim
    // narrowed, so the end-to-end assertion follows it to the honest field.
    expect(parsed.provenance_unit_normalised).toBeUndefined();
    expect(parsed.provenance_unit_relabelled).toEqual({
      rule: 'percent_label_to_fraction_label',
      pre_normalisation_value: 0.05,
      pre_normalisation_unit: '%',
    });
  });

  it('a constraint the rule did NOT rewrite carries no audit trail', () => {
    // The field is by-presence: absent means "no rewrite happened", which is a
    // different fact from "a rewrite happened and was lost". Declaring the
    // field must not start manufacturing an empty audit trail.
    const [untouched] = normaliseConstraintUnits([
      {
        targetNodeId: 'n1',
        operator: '<=',
        value: 200000,
        unit: 'GBP',
        label: 'Budget limit',
        provenance: 'explicit',
      } as never,
    ]);
    const [wire] = toGoalConstraints([untouched]);
    const parsed = GoalConstraintSchema.parse(wire) as Record<string, unknown>;
    expect(parsed.provenance_unit_normalised).toBeUndefined();
    expect(parsed.provenance_unit_relabelled).toBeUndefined();
  });
});
