/**
 * ⭐⭐⭐ THE COMPLETENESS CHECK A WHITELIST LACKS BY CONSTRUCTION.
 *
 * `transformNodeToV3` / `transformEdgeToV3` rebuild each record from an
 * ENUMERATED object literal. Anything not named is dropped, and **nothing REDs**
 * — there is no exhaustiveness check over a fresh object literal, so the loss is
 * invisible to the compiler, to every existing test, and to code review.
 *
 * ── WHY THIS FILE EXISTS RATHER THAN THE DEFENCE THAT WAS ALREADY THERE ──────
 * `schema-v2.ts`'s `V1Node` states the mechanism THREE times in its own
 * comments — *"the transform rebuilds each node field-by-field and drops
 * anything it does not name"* — and names a defence:
 *
 *     "⭐ The typecheck is the mechanism here, not the documentation. Adding the
 *      carry in schema-v3.ts without this line fails to compile."
 *
 * ⛔ **THAT DEFENCE DOES NOT HOLD, AND EDGE `id` IS THE PROOF.** `V1Edge`
 * DECLARES `id?: string` (`schema-v2.ts:157`) and `transformEdgeToV3` drops it
 * anyway. The typecheck only bites in one direction: it stops you CARRYING a
 * field the input type does not declare. It cannot notice a declared field you
 * FAIL to carry, because the output is a fresh literal, the input field is
 * optional, and nothing relates the two. **Measured consequence: 2 of 242,731
 * live edges carry an id.**
 *
 * So the real check is this one — compare the keys going in with the keys
 * coming out, and pin the difference EXACTLY.
 *
 * ⚠ WHY THE PIN IS AN EXACT SET AND NOT A MAXIMUM. It REDs if the set GROWS (a
 * new silent drop shipped) and equally if it SHRINKS (a drop was fixed and this
 * pin is now lying about the transform). A "no more than N" assertion would let
 * a fix and a regression cancel out. Same discipline as a KNOWN-DROPPED set:
 * the gap is honest in the suite rather than invisible to it.
 *
 * ⚠ AND WHY IT IS NOT A CORPUS DIFF. The obvious instrument — diff banked V1
 * payloads against banked V3 payloads — was tried and is WORTHLESS here: **zero
 * banked payloads carry both shapes**, so it compares two disjoint populations
 * and manufactures drops that never happened. It produced a confident
 * seventeen-field list, none of it supported. Only a PAIRED comparison, which
 * is what running the transform gives you, can answer this.
 */

import { describe, expect, it } from 'vitest';

import { transformEdgeToV3, transformNodeToV3 } from '../schema-v3.js';
import type { V1Edge, V1Node } from '../schema-v2.js';

/**
 * A V1 edge with EVERY declared optional field populated.
 *
 * Built from `V1Edge`'s declaration, not from a capture: a capture only proves
 * what that traffic happened to carry, and a field absent from the fixture
 * cannot be observed being dropped (CLAUDE.md trap 13d — a corpus that omits a
 * value class cannot certify the code over it).
 */
const FULL_V1_EDGE: Required<Pick<V1Edge, 'from' | 'to'>> & V1Edge = {
  id: 'e_stable_001',
  from: 'fac_a',
  to: 'goal_b',
  weight: 0.4,
  belief: 0.7,
  provenance: { source: 'ai' } as never,
  provenance_source: 'ai',
  effect_direction: 'positive' as never,
  strength_mean: 0.5,
  strength_std: 0.1,
  belief_exists: 0.8,
  origin: 'ai',
  edge_type: 'directed',
};

/** Folded into a differently-shaped V3 carrier. The information is NOT lost. */
const EDGE_RESHAPED_INTO_V3 = new Set([
  'weight', // -> strength.mean (legacy name)
  'belief', // -> exists_probability (legacy name)
  'strength_mean', // -> strength.mean
  'strength_std', // -> strength.std
  'belief_exists', // -> exists_probability
  'provenance_source', // -> provenance.source / provenance_display
]);

