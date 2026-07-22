/**
 * Lane C3 / decision ③ — node↔options[] reconcile at the persist chokepoint.
 *
 * Pins (debit b): an option added as an option-NODE but missing from top-level
 * options[] is MIRRORED into options[] additively; an already-consistent graph
 * is a byte-identical no-op; existing entries are never modified/removed; a
 * malformed options field is left untouched.
 *
 * POSITIVE CONTROL: the "no-op on consistent graphs" claim is only meaningful
 * because the SAME function DOES change a divergent graph — the first test
 * proves the pass can SEE and repair a presence, so a later no-op is a real
 * no-op, not a dead function.
 *
 * MUTATION-CHECK (revert → RED): remove the `options.push(...)` in
 * `reconcileTopLevelOptionsFromNodes` and the "mirrored" assertions fail (the
 * divergence persists).
 */
import { describe, expect, it } from 'vitest';

import { reconcileTopLevelOptionsFromNodes } from '../reconcile-top-level-options.js';

function divergentGraph() {
  return {
    nodes: [
      { id: 'dec', kind: 'decision', label: 'D' },
      { id: 'opt_a', kind: 'option', label: 'A' },
      // opt_b is a node but NOT in options[] — the live divergence.
      {
        id: 'opt_b',
        kind: 'option',
        label: 'Outsource',
        interventions: {
          fac_x: { value: 0.55, source: 'user_specified', target_match: { node_id: 'fac_x', match_type: 'exact_id', confidence: 'high' } },
        },
      },
    ],
    options: [{ id: 'opt_a', label: 'A', status: 'ready', interventions: {} }],
  };
}

describe('reconcileTopLevelOptionsFromNodes — the mirror (debit b)', () => {
  it('POSITIVE CONTROL: mirrors an option-node missing from options[] (additive, non-mutating)', () => {
    const graph = divergentGraph();
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;

    // A repaired clone (not the same reference), the original untouched.
    expect(out).not.toBe(graph);
    expect(graph.options).toHaveLength(1);

    expect(out.options).toHaveLength(2);
    const ids = out.options.map((o) => o.id).sort();
    expect(ids).toEqual(['opt_a', 'opt_b']);

    // The existing entry is preserved byte-for-byte.
    expect(out.options.find((o) => o.id === 'opt_a')).toEqual({
      id: 'opt_a',
      label: 'A',
      status: 'ready',
      interventions: {},
    });

    // The mirrored entry is derived faithfully from the node, and a configured
    // option (>=1 numeric value) is `ready`.
    const mirrored = out.options.find((o) => o.id === 'opt_b') as Record<string, unknown>;
    expect(mirrored.label).toBe('Outsource');
    expect(mirrored.status).toBe('ready');
    expect(mirrored.interventions).toEqual({
      fac_x: { value: 0.55, source: 'user_specified', target_match: { node_id: 'fac_x', match_type: 'exact_id', confidence: 'high' } },
    });
  });

  it('an UNCONFIGURED option-node (no numeric values) mirrors as needs_encoding', () => {
    const graph = {
      nodes: [
        { id: 'dec', kind: 'decision', label: 'D' },
        { id: 'opt_bare', kind: 'option', label: 'Bare', interventions: {} },
      ],
      options: [],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;
    expect(out.options).toHaveLength(1);
    expect(out.options[0]).toMatchObject({ id: 'opt_bare', status: 'needs_encoding' });
  });

  it('preserves is_baseline when mirroring the status-quo option', () => {
    const graph = {
      nodes: [{ id: 'opt_sq', kind: 'option', label: 'Status quo', is_baseline: true, interventions: {} }],
      options: [],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph;
    expect(out.options[0]).toMatchObject({ id: 'opt_sq', is_baseline: true });
  });

  it('NO-OP on an already-consistent graph — returns the ORIGINAL reference', () => {
    const graph = {
      nodes: [
        { id: 'opt_a', kind: 'option', label: 'A', interventions: {} },
        { id: 'opt_b', kind: 'option', label: 'B', interventions: {} },
      ],
      options: [
        { id: 'opt_a', label: 'A', status: 'needs_encoding', interventions: {} },
        { id: 'opt_b', label: 'B', status: 'needs_encoding', interventions: {} },
      ],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph);
    expect(out).toBe(graph); // byte-identical no-op
  });

  it('never REMOVES an options[] entry whose node was already gone (deletion is a different owner)', () => {
    const graph = {
      nodes: [{ id: 'opt_a', kind: 'option', label: 'A', interventions: {} }],
      // opt_stale has no node — deletion is mergeAppliedGraphForPersistence's job.
      options: [
        { id: 'opt_a', label: 'A', status: 'needs_encoding', interventions: {} },
        { id: 'opt_stale', label: 'Gone', status: 'ready', interventions: {} },
      ],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph);
    // opt_a already present, opt_stale left alone → nothing to mirror → no-op.
    expect(out).toBe(graph);
  });

  it('NEVER INVENTS the field: an ABSENT options[] is left absent (decision ③ update-if-present)', () => {
    // An option-node with no top-level options[] array — the ruling says do NOT
    // grow one on this commit (that would violate the "no field invention" commit
    // invariant). No-op, original reference.
    const graph = { nodes: [{ id: 'opt_a', kind: 'option', label: 'A', interventions: {} }] };
    const out = reconcileTopLevelOptionsFromNodes(graph) as typeof graph & { options?: unknown };
    expect(out).toBe(graph);
    expect((out as { options?: unknown }).options).toBeUndefined();
  });

  it('leaves a malformed (non-array) options field untouched', () => {
    const graph = { nodes: [{ id: 'opt_a', kind: 'option', label: 'A' }], options: 'oops' };
    const out = reconcileTopLevelOptionsFromNodes(graph);
    expect(out).toBe(graph);
  });

  it('no-op / total on absent or hostile input', () => {
    expect(reconcileTopLevelOptionsFromNodes(null)).toBeNull();
    expect(reconcileTopLevelOptionsFromNodes(undefined)).toBeUndefined();
    expect(() => reconcileTopLevelOptionsFromNodes(42 as unknown)).not.toThrow();
    expect(() => reconcileTopLevelOptionsFromNodes({ nodes: 'x' } as unknown)).not.toThrow();
  });
});
