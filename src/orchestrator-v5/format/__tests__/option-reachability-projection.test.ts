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

  it('PROJECTION_NEVER_SHORTENS_THE_SET — the length promise is now enforced, not just commented', () => {
    // ⭐ GATE 2. `projectNode`'s own comment promises the set may "become less
    // pretty, never shorter" — and NOTHING ENFORCED IT: slicing here left the
    // suite fully green. A comment promising a property nothing checks is the
    // exact class this PR exists to close, so the promise is pinned at the
    // layer that makes it.
    const nodes = [
      { id: 'opt_a', kind: 'option', label: 'Option A',
        reaches: ['fac_1', 'fac_2', 'fac_3', 'fac_4', 'fac_5'] },
      { id: 'fac_1', kind: 'factor', label: 'Factor One' },
      { id: 'fac_2', kind: 'factor', label: 'Factor Two' },
      { id: 'fac_3', kind: 'factor', label: 'Factor Three' },
      { id: 'fac_4', kind: 'factor', label: 'Factor Four' },
      { id: 'fac_5', kind: 'factor', label: 'Factor Five' },
    ];
    const out = formatGraphForContext(pack(nodes, []));
    const projected = nodeById(out, 'opt_a').reaches;
    // Bind to the INPUT length, so any slice/cap/filter added here reddens
    // regardless of what the cap's value happens to be.
    expect(projected).toHaveLength(5);
    expect(projected).toEqual([
      'Factor One', 'Factor Two', 'Factor Three', 'Factor Four', 'Factor Five',
    ]);
  });

  it('PROJECTION_PRESERVES_LENGTH_EVEN_WHEN_NO_LABEL_RESOLVES', () => {
    // The same promise where every entry falls back: still five, never fewer.
    const nodes = [{ id: 'opt_a', kind: 'option', label: 'Option A',
      reaches: ['g1', 'g2', 'g3', 'g4', 'g5'] }];
    const out = formatGraphForContext(pack(nodes, []));
    expect(nodeById(out, 'opt_a').reaches).toHaveLength(5);
  });

  it('BIDIRECTED_EDGE_TYPE_REACHES_THE_MODEL — gate 1 at the model-facing layer', () => {
    // Carrying the type in CompactEdge alone would achieve nothing: the model
    // reads display_graph, not the compact graph.
    const nodes = [
      { id: 'opt_a', kind: 'option', label: 'Option A', reaches: [] },
      { id: 'fac_b', kind: 'factor', label: 'Factor B' },
    ];
    const edges = [{ from: 'opt_a', to: 'fac_b', strength: 0.5, exists: 0.9, edge_type: 'bidirected' }];
    const out = formatGraphForContext(pack(nodes, edges));
    expect(out.edges[0]!.edge_type).toBe('bidirected');
    // The type reaching the model is NECESSARY AND NOT SUFFICIENT. What the
    // model echoes is the `relationship` STRING, and this fixture built the
    // witnessed lie (strength 0.5 + bidirected -> "moderate positive link")
    // while asserting past it. Pinned in full by the discriminating pair in
    // the block below; asserted here so the fixture that CONSTRUCTS the lie
    // can never again pass beside it.
    expect(out.edges[0]!.relationship).not.toBe('moderate positive link');
  });

  it('UNRECOGNISED_EDGE_TYPE_IS_DROPPED_NOT_COERCED', () => {
    const nodes = [
      { id: 'opt_a', kind: 'option', label: 'Option A', reaches: [] },
      { id: 'fac_b', kind: 'factor', label: 'Factor B' },
    ];
    const edges = [{ from: 'opt_a', to: 'fac_b', strength: 0.5, exists: 0.9, edge_type: 'sideways' }];
    const out = formatGraphForContext(pack(nodes, edges));
    expect(out.edges[0]).not.toHaveProperty('edge_type');
  });

  // ── The witnessed System-B defect: the PHRASE is the lie ──────────────────
  //
  // Deployed staging, 3 arms x 3 runs, topology verified from the PERSISTED
  // graph. Arm C (bidirected bridge) produced a FALSE CAUSAL CLAIM 3/3:
  //   "brand sentiment score has a direct link into quarterly profit. So the
  //    pathway to your goal runs through brand perception"
  // while the model held `edge_type:"bidirected"`. A bidirected edge denotes
  // confounding / association — explicitly NOT a directed causal effect.
  //
  // Proximate cause: `relationshipPhrase` composed "moderate positive link"
  // from the SIGNED STRENGTH ALONE and never read `edge_type`. The model
  // echoed the string it was handed. The string is the lie.
  //
  // These are a DISCRIMINATING PAIR ON THE STRING. The two directed arms are
  // load-bearing, not decoration: without them the suite cannot distinguish
  // the correct remedy from blanket-suppression, which passes a
  // bidirected-only assertion perfectly.

  const CONFOUNDED_NODES = [
    { id: 'fac_brand', kind: 'factor', label: 'Brand sentiment score' },
    { id: 'fac_profit', kind: 'factor', label: 'Quarterly profit' },
  ];

  /** strength 0.5 — a USER-SET magnitude — with `edge_type` set, absent, or explicit. */
  function confoundedPack(edgeType?: string): ContextPackGraph {
    const edge: Record<string, unknown> = {
      from: 'fac_brand',
      to: 'fac_profit',
      strength: 0.5,
      exists: 0.9,
    };
    if (edgeType !== undefined) edge.edge_type = edgeType;
    return pack(CONFOUNDED_NODES, [edge]);
  }

  function confoundedEdge(graph: ReturnType<typeof formatGraphForContext>) {
    const found = graph.edges.find((e) => e.from === 'fac_brand' && e.to === 'fac_profit');
    expect(found, 'the fac_brand->fac_profit edge must survive projection').toBeDefined();
    return found!;
  }

  it('BIDIRECTED_RELATIONSHIP_IS_NOT_CAUSAL_LINK_LANGUAGE', () => {
    const edge = confoundedEdge(formatGraphForContext(confoundedPack('bidirected')));
    // Identity-bound to the edge by from/to, never by a value predicate.
    // The exact string the deployed build handed the model:
    expect(edge.relationship).not.toBe('moderate positive link');
    // No directed-route language of any band or sign on a bidirected edge.
    expect(edge.relationship).not.toMatch(/\blink\b/);
    // The ratified in-repo predicate — defaults-v19.ts:76 and
    // Prompts/canonical/draft_graph.txt:213. Not a newly minted vocabulary.
    expect(edge.relationship).toContain('unmeasured common cause');
    expect(edge.relationship).toContain('not a causal route');
  });

  it('BIDIRECTED_RELATIONSHIP_KEEPS_BAND_AND_SIGN', () => {
    // Ruling: keep the band and the sign, carry the negation in the string.
    // Dropping the descriptor (or normalising strength.mean to 0) would trade
    // a false CAUSAL claim for a false SMALLNESS claim about a user-set 0.5 —
    // the opposite-direction harm, and #1163's false-negative one level down.
    const edge = confoundedEdge(formatGraphForContext(confoundedPack('bidirected')));
    expect(edge.relationship).toContain('moderate');
    expect(edge.relationship).toContain('positive');
    expect(edge.relationship).not.toContain('negligible');
  });

  it('DIRECTED_EDGE_TYPE_ABSENT_KEEPS_ITS_LINK_PHRASE', () => {
    // THE arm that kills a `!== 'directed'` / "absent means bidirected"
    // detection. Prompts/canonical/draft_graph.txt:484 MANDATES omitting
    // edge_type on directed edges ("do NOT emit edge_type on directed
    // edges"), so the loose form's blast radius is every drafted edge in the
    // estate. Detection must be `=== 'bidirected'`.
    const edge = confoundedEdge(formatGraphForContext(confoundedPack(undefined)));
    expect(edge.relationship).toBe('moderate positive link');
    expect(edge).not.toHaveProperty('edge_type');
  });

  it('DIRECTED_EDGE_TYPE_EXPLICIT_KEEPS_ITS_LINK_PHRASE', () => {
    // The arm that kills an `edge_type !== undefined` detection.
    const edge = confoundedEdge(formatGraphForContext(confoundedPack('directed')));
    expect(edge.relationship).toBe('moderate positive link');
  });

  it('BIDIRECTED_UNRECOGNISED_PHRASE_FALLS_BACK_WITHOUT_CAUSAL_LANGUAGE', () => {
    // The projector's own documented threat model: a re-projected edge may
    // carry unrecognised legacy prose ("strength of 0.55") which must not leak
    // verbatim. On a BIDIRECTED edge the fallback must also not be directed
    // language — "negligible link" would pack a causal-route word and a false
    // smallness claim into one string. This is why the two allowlists are kept
    // separate rather than unioned: the fallback has to know the family.
    const graph = pack(CONFOUNDED_NODES, [
      {
        from: 'fac_brand',
        to: 'fac_profit',
        relationship: 'strength of 0.55',
        edge_type: 'bidirected',
      },
    ]);
    const edge = confoundedEdge(formatGraphForContext(graph));
    expect(edge.relationship).not.toContain('strength of 0.55');
    expect(edge.relationship).not.toMatch(/\blink\b/);
    expect(edge.relationship).toContain('unmeasured common cause');
    expect(edge.edge_type).toBe('bidirected');
  });

  it('IDEMPOTENT_REPROJECTION_PRESERVES_BIDIRECTED_PHRASE', () => {
    // Measured hazard: a bidirected phrase absent from the projector's
    // allowlist survives pass 1 and is REWRITTEN to "negligible link" on
    // re-projection while `edge_type:"bidirected"` survives — a false
    // SMALLNESS claim about a user-set 0.5, under a fully green suite.
    // Re-projection has no numeric strength, so the phrase can only survive
    // by being allowlisted.
    const once = formatGraphForContext(confoundedPack('bidirected'));
    const twice = formatGraphForContext(pack(once.nodes as unknown[], once.edges as unknown[]));
    const first = confoundedEdge(once);
    const second = confoundedEdge(twice);
    expect(second.edge_type).toBe('bidirected');
    expect(second.relationship).toBe(first.relationship);
    expect(second.relationship).not.toBe('negligible link');
    expect(second.relationship).toContain('unmeasured common cause');
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
