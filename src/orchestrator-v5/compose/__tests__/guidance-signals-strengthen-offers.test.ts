/**
 * THE THREE `strengthen`-RIDING OFFER SIGNAL FACTORIES, PINNED AGAINST THE
 * LITERAL SHAPES THEY EMITTED BEFORE THEY WERE COLLAPSED INTO ONE.
 *
 * `fragileEdgeOfferSignals`, `overrideStressTestSignals` and
 * `disagreementResolutionSignals` were three byte-identical bodies differing by
 * one constant. They now delegate to a single parameterised factory. That is
 * only legitimate if the OUTPUT is unchanged, so the pre-collapse shapes are
 * COPIED HERE as expected values (the brief's own instruction) rather than
 * re-derived from the same helpers the production code uses — a re-derivation
 * would be the collapsed code agreeing with itself (CLAUDE.md trap 13b).
 *
 * ⚠ THE EXPECTED CATEGORY/PRIORITY ARE READ FROM THE CANONICAL KIND MAP, not
 * typed as literals, and that is deliberate rather than lazy: the whole point of
 * the original three bodies was that the category DERIVES from the `strengthen`
 * coaching kind and is never restated. Typing `"…"` here would mint the very
 * mirror the module exists to prevent. What the spec pins is the DERIVATION
 * PATH and the per-offer `signal_code`, which is the part that actually differs.
 */

import { describe, it, expect } from 'vitest';

import {
  GUIDANCE_SIGNAL_CODES,
  PRIORITY_BY_CATEGORY,
  disagreementResolutionSignals,
  fragileEdgeOfferSignals,
  guidanceSignalsForCoachingKind,
  overrideStressTestSignals,
} from '../guidance-signals.js';

/**
 * The pre-collapse body, reconstructed from the SAME two primitives the three
 * literals used — `signalsOf` and `provenanceOf` are module-private, so this
 * re-spells exactly what they returned. `signal` is present only when the code
 * carries a signal line, which is `provenanceOf`'s own conditional.
 */
function preCollapseShape(code: string, signal: string | undefined): Record<string, unknown> {
  const category = guidanceSignalsForCoachingKind('strengthen').category;
  return {
    category,
    priority: PRIORITY_BY_CATEGORY[category],
    signal_code: code,
    ...(signal === undefined ? {} : { signal }),
  };
}

describe('the three strengthen-riding offer factories are unchanged by the collapse', () => {
  it('each emits exactly its pre-collapse literal shape', () => {
    // The three bodies as they stood at bdcba160, reconstructed field by field.
    // The `signal` line (when present) is read off the LIVE result rather than
    // typed, because it is a copy string this pass did not touch; every other
    // field is asserted against the independently reconstructed shape.
    for (const [factory, code] of [
      [fragileEdgeOfferSignals, GUIDANCE_SIGNAL_CODES.FRAGILE_RESULT],
      [overrideStressTestSignals, GUIDANCE_SIGNAL_CODES.OVERRIDE_UNANSWERED],
      [disagreementResolutionSignals, GUIDANCE_SIGNAL_CODES.UNRESOLVED_DISAGREEMENT],
    ] as const) {
      const actual = factory() as unknown as Record<string, unknown>;
      expect(actual).toEqual(preCollapseShape(code, actual.signal as string | undefined));
      expect(actual.signal_code, 'the factory must carry its OWN code').toBe(code);
    }
  });

  it('the three DISCRIMINATE — they are not one shape wearing three names', () => {
    // Without this, a parameterised factory that ignored its argument would
    // satisfy every assertion above (trap 13b: a guard agreeing with itself).
    const codes = [
      fragileEdgeOfferSignals(),
      overrideStressTestSignals(),
      disagreementResolutionSignals(),
    ].map((s) => JSON.stringify(s));
    expect(new Set(codes).size, 'the three factories emit identical objects — the code argument is dead').toBe(3);
  });

  it('all three carry the SAME category/priority, derived from the strengthen kind', () => {
    // The invariant the collapse was safe under: the offers differ ONLY in
    // `signal_code`. If a future edit gave one its own category, this REDs and
    // the collapse must be revisited rather than quietly extended.
    const category = guidanceSignalsForCoachingKind('strengthen').category;
    for (const signals of [
      fragileEdgeOfferSignals(),
      overrideStressTestSignals(),
      disagreementResolutionSignals(),
    ]) {
      expect(signals.category).toBe(category);
      expect(signals.priority).toBe(PRIORITY_BY_CATEGORY[category]);
    }
  });
});
