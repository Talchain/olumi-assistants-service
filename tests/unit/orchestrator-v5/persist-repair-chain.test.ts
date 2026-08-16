/**
 * V5 persist-site repair CHAIN — combined fixture (Track S #274 + edit_graph P0).
 *
 * `commitDirectAnswer` runs TWO independent persist-site repairs on the graph
 * before `store.append`, in this fixed order (commit.ts):
 *
 *   1. repairGraphForPersistence            (Track S 0.13c-4 / #274) — strips a
 *      duplicate observed-root `intercept` (intercept === observed_state.value)
 *      from FACTOR/root nodes.
 *   2. normaliseOptionInterventionContract  (edit_graph P0) — promotes an
 *      edit-added OPTION's `data.interventions` to the canonical top-level
 *      `interventions` (InterventionV3) shape.
 *
 * ORDERING / COMMUTATIVITY: the two repairs operate on DISJOINT node sets and
 * DISJOINT fields — Track S only deletes `intercept` on factor/root nodes and
 * reads only `edges` + `observed_state`; the normaliser only rewrites
 * `interventions`/`data` on option nodes and reads neither `intercept` nor
 * `observed_state`. Neither repair's input is altered by the other, so they
 * COMMUTE: running them in either order yields a byte-identical graph (proven
 * in "commutativity" below). The fixed repair→normalise order in commit.ts is
 * therefore for code clarity (it appends the new step after the existing #274
 * call), not a correctness dependency.
 *
 * This fixture is the one place both repairs fire on a single graph.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { commitDirectAnswer } from '../../../src/orchestrator-v5/commit.js';
import { composeDirectAnswerResponse } from '../../../src/orchestrator-v5/compose.js';
import { createNoopSessionStore } from '../../../src/orchestrator-v5/session/__tests__/fixtures.js';
import type { SessionStore, SessionTurnWrite } from '../../../src/orchestrator-v5/session/store.js';
import { repairGraphForPersistence } from '../../../src/orchestrator-v5/repair-graph-for-persistence.js';
import { normaliseOptionInterventionContract } from '../../../src/orchestrator-v5/normalise-option-interventions.js';
import { setTestSink } from '../../../src/utils/telemetry.js';
import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { computeStructuralReadiness } from '../../../src/orchestrator/tools/analysis-ready-helper.js';

type AnyNode = Record<string, unknown> & { id: string };
type AnyGraph = { nodes: AnyNode[]; edges: Array<Record<string, unknown>>; [k: string]: unknown };

const META = {
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  turn_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  turn_class: 'direct_answer' as const,
  handler_id: null,
  request_hash: 'sha256:test',
  llm_calls_used: 1,
  duration_ms: 5,
  handler_facts: [],
  graphReceiptIntent: 'canonical_mutation' as const,
};

const nodeById = (g: AnyGraph, id: string): AnyNode => {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} missing`);
  return n;
};

/** Draft-created option: canonical top-level InterventionV3 (must stay byte-equivalent). */
const draftOption = (): AnyNode => ({
  id: 'opt_draft',
  kind: 'option',
  label: 'draft opt_draft',
  is_baseline: true,
  interventions: {
    fac_a: {
      unit: '£',
      value: 0.9,
      source: 'brief_extraction',
      reasoning: 'draft',
      target_match: { node_id: 'fac_a', confidence: 'high', match_type: 'exact_id' },
      value_confidence: 'high',
    },
  },
});

/**
 * A single graph that triggers BOTH repairs:
 *  - fac_root_dup: factor with NO incoming edge carrying intercept === observed_state.value → Track S strips it.
 *  - fac_keep:     factor with a non-equal intercept → Track S preserves it (control).
 *  - opt_hybrid:   edit-added option with data.interventions → normaliser promotes to top-level.
 *  - opt_draft:    canonical draft option → both repairs no-op (byte-equivalent).
 */
