import { describe, it, expect, vi } from "vitest";
import { phase4Execute } from "../../../../src/orchestrator/pipeline/phase4-tools/index.js";
import type { EnrichedContext, LLMResult, ToolDispatcher, ToolResult } from "../../../../src/orchestrator/pipeline/types.js";
import type { ConversationContext } from "../../../../src/orchestrator/types.js";
import { setTestSink } from "../../../../src/utils/telemetry.js";

function makeEnrichedContext(overrides?: Partial<EnrichedContext>): EnrichedContext {
  return {
    graph: null,
    analysis: null,
    framing: null,
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" },
    intent_classification: "conversational",
    decision_archetype: { type: null, confidence: "low", evidence: "no keywords matched" },
    progress_markers: [],
    stuck: { detected: false, rescue_routes: [] },
    conversational_state: { active_entities: [], stated_constraints: [], current_topic: "framing", last_failed_action: null },
    dsk: { claims: [], triggers: [], techniques: [], version_hash: null },
    user_profile: { coaching_style: "socratic", calibration_tendency: "unknown", challenge_tolerance: "medium" },
    scenario_id: "test-scenario",
    turn_id: "test-turn-id",
    ...overrides,
  };
}

function makeLLMResult(overrides?: Partial<LLMResult>): LLMResult {
  return {
    assistant_text: "Hello",
    tool_invocations: [],
    science_annotations: [],
    raw_response: "Hello",
    suggested_actions: [],
    diagnostics: null,
    parse_warnings: [],
    ...overrides,
  };
}

function makeMockDispatcher(result?: Partial<ToolResult>): ToolDispatcher {
  return {
    dispatch: vi.fn().mockResolvedValue({
      blocks: [],
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      assistant_text: null,
      guidance_items: [],
      ...result,
    }),
  };
}

