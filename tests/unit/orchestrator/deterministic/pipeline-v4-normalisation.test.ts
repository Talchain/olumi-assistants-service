/**
 * Pipeline V4 — graph_state / analysis_state normalisation tests
 *
 * Validates that executePipelineV4's pre-computeTurnContext normalisation
 * mirrors the streaming path (pipeline-stream.ts:93-102). The normalisation
 * folds request-level graph_state and analysis_state into context.graph and
 * context.analysis_response so that inferStage() and computeTurnContext()
 * see the correct state.
 *
 * These tests exercise the normalisation logic in isolation by calling
 * computeTurnContext and inferStage directly on pre-normalised requests,
 * matching the exact mutation pattern used in pipeline-v4.ts.
 */

import { describe, it, expect } from "vitest";
import { computeTurnContext } from "../../../../src/orchestrator/deterministic/turn-context.js";
import { inferStage } from "../../../../src/orchestrator/pipeline/phase1-enrichment/stage-inference.js";
import { normalizeAnalysisEnvelope } from "../../../../src/orchestrator/analysis-state.js";
import type { OrchestratorTurnRequest, V2RunResponseEnvelope } from "../../../../src/orchestrator/types.js";
import type { GraphV3T } from "../../../../src/schemas/cee-v3.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeGraph(): unknown {
  return {
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Maximise ROI' },
      { id: 'factor_revenue', kind: 'factor', label: 'Revenue', observed_state: { value: 100000, unit: 'GBP', extractionType: 'explicit' } },
      { id: 'factor_cost', kind: 'factor', label: 'Cost', observed_state: { value: 50000, unit: 'GBP', extractionType: 'inferred' } },
      { id: 'option_a', kind: 'option', label: 'Option A' },
      { id: 'option_b', kind: 'option', label: 'Option B' },
    ],
    edges: [
      { from: 'factor_revenue', to: 'goal_1', strength: { mean: 0.8, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
      { from: 'factor_cost', to: 'goal_1', strength: { mean: -0.5, std: 0.15 }, exists_probability: 0.8, effect_direction: 'negative' },
      { from: 'option_a', to: 'goal_1', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'option_b', to: 'goal_1', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
    ],
    options: [],
    goal_node_id: 'goal_1',
  };
}

function makeAnalysis(): V2RunResponseEnvelope {
  return {
    meta: { seed_used: 42, n_samples: 10000, response_hash: 'abc123' },
    results: [
      { option_label: 'Option A', win_probability: 0.62 },
      { option_label: 'Option B', win_probability: 0.38 },
    ],
    robustness: { level: 'moderate' },
    factor_sensitivity: [
      { label: 'Revenue', factor_id: 'factor_revenue', elasticity: 0.8, direction: 'positive' },
      { label: 'Cost', factor_id: 'factor_cost', elasticity: 0.3, direction: 'negative' },
    ],
  } as V2RunResponseEnvelope;
}

/** Build a turn request with empty context — graph/analysis only via top-level fields. */
function makeRequestWithTopLevelState(opts: {
  graphState?: unknown;
  analysisState?: unknown;
}): OrchestratorTurnRequest {
  return {
    message: 'What should I do?',
    context: {
      graph: null,
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: 'test-scenario',
    },
    scenario_id: 'test-scenario',
    client_turn_id: 'test-turn-1',
    graph_state: (opts.graphState as GraphV3T) ?? undefined,
    analysis_state: (opts.analysisState as V2RunResponseEnvelope) ?? undefined,
  };
}

/**
 * Apply the same normalisation that pipeline-v4.ts performs before
 * calling computeTurnContext. This mirrors the exact mutation pattern.
 */
function applyV4Normalisation(req: OrchestratorTurnRequest): void {
  if (req.analysis_state) {
    req.context.analysis_response = normalizeAnalysisEnvelope(req.analysis_state);
  } else if (req.context.analysis_response) {
    req.context.analysis_response = normalizeAnalysisEnvelope(
      req.context.analysis_response as V2RunResponseEnvelope,
    );
  }
  if (req.graph_state) {
    req.context.graph = req.graph_state;
  }
  // Mirror pipeline-v4.ts analysis_inputs derivation
  if (!req.context.analysis_inputs) {
    const graph = req.context.graph as Record<string, unknown> | null | undefined;
    const analysisReady = graph?.analysis_ready as { options?: Array<Record<string, unknown>> } | undefined;
    if (analysisReady?.options && Array.isArray(analysisReady.options) && analysisReady.options.length > 0) {
      const derived = analysisReady.options
        .filter((opt): opt is Record<string, unknown> => opt != null && typeof opt === 'object')
        .map((opt) => ({
          option_id: (opt.option_id ?? opt.id) as string | undefined,
          label: opt.label as string | undefined,
          interventions: (opt.interventions ?? {}) as Record<string, unknown>,
        }))
        .filter((opt): opt is { option_id: string; label: string; interventions: Record<string, unknown> } =>
          typeof opt.option_id === 'string' && typeof opt.label === 'string',
        );
      if (derived.length > 0) {
        req.context.analysis_inputs = { options: derived } as import("../../../../src/orchestrator/types.js").AnalysisInputs;
      }
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('pipeline-v4 normalisation: graph_state → context.graph', () => {
  it('graph_state is folded into context.graph before computeTurnContext', () => {
    const req = makeRequestWithTopLevelState({ graphState: makeGraph() });
    expect(req.context.graph).toBeNull();

    applyV4Normalisation(req);

    expect(req.context.graph).not.toBeNull();
    expect((req.context.graph as GraphV3T).nodes).toHaveLength(5);
  });

  it('inferStage returns ideate (not frame) after graph normalisation', () => {
    const req = makeRequestWithTopLevelState({ graphState: makeGraph() });
    applyV4Normalisation(req);

    const stage = inferStage(req.context);
    expect(stage.stage).toBe('ideate');
  });

  it('computeTurnContext sees the graph after normalisation', () => {
    const req = makeRequestWithTopLevelState({ graphState: makeGraph() });
    applyV4Normalisation(req);

    const ctx = computeTurnContext(req);
    expect(ctx.graph_summary.node_count).toBe(5);
    expect(ctx.graph_summary.option_count).toBe(2);
    expect(ctx.stage).toBe('ideate');
  });
});

describe('pipeline-v4 normalisation: analysis_state → context.analysis_response', () => {
  it('analysis_state is folded into context.analysis_response', () => {
    const req = makeRequestWithTopLevelState({
      graphState: makeGraph(),
      analysisState: makeAnalysis(),
    });
    expect(req.context.analysis_response).toBeNull();

    applyV4Normalisation(req);

    expect(req.context.analysis_response).not.toBeNull();
  });

  it('inferStage returns evaluate when both graph and analysis are present', () => {
    const req = makeRequestWithTopLevelState({
      graphState: makeGraph(),
      analysisState: makeAnalysis(),
    });
    applyV4Normalisation(req);

    const stage = inferStage(req.context);
    expect(stage.stage).toBe('evaluate');
  });

  it('computeTurnContext has analysis_summary after normalisation', () => {
    const req = makeRequestWithTopLevelState({
      graphState: makeGraph(),
      analysisState: makeAnalysis(),
    });
    applyV4Normalisation(req);

    const ctx = computeTurnContext(req);
    expect(ctx.stage).toBe('evaluate');
    expect(ctx.analysis_summary).not.toBeNull();
    expect(ctx.analysis_summary!.winner).toBe('Option A');
  });
});

describe('pipeline-v4 normalisation: precedence and edge cases', () => {
  it('graph_state overwrites context.graph when both present', () => {
    // Streaming path behaviour: graph_state wins (pipeline-stream.ts:100-102, comment at line 85-86)
    const staleGraph = makeGraph() as Record<string, unknown>;
    staleGraph.nodes = [
      { id: 'goal_1', kind: 'goal', label: 'Stale Goal' },
    ];

    const freshGraph = makeGraph();

    const req: OrchestratorTurnRequest = {
      message: 'What should I do?',
      context: {
        graph: staleGraph as unknown as GraphV3T,
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: 'test-scenario',
      },
      scenario_id: 'test-scenario',
      client_turn_id: 'test-turn-1',
      graph_state: freshGraph as GraphV3T,
    };

    applyV4Normalisation(req);

    // Fresh graph_state should win
    expect((req.context.graph as GraphV3T).nodes).toHaveLength(5);
  });

  it('context.graph is preserved when graph_state is absent', () => {
    const existingGraph = makeGraph();

    const req: OrchestratorTurnRequest = {
      message: 'What should I do?',
      context: {
        graph: existingGraph as unknown as GraphV3T,
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: 'test-scenario',
      },
      scenario_id: 'test-scenario',
      client_turn_id: 'test-turn-1',
      // No graph_state
    };

    applyV4Normalisation(req);

    // Original context.graph should be untouched
    expect(req.context.graph).toBe(existingGraph);
    expect((req.context.graph as GraphV3T).nodes).toHaveLength(5);
  });

  it('no crash when neither graph_state nor context.graph is present', () => {
    const req = makeRequestWithTopLevelState({});

    applyV4Normalisation(req);

    expect(req.context.graph).toBeNull();
    expect(req.context.analysis_response).toBeNull();

    const ctx = computeTurnContext(req);
    expect(ctx.stage).toBe('frame');
    expect(ctx.graph_summary.node_count).toBe(0);
  });
});

describe('pipeline-v4 normalisation: analysis_inputs derivation', () => {
  function makeGraphWithAnalysisReady(): unknown {
    const graph = makeGraph() as Record<string, unknown>;
    graph.analysis_ready = {
      options: [
        {
          id: 'option_a',
          option_id: 'option_a',
          label: 'Option A',
          status: 'ready',
          interventions: {
            factor_revenue: 0.8,
            factor_cost: 0.3,
          },
        },
        {
          id: 'option_b',
          option_id: 'option_b',
          label: 'Option B',
          status: 'ready',
          interventions: {
            factor_revenue: 0.4,
            factor_cost: 0.6,
          },
        },
      ],
    };
    return graph;
  }

  it('derives analysis_inputs from graph.analysis_ready when caller did not supply it', () => {
    const req = makeRequestWithTopLevelState({ graphState: makeGraphWithAnalysisReady() });
    expect(req.context.analysis_inputs).toBeFalsy();

    applyV4Normalisation(req);

    expect(req.context.analysis_inputs).toBeTruthy();
    expect(req.context.analysis_inputs!.options).toHaveLength(2);
    expect(req.context.analysis_inputs!.options[0].option_id).toBe('option_a');
    expect(req.context.analysis_inputs!.options[0].interventions).toEqual({
      factor_revenue: 0.8,
      factor_cost: 0.3,
    });
  });

  it('preserves caller-supplied analysis_inputs (does not overwrite)', () => {
    const customInputs = {
      options: [{ option_id: 'custom', label: 'Custom', interventions: { x: 1 } }],
    };
    const req = makeRequestWithTopLevelState({ graphState: makeGraphWithAnalysisReady() });
    req.context.analysis_inputs = customInputs as import("../../../../src/orchestrator/types.js").AnalysisInputs;

    applyV4Normalisation(req);

    expect(req.context.analysis_inputs).toBe(customInputs);
    expect(req.context.analysis_inputs!.options[0].option_id).toBe('custom');
  });

  it('does nothing when graph has no analysis_ready field', () => {
    const req = makeRequestWithTopLevelState({ graphState: makeGraph() });

    applyV4Normalisation(req);

    expect(req.context.analysis_inputs).toBeFalsy();
  });

  it('does nothing when analysis_ready.options is empty', () => {
    const graph = makeGraph() as Record<string, unknown>;
    graph.analysis_ready = { options: [] };
    const req = makeRequestWithTopLevelState({ graphState: graph });

    applyV4Normalisation(req);

    expect(req.context.analysis_inputs).toBeFalsy();
  });

  it('accepts option_id or id (fallback)', () => {
    const graph = makeGraph() as Record<string, unknown>;
    graph.analysis_ready = {
      options: [
        // no option_id, has id only
        { id: 'option_a', label: 'Option A', interventions: { a: 1 } },
      ],
    };
    const req = makeRequestWithTopLevelState({ graphState: graph });

    applyV4Normalisation(req);

    expect(req.context.analysis_inputs).toBeTruthy();
    expect(req.context.analysis_inputs!.options[0].option_id).toBe('option_a');
  });

  it('filters out options missing required fields (option_id and label)', () => {
    const graph = makeGraph() as Record<string, unknown>;
    graph.analysis_ready = {
      options: [
        { option_id: 'option_a', label: 'Option A', interventions: {} },
        { option_id: 123, label: 'Bad', interventions: {} }, // bad id type
        { label: 'No id', interventions: {} }, // missing id
        { option_id: 'option_b', interventions: {} }, // missing label
      ],
    };
    const req = makeRequestWithTopLevelState({ graphState: graph });

    applyV4Normalisation(req);

    // Only the first entry has both valid option_id and label
    expect(req.context.analysis_inputs).toBeTruthy();
    expect(req.context.analysis_inputs!.options).toHaveLength(1);
    expect(req.context.analysis_inputs!.options[0].option_id).toBe('option_a');
  });
});

// ============================================================================
// Post-draft / post-analysis recomputation transitions
// ============================================================================

/**
 * Mirrors the post-draft recomputation logic in pipeline-v4.ts:
 * when a draft completes, rebuild context with the new graph and
 * explicitly clear any prior analysis (it was computed against an older
 * graph).
 */
function applyPostDraftRecomputation(
  req: OrchestratorTurnRequest,
  appliedGraph: unknown,
): OrchestratorTurnRequest {
  return {
    ...req,
    context: {
      ...req.context,
      graph: appliedGraph as GraphV3T,
      analysis_response: null,
      analysis_inputs: null,
    },
    analysis_state: null,
  };
}

/**
 * Mirrors the post-analysis recomputation logic in pipeline-v4.ts:
 * when run_analysis completes, populate context.analysis_response so the
 * next stage inference advances ideate → evaluate.
 */
function applyPostAnalysisRecomputation(
  req: OrchestratorTurnRequest,
  analysisResponse: V2RunResponseEnvelope,
): OrchestratorTurnRequest {
  return {
    ...req,
    context: {
      ...req.context,
      analysis_response: analysisResponse,
    },
  };
}

describe('post-draft recomputation: state transition', () => {
  it('stage is ideate after draft completes with no prior analysis', () => {
    // Pre-draft: empty context
    const req = makeRequestWithTopLevelState({});
    applyV4Normalisation(req);
    let ctx = computeTurnContext(req);
    expect(ctx.stage).toBe('frame');

    // Post-draft: graph now applied
    const postDraftReq = applyPostDraftRecomputation(req, makeGraph());
    ctx = computeTurnContext(postDraftReq);
    expect(ctx.stage).toBe('ideate');
    expect(ctx.graph_summary.node_count).toBe(5);
  });

  it('stage is ideate (not evaluate) after re-draft with stale analysis present', () => {
    // User had a graph + analysis (stage=evaluate). Then re-drafted from scratch.
    // Stale analysis must NOT carry forward — a new draft invalidates it.
    const staleAnalysis = makeAnalysis();
    const req: OrchestratorTurnRequest = {
      message: 'rebuild',
      context: {
        graph: makeGraph() as GraphV3T,
        analysis_response: staleAnalysis,
        framing: null,
        messages: [],
        scenario_id: 'test',
      },
      scenario_id: 'test',
      client_turn_id: 'turn-1',
    };
    // Sanity: pre-recomputation would be evaluate
    const preCtx = computeTurnContext(req);
    expect(preCtx.stage).toBe('evaluate');

    // Post-draft: new graph + cleared analysis
    const freshGraph = makeGraph();
    const postDraftReq = applyPostDraftRecomputation(req, freshGraph);
    const ctx = computeTurnContext(postDraftReq);
    expect(ctx.stage).toBe('ideate');
    expect(ctx.analysis_summary).toBeNull();
    // Request-level analysis_state is also cleared
    expect(postDraftReq.analysis_state).toBeNull();
    expect(postDraftReq.context.analysis_response).toBeNull();
  });
});

describe('post-analysis recomputation: state transition', () => {
  it('stage advances ideate → evaluate after analysis populated', () => {
    // Pre-analysis: graph only
    const req = makeRequestWithTopLevelState({ graphState: makeGraph() });
    applyV4Normalisation(req);
    let ctx = computeTurnContext(req);
    expect(ctx.stage).toBe('ideate');
    expect(ctx.capabilities.can_explain_results).toBe(false);

    // Post-analysis: analysis_response populated
    const postAnalysisReq = applyPostAnalysisRecomputation(req, makeAnalysis());
    ctx = computeTurnContext(postAnalysisReq);
    expect(ctx.stage).toBe('evaluate');
    expect(ctx.capabilities.can_explain_results).toBe(true);
    expect(ctx.capabilities.can_challenge).toBe(true);
  });

  it('post-analysis context exposes explanation tools as eligible', () => {
    const req = makeRequestWithTopLevelState({ graphState: makeGraph() });
    applyV4Normalisation(req);
    const postAnalysisReq = applyPostAnalysisRecomputation(req, makeAnalysis());
    const ctx = computeTurnContext(postAnalysisReq);

    // At evaluate, explanation and analysis tools become eligible
    expect(ctx.eligible_actions).toContain('explain_result');
    expect(ctx.eligible_actions).toContain('compare_options');
    expect(ctx.eligible_actions).toContain('run_analysis');
  });

  it('analysis_summary is populated after recomputation', () => {
    const req = makeRequestWithTopLevelState({ graphState: makeGraph() });
    applyV4Normalisation(req);
    const postAnalysisReq = applyPostAnalysisRecomputation(req, makeAnalysis());
    const ctx = computeTurnContext(postAnalysisReq);

    expect(ctx.analysis_summary).not.toBeNull();
    expect(ctx.analysis_summary!.winner).toBe('Option A');
  });
});