const buildCombinedGraph = (): AnyGraph => ({
  nodes: [
    { id: 'goal_g', kind: 'goal', label: 'G' },
    { id: 'dec_d', kind: 'decision', label: 'D' },
    { id: 'fac_root_dup', kind: 'factor', label: 'Root Dup', observed_state: { value: 0.6 }, intercept: 0.6 },
    { id: 'fac_keep', kind: 'factor', label: 'Keep', observed_state: { value: 0.9 }, intercept: 0.3 },
    { id: 'fac_a', kind: 'factor', label: 'A', observed_state: { value: 0.2 } },
    { id: 'fac_b', kind: 'factor', label: 'B', observed_state: { value: 0.1 } },
    draftOption(),
    {
      id: 'opt_hybrid',
      kind: 'option',
      label: 'Hybrid',
      is_baseline: false,
      data: {
        interventions: {
          fac_a: { cap: 100, unit: '£', value: 0.55, raw_value: 55 },
          fac_b: 0.4,
        },
      },
    },
  ],
  edges: [
    { from: 'dec_d', to: 'opt_draft', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'dec_d', to: 'opt_hybrid', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_draft', to: 'fac_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_hybrid', to: 'fac_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'opt_hybrid', to: 'fac_b', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ],
});

const PROMOTED_OPT_HYBRID_INTERVENTIONS = {
  fac_a: {
    value: 0.55,
    source: 'user_specified',
    target_match: { node_id: 'fac_a', match_type: 'exact_id', confidence: 'high' },
    unit: '£',
    raw_value: 55,
  },
  fac_b: {
    value: 0.4,
    source: 'user_specified',
    target_match: { node_id: 'fac_b', match_type: 'exact_id', confidence: 'high' },
  },
};

function makeSpyStore(): { store: SessionStore; appendCalls: SessionTurnWrite[] } {
  const appendCalls: SessionTurnWrite[] = [];
  const noop = createNoopSessionStore({ appendId: 'row-spy' });
  const spy = vi.spyOn(noop, 'append').mockImplementation(async (write) => {
    appendCalls.push(write);
    return {
      id: 'row-spy',
      ...(write.graph != null
        ? { graph_write_disposition: 'accepted_insert' as const }
        : {}),
    };
  });
  void spy;
  return { store: noop, appendCalls };
}

afterEach(() => {
  vi.restoreAllMocks();
  setTestSink(null);
});

describe('persist-site repair chain — Track S #274 + edit_graph P0 (combined)', () => {
  it('through commitDirectAnswer: BOTH repairs fire — intercept stripped AND option interventions promoted — draft byte-equivalent', async () => {
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    setTestSink((event, data) => events.push({ event, data }));
    const { store, appendCalls } = makeSpyStore();
    const g = buildCombinedGraph();
    const composed = composeDirectAnswerResponse({
answerKind: 'functional', assistant_text: 'applied', stage: 'frame' });

    await commitDirectAnswer(composed, { ...META, graph: g }, store);

    expect(appendCalls).toHaveLength(1);
    const persisted = appendCalls[0]!.graph as AnyGraph;

    // (1) Track S intercept repair still applies (and preserves the non-equal control)
    expect('intercept' in nodeById(persisted, 'fac_root_dup')).toBe(false);
    expect(nodeById(persisted, 'fac_keep').intercept).toBe(0.3);
    expect(events.filter((e) => e.event === 'v5.graph_persist.intercept_repair')).toHaveLength(1);
    expect((events.find((e) => e.event === 'v5.graph_persist.intercept_repair')!.data as { node_ids: string[] }).node_ids)
      .toEqual(['fac_root_dup']);

    // (2) Option interventions promoted to the canonical top-level contract
    const opt = nodeById(persisted, 'opt_hybrid');
    expect(opt.interventions).toEqual(PROMOTED_OPT_HYBRID_INTERVENTIONS);
    expect(opt.data).toBeUndefined();

    // (3) Draft-created option is byte-equivalent
    expect(JSON.stringify(nodeById(persisted, 'opt_draft'))).toBe(JSON.stringify(draftOption()));

    // input graph not mutated (both repairs deep-clone)
    expect('intercept' in nodeById(g, 'fac_root_dup')).toBe(true);
    expect((nodeById(g, 'opt_hybrid').data as { interventions: unknown }).interventions).toBeDefined();
  });

  it('P0-A: commitDirectAnswer normalises an option interventions:null → {} before store.append, so the persisted graph is readable and rerun is graceful', async () => {
    setTestSink(() => {});
    const { store, appendCalls } = makeSpyStore();
    // Simulate the residual: the final appliedGraph carries an added option with
    // interventions:null (an unrecognised-shape add the #281 encoder did not flag).
    const g: AnyGraph = {
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'G' },
        { id: 'dec_d', kind: 'decision', label: 'D' },
        { id: 'fac_a', kind: 'factor', label: 'A', observed_state: { value: 0.2 } },
        draftOption(),
        { id: 'opt_inhouse_capacity', kind: 'option', label: 'In-House Capacity', is_baseline: false, interventions: null },
      ],
      edges: [
        // Schema-valid edges so GraphV3.safeParse isolates the interventions fix.
        { from: 'dec_d', to: 'opt_draft', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'dec_d', to: 'opt_inhouse_capacity', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_draft', to: 'fac_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_inhouse_capacity', to: 'fac_a', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'fac_a', to: 'goal_g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      ],
    };
    const composed = composeDirectAnswerResponse({
answerKind: 'functional', assistant_text: 'applied', stage: 'frame' });

    await commitDirectAnswer(composed, { ...META, graph: g }, store);

    const persisted = appendCalls[0]!.graph as AnyGraph;
    // (1) interventions:null normalised to an analysis-safe empty record
    expect(nodeById(persisted, 'opt_inhouse_capacity').interventions).toEqual({});
    // (2) the persisted graph now PARSES (interventions:null previously failed GraphV3 → rerun 500)
    const parsed = GraphV3.safeParse(persisted);
    expect(parsed.success).toBe(true);
    // (3) rerun degrades gracefully: the option is needs_encoding, NOT an unreadable graph
    if (parsed.success) {
      const readiness = computeStructuralReadiness(parsed.data);
      const opt = readiness!.options.find((o) => o.option_id === 'opt_inhouse_capacity')!;
      expect(opt.status).toBe('needs_encoding');
    }
    // (4) draft option byte-equivalent; input not mutated
    expect(JSON.stringify(nodeById(persisted, 'opt_draft'))).toBe(JSON.stringify(draftOption()));
    expect((g.nodes.find((n) => n.id === 'opt_inhouse_capacity') as AnyNode).interventions).toBeNull();
  });

  it('P0-A: commitDirectAnswer also sweeps a NON-OPTION node interventions:null → {} (node-level parse-bomb surface)', async () => {
    setTestSink(() => {});
    const { store, appendCalls } = makeSpyStore();
    // A factor node carrying interventions:null would fail GraphV3 on read just
    // like an option — the sweep must cover it at the commit chokepoint.
    const g: AnyGraph = {
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'G' },
        { id: 'dec_d', kind: 'decision', label: 'D' },
        { id: 'fac_bomb', kind: 'factor', label: 'F', observed_state: { value: 0.2 }, interventions: null },
        draftOption(),
      ],
      edges: [
        { from: 'dec_d', to: 'opt_draft', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_draft', to: 'fac_bomb', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'fac_bomb', to: 'goal_g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      ],
    };
    const composed = composeDirectAnswerResponse({
answerKind: 'functional', assistant_text: 'applied', stage: 'frame' });

    await commitDirectAnswer(composed, { ...META, graph: g }, store);

    const persisted = appendCalls[0]!.graph as AnyGraph;
    expect(nodeById(persisted, 'fac_bomb').interventions).toEqual({}); // non-option swept too
    expect(GraphV3.safeParse(persisted).success).toBe(true);           // graph now readable
    expect((g.nodes.find((n) => n.id === 'fac_bomb') as AnyNode).interventions).toBeNull(); // input untouched
  });

  it('idempotent: re-committing the already-repaired graph changes nothing (stable persisted graph)', async () => {
    setTestSink(() => {});
    const composed = composeDirectAnswerResponse({
answerKind: 'functional', assistant_text: 'applied', stage: 'frame' });

    const first = makeSpyStore();
    await commitDirectAnswer(composed, { ...META, graph: buildCombinedGraph() }, first.store);
    const persisted1 = first.appendCalls[0]!.graph as AnyGraph;
    vi.restoreAllMocks();

    const second = makeSpyStore();
    await commitDirectAnswer(composed, { ...META, graph: persisted1 }, second.store);
    const persisted2 = second.appendCalls[0]!.graph as AnyGraph;

    expect(persisted2).toEqual(persisted1);
    // second pass finds nothing to repair → no intercept dup, no data.interventions
    expect('intercept' in nodeById(persisted2, 'fac_root_dup')).toBe(false);
    expect(nodeById(persisted2, 'opt_hybrid').interventions).toEqual(PROMOTED_OPT_HYBRID_INTERVENTIONS);
  });

  it('commutativity: repair→normalise (commit.ts order) === normalise→repair (the two repairs commute)', () => {
    const ctx = { scenarioId: 'sc', turnId: 't', source: 'edit_graph' };

    // commit.ts order: Track S first, then the option normaliser.
    const repairThenNormalise = normaliseOptionInterventionContract(
      repairGraphForPersistence(buildCombinedGraph(), ctx),
      ctx,
    );
    // reversed order.
    const normaliseThenRepair = repairGraphForPersistence(
      normaliseOptionInterventionContract(buildCombinedGraph(), ctx),
      ctx,
    );

    // byte-identical regardless of order — the repairs touch disjoint node sets/fields
    expect(repairThenNormalise).toEqual(normaliseThenRepair);

    // both orders produce the fully-repaired graph
    const out = repairThenNormalise as AnyGraph;
    expect('intercept' in nodeById(out, 'fac_root_dup')).toBe(false);
    expect(nodeById(out, 'opt_hybrid').interventions).toEqual(PROMOTED_OPT_HYBRID_INTERVENTIONS);
    expect(nodeById(out, 'opt_hybrid').data).toBeUndefined();
    expect(JSON.stringify(nodeById(out, 'opt_draft'))).toBe(JSON.stringify(draftOption()));
  });
});
