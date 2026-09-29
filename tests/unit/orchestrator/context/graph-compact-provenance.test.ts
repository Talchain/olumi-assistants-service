/**
 * Test M (verification) — graph-compact provenance projection.
 *
 * Re-asserts the shipped behaviour at
 * src/orchestrator/context/graph-compact.ts:282-323 (nodes) and 357-384 (edges).
 *
 * Scope: synthetic GraphV3T covering the four canonical node `extractionType`
 * values + one unrecognised value + one absent observed_state, plus the four
 * canonical edge provenance.source values + one unrecognised + one absent.
 * Asserts source / provenance / _raw_provenance projection and node/edge counts.
 *
 * Out of scope: token budget, sort determinism, intervention summary,
 * plain_interpretation — those are exercised by the broader graph-compact tests.
 */

import { describe, it, expect } from 'vitest';
import { compactGraph } from '../../../../src/orchestrator/context/graph-compact.js';
import type { GraphV3T } from '../../../../src/schemas/cee-v3.js';

// Minimal node/edge factories. We bypass strict GraphV3T inference because
// GraphV3 has many optional fields and the verification only cares about
// observed_state.extractionType + edge.provenance.source. Cast through unknown
// per the project convention noted in CLAUDE.md (Zod-inferred types do not
// overlap with partial literals).
function buildGraph(): GraphV3T {
  const graph = {
    nodes: [
      {
        id: 'n_explicit',
        kind: 'factor',
        label: 'Explicit Factor',
        observed_state: { extractionType: 'explicit', value: 0.5 },
      },
      {
        id: 'n_inferred',
        kind: 'factor',
        label: 'Inferred Factor',
        observed_state: { extractionType: 'inferred', value: 0.3 },
      },
      {
        id: 'n_observed',
        kind: 'factor',
        label: 'Observed Factor',
        observed_state: { extractionType: 'observed', value: 0.4 },
      },
      {
        id: 'n_range',
        kind: 'factor',
        label: 'Range Factor',
        observed_state: { extractionType: 'range', value: 0.2 },
      },
      {
        id: 'n_unknown',
        kind: 'factor',
        label: 'Unknown Factor',
        observed_state: { extractionType: 'mystery_value', value: 0.1 },
      },
      {
        id: 'n_no_state',
        kind: 'factor',
        label: 'No Observed State',
      },
    ],
    edges: [
      {
        from: 'n_explicit',
        to: 'n_inferred',
        strength: { mean: 0.5, std: 0.1 },
        provenance: { source: 'brief_extraction' },
      },
      {
        from: 'n_inferred',
        to: 'n_observed',
        strength: { mean: 0.5, std: 0.1 },
        provenance: { source: 'user_specified' },
      },
      {
        from: 'n_observed',
        to: 'n_range',
        strength: { mean: 0.5, std: 0.1 },
        provenance: { source: 'cee_hypothesis' },
      },
      {
        from: 'n_range',
        to: 'n_unknown',
        strength: { mean: 0.5, std: 0.1 },
        provenance: { source: 'domain_knowledge' },
      },
      {
        from: 'n_unknown',
        to: 'n_no_state',
        strength: { mean: 0.5, std: 0.1 },
        provenance: { source: 'something_new' },
      },
      {
        // No provenance object at all → ai_inferred default
        from: 'n_explicit',
        to: 'n_no_state',
        strength: { mean: 0.5, std: 0.1 },
      },
    ],
  };
  return graph as unknown as GraphV3T;
}

describe('compactGraph — provenance projection (Test M)', () => {
  const compact = compactGraph(buildGraph());

  // Build an id → node lookup since output is sorted alphabetically.
  const byId = new Map(compact.nodes.map((n) => [n.id, n]));

  it('emits _node_count and _edge_count matching projected arrays', () => {
    expect(compact._node_count).toBe(6);
    expect(compact._edge_count).toBe(6);
    expect(compact.nodes).toHaveLength(6);
    expect(compact.edges).toHaveLength(6);
  });

  it('extractionType=explicit → source=user, provenance=from_brief, no _raw_provenance', () => {
    const n = byId.get('n_explicit')!;
    expect(n.source).toBe('user');
    expect(n.provenance).toBe('from_brief');
    expect(n._raw_provenance).toBeUndefined();
  });

  it('extractionType=inferred → source=assumption, provenance=ai_inferred', () => {
    const n = byId.get('n_inferred')!;
    expect(n.source).toBe('assumption');
    expect(n.provenance).toBe('ai_inferred');
    expect(n._raw_provenance).toBeUndefined();
  });

  it('extractionType=observed → source=system, provenance=from_brief', () => {
    const n = byId.get('n_observed')!;
    expect(n.source).toBe('system');
    expect(n.provenance).toBe('from_brief');
    expect(n._raw_provenance).toBeUndefined();
  });

  it('extractionType=range → source=system, provenance=ai_inferred', () => {
    const n = byId.get('n_range')!;
    expect(n.source).toBe('system');
    expect(n.provenance).toBe('ai_inferred');
    expect(n._raw_provenance).toBeUndefined();
  });

  it('unrecognised extractionType → safe default ai_inferred + _raw_provenance preserved', () => {
    const n = byId.get('n_unknown')!;
    expect(n.source).toBe('system');
    expect(n.provenance).toBe('ai_inferred');
    expect(n._raw_provenance).toBe('mystery_value');
  });

  it('absent observed_state → source=system, provenance=ai_inferred, no _raw_provenance', () => {
    const n = byId.get('n_no_state')!;
    expect(n.source).toBe('system');
    expect(n.provenance).toBe('ai_inferred');
    expect(n._raw_provenance).toBeUndefined();
  });

  it('every output node carries one of the three CompactProvenance values', () => {
    for (const n of compact.nodes) {
      expect(['from_brief', 'ai_inferred', 'user_set']).toContain(n.provenance);
    }
  });

  it('edge provenance: brief_extraction → from_brief', () => {
    const e = compact.edges.find((x) => x.from === 'n_explicit' && x.to === 'n_inferred')!;
    expect(e.provenance).toBe('from_brief');
    expect(e._raw_provenance).toBeUndefined();
  });

  it('edge provenance: user_specified → user_set', () => {
    const e = compact.edges.find((x) => x.from === 'n_inferred' && x.to === 'n_observed')!;
    expect(e.provenance).toBe('user_set');
    expect(e._raw_provenance).toBeUndefined();
  });

  it('edge provenance: cee_hypothesis → ai_inferred', () => {
    const e = compact.edges.find((x) => x.from === 'n_observed' && x.to === 'n_range')!;
    expect(e.provenance).toBe('ai_inferred');
    expect(e._raw_provenance).toBeUndefined();
  });

  it('edge provenance: domain_knowledge → ai_inferred', () => {
    const e = compact.edges.find((x) => x.from === 'n_range' && x.to === 'n_unknown')!;
    expect(e.provenance).toBe('ai_inferred');
    expect(e._raw_provenance).toBeUndefined();
  });

  it('edge provenance: unrecognised value → ai_inferred + _raw_provenance preserved', () => {
    const e = compact.edges.find((x) => x.from === 'n_unknown' && x.to === 'n_no_state')!;
    expect(e.provenance).toBe('ai_inferred');
    expect(e._raw_provenance).toBe('something_new');
  });

  it('edge provenance: absent → ai_inferred (safe default), no _raw_provenance', () => {
    const e = compact.edges.find((x) => x.from === 'n_explicit' && x.to === 'n_no_state')!;
    expect(e.provenance).toBe('ai_inferred');
    expect(e._raw_provenance).toBeUndefined();
  });
});
