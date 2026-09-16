/**
 * ⭐⭐ A SCALE THE PIPELINE CHOSE AND APPLIED MUST NOT BE DISCARDED.
 *
 * `unreachable-factors.ts` promotes `raw_value` / `cap` / `declared_scale` to
 * NODE level and then deletes `node.data`, precisely because a field-by-field
 * rebuild drops anything left on a deleted `data`. Every branch of
 * `transformNodeToV3` read `node.data.*` ONLY — so the promotion landed at a
 * level the rebuild also never read. That lane located the hop and handed it
 * on: "correcting it means teaching the V3 transform to read node-level
 * values".
 *
 * MEASURED, TWO WAYS:
 *   · that lane, across four deployed captures — ZERO of 29 factors carried
 *     node-level `raw_value`, `cap` or `unit` on the wire;
 *   · executed on this function before the fix — a node carrying promoted
 *     `{raw_value: 55000, cap: 100000, unit: '$'}` and no `data` produced NO
 *     `observed_state` AT ALL.
 *
 * THE USER-VISIBLE COST, Paul's 16 Sep capture (`f51850fc`): `Annual Assistant
 * Cost` reached the wire carrying only id/label/type/kind/category, while its
 * four option cells were encoded at a consistent 1:100,000 ratio —
 * 10000→0.1, 45000→0.45, 55000→0.55. The scale was chosen, applied to every
 * cell, and recorded nowhere. A money limit on that factor can never be
 * checked, and nothing downstream can reproduce the encoding.
 */
import { describe, expect, it } from 'vitest';

import { transformNodeToV3 } from '../schema-v3.js';

/** The shape the repair stage leaves: promoted to the node, `data` gone. */
const promotedNode = (over: Record<string, unknown> = {}) =>
  ({
    id: 'f_cost',
    kind: 'factor',
    label: 'Annual Assistant Cost',
    raw_value: 55000,
    cap: 100000,
    unit: '$',
    ...over,
  }) as never;

const observedOf = (node: unknown) =>
  (transformNodeToV3(node as never) as { observed_state?: Record<string, unknown> }).observed_state;

describe('the promoted scale reaches observed_state', () => {
  it('⭐ carries raw_value, cap and unit from the NODE when data is gone', () => {
    expect(observedOf(promotedNode())).toEqual({
      raw_value: 55000,
      cap: 100000,
      unit: '$',
    });
  });

  it('⭐ the cap is what makes a money limit checkable at all', () => {
    // `buildFactorScaleMap` reads observed_state.cap/unit. Without them the
    // constraint path has nothing to compare a £ figure against — which is
    // exactly why Paul's budget limit could not be checked.
    const observed = observedOf(promotedNode())!;
    expect(observed.cap).toBe(100000);
    expect(observed.unit).toBe('$');
  });

  it('⛔ does NOT shadow a richer observed_state built from data', () => {
    // `data` is the better source; the fallback must only fill a gap.
    const withData = {
      id: 'f_cost', kind: 'factor', label: 'Annual Assistant Cost',
      data: { value: 0.55, raw_value: 55000, cap: 100000, unit: '$' },
    };
    const observed = observedOf(withData)!;
    expect(observed.value).toBe(0.55);
    expect(observed.source).toBeDefined();
  });

  it('⛔ INVENTS NOTHING — a node with no scale anywhere gets no observed_state', () => {
    // The fallback carries what the pipeline already extracted. It must never
    // manufacture a scale, which is the ROADMAP 2.714 defect class.
    expect(observedOf({ id: 'f2', kind: 'factor', label: 'No scale anywhere' })).toBeUndefined();
  });

  it('carries a PARTIAL promotion rather than requiring all three', () => {
    // A unit with no cap is still worth more than nothing: it tells a
    // downstream reader what the number is denominated in.
    expect(observedOf(promotedNode({ cap: undefined, raw_value: undefined }))).toEqual({ unit: '$' });
  });

  it('ignores non-finite or blank promotions rather than carrying junk', () => {
    expect(observedOf(promotedNode({ raw_value: Number.NaN, cap: undefined, unit: '  ' }))).toBeUndefined();
  });
});
