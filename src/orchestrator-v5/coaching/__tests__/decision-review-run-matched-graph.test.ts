/**
 * ⭐⭐⭐ ONE RUN-MATCHED GRAPH, USED COHERENTLY BY THE PROMPT AND THE CONTRACT.
 *
 * These are the four decisive controls named in the review guidance for this
 * component. Each one pins a defect that was measured, not imagined:
 *
 *  C1  A DISAGREEING TWO-READ GRAPH resolves to the RUN's snapshot on both
 *      consumers. The first cut threaded `context.persistedGraph` — the
 *      turn-start reread — so on an edit-then-analyse turn the model would have
 *      been shown one graph and judged against another.
 *
 *  C2  A REAL EDGE'S ALIAS IS GROUNDED; AN INVENTED REFERENCE STILL REFUSES.
 *      `CompactEdge` carries no `id` (graph-compact.ts:143) and
 *      `collectGraphEntityIds` read `.id` only, so giving the model the graph
 *      would have made EVERY edge citation ungrounded → `mustDrop` → the entire
 *      review discarded. The fix is an ADDRESS, and this pair is what separates
 *      it from a relaxation: the negative arm must stay red.
 *
 *  C3  A LARGE GRAPH STAYS PARSEABLE AND KEEPS ITS RELATIONSHIPS. The byte
 *      ceiling used to `json.slice(0, MAX)` — a mid-object cut. It never fired
 *      because `<GRAPH>` has been 21 characters (`{}`) on every live turn.
 *
 *  C4  NO SYNTHESISED FALLBACK FACTS. `toStructuralGraphV3` unconditionally
 *      stamps `strength: {mean: 0}`, `exists_probability: 1`,
 *      `effect_direction: 'positive'` over whatever the source carried. It is
 *      an inert-defaults path for the ContextPack and would be a FABRICATION
 *      here. This pins that a real `-0.6` survives a strict-parse failure.
 */
import { describe, expect, it } from 'vitest';

import {
  checkDecisionReviewContract,
  collectGraphEntityIds,
} from '../../../cee/decision-review/contract-gate.js';
import { buildDecisionReviewUserMessage } from '../../../cee/decision-review/invoke.js';
import { buildSlices } from '../../../cee/decision-review/decompose.js';
import { projectRunGraphForDecisionReview } from '../decision-review-graph-projection.js';
import { buildInvokeInputForTests } from '../decision-review-enricher.js';

// ── fixtures ────────────────────────────────────────────────────────────────

