/**
 * format-graph-for-context — per-option reachability reaches the model.
 *
 * The compactor derives the structural reachable set (see
 * `graph-compact-option-reachability.test.ts` for the witnessed defect it
 * closes). This file pins the LAST hop: that the set survives the display-safe
 * projection, in the user's own vocabulary, and that carrying it does not
 * breach the projection's standing contract — no raw floats, no exists
 * probabilities, no node numerics.
 *
 * `display_graph` is `model_facing: true` and is serialised into the user
 * message under the key `graph` (`context-policy.ts`), so a field that survives
 * here is a field the model can ground a structural claim on.
 */

import { describe, expect, it } from 'vitest';

import type { ContextPackGraph } from '../../context/context-pack-assembler.js';
import { formatGraphForContext } from '../format-graph-for-context.js';

function pack(nodes: unknown[], edges: unknown[]): ContextPackGraph {
  return {
    nodes,
    edges,
    options: nodes
      .filter((n) => (n as { kind?: string }).kind === 'option')
      .map((n) => ({ id: (n as { id: string }).id, label: (n as { label: string }).label })),
    goals: nodes.filter((n) => (n as { kind?: string }).kind === 'goal'),
    constraints: [],
    counts: { nodes: nodes.length, edges: edges.length, options: 0, goals: 0, constraints: 0 },
  } as unknown as ContextPackGraph;
}

/** Compact-shaped input, i.e. exactly what `projectCompactGraph` hands over. */
const WITNESSED_NODES = [
  { id: 'opt_status_quo', kind: 'option', label: 'Status Quo', reaches: ['fac_cash_runway_breach', 'opt_berlin'] },
  { id: 'opt_uk', kind: 'option', label: 'UK expansion', reaches: [] },
  { id: 'opt_berlin', kind: 'option', label: 'Berlin office investment', reaches: ['fac_cash_runway_breach'] },
  { id: 'fac_cash_runway_breach', kind: 'factor', label: 'Cash runway breach' },
];
const WITNESSED_EDGES = [
  { from: 'opt_status_quo', to: 'opt_berlin', strength: 1.0, exists: 1.0 },
  { from: 'opt_berlin', to: 'fac_cash_runway_breach', strength: 0.5, exists: 0.9 },
];

function nodeById(graph: ReturnType<typeof formatGraphForContext>, id: string) {
  const found = graph.nodes.find((n) => n.id === id);
  expect(found, `node ${id} must survive the display-safe projection`).toBeDefined();
  return found!;
}

describe('formatGraphForContext — option reachability projection', () => {
  it('REACHES_PROJECTS_AS_LABELS — the model sees the user vocabulary, not internal ids', () => {
    const out = formatGraphForContext(pack(WITNESSED_NODES, WITNESSED_EDGES));
    // Identity-bound to opt_status_quo: the option whose route the deployed
    // build denied existed.
    expect(nodeById(out, 'opt_status_quo').reaches).toEqual([
      'Cash runway breach',
      'Berlin office investment',
    ]);
  });

  it('REACHES_PRESERVES_COMPACTOR_ORDER — the display layer never re-ranks', () => {
    const out = formatGraphForContext(pack(WITNESSED_NODES, WITNESSED_EDGES));
    const reaches = nodeById(out, 'opt_status_quo').reaches;
    expect(reaches?.[0]).toBe('Cash runway breach');
    expect(reaches?.[1]).toBe('Berlin office investment');
  });

  it('EMPTY_SET_SURVIVES_AS_EMPTY — a dead-end option is a positive fact, not a dropped key', () => {
    const out = formatGraphForContext(pack(WITNESSED_NODES, WITNESSED_EDGES));
    expect(nodeById(out, 'opt_uk').reaches).toEqual([]);
  });

  it('NON_OPTION_NODES_CARRY_NO_REACHES', () => {
    const out = formatGraphForContext(pack(WITNESSED_NODES, WITNESSED_EDGES));
    expect(nodeById(out, 'fac_cash_runway_breach').reaches).toBeUndefined();
  });

  it('UNRESOLVABLE_ID_FALLS_BACK_TO_THE_ID — never dropped silently', () => {
    // Dropping an unresolvable entry would shorten the reachable set, and a
    // silently-short set is exactly the false-negative this projection exists
    // to remove.
    const nodes = [
      { id: 'opt_a', kind: 'option', label: 'Option A', reaches: ['ghost_node'] },
    ];
    const out = formatGraphForContext(pack(nodes, []));
    expect(nodeById(out, 'opt_a').reaches).toEqual(['ghost_node']);
  });

  it('MALFORMED_REACHES_IS_OMITTED_NOT_COERCED', () => {
    const nodes = [{ id: 'opt_a', kind: 'option', label: 'Option A', reaches: 'not-an-array' }];
    const out = formatGraphForContext(pack(nodes, []));
    expect(nodeById(out, 'opt_a').reaches).toBeUndefined();
  });

  it('REACHES_INTRODUCES_NO_RAW_NUMERICS — the projection contract still holds', () => {
    const out = formatGraphForContext(pack(WITNESSED_NODES, WITNESSED_EDGES));
    const serialised = JSON.stringify(out.nodes);
    // The display-safe contract: no strength floats, no exists probabilities,
    // no node numerics reach Sonnet. A label-only reachable set cannot add any.
    expect(serialised).not.toContain('"strength"');
    expect(serialised).not.toContain('"exists"');
    expect(serialised).not.toContain('"raw_value"');
  });

  it('IDEMPOTENT_REPROJECTION_PRESERVES_REACHES', () => {
    const once = formatGraphForContext(pack(WITNESSED_NODES, WITNESSED_EDGES));
    const twice = formatGraphForContext(
      pack(once.nodes as unknown[], once.edges as unknown[]),
    );
    // Second pass sees labels where the first saw ids; label→label resolution
    // is identity for a node whose label is its own display name, so the set
    // must survive rather than silently emptying.
    expect(twice.nodes.find((n) => n.id === 'opt_status_quo')?.reaches).toEqual([
      'Cash runway breach',
      'Berlin office investment',
    ]);
  });
});
