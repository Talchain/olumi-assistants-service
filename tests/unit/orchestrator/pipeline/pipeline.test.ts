import { describe, it, expect, vi } from "vitest";
import { executePipeline } from "../../../../src/orchestrator/pipeline/pipeline.js";
import type { OrchestratorTurnRequest } from "../../../../src/orchestrator/types.js";
import type { PipelineDeps, LLMClient, ToolDispatcher, ToolResult } from "../../../../src/orchestrator/pipeline/types.js";
import { log } from "../../../../src/utils/telemetry.js";

// Mock config for isProduction check
vi.mock("../../../../src/config/index.js", () => ({
  isProduction: () => false,
  config: { features: { orchestratorV2: false, contextFabric: false } },
}));

// Mock intent gate
vi.mock("../../../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({ routing: "llm", tool: null }),
}));

// Mock prompt assembly
vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("System prompt"),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "orchestrator",
    source: "default",
    prompt_version: "default:orchestrator",
    prompt_hash: "test-hash",
    instance_id: "test-instance",
  }),
}));

vi.mock("../../../../src/orchestrator/prompt-assembly.js", () => ({
  assembleMessages: vi.fn().mockReturnValue([{ role: "user", content: "test" }]),
  assembleToolDefinitions: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../../src/orchestrator/tools/registry.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([]),
  isLongRunningTool: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../../src/orchestrator/blocks/factory.js", () => ({
  createCommentaryBlock: vi.fn(),
  createReviewCardBlock: vi.fn(),
}));

function makeRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
  return {
    scenario_id: "test-scenario",
    client_turn_id: "client-1",
    message: "Hello",
    context: {
      graph: null,
      analysis_response: null,
      framing: null,
      messages: [],
      scenario_id: "test-scenario",
    },
    ...overrides,
  } as OrchestratorTurnRequest;
}

function makeMockDeps(): PipelineDeps {
  const llmClient: LLMClient = {
    chatWithTools: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "<assistant_reply>Hello from LLM</assistant_reply>" }],
      stop_reason: "end_turn",
    }),
    chat: vi.fn().mockResolvedValue({ content: "Hello" }),
  };

  const toolDispatcher: ToolDispatcher = {
    dispatch: vi.fn().mockResolvedValue({
      blocks: [],
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      assistant_text: null,
      guidance_items: [],
    } as ToolResult),
  };

  return { llmClient, toolDispatcher };
}

