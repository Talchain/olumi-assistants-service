/**
 * Tests: Prerequisite-aware tool suppression in phase4Execute
 *
 * When run_analysis is suppressed by stage policy AND the user's intent is
 * non-action (conversational/explain), phase4 should signal needs_conversational_retry
 * instead of injecting the "model needs configured options" fallback.
 *
 * When the user's intent IS action-like, the stage fallback should still fire.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { phase4Execute } from "../../../../src/orchestrator/pipeline/phase4-tools/index.js";
import type { EnrichedContext, LLMResult, ToolDispatcher, ToolResult } from "../../../../src/orchestrator/pipeline/types.js";
import { setTestSink } from "../../../../src/utils/telemetry.js";

function makeEnrichedContext(overrides?: Partial<EnrichedContext>): EnrichedContext {
  return {
    graph: null,
    analysis: null,
    framing: null,
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
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
    assistant_text: null, // LLM produced a tool call, no text
    tool_invocations: [],
    science_annotations: [],
    raw_response: "",
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

describe("phase4-tools: prerequisite-aware conversational retry", () => {
  beforeEach(() => {
    setTestSink(null);
  });

  it("sets needs_conversational_retry when run_analysis suppressed and intent is conversational", async () => {
    const dispatcher = makeMockDispatcher();
    // run_analysis is in stage ideate's tool list BUT stage policy doesn't include it
    // We test stage policy suppression: IDEATE doesn't allow run_analysis
    const result = await phase4Execute(
      makeLLMResult({
        tool_invocations: [{ id: "t1", name: "run_analysis", input: {} }],
        assistant_text: null,
      }),
      makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        intent_classification: "conversational",
      }),
      dispatcher,
      "req-retry",
    );

    // run_analysis is not in IDEATE policy → suppressed
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
    // Non-action intent → should signal retry instead of fallback
    expect(result.needs_conversational_retry).toBe(true);
    expect(result.suppressed_tool_for_retry).toBe("run_analysis");
    expect(result.stage_fallback_injected).toBeFalsy();
    // No fallback message injected
    expect(result.assistant_text).toBeNull();
  });

  it("sets needs_conversational_retry when run_analysis suppressed and intent is explain", async () => {
    const dispatcher = makeMockDispatcher();
    const result = await phase4Execute(
      makeLLMResult({
        tool_invocations: [{ id: "t1", name: "run_analysis", input: {} }],
        assistant_text: null,
      }),
      makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        intent_classification: "explain",
      }),
      dispatcher,
      "req-retry-explain",
    );

    expect(result.needs_conversational_retry).toBe(true);
    expect(result.suppressed_tool_for_retry).toBe("run_analysis");
    expect(result.stage_fallback_injected).toBeFalsy();
  });

  it("injects stage fallback (NOT conversational retry) when intent is act and run_analysis suppressed", async () => {
    const dispatcher = makeMockDispatcher();
    const result = await phase4Execute(
      makeLLMResult({
        tool_invocations: [{ id: "t1", name: "run_analysis", input: {} }],
        assistant_text: null,
      }),
      makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        intent_classification: "act", // explicit action request
      }),
      dispatcher,
      "req-act",
    );

    // Action intent → should get the stage fallback, not retry signal
    expect(result.needs_conversational_retry).toBeFalsy();
    expect(result.stage_fallback_injected).toBe(true);
    // The ideate:run_analysis fallback message should be present
    expect(result.assistant_text).toContain("options");
  });

  it("sets needs_conversational_retry when run_analysis suppressed and intent is recommend", async () => {
    // recommend is not 'act' — user is asking for a recommendation, not explicitly requesting analysis
    const dispatcher = makeMockDispatcher();
    const result = await phase4Execute(
      makeLLMResult({
        tool_invocations: [{ id: "t1", name: "run_analysis", input: {} }],
        assistant_text: null,
      }),
      makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        intent_classification: "recommend",
      }),
      dispatcher,
      "req-recommend",
    );

    expect(result.needs_conversational_retry).toBe(true);
    expect(result.suppressed_tool_for_retry).toBe("run_analysis");
    expect(result.stage_fallback_injected).toBeFalsy();
  });

  it("does not set conversational retry when a non-run_analysis tool is suppressed", async () => {
    const dispatcher = makeMockDispatcher();
    // edit_graph is not in FRAME stage policy
    const result = await phase4Execute(
      makeLLMResult({
        tool_invocations: [{ id: "t1", name: "edit_graph", input: {} }],
        assistant_text: null,
      }),
      makeEnrichedContext({
        stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
        intent_classification: "conversational",
      }),
      dispatcher,
      "req-edit-suppressed",
    );

    // edit_graph suppressed, conversational intent — but NOT run_analysis → normal fallback
    expect(result.needs_conversational_retry).toBeFalsy();
    expect(result.stage_fallback_injected).toBe(true);
  });

  it("does not set conversational retry when LLM text is available despite tool suppression", async () => {
    const dispatcher = makeMockDispatcher();
    const result = await phase4Execute(
      makeLLMResult({
        tool_invocations: [{ id: "t1", name: "run_analysis", input: {} }],
        assistant_text: "What does very high mean? I can answer that from the model structure.",
      }),
      makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        intent_classification: "conversational",
      }),
      dispatcher,
      "req-with-text",
    );

    // LLM already provided text → no fallback or retry needed
    expect(result.needs_conversational_retry).toBeFalsy();
    expect(result.stage_fallback_injected).toBeFalsy();
    expect(result.assistant_text).toContain("What does very high mean");
  });

  it("run_analysis with action intent in valid stage executes correctly", async () => {
    const dispatcher = makeMockDispatcher({
      side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false },
      analysis_response: { results: [], meta: { seed_used: 1, n_samples: 100, response_hash: "h" }, response_hash: "h" } as never,
    });
    // run_analysis IS allowed at evaluate stage
    const result = await phase4Execute(
      makeLLMResult({
        tool_invocations: [{ id: "t1", name: "run_analysis", input: {} }],
      }),
      makeEnrichedContext({
        stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" },
        intent_classification: "act",
      }),
      dispatcher,
      "req-valid-analysis",
    );

    expect(dispatcher.dispatch).toHaveBeenCalledOnce();
    expect(result.executed_tools).toContain("run_analysis");
    expect(result.needs_conversational_retry).toBeFalsy();
    expect(result.stage_fallback_injected).toBeFalsy();
  });
});
