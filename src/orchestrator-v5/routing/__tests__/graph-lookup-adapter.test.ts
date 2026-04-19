/**
 * Unit tests for buildGraphLookup (Phase 1.5 D4 adapter).
 *
 * Covers:
 *   • discriminated return: no_graph | all_dropped | ok
 *   • kind mapping (NodeV3 → EntityKind)
 *   • drop-stats reporting (Imp-2)
 *   • GraphLookupWithOptions extension used by preconditions
 */
import { describe, it, expect } from 'vitest';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { buildGraphLookup } from '../graph-lookup-adapter.js';

function mkGraph(
  nodes: Array<{ id: string; kind: string; label: string }>,
  options?: unknown[],
  goal_constraints?: unknown[],
): GraphStateIngress {
  const g: Record<string, unknown> = { nodes, edges: [] };
  if (options) g.options = options;
  if (goal_constraints) g.goal_constraints = goal_constraints;
  return g as GraphStateIngress;
}

/** Convenience: assert 'ok' and return the lookup. */
function expectOk(r: ReturnType<typeof buildGraphLookup>) {
  expect(r.kind).toBe('ok');
  if (r.kind !== 'ok') throw new Error('unreachable');
  return r.lookup;
}

describe('buildGraphLookup', () => {
  it('returns no_graph for null input', () => {
    const r = buildGraphLookup(null);
    expect(r.kind).toBe('no_graph');
  });

  it('returns no_graph for empty-nodes graph', () => {
    const r = buildGraphLookup(mkGraph([]));
    expect(r.kind).toBe('no_graph');
  });

  it('findEntityById returns the node when present', () => {
    const lookup = expectOk(
      buildGraphLookup(
        mkGraph([
          { id: 'goal_1', kind: 'goal', label: 'Profit' },
          { id: 'opt_1', kind: 'option', label: 'A' },
        ]),
      ),
    );
    expect(lookup.findEntityById('opt_1')).toEqual({ id: 'opt_1', kind: 'option', label: 'A' });
  });

  it('findEntityById returns null for unknown id', () => {
    const lookup = expectOk(buildGraphLookup(mkGraph([{ id: 'a', kind: 'goal', label: 'A' }])));
    expect(lookup.findEntityById('missing')).toBeNull();
  });

  it('maps factor/outcome/decision/risk/action to generic "node"', () => {
    const lookup = expectOk(
      buildGraphLookup(
        mkGraph([
          { id: 'f1', kind: 'factor', label: 'Cost' },
          { id: 'o1', kind: 'outcome', label: 'Result' },
          { id: 'd1', kind: 'decision', label: 'Pick' },
          { id: 'r1', kind: 'risk', label: 'Risk' },
          { id: 'a1', kind: 'action', label: 'Act' },
        ]),
      ),
    );
    for (const id of ['f1', 'o1', 'd1', 'r1', 'a1']) {
      expect(lookup.findEntityById(id)?.kind).toBe('node');
    }
    expect(lookup.listEntitiesByKind('node')).toHaveLength(5);
  });

  it('preserves option and goal kinds distinctly', () => {
    const lookup = expectOk(
      buildGraphLookup(
        mkGraph([
          { id: 'g1', kind: 'goal', label: 'Goal' },
          { id: 'o1', kind: 'option', label: 'Opt' },
        ]),
      ),
    );
    expect(lookup.findEntityById('g1')?.kind).toBe('goal');
    expect(lookup.findEntityById('o1')?.kind).toBe('option');
    expect(lookup.listEntitiesByKind('goal')).toEqual([{ id: 'g1', label: 'Goal' }]);
    expect(lookup.listEntitiesByKind('option')).toEqual([{ id: 'o1', label: 'Opt' }]);
  });

  it('drops nodes with unknown kind but reports them in stats (Imp-2)', () => {
    const r = buildGraphLookup(
      mkGraph([
        { id: 'valid', kind: 'goal', label: 'OK' },
        { id: 'bogus', kind: 'not_a_real_kind', label: 'No' },
      ]),
    );
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') throw new Error('unreachable');
    expect(r.stats.total_nodes).toBe(2);
    expect(r.stats.mapped_nodes).toBe(1);
    expect(r.stats.dropped_by_unknown_kind).toBe(1);
    expect(r.lookup.findEntityById('valid')).not.toBeNull();
    expect(r.lookup.findEntityById('bogus')).toBeNull();
  });

  it('returns all_dropped when every node has an unknown kind (P0-2 contract)', () => {
    const r = buildGraphLookup(
      mkGraph([
        { id: 'x1', kind: 'mystery_one', label: 'X1' },
        { id: 'x2', kind: 'mystery_two', label: 'X2' },
      ]),
    );
    expect(r.kind).toBe('all_dropped');
    if (r.kind !== 'all_dropped') throw new Error('unreachable');
    expect(r.stats.total_nodes).toBe(2);
    expect(r.stats.mapped_nodes).toBe(0);
    expect(r.stats.dropped_by_unknown_kind).toBe(2);
  });

  it('exposes options array when present on the graph', () => {
    const lookup = expectOk(
      buildGraphLookup(
        mkGraph(
          [{ id: 'o1', kind: 'option', label: 'A' }],
          [{ id: 'o1', interventions: { fac_1: { value: 1 } } }],
        ),
      ),
    );
    const extended = lookup as typeof lookup & {
      options?: ReadonlyArray<Record<string, unknown>>;
    };
    expect(extended.options).toBeDefined();
    expect(extended.options).toHaveLength(1);
  });

  it('exposes empty options array when graph has none', () => {
    const lookup = expectOk(
      buildGraphLookup(mkGraph([{ id: 'o1', kind: 'option', label: 'A' }])),
    );
    const extended = lookup as typeof lookup & {
      options?: ReadonlyArray<Record<string, unknown>>;
    };
    expect(extended.options).toEqual([]);
  });

  it('listEntitiesByKind returns empty array for absent kind', () => {
    const lookup = expectOk(buildGraphLookup(mkGraph([{ id: 'g1', kind: 'goal', label: 'G' }])));
    expect(lookup.listEntitiesByKind('option')).toEqual([]);
  });

  describe('goal_constraints projection (debt-audit §1.3)', () => {
    it('surfaces constraints via findEntityById / listEntitiesByKind', () => {
      const lookup = expectOk(
        buildGraphLookup(
          mkGraph(
            [{ id: 'g1', kind: 'goal', label: 'G' }],
            undefined,
            [
              { constraint_id: 'c_profit', node_id: 'g1', operator: '>=', value: 100, label: 'Profit ≥ 100' },
              { constraint_id: 'c_risk', node_id: 'g1', operator: '<=', value: 0.3 },
            ],
          ),
        ),
      );
      expect(lookup.findEntityById('c_profit')).toEqual({
        id: 'c_profit',
        kind: 'constraint',
        label: 'Profit ≥ 100',
      });
      // Missing label stays null on both surfaces. The list MUST NOT
      // substitute the id into the label field — that leaked id-shaped
      // tokens into user-visible failure chips downstream.
      expect(lookup.findEntityById('c_risk')).toEqual({
        id: 'c_risk',
        kind: 'constraint',
        label: null,
      });
      expect(lookup.listEntitiesByKind('constraint')).toEqual([
        { id: 'c_profit', label: 'Profit ≥ 100' },
        { id: 'c_risk', label: null },
      ]);
    });

    it('skips constraint entries without a string constraint_id', () => {
      const lookup = expectOk(
        buildGraphLookup(
          mkGraph(
            [{ id: 'g1', kind: 'goal', label: 'G' }],
            undefined,
            [
              { label: 'orphan' }, // no constraint_id
              { constraint_id: '' }, // empty id
              { constraint_id: 'c_ok' },
            ],
          ),
        ),
      );
      expect(lookup.listEntitiesByKind('constraint')).toEqual([{ id: 'c_ok', label: null }]);
    });

    it('empty/absent goal_constraints produces no constraint entities', () => {
      const lookup = expectOk(
        buildGraphLookup(mkGraph([{ id: 'g1', kind: 'goal', label: 'G' }])),
      );
      expect(lookup.listEntitiesByKind('constraint')).toEqual([]);
    });
  });
});
