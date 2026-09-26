/**
 * C32 — an option added on the canvas is linked to its decision in the SAME
 * commit, and the follow-up link event on the pre-add hash is a no-op, never a
 * 409. Delivery Lead ruling #70 5841216898, step 3.
 *
 * THE DEFECT. Canvas "+ Add option" sends `structural_add` (the option) and then
 * `structural_add_edge` (decision → option). The second event carries the
 * PRE-add `base_graph_hash`, the stale gate refuses it with 409, and the option
 * lands unlinked: `OPTION_NOT_LINKED_TO_DECISION` blocks the whole model.
 *
 * THE CONTRACT, pinned by identity below:
 *   1. `structural_add` of an OPTION on a graph with EXACTLY ONE decision writes
 *      `decision → option` in the same write, with the ONE topology-edge value
 *      the typed add-option transaction writes (`structuralEdgeValue`).
 *   2. Zero decisions or several → no edge. The link is only written when it is
 *      determinate; with two decisions it would be a guess.
 *   3. `structural_add_edge` for a pair that ALREADY EXISTS is decided BEFORE the
 *      stale gate: `edge_already_exists`, never `BASE_HASH_DIVERGED`.
 *   4. The stale gate still refuses a stale base for an edge that is NOT there.
 */
import { describe, it, expect } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

import { applyStructuralAdd, type StructuralAddResult } from '../structural-add.js';
import { applyStructuralAddEdge, type StructuralAddEdgeResult } from '../structural-add-edge.js';
import { structuralEdgeValue } from '../../routing/add-option-transaction.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { BASE_HASH_DIVERGED } from '../../graph-management/reason-codes.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
const TURN_ID = '44444444-4444-4444-8444-444444444444';

const DECISION = 'dec_pricing';
const NEW_OPTION = 'opt_wait';

function graphWithDecisions(decisionIds: readonly string[]): Record<string, unknown> {
  const decisions = decisionIds.map((id) => ({ id, kind: 'decision', label: `Decide ${id}` }));
  const decisionEdges = decisionIds.map((id) => structuralEdgeValue(id, 'opt_launch'));
  return {
    schema_version: '3.0',
    goal_node_id: 'goal_revenue',
    nodes: [
      ...decisions,
      { id: 'goal_revenue', kind: 'goal', label: 'Grow revenue' },
      {
        id: 'fac_price',
        kind: 'factor',
        label: 'Unit price',
        category: 'controllable',
        observed_state: { value: 0.4, raw_value: 40000, cap: 100000 },
      },
      {
        id: 'opt_launch',
        kind: 'option',
        label: 'Launch now',
        interventions: { fac_price: { value: 0.4, raw_value: 40000 } },
      },
    ],
    edges: [
      ...decisionEdges,
      structuralEdgeValue('opt_launch', 'fac_price'),
      {
        from: 'fac_price',
        to: 'goal_revenue',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
      },
    ],
    options: [
      {
        id: 'opt_launch',
        label: 'Launch now',
        status: 'ready',
        interventions: { fac_price: { value: 0.4, raw_value: 40000 } },
      },
    ],
  };
}

