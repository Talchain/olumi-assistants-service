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

import { structureProvenance } from '../../graph-readiness/obligation-provenance.js';
import { NodeV3 } from '../../../schemas/cee-v3.js';
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

/**
 * ⚠⚠ EVERY ASSERTION GOES THROUGH `NodeV3.safeParse`, AND THAT IS THE WHOLE
 * POINT. A first cut of this suite read `transformNodeToV3`'s output directly:
 * six specs, all green, over an object the wire's own schema REJECTS
 * ("observed_state.value Required", Codex CX-147). A partial `observed_state`
 * is not a weaker record, it is an INVALID one. Reading the function's return
 * value tested the function; it did not test what reaches the wire.
 */
const parsedOf = (node: unknown) => {
  const out = transformNodeToV3(node as never);
  const parsed = NodeV3.safeParse(out);
  if (!parsed.success) {
    throw new Error(`NodeV3 rejected the transform output: ${JSON.stringify(parsed.error.issues)}`);
  }
  return parsed.data as { observed_state?: Record<string, unknown> };
};

const observedOf = (node: unknown) => parsedOf(node).observed_state;

describe('the promoted scale reaches observed_state', () => {
  it('⭐ carries the pair and a SCHEMA-VALID value when data is gone', () => {
    // `value = raw_value / cap` is the contract's own stated relationship, so
    // the pair is the unit of carry — and the record parses.
    expect(observedOf(promotedNode())).toEqual({
      value: 0.55,
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

  it.each([
    ['unit only', { cap: undefined, raw_value: undefined }],
    ['raw only', { cap: undefined, unit: undefined }],
    ['cap only', { raw_value: undefined, unit: undefined }],
    ['cap of zero', { cap: 0 }],
  ])('⛔ emits NOTHING for a %s promotion — a partial record is INVALID, not weaker', (_n, over) => {
    // CX-147: `observed_state.value` is Required, so half a record is refused
    // by the wire's schema. Emitting one would be worse than emitting none.
    expect(observedOf(promotedNode(over))).toBeUndefined();
  });

  it('ignores non-finite or blank promotions rather than carrying junk', () => {
    expect(observedOf(promotedNode({ raw_value: Number.NaN, cap: undefined, unit: '  ' }))).toBeUndefined();
  });
});

/**
 * ⭐⭐ THE OUTCOME METRIC, NOT THE SYMPTOM METRIC (CLAUDE.md trap 23).
 *
 * Every assertion above answers "is the scale on the wire?". That is the
 * symptom. The question the USER experiences is "may the product say anything
 * about this analysis?", and it is decided by one counter:
 *
 *   structureProvenance reads observed_state.source, then .extractionType
 *     → censusConfidenceParameters increments material_parameters_user_stated
 *       → semanticQualitySufficient IS `material_parameters_user_stated > 0`
 *         → deriveMode returns 'comparative_leader'
 *           → a leading option and win probabilities may be shown at all.
 *
 * A restored factor carrying a perfect scale and no authorship censuses
 * 'unattributed' and moves that counter by ZERO — the fix would ship, the
 * field would be on the wire, and the user would still be told "Nothing in it
 * is confirmed yet". These bind to the consumer, so the suite fails if the
 * carry is dropped.
 */
describe('the promoted scale moves the gate the user actually feels', () => {
  it('⭐ censuses USER_STATED — the counter that unconfines the analysis', () => {
    const node = promotedNode({ extractionType: 'explicit' });
    expect(structureProvenance(parsedOf(node))).toBe('user_stated');
  });

  it('⭐ carries AI authorship faithfully rather than promoting it', () => {
    const node = promotedNode({ extractionType: 'inferred' });
    expect(structureProvenance(parsedOf(node))).toBe('ai_drafted');
  });

  it('⛔ stays UNATTRIBUTED when nothing upstream stamped it — never invents authorship', () => {
    // A fabricated provenance is far worse than a withheld one: it would tell
    // the product a machine-drafted number is the user's own.
    expect(structureProvenance(parsedOf(promotedNode()))).toBe('unattributed');
  });
});
