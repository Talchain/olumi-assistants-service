/**
 * THE TWO PERSIST-MERGE HELPERS OWN THEIR CLONE. The caller must not have to.
 *
 * ⭐ WHY THIS EXISTS — the P0 that already shipped, and the two seats beside it
 * that had the same defect and no guard.
 *
 * `mergeAppliedGraphForPersistence` and `mergeMutatedGraphForPersistence` both
 * compose their result with a SHALLOW spread — `{...base, nodes, edges}` — so
 * only `nodes` and `edges` are fresh. `merged.options`, `merged.meta` and every
 * other top-level object or array are THE SAME OBJECT REFERENCES the caller's
 * base holds. Any later pass that mutates the result IN PLACE
 * (`pruneDanglingNodeReferences` does exactly this: `delete bag[key]`,
 * `graph.meta[field] = kept`) therefore writes THROUGH the spread and rewrites
 * the caller's trusted base.
 *
 * That was a P0 for `structural_delete`: `dispatch.ts` derives the atomic-CAS
 * expected base from `result.baseGraph` AFTER the adapter returns, so a mutated
 * base yields an expected hash for a graph that was NEVER PERSISTED — the CAS
 * can never match and every subsequent delete is refused, permanently.
 *
 * ⚠ THE FIX WAS PARKED AT ONE CALL SITE OUT OF THREE. `structural-delete.ts`
 * wrapped its own call in `structuredClone(...)`. `factor-value-edit.ts` and
 * `edge-strength-edit.ts` derive the SAME CAS from the SAME base through the
 * sibling helper and had no clone at all — latent only because neither runs a
 * structural prune TODAY. A hazard whose absence depends on nobody adding an
 * in-place pass is not closed, it is unattended: the guard lives one seam away
 * from the thing it guards (P1). So ownership moves INTO the helpers, which is
 * this repo's own named idiom for exactly this (`exposeCandidate`,
 * `graph-management/candidate-graph.ts`).
 *
 * WHAT IS PINNED HERE:
 *   · the CONTRACT — a returned graph aliases NOTHING the caller passed in,
 *     asserted by object IDENTITY per top-level key, not by deep-equality
 *     (deep-equality is satisfied by the aliasing shape and would be a guard
 *     agreeing with itself);
 *   · the REPRODUCTION — a real in-place prune over the returned graph, at all
 *     THREE CAS-deriving call-site shapes, with the caller's base asserted
 *     byte-identical afterwards AND its CAS identity hash unmoved.
 *
 * The opposite-direction twin — a GENUINELY stale base must still be refused —
 * lives in `structural-delete-trusted-base-purity.test.ts` and is unchanged by
 * this file. Both directions, every time.
 */
import { describe, it, expect } from 'vitest';

import { mergeAppliedGraphForPersistence } from '../../handlers/edit-graph-dispatch.js';
import {
  applyAndValidateMutation,
  mergeMutatedGraphForPersistence,
} from '../../tools/handlers/d1-shared/apply-graph-mutation.js';
import { pruneDanglingNodeReferences } from '../structural-delete.js';
import { computeExpectedGraphCasHashes } from '../../context/graph-cas-conflict.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

/** The CAS expected-base hash exactly as `dispatch.ts` derives it. */
const casIdentity = (graph: unknown): string | null =>
  computeExpectedGraphCasHashes(graph).expectedGraphIdentityHash;

/**
 * A persisted graph shaped like the rows staging actually holds after a first
 * edit: the top-level `options[]` mirror is populated with `interventions`
 * bags, and `meta.roots` names the factors. Those are precisely the two
 * surfaces `pruneDanglingNodeReferences` writes to in place, which is why they
 * are the ones that must not be shared with the result.
 */
