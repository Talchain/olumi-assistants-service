/**
 * Unit tests for the remove_factor deterministic action.
 *
 * Pin the analysis_ready recompute contract introduced 2026-04-08:
 * - The handler must return analysis_ready that no longer references the
 *   removed factor on any option's intervention map. Without this, the prior
 *   analysis_ready in the UI store would still target the deleted node and
 *   the next run_analysis would be rejected by PLoT with
 *   INVALID_INTERVENTION_TARGET.
 * - The handler must NOT mutate ctx.graph (read-only synthetic graph
 *   construction, mirrors add-option's pattern).
 * - All three intervention storage locations on option nodes are pruned:
 *     1. node.data.interventions (canonical edit location)
 *     2. node["data/interventions/<fac_id>"] (slash-keyed)
 *     3. node.interventions (top-level passthrough)
 *   so the rewritten node remains self-consistent regardless of which
 *   write path the original payload used.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { removeFactorAction } from "../../../../../src/orchestrator/deterministic/actions/remove-factor.js";
import type { DeterministicTurnContext } from "../../../../../src/orchestrator/deterministic/types.js";
import type { GraphV3T } from "../../../../../src/schemas/cee-v3.js";

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a minimal graph with two factors and two option nodes that intervene
 * on both. The interventions are mirrored on `data.interventions` and on the
 * top-level `interventions` field so the test exercises both pruning paths.
 */
