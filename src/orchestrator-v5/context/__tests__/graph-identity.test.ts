/**
 * Group A — unit tests for the CEE-local `graphIdentityHash` foundation
 * (graph-identity.ts). Proves the two-hash / two-projection contract
 * (Olumi_Cross_Workstream_Graph_Data_Contract_v0.2 §8–§11):
 *
 *   - identity normalisation is deterministic and order-invariant;
 *   - graphIdentityHash captures FULL persisted identity (labels, provenance,
 *     layout) while analysisAffectingHash stays analysis-only;
 *   - transient UI state moves NEITHER hash;
 *   - graphIdentityHash is NOT the topology-only hash;
 *   - the existing analysisAffectingHash is byte-stable (golden pins);
 *   - the pure CAS evaluator reports the four dark/observe outcomes.
 *
 * Fixtures mirror the realistic GraphV3 shapes used in graph-hash.test.ts.
 */
import { describe, it, expect } from 'vitest';

import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import {
  computeAnalysisAffectingGraphHash,
  computeDeterministicGraphHash,
} from '../graph-hash.js';
import {
  computeAnalysisAffectingHashRecord,
  computeGraphIdentityHash,
  evaluateGraphIdentityCas,
  normaliseGraphForIdentity,
  GRAPH_SCHEMA_VERSION,
  IDENTITY_NORMALISER_VERSION,
  IDENTITY_PROJECTION_VERSION,
  ANALYSIS_NORMALISER_VERSION,
  ANALYSIS_PROJECTION_VERSION,
} from '../graph-identity.js';

// ---------------------------------------------------------------------------
// Fixture builders — permissive GraphStateIngress (the boundary type the live
// hashers consume). `.passthrough()` semantics mean display/provenance/layout
// fields ride along untouched, exactly as they do on the wire.
// ---------------------------------------------------------------------------

interface BuildOpts {
  nodes?: unknown[];
  edges?: unknown[];
  options?: unknown[];
  goal_node_id?: string;
  goal_constraints?: unknown[];
  [key: string]: unknown;
}

// The fixtures build permissive, wire-shaped graphs from loose literals; route
// them through this single `unknown`-typed cast rather than a double cast
// (which the boundary-pattern ratchet counts).
function ingress(graph: unknown): GraphStateIngress {
  return graph as GraphStateIngress;
}

function buildGraph(opts: BuildOpts): GraphStateIngress {
  const { nodes, edges, ...rest } = opts;
  return ingress({
    nodes: nodes ?? [],
    edges: edges ?? [],
    ...rest,
  });
}

const factor = (id: string, value: number, label = `${id}-label`): Record<string, unknown> => ({
  id,
  kind: 'factor',
  label,
  category: 'controllable',
  observed_state: { value, baseline: value, unit: 'GBP', source: 'brief_extraction' },
});

