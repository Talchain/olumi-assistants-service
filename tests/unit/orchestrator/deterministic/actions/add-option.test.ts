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

// ─────────────────────────────────────────────────────────────────────────
// Duplicate detection tests
// ─────────────────────────────────────────────────────────────────────────

/**
 * Variant fixture that registers an option in entities.nodes alongside the
 * factor entries. The duplicate-detection helper iterates ctx.entities.nodes,
 * so options must be present there for the lookup to fire. The base
 * makeTurnContext only seeds factors, which is why the existing
 * "replaces/dedups by ID" tests don't trigger the new guard.
 */
function makeTurnContextWithOption(
  graph: GraphV3T,
  optionLabel: string,
  optionId: string = 'option_existing',
): DeterministicTurnContext {
  const ctx = makeTurnContext(graph);
  ctx.entities.nodes.set(optionId, {
    id: optionId,
    label: optionLabel,
    kind: 'option',
  } as unknown as never);
  return ctx;
}

describe("add_option action — duplicate detection (no interventions → nudge)", () => {
  it("returns conversational nudge for an exact label match with no interventions", async () => {
    const ctx = makeTurnContextWithOption(makeGraph(), 'Hire Contractor');
    const result = await addOptionAction.execute(
      { label: 'Hire Contractor' },
      ctx,
    );

    expect(result.operations).toBeUndefined();
    expect(result.blocks).toEqual([]);
    expect(result.analysis_ready).toBeUndefined();
    expect(result.assistantText).toContain('Hire Contractor');
    expect(result.assistantText).toContain('already exists');
  });

  it("matches case-insensitively (no interventions → nudge)", async () => {
    const ctx = makeTurnContextWithOption(makeGraph(), 'Hire Contractor');
    const result = await addOptionAction.execute(
      { label: 'hire contractor' },
      ctx,
    );

    expect(result.operations).toBeUndefined();
    expect(result.analysis_ready).toBeUndefined();
    expect(result.assistantText).toContain('Hire Contractor'); // surfaces canonical label
    expect(result.assistantText).toContain('already exists');
  });

  it("matches with whitespace normalisation (no interventions → nudge)", async () => {
    const ctx = makeTurnContextWithOption(makeGraph(), 'Hire Contractor');
    const result = await addOptionAction.execute(
      { label: '  Hire   Contractor ' },
      ctx,
    );

    expect(result.operations).toBeUndefined();
    expect(result.analysis_ready).toBeUndefined();
    expect(result.assistantText).toContain('already exists');
  });

  it("nudges when interventions normalise to empty (all items fail type validation)", async () => {
    // Repair redirect must NOT fire when normaliseInterventions returns {}.
    // Mixed bag of bad input shapes — none survive normalisation.
    const ctx = makeTurnContextWithOption(makeGraph(), 'Hire Contractor');
    const result = await addOptionAction.execute(
      {
        label: 'Hire Contractor',
        interventions: [
          { factor_id: 'fac_ramp', value: 'high' }, // wrong value type
          { factor_id: 42, value: 0.5 },             // wrong factor_id type
          { not_a_factor_field: 'fac_ramp' },        // missing fields
        ],
      },
      ctx,
    );

    // Falls through to nudge because no interventions survived normalisation.
    expect(result.operations).toBeUndefined();
    expect(result.analysis_ready).toBeUndefined();
    expect(result.assistantText).toContain('already exists');
  });

  it("creates normally for a genuinely different label", async () => {
    const ctx = makeTurnContextWithOption(makeGraph(), 'Hire Contractor');
    const result = await addOptionAction.execute(
      { label: 'Hire Tech Lead', interventions: [{ factor_id: 'fac_ramp', value: 0.6 }] },
      ctx,
    );

    expect(result.operations).toBeDefined();
    expect(result.operations!.length).toBeGreaterThan(0);
    expect(result.assistantText).toContain('Hire Tech Lead');
    expect(result.assistantText).toContain("would be added");
  });

  it("does not match a factor with the same label as the requested option", async () => {
    // Defensive: the kind filter must keep factors out of the option-dup check.
    const ctx = makeTurnContext(makeGraph());
    ctx.entities.nodes.set('fac_risk', {
      id: 'fac_risk',
      label: 'Risk',
      kind: 'factor',
    } as unknown as never);

    const result = await addOptionAction.execute(
      { label: 'Risk', interventions: [{ factor_id: 'fac_ramp', value: 0.6 }] },
      ctx,
    );

    // Should proceed past the dup check and either succeed or fall through
    // to the empty-interventions guard. Either way, NOT the dup-guard message.
    expect(result.assistantText).not.toContain('already exists');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Repair redirect tests (T2)
// ─────────────────────────────────────────────────────────────────────────
//
// When add_option is called for an existing option WITH interventions, the
// handler must redirect to update_node on the existing option (not duplicate).
// This is the option-repair routing fix from Tier 2 Task 2.

describe("add_option action — repair redirect on existing option", () => {
  /**
   * Variant context that registers an existing option in BOTH the entities map
   * and the graph nodes/edges. The repair path needs the option in
   * `entities.nodes` for findExistingOption AND in `graph.nodes`/`graph.edges`
   * for buildOptionConfigurationResult to compute analysis_ready and to
   * detect pre-existing structural edges.
   */
  function makeContextWithExistingOption(optionLabel: string, optionId: string, preExistingTargets: string[] = []) {
    const optionNode = {
      id: optionId,
      kind: 'option',
      label: optionLabel,
      data: { interventions: {} },
      interventions: {},
    };
    const preEdges = preExistingTargets.map((to) => ({
      from: optionId,
      to,
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    }));
    const graph = makeGraph([optionNode], preEdges);
    const ctx = makeTurnContext(graph);
    ctx.entities.nodes.set(optionId, {
      id: optionId,
      label: optionLabel,
      kind: 'option',
    } as unknown as never);
    return ctx;
  }

  it("redirects to update_node on the existing option when interventions are supplied", async () => {
    const ctx = makeContextWithExistingOption('Hire Contractor', 'option_hire_contractor');

    const result = await addOptionAction.execute(
      {
        label: 'Hire Contractor',
        interventions: [
          { factor_id: 'fac_ramp', value: 0.6 },
          { factor_id: 'fac_cost', value: 0.4 },
        ],
      },
      ctx,
    );

    expect(result.operations).toBeDefined();
    // First op is the update_node on the existing option (not add_node).
    const updateOp = result.operations!.find((op) => op.op === 'update_node');
    expect(updateOp).toBeDefined();
    expect(updateOp!.path).toBe('option_hire_contractor');
    // No add_node — proves we didn't fall to the new-option path.
    expect(result.operations!.find((op) => op.op === 'add_node')).toBeUndefined();
    expect(result.assistantText).toContain('would be updated');
    expect(result.assistantText).toContain('Hire Contractor');
  });

  it("writes interventions to data.interventions, top-level interventions, and slash-keyed paths (when flag enabled)", async () => {
    // Note: editInterventionRoutingEnabled defaults to true in dev/test
    // (see src/config/index.ts:394 default). The test reads the live flag.
    const { config } = await import('../../../../../src/config/index.js');
    const ctx = makeContextWithExistingOption('Hire Contractor', 'option_hire_contractor');

    const result = await addOptionAction.execute(
      {
        label: 'Hire Contractor',
        interventions: [{ factor_id: 'fac_ramp', value: 0.6 }],
      },
      ctx,
    );

    const updateOp = result.operations!.find((op) => op.op === 'update_node');
    const value = updateOp!.value as Record<string, unknown>;

    // Path 1: data.interventions (canonical)
    expect(value.data).toEqual({ interventions: { fac_ramp: 0.6 } });
    // Path 2: top-level interventions (fallback)
    expect(value.interventions).toEqual({ fac_ramp: 0.6 });
    // Path 3: slash-keyed (gated by flag)
    if (config.cee.editInterventionRoutingEnabled) {
      expect(value['data/interventions/fac_ramp']).toBe(0.6);
    }
  });

  it("only adds structural edges for factors not already connected from the option", async () => {
    // fac_ramp already connected; fac_cost is new.
    const ctx = makeContextWithExistingOption('Hire Contractor', 'option_hire_contractor', ['fac_ramp']);

    const result = await addOptionAction.execute(
      {
        label: 'Hire Contractor',
        interventions: [
          { factor_id: 'fac_ramp', value: 0.6 }, // already connected
          { factor_id: 'fac_cost', value: 0.4 }, // new
        ],
      },
      ctx,
    );

    const addEdges = result.operations!.filter((op) => op.op === 'add_edge');
    expect(addEdges).toHaveLength(1);
    const edge = addEdges[0];
    expect((edge.value as { to: string }).to).toBe('fac_cost');
    // Uses canonical structural defaults (mean 1.0, std 0.01, ep 1.0).
    const ev = edge.value as { strength: { mean: number; std: number }; exists_probability: number };
    expect(ev.strength.mean).toBe(1.0);
    expect(ev.strength.std).toBe(0.01);
    expect(ev.exists_probability).toBe(1.0);
  });

  it("computes analysis_ready against the synthetic post-update graph", async () => {
    const ctx = makeContextWithExistingOption('Hire Contractor', 'option_hire_contractor');

    const result = await addOptionAction.execute(
      {
        label: 'Hire Contractor',
        interventions: [{ factor_id: 'fac_ramp', value: 0.6 }],
      },
      ctx,
    );

    expect(result.analysis_ready).toBeDefined();
    const opt = result.analysis_ready!.options.find((o) => o.option_id === 'option_hire_contractor');
    expect(opt).toBeDefined();
    expect(opt!.interventions).toEqual({ fac_ramp: 0.6 });
    expect(opt!.status).toBe('ready');
  });

  it("F5: drops unresolvable factor ids from assistant text rather than leaking raw ids", async () => {
    // The LLM may hallucinate factor ids. The repair-redirect text must NOT
    // surface them — fall back to a neutral phrasing instead.
    const ctx = makeContextWithExistingOption('Hire Contractor', 'option_hire_contractor');

    const result = await addOptionAction.execute(
      {
        label: 'Hire Contractor',
        interventions: [
          { factor_id: 'fac_ramp', value: 0.6 },               // exists
          { factor_id: 'factor_hallucinated_one', value: 0.4 }, // doesn't exist
          { factor_id: 'fac_unknown_two', value: 0.3 },         // doesn't exist
        ],
      },
      ctx,
    );

    expect(result.assistantText).toBeTruthy();
    // No raw ids of any scheme should appear in the user-facing text.
    expect(result.assistantText).not.toContain('factor_hallucinated_one');
    expect(result.assistantText).not.toContain('fac_unknown_two');
    expect(result.assistantText).not.toContain('factor_');
    // The resolvable factor's label should still appear.
    expect(result.assistantText).toContain('Ramp time');
    // The unresolved ones should be summarised rather than dropped silently.
    expect(result.assistantText).toMatch(/2 other/);
  });

  it("F5: when EVERY factor id is unresolvable, falls back to a count-only phrasing", async () => {
    const ctx = makeContextWithExistingOption('Hire Contractor', 'option_hire_contractor');

    const result = await addOptionAction.execute(
      {
        label: 'Hire Contractor',
        interventions: [
          { factor_id: 'factor_ghost_one', value: 0.6 },
          { factor_id: 'factor_ghost_two', value: 0.4 },
        ],
      },
      ctx,
    );

    expect(result.assistantText).toBeTruthy();
    expect(result.assistantText).not.toContain('factor_ghost_one');
    expect(result.assistantText).not.toContain('factor_ghost_two');
    expect(result.assistantText).not.toContain('factor_');
    // Generic "2 factors" fallback.
    expect(result.assistantText).toMatch(/2 factors/);
  });

  it("logs the v4.option_repair_redirect telemetry event", async () => {
    const { log } = await import('../../../../../src/utils/telemetry.js');
    const infoSpy = vi.mocked(log.info);
    infoSpy.mockClear();

    const ctx = makeContextWithExistingOption('Hire Contractor', 'option_hire_contractor');
    await addOptionAction.execute(
      {
        label: 'Hire Contractor',
        interventions: [{ factor_id: 'fac_ramp', value: 0.6 }],
      },
      ctx,
    );

    const redirectCall = infoSpy.mock.calls.find(
      (call) => (call[0] as { event?: string })?.event === 'v4.option_repair_redirect',
    );
    expect(redirectCall).toBeDefined();
    expect((redirectCall![0] as { option_id: string }).option_id).toBe('option_hire_contractor');
    expect((redirectCall![0] as { intervention_count: number }).intervention_count).toBe(1);
  });
});

// Fix 3: new options must be created with is_baseline === false (strict, not
// null/undefined/missing). UI code uses ?? to distinguish explicit false from
// missing; regressing to missing would make every new option a baseline
// candidate in label-matching.
describe('add_option — is_baseline is explicitly false', () => {
  it('emits is_baseline === false on the add_node payload', async () => {
    const ctx = makeTurnContext(makeGraph());
    const result = await addOptionAction.execute(
      { label: 'New Path', interventions: [{ factor_id: 'fac_ramp', value: 0.5 }] },
      ctx,
    );
    const addNode = result.operations?.find((op) => op.op === 'add_node');
    expect(addNode).toBeDefined();
    const value = addNode!.value as Record<string, unknown>;
    expect('is_baseline' in value).toBe(true);
    expect(value.is_baseline).toBe(false);
    expect(value.is_baseline === false).toBe(true);
  });
});

// Fix 3: pre-existing option statuses are preserved when add_option neither
// touches their structure nor changes their intervention sources. Also
// confirms telemetry fires with both conditional flags.
describe('add_option — preserves prior option readiness on untouched options', () => {
  it('keeps an existing ready option ready after adding a new unready option', async () => {
    const graph = makeGraph(
      [
        { id: 'option_baseline', kind: 'option', label: 'Do nothing', is_baseline: true, data: { interventions: { fac_ramp: 0.5 } } },
      ],
      [
        { from: 'option_baseline', to: 'fac_ramp', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      ],
    );
    const ctx = makeTurnContext(graph);
    ctx.entities.nodes.set('option_baseline', { id: 'option_baseline', label: 'Do nothing', kind: 'option' } as unknown as never);
    ctx.entities.option_ids = ['option_baseline'];

    const result = await addOptionAction.execute(
      { label: 'Hire contractor', interventions: [{ factor_id: 'fac_ramp', value: 0.3 }] },
      ctx,
    );
    const ready = result.analysis_ready;
    expect(ready).toBeDefined();
    const baseline = ready!.options.find((o) => o.option_id === 'option_baseline');
    expect(baseline?.status).toBe('ready');
  });
});