describe("phase4-tools", () => {
  it("returns empty result with no side effects when no tool invocations", async () => {
    const dispatcher = makeMockDispatcher();
    const result = await phase4Execute(
      makeLLMResult({ tool_invocations: [] }),
      makeEnrichedContext(),
      dispatcher,
      "req-1",
    );

    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    expect(result.blocks).toEqual([]);
    expect(result.side_effects).toEqual({
      graph_updated: false,
      analysis_ran: false,
      brief_generated: false,
    });
    // assistant_text should pass through from LLM
    expect(result.assistant_text).toBe("Hello");
    expect(result.executed_tools).toEqual([]);
    expect(result.deferred_tools).toEqual([]);
  });

  it("dispatches first tool invocation", async () => {
    const dispatcher = makeMockDispatcher({
      blocks: [{ type: "commentary", content: "Graph drafted" }] as unknown as ToolResult["blocks"],
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
      assistant_text: "Model created",
    });

    const result = await phase4Execute(
      makeLLMResult({
        tool_invocations: [
          { id: "tool-1", name: "draft_graph", input: { brief: "test" } },
          { id: "tool-2", name: "run_analysis", input: {} }, // second long-running tool deferred
        ],
      }),
      makeEnrichedContext({ stage_indicator: { stage: "frame", confidence: "high", source: "inferred" } }),
      dispatcher,
      "req-1",
    );

    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect((dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("draft_graph");
    expect(result.side_effects.graph_updated).toBe(true);
  });

  it("passes enriched context fields to dispatcher", async () => {
    const dispatcher = makeMockDispatcher();
    const ctx = makeEnrichedContext();

    await phase4Execute(
      makeLLMResult({
        tool_invocations: [{ id: "t1", name: "run_analysis", input: {} }],
      }),
      ctx,
      dispatcher,
      "req-123",
    );

    const call = (dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2].scenario_id).toBe("test-scenario");
    expect(call[3]).toBe("test-turn-id");
    expect(call[4]).toBe("req-123");
  });

  it("long-running guard: draft_graph + run_analysis → only draft_graph executes, run_analysis deferred", async () => {
    const dispatcher = makeMockDispatcher({
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
    });

    const result = await phase4Execute(
      makeLLMResult({
        tool_invocations: [
          { id: "tool-1", name: "draft_graph", input: { brief: "test brief" } },
          { id: "tool-2", name: "run_analysis", input: {} },
        ],
      }),
      makeEnrichedContext({ stage_indicator: { stage: "frame", confidence: "high", source: "inferred" } }),
      dispatcher,
      "req-1",
    );

    // Only draft_graph dispatched — run_analysis is a second long-running tool
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(1);
    expect((dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("draft_graph");

    // Side effects reflect only draft_graph
    expect(result.side_effects.graph_updated).toBe(true);
    expect(result.side_effects.analysis_ran).toBe(false);

    // Tracking fields
    expect(result.executed_tools).toEqual(["draft_graph"]);
    expect(result.deferred_tools).toEqual(["run_analysis"]);

    // Deferred note included in assistant_text
    expect(result.assistant_text).toContain("run_analysis");
    expect(result.assistant_text).toContain("deferred");
  });

  it("long-running guard: run_analysis followed by explain_results — both execute", async () => {
    const mockAnalysisResponse = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "hash-1" },
      results: [],
      response_hash: "top-hash",
    };

    const dispatcher: ToolDispatcher = {
      dispatch: vi.fn()
        .mockResolvedValueOnce({
          blocks: [],
          side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false },
          assistant_text: null,
          analysis_response: mockAnalysisResponse,
          guidance_items: [],
        })
        .mockResolvedValueOnce({
          blocks: [],
          side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
          assistant_text: null,
          guidance_items: [],
        }),
    };

    const result = await phase4Execute(
      makeLLMResult({
        tool_invocations: [
          { id: "tool-1", name: "run_analysis", input: {} },
          { id: "tool-2", name: "explain_results", input: {} },
        ],
      }),
      makeEnrichedContext(),
      dispatcher,
      "req-1",
    );

    // Both tools execute — explain_results is lightweight
    expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
    expect((dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("run_analysis");
    expect((dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[1][0]).toBe("explain_results");

    // No deferred note since no second long-running tool
    expect(result.assistant_text).not.toContain("deferred");
    expect(result.executed_tools).toEqual(["run_analysis", "explain_results"]);
    expect(result.deferred_tools).toEqual([]);
  });

  it("context carry-forward: explain_results receives analysis_response from run_analysis", async () => {
    const freshAnalysis = {
      meta: { seed_used: 42, n_samples: 1000, response_hash: "fresh-hash" },
      results: [{ option_label: "Option A", win_probability: 0.7 }],
      response_hash: "fresh-hash",
    };

    const dispatcher: ToolDispatcher = {
      dispatch: vi.fn()
        .mockResolvedValueOnce({
          // run_analysis produces fresh analysis
          blocks: [],
          side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false },
          assistant_text: null,
          analysis_response: freshAnalysis,
          guidance_items: [],
        })
        .mockResolvedValueOnce({
          // explain_results — no analysis_response needed in return
          blocks: [],
          side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
          assistant_text: null,
          guidance_items: [],
        }),
    };

    // enrichedContext has NO analysis (null) — context must be updated from run_analysis result
    await phase4Execute(
      makeLLMResult({
        tool_invocations: [
          { id: "tool-1", name: "run_analysis", input: {} },
          { id: "tool-2", name: "explain_results", input: {} },
        ],
      }),
      makeEnrichedContext(), // analysis: null
      dispatcher,
      "req-1",
    );

    // The context passed to explain_results should include the fresh analysis
    const explainContext = (dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[1][2] as ConversationContext;
    expect(explainContext.analysis_response).toBeDefined();
    expect(explainContext.analysis_response?.response_hash).toBe("fresh-hash");
  });

  it("order-inversion: LLM emits explain_results before run_analysis → run_analysis executes first", async () => {
    const dispatcher: ToolDispatcher = {
      dispatch: vi.fn()
        .mockResolvedValueOnce({
          blocks: [],
          side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false },
          assistant_text: null,
          analysis_response: { meta: { seed_used: 1, n_samples: 100, response_hash: "h" }, results: [], response_hash: "h" },
          guidance_items: [],
        })
        .mockResolvedValueOnce({
          blocks: [],
          side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
          assistant_text: null,
          guidance_items: [],
        }),
    };

    const result = await phase4Execute(
      makeLLMResult({
        // LLM emits in wrong order — lightweight before long-running
        tool_invocations: [
          { id: "tool-1", name: "explain_results", input: {} },
          { id: "tool-2", name: "run_analysis", input: {} },
        ],
      }),
      makeEnrichedContext(),
      dispatcher,
      "req-1",
    );

    // Phase 4 must reorder: run_analysis first, explain_results second
    const calls = (dispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0]).toBe("run_analysis");
    expect(calls[1][0]).toBe("explain_results");

    // executed_tools reflects actual execution order
    expect(result.executed_tools).toEqual(["run_analysis", "explain_results"]);
  });

  it("emits OrchestratorToolSuppressed when stage policy blocks a tool", async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));

    const dispatcher = makeMockDispatcher();

    try {
      await phase4Execute(
        makeLLMResult({
          tool_invocations: [{ id: "t1", name: "run_analysis", input: {} }],
        }),
        // FRAME stage — run_analysis is blocked
        makeEnrichedContext({ stage_indicator: { stage: "frame", confidence: "high", source: "inferred" } }),
        dispatcher,
        "req-1",
      );

      // Tool should NOT have been dispatched
      expect(dispatcher.dispatch).not.toHaveBeenCalled();

      // Suppression event should have been emitted
      const suppressionEvents = events.filter(e => e.name === "orchestrator.turn.tool_suppressed");
      expect(suppressionEvents.length).toBe(1);
      expect(suppressionEvents[0].data.tool_attempted).toBe("run_analysis");
      expect(suppressionEvents[0].data.stage).toBe("frame");
      expect(suppressionEvents[0].data.pipeline).toBe("v2");
    } finally {
      setTestSink(null);
    }
  });
});
