/**
 * `applyStructuralDelete` MUST NOT MUTATE ITS OWN TRUSTED BASE.
 *
 * ⭐ THE P0 THIS PINS, in the user's terms: a user could delete exactly ONE thing
 * per scenario, and every later delete was refused — silently — forever.
 *
 * ⭐ THE MECHANISM, derived by execution against 150 real staging graphs (not
 * argued from the source):
 *
 *   `mergeAppliedGraphForPersistence` builds the persist candidate with a
 *   SHALLOW spread — `{...base, nodes, edges}` (edit-graph-dispatch.ts). Only
 *   `nodes` and `edges` are replaced, so `merged.meta`, `merged.options` and
 *   every other top-level object/array are THE SAME OBJECT REFERENCES as the
 *   trusted base's. `pruneDanglingNodeReferences` then mutates IN PLACE
 *   (`delete bag[key]`; `graph.meta[field] = kept`) — so it writes THROUGH the
 *   spread and rewrites `persistedGraph` itself.
 *
 *   `dispatch.ts` computes the atomic-CAS expected base AFTERWARDS, from
 *   `result.baseGraph` (which IS `persistedGraph`). The expected hash therefore
 *   describes a graph that was NEVER PERSISTED, it can never equal
 *   `scenarios.graph_identity_hash`, and `append_turn_atomic_v3/v4` raises
 *   OLGC1 → 409 GRAPH_DIVERGED / `rpc_cas_conflict`, permanently.
 *
 *   Stage isolation over 150 staging graphs: merge mutated the base 0 times,
 *   the PRUNE 47 times, the projection 0 times. The edit lane (merge + project,
 *   no structural prune) mutated it 0/150 — which is exactly why
 *   `factor_value_edit` kept committing on the same row while deletes did not.
 *
 * ⚠ WHICH SIDE WAS WRONG — measured, not chosen. `scenarios.graph_identity_hash`
 * agreed with `computeExpectedGraphCasHashes(scenarios.graph)` on 976/976 live
 * rows (contrast control: perturbing a graph moves the derived hash). THE COLUMN
 * IS RIGHT; THE DERIVATION WAS WRONG, because its input had been rewritten under
 * it. So the CAS must NOT be relaxed — it was reporting a divergence that this
 * code had just manufactured.
 *
 * WHAT THIS FILE ASSERTS, and why each half is load-bearing:
 *   - PURITY: the graph handed in comes back byte-identical, so the expected
 *     base describes the bytes the store actually holds.
 *   - THE OPPOSITE-DIRECTION TWIN: a GENUINELY stale base must still derive a
 *     DIFFERENT hash from the recorded one. A purity fix that also stopped
 *     detecting real staleness would trade a visible refusal for silent data
 *     loss, which is strictly worse.
 * Both directions, every time — a guard that only watches one door is how this
 * estate has shipped a defect and its exact inverse in consecutive rounds.
 */
import { describe, it, expect } from 'vitest';

import { applyStructuralDelete } from '../structural-delete.js';
import { computeExpectedGraphCasHashes } from '../../context/graph-cas-conflict.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

/** The CAS expected-base hash exactly as `dispatch.ts` derives it. */
function casExpected(graph: unknown): string | null {
  return computeExpectedGraphCasHashes(graph).expectedGraphIdentityHash;
}

/**
 * A persisted graph shaped like the ones staging actually holds AFTER a first
 * delete: the projection passes have populated the top-level `options[]` mirror
 * and its `interventions` bags, and `meta.roots` names the factors. Those are
 * precisely the two surfaces `pruneDanglingNodeReferences` writes to — which is
 * why the SECOND delete is the one that broke.
 *
 * `deletable` is a FACTOR referenced from BOTH prune surfaces, so a single
 * fixture exercises both limbs. Per-limb isolation is asserted separately below.
 */
