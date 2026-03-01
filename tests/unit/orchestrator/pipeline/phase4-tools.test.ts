import { describe, it, expect, vi } from "vitest";
import { phase4Execute } from "../../../../src/orchestrator/pipeline/phase4-tools/index.js";
import type { EnrichedContext, LLMResult, ToolDispatcher, ToolResult } from "../../../../src/orchestrator/pipeline/types.js";

function makeEnrichedContext(): EnrichedContext {
  return {
    graph: null,
    analysis: null,
    framing: null,
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    intent_classification: "conversational",
    decision_archetype: { type: null, confidence: "low", evidence: "no keywords matched" },
    progress_markers: [],
    stuck: { detected: false, rescue_routes: [] },
    dsk: { claims: [], triggers: [], techniques: [], version_hash: null },
    user_profile: { coaching_style: "socratic", calibration_tendency: "unknown", challenge_tolerance: "medium" },
    scenario_id: "test-scenario",
    turn_id: "test-turn-id",
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
          { id: "tool-2", name: "run_analysis", input: {} }, // second tool ignored
        ],
      }),
      makeEnrichedContext(),
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
});
