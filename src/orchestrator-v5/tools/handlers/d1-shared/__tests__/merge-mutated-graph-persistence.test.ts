/**
 * V5-D1-SHAPE-01 — D1 mutated-graph persisted-base merge-back.
 *
 * Defect under test (scorecard J5c: options[] → 0 after
 * set_factor_value): `applyAndValidateMutation` merges mutated
 * structural fields back onto the INGRESS top-level shape, but the
 * DGAI wire echo carries only `{nodes, edges}` — never `goal_node_id`,
 * never `options[]` — so committing the D1 `mutated_graph` wholesale
 * replaced the rich draft-persisted `scenarios.graph` with a stripped
 * shape — canonical state loss (goal_node_id gone, options[] → 0,
 * top-level metadata stripped, lossy merge base for future turns,
 * spurious freshness/hash divergence). run_analysis may still succeed
 * because readiness re-derives goal/options from node kinds, so this
 * is corruption, not a guaranteed analysis outage.
 *
 * Fix under test: `mergeMutatedGraphForPersistence` — the mutated
 * nodes/edges (+ goal_constraints when the mutation wrote them) merged
 * onto the PERSISTED `scenarios.graph` base. Sibling of the edit_graph
 * fix (`mergeAppliedGraphForPersistence`, PR #265), whose docblock
 * flagged the D1 ingress-base merge as the remaining gap.
 *
 * Fixtures are the CAPTURED EXP-01 graphs (policy: captured > invented
 * > trimmed): `rich-persisted-graph.json` is the draft-persisted shape
 * and `echo-graph-state.json` the captured DGAI-shaped echo. The
 * decisive cases strip the harness-re-attached `goal_node_id` from the
 * echo so the ingress matches what the real draft wire block carries:
 * `{nodes, edges}` only.
 */

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import {
  applyAndValidateMutation,
  mergeMutatedGraphForPersistence,
  type PersistedGraphV3T,
} from '../apply-graph-mutation.js';

// ── captured fixtures ─────────────────────────────────────────────────────────

