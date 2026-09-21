/**
 * ⛔⛔ THE GUARD THE COMPILER CANNOT PROVIDE — `StructureProvenance` is a UNION
 * and `ContextPackFactorValueEntrySchema.provenance` is a ZOD ENUM, and until
 * this file existed the two were joined by nothing but a human remembering.
 *
 * ## THE MEASURED FAILURE MODE, AND WHY IT IS SILENT
 *
 * Widening `StructureProvenance` (`cee/graph-readiness/obligation-provenance.ts`)
 * breaks NOTHING at build time. Measured at `31d5b81e`: there are ZERO exhaustive
 * `switch` statements over the union repo-wide, so no `never` check fires. The
 * producer (`context/factor-value-record.ts:171`) is typed `StructureProvenance`
 * and happily emits the new member; the Zod enum beside it was a HAND-LISTED
 * four-member tuple and would have REJECTED it — **at runtime, in the context
 * pack, on a real turn.** A green build, a green typecheck, and a context pack
 * that throws on the first graph carrying the new class.
 *
 * ## WHAT THIS FILE PINS, AND WHY IT IS THREE ASSERTIONS AND NOT ONE
 *
 *   1. **PARITY, BOTH DIRECTIONS.** The enum's `options` must equal
 *      `STRUCTURE_PROVENANCE_VALUES` exactly — REDs if a member is ADDED to the
 *      union and not the schema, AND if one is added to the schema and not the
 *      union. A `toContain` would stay green as the union grew, which is the
 *      blindness being closed.
 *   2. **THE ROUND TRIP.** Parity is a claim about two lists; the harm is a
 *      PARSE REJECTION. So every member is actually pushed through
 *      `ContextPackFactorValuesSchema.safeParse` — that is the failure mode,
 *      stated in its own terms rather than inferred from list equality.
 *   3. **A CONTRAST CONTROL.** A schema that accepted everything would satisfy
 *      (2) vacuously. A fabricated member must be REFUSED, in the same run, so
 *      acceptance is evidence of discrimination rather than of permissiveness.
 *
 * ⚠ The schema is now DERIVED (`z.enum(STRUCTURE_PROVENANCE_ENUM_VALUES)`), so
 * (1) currently holds by construction. **That is not a reason to delete it.** It
 * is what REDs if someone re-inlines the literal tuple — which is exactly how
 * the drift arrived the first time, and a derivation is only as durable as the
 * guard that notices it was undone.
 */
import { describe, expect, it } from 'vitest';

import {
  STRUCTURE_PROVENANCE_ENUM_VALUES,
  STRUCTURE_PROVENANCE_VALUES,
} from '../../../cee/graph-readiness/obligation-provenance.js';
import { ContextPackFactorValuesSchema } from '../context-pack-schema.js';

/**
 * The enum node the entry schema carries, reached through the published shape.
 *
 * ⚠ `factors` is `z.array(...).readonly()`, i.e. a `ZodReadonly` WRAPPING the
 * array — `.element` on the wrapper is `undefined`. Unwrapping explicitly (and
 * asserting each hop is real) is the difference between reading the enum and
 * reading `undefined.options`, which would throw rather than pass, but only
 * because `.sort()` on it would. Named, because the first draft of this helper
 * got it wrong.
 */
const provenanceEnumOptions = (): readonly string[] => {
  const factorsField = ContextPackFactorValuesSchema.shape.factors as unknown as {
    unwrap?: () => { element: { shape: { provenance: { options: readonly string[] } } } };
    element?: { shape: { provenance: { options: readonly string[] } } };
  };
  const array = factorsField.unwrap ? factorsField.unwrap() : factorsField.element;
  const element = (array as { element?: unknown }).element ?? array;
  const entry = element as { shape: { provenance: { options: readonly string[] } } };
  const options = entry.shape?.provenance?.options;
  // The reach itself is a claim; assert it rather than discovering it failed as
  // a confusing equality error three lines later.
  expect(Array.isArray(options), 'could not reach the provenance enum through the schema').toBe(
    true,
  );
  return options;
};

const factorsPayload = (provenance: string): unknown => ({
  factors: [{ label: 'Churn', has_value: true, provenance }],
  without_value_count: 0,
});

describe('context-pack provenance enum ≡ StructureProvenance', () => {
  it('the vocabulary is non-empty — an empty list would make every loop below vacuous', () => {
    expect(STRUCTURE_PROVENANCE_VALUES.length).toBeGreaterThanOrEqual(4);
    expect([...STRUCTURE_PROVENANCE_ENUM_VALUES]).toEqual([...STRUCTURE_PROVENANCE_VALUES]);
  });

  it('⭐ the Zod enum lists EXACTLY the union members — REDs if either side grows OR shrinks', () => {
    expect([...provenanceEnumOptions()].sort()).toEqual([...STRUCTURE_PROVENANCE_VALUES].sort());
  });

  it('⭐ every union member PARSES — the runtime rejection this guard exists to stop', () => {
    for (const member of STRUCTURE_PROVENANCE_VALUES) {
      const parsed = ContextPackFactorValuesSchema.safeParse(factorsPayload(member));
      expect(parsed.success, `\`${member}\` was refused by the context-pack schema`).toBe(true);
    }
  });

  it('CONTRAST CONTROL — a member the union does not declare is REFUSED', () => {
    // Without this, the loop above could pass because the schema accepts any
    // string, and "every member parses" would be a claim about nothing.
    const fabricated = 'user_telepathically_endorsed';
    expect([...STRUCTURE_PROVENANCE_VALUES]).not.toContain(fabricated);
    expect(ContextPackFactorValuesSchema.safeParse(factorsPayload(fabricated)).success).toBe(false);
  });
});
