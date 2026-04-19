/**
 * Unit tests for computeDeterministicGraphHash (Phase 1.5 D3).
 *
 * Coverage:
 *   1. Same input → same output (determinism)
 *   2. Node order permutation → same output (canonicalisation)
 *   3. Edge order permutation → same output
 *   4. Null graph → null
 *   5. Empty nodes + empty edges → null
 *   6. 16-char hex prefix format
 */
import { describe, it, expect } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { computeDeterministicGraphHash } from '../graph-hash.js';

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