/**
 * ⛔ GENUINELY LOST — no V3 carrier at all. Being fixed by Core at the time of
 * writing (one line in `transformEdgeToV3`, plus an OPTIONAL declaration on
 * `EdgeV3Schema`, which is `.passthrough()` so the value flows today).
 *
 * ⭐ WHEN THAT LANDS THIS TEST GOES RED, AND THAT IS CORRECT — the pin is a
 * statement about the transform's current behaviour, so a fix must update it
 * rather than pass silently. Move `id` out of this set; do not widen the
 * assertion.
 */
const EDGE_KNOWN_DROPPED = new Set(['id']);

const FULL_V1_NODE: V1Node = {
  id: 'goal_b',
  kind: 'goal',
  label: 'Goal',
  body: 'body text',
  category: 'observable',
  goal_threshold: 0.8,
  goal_threshold_raw: 80,
  goal_threshold_unit: '%',
  goal_threshold_cap: 100,
  goal_threshold_frame: 'level' as never,
  goal_baseline: 0.5,
  goal_baseline_raw: 50,
  scale_frame: 100,
};

function keysLost(input: Record<string, unknown>, output: Record<string, unknown>): Set<string> {
  return new Set(Object.keys(input).filter((k) => !(k in output)));
}

describe('V3 transform — it carries what it is given, or the loss is pinned', () => {
  it('EDGE: the lost set is EXACTLY the reshaped fields plus the known-dropped ones', () => {
    const { edge } = transformEdgeToV3(FULL_V1_EDGE as never, 0, []);
    const lost = keysLost(FULL_V1_EDGE as never, edge as never);

    const unexplained = [...lost].filter(
      (k) => !EDGE_RESHAPED_INTO_V3.has(k) && !EDGE_KNOWN_DROPPED.has(k),
    );
    expect(
      unexplained,
      'transformEdgeToV3 silently dropped a field that is neither a documented ' +
        'reshape nor a known defect. An enumerated rebuild loses anything it does ' +
        'not name and nothing else will tell you.',
    ).toEqual([]);

    // …and the mirror: a field pinned as dropped that is NO LONGER dropped means
    // this pin is lying about the transform. Fix the pin, do not widen it.
    const staleClaims = [...EDGE_KNOWN_DROPPED].filter((k) => !lost.has(k));
    expect(
      staleClaims,
      'a field pinned here as dropped now survives the transform — the fix landed ' +
        'and this pin is stale. Remove it from EDGE_KNOWN_DROPPED.',
    ).toEqual([]);
  });

  it('EDGE: `id` is the measured instance — and the POSITIVE CONTROL that this probe can see', () => {
    // Without this, every assertion above would pass identically if the fixture
    // were empty or the transform returned its input unchanged (trap 13).
    const { edge } = transformEdgeToV3(FULL_V1_EDGE as never, 0, []);
    expect(FULL_V1_EDGE.id).toBeDefined();
    expect((edge as Record<string, unknown>).id).toBeUndefined();
    // …and the contrast: a field on the SAME record that IS carried, proving
    // the probe discriminates rather than reading every field as absent.
    expect((edge as Record<string, unknown>).from).toBe('fac_a');
    expect((edge as Record<string, unknown>).origin).toBe('ai');
  });

  it('NODE: no declared field is lost without an explanation', () => {
    // Signature (derived at `schema-v3.ts:232`): (node, existingIds: Set<string>,
    // labelCleaningTrace?) => NodeV3T. Returns the node DIRECTLY — unlike the
    // edge transform, which returns `{ edge, defaults }`.
    const out = transformNodeToV3(
      FULL_V1_NODE as never,
      new Set<string>(),
    ) as unknown as Record<string, unknown>;
    const lost = keysLost(FULL_V1_NODE as never, out);
    // `data` is legitimately reshaped into `observed_state`; `kind`/`label` are
    // carried. Anything else is a finding.
    const NODE_RESHAPED = new Set(['data']);
    const unexplained = [...lost].filter((k) => !NODE_RESHAPED.has(k));
    expect(
      unexplained,
      'transformNodeToV3 dropped a declared node field. The goal_threshold_* and ' +
        'scale_frame fields each had to be added to V1Node BY HAND to make the ' +
        'carry compile — which is why a field nobody thought to add is exactly ' +
        'the one that goes missing.',
    ).toEqual([]);
  });
});