function persistedBase(): Record<string, unknown> {
  return {
    goal_node_id: 'g',
    schema_version: 'cee-v3',
    nodes: [
      { id: 'g', kind: 'goal', label: 'Grow revenue' },
      {
        id: 'o-launch',
        kind: 'option',
        label: 'Launch now',
        interventions: { 'f-gone': { value: 0.4 }, 'f-stays': { value: 0.7 } },
      },
      { id: 'f-gone', kind: 'factor', label: 'Contractor cost' },
      { id: 'f-stays', kind: 'factor', label: 'Market timing' },
    ],
    edges: [
      { from: 'f-stays', to: 'g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
    options: [
      {
        id: 'o-launch',
        status: 'ready',
        interventions: { 'f-gone': { value: 0.4 }, 'f-stays': { value: 0.7 } },
      },
    ],
    meta: { roots: ['f-gone', 'f-stays'], leaves: ['g'] },
  };
}

/** The structural subset a mutation hands back, with `f-gone` removed. */
function appliedGraphWithoutFGone(): GraphV3T {
  return {
    nodes: [
      { id: 'g', kind: 'goal', label: 'Grow revenue' },
      { id: 'o-launch', kind: 'option', label: 'Launch now' },
      { id: 'f-stays', kind: 'factor', label: 'Market timing' },
    ],
    edges: [
      { from: 'f-stays', to: 'g', strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  } as unknown as GraphV3T;
}

/**
 * The precondition that stops every assertion below being vacuous: the prune
 * MUST actually have something to remove on this fixture. A prune that touches
 * nothing cannot write through anything, and the whole file would pass by
 * measuring silence (CLAUDE.md trap 13).
 */
function assertPruneIsExercised(counts: { interventionsPruned: number; metaIdsPruned: number }): void {
  expect(
    counts.interventionsPruned + counts.metaIdsPruned,
    'the fixture must give the prune something to remove, or nothing below is a measurement',
  ).toBeGreaterThan(0);
}

describe('mergeAppliedGraphForPersistence — the structural_delete call-site shape', () => {
  it('returns a graph that shares NO top-level object with the persisted base', () => {
    const base = persistedBase();
    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: appliedGraphWithoutFGone(),
      persistedBase: base,
      ingressBase: { nodes: [], edges: [] } as never,
      requestId: 'req-1',
      scenarioId: 'scn-1',
    });
    // BOUND BY IDENTITY, not by value: the aliasing shape this closes is
    // deep-EQUAL to the correct one, so only reference identity discriminates.
    expect(merged.options).not.toBe(base.options);
    expect(merged.meta).not.toBe(base.meta);
    expect((merged.meta as { roots: string[] }).roots).not.toBe((base.meta as { roots: string[] }).roots);
    // …and it is still the same VALUE, i.e. the clone did not silently drop it.
    expect(merged.meta).toEqual(base.meta);
    expect(merged.options).toEqual(base.options);
  });

  it('an in-place prune over the RESULT leaves the persisted base byte-identical', () => {
    const base = persistedBase();
    const before = structuredClone(base);
    const hashBefore = casIdentity(base);

    const merged = mergeAppliedGraphForPersistence({
      appliedGraph: appliedGraphWithoutFGone(),
      persistedBase: base,
      ingressBase: { nodes: [], edges: [] } as never,
      requestId: 'req-1',
      scenarioId: 'scn-1',
    });
    assertPruneIsExercised(pruneDanglingNodeReferences(merged, new Set(['f-gone'])));

    expect(base).toEqual(before);
    // The CAS derivation is the thing the P0 actually broke, so assert it too.
    expect(casIdentity(base)).toBe(hashBefore);
  });
});

describe('mergeMutatedGraphForPersistence — the factor_value_edit / edge_strength_edit shapes', () => {
  it('returns a graph that shares NO top-level object with the persisted base', () => {
    const base = persistedBase();
    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph: appliedGraphWithoutFGone() as unknown as Record<string, unknown>,
      persistedBase: base,
      requestId: 'req-2',
      scenarioId: 'scn-2',
    });
    expect(merged.options).not.toBe(base.options);
    expect(merged.meta).not.toBe(base.meta);
    expect(merged.meta).toEqual(base.meta);
  });

  it.each([
    ['factor_value_edit', 'req-fve'],
    ['edge_strength_edit', 'req-ese'],
  ])('%s: an in-place prune over the RESULT leaves the persisted base byte-identical', (_label, requestId) => {
    const base = persistedBase();
    const before = structuredClone(base);
    const hashBefore = casIdentity(base);

    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph: appliedGraphWithoutFGone() as unknown as Record<string, unknown>,
      persistedBase: base,
      requestId,
      scenarioId: 'scn-2',
    });
    assertPruneIsExercised(pruneDanglingNodeReferences(merged, new Set(['f-gone'])));

    expect(base).toEqual(before);
    expect(casIdentity(base)).toBe(hashBefore);
  });

  it('the malformed-base fallback also owns its clone (it returns the mutated graph)', () => {
    // `persistedUsable === false` returns `mutatedGraph` itself — the SECOND
    // aliasing limb, and the one a reader skims past. The caller of this helper
    // holds `outcome.mutated_graph`; a prune over the result must not reach it.
    const mutated = { ...appliedGraphWithoutFGone(), meta: { roots: ['f-gone'] } } as unknown as Record<string, unknown>;
    const before = structuredClone(mutated);
    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph: mutated,
      persistedBase: { not: 'a usable graph' },
      requestId: 'req-3',
      scenarioId: 'scn-3',
    });
    expect(merged).not.toBe(mutated);
    assertPruneIsExercised(pruneDanglingNodeReferences(merged, new Set(['f-gone'])));
    expect(mutated).toEqual(before);
  });
});

describe('applyAndValidateMutation — the composer that feeds both merge helpers', () => {
  it('an in-place prune over the RESULT leaves the INGRESS graph byte-identical', () => {
    // `apply-graph-mutation.ts`'s composer spreads `ingressShape`, so its result
    // aliases the ingress graph's top-level objects the same way. Same defect,
    // one seam earlier — and this is the object the handler was handed.
    const ingress = persistedBase();
    const before = structuredClone(ingress);

    const { mutatedGraph } = applyAndValidateMutation(ingress, (clone) => {
      const kept = clone.nodes.filter((n) => n.id !== 'f-gone');
      (clone as { nodes: unknown[] }).nodes = kept;
      return { before: null, after: null };
    });
    assertPruneIsExercised(pruneDanglingNodeReferences(mutatedGraph, new Set(['f-gone'])));

    expect(ingress).toEqual(before);
  });
});
