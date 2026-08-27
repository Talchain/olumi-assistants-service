/**
 * KEY-SET PARITY PIN — the context-pack `run_delta` projection vs the WIRE `RunDelta`.
 *
 * `ContextPackRunDeltaSchema` (context/context-pack-schema.ts) is the model-facing
 * projection of the wire `RunDelta` (`@talchain/schemas/boundary`). Its member
 * SCHEMAS are the contract's own objects, so their internals cannot drift. Its
 * top-level KEY LIST, however, is written out by hand — and that is the one place
 * a wire change can pass unnoticed: a new key added to `RunDeltaSchema` would
 * simply never appear in the projection, and nothing else in the tree would care.
 *
 * ⭐ THIS GUARD IS THE THING THAT NOTICES. It DERIVES both key sets at runtime —
 * the wire's from `RunDeltaSchema` itself, the projection's from
 * `ContextPackRunDeltaSchema.shape` — and asserts they differ by EXACTLY the one
 * key the projection deliberately omits. Neither list is restated here (trap 12:
 * a hand-copied list is the defect, not the fix); the only hand-written token is
 * `DELIBERATELY_OMITTED`, which is the reviewed decision itself.
 *
 * ⛔ IF THIS GOES RED BECAUSE THE WIRE GAINED A KEY, THE FIX IS NOT TO ADD THE KEY
 * HERE. A new wire field reaching the prompt is a claim-safety decision: the model
 * reads whatever it is handed as a computed answer. Route it through the same
 * review that sanctioned the existing five, then project it.
 *
 * ⛔ AND `flip_thresholds` MUST STAY OMITTED. The producer emits it FROZEN EMPTY
 * (`RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED`) because the flip-threshold join is
 * DEFERRED and it never looked — so serialising `[]` into the prompt would assert
 * "there are no flip thresholds", which is a claim nothing computed. Its single
 * consumption site is pinned separately by
 * `tests/contract/run-delta-flip-thresholds-single-site.guard.test.ts`.
 *
 * Auto-enrols in the required CI gate by living under tests/contract/.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RunDeltaSchema } from '@talchain/schemas/boundary';

import { ContextPackRunDeltaSchema } from '../../src/orchestrator-v5/context/context-pack-schema.js';

/**
 * The one wire key the projection deliberately drops. This is the ONLY
 * hand-written key in this file, and deliberately so: it is the reviewed
 * claim-safety decision, not a mirror of a list.
 */
const DELIBERATELY_OMITTED = 'flip_thresholds';

/**
 * `RunDeltaSchema` is a `ZodEffects` (it carries `refineRunDelta`), so it has no
 * `.shape` of its own. `.innerType()` is zod's PUBLIC accessor for the wrapped
 * object — used in preference to reaching into `._def`, so a zod upgrade breaks
 * this loudly at the call rather than silently yielding `undefined` (which would
 * make every assertion below vacuously agree).
 */
function wireKeys(): string[] {
  const inner = RunDeltaSchema.innerType();
  // Precondition, not decoration: if this ever stops being a ZodObject the key
  // extraction below would return [] and the parity assertion would PASS while
  // measuring nothing.
  expect(
    inner,
    'RunDeltaSchema.innerType() did not return a ZodObject — the wire key set could ' +
      'not be derived, so this guard is measuring nothing. Fix the extraction; do ' +
      'not delete the assertion.',
  ).toBeInstanceOf(z.ZodObject);
  return Object.keys(inner.shape);
}

function projectionKeys(): string[] {
  return Object.keys(ContextPackRunDeltaSchema.shape);
}

describe('run_delta context-pack projection — key-set parity with the wire', () => {
  /**
   * NON-VACUITY / POSITIVE CONTROL (trap 13). Every assertion in this file is a
   * statement about two derived sets; if either derivation silently returned an
   * empty list, the parity check would agree with itself. This proves both
   * extractions see a real population — and, specifically, that the wire set
   * CONTAINS the key we claim to omit, so the omission below is a real absence
   * rather than a broken read.
   */
  it('derives a real population from both sides (non-vacuous)', () => {
    const wire = wireKeys();
    const projection = projectionKeys();

    expect(wire.length).toBeGreaterThan(1);
    expect(projection.length).toBeGreaterThan(1);
    expect(
      wire,
      `the wire RunDelta no longer carries \`${DELIBERATELY_OMITTED}\`. If the contract ` +
        `genuinely dropped it, delete DELIBERATELY_OMITTED and this guard becomes a ` +
        `plain equality — but verify that at the contract before weakening anything.`,
    ).toContain(DELIBERATELY_OMITTED);
  });

  /**
   * ⭐ THE LOAD-BEARING ASSERTION. Wire minus the one sanctioned omission must
   * equal the projection, exactly — no missing key (a silently unprojected wire
   * field) and no extra key (a projection field the wire does not have).
   */
  it('projects EXACTLY the wire key set minus the one deliberate omission', () => {
    const expected = wireKeys()
      .filter((k) => k !== DELIBERATELY_OMITTED)
      .sort();
    const actual = projectionKeys().sort();

    expect(
      actual,
      `context-pack run_delta projection has drifted from the wire RunDelta.\n` +
        `  wire (minus ${DELIBERATELY_OMITTED}): ${expected.join(', ')}\n` +
        `  projection:                          ${actual.join(', ')}\n` +
        `A key present on the wire but absent here never reaches the model. A key ` +
        `here but absent on the wire cannot be populated. Adding a NEW wire field to ` +
        `the prompt is a claim-safety decision — take the review, then project it.`,
    ).toEqual(expected);
  });

  it(`omits \`${DELIBERATELY_OMITTED}\` (claim safety, not oversight)`, () => {
    expect(
      projectionKeys(),
      `\`${DELIBERATELY_OMITTED}\` is emitted FROZEN EMPTY by the producer because the ` +
        `flip-threshold join is deferred. An empty array is not a neutral placeholder — ` +
        `to an LLM it reads as "there are no flip thresholds", a claim nothing computed. ` +
        `Absence is the honest projection.`,
    ).not.toContain(DELIBERATELY_OMITTED);
  });

  /**
   * The comment on `ContextPackRunDeltaSchema` promises that `.strict()` makes a
   * new wire key "fail LOUD in the non-prod safeParse gate rather than ride
   * silently into the prompt". That promise is only true while the schema really
   * is strict — so pin the BEHAVIOUR, not the annotation.
   */
  it('is strict, so an unrecognised key fails loud rather than riding through', () => {
    const probe = { zzz_not_a_run_delta_key: 1 };
    const result = ContextPackRunDeltaSchema.safeParse(probe);

    expect(result.success).toBe(false);
    const codes = result.success ? [] : result.error.issues.map((i) => i.code);
    expect(
      codes,
      'ContextPackRunDeltaSchema accepted an unrecognised key without an ' +
        '`unrecognized_keys` issue — `.strict()` has been dropped, and a new wire key ' +
        'would now ride silently into the prompt.',
    ).toContain('unrecognized_keys');

    // Discriminating control: the same probe against a NON-strict object must NOT
    // produce that issue code. Without this, the assertion above could be passing
    // on a zod that reports `unrecognized_keys` for everything.
    const looseCodes = z
      .object({ attribution_case: z.string() })
      .safeParse(probe)
      .error!.issues.map((i) => i.code);
    expect(looseCodes).not.toContain('unrecognized_keys');
  });
});
