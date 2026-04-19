/**
 * Unit tests for buildGraphLookup (Phase 1.5 D4 adapter).
 *
 * Covers kind mapping (NodeV3 → EntityKind), edge cases (empty graph, unknown
 * kinds), and the GraphLookupWithOptions extension used by preconditions.
 */
import { describe, it, expect } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { buildGraphLookup } from '../graph-lookup-adapter.js';

function mkGraph(
  nodes: Array<{ id: string; kind: string; label: string }>,
  options?: unknown[],
): GraphV3T {
  const g = { nodes, edges: [] } as unknown as Record<string, unknown>;
  if (options) g.options = options;
  return g as unknown as GraphV3T;
}

describe('buildGraphLookup', () => {
  it('returns undefined for null graph', () => {
    expect(buildGraphLookup(null)).toBeUndefined();
  });

  it('returns undefined for graph with no nodes', () => {
    expect(buildGraphLookup(mkGraph([]))).toBeUndefined();
  });

  it('findEntityById returns the node when present', () => {
    const g = mkGraph([
      { id: 'goal_1', kind: 'goal', label: 'Profit' },
      { id: 'opt_1', kind: 'option', label: 'A' },
    ]);
    const lookup = buildGraphLookup(g)!;
    expect(lookup.findEntityById('opt_1')).toEqual({ id: 'opt_1', kind: 'option', label: 'A' });
  });

  it('findEntityById returns null for unknown id', () => {
    const g = mkGraph([{ id: 'a', kind: 'goal', label: 'A' }]);
    const lookup = buildGraphLookup(g)!;
    expect(lookup.findEntityById('missing')).toBeNull();
  });

  it('maps factor/outcome/decision/risk/action to generic "node"', () => {
    const g = mkGraph([
      { id: 'f1', kind: 'factor', label: 'Cost' },
      { id: 'o1', kind: 'outcome', label: 'Result' },
      { id: 'd1', kind: 'decision', label: 'Pick' },
      { id: 'r1', kind: 'risk', label: 'Risk' },
      { id: 'a1', kind: 'action', label: 'Act' },
    ]);
    const lookup = buildGraphLookup(g)!;
    for (const id of ['f1', 'o1', 'd1', 'r1', 'a1']) {
      expect(lookup.findEntityById(id)?.kind).toBe('node');
    }
    expect(lookup.listEntitiesByKind('node')).toHaveLength(5);
  });

  it('preserves option and goal kinds distinctly', () => {
    const g = mkGraph([
      { id: 'g1', kind: 'goal', label: 'Goal' },
      { id: 'o1', kind: 'option', label: 'Opt' },
    ]);
    const lookup = buildGraphLookup(g)!;
    expect(lookup.findEntityById('g1')?.kind).toBe('goal');
    expect(lookup.findEntityById('o1')?.kind).toBe('option');
    expect(lookup.listEntitiesByKind('goal')).toEqual([{ id: 'g1', label: 'Goal' }]);
    expect(lookup.listEntitiesByKind('option')).toEqual([{ id: 'o1', label: 'Opt' }]);
  });

  it('silently drops nodes with unknown kind', () => {
    const g = mkGraph([
      { id: 'valid', kind: 'goal', label: 'OK' },
      { id: 'bogus', kind: 'not_a_real_kind', label: 'No' },
    ]);
    const lookup = buildGraphLookup(g)!;
    expect(lookup.findEntityById('valid')).not.toBeNull();
    expect(lookup.findEntityById('bogus')).toBeNull();
  });

  it('exposes options array when present on the graph', () => {
    const g = mkGraph(
      [{ id: 'o1', kind: 'option', label: 'A' }],
      [{ id: 'o1', interventions: { fac_1: { value: 1 } } }],
    );
    const lookup = buildGraphLookup(g)!;
    // GraphLookupWithOptions extension — check via the adapter return type.
    const extended = lookup as typeof lookup & { options?: ReadonlyArray<Record<string, unknown>> };
    expect(extended.options).toBeDefined();
    expect(extended.options).toHaveLength(1);
  });

  it('exposes empty options array when graph has none', () => {
    const g = mkGraph([{ id: 'o1', kind: 'option', label: 'A' }]);
    const lookup = buildGraphLookup(g)!;
    const extended = lookup as typeof lookup & { options?: ReadonlyArray<Record<string, unknown>> };
    expect(extended.options).toEqual([]);
  });

  it('listEntitiesByKind returns empty array for absent kind', () => {
    const g = mkGraph([{ id: 'g1', kind: 'goal', label: 'G' }]);
    const lookup = buildGraphLookup(g)!;
    expect(lookup.listEntitiesByKind('option')).toEqual([]);
  });
});