function makeGraphWithOptions(): GraphV3T {
  return {
    nodes: [
      { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
      { id: 'fac_price', kind: 'factor', label: 'Price' },
      { id: 'fac_volume', kind: 'factor', label: 'Volume' },
      {
        id: 'opt_aggressive',
        kind: 'option',
        label: 'Aggressive pricing',
        data: { interventions: { fac_price: 0.8, fac_volume: 0.4 } },
        interventions: { fac_price: 0.8, fac_volume: 0.4 },
      },
      {
        id: 'opt_conservative',
        kind: 'option',
        label: 'Conservative pricing',
        data: { interventions: { fac_price: 0.3, fac_volume: 0.7 } },
        interventions: { fac_price: 0.3, fac_volume: 0.7 },
      },
    ],
    edges: [
      { from: 'fac_price', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_volume', to: 'goal_revenue', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_aggressive', to: 'fac_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_aggressive', to: 'fac_volume', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_conservative', to: 'fac_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'opt_conservative', to: 'fac_volume', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
    ],
  } as unknown as GraphV3T;
}

/**
 * Mirror buildEntityRegistry()'s edge transform so the fixture's
 * `entities.edges` stays in sync with `graph.edges`. The handler reads
 * connected edges from `entities.edges` (not `graph.edges`) when enumerating
 * remove_edge operations and when filtering the synthetic graph; if these
 * diverge, the test will silently mis-fire.
 */
function buildEntityEdgesFromGraph(graph: GraphV3T): Array<Record<string, unknown>> {
  return graph.edges.map((edge) => ({
    from: (edge as Record<string, unknown>).from,
    to: (edge as Record<string, unknown>).to,
    from_label: String((edge as Record<string, unknown>).from ?? ''),
    to_label: String((edge as Record<string, unknown>).to ?? ''),
    strength_mean: ((edge as Record<string, unknown>).strength as { mean?: number } | undefined)?.mean ?? 0,
    strength_std: ((edge as Record<string, unknown>).strength as { std?: number } | undefined)?.std ?? 0,
    exists_probability: (edge as Record<string, unknown>).exists_probability ?? 1,
    effect_direction: (edge as Record<string, unknown>).effect_direction,
  }));
}

function buildEntityNodesFromGraph(graph: GraphV3T): Map<string, Record<string, unknown>> {
  const m = new Map<string, Record<string, unknown>>();
  for (const node of graph.nodes) {
    const n = node as Record<string, unknown>;
    m.set(n.id as string, {
      id: n.id,
      label: n.label ?? n.id,
      kind: n.kind,
      aliases: [],
      is_action_target: n.kind !== 'decision',
    });
  }
  return m;
}

function makeTurnContext(graph: GraphV3T): DeterministicTurnContext {
  return {
    stage: 'ideate',
    entities: {
      nodes: buildEntityNodesFromGraph(graph) as unknown as Map<string, never>,
      edges: buildEntityEdgesFromGraph(graph) as unknown as never[],
      option_ids: graph.nodes.filter((n) => (n as { kind: string }).kind === 'option').map((n) => (n as { id: string }).id),
      goal_id: 'goal_revenue',
    },
    graph_summary: {
      node_count: graph.nodes.length,
      edge_count: graph.edges.length,
      option_count: 2,
      option_labels: ['Aggressive pricing', 'Conservative pricing'],
      goal_label: 'Revenue',
      missing_structural: [],
    },
    analysis_summary: null,
    capabilities: {
      can_run_analysis: true,
      can_explain_results: false,
      can_edit_graph: true,
      can_compare_options: true,
      can_challenge: false,
      can_generate_artefact: false,
    },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 1, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: ['remove_factor'],
    disambiguation_hints: [],
    graph,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test',
    turn_id: 'turn-1',
    analysis_inputs: null,
  } as unknown as DeterministicTurnContext;
}

// ─────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────

describe("remove_factor action — analysis_ready recompute", () => {
  it("returns analysis_ready that no longer references the removed factor on any option's interventions", async () => {
    const ctx = makeTurnContext(makeGraphWithOptions());
    const result = await removeFactorAction.execute({ target_id: 'fac_price' }, ctx);

    expect(result.operations).toBeDefined();
    expect(result.analysis_ready).toBeDefined();

    const opts = result.analysis_ready!.options;
    expect(opts).toHaveLength(2);

    for (const opt of opts) {
      // The removed factor must NOT appear as an intervention key on any option.
      expect(Object.keys(opt.interventions)).not.toContain('fac_price');
      // The other factor must still be present.
      expect(Object.keys(opt.interventions)).toContain('fac_volume');
    }
  });

  it("preserves analysis_ready.goal_node_id pointing at the unchanged goal", async () => {
    const ctx = makeTurnContext(makeGraphWithOptions());
    const result = await removeFactorAction.execute({ target_id: 'fac_price' }, ctx);

    expect(result.analysis_ready!.goal_node_id).toBe('goal_revenue');
  });

  it("each option's status reflects its remaining numeric interventions", async () => {
    const ctx = makeTurnContext(makeGraphWithOptions());
    const result = await removeFactorAction.execute({ target_id: 'fac_price' }, ctx);

    const opts = result.analysis_ready!.options;
    // Both options still intervene on fac_volume — both should be 'ready'.
    for (const opt of opts) {
      expect(opt.status).toBe('ready');
    }
  });

  it("removes ALL interventions for an option whose only intervention targets the removed factor → option becomes needs_user_mapping (orphaned, no remaining edges)", async () => {
    // Build a graph where opt_aggressive only intervenes on fac_price.
    // After removing fac_price, that option has empty interventions but still
    // has its outgoing edge to fac_price (the edge is removed alongside),
    // so connectedFactors becomes empty → status falls to needs_user_mapping.
    const graph = {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        { id: 'fac_price', kind: 'factor', label: 'Price' },
        { id: 'fac_volume', kind: 'factor', label: 'Volume' },
        {
          id: 'opt_price_only',
          kind: 'option',
          label: 'Price only',
          data: { interventions: { fac_price: 0.5 } },
          interventions: { fac_price: 0.5 },
        },
        {
          id: 'opt_volume_only',
          kind: 'option',
          label: 'Volume only',
          data: { interventions: { fac_volume: 0.5 } },
          interventions: { fac_volume: 0.5 },
        },
      ],
      edges: [
        { from: 'fac_price', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'fac_volume', to: 'goal_revenue', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_price_only', to: 'fac_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_volume_only', to: 'fac_volume', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      ],
    } as unknown as GraphV3T;

    const ctx = makeTurnContext(graph);
    const result = await removeFactorAction.execute({ target_id: 'fac_price' }, ctx);

    expect(result.analysis_ready).toBeDefined();
    const priceOnly = result.analysis_ready!.options.find((o) => o.option_id === 'opt_price_only');
    const volumeOnly = result.analysis_ready!.options.find((o) => o.option_id === 'opt_volume_only');

    expect(priceOnly).toBeDefined();
    // Its intervention map is now empty AND its connected edge was removed
    // (since fac_price went away). computeStructuralReadiness assigns
    // needs_user_mapping when interventions are missing AND no factors are
    // connected.
    expect(priceOnly!.interventions).toEqual({});
    expect(priceOnly!.status).toBe('needs_user_mapping');

    expect(volumeOnly).toBeDefined();
    expect(volumeOnly!.interventions).toEqual({ fac_volume: 0.5 });
    expect(volumeOnly!.status).toBe('ready');
  });

  it("does NOT mutate ctx.graph", async () => {
    const graph = makeGraphWithOptions();
    const originalNodes = graph.nodes;
    const originalEdges = graph.edges;
    const originalNodeCount = graph.nodes.length;
    const originalEdgeCount = graph.edges.length;
    // Snapshot the option nodes' intervention maps by reference before calling.
    const originalAggressive = graph.nodes.find((n) => n.id === 'opt_aggressive') as Record<string, unknown>;
    const originalAggressiveInterventions = originalAggressive.interventions;
    const originalAggressiveDataInterventions = (originalAggressive.data as Record<string, unknown>).interventions;

    const ctx = makeTurnContext(graph);
    await removeFactorAction.execute({ target_id: 'fac_price' }, ctx);

    // The original arrays/objects must be unchanged.
    expect(graph.nodes).toBe(originalNodes);
    expect(graph.edges).toBe(originalEdges);
    expect(graph.nodes.length).toBe(originalNodeCount);
    expect(graph.edges.length).toBe(originalEdgeCount);

    // The original option node and its intervention maps must be unchanged.
    const aggressiveAfter = graph.nodes.find((n) => n.id === 'opt_aggressive') as Record<string, unknown>;
    expect(aggressiveAfter.interventions).toBe(originalAggressiveInterventions);
    expect((aggressiveAfter.data as Record<string, unknown>).interventions).toBe(originalAggressiveDataInterventions);
    // And the removed factor key must STILL be present in the original graph
    // (the synthetic graph pruned a clone, not the original).
    expect((aggressiveAfter.interventions as Record<string, unknown>).fac_price).toBe(0.8);
  });

  it("handles slash-keyed intervention storage (data/interventions/<fac>) by removing the matching key", async () => {
    // Build a graph where the option uses the slash-keyed scalar wrapping form.
    const graph = {
      nodes: [
        { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
        { id: 'fac_price', kind: 'factor', label: 'Price' },
        { id: 'fac_volume', kind: 'factor', label: 'Volume' },
        {
          id: 'opt_slash',
          kind: 'option',
          label: 'Slash-keyed option',
          // No data.interventions; the wrappings live as flat slash-keyed entries.
          ['data/interventions/fac_price']: 0.6,
          ['data/interventions/fac_volume']: 0.4,
        },
        {
          id: 'opt_normal',
          kind: 'option',
          label: 'Normal option',
          data: { interventions: { fac_price: 0.5, fac_volume: 0.5 } },
          interventions: { fac_price: 0.5, fac_volume: 0.5 },
        },
      ],
      edges: [
        { from: 'fac_price', to: 'goal_revenue', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'fac_volume', to: 'goal_revenue', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_slash', to: 'fac_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_slash', to: 'fac_volume', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_normal', to: 'fac_price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_normal', to: 'fac_volume', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      ],
    } as unknown as GraphV3T;

    const ctx = makeTurnContext(graph);
    const result = await removeFactorAction.execute({ target_id: 'fac_price' }, ctx);

    expect(result.analysis_ready).toBeDefined();
    const slashOpt = result.analysis_ready!.options.find((o) => o.option_id === 'opt_slash');
    expect(slashOpt).toBeDefined();
    // Slash-keyed source is gated behind editInterventionRoutingEnabled. It
    // should be safely pruned regardless of whether it ends up in the merged
    // payload. The key thing is that fac_price must NOT appear in the
    // recomputed interventions for this option.
    expect(Object.keys(slashOpt!.interventions)).not.toContain('fac_price');
  });

  it("emits a remove_node operation and remove_edge ops alongside analysis_ready", async () => {
    const ctx = makeTurnContext(makeGraphWithOptions());
    const result = await removeFactorAction.execute({ target_id: 'fac_price' }, ctx);

    expect(result.operations).toBeDefined();
    const ops = result.operations!;
    const removeNode = ops.find((o) => o.op === 'remove_node' && o.path === 'fac_price');
    expect(removeNode).toBeDefined();

    // Three edges connected to fac_price: factor→goal and two option→factor.
    const removeEdges = ops.filter((o) => o.op === 'remove_edge');
    expect(removeEdges.length).toBeGreaterThanOrEqual(3);
    expect(removeEdges.some((o) => o.path === 'fac_price->goal_revenue')).toBe(true);
    expect(removeEdges.some((o) => o.path === 'opt_aggressive->fac_price')).toBe(true);
    expect(removeEdges.some((o) => o.path === 'opt_conservative->fac_price')).toBe(true);
  });

  it("synthetic graph filters edges by endpoint even when entities.edges is incomplete (entity-registry skew)", async () => {
    // Defensive test for the entities/graph edge skew case. Build a graph
    // where ctx.graph.edges contains the option→factor edges but
    // ctx.entities.edges deliberately omits them (simulating a stale entity
    // registry). Without endpoint-based filtering on the synthetic graph,
    // computeStructuralReadiness would still see the dangling edges via
    // graph.edges and push the affected options into needs_encoding instead
    // of needs_user_mapping.
    const graph = makeGraphWithOptions();
    const ctx = makeTurnContext(graph);
    // Strip the option→factor edges from entities.edges to simulate skew.
    // Keep only the factor→goal edges (to avoid an empty registry crash).
    ctx.entities.edges = ctx.entities.edges.filter(
      (e: { from: string; to: string }) =>
        !e.from.startsWith('opt_') && e.to !== 'fac_price' || e.to === 'goal_revenue',
    ) as never;

    const result = await removeFactorAction.execute({ target_id: 'fac_price' }, ctx);
    expect(result.analysis_ready).toBeDefined();

    // Even with skewed entities, the synthetic graph should still produce
    // a clean recompute: no option's interventions should reference fac_price.
    for (const opt of result.analysis_ready!.options) {
      expect(Object.keys(opt.interventions)).not.toContain('fac_price');
    }
  });
});