const edge = (from: string, to: string, mean: number): Record<string, unknown> => ({
  from,
  to,
  strength: { mean, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: mean >= 0 ? 'positive' : 'negative',
});

// ===========================================================================
// A1 — identity normalisation
// ===========================================================================

describe('normaliseGraphForIdentity', () => {
  it('null / undefined / identity-empty → null', () => {
    expect(normaliseGraphForIdentity(null)).toBeNull();
    expect(normaliseGraphForIdentity(undefined)).toBeNull();
    expect(normaliseGraphForIdentity(buildGraph({}))).toBeNull();
  });

  it('carries the versioned projection envelope', () => {
    const n = normaliseGraphForIdentity(buildGraph({ nodes: [factor('a', 1)] }));
    expect(n).not.toBeNull();
    expect(n!.schema_version).toBe(GRAPH_SCHEMA_VERSION);
    expect(n!.normaliser_version).toBe(IDENTITY_NORMALISER_VERSION);
    expect(n!.projection_version).toBe(IDENTITY_PROJECTION_VERSION);
  });

  it('preserves display/provenance fields (full fidelity)', () => {
    const n = normaliseGraphForIdentity(
      buildGraph({
        nodes: [{ id: 'a', kind: 'factor', label: 'Budget', description: 'the money', provenance: 'from_brief' }],
      }),
    );
    const node = (n!.graph as { nodes: Array<Record<string, unknown>> }).nodes[0]!;
    expect(node.label).toBe('Budget');
    expect(node.description).toBe('the money');
    expect(node.provenance).toBe('from_brief');
  });

  it('retains top-level graph keys beyond nodes/edges/options', () => {
    const n = normaliseGraphForIdentity(
      buildGraph({ nodes: [factor('a', 1)], schema_version: 'v3', custom_persisted: { k: 1 } }),
    );
    const g = n!.graph as Record<string, unknown>;
    expect(g.schema_version).toBe('v3');
    expect(g.custom_persisted).toEqual({ k: 1 });
  });
});

// ===========================================================================
// A2 — graphIdentityHash
// ===========================================================================

describe('computeGraphIdentityHash', () => {
  it('null / undefined / identity-empty → null (mirrors analysis hash)', () => {
    expect(computeGraphIdentityHash(null)).toBeNull();
    expect(computeGraphIdentityHash(undefined)).toBeNull();
    expect(computeGraphIdentityHash(buildGraph({}))).toBeNull();
  });

  it('is a full 64-char hex sha256 envelope', () => {
    const h = computeGraphIdentityHash(buildGraph({ nodes: [factor('a', 1)] }));
    expect(h).not.toBeNull();
    expect(h!.kind).toBe('graph_identity_hash');
    expect(h!.algorithm).toBe('sha256');
    expect(h!.value).toMatch(/^[0-9a-f]{64}$/);
    expect(h!.projection_version).toBe(IDENTITY_PROJECTION_VERSION);
    expect(h!.graph_schema_version).toBe(GRAPH_SCHEMA_VERSION);
    expect(h!.normaliser_version).toBe(IDENTITY_NORMALISER_VERSION);
  });

  it('same graph → same hash (determinism)', () => {
    const g = buildGraph({
      nodes: [factor('a', 10), factor('b', 20)],
      edges: [edge('a', 'b', 0.5)],
      options: [{ id: 'opt-1', status: 'ready', interventions: {} }],
      goal_node_id: 'goal',
    });
    expect(computeGraphIdentityHash(g)!.value).toBe(computeGraphIdentityHash(g)!.value);
  });

  it('node insertion order does not change the hash', () => {
    const g1 = buildGraph({ nodes: [factor('a', 10), factor('b', 20), factor('c', 30)] });
    const g2 = buildGraph({ nodes: [factor('c', 30), factor('a', 10), factor('b', 20)] });
    expect(computeGraphIdentityHash(g1)!.value).toBe(computeGraphIdentityHash(g2)!.value);
  });

  it('edge insertion order does not change the hash', () => {
    const g1 = buildGraph({
      nodes: [factor('a', 0), factor('b', 0), factor('c', 0)],
      edges: [edge('a', 'b', 0.5), edge('b', 'c', 0.5)],
    });
    const g2 = buildGraph({
      nodes: [factor('a', 0), factor('b', 0), factor('c', 0)],
      edges: [edge('b', 'c', 0.5), edge('a', 'b', 0.5)],
    });
    expect(computeGraphIdentityHash(g1)!.value).toBe(computeGraphIdentityHash(g2)!.value);
  });

  it('object key order within a node does not change the hash', () => {
    const g1 = buildGraph({ nodes: [{ id: 'a', kind: 'factor', label: 'A' }] });
    const g2 = buildGraph({ nodes: [{ label: 'A', kind: 'factor', id: 'a' }] });
    expect(computeGraphIdentityHash(g1)!.value).toBe(computeGraphIdentityHash(g2)!.value);
  });

  it('parallel edges (same from,to) hash order-invariantly', () => {
    const g1 = buildGraph({
      nodes: [factor('a', 0), factor('b', 0)],
      edges: [
        { ...edge('a', 'b', 0.5), edge_type: 'directed' },
        { ...edge('a', 'b', 0.5), edge_type: 'bidirected' },
      ],
    });
    const g2 = buildGraph({
      nodes: [factor('a', 0), factor('b', 0)],
      edges: [
        { ...edge('a', 'b', 0.5), edge_type: 'bidirected' },
        { ...edge('a', 'b', 0.5), edge_type: 'directed' },
      ],
    });
    expect(computeGraphIdentityHash(g1)!.value).toBe(computeGraphIdentityHash(g2)!.value);
  });
});

// ===========================================================================
// The two-hash split — the heart of the Group A contract
// ===========================================================================

describe('identity vs analysis hash — split behaviour', () => {
  it('label-only edit → identity hash CHANGES, analysis hash UNCHANGED', () => {
    const g1 = buildGraph({ nodes: [factor('budget', 100, 'Budget')] });
    const g2 = buildGraph({ nodes: [factor('budget', 100, 'Total Budget')] });

    expect(computeGraphIdentityHash(g1)!.value).not.toBe(computeGraphIdentityHash(g2)!.value);
    expect(computeAnalysisAffectingGraphHash(g1)).toBe(computeAnalysisAffectingGraphHash(g2));
  });

  it('description / provenance edit → identity CHANGES, analysis UNCHANGED', () => {
    const g1 = buildGraph({
      nodes: [{ id: 'f', kind: 'factor', description: 'foo', provenance: 'from_brief', observed_state: { value: 100 } }],
    });
    const g2 = buildGraph({
      nodes: [{ id: 'f', kind: 'factor', description: 'bar', provenance: 'ai_inferred', observed_state: { value: 100 } }],
    });
    expect(computeGraphIdentityHash(g1)!.value).not.toBe(computeGraphIdentityHash(g2)!.value);
    expect(computeAnalysisAffectingGraphHash(g1)).toBe(computeAnalysisAffectingGraphHash(g2));
  });

  it('persisted layout edit → identity CHANGES, analysis UNCHANGED (display identity, §10)', () => {
    const g1 = buildGraph({ nodes: [{ ...factor('a', 100), position: { x: 0, y: 0 } }] });
    const g2 = buildGraph({ nodes: [{ ...factor('a', 100), position: { x: 400, y: 250 } }] });
    expect(computeGraphIdentityHash(g1)!.value).not.toBe(computeGraphIdentityHash(g2)!.value);
    expect(computeAnalysisAffectingGraphHash(g1)).toBe(computeAnalysisAffectingGraphHash(g2));
  });

  it('value edit (observed_state.value) → BOTH hashes change', () => {
    const g1 = buildGraph({ nodes: [factor('budget', 100)] });
    const g2 = buildGraph({ nodes: [factor('budget', 200)] });
    expect(computeGraphIdentityHash(g1)!.value).not.toBe(computeGraphIdentityHash(g2)!.value);
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(computeAnalysisAffectingGraphHash(g2));
  });

  it('edge strength edit → BOTH hashes change', () => {
    const g1 = buildGraph({ nodes: [factor('a', 0), factor('b', 0)], edges: [edge('a', 'b', 0.5)] });
    const g2 = buildGraph({ nodes: [factor('a', 0), factor('b', 0)], edges: [edge('a', 'b', 0.9)] });
    expect(computeGraphIdentityHash(g1)!.value).not.toBe(computeGraphIdentityHash(g2)!.value);
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(computeAnalysisAffectingGraphHash(g2));
  });

  it('option intervention edit → BOTH hashes change', () => {
    const g1 = buildGraph({
      options: [{ id: 'opt-1', status: 'ready', interventions: { budget: { value: 100, target_match: { node_id: 'budget' } } } }],
    });
    const g2 = buildGraph({
      options: [{ id: 'opt-1', status: 'ready', interventions: { budget: { value: 250, target_match: { node_id: 'budget' } } } }],
    });
    expect(computeGraphIdentityHash(g1)!.value).not.toBe(computeGraphIdentityHash(g2)!.value);
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(computeAnalysisAffectingGraphHash(g2));
  });

  it('transient UI state (selection/hover/viewport) → NEITHER hash changes', () => {
    const clean = buildGraph({ nodes: [factor('a', 100), factor('b', 50)], edges: [edge('a', 'b', 0.5)] });
    const withUi = buildGraph({
      nodes: [
        { ...factor('a', 100), selected: true, hovered: true, isSelected: true },
        factor('b', 50),
      ],
      edges: [{ ...edge('a', 'b', 0.5), dragging: true }],
      viewport: { zoom: 2, panX: 100, panY: -50 },
      ui_state: { openPanel: 'inspector' },
    });
    expect(computeGraphIdentityHash(withUi)!.value).toBe(computeGraphIdentityHash(clean)!.value);
    expect(computeAnalysisAffectingGraphHash(withUi)).toBe(computeAnalysisAffectingGraphHash(clean));
  });

  it('a persisted field named `active` is NOT stripped — it changes identity (fail-safe polarity)', () => {
    // Over-excluding a real field would collapse two different graphs to the
    // same identity hash (a false CAS match → silent overwrite). The strip
    // list therefore avoids bare domain words; `active` must count as identity.
    const g1 = buildGraph({ nodes: [{ ...factor('a', 100), active: true }] });
    const g2 = buildGraph({ nodes: [{ ...factor('a', 100), active: false }] });
    expect(computeGraphIdentityHash(g1)!.value).not.toBe(computeGraphIdentityHash(g2)!.value);
  });

  it('duplicate-id nodes with canonically-equivalent Unicode labels hash order-invariantly', () => {
    // localeCompare regression pin: 'Á' precomposed (U+00C1) vs decomposed
    // (U+0041 U+0301) are DISTINCT strings that locale collation treats as
    // equal. A collation-based tiebreak returns 0, the stable sort preserves
    // insertion order, and insertion order leaks into the hash. The codepoint
    // total-order comparator must keep this order-invariant.
    const precomposed = { id: 'n', kind: 'factor', label: 'Á' };
    const decomposed = { id: 'n', kind: 'factor', label: 'Á' };
    const g1 = buildGraph({ nodes: [precomposed, decomposed] });
    const g2 = buildGraph({ nodes: [decomposed, precomposed] });
    expect(computeGraphIdentityHash(g1)!.value).toBe(computeGraphIdentityHash(g2)!.value);
  });

  it('graphIdentityHash is NOT the topology-only hash (§2.2)', () => {
    const g = buildGraph({ nodes: [factor('a', 100), factor('b', 200)], edges: [edge('a', 'b', 0.5)] });
    const identity = computeGraphIdentityHash(g)!.value;
    const topology = computeDeterministicGraphHash(g);
    // Different hashers by construction (full 64-hex identity vs 16-hex
    // topology marker) — not merely different strings.
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
    expect(topology).toMatch(/^[0-9a-f]{16}$/);
    // The load-bearing discriminator: a label-only edit does NOT move the
    // topology hash (id-only) but DOES move identity.
    const g2 = buildGraph({ nodes: [factor('a', 100, 'renamed'), factor('b', 200)], edges: [edge('a', 'b', 0.5)] });
    expect(computeDeterministicGraphHash(g2)).toBe(topology);
    expect(computeGraphIdentityHash(g2)!.value).not.toBe(identity);
  });

  it('own `__proto__` key is identity-bearing, not silently dropped (collision guard)', () => {
    // JSON.parse of wire JSON can produce an own `__proto__` key that survives
    // the .passthrough() boundary. A plain-object accumulator would route it
    // through the prototype setter and drop it, collapsing two different graphs
    // to one identity hash (a false CAS match). The null-proto accumulators
    // (here + in stableStringify) must keep it distinguishing.
    const withProto = buildGraph({
      nodes: [{ ...factor('a', 100), ...JSON.parse('{"__proto__":{"evil":true}}') }],
    });
    const without = buildGraph({ nodes: [factor('a', 100)] });
    expect(computeGraphIdentityHash(withProto)).not.toBeNull();
    expect(computeGraphIdentityHash(withProto)!.value).not.toBe(
      computeGraphIdentityHash(without)!.value,
    );
    // And it stays deterministic (recompute is stable, no prototype pollution).
    expect(computeGraphIdentityHash(withProto)!.value).toBe(
      computeGraphIdentityHash(withProto)!.value,
    );
  });
});

// ===========================================================================
// Golden byte-parity pins — lock the EXISTING analysisAffectingHash against
// silent drift, and pin the topology + new identity hashes for this fixture.
// ===========================================================================

describe('golden byte-parity pins', () => {
  const golden = buildGraph({
    nodes: [
      { id: 'budget', kind: 'factor', label: 'Budget', category: 'controllable', observed_state: { value: 100, baseline: 100, unit: 'GBP', source: 'brief_extraction' } },
      { id: 'goal', kind: 'goal', label: 'Success', goal_threshold: 0.8 },
    ],
    edges: [
      { from: 'budget', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
    options: [
      { id: 'opt-1', status: 'ready', is_baseline: true, interventions: { budget: { value: 100, target_match: { node_id: 'budget' } } } },
    ],
    goal_node_id: 'goal',
  });

  it('analysisAffectingHash is byte-stable (drift tripwire)', () => {
    expect(computeAnalysisAffectingGraphHash(golden)).toBe('e48d776aa7552f74');
  });

  it('topology hash is byte-stable', () => {
    expect(computeDeterministicGraphHash(golden)).toBe('28e19422268bc80d');
  });

  it('graphIdentityHash is byte-stable', () => {
    expect(computeGraphIdentityHash(golden)!.value).toBe(
      '31abe2cb8a0d5e246e1e6261378b5872f64b50637f4a28398f97aaa08b035333',
    );
  });
});

// ===========================================================================
// §9.1 envelope over the existing analysis-affecting hash (delegation only)
// ===========================================================================

describe('computeAnalysisAffectingHashRecord', () => {
  it('wraps the existing hash value without changing it', () => {
    const g = buildGraph({ nodes: [factor('a', 1)] });
    const record = computeAnalysisAffectingHashRecord(g);
    expect(record).not.toBeNull();
    expect(record!.kind).toBe('analysis_affecting_hash');
    expect(record!.value).toBe(computeAnalysisAffectingGraphHash(g));
    expect(record!.algorithm).toBe('sha256');
    // §9.1 envelope version metadata is populated from the module constants.
    expect(record!.projection_version).toBe(ANALYSIS_PROJECTION_VERSION);
    expect(record!.graph_schema_version).toBe(GRAPH_SCHEMA_VERSION);
    expect(record!.normaliser_version).toBe(ANALYSIS_NORMALISER_VERSION);
  });

  it('null graph → null record', () => {
    expect(computeAnalysisAffectingHashRecord(null)).toBeNull();
  });
});

// ===========================================================================
// A3 dark/observe seam — pure CAS evaluator (NOT wired)
// ===========================================================================

describe('evaluateGraphIdentityCas', () => {
  const graph = buildGraph({ nodes: [factor('a', 100)] });
  const currentHash = computeGraphIdentityHash(graph)!.value;

  it('match — expected equals current', () => {
    const r = evaluateGraphIdentityCas(currentHash, graph);
    expect(r.outcome).toBe('match');
    expect(r.currentHash).toBe(currentHash);
  });

  it('mismatch — expected differs from current', () => {
    const r = evaluateGraphIdentityCas('deadbeef'.repeat(8), graph);
    expect(r.outcome).toBe('mismatch');
    expect(r.currentHash).toBe(currentHash);
  });

  it('no_expected — observe-only, not a conflict (existing callers stay safe)', () => {
    expect(evaluateGraphIdentityCas(null, graph).outcome).toBe('no_expected');
    expect(evaluateGraphIdentityCas(undefined, graph).outcome).toBe('no_expected');
    expect(evaluateGraphIdentityCas('', graph).outcome).toBe('no_expected');
  });

  it('unavailable — current graph has no computable identity (takes precedence)', () => {
    const r = evaluateGraphIdentityCas(currentHash, buildGraph({}));
    expect(r.outcome).toBe('unavailable');
    expect(r.currentHash).toBeNull();
  });
});
