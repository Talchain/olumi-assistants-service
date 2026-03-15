/**
 * Tests that the V2 pipeline correctly normalizes request-level analysis_state
 * and graph_state into context before enrichment.
 *
 * Root cause: the V2 pipeline (pipeline.ts, pipeline-stream.ts) was not folding
 * analysis_state into context.analysis_response, causing the LLM to believe
 * no analysis had been run when the UI sent analysis via the top-level field.
 *
 * Freshness rule: top-level fields (analysis_state, graph_state) always win
 * over context fields when present — they represent the latest UI-side state.
 */
import { describe, it, expect } from "vitest";
import { phase1Enrich } from "../../../../src/orchestrator/pipeline/phase1-enrichment/index.js";
import type { ConversationContext } from "../../../../src/orchestrator/pipeline/types.js";
import type { OrchestratorTurnRequest, V2RunResponseEnvelope, GraphV3T } from "../../../../src/orchestrator/types.js";

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

/**
 * Mirrors the normalization logic in pipeline.ts and pipeline-stream.ts.
 * Top-level fields always win when present (freshness rule).
 */
function normalizeRequest(request: OrchestratorTurnRequest): void {
  if (request.analysis_state) {
    request.context.analysis_response = request.analysis_state;
  }
  if (request.graph_state) {
    request.context.graph = request.graph_state;
  }
}

const STUB_GRAPH = {
  nodes: [
    { id: "dec_1", kind: "decision", label: "Decision" },
    { id: "opt_1", kind: "option", label: "Option A" },
    { id: "opt_2", kind: "option", label: "Option B" },
    { id: "fac_1", kind: "factor", label: "Factor" },
  ],
  edges: [
    { from: "dec_1", to: "opt_1" },
    { from: "dec_1", to: "opt_2" },
    { from: "fac_1", to: "opt_1" },
  ],
} as unknown as GraphV3T;

const STUB_GRAPH_V2 = {
  nodes: [
    ...STUB_GRAPH.nodes,
    { id: "fac_2", kind: "factor", label: "Factor 2" },
  ],
  edges: [
    ...STUB_GRAPH.edges,
    { from: "fac_2", to: "opt_2" },
  ],
} as unknown as GraphV3T;

const STUB_ANALYSIS = {
  analysis_status: "completed",
  results: [
    { option_label: "Option A", win_probability: 0.65 },
    { option_label: "Option B", win_probability: 0.35 },
  ],
  factor_sensitivity: [{ label: "Factor", elasticity: 0.8 }],
  meta: { seed_used: 42, n_samples: 1000, response_hash: "abc123" },
} as unknown as V2RunResponseEnvelope;

const FRESH_ANALYSIS = {
  analysis_status: "completed",
  results: [
    { option_label: "Option A", win_probability: 0.55 },
    { option_label: "Option B", win_probability: 0.45 },
  ],
  factor_sensitivity: [{ label: "Factor", elasticity: 0.6 }],
  meta: { seed_used: 99, n_samples: 2000, response_hash: "fresh456" },
} as unknown as V2RunResponseEnvelope;

describe("analysis_state normalization", () => {
  it("when context.analysis_response is null and analysis_state is set, enrichment sees analysis", () => {
    const context = makeContext({ graph: STUB_GRAPH });
    const request: OrchestratorTurnRequest = {
      message: "explain the analysis results",
      context,
      scenario_id: "s1",
      client_turn_id: "t1",
      analysis_state: STUB_ANALYSIS,
    };

    normalizeRequest(request);

    const enriched = phase1Enrich(request.message, request.context, request.scenario_id);

    expect(enriched.analysis).not.toBeNull();
    expect(enriched.analysis).toBe(STUB_ANALYSIS);
    expect(enriched.stage_indicator.stage).toBe("evaluate");
  });

  it("analysis_state overrides stale context.analysis_response (freshness wins)", () => {
    // Context has stale analysis, top-level has fresh analysis
    const context = makeContext({ graph: STUB_GRAPH, analysis_response: STUB_ANALYSIS });
    const request: OrchestratorTurnRequest = {
      message: "explain the analysis results",
      context,
      scenario_id: "s1",
      client_turn_id: "t1",
      analysis_state: FRESH_ANALYSIS,
    };

    normalizeRequest(request);

    const enriched = phase1Enrich(request.message, request.context, request.scenario_id);

    // Fresh analysis wins
    expect(enriched.analysis).toBe(FRESH_ANALYSIS);
    expect((enriched.analysis as unknown as Record<string, unknown>).meta).toEqual(
      expect.objectContaining({ response_hash: "fresh456" }),
    );
    expect(enriched.stage_indicator.stage).toBe("evaluate");
  });

  it("context.analysis_response preserved when analysis_state is absent", () => {
    const context = makeContext({ graph: STUB_GRAPH, analysis_response: STUB_ANALYSIS });
    const request: OrchestratorTurnRequest = {
      message: "explain the analysis results",
      context,
      scenario_id: "s1",
      client_turn_id: "t1",
    };

    normalizeRequest(request);

    const enriched = phase1Enrich(request.message, request.context, request.scenario_id);

    expect(enriched.analysis).toBe(STUB_ANALYSIS);
  });

  it("graph_state overrides stale context.graph (freshness wins)", () => {
    const context = makeContext({ graph: STUB_GRAPH });
    const request: OrchestratorTurnRequest = {
      message: "edit the model",
      context,
      scenario_id: "s1",
      client_turn_id: "t1",
      graph_state: STUB_GRAPH_V2,
    };

    normalizeRequest(request);

    const enriched = phase1Enrich(request.message, request.context, request.scenario_id);

    expect(enriched.graph).toBe(STUB_GRAPH_V2);
    // V2 graph has 5 nodes, original has 4
    expect((enriched.graph as unknown as { nodes: unknown[] }).nodes).toHaveLength(5);
  });

  it("graph_state is folded into context.graph when context.graph is null", () => {
    const context = makeContext();
    const request: OrchestratorTurnRequest = {
      message: "edit the model",
      context,
      scenario_id: "s1",
      client_turn_id: "t1",
      graph_state: STUB_GRAPH,
    };

    normalizeRequest(request);

    const enriched = phase1Enrich(request.message, request.context, request.scenario_id);

    expect(enriched.graph).toBe(STUB_GRAPH);
    expect(enriched.stage_indicator.stage).toBe("ideate"); // graph but no analysis
  });

  it("without normalization, analysis_state is invisible to enrichment (regression proof)", () => {
    // This test proves the bug existed: if we DON'T normalize, enrichment sees null
    const context = makeContext({ graph: STUB_GRAPH });

    // Do NOT normalize — pass context as-is (the old behavior)
    const enriched = phase1Enrich("explain the analysis results", context, "s1");

    expect(enriched.analysis).toBeNull();
    expect(enriched.stage_indicator.stage).toBe("ideate"); // Wrong! Should be evaluate
  });
});
