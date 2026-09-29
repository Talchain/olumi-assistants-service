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
import { NodeV3 } from '../../../schemas/cee-v3.js';
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

/**
 * ⚠ C3g PINS A REGRESSION I SHIPPED AND THEN MEASURED, not a hypothetical.
 *
 * The first cut replaced the byte ceiling's mid-JSON `slice` with a "body
 * omitted" marker object. That IS valid JSON, so it satisfied the letter of the
 * requirement — and it turned a real 12-fragile-edge `<ISL_RESULTS>` section
 * into 212 characters of apology, taking `decision-review-prose-fact-wiring`
 * red. A malformed body at least carries the leading entries; an empty one
 * carries nothing, and the failure is silent on our side.
 *
 * ⛔ Note how it hid: the section MEASURED small afterwards. Sizing the OUTPUT
 * cannot tell you the INPUT overflowed — the small number was the symptom, and
 * it reads exactly like "this section was always small".
 *
 * The rule the fix now obeys, and this test enforces: an over-budget section is
 * SHRUNK, never deleted.
 */
describe('C3g — an over-budget section keeps its leading content, not a marker', () => {
  // ⚠ THE FIXTURE HAS TO OVERFLOW *AFTER* THE ARRAY CAPS, NOT BEFORE.
  // The first version used 200 rows. `buildDecisionReviewUserMessage` rank-caps
  // factor_sensitivity and fragile_edges to 15 EACH before the byte ceiling is
  // consulted, so 200 rows became 15 tiny ones, the ceiling never fired, and
  // this whole block passed without exercising a single line of the code it
  // names — while its own precondition (sizing the RAW fixture) read green.
  // A precondition has to measure the object the branch actually receives.
  //
  // So: few rows, each large, so the CAPPED section is still over budget.
  const BULK = 'x'.repeat(500);
  const HEAVY_ISL = {
    factor_sensitivity: Array.from({ length: 12 }, (_, i) => ({
      factor_id: `fac_${i}`,
      factor_label: `Factor ${i}`,
      elasticity: 0.9 - i / 100,
      confidence: 0.5,
      notes: `${BULK}-factor-${i}`,
    })),
    fragile_edges: Array.from({ length: 12 }, (_, i) => ({
      edge_id: `fac_${i}->out_ship`,
      from_label: `Factor ${i}`,
      to_label: 'Ship On Time',
      switch_probability: 0.4,
      notes: `${BULK}-edge-${i}`,
    })),
  };

  const message = buildDecisionReviewUserMessage(
    { ...build(RUN_GRAPH)!, isl_results: HEAVY_ISL as never },
    0.31,
  );
  const open = message.indexOf('<ISL_RESULTS>\n');
  const body = message.slice(open + '<ISL_RESULTS>\n'.length, message.indexOf('\n</ISL_RESULTS>'));
  const at = body.lastIndexOf('\n[TRUNCATED: ');
  const json = at === -1 ? body : body.slice(0, at);

  it('C3g-a PRECONDITION: the section was actually located in the message', () => {
    expect(open, 'an ISL_RESULTS section exists to measure').toBeGreaterThanOrEqual(0);
    expect(json.length, 'and its body is non-empty').toBeGreaterThan(0);
  });

  it('C3g-b PRECONDITION: the BYTE CEILING branch genuinely fired', () => {
    // Not "the raw fixture is big" — the raw fixture is rank-capped first. The
    // only honest evidence the ceiling was consulted is its own disclosure.
    expect(at, 'a truncation marker is present at all').toBeGreaterThan(-1);
    expect(
      body.slice(at),
      'and it is the SECTION-CEILING marker, not an array-cap one',
    ).toContain('section ceiling');
  });

  it('C3g-c it is valid JSON', () => {
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('C3g-d the leading entries SURVIVE — this is a shrink, not a deletion', () => {
    const parsed = JSON.parse(json) as {
      factor_sensitivity?: unknown[];
      fragile_edges?: unknown[];
    };
    expect(parsed.factor_sensitivity?.length ?? 0, 'factors retained').toBeGreaterThan(0);
    expect(parsed.fragile_edges?.length ?? 0, 'edges retained').toBeGreaterThan(0);
    expect(json, 'the most decision-relevant row is retained').toContain('fac_0');
    expect(json, 'and it is NOT replaced by an apology').not.toContain('_truncated');
  });

  it('C3g-e the loss is disclosed', () => {
    expect(at, 'a truncation marker is present').toBeGreaterThan(-1);
    expect(body.slice(at)).toContain('omitted');
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

/**
 * ⛔⛔ C6 — EXPLICIT EDGE IDENTITY SURVIVES THE COMPACTOR'S SORT.
 *
 * `compactGraph` sorts nodes by id (graph-compact.ts:896) and edges by
 * `(from, to)` (:952). The first cut joined the source edges POSITIONALLY and
 * assumed it did not. The failure is invisible on an already-sorted fixture and
 * total on an unsorted one — which is exactly why the original spec missed it:
 * `RUN_GRAPH` happened to be in sorted order.
 *
 * The contrasting-order pair is the whole control. One order alone proves
 * nothing, because the broken join passes on the sorted arm.
 */
describe('C6 — explicit edge ids survive the compactor sort, in either input order', () => {
  const mk = (edges: unknown[]) => ({
    nodes: [
      { id: 'fac_a', kind: 'factor', label: 'Alpha' },
      { id: 'fac_z', kind: 'factor', label: 'Zulu' },
      { id: 'out_o', kind: 'outcome', label: 'Outcome' },
    ],
    edges,
  });
  const EDGE_A = {
    id: 'e_a',
    from: 'fac_a',
    to: 'out_o',
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'positive',
  };
  const EDGE_Z = {
    id: 'e_z',
    from: 'fac_z',
    to: 'out_o',
    strength: { mean: -0.3, std: 0.1 },
    exists_probability: 0.9,
    effect_direction: 'negative',
  };
  const SORTED = mk([EDGE_A, EDGE_Z]);
  const UNSORTED = mk([EDGE_Z, EDGE_A]);

  it('C6a PRECONDITION: the two orders really are different inputs', () => {
    expect((SORTED.edges[0] as { id: string }).id).toBe('e_a');
    expect((UNSORTED.edges[0] as { id: string }).id).toBe('e_z');
  });

  it('C6b PRECONDITION: both take the strict arm, so the sort is actually applied', () => {
    expect(projectRunGraphForDecisionReview({}, SORTED).via).toBe('run_snapshot_strict');
    expect(projectRunGraphForDecisionReview({}, UNSORTED).via).toBe('run_snapshot_strict');
  });

  it.each([
    ['sorted', SORTED],
    ['unsorted', UNSORTED],
  ])('C6c %s input retains BOTH explicit producer ids', (_label, graph) => {
    const projection = projectRunGraphForDecisionReview({}, graph);
    expect(projection.edge_ids_retained, 'both ids are the producer\'s own').toBe(2);
    const ids = (projection.graph.edges as Array<Record<string, unknown>>).map((e) => e.id);
    expect(new Set(ids)).toEqual(new Set(['e_a', 'e_z']));
  });

  it.each([
    ['sorted', SORTED],
    ['unsorted', UNSORTED],
  ])('C6d %s input — both genuine ids GROUND, and an invented one still refuses', (_l, graph) => {
    const projected = projectRunGraphForDecisionReview({}, graph).graph;
    for (const ref of ['e_a', 'e_z']) {
      expect(
        checkDecisionReviewContract(reviewCiting(ref), { graph: projected }).mustDrop,
        `${ref} is a real producer id`,
      ).toBe(false);
    }
    expect(
      checkDecisionReviewContract(reviewCiting('e_invented'), { graph: projected }).mustDrop,
      'the fix must not have widened the gate',
    ).toBe(true);
  });

  it('C6e ids are attached to the RIGHT edge, not merely present somewhere', () => {
    // A set-equality check passes if the two ids are swapped. This binds each id
    // to its own endpoints — the mis-attribution the endpoint guard prevented,
    // now asserted rather than assumed.
    for (const graph of [SORTED, UNSORTED]) {
      const edges = projectRunGraphForDecisionReview({}, graph).graph.edges as Array<
        Record<string, unknown>
      >;
      expect(edges.find((e) => e.from === 'fac_a')?.id).toBe('e_a');
      expect(edges.find((e) => e.from === 'fac_z')?.id).toBe('e_z');
    }
  });
});

/**
 * ⛔⛔ C7 — THE TWO ARMS MUST AGREE ABOUT MEANING, NOT ONLY ABOUT NUMBERS.
 *
 * The fallback arm kept `value` and `strength` while dropping
 * `stated_role: 'constraint'`, `source: 'user_edited'`, `uncertainty_drivers`
 * and a bidirected `edge_type`. That is the ONE-SIDED loss: a qualified limit
 * becomes an unqualified number, and an unmeasured common cause becomes an
 * ordinary causal link. Retaining the number while discarding the qualifier is
 * worse than retaining neither, because it converts an uncertainty into a false
 * certainty.
 *
 * The fixtures differ ONLY by node id casing — `fac_Budget` breaks NodeV3's
 * canonical-id regex — so any difference in the output is the ARM, not the data.
 */
describe('C7 — semantic qualifiers survive on BOTH projection arms', () => {
  const semanticGraph = (budgetId: string) => ({
    nodes: [
      {
        id: budgetId,
        kind: 'factor',
        label: 'Budget',
        observed_state: {
          value: 0.2,
          raw_value: 200000,
          unit: 'GBP',
          stated_role: 'constraint',
          source: 'user_edited',
        },
        uncertainty_drivers: ['supplier quotes vary by a third'],
      },
      {
        id: 'goal_margin',
        kind: 'goal',
        label: 'Gross Margin',
        goal_threshold: 0.8,
        goal_threshold_raw: 80,
        goal_threshold_unit: '%',
        goal_threshold_cap: 100,
        // WHICH RULE produced that cap. `80%` takes the metric's own 0-100
        // scale, so the denominator is independent of the target and the 0.8
        // above is a real reading — unlike a `target_derived_headroom` cap,
        // where the ratio is 0.8 for every target by construction. The model
        // reviewing this decision cannot judge the threshold without it.
        goal_threshold_cap_provenance: 'metric_scale',
        // ⛔ THE FIELD MY FIRST FIXTURE OMITTED, exactly as the code did. A
        // corpus written from the same head as the list cannot see the list is
        // short (trap 12d).
        goal_threshold_frame: 'level',
      },
    ],
    edges: [
      {
        id: 'e_budget_margin',
        from: budgetId,
        to: 'goal_margin',
        strength: { mean: 0.4, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
        edge_type: 'bidirected',
        provenance: { source: 'user_specified', reasoning: 'Both move with headcount.' },
      },
    ],
    // ⚠ THE REAL `GoalConstraintSchema` SHAPE (assist.ts:401). My first version
    // of this fixture invented `{id, kind, target_id}` out of my own head, the
    // whole graph failed strict parse on it, and the "strict arm" assertion was
    // silently measuring the FALLBACK arm — a self-authored fixture encoding my
    // model of the producer instead of the producer. Derived at the schema.
    goal_constraints: [
      {
        constraint_id: 'gc_budget',
        node_id: 'goal_margin',
        operator: '<=' as const,
        value: 200000,
        unit: 'GBP',
        label: 'Keep total spend under GBP200,000',
      },
    ],
  });

  const STRICT = projectRunGraphForDecisionReview({}, semanticGraph('fac_budget'));
  const FALLBACK = projectRunGraphForDecisionReview({}, semanticGraph('fac_Budget'));

  it('C7a PRECONDITION: one fixture takes each arm, and they differ only by id casing', () => {
    expect(STRICT.via).toBe('run_snapshot_strict');
    expect(FALLBACK.via).toBe('run_snapshot_preserving');
  });

  it.each([
    ['strict', () => STRICT],
    ['fallback', () => FALLBACK],
  ])('C7b %s — the limit keeps the qualifier that says it IS a limit', (_l, get) => {
    const budget = (get().graph.nodes as Array<Record<string, unknown>>).find(
      (n) => String(n.id).toLowerCase() === 'fac_budget',
    );
    expect(budget?.raw_value, 'the number').toBe(200000);
    expect(budget?.stated_role, 'and what the number IS').toBe('constraint');
    expect(budget?.unit).toBe('GBP');
  });

  it.each([
    ['strict', () => STRICT],
    ['fallback', () => FALLBACK],
  ])('C7c %s — authorship and stated uncertainty survive', (_l, get) => {
    const budget = (get().graph.nodes as Array<Record<string, unknown>>).find(
      (n) => String(n.id).toLowerCase() === 'fac_budget',
    );
    // One vocabulary across both arms: the shared `valueSourceAuthorship`
    // mapper turns the wire's `user_edited` into the display term `user`. The
    // fallback used to pass the raw string through, so the two arms said
    // different words for the same fact.
    expect(budget?.source, "the user's own figure, not an AI guess").toBe('user');
    expect(
      JSON.stringify(budget),
      'the producer-stated uncertainty reaches the model',
    ).toContain('supplier quotes vary by a third');
  });

  it.each([
    ['strict', () => STRICT],
    ['fallback', () => FALLBACK],
  ])('C7d %s — the goal keeps its threshold, so it is a target not a name', (_l, get) => {
    const goal = (get().graph.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'goal_margin',
    );
    expect(goal?.goal_threshold).toBe(0.8);
    expect(goal?.goal_threshold_raw).toBe(80);
    expect(goal?.goal_threshold_unit).toBe('%');
    expect(goal?.goal_threshold_cap).toBe(100);
    expect(
      goal?.goal_threshold_frame,
      'the frame the threshold is STATED IN — 0.8 of what?',
    ).toBe('level');
  });

  it('C7j the derived field list covers every declared goal_threshold* sibling', () => {
    // The union assertion trap 12d asks for: derivation proves the consumers
    // agree, and only a check against the CONTRACT proves the list is complete.
    // Fails the day NodeV3 gains a sibling this projection does not carry.
    const declared = Object.keys(NodeV3.shape).filter((k) => k.startsWith('goal_threshold'));
    const carried = Object.keys(
      (STRICT.graph.nodes as Array<Record<string, unknown>>).find((n) => n.id === 'goal_margin') ??
        {},
    );
    for (const field of declared) {
      expect(carried, `${field} is declared by NodeV3 and must reach the model`).toContain(field);
    }
    expect(declared.length, 'and the contract really does declare all six').toBe(6);
  });

  it.each([
    ['strict', 'fac_budget'],
    ['fallback', 'fac_Budget'],
  ])('C7k %s — an ABSENT frame stays absent, never defaulted', (_l, budgetId) => {
    const src = semanticGraph(budgetId) as { nodes: Array<Record<string, unknown>> };
    const goal = src.nodes.find((n) => n.id === 'goal_margin')!;
    delete goal.goal_threshold_frame;
    const projected = projectRunGraphForDecisionReview({}, src);
    const out = (projected.graph.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === 'goal_margin',
    );
    expect(out?.goal_threshold, 'the threshold still carries').toBe(0.8);
    expect(out?.goal_threshold_frame, 'but an unstated frame is NOT invented').toBeUndefined();
  });

  it.each([
    ['strict', () => STRICT],
    ['fallback', () => FALLBACK],
  ])('C7e %s — an unmeasured common cause is not presented as a causal link', (_l, get) => {
    const edge = (get().graph.edges as Array<Record<string, unknown>>)[0];
    expect(edge?.edge_type, 'bidirected must not read as an ordinary edge').toBe('bidirected');
  });

  it.each([
    ['strict', () => STRICT],
    ['fallback', () => FALLBACK],
  ])("C7f %s — the producer's reason for the edge reaches the model", (_l, get) => {
    const edge = (get().graph.edges as Array<Record<string, unknown>>)[0];
    expect(edge?.reasoning).toBe('Both move with headcount.');
  });

  it.each([
    ['strict', () => STRICT],
    ['fallback', () => FALLBACK],
  ])('C7g %s — the GBP200,000 goal constraint is NOT deleted', (_l, get) => {
    const constraints = get().graph.goal_constraints as Array<Record<string, unknown>> | undefined;
    expect(constraints, 'the entire point of the turn this component serves').toHaveLength(1);
    expect(constraints?.[0]?.value).toBe(200000);
  });

  it('C7h nothing this projection controls is INVENTED', () => {
    const bare = projectRunGraphForDecisionReview({}, {
      nodes: [{ id: 'fac_bare', kind: 'factor', label: 'Bare' }],
      edges: [],
    });
    const node = (bare.graph.nodes as Array<Record<string, unknown>>)[0];
    expect(node?.stated_role, 'a limit is never inferred').toBeUndefined();
    expect(node?.goal_threshold, 'a target is never inferred').toBeUndefined();
    expect(bare.graph.goal_constraints, 'a constraint is never inferred').toBeUndefined();
  });

  /**
   * ⚠ ONE DIVERGENCE BETWEEN THE ARMS, PINNED RATHER THAN QUIETLY TOLERATED.
   *
   * On a node with no `observed_state`, the RICH compactor stamps
   * `source: 'system'` / `provenance: 'ai_inferred'` — its own long-shipped
   * mapping ("unknown upstream values map to ai_inferred"), not something this
   * projection adds. The fallback arm leaves both ABSENT, because inferring
   * them here is exactly what CX274 forbids and what `toStructuralGraphV3` does
   * wrong.
   *
   * So the arms genuinely differ, in the safe direction: the strict arm inherits
   * an upstream default, the fallback arm asserts nothing. Neither invents a
   * QUALIFIER — no `stated_role`, no threshold, no constraint. Recording it as a
   * test means it fails loudly if either side moves, instead of being
   * rediscovered as a surprise.
   */
  it('C7i the arms diverge ONLY on the compactor\'s own provenance default', () => {
    const bare = { nodes: [{ id: 'fac_bare', kind: 'factor', label: 'Bare' }], edges: [] };
    const strict = projectRunGraphForDecisionReview({}, bare);
    const fallback = projectRunGraphForDecisionReview({}, {
      ...bare,
      nodes: [{ id: 'fac_Bare', kind: 'factor', label: 'Bare' }],
    });
    expect(strict.via).toBe('run_snapshot_strict');
    expect(fallback.via).toBe('run_snapshot_preserving');
    const s0 = (strict.graph.nodes as Array<Record<string, unknown>>)[0];
    const f0 = (fallback.graph.nodes as Array<Record<string, unknown>>)[0];
    expect(s0?.source, "compactGraph's shipped default, inherited not added").toBe('system');
    expect(f0?.source, 'the fallback asserts nothing it was not told').toBeUndefined();
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