const RICH_PERSISTED_GRAPH = JSON.parse(
  readFileSync(
    new URL(
      '../../../../__tests__/fixtures/exp01/rich-persisted-graph.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Record<string, unknown>;

const ECHO_GRAPH_STATE = JSON.parse(
  readFileSync(
    new URL(
      '../../../../__tests__/fixtures/exp01/echo-graph-state.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as Record<string, unknown>;

/**
 * Wire-faithful DGAI ingress: the captured echo minus the
 * harness-re-attached `goal_node_id`. The real draft wire block carries
 * only `{nodes, edges}` — this is a field REMOVAL from a capture, not
 * an invented shape.
 */
const { goal_node_id: _harnessGoal, ...WIRE_ECHO } = ECHO_GRAPH_STATE;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const TARGET_FACTOR = 'fac_hiring_spend';
const REQ = { requestId: 'req-d1-merge-unit', scenarioId: 'scn-d1-merge-unit' };

/**
 * Build a D1 `mutated_graph` exactly the way production builds it:
 * `applyAndValidateMutation` over the wire echo, setting the target
 * factor's observed value (the set_factor_value mutation shape).
 */
function buildMutatedGraphFromWireEcho(newValue = 0.5): PersistedGraphV3T {
  const { mutatedGraph } = applyAndValidateMutation(clone(WIRE_ECHO), (g) => {
    const node = g.nodes.find((n) => n.id === TARGET_FACTOR);
    if (!node?.observed_state) throw new Error('fixture must carry the target factor');
    const before = { value: node.observed_state.value };
    node.observed_state.value = newValue;
    return { before, after: { value: newValue } };
  });
  return mutatedGraph;
}

// ── merge semantics ───────────────────────────────────────────────────────────

describe('mergeMutatedGraphForPersistence — persisted-base precedence', () => {
  it('decisive live-faithful case: persisted base wins goal_node_id + options[] (byte-for-byte); mutated wins nodes/edges with the new factor value applied', () => {
    const persisted = clone(RICH_PERSISTED_GRAPH);
    const mutated = buildMutatedGraphFromWireEcho(0.5);
    // The production-built mutated graph really is the stripped shape —
    // this is the corruption the merge must repair.
    expect(mutated.goal_node_id).toBeUndefined();
    expect(mutated.options).toBeUndefined();

    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph: mutated,
      persistedBase: persisted,
      ...REQ,
    });

    expect(merged.goal_node_id).toBe(persisted.goal_node_id);
    expect(JSON.stringify(merged.options)).toBe(JSON.stringify(persisted.options));
    expect(merged.nodes).toBe(mutated.nodes);
    expect(merged.edges).toBe(mutated.edges);
    const target = (merged.nodes as Array<{ id: string; observed_state?: { value?: number } }>).find(
      (n) => n.id === TARGET_FACTOR,
    );
    expect(target?.observed_state?.value).toBe(0.5);
  });

  it('mutate-one-preserve-rest: exactly the target factor differs; every other node and unknown top-level field survives', () => {
    const persisted = clone(RICH_PERSISTED_GRAPH);
    (persisted as Record<string, unknown>).meta = { provenance: 'draft', version: 7 };
    (persisted as Record<string, unknown>).schema_version = 'v3';
    const baseline = buildMutatedGraphFromWireEcho(
      (clone(WIRE_ECHO).nodes as Array<{ id: string; observed_state?: { value?: number } }>).find(
        (n) => n.id === TARGET_FACTOR,
      )!.observed_state!.value!,
    );
    const mutated = buildMutatedGraphFromWireEcho(0.5);

    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph: mutated,
      persistedBase: persisted,
      ...REQ,
    });

    expect(merged.meta).toEqual({ provenance: 'draft', version: 7 });
    expect(merged.schema_version).toBe('v3');
    const changed = (merged.nodes as Array<{ id: string }>).filter(
      (n, i) =>
        JSON.stringify(n) !== JSON.stringify((baseline.nodes as Array<unknown>)[i]),
    );
    expect(changed.map((n) => n.id)).toEqual([TARGET_FACTOR]);
  });

  it('no options[] dedupe by design: entries survive byte-for-byte even when an option node id is absent from the mutated nodes (no D1 op deletes nodes)', () => {
    const persisted = clone(RICH_PERSISTED_GRAPH);
    (persisted.options as Array<unknown>).push({ id: 'opt_not_in_echo', status: 'ready' });
    const mutated = buildMutatedGraphFromWireEcho(0.5);

    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph: mutated,
      persistedBase: persisted,
      ...REQ,
    });

    expect(JSON.stringify(merged.options)).toBe(JSON.stringify(persisted.options));
  });

  it('goal_constraints overlay (the deliberate asymmetry vs #265): the mutated graph wins when it carries them — D1 add_constraint owns the field', () => {
    const persisted = clone(RICH_PERSISTED_GRAPH);
    (persisted as Record<string, unknown>).goal_constraints = [
      { constraint_id: 'stale', node_id: TARGET_FACTOR, operator: '<=', value: 0.1 },
    ];
    const echoWithNew = {
      ...clone(WIRE_ECHO),
      goal_constraints: [
        { constraint_id: 'c_new', node_id: TARGET_FACTOR, operator: '>=', value: 0.4 },
      ],
    };
    const { mutatedGraph } = applyAndValidateMutation(echoWithNew, (g) => ({
      before: null,
      after: { count: g.nodes.length },
    }));

    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph,
      persistedBase: persisted,
      ...REQ,
    });

    expect(
      (merged.goal_constraints as Array<{ constraint_id: string }>)[0]!.constraint_id,
    ).toBe('c_new');
    // The overlay must not cost the server-authoritative fields.
    expect(merged.goal_node_id).toBe(persisted.goal_node_id);
    expect(JSON.stringify(merged.options)).toBe(JSON.stringify(persisted.options));
  });

  it('set_factor_value case (mutation writes no goal_constraints): the persisted base keeps its own', () => {
    const persisted = clone(RICH_PERSISTED_GRAPH);
    (persisted as Record<string, unknown>).goal_constraints = [
      { constraint_id: 'c_persisted', node_id: TARGET_FACTOR, operator: '>=', value: 0.2 },
    ];
    const mutated = buildMutatedGraphFromWireEcho(0.5);
    expect(mutated.goal_constraints).toBeUndefined();

    const merged = mergeMutatedGraphForPersistence({
      mutatedGraph: mutated,
      persistedBase: persisted,
      ...REQ,
    });

    expect(
      (merged.goal_constraints as Array<{ constraint_id: string }>)[0]!.constraint_id,
    ).toBe('c_persisted');
  });
});

describe('mergeMutatedGraphForPersistence — fallback (NOT a degraded read; that fails closed upstream)', () => {
  it('genuinely-empty persisted base (null) → the mutated ingress-shaped graph is the first valid write', () => {
    const mutated = buildMutatedGraphFromWireEcho(0.5);
    for (const empty of [null, undefined]) {
      const merged = mergeMutatedGraphForPersistence({
        mutatedGraph: mutated,
        persistedBase: empty,
        ...REQ,
      });
      expect(merged).toBe(mutated);
    }
  });

  it('malformed-but-readable persisted base (not an object / missing arrays) → heal forward via the mutated graph', () => {
    const mutated = buildMutatedGraphFromWireEcho(0.5);
    for (const badBase of ['corrupt', 42, [], { nodes: 'x', edges: [] }, { edges: [] }]) {
      const merged = mergeMutatedGraphForPersistence({
        mutatedGraph: mutated,
        persistedBase: badBase,
        ...REQ,
      });
      expect(merged).toBe(mutated);
    }
  });
});