/** The graph the RUN analysed — note `fac_runway`, which the stale read lacks. */
const RUN_GRAPH = {
  nodes: [
    { id: 'opt_lead', kind: 'option', label: 'Hire One Tech Lead' },
    { id: 'fac_quality', kind: 'factor', label: 'Code Quality Level' },
    { id: 'fac_runway', kind: 'factor', label: 'Cash Runway' },
    { id: 'out_ship', kind: 'outcome', label: 'Ship On Time' },
  ],
  edges: [
    {
      id: 'e_quality_ship',
      from: 'fac_quality',
      to: 'out_ship',
      strength: { mean: 0.7, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
    {
      from: 'fac_runway',
      to: 'out_ship',
      strength: { mean: -0.4, std: 0.1 },
      exists_probability: 0.8,
      effect_direction: 'negative',
    },
  ],
};

/** The graph as it stood at TURN START — before the edit this turn made. */
const STALE_TURN_START_GRAPH = {
  nodes: [
    { id: 'opt_lead', kind: 'option', label: 'Hire One Tech Lead' },
    { id: 'fac_quality', kind: 'factor', label: 'Code Quality Level' },
    { id: 'fac_morale', kind: 'factor', label: 'Team Morale' },
  ],
  edges: [
    {
      from: 'fac_morale',
      to: 'fac_quality',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
};

const ENRICHMENT_WITHOUT_GRAPH = () => ({
  option_comparison: [
    { option_id: 'opt_lead', option_label: 'Hire One Tech Lead', win_probability: 0.61 },
    { option_id: 'opt_devs', option_label: 'Two Developers', win_probability: 0.3 },
  ],
  factor_sensitivity: [{ factor_id: 'fac_quality', confidence: 0.6 }],
});

const build = (runGraph?: unknown) =>
  buildInvokeInputForTests(
    'Should I hire a tech lead or two developers?',
    ENRICHMENT_WITHOUT_GRAPH(),
    'opt_lead',
    undefined,
    true,
    runGraph,
  );

/** A contract-legal review output carrying one bias finding. */
const reviewCiting = (...refs: string[]) => ({
  narrative_summary: 'Hiring one tech lead leads on the current evidence.',
  bias_findings: [
    {
      type: 'anchoring',
      description: 'The estimate is anchored on the first figure discussed.',
      affected_elements: refs,
    },
  ],
});

// ── C1 ──────────────────────────────────────────────────────────────────────

describe('C1 — a disagreeing two-read graph resolves to the RUN snapshot', () => {
  it('C1a the prompt-facing graph carries the run graph, not the turn-start reread', () => {
    const projection = projectRunGraphForDecisionReview({}, RUN_GRAPH);
    const labels = JSON.stringify(projection.graph);
    expect(labels, 'the run graph is what the model sees').toContain('Cash Runway');
    expect(labels, 'the stale read must not leak in').not.toContain('Team Morale');
  });

  it('C1b PRECONDITION: the two reads genuinely disagree, so C1a/C1c can discriminate', () => {
    const runIds = collectGraphEntityIds(projectRunGraphForDecisionReview({}, RUN_GRAPH).graph);
    const staleIds = collectGraphEntityIds(
      projectRunGraphForDecisionReview({}, STALE_TURN_START_GRAPH).graph,
    );
    expect(runIds.has('fac_runway')).toBe(true);
    expect(staleIds.has('fac_runway')).toBe(false);
    expect(staleIds.has('fac_morale')).toBe(true);
    expect(runIds.has('fac_morale')).toBe(false);
  });

  it('C1c the CONTRACT grounds against the same run graph — a stale-only id refuses', () => {
    const runGraph = projectRunGraphForDecisionReview({}, RUN_GRAPH).graph;
    expect(
      checkDecisionReviewContract(reviewCiting('fac_runway'), { graph: runGraph }).mustDrop,
      'a node the RUN analysed is grounded',
    ).toBe(false);
    expect(
      checkDecisionReviewContract(reviewCiting('fac_morale'), { graph: runGraph }).mustDrop,
      'a node only the TURN-START read had is NOT grounded',
    ).toBe(true);
  });

  it('C1d the enricher threads it end to end — an empty run graph is the old behaviour', () => {
    expect(Object.keys(build()?.graph ?? {}), 'the live 21-character `{}`').toEqual([]);
    expect(build(RUN_GRAPH)?.graph?.nodes, 'the model finally sees the model').toHaveLength(4);
  });

  it('C1e the enrichment envelope is still authoritative wherever it speaks', () => {
    const own = { nodes: [{ id: 'fac_own', kind: 'factor', label: 'Producer Graph Node' }], edges: [] };
    const input = buildInvokeInputForTests(
      'Should I hire a tech lead or two developers?',
      { ...ENRICHMENT_WITHOUT_GRAPH(), graph: own },
      'opt_lead',
      undefined,
      true,
      RUN_GRAPH,
    );
    expect(JSON.stringify(input?.graph)).toContain('Producer Graph Node');
    expect(JSON.stringify(input?.graph)).not.toContain('Cash Runway');
  });
});

// ── C2 ──────────────────────────────────────────────────────────────────────

describe('C2 — real edge aliases ground; invented references still refuse', () => {
  const graph = projectRunGraphForDecisionReview({}, RUN_GRAPH).graph;
  const drops = (...refs: string[]) =>
    checkDecisionReviewContract(reviewCiting(...refs), { graph }).mustDrop;

  it('C2a PRECONDITION: the source edge has no id, and the projection makes it citable', () => {
    const source = RUN_GRAPH.edges.find((e) => e.from === 'fac_runway') as Record<string, unknown>;
    expect(source.id, 'the producer gave this edge no id — the case the fix is for').toBeUndefined();
    const projected = (graph.edges as Array<Record<string, unknown>>).find(
      (e) => e.from === 'fac_runway',
    );
    expect(
      projected?.id,
      'the prompt tells the model to cite an edge id, so there must be one',
    ).toBe('fac_runway->out_ship');
  });

  it('C2b POSITIVE — every producer spelling of a REAL edge is grounded', () => {
    for (const ref of ['fac_runway->out_ship', 'fac_runway::out_ship', 'fac_runway|out_ship']) {
      expect(drops(ref), `${ref} names an edge that exists`).toBe(false);
    }
  });

  it('C2c POSITIVE — an edge that DOES carry an explicit id is still grounded by it', () => {
    expect(drops('e_quality_ship')).toBe(false);
  });

  it('C2d NEGATIVE — a pair naming no edge refuses, though both endpoints are real', () => {
    expect(
      drops('fac_runway->fac_quality'),
      'both nodes exist; no edge connects them — this must still drop',
    ).toBe(true);
  });

  it('C2e NEGATIVE — a directed edge cited backwards refuses', () => {
    expect(drops('out_ship->fac_runway')).toBe(true);
  });

  it('C2f NEGATIVE — a wholly invented node id refuses', () => {
    expect(drops('fac_does_not_exist')).toBe(true);
  });

  it('C2g NEGATIVE — a pair with one invented endpoint refuses', () => {
    expect(drops('fac_runway->fac_invented')).toBe(true);
  });

  it('C2h the empty-corpus skip is unchanged — no graph means the rule cannot check', () => {
    expect(checkDecisionReviewContract(reviewCiting('anything'), { graph: {} }).mustDrop).toBe(false);
  });
});

// ── C3 ──────────────────────────────────────────────────────────────────────

/** Read the `<GRAPH>` body back out of the assembled prompt, minus its marker. */
function graphBlockOf(message: string): { json: string; marker: string | null } {
  const open = message.indexOf('<GRAPH>\n');
  const close = message.indexOf('\n</GRAPH>');
  expect(open, 'the prompt carries a GRAPH section').toBeGreaterThanOrEqual(0);
  expect(close).toBeGreaterThan(open);
  const body = message.slice(open + '<GRAPH>\n'.length, close);
  const at = body.lastIndexOf('\n[TRUNCATED: ');
  return at === -1
    ? { json: body, marker: null }
    : { json: body.slice(0, at), marker: body.slice(at + 1) };
}

describe('C3 — a large graph stays parseable, keeps relationships, marks omissions', () => {
  const BIG = {
    nodes: Array.from({ length: 120 }, (_, i) => ({
      id: `fac_${i}`,
      kind: 'factor',
      label: `Factor number ${i} with a deliberately long descriptive label`,
      description: `A saved description for factor ${i} that exists to make this graph large.`,
    })),
    edges: Array.from({ length: 150 }, (_, i) => ({
      from: `fac_${i % 120}`,
      to: `fac_${(i + 7) % 120}`,
      strength: { mean: 0.1 + (i % 9) / 10, std: 0.05 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    })),
  };

  const input = build(BIG);
  const message = buildDecisionReviewUserMessage(input!, 0.31);
  const block = graphBlockOf(message);

  it('C3a PRECONDITION: the raw graph really does exceed the section ceiling', () => {
    expect(JSON.stringify(BIG, null, 2).length).toBeGreaterThan(35_000);
  });

  it('C3b the emitted body is valid JSON — never a mid-object slice', () => {
    expect(() => JSON.parse(block.json)).not.toThrow();
  });

  it('C3c relationships survive — this is not an edges-first wipe', () => {
    const parsed = JSON.parse(block.json) as { nodes: unknown[]; edges: unknown[] };
    expect(parsed.edges.length, 'edges are retained, not emptied').toBeGreaterThan(0);
    expect(parsed.nodes.length).toBeGreaterThan(0);
  });

  it('C3d every retained edge has BOTH endpoints present — no dangling relationship', () => {
    const parsed = JSON.parse(block.json) as {
      nodes: Array<{ id: string }>;
      edges: Array<{ from: string; to: string }>;
    };
    const present = new Set(parsed.nodes.map((n) => n.id));
    for (const edge of parsed.edges) {
      expect(present.has(edge.from), `${edge.from} is present`).toBe(true);
      expect(present.has(edge.to), `${edge.to} is present`).toBe(true);
    }
  });

  it('C3e the omission is disclosed both machine-readably and in the marker', () => {
    const parsed = JSON.parse(block.json) as { _omitted?: Record<string, number> };
    expect(parsed._omitted, 'the model can see what it is missing').toBeDefined();
    expect(block.marker).toContain('omitted');
  });

  it('C3f a graph within budget is emitted whole, with no marker at all', () => {
    const small = graphBlockOf(buildDecisionReviewUserMessage(build(RUN_GRAPH)!, 0.31));
    expect(small.marker).toBeNull();
    const parsed = JSON.parse(small.json) as { nodes: unknown[]; edges: unknown[] };
    expect(parsed.nodes).toHaveLength(4);
    expect(parsed.edges).toHaveLength(2);
  });
});

// ── C4 ──────────────────────────────────────────────────────────────────────

describe('C4 — a strict-parse failure preserves source facts, never synthesises them', () => {
  /** `fac_Quality` breaks NodeV3's canonical-id regex, so strict parse fails. */
  const NON_CANONICAL = {
    nodes: [
      { id: 'fac_Quality', kind: 'factor', label: 'Code Quality Level' },
      { id: 'out_ship', kind: 'outcome', label: 'Ship On Time' },
    ],
    // Deliberately EdgeV3-complete: the ONLY thing wrong with this graph is the
    // node id, so C4a cannot pass for an unrelated reason.
    edges: [
      {
        from: 'fac_Quality',
        to: 'out_ship',
        strength: { mean: -0.6, std: 0.1 },
      },
    ],
  };

  const projection = projectRunGraphForDecisionReview({}, NON_CANONICAL);

  it('C4a PRECONDITION: this graph really does take the fallback arm', () => {
    expect(projection.via).toBe('run_snapshot_preserving');
  });

  it('C4b the real edge strength survives — NOT overwritten with 0', () => {
    const edge = (projection.graph.edges as Array<Record<string, unknown>>)[0];
    expect(edge?.strength, 'toStructuralGraphV3 would have made this 0').toBe(-0.6);
  });

  it('C4c absent facts stay absent — no invented exists/direction', () => {
    const edge = (projection.graph.edges as Array<Record<string, unknown>>)[0];
    expect(edge?.exists, 'would have been stamped 1').toBeUndefined();
    expect(edge?.effect_direction, "would have been stamped 'positive'").toBeUndefined();
  });

  it('C4d the strict arm still runs the RICH compactor for a canonical graph', () => {
    const strict = projectRunGraphForDecisionReview({}, RUN_GRAPH);
    expect(strict.via).toBe('run_snapshot_strict');
    const edge = (strict.graph.edges as Array<Record<string, unknown>>)[0];
    expect(edge?.strength, 'the real mean, through compactGraph').toBe(0.7);
    expect(edge?.id, 'and the explicit source id is carried back onto it').toBe('e_quality_ship');
  });
});

// ── C5 ──────────────────────────────────────────────────────────────────────

describe('C5 — the fragments see the same snapshot as the monolith', () => {
  it('C5a the calibration fragment receives the graph entities it must cite', () => {
    const { slices } = buildSlices(build(RUN_GRAPH)!);
    expect(slices.r4, 'R4 is the fragment that emits affected_elements').toContain(
      '<GRAPH_ENTITIES>',
    );
    expect(slices.r4).toContain('fac_runway');
  });

  it('C5b every edge address R4 is shown is one the contract gate accepts', () => {
    const input = build(RUN_GRAPH)!;
    const { slices } = buildSlices(input);
    const body = slices.r4.slice(
      slices.r4.indexOf('<GRAPH_ENTITIES>') + '<GRAPH_ENTITIES>\n'.length,
      slices.r4.indexOf('\n</GRAPH_ENTITIES>'),
    );
    const parsed = JSON.parse(body) as { edges: Array<{ ref: string }> };
    const corpus = collectGraphEntityIds(input.graph);
    expect(parsed.edges.length).toBeGreaterThan(0);
    for (const edge of parsed.edges) {
      expect(corpus.has(edge.ref), `R4 is told to cite ${edge.ref}; the gate must accept it`).toBe(
        true,
      );
    }
  });

  it('C5c a graph-less run leaves the fragment byte-identical to before', () => {
    const { slices } = buildSlices(build()!);
    expect(slices.r4).not.toContain('<GRAPH_ENTITIES>');
  });
});
