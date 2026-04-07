/**
 * Unit tests for the add_option deterministic action.
 *
 * Pin the analysis_ready propagation contract:
 * - The handler returns analysis_ready alongside operations[] so the v4
 *   envelope assembler can refresh the graph_patch block + envelope.
 * - Status derivation is delegated to computeStructuralReadiness — these
 *   tests assert the delegation, not the status rules themselves
 *   (those are covered by analysis-ready-helper tests).
 * - The synthetic post-patch graph used to feed the helper must NOT mutate
 *   ctx.graph. We assert reference identity / array length on the input
 *   to catch any accidental in-place mutation.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

vi.mock("../../../../../src/orchestrator/context/context-hash.js", () => ({
  computeContextHash: () => 'hash',
}));
vi.mock("../../../../../src/orchestrator/guidance/post-analysis.js", () => ({
  generatePostAnalysisGuidance: () => [],
}));

import { addOptionAction } from "../../../../../src/orchestrator/deterministic/actions/add-option.js";
import { assembleV4Envelope } from "../../../../../src/orchestrator/deterministic/pipeline-v4.js";
import type { DeterministicTurnContext } from "../../../../../src/orchestrator/deterministic/types.js";
import type { ActionName } from "../../../../../src/orchestrator/deterministic/actions/types.js";
import type { GraphV3T } from "../../../../../src/schemas/cee-v3.js";

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

function makeGraph(extraNodes: unknown[] = [], extraEdges: unknown[] = []): GraphV3T {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Ship on time' },
      { id: 'fac_ramp', kind: 'factor', label: 'Ramp time' },
      { id: 'fac_cost', kind: 'factor', label: 'Cost' },
      ...extraNodes,
    ],
    edges: [
      { from: 'fac_ramp', to: 'goal_1', strength: { mean: 0.8, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'fac_cost', to: 'goal_1', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' },
      ...extraEdges,
    ],
  } as unknown as GraphV3T;
}

function makeTurnContext(graph: GraphV3T): DeterministicTurnContext {
  return {
    stage: 'ideate',
    entities: {
      nodes: new Map([
        ['fac_ramp', { id: 'fac_ramp', label: 'Ramp time', kind: 'factor' } as unknown as never],
        ['fac_cost', { id: 'fac_cost', label: 'Cost', kind: 'factor' } as unknown as never],
      ]),
      edges: [],
      option_ids: [],
      goal_id: 'goal_1',
    },
    graph_summary: {
      node_count: graph.nodes.length,
      edge_count: graph.edges.length,
      option_count: graph.nodes.filter((n) => (n as { kind: string }).kind === 'option').length,
      option_labels: [],
      goal_label: 'Ship on time',
      missing_structural: [],
    },
    analysis_summary: null,
    capabilities: {
      can_run_analysis: false,
      can_explain_results: false,
      can_edit_graph: true,
      can_compare_options: false,
      can_challenge: false,
      can_generate_artefact: false,
    },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 1, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: ['add_option'],
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

describe("add_option action — analysis_ready propagation", () => {
  it("returns analysis_ready containing the new option with populated interventions", async () => {
    const ctx = makeTurnContext(makeGraph());
    const result = await addOptionAction.execute(
      {
        label: 'Hire Tech Lead',
        interventions: [
          { factor_id: 'fac_ramp', value: 0.6 },
          { factor_id: 'fac_cost', value: 0.4 },
        ],
      },
      ctx,
    );

    expect(result.analysis_ready).toBeDefined();
    const opts = result.analysis_ready!.options;
    const newOpt = opts.find((o) => o.option_id === 'option_hire_tech_lead');
    expect(newOpt).toBeDefined();
    expect(newOpt!.interventions).toEqual({ fac_ramp: 0.6, fac_cost: 0.4 });
    expect(newOpt!.status).toBe('ready'); // delegated derivation
    expect(result.analysis_ready!.goal_node_id).toBe('goal_1');
  });

  it("appends to existing options without losing them", async () => {
    const existingOption = {
      id: 'option_contract',
      kind: 'option',
      label: 'Contract',
      data: { interventions: { fac_cost: 0.7 } },
      interventions: { fac_cost: 0.7 },
    };
    const existingEdge = {
      from: 'option_contract',
      to: 'fac_cost',
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    };
    const ctx = makeTurnContext(makeGraph([existingOption], [existingEdge]));

    const result = await addOptionAction.execute(
      {
        label: 'Hire Tech Lead',
        interventions: [{ factor_id: 'fac_ramp', value: 0.6 }],
      },
      ctx,
    );

    const ids = result.analysis_ready!.options.map((o) => o.option_id);
    expect(ids).toContain('option_contract');
    expect(ids).toContain('option_hire_tech_lead');
    expect(ids).toHaveLength(2);
  });

  it("replaces (not duplicates) an option with the same id", async () => {
    const existingOption = {
      id: 'option_hire_tech_lead',
      kind: 'option',
      label: 'Hire Tech Lead (old)',
      data: { interventions: {} }, // empty — not ready
      interventions: {},
    };
    const ctx = makeTurnContext(makeGraph([existingOption]));

    const result = await addOptionAction.execute(
      {
        label: 'Hire Tech Lead',
        interventions: [{ factor_id: 'fac_ramp', value: 0.6 }],
      },
      ctx,
    );

    const matching = result.analysis_ready!.options.filter((o) => o.option_id === 'option_hire_tech_lead');
    expect(matching).toHaveLength(1);
    expect(matching[0].interventions).toEqual({ fac_ramp: 0.6 });
  });

  it("replacing an option with a different intervention set reflects only the new interventions (stale-edge guard)", async () => {
    // Catch the latent stale-edge bias: if old edges from nodeId are not
    // filtered before constructing syntheticEdges, optionToFactors would
    // accumulate stale targets and push status toward needs_encoding even
    // when the new interventions don't cover those factors.
    const existingOption = {
      id: 'option_hire_tech_lead',
      kind: 'option',
      label: 'Hire Tech Lead (old)',
      data: { interventions: { fac_ramp: 0.5 } },
      interventions: { fac_ramp: 0.5 },
    };
    const staleEdge = {
      from: 'option_hire_tech_lead',
      to: 'fac_ramp', // old target — should NOT appear after replace
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    };
    const ctx = makeTurnContext(makeGraph([existingOption], [staleEdge]));

    // Replace with a completely different intervention targeting fac_cost only.
    const result = await addOptionAction.execute(
      {
        label: 'Hire Tech Lead',
        interventions: [{ factor_id: 'fac_cost', value: 0.3 }],
      },
      ctx,
    );

    const opt = result.analysis_ready!.options.find((o) => o.option_id === 'option_hire_tech_lead');
    expect(opt).toBeDefined();
    // Only the new intervention should be present.
    expect(opt!.interventions).toEqual({ fac_cost: 0.3 });
    // Status must be 'ready' (has numeric interventions), not needs_encoding
    // (which would indicate the stale fac_ramp edge leaked into connectedFactors).
    expect(opt!.status).toBe('ready');
  });

  it("does NOT mutate ctx.graph when computing the synthetic graph", async () => {
    const graph = makeGraph();
    const originalNodeCount = graph.nodes.length;
    const originalEdgeCount = graph.edges.length;
    const originalNodesRef = graph.nodes;
    const originalEdgesRef = graph.edges;
    const ctx = makeTurnContext(graph);

    await addOptionAction.execute(
      {
        label: 'Hire Tech Lead',
        interventions: [{ factor_id: 'fac_ramp', value: 0.6 }],
      },
      ctx,
    );

    // Reference identity preserved
    expect(graph.nodes).toBe(originalNodesRef);
    expect(graph.edges).toBe(originalEdgesRef);
    // Length unchanged
    expect(graph.nodes).toHaveLength(originalNodeCount);
    expect(graph.edges).toHaveLength(originalEdgeCount);
    // No option-kind nodes leaked into the original graph
    expect(graph.nodes.find((n) => (n as { id: string }).id === 'option_hire_tech_lead')).toBeUndefined();
  });

  it("falls back to early-return guidance when interventions are empty and factors exist", async () => {
    const ctx = makeTurnContext(makeGraph());
    const result = await addOptionAction.execute({ label: 'Vague Option' }, ctx);

    // Empty-interventions path: no operations, no analysis_ready, just a question.
    expect(result.operations).toBeUndefined();
    expect(result.analysis_ready).toBeUndefined();
    expect(result.assistantText).toContain('Vague Option');
  });

  it("propagates analysis_ready through assembleV4Envelope into both block and envelope", async () => {
    // Pipeline-level regression: prove the assembler reads ActionResult.analysis_ready
    // and writes it onto BOTH the graph_patch block (data.analysis_ready) AND the
    // envelope top-level. This is the bug Task 2 fixes — without this propagation,
    // the UI's stale ceeAnalysisReady drives PLoT into EMPTY_INTERVENTIONS.
    const ctx = makeTurnContext(makeGraph());
    const actionResult = await addOptionAction.execute(
      {
        label: 'Hire Tech Lead',
        interventions: [{ factor_id: 'fac_ramp', value: 0.6 }],
      },
      ctx,
    );

    expect(actionResult.analysis_ready).toBeDefined();

    const envelope = assembleV4Envelope({
      turnContext: ctx,
      turnId: 'turn-1',
      requestId: 'req-1',
      executionClass: 'tool',
      assistantText: actionResult.assistantText,
      actionResult,
      routing: 'llm',
      executedAction: 'add_option' as ActionName,
      contextFallbackUsed: false,
    });

    // Top-level envelope mirror
    const envAR = (envelope as unknown as { analysis_ready?: { options: Array<{ option_id: string; interventions: Record<string, number> }> } }).analysis_ready;
    expect(envAR).toBeDefined();
    const envOpt = envAR!.options.find((o) => o.option_id === 'option_hire_tech_lead');
    expect(envOpt).toBeDefined();
    expect(envOpt!.interventions).toEqual({ fac_ramp: 0.6 });

    // graph_patch block carries analysis_ready
    const patchBlock = envelope.blocks.find((b) => b.block_type === 'graph_patch') as
      | { data: { analysis_ready?: { options: Array<{ option_id: string; interventions: Record<string, number> }> } } }
      | undefined;
    expect(patchBlock).toBeDefined();
    expect(patchBlock!.data.analysis_ready).toBeDefined();
    const blockOpt = patchBlock!.data.analysis_ready!.options.find((o) => o.option_id === 'option_hire_tech_lead');
    expect(blockOpt).toBeDefined();
    expect(blockOpt!.interventions).toEqual({ fac_ramp: 0.6 });
  });

  it("derives status consistently with analysis-ready-helper for ready options", async () => {
    // Two options, both with numeric interventions → payload status 'ready'.
    const baseline = {
      id: 'option_baseline',
      kind: 'option',
      label: 'Baseline',
      data: { interventions: { fac_ramp: 0.5 } },
      interventions: { fac_ramp: 0.5 },
    };
    const baselineEdge = {
      from: 'option_baseline',
      to: 'fac_ramp',
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    };
    const ctx = makeTurnContext(makeGraph([baseline], [baselineEdge]));

    const result = await addOptionAction.execute(
      {
        label: 'New Plan',
        interventions: [{ factor_id: 'fac_cost', value: 0.3 }],
      },
      ctx,
    );

    expect(result.analysis_ready!.status).toBe('ready');
    for (const opt of result.analysis_ready!.options) {
      expect(opt.status).toBe('ready');
    }
  });
});
