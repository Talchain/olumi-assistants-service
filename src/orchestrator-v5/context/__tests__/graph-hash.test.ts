/**
 * Unit tests for computeDeterministicGraphHash (Phase 1.5 D3) and
 * computeAnalysisAffectingGraphHash (V5 state-trust freshness derivation).
 */
import { describe, it, expect } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import {
  computeAnalysisAffectingGraphHash,
  computeDeterministicGraphHash,
} from '../graph-hash.js';

function mkGraph(nodes: Array<{ id: string }>, edges: Array<{ from: string; to: string }>): GraphV3T {
  // Cast minimal shape; the hash reads only id + from/to.
  return {
    nodes: nodes.map((n) => ({ ...n, kind: 'factor', label: n.id })),
    edges: edges.map((e) => ({
      ...e,
      strength: { mean: 0, std: 1 },
      exists_probability: 1,
      effect_direction: 'positive',
    })),
  } as unknown as GraphV3T;
}

describe('computeDeterministicGraphHash', () => {
  it('same input → same output', () => {
    const g = mkGraph([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);
    const h1 = computeDeterministicGraphHash(g);
    const h2 = computeDeterministicGraphHash(g);
    expect(h1).toBe(h2);
    expect(h1).not.toBeNull();
  });

  it('permuting node order → same output', () => {
    const g1 = mkGraph([{ id: 'a' }, { id: 'b' }, { id: 'c' }], []);
    const g2 = mkGraph([{ id: 'c' }, { id: 'a' }, { id: 'b' }], []);
    expect(computeDeterministicGraphHash(g1)).toBe(computeDeterministicGraphHash(g2));
  });

  it('permuting edge order → same output', () => {
    const g1 = mkGraph(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    );
    const g2 = mkGraph(
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      [
        { from: 'b', to: 'c' },
        { from: 'a', to: 'b' },
      ],
    );
    expect(computeDeterministicGraphHash(g1)).toBe(computeDeterministicGraphHash(g2));
  });

  it('different node set → different hash', () => {
    const g1 = mkGraph([{ id: 'a' }, { id: 'b' }], []);
    const g2 = mkGraph([{ id: 'a' }, { id: 'c' }], []);
    expect(computeDeterministicGraphHash(g1)).not.toBe(computeDeterministicGraphHash(g2));
  });

  it('different edge set → different hash', () => {
    const g1 = mkGraph([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);
    const g2 = mkGraph([{ id: 'a' }, { id: 'b' }], [{ from: 'b', to: 'a' }]);
    expect(computeDeterministicGraphHash(g1)).not.toBe(computeDeterministicGraphHash(g2));
  });

  it('null graph → null', () => {
    expect(computeDeterministicGraphHash(null)).toBeNull();
  });

  it('undefined graph → null', () => {
    expect(computeDeterministicGraphHash(undefined)).toBeNull();
  });

  it('empty nodes + edges → null', () => {
    const g = mkGraph([], []);
    expect(computeDeterministicGraphHash(g)).toBeNull();
  });

  it('hash is 16-char hex', () => {
    const g = mkGraph([{ id: 'a' }, { id: 'b' }], [{ from: 'a', to: 'b' }]);
    const h = computeDeterministicGraphHash(g);
    expect(h).not.toBeNull();
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('ignores passthrough node fields when hashing', () => {
    // Hash input is node identity only; structural drift does not change hash.
    const g1 = mkGraph([{ id: 'a' }], []);
    const gWithExtras = {
      nodes: [{ id: 'a', kind: 'factor', label: 'A', observed_state: { value: 99 } }],
      edges: [],
    } as unknown as GraphV3T;
    expect(computeDeterministicGraphHash(g1)).toBe(computeDeterministicGraphHash(gWithExtras));
  });
});

// ---------------------------------------------------------------------------
// computeAnalysisAffectingGraphHash — V5 state-trust freshness derivation.
//
// Contract: includes EVERY field that affects analysis output; excludes
// labels, descriptions, provenance, and other display/cosmetic fields.
// ---------------------------------------------------------------------------

interface BuildOpts {
  nodes?: unknown[];
  edges?: unknown[];
  options?: unknown[];
  goal_node_id?: string;
  goal_constraints?: unknown[];
}

function buildGraph(opts: BuildOpts): GraphV3T {
  return {
    nodes: opts.nodes ?? [],
    edges: opts.edges ?? [],
    options: opts.options,
    goal_node_id: opts.goal_node_id,
    goal_constraints: opts.goal_constraints,
  } as unknown as GraphV3T;
}

const baseFactor = (id: string, value: number): Record<string, unknown> => ({
  id,
  kind: 'factor',
  label: `${id}-label`,
  category: 'controllable',
  observed_state: { value, baseline: value, unit: 'GBP', source: 'brief_extraction' },
});

const baseEdge = (from: string, to: string, mean: number): Record<string, unknown> => ({
  from,
  to,
  strength: { mean, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: mean >= 0 ? 'positive' : 'negative',
});

describe('computeAnalysisAffectingGraphHash', () => {
  it('null / undefined / empty → null', () => {
    expect(computeAnalysisAffectingGraphHash(null)).toBeNull();
    expect(computeAnalysisAffectingGraphHash(undefined)).toBeNull();
    expect(computeAnalysisAffectingGraphHash(buildGraph({}))).toBeNull();
  });

  it('hash format is 16 hex chars', () => {
    const g = buildGraph({
      nodes: [baseFactor('budget', 100)],
      edges: [],
    });
    const h = computeAnalysisAffectingGraphHash(g);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('same input → same output (determinism)', () => {
    const g = buildGraph({
      nodes: [baseFactor('a', 10), baseFactor('b', 20)],
      edges: [baseEdge('a', 'b', 0.5)],
      options: [{ id: 'opt-1', status: 'ready', interventions: {} }],
      goal_node_id: 'goal-1',
    });
    expect(computeAnalysisAffectingGraphHash(g)).toBe(computeAnalysisAffectingGraphHash(g));
  });

  it('node insertion order does not change hash', () => {
    const g1 = buildGraph({
      nodes: [baseFactor('a', 10), baseFactor('b', 20), baseFactor('c', 30)],
      edges: [],
    });
    const g2 = buildGraph({
      nodes: [baseFactor('c', 30), baseFactor('a', 10), baseFactor('b', 20)],
      edges: [],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).toBe(computeAnalysisAffectingGraphHash(g2));
  });

  // ─── analysis-affecting field changes (hash MUST change) ──────────────

  it('value-only edit (observed_state.value) changes hash — the audit fix', () => {
    const g1 = buildGraph({ nodes: [baseFactor('budget', 100)], edges: [] });
    const g2 = buildGraph({ nodes: [baseFactor('budget', 200)], edges: [] });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('observed_state.baseline change → hash changes', () => {
    const g1 = buildGraph({
      nodes: [{ id: 'f', kind: 'factor', observed_state: { value: 100, baseline: 50 } }],
      edges: [],
    });
    const g2 = buildGraph({
      nodes: [{ id: 'f', kind: 'factor', observed_state: { value: 100, baseline: 75 } }],
      edges: [],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('node category change → hash changes', () => {
    const g1 = buildGraph({
      nodes: [{ id: 'f', kind: 'factor', category: 'controllable' }],
      edges: [],
    });
    const g2 = buildGraph({
      nodes: [{ id: 'f', kind: 'factor', category: 'observable' }],
      edges: [],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('node kind change → hash changes', () => {
    const g1 = buildGraph({ nodes: [{ id: 'n', kind: 'factor' }], edges: [] });
    const g2 = buildGraph({ nodes: [{ id: 'n', kind: 'goal' }], edges: [] });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('goal_threshold change → hash changes', () => {
    const g1 = buildGraph({
      nodes: [{ id: 'goal', kind: 'goal', goal_threshold: 0.5 }],
      edges: [],
    });
    const g2 = buildGraph({
      nodes: [{ id: 'goal', kind: 'goal', goal_threshold: 0.8 }],
      edges: [],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('intercept change → hash changes', () => {
    const g1 = buildGraph({
      nodes: [{ id: 'r', kind: 'factor', intercept: 0.1 }],
      edges: [],
    });
    const g2 = buildGraph({
      nodes: [{ id: 'r', kind: 'factor', intercept: 0.5 }],
      edges: [],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('prior distribution change → hash changes', () => {
    const g1 = buildGraph({
      nodes: [
        { id: 'r', kind: 'factor', prior: { distribution: 'normal', range_min: 0, range_max: 1 } },
      ],
      edges: [],
    });
    const g2 = buildGraph({
      nodes: [
        { id: 'r', kind: 'factor', prior: { distribution: 'normal', range_min: 0, range_max: 2 } },
      ],
      edges: [],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('edge strength.mean change → hash changes', () => {
    const g1 = buildGraph({
      nodes: [baseFactor('a', 0), baseFactor('b', 0)],
      edges: [baseEdge('a', 'b', 0.5)],
    });
    const g2 = buildGraph({
      nodes: [baseFactor('a', 0), baseFactor('b', 0)],
      edges: [baseEdge('a', 'b', 0.7)],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('edge exists_probability change → hash changes', () => {
    const g1 = buildGraph({
      nodes: [baseFactor('a', 0), baseFactor('b', 0)],
      edges: [{ ...baseEdge('a', 'b', 0.5), exists_probability: 0.9 }],
    });
    const g2 = buildGraph({
      nodes: [baseFactor('a', 0), baseFactor('b', 0)],
      edges: [{ ...baseEdge('a', 'b', 0.5), exists_probability: 0.4 }],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('edge_type (directed → bidirected) change → hash changes', () => {
    const g1 = buildGraph({
      nodes: [baseFactor('a', 0), baseFactor('b', 0)],
      edges: [{ ...baseEdge('a', 'b', 0.5), edge_type: 'directed' }],
    });
    const g2 = buildGraph({
      nodes: [baseFactor('a', 0), baseFactor('b', 0)],
      edges: [{ ...baseEdge('a', 'b', 0.5), edge_type: 'bidirected' }],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('option intervention value change → hash changes', () => {
    const g1 = buildGraph({
      options: [
        {
          id: 'opt-1',
          status: 'ready',
          interventions: {
            budget: { value: 100, target_match: { node_id: 'budget' } },
          },
        },
      ],
    });
    const g2 = buildGraph({
      options: [
        {
          id: 'opt-1',
          status: 'ready',
          interventions: {
            budget: { value: 250, target_match: { node_id: 'budget' } },
          },
        },
      ],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('option is_baseline flip → hash changes', () => {
    const g1 = buildGraph({
      options: [
        { id: 'a', status: 'ready', is_baseline: true, interventions: {} },
        { id: 'b', status: 'ready', is_baseline: false, interventions: {} },
      ],
    });
    const g2 = buildGraph({
      options: [
        { id: 'a', status: 'ready', is_baseline: false, interventions: {} },
        { id: 'b', status: 'ready', is_baseline: true, interventions: {} },
      ],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  it('goal_node_id change → hash changes', () => {
    const g1 = buildGraph({
      nodes: [baseFactor('a', 0)],
      goal_node_id: 'goal-1',
    });
    const g2 = buildGraph({
      nodes: [baseFactor('a', 0)],
      goal_node_id: 'goal-2',
    });
    expect(computeAnalysisAffectingGraphHash(g1)).not.toBe(
      computeAnalysisAffectingGraphHash(g2),
    );
  });

  // ─── cosmetic / provenance fields (hash MUST stay equal) ──────────────

  it('label-only edit → hash unchanged (cosmetic)', () => {
    const g1 = buildGraph({
      nodes: [{ id: 'f', kind: 'factor', label: 'Budget', observed_state: { value: 100 } }],
      edges: [],
    });
    const g2 = buildGraph({
      nodes: [{ id: 'f', kind: 'factor', label: 'Total Budget', observed_state: { value: 100 } }],
      edges: [],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).toBe(computeAnalysisAffectingGraphHash(g2));
  });

  it('description / display_value edits → hash unchanged', () => {
    const g1 = buildGraph({
      nodes: [
        { id: 'f', kind: 'factor', description: 'foo', display_value: '£100', observed_state: { value: 100 } },
      ],
      edges: [],
    });
    const g2 = buildGraph({
      nodes: [
        { id: 'f', kind: 'factor', description: 'bar', display_value: '£200', observed_state: { value: 100 } },
      ],
      edges: [],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).toBe(computeAnalysisAffectingGraphHash(g2));
  });

  it('observed_state.unit / source / raw_value edits → hash unchanged', () => {
    const g1 = buildGraph({
      nodes: [
        {
          id: 'f',
          kind: 'factor',
          observed_state: {
            value: 100,
            unit: 'GBP',
            source: 'brief_extraction',
            raw_value: 100,
            extractionType: 'explicit',
          },
        },
      ],
      edges: [],
    });
    const g2 = buildGraph({
      nodes: [
        {
          id: 'f',
          kind: 'factor',
          observed_state: {
            value: 100,
            unit: 'USD',
            source: 'cee_inference',
            raw_value: 99,
            extractionType: 'inferred',
          },
        },
      ],
      edges: [],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).toBe(computeAnalysisAffectingGraphHash(g2));
  });

  it('node provenance edits → hash unchanged', () => {
    const g1 = buildGraph({
      nodes: [
        {
          id: 'f',
          kind: 'factor',
          provenance: 'from_brief',
          provenance_display: 'from_brief',
          observed_state: { value: 100 },
        },
      ],
      edges: [],
    });
    const g2 = buildGraph({
      nodes: [
        {
          id: 'f',
          kind: 'factor',
          provenance: 'ai_inferred',
          provenance_display: 'ai_inferred',
          observed_state: { value: 100 },
        },
      ],
      edges: [],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).toBe(computeAnalysisAffectingGraphHash(g2));
  });

  it('edge provenance / origin / validation edits → hash unchanged', () => {
    const g1 = buildGraph({
      nodes: [baseFactor('a', 0), baseFactor('b', 0)],
      edges: [
        {
          ...baseEdge('a', 'b', 0.5),
          provenance: { source: 'brief_extraction', reasoning: 'X' },
          origin: 'ai',
          validation: { something: true },
          defaulted: false,
        },
      ],
    });
    const g2 = buildGraph({
      nodes: [baseFactor('a', 0), baseFactor('b', 0)],
      edges: [
        {
          ...baseEdge('a', 'b', 0.5),
          provenance: { source: 'user_specified', reasoning: 'Y' },
          origin: 'user',
          validation: { something: false },
          defaulted: true,
        },
      ],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).toBe(computeAnalysisAffectingGraphHash(g2));
  });

  it('intervention unit / source / reasoning / display_value / target_match.confidence → hash unchanged', () => {
    const g1 = buildGraph({
      options: [
        {
          id: 'opt-1',
          status: 'ready',
          interventions: {
            budget: {
              value: 100,
              unit: 'GBP',
              source: 'brief_extraction',
              reasoning: 'X',
              value_confidence: 'high',
              display_value: '£100',
              target_match: { node_id: 'budget', match_type: 'exact_id', confidence: 'high' },
            },
          },
        },
      ],
    });
    const g2 = buildGraph({
      options: [
        {
          id: 'opt-1',
          status: 'ready',
          interventions: {
            budget: {
              value: 100,
              unit: 'USD',
              source: 'user_specified',
              reasoning: 'Y',
              value_confidence: 'low',
              display_value: '$100',
              target_match: { node_id: 'budget', match_type: 'semantic', confidence: 'low' },
            },
          },
        },
      ],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).toBe(computeAnalysisAffectingGraphHash(g2));
  });

  // ─── canonicalisation: insertion order, key order ─────────────────────

  it('factor key order in interventions does not change hash', () => {
    const g1 = buildGraph({
      options: [
        {
          id: 'opt-1',
          status: 'ready',
          interventions: {
            a: { value: 1, target_match: { node_id: 'a' } },
            b: { value: 2, target_match: { node_id: 'b' } },
          },
        },
      ],
    });
    const g2 = buildGraph({
      options: [
        {
          id: 'opt-1',
          status: 'ready',
          interventions: {
            b: { value: 2, target_match: { node_id: 'b' } },
            a: { value: 1, target_match: { node_id: 'a' } },
          },
        },
      ],
    });
    expect(computeAnalysisAffectingGraphHash(g1)).toBe(computeAnalysisAffectingGraphHash(g2));
  });

  // ─── parity check: topology hash and analysis-affecting hash differ ──

  it('topology and analysis hashes are independent — value edit does not move topology hash', () => {
    const topo1 = buildGraph({ nodes: [baseFactor('f', 100)], edges: [] });
    const topo2 = buildGraph({ nodes: [baseFactor('f', 200)], edges: [] });
    // Topology hash unchanged (id only)
    expect(computeDeterministicGraphHash(topo1)).toBe(computeDeterministicGraphHash(topo2));
    // Analysis hash changed (captures observed_state.value)
    expect(computeAnalysisAffectingGraphHash(topo1)).not.toBe(
      computeAnalysisAffectingGraphHash(topo2),
    );
  });
});

// ---------------------------------------------------------------------------
// Tier 0 staleness narrowing — POSITIVE EVIDENCE that every mutation type the
// freshness lane relies on actually diverges the analysis-affecting hash.
//
// The whole lane is "narrow" precisely because staleness is implicit: a
// successful mutation persists a new graph, the next turn's hash diverges from
// the fact's stored `graph_hash_at_run`, and `deriveAnalysisFreshness` returns
// 'stale'. That only holds if EACH mutation type below moves the hash. We
// demonstrate it here rather than assert it in prose. (value / weight /
// option-intervention also have dedicated cases above; the add/remove cases
// are the ones not otherwise proven for the analysis-affecting hash.)
// ---------------------------------------------------------------------------
describe('computeAnalysisAffectingGraphHash — mutation taxonomy (Tier 0 staleness proof)', () => {
  const baseTwoNode = () =>
    buildGraph({
      nodes: [baseFactor('a', 10), baseFactor('b', 20)],
      edges: [baseEdge('a', 'b', 0.5)],
    });

  it('value edit (observed_state.value) → hash changes', () => {
    const before = baseTwoNode();
    const after = buildGraph({
      nodes: [baseFactor('a', 10), baseFactor('b', 99)],
      edges: [baseEdge('a', 'b', 0.5)],
    });
    expect(computeAnalysisAffectingGraphHash(before)).not.toBe(
      computeAnalysisAffectingGraphHash(after),
    );
  });

  it('weight edit (edge strength.mean / std) → hash changes', () => {
    const before = baseTwoNode();
    const afterMean = buildGraph({
      nodes: [baseFactor('a', 10), baseFactor('b', 20)],
      edges: [baseEdge('a', 'b', 0.9)],
    });
    const afterStd = buildGraph({
      nodes: [baseFactor('a', 10), baseFactor('b', 20)],
      edges: [{ from: 'a', to: 'b', strength: { mean: 0.5, std: 0.5 }, exists_probability: 0.9, effect_direction: 'positive' }],
    });
    const h = computeAnalysisAffectingGraphHash(before);
    expect(h).not.toBe(computeAnalysisAffectingGraphHash(afterMean));
    expect(h).not.toBe(computeAnalysisAffectingGraphHash(afterStd));
  });

  it('option / intervention edit → hash changes', () => {
    const before = buildGraph({
      nodes: [baseFactor('a', 10)],
      edges: [],
      options: [{ id: 'opt-1', status: 'ready', interventions: { a: { value: 1 } } }],
    });
    const after = buildGraph({
      nodes: [baseFactor('a', 10)],
      edges: [],
      options: [{ id: 'opt-1', status: 'ready', interventions: { a: { value: 2 } } }],
    });
    expect(computeAnalysisAffectingGraphHash(before)).not.toBe(
      computeAnalysisAffectingGraphHash(after),
    );
  });

  it('structural node add → hash changes', () => {
    const before = buildGraph({ nodes: [baseFactor('a', 10)], edges: [] });
    const after = buildGraph({ nodes: [baseFactor('a', 10), baseFactor('b', 20)], edges: [] });
    expect(computeAnalysisAffectingGraphHash(before)).not.toBe(
      computeAnalysisAffectingGraphHash(after),
    );
  });

  it('structural node remove → hash changes', () => {
    const before = buildGraph({ nodes: [baseFactor('a', 10), baseFactor('b', 20)], edges: [] });
    const after = buildGraph({ nodes: [baseFactor('a', 10)], edges: [] });
    expect(computeAnalysisAffectingGraphHash(before)).not.toBe(
      computeAnalysisAffectingGraphHash(after),
    );
  });

  it('structural edge add → hash changes', () => {
    const before = buildGraph({
      nodes: [baseFactor('a', 10), baseFactor('b', 20)],
      edges: [],
    });
    const after = buildGraph({
      nodes: [baseFactor('a', 10), baseFactor('b', 20)],
      edges: [baseEdge('a', 'b', 0.5)],
    });
    expect(computeAnalysisAffectingGraphHash(before)).not.toBe(
      computeAnalysisAffectingGraphHash(after),
    );
  });

  it('structural edge remove → hash changes', () => {
    const before = buildGraph({
      nodes: [baseFactor('a', 10), baseFactor('b', 20)],
      edges: [baseEdge('a', 'b', 0.5)],
    });
    const after = buildGraph({
      nodes: [baseFactor('a', 10), baseFactor('b', 20)],
      edges: [],
    });
    expect(computeAnalysisAffectingGraphHash(before)).not.toBe(
      computeAnalysisAffectingGraphHash(after),
    );
  });
});
