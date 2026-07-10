/**
 * 1.16 item A2 — unit tests for the cap-change intervention renormaliser,
 * including the PR #413 review FIXUP 1 (cap DECREASE corruption path).
 *
 * The corruption: (v · oldCap) / newCap is unbounded, and the handler
 * triggers on ANY explicit-cap change (the LLM tool schema exposes `cap`),
 * so an LLM-emitted LOWER cap produced normalised values > 1. Downstream,
 * the egress net (`resolveRawInterventionValue`) classifies a value > 1 as
 * already-raw passthrough — PLoT would receive £1.60 instead of £80,000
 * (probe: {value: 0.8}, cap 100000 → 50000 → 1.6).
 *
 * Fix under test: every rewritten OBJECT entry is stamped with
 * `raw_value: v · oldCap` (raw_value wins downstream even when value > 1),
 * and a BARE-number entry whose rescaled result exceeds 1 is converted to
 * `{ value: rescaled, raw_value: v · oldCap }` instead of writing a bare
 * > 1 number.
 */

import { describe, expect, it } from 'vitest';

import type { GraphV3T } from '../../../../../schemas/cee-v3.js';
import { resolveRawInterventionValue } from '../../../plot-intervention-scale.js';
import { renormaliseOptionInterventionsForCapChange } from '../renormalise-interventions-for-cap-change.js';

const TM = { node_id: 'fac_x', match_type: 'exact_id', confidence: 'high' };

function graphWith(entry: unknown): GraphV3T {
  return {
    nodes: [
      { id: 'fac_x', kind: 'factor', label: 'Cost' },
      { id: 'opt_a', kind: 'option', label: 'Option A', interventions: { fac_x: entry } },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

function entryOf(graph: GraphV3T): Record<string, unknown> | number {
  const node = graph.nodes.find((n) => n.id === 'opt_a') as unknown as {
    interventions: Record<string, Record<string, unknown> | number>;
  };
  return node.interventions.fac_x;
}

describe('renormaliseOptionInterventionsForCapChange — cap DECREASE (FIXUP 1)', () => {
  it('object {value: 0.8} on 100000 → 50000 preserves £80,000 absolutely via stamped raw_value', () => {
    const graph = graphWith({ value: 0.8, source: 'user_specified', target_match: TM });
    const count = renormaliseOptionInterventionsForCapChange(graph, 'fac_x', 100000, 50000);
    expect(count).toBe(1);
    const entry = entryOf(graph) as Record<string, unknown>;
    expect(entry.value).toBeCloseTo(1.6, 10);
    // The stamped absolute — raw_value wins downstream even when value > 1.
    expect(entry.raw_value).toBe(80000);
    // Egress-net probe: PLoT receives £80,000, NOT £1.60 raw-passthrough.
    const egress = resolveRawInterventionValue(entry, { cap: 50000 });
    expect(egress.value).toBe(80000);
    expect(egress.rule).toBe('raw_value_used');
  });

  it('bare number 0.8 on 100000 → 50000 converts to {value, raw_value} instead of a bare >1 number', () => {
    const graph = graphWith(0.8);
    const count = renormaliseOptionInterventionsForCapChange(graph, 'fac_x', 100000, 50000);
    expect(count).toBe(1);
    const entry = entryOf(graph);
    expect(typeof entry).toBe('object');
    const obj = entry as Record<string, unknown>;
    expect(obj.value).toBeCloseTo(1.6, 10);
    expect(obj.raw_value).toBe(80000);
    const egress = resolveRawInterventionValue(obj, { cap: 50000 });
    expect(egress.value).toBe(80000);
    expect(egress.rule).toBe('raw_value_used');
  });

  it('pair-consistent {value, raw_value} on a decrease keeps the absolute raw_value', () => {
    const graph = graphWith({ value: 0.5, raw_value: 50000, source: 'user_specified', target_match: TM });
    renormaliseOptionInterventionsForCapChange(graph, 'fac_x', 100000, 50000);
    const entry = entryOf(graph) as Record<string, unknown>;
    expect(entry.raw_value).toBe(50000);
    expect(entry.value).toBeCloseTo(1, 10);
    expect(resolveRawInterventionValue(entry, { cap: 50000 }).value).toBe(50000);
  });
});

describe('renormaliseOptionInterventionsForCapChange — cap INCREASE', () => {
  it('object {value: 1} on 200000 → 312500 rescales and stamps the absolute', () => {
    const graph = graphWith({ value: 1, source: 'user_specified', target_match: TM });
    const count = renormaliseOptionInterventionsForCapChange(graph, 'fac_x', 200000, 312500);
    expect(count).toBe(1);
    const entry = entryOf(graph) as Record<string, unknown>;
    expect(entry.value).toBeCloseTo(200000 / 312500, 10);
    // FIXUP 1 belt-and-braces: every rewritten object entry carries the
    // absolute, so the egress rule is raw_value_used (same number as
    // cap_denormalised, but immune to later cap edits).
    expect(entry.raw_value).toBe(200000);
    expect(resolveRawInterventionValue(entry, { cap: 312500 }).value).toBe(200000);
  });
});

describe('renormaliseOptionInterventionsForCapChange — untouched classes', () => {
  it('encoded boolean entries are never scaled', () => {
    const original = { value: 1, raw_value: true, value_type: 'boolean', target_match: TM };
    const graph = graphWith({ ...original });
    const count = renormaliseOptionInterventionsForCapChange(graph, 'fac_x', 100000, 50000);
    expect(count).toBe(0);
    expect(entryOf(graph)).toEqual(original);
  });

  it('raw-looking values (>1) are already absolute and untouched', () => {
    const graph = graphWith({ value: 25000, target_match: TM });
    expect(renormaliseOptionInterventionsForCapChange(graph, 'fac_x', 100000, 50000)).toBe(0);
    expect((entryOf(graph) as Record<string, unknown>).value).toBe(25000);
  });

  it('inconsistent {value, raw_value} pairs are left alone (surfacing beats repair)', () => {
    const graph = graphWith({ value: 0.5, raw_value: 99999, target_match: TM });
    expect(renormaliseOptionInterventionsForCapChange(graph, 'fac_x', 100000, 50000)).toBe(0);
  });

  it('no-op when caps are equal, non-finite, or non-positive', () => {
    expect(renormaliseOptionInterventionsForCapChange(graphWith(0.5), 'fac_x', 100000, 100000)).toBe(0);
    expect(renormaliseOptionInterventionsForCapChange(graphWith(0.5), 'fac_x', undefined, 50000)).toBe(0);
    expect(renormaliseOptionInterventionsForCapChange(graphWith(0.5), 'fac_x', 100000, 0)).toBe(0);
  });
});