function persistedGraphWithBothPruneSurfaces(): Record<string, unknown> {
  return {
    goal_node_id: 'g',
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
      { from: 'f-gone', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'f-stays', to: 'g', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
    options: [
      {
        id: 'o-launch',
        label: 'Launch now',
        interventions: { 'f-gone': { value: 0.4 }, 'f-stays': { value: 0.7 } },
      },
    ],
    meta: { roots: ['f-gone', 'f-stays'], leaves: ['g'] },
  };
}

function deleteEvent(
  persistedGraph: unknown,
  removedNodeIds: readonly string[],
): SystemEventTurnPayload {
  const baseGraphHash = computeAnalysisAffectingGraphHash(
    persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  return {
    kind: 'system_event',
    scenario_id: '11111111-2222-3333-4444-555555555555',
    turn_id: 'turn-purity-1',
    stage: 'frame',
    event: {
      kind: 'structural_delete',
      removed_node_ids: [...removedNodeIds],
      removed_edges: [],
      base_graph_hash: baseGraphHash,
    },
  } as unknown as SystemEventTurnPayload;
}

function runDelete(persistedGraph: unknown, removedNodeIds: readonly string[]) {
  const payload = deleteEvent(persistedGraph, removedNodeIds);
  return applyStructuralDelete({
    payload,
    event: (payload as unknown as { event: never }).event,
    requestId: 'req-purity',
    persistedGraph,
  });
}

describe('structural_delete — the trusted base is READ-ONLY to the adapter', () => {
  it('returns the persisted graph byte-identical after a delete that prunes BOTH surfaces', () => {
    const persistedGraph = persistedGraphWithBothPruneSurfaces();

    // ── PRECONDITION PINNED IN-TEST (a guard whose fixture silently stops
    // triggering the behaviour is a tautology). Assert the fixture really does
    // carry the removed id on BOTH prune surfaces before we claim anything
    // about what the prune did or did not touch.
    expect((persistedGraph.meta as { roots: string[] }).roots).toContain('f-gone');
    expect(
      Object.keys(
        (persistedGraph.options as Array<{ interventions: Record<string, unknown> }>)[0]!
          .interventions,
      ),
    ).toContain('f-gone');

    const snapshotBefore = JSON.stringify(persistedGraph);
    const hashBefore = casExpected(persistedGraph);
    expect(hashBefore).not.toBeNull();

    const result = runDelete(persistedGraph, ['f-gone']);
    expect(result.kind).toBe('mutated');

    // Bind by IDENTITY to the exact value captured pre-call, never to "some
    // hash": another graph could satisfy a looser predicate.
    expect(casExpected(persistedGraph)).toBe(hashBefore);
    expect(JSON.stringify(persistedGraph)).toBe(snapshotBefore);
  });

  it('sends the CAS an expected base that describes the graph the store actually holds', () => {
    const persistedGraph = persistedGraphWithBothPruneSurfaces();
    // `scenarios.graph_identity_hash` is stamped from the bytes that were
    // written, so this is the value the RPC will compare against.
    const recordedColumnHash = casExpected(persistedGraph);

    const result = runDelete(persistedGraph, ['f-gone']);
    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;

    // Exactly what `dispatch.ts` computes and threads as
    // `p_expected_graph_identity_hash`.
    expect(casExpected(result.baseGraph)).toBe(recordedColumnHash);
  });

  it('still performs the prune — purity must not neuter the removal', () => {
    const persistedGraph = persistedGraphWithBothPruneSurfaces();
    const result = runDelete(persistedGraph, ['f-gone']);
    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;

    const persisted = result.mutatedGraph as Record<string, unknown>;
    const meta = persisted.meta as { roots?: unknown } | undefined;
    expect((meta?.roots as string[] | undefined) ?? []).not.toContain('f-gone');
    for (const holder of [
      ...((persisted.nodes as Array<Record<string, unknown>>) ?? []),
      ...((persisted.options as Array<Record<string, unknown>>) ?? []),
    ]) {
      const bag = holder.interventions;
      if (bag && typeof bag === 'object') {
        expect(Object.keys(bag as Record<string, unknown>)).not.toContain('f-gone');
      }
    }
  });

  it('leaves the base pure when ONLY meta.roots names the removed node', () => {
    const persistedGraph = persistedGraphWithBothPruneSurfaces();
    // Strip the intervention limb so meta.roots is the sole prune surface.
    for (const holder of [
      ...(persistedGraph.nodes as Array<Record<string, unknown>>),
      ...(persistedGraph.options as Array<Record<string, unknown>>),
    ]) {
      if (holder.interventions) delete (holder.interventions as Record<string, unknown>)['f-gone'];
    }
    expect((persistedGraph.meta as { roots: string[] }).roots).toContain('f-gone');

    const snapshotBefore = JSON.stringify(persistedGraph);
    runDelete(persistedGraph, ['f-gone']);
    expect(JSON.stringify(persistedGraph)).toBe(snapshotBefore);
  });

  it('leaves the base pure when ONLY an interventions bag names the removed node', () => {
    const persistedGraph = persistedGraphWithBothPruneSurfaces();
    // Strip the meta limb so the intervention bags are the sole prune surface.
    persistedGraph.meta = { roots: ['f-stays'], leaves: ['g'] };
    expect(
      Object.keys(
        (persistedGraph.options as Array<{ interventions: Record<string, unknown> }>)[0]!
          .interventions,
      ),
    ).toContain('f-gone');

    const snapshotBefore = JSON.stringify(persistedGraph);
    runDelete(persistedGraph, ['f-gone']);
    expect(JSON.stringify(persistedGraph)).toBe(snapshotBefore);
  });

  // ── OPPOSITE-DIRECTION TWIN — MANDATORY ────────────────────────────────────
  // The CAS exists to stop a stale client overwriting newer state. A purity fix
  // that also stopped detecting real staleness would swap a visible refusal for
  // SILENT DATA LOSS. So: prove the detector still fires when the base genuinely
  // IS stale, on the same fixture family, in the same run.
  it('STILL derives a divergent expected base when the client base is genuinely stale', () => {
    // What the store now holds (someone else committed a real change).
    const newerPersisted = persistedGraphWithBothPruneSurfaces();
    (newerPersisted.nodes as Array<Record<string, unknown>>).push({
      id: 'f-new',
      kind: 'factor',
      label: 'Added by a concurrent writer',
    });
    const recordedColumnHash = casExpected(newerPersisted);

    // What THIS turn read before that write landed — a genuinely stale base.
    const staleBase = persistedGraphWithBothPruneSurfaces();
    const result = runDelete(staleBase, ['f-gone']);
    expect(result.kind).toBe('mutated');
    if (result.kind !== 'mutated') return;

    // The RPC compares these two. They MUST still differ, or a stale delete
    // would silently clobber the concurrent writer's node.
    expect(casExpected(result.baseGraph)).not.toBe(recordedColumnHash);
  });
});
