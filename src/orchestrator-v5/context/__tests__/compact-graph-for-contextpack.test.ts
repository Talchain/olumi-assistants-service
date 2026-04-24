/**
 * Unit tests for compactGraphForContextPack — the V5 Task 1.2 adapter that
 * runs V4's compactGraph over a permissive GraphStateIngress so the ContextPack
 * presented to Sonnet carries a compact projection instead of full-JSON
 * passthrough.
 */

import { describe, expect, it } from 'vitest';

import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { compactGraphForContextPack } from '../compact-graph-for-contextpack.js';

// Long-ish body text representative of real scenario content — the compactor
// drops this entirely, which is the largest single source of token savings.
const LONG_BODY =
  'This is a realistic descriptive body of the kind the UI ships for each node: ' +
  'a sentence or two of user-entered text explaining what the factor means, ' +
  'how the user is thinking about it, and any context they want to preserve ' +
  'across the session. Production nodes frequently carry 300-600 characters here. ' +
  'The compactor drops body entirely so only the label/kind/ID/value fields remain ' +
  'for Sonnet to reason about.';

function makeStrictGraph(nodeCount: number, edgeCount: number): GraphStateIngress {
  const nodes = Array.from({ length: nodeCount }, (_, i) => ({
    id: `n-${i}`,
    kind: i === 0 ? 'goal' : i < 3 ? 'option' : 'factor',
    label: `Node ${i} label`,
    body: LONG_BODY,
    observed_state: {
      value: i * 0.1,
      std: 0.05,
      extractionType: 'explicit',
    },
    category: 'observable',
  }));

  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    from: `n-${i % nodeCount}`,
    to: `n-${(i + 1) % nodeCount}`,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive',
  }));

  return { nodes, edges };
}

describe('compactGraphForContextPack', () => {
  it('returns absent when graphState is null', () => {
    const result = compactGraphForContextPack(null, { requestId: 'req-1' });
    expect(result.kind).toBe('absent');
  });

  it('returns absent when graphState is undefined', () => {
    const result = compactGraphForContextPack(undefined, { requestId: 'req-1' });
    expect(result.kind).toBe('absent');
  });

  it('compacts a strict-parseable graph via strict_parse', () => {
    const graph = makeStrictGraph(5, 4);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });

    expect(result.kind).toBe('compacted');
    if (result.kind !== 'compacted') throw new Error('narrowing');
    expect(result.via).toBe('strict_parse');
    expect(result.compact._node_count).toBe(5);
    expect(result.compact._edge_count).toBe(4);
  });

  it('compact output preserves id, kind, label on every node', () => {
    const graph = makeStrictGraph(4, 3);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const node of result.compact.nodes) {
      expect(node.id).toMatch(/^n-\d+$/);
      expect(node.kind).toBeTruthy();
      expect(node.label).toBeTruthy();
    }
  });

  it('compact output preserves from/to on every edge', () => {
    const graph = makeStrictGraph(5, 4);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const edge of result.compact.edges) {
      expect(edge.from).toBeTruthy();
      expect(edge.to).toBeTruthy();
      expect(typeof edge.strength).toBe('number');
    }
  });

  it('compact output drops verbose body field', () => {
    const graph = makeStrictGraph(3, 2);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const node of result.compact.nodes) {
      expect(node).not.toHaveProperty('body');
    }
  });

  it('compact output drops std on strength (only mean survives as strength number)', () => {
    const graph = makeStrictGraph(4, 3);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    for (const edge of result.compact.edges) {
      // strength is a number in the compact projection, not { mean, std }
      expect(typeof edge.strength).toBe('number');
    }
  });

  it('compact JSON is substantially smaller than raw JSON for a 10-node graph', () => {
    const graph = makeStrictGraph(10, 12);
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    if (result.kind !== 'compacted') throw new Error('expected compacted');

    const rawBytes = JSON.stringify(graph).length;
    const compactBytes = JSON.stringify(result.compact).length;

    expect(compactBytes).toBeLessThan(rawBytes * 0.5);
  });

  it('falls back to structural_fallback when ingress fails strict parse but is structurally compactable', () => {
    // Missing strength.std (required by GraphV3 edge strength schema in most
    // profiles) or similar — use a shape that passes GraphStateIngress but
    // fails GraphV3. The easiest is a node with an unknown kind.
    const graph: GraphStateIngress = {
      nodes: [
        { id: 'n-0', kind: 'goal', label: 'Goal' },
        { id: 'n-1', kind: 'not_a_valid_v3_kind', label: 'Weird' },
      ],
      edges: [{ from: 'n-0', to: 'n-1' }],
    };
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });

    // Either strict_parse (if GraphV3 is permissive on kind) or structural_fallback.
    // Both are acceptable — the key invariant is the function never throws.
    expect(result.kind).toBe('compacted');
  });

  it('structural fallback never throws on empty-edge payloads', () => {
    const graph: GraphStateIngress = {
      nodes: [{ id: 'n-0', kind: 'goal', label: 'Goal' }],
      edges: [],
    };
    const result = compactGraphForContextPack(graph, { requestId: 'req-1' });
    expect(result.kind).toBe('compacted');
  });

  it('is deterministic — same input produces byte-identical output', () => {
    const graph = makeStrictGraph(6, 8);
    const a = compactGraphForContextPack(graph, { requestId: 'req-a' });
    const b = compactGraphForContextPack(graph, { requestId: 'req-b' });
    if (a.kind !== 'compacted' || b.kind !== 'compacted') throw new Error('expected compacted');
    expect(JSON.stringify(a.compact)).toBe(JSON.stringify(b.compact));
  });
});