function hashOf(graph: unknown): string {
  const hash = computeAnalysisAffectingGraphHash(
    graph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (hash === null) throw new Error('fixture is unhashable — the fixture is wrong, not the code');
  return hash;
}

function payloadFor(event: Record<string, unknown>): SystemEventTurnPayload {
  return {
    kind: 'system_event',
    turn_id: TURN_ID,
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    event,
  } as unknown as SystemEventTurnPayload;
}

function addNode(graph: Record<string, unknown>, nodeKind = 'option'): StructuralAddResult {
  const event = {
    kind: 'structural_add' as const,
    node_id: nodeKind === 'option' ? NEW_OPTION : 'fac_churn',
    node_kind: nodeKind,
    label: nodeKind === 'option' ? 'Wait a quarter' : 'Customer churn',
    base_graph_hash: hashOf(graph),
  };
  return applyStructuralAdd({
    payload: payloadFor(event),
    event: event as never,
    requestId: 'req-c32',
    persistedGraph: graph,
  });
}

function addEdge(
  graph: unknown,
  from: string,
  to: string,
  baseGraphHash: string,
): StructuralAddEdgeResult {
  const event = {
    kind: 'structural_add_edge' as const,
    from,
    to,
    magnitude: 1,
    effect_direction: 'positive' as const,
    base_graph_hash: baseGraphHash,
  };
  return applyStructuralAddEdge({
    payload: payloadFor(event),
    event: event as never,
    requestId: 'req-c32-edge',
    persistedGraph: graph,
  });
}

function mutated(result: StructuralAddResult): Extract<StructuralAddResult, { kind: 'mutated' }> {
  if (result.kind !== 'mutated') {
    throw new Error(`expected a mutation, got refusal: ${result.reason}`);
  }
  return result;
}

const edgeKeys = (graph: { edges: ReadonlyArray<{ from: string; to: string }> }): string[] =>
  graph.edges.map((e) => `${e.from}::${e.to}`).sort();

describe('C32 — structural_add of an option links it to the one decision', () => {
  it('PRECONDITION: the fixture is valid and its decision already selects the existing option', () => {
    const g = graphWithDecisions([DECISION]);
    expect(GraphV3.safeParse(g).success).toBe(true);
    const violations = validateGraphStructure(GraphV3.parse(g)).violations.map((v) => v.code);
    expect(violations).not.toContain('OPTION_NOT_LINKED_TO_DECISION');
  });

  it('one decision → the option lands WITH decision→option, in the same write, as the topology edge', () => {
    const base = graphWithDecisions([DECISION]);
    const result = mutated(addNode(base));

    expect(edgeKeys(result.graph)).toEqual(
      [...edgeKeys(GraphV3.parse(base)), `${DECISION}::${NEW_OPTION}`].sort(),
    );
    // IDENTITY, not a value predicate: the exact bytes the typed add-option
    // transaction writes for the same pair.
    const link = result.graph.edges.find((e) => e.from === DECISION && e.to === NEW_OPTION);
    expect(link).toMatchObject(structuralEdgeValue(DECISION, NEW_OPTION));
    expect(result.handlerFacts[0]).toMatchObject({
      result: { status: 'applied', operations_count: 2 },
    });
  });

  it('OUTCOME: the added option is not reported as unlinked, so it cannot block the model', () => {
    const result = mutated(addNode(graphWithDecisions([DECISION])));
    const unlinked = validateGraphStructure(result.graph).violations.filter(
      (v) => v.code === 'OPTION_NOT_LINKED_TO_DECISION',
    );
    expect(unlinked).toEqual([]);
  });

  it('the confirmation names the decision it was linked to and still says what is missing', () => {
    const text = mutated(addNode(graphWithDecisions([DECISION]))).response.assistant_text;
    expect(text).toContain(`Decide ${DECISION}`);
    expect(text).toContain('factors it changes');
    expect(text).not.toContain("isn't connected to anything");
  });

  it('CONTRAST: two decisions → no link (it would be a guess) and the honest "not connected" copy', () => {
    const base = graphWithDecisions([DECISION, 'dec_other']);
    const result = mutated(addNode(base));
    expect(edgeKeys(result.graph)).toEqual(edgeKeys(GraphV3.parse(base)));
    expect(result.handlerFacts[0]).toMatchObject({ result: { operations_count: 1 } });
    expect(result.response.assistant_text).toContain("isn't connected to anything");
  });

  it('CONTRAST: no decision → no link', () => {
    const base = graphWithDecisions([]);
    const result = mutated(addNode(base));
    expect(edgeKeys(result.graph)).toEqual(edgeKeys(GraphV3.parse(base)));
  });

  it('CONTRAST: a FACTOR added on a one-decision graph gets no edge', () => {
    const base = graphWithDecisions([DECISION]);
    const result = mutated(addNode(base, 'factor'));
    expect(edgeKeys(result.graph)).toEqual(edgeKeys(GraphV3.parse(base)));
  });
});

describe('C32 — structural_add_edge for a link that already exists is a no-op BEFORE the stale gate', () => {
  it('⭐ THE SEQUENCE: add option on H0 → link event on H0 → edge_already_exists, never a 409, and nothing moves', () => {
    const g0 = graphWithDecisions([DECISION]);
    const h0 = hashOf(g0);
    const g1 = mutated(addNode(g0)).mutatedGraph;
    expect(hashOf(g1)).not.toBe(h0);

    const follow = addEdge(g1, DECISION, NEW_OPTION, h0);
    expect(follow.kind).toBe('refused');
    if (follow.kind !== 'refused') return;
    expect(follow.reason).toBe('edge_already_exists');
    expect(follow.baseHashConflict).toBeUndefined();
  });

  it('CONTRAST: a stale base for a link that is NOT there is still refused as diverged', () => {
    const g0 = graphWithDecisions([DECISION, 'dec_other']);
    const h0 = hashOf(g0);
    const g1 = mutated(addNode(g0)).mutatedGraph; // two decisions → unlinked
    const follow = addEdge(g1, DECISION, NEW_OPTION, h0);
    expect(follow.kind).toBe('refused');
    if (follow.kind !== 'refused') return;
    expect(follow.reason).toBe(BASE_HASH_DIVERGED);
    expect(follow.baseHashConflict?.expected_base_graph_hash).toBe(hashOf(g1));
  });

  it('PARITY: the edge writer, on a fresh base, writes the same topology bytes as the backstop', () => {
    const g0 = graphWithDecisions([DECISION, 'dec_other']);
    const g1 = mutated(addNode(g0)).mutatedGraph;
    const drawn = addEdge(g1, DECISION, NEW_OPTION, hashOf(g1));
    expect(drawn.kind).toBe('mutated');
    if (drawn.kind !== 'mutated') return;
    const link = drawn.graph.edges.find((e) => e.from === DECISION && e.to === NEW_OPTION);
    expect(link).toMatchObject(structuralEdgeValue(DECISION, NEW_OPTION));
  });
});

describe('C32 — the no-op reply for an existing decision link', () => {
  it('says the option is already one of the decision\'s options, and does not point at a strength control', () => {
    const g1 = mutated(addNode(graphWithDecisions([DECISION]))).mutatedGraph;
    const follow = addEdge(g1, DECISION, NEW_OPTION, hashOf(g1));
    expect(follow.kind).toBe('refused');
    expect(follow.response.assistant_text).toBe(
      `Wait a quarter is already an option for Decide ${DECISION}, so there was nothing to change.`,
    );
  });
});