describe("pipeline", () => {
  it("returns a valid V2 envelope from full pipeline", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-1", deps);

    expect(envelope.turn_id).toBeDefined();
    expect(envelope.lineage).toBeDefined();
    expect(envelope.lineage.context_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.stage_indicator).toBeDefined();
    expect(envelope.science_ledger).toBeDefined();
    expect(envelope.progress_marker).toBeDefined();
    expect(envelope.observability).toBeDefined();
    expect(envelope.turn_plan).toBeDefined();
    expect(envelope.error).toBeUndefined();
  });

  it("returns error envelope when a phase throws", async () => {
    const deps = makeMockDeps();
    // Make LLM client throw
    (deps.llmClient.chatWithTools as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("LLM timeout"),
    );

    const envelope = await executePipeline(makeRequest(), "req-1", deps);

    expect(envelope.error).toBeDefined();
    expect(envelope.error!.code).toBe("PIPELINE_ERROR");
    expect(envelope.assistant_text).toBe(
      "I ran into a problem processing that. Could you try again?",
    );
    // All fields must still be present with defaults
    expect(envelope.lineage).toBeDefined();
    expect(envelope.science_ledger).toBeDefined();
    expect(envelope.progress_marker.kind).toBe("none");
    expect(envelope.turn_plan.selected_tool).toBeNull();
  });

  it("Phase 2 stub returns empty specialist result", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-1", deps);

    expect(envelope.observability.triggers_fired).toEqual([]);
    expect(envelope.observability.triggers_suppressed).toEqual([]);
    expect(envelope.observability.specialist_contributions).toEqual([]);
  });

  it("science_ledger fields are empty (stubs)", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-1", deps);

    expect(envelope.science_ledger.claims_used).toEqual([]);
    expect(envelope.science_ledger.techniques_used).toEqual([]);
    expect(envelope.science_ledger.scope_violations).toEqual([]);
    expect(envelope.science_ledger.rewrite_applied).toBe(false);
  });

  it("dsk_version_hash is null (stub)", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-1", deps);
    expect(envelope.lineage.dsk_version_hash).toBeNull();
  });

  it("propagates stage_indicator from Phase 1", async () => {
    const deps = makeMockDeps();
    // No graph → should infer frame
    const envelope = await executePipeline(makeRequest(), "req-1", deps);
    expect(envelope.stage_indicator.stage).toBe("frame");
    expect(envelope.stage_indicator.confidence).toBe("high");
  });

  it("feedback_submitted returns silent empty envelope without calling LLM", async () => {
    const deps = makeMockDeps();
    const request = makeRequest({
      system_event: { event_type: "feedback_submitted" as const, timestamp: "2026-03-03T00:00:00Z", event_id: "e1", details: { turn_id: "t1", rating: "up" as const } },
    });

    const envelope = await executePipeline(request, "req-1", deps);

    // Must return silently — no assistant text, no blocks, no suggested actions
    expect(envelope.assistant_text).toBeNull();
    expect(envelope.blocks).toEqual([]);
    expect(envelope.suggested_actions).toEqual([]);
    // No error
    expect(envelope.error).toBeUndefined();
    // LLM must not have been called
    expect(deps.llmClient.chatWithTools).not.toHaveBeenCalled();
    expect(deps.llmClient.chat).not.toHaveBeenCalled();
    // Tool dispatcher must not have been called
    expect(deps.toolDispatcher.dispatch).not.toHaveBeenCalled();
    // turn_plan reflects deterministic routing with no tool
    expect(envelope.turn_plan.selected_tool).toBeNull();
    expect(envelope.turn_plan.routing).toBe("deterministic");
    // Standard envelope fields must still be present
    expect(envelope.turn_id).toBeDefined();
    expect(envelope.lineage.context_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.science_ledger).toBeDefined();
    expect(envelope.progress_marker.kind).toBe("none");
  });

  it("follow-up explanation with rehydrated analysis stays in evaluate and dispatches explain_results", async () => {
    const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
    // classifyIntent is called twice per turn: once in pipeline.ts (analysis-lookup guard)
    // and once inside phase3Generate. Both calls must return the deterministic result.
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      routing: "deterministic",
      tool: "explain_results",
      confidence: "exact",
      matched_pattern: "explain results",
    });

    const deps = makeMockDeps();
    (deps.toolDispatcher.dispatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      blocks: [],
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      assistant_text: "Here is what drove the analysis result.",
      guidance_items: [],
    } as ToolResult);

    const envelope = await executePipeline(makeRequest({
      message: "Explain the results",
      context: {
        graph: { nodes: [{ id: "d1", kind: "decision", label: "Decision" }], edges: [] } as any,
        analysis_response: {
          analysis_status: "completed",
          meta: { response_hash: "analysis-hash", seed_used: 1, n_samples: 100 },
          results: [],
          response_hash: "analysis-hash",
        } as any,
        framing: null,
        messages: [],
        scenario_id: "test-scenario",
      },
    }), "req-followup", deps);

    expect(envelope.stage_indicator.stage).toBe("evaluate");
    expect((deps.toolDispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("explain_results");
    expect(envelope.assistant_text).toBe("Here is what drove the analysis result.");
    const explainContext = (deps.toolDispatcher.dispatch as ReturnType<typeof vi.fn>).mock.calls[0][2];
    expect(explainContext.analysis_response?.response_hash).toBe("analysis-hash");
  });

  it("emits explanation override routing provenance in turn trace", async () => {
    const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      routing: "deterministic",
      tool: "edit_graph",
      confidence: "exact",
      matched_pattern: "change",
    });

    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => log);
    const deps = makeMockDeps();
    (deps.toolDispatcher.dispatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      blocks: [],
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      assistant_text: "Here is what drove the analysis result.",
      guidance_items: [],
    } as ToolResult);

    await executePipeline(makeRequest({
      message: "Why was this recommended?",
      context: {
        graph: { nodes: [{ id: "d1", kind: "decision", label: "Decision" }], edges: [] } as any,
        analysis_response: {
          analysis_status: "completed",
          meta: { response_hash: "analysis-hash", seed_used: 1, n_samples: 100 },
          results: [],
          response_hash: "analysis-hash",
        } as any,
        framing: null,
        messages: [],
        scenario_id: "test-scenario",
      },
    }), "req-trace-explain", deps);

    const traceCall = infoSpy.mock.calls.find((call) => {
      const payload = call[0] as Record<string, unknown> | undefined;
      return call[1] === "orchestrator.turn.trace" || payload?.event === "orchestrator.turn.trace";
    }) as [Record<string, unknown>, string?] | undefined;

    expect(traceCall).toBeDefined();
    expect(traceCall?.[0].tool_selected).toBe("explain_results");
    expect(traceCall?.[0].fresh_turn_intent_raw).toBe("recommend");
    expect(traceCall?.[0].fresh_turn_intent_effective).toBe("explain");
    expect(traceCall?.[0].explain_override_applied).toBe(true);
    expect(traceCall?.[0].explain_override_reason).toBe("evaluate_with_analysis_explanation_followup");
    expect(traceCall?.[0].edit_path_summary).toBeNull();
    infoSpy.mockRestore();
  });

  it("emits edit_graph-specific trace diagnostics on edit_graph turns", async () => {
    const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      routing: "deterministic",
      tool: "edit_graph",
      confidence: "exact",
      matched_pattern: "change",
    });

    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => log);
    const deps = makeMockDeps();
    (deps.toolDispatcher.dispatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      blocks: [],
      side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
      assistant_text: "Updated the model.",
      guidance_items: [],
      edit_graph_diagnostics: {
        classified_intent: "parameter_update",
        instruction_mode_applied: "narrow_parameter_update",
        edit_instruction_preview: "This is a narrow parameter/value update.",
        graph_context_node_count: 2,
        graph_context_edge_count: 1,
        operations_proposed_count: 1,
        operations_proposed_types: ["update_node"],
        validation_outcome: "success",
        validation_violation_codes: [],
        recovery_path_chosen: "none",
      },
    } as ToolResult);

    await executePipeline(makeRequest({
      message: "Change",
      context: {
        graph: {
          nodes: [{ id: "d1", kind: "decision", label: "Decision" }, { id: "f1", kind: "factor", label: "Price" }],
          edges: [{ from: "f1", to: "d1", strength_mean: 0.2, strength_std: 0.1, exists_probability: 0.8, effect_direction: "positive" }],
        } as any,
        analysis_response: {
          analysis_status: "completed",
          meta: { response_hash: "analysis-hash", seed_used: 1, n_samples: 100 },
          results: [],
          response_hash: "analysis-hash",
        } as any,
        framing: null,
        messages: [],
        scenario_id: "test-scenario",
      },
    }), "req-trace-edit", deps);

    const traceCall = infoSpy.mock.calls.find((call) => {
      const payload = call[0] as Record<string, unknown> | undefined;
      return call[1] === "orchestrator.turn.trace" || payload?.event === "orchestrator.turn.trace";
    }) as [Record<string, unknown>, string?] | undefined;
    expect(traceCall).toBeDefined();
    expect(traceCall?.[0].tool_selected).toBe("edit_graph");
    expect(traceCall?.[0].classified_intent).toBe("parameter_update");
    expect(traceCall?.[0].instruction_mode_applied).toBe("narrow_parameter_update");
    expect(traceCall?.[0].operations_proposed_types).toEqual(["update_node"]);
    expect(traceCall?.[0].fresh_turn_intent_raw).toBe("act");
    expect(traceCall?.[0].fresh_turn_intent_effective).toBe("act");
    expect(traceCall?.[0].explain_override_applied).toBe(false);
    expect(traceCall?.[0].narrow_intent_guard_applied).toBe(false);
    expect(traceCall?.[0].repeated_failure_escalation_applied).toBe(false);
    expect(traceCall?.[0].structural_ops_proposed_anyway).toBe(false);
    expect(traceCall?.[0].edit_path_summary).toBe("intent=parameter_update;mode=narrow_parameter_update;ops=1;validation=success;recovery=none");
    const effectivePromptComponents = traceCall?.[0].effective_prompt_components as Record<string, unknown>;
    expect(effectivePromptComponents.zone2_structurally_included).toBe(true);
    expect(effectivePromptComponents.narrow_edit_instruction_shaping_applied).toBe(true);
    infoSpy.mockRestore();
  });
});
