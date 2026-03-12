import { describe, it, expect, vi } from "vitest";
import { executePipeline } from "../../../../src/orchestrator/pipeline/pipeline.js";
import type { OrchestratorTurnRequest } from "../../../../src/orchestrator/types.js";
import type { PipelineDeps, LLMClient, ToolDispatcher, ToolResult } from "../../../../src/orchestrator/pipeline/types.js";
import { log } from "../../../../src/utils/telemetry.js";

const { mockHandleExplainResults } = vi.hoisted(() => ({
  mockHandleExplainResults: vi.fn().mockResolvedValue({
    blocks: [],
    assistantText: "Because Option A is strongest on the current drivers.",
    latencyMs: 5,
  }),
}));

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

vi.mock("../../../../src/adapters/llm/router.js", () => ({
  getMaxTokensFromConfig: vi.fn().mockReturnValue(undefined),
  getAdapter: vi.fn().mockReturnValue({
    chat: vi.fn().mockResolvedValue({ content: "Because Option A is strongest on the current drivers." }),
  }),
}));

vi.mock("../../../../src/orchestrator/blocks/factory.js", () => ({
  createCommentaryBlock: vi.fn(),
  createReviewCardBlock: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/tools/explain-results.js", () => ({
  handleExplainResults: (...args: unknown[]) => mockHandleExplainResults(...args),
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

async function withEnv<T>(
  env: Partial<Record<"NODE_ENV" | "ORCHESTRATOR_DEBUG_BUNDLE", string | undefined>>,
  run: () => Promise<T>,
): Promise<T> {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDebugBundle = process.env.ORCHESTRATOR_DEBUG_BUNDLE;

  if (env.NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = env.NODE_ENV;
  }

  if (env.ORCHESTRATOR_DEBUG_BUNDLE === undefined) {
    delete process.env.ORCHESTRATOR_DEBUG_BUNDLE;
  } else {
    process.env.ORCHESTRATOR_DEBUG_BUNDLE = env.ORCHESTRATOR_DEBUG_BUNDLE;
  }

  try {
    return await run();
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }

    if (previousDebugBundle === undefined) {
      delete process.env.ORCHESTRATOR_DEBUG_BUNDLE;
    } else {
      process.env.ORCHESTRATOR_DEBUG_BUNDLE = previousDebugBundle;
    }
  }
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

  it("omits _debug_bundle from normal turn envelopes by default in production", async () => {
    const deps = makeMockDeps();

    const envelope = await withEnv(
      { NODE_ENV: "production", ORCHESTRATOR_DEBUG_BUNDLE: undefined },
      () => executePipeline(makeRequest(), "req-prod-normal-no-debug", deps),
    );

    expect(envelope._debug_bundle).toBeUndefined();
  });

  it("includes _debug_bundle in normal turn envelopes only when explicit debug flag is enabled in production", async () => {
    const deps = makeMockDeps();

    const envelope = await withEnv(
      { NODE_ENV: "production", ORCHESTRATOR_DEBUG_BUNDLE: "true" },
      () => executePipeline(makeRequest(), "req-prod-normal-debug", deps),
    );

    expect(envelope._debug_bundle).toBeDefined();
    expect(envelope._debug_bundle?.trigger_source).toBe("user_message");
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
          results: [{ option_label: "Option A", win_probability: 0.7 }],
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
          results: [{ option_label: "Option A", win_probability: 0.7 }],
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
    expect(traceCall?.[0].route_outcome).toBe("results_explanation");
    expect(traceCall?.[0].explain_override_reason).toBe("completed_current_analysis_available");
    expect(traceCall?.[0].edit_path_summary).toBeNull();
    infoSpy.mockRestore();
  });

  it("does not narrate direct_analysis_run Path A when the provided analysis is not explainable", async () => {
    const deps = makeMockDeps();

    const envelope = await executePipeline(makeRequest({
      message: "Why was this recommended?",
      graph_state: { nodes: [{ id: "d1", kind: "decision", label: "Decision" }], edges: [] } as any,
      system_event: {
        event_type: "direct_analysis_run",
        timestamp: "2026-03-03T00:00:00Z",
        event_id: "evt-direct-analysis",
        details: {},
      },
      analysis_state: {
        analysis_status: "blocked",
        status_reason: "Missing interventions",
        critiques: [],
        meta: { response_hash: "", seed_used: 1, n_samples: 100 },
        response_hash: "",
      } as any,
    }), "req-direct-analysis-blocked", deps);

    expect(deps.llmClient.chat).not.toHaveBeenCalled();
    expect(deps.llmClient.chatWithTools).not.toHaveBeenCalled();
    expect(envelope.assistant_text).toBeNull();
    expect(envelope._route_metadata).toEqual({
      outcome: "direct_analysis_narration_skipped",
      reasoning: "analysis_not_current_or_not_explainable",
    });
  });

  it("omits _debug_bundle from direct_analysis_run envelopes by default in production", async () => {
    const deps = makeMockDeps();

    const envelope = await withEnv(
      { NODE_ENV: "production", ORCHESTRATOR_DEBUG_BUNDLE: undefined },
      () => executePipeline(makeRequest({
        message: "Why was this recommended?",
        graph_state: { nodes: [{ id: "d1", kind: "decision", label: "Decision" }], edges: [] } as any,
        system_event: {
          event_type: "direct_analysis_run",
          timestamp: "2026-03-03T00:00:00Z",
          event_id: "evt-direct-analysis-prod-hidden",
          details: {},
        },
        analysis_state: {
          analysis_status: "completed",
          meta: { response_hash: "analysis-hash-prod-hidden", seed_used: 1, n_samples: 100 },
          results: [{ option_label: "Option A", win_probability: 0.7 }],
          response_hash: "analysis-hash-prod-hidden",
        } as any,
      }), "req-direct-analysis-prod-hidden", deps),
    );

    expect(envelope._debug_bundle).toBeUndefined();
  });

  it("includes _debug_bundle in direct_analysis_run envelopes when explicit debug flag is enabled in production", async () => {
    const deps = makeMockDeps();

    const envelope = await withEnv(
      { NODE_ENV: "production", ORCHESTRATOR_DEBUG_BUNDLE: "true" },
      () => executePipeline(makeRequest({
        message: "Why was this recommended?",
        graph_state: { nodes: [{ id: "d1", kind: "decision", label: "Decision" }], edges: [] } as any,
        system_event: {
          event_type: "direct_analysis_run",
          timestamp: "2026-03-03T00:00:00Z",
          event_id: "evt-direct-analysis-prod-visible",
          details: {},
        },
        analysis_state: {
          analysis_status: "completed",
          meta: { response_hash: "analysis-hash-prod-visible", seed_used: 1, n_samples: 100 },
          results: [{ option_label: "Option A", win_probability: 0.7 }],
          response_hash: "analysis-hash-prod-visible",
        } as any,
      }), "req-direct-analysis-prod-visible", deps),
    );

    expect(envelope._debug_bundle).toBeDefined();
    expect(envelope._debug_bundle?.trigger_source).toBe("direct_analysis_run");
  });

  it("returns ack-only route metadata for direct_analysis_run Path A without meaningful follow-up text", async () => {
    const deps = makeMockDeps();

    const envelope = await executePipeline(makeRequest({
      message: "hi",
      graph_state: { nodes: [{ id: "d1", kind: "decision", label: "Decision" }], edges: [] } as any,
      system_event: {
        event_type: "direct_analysis_run",
        timestamp: "2026-03-03T00:00:00Z",
        event_id: "evt-direct-analysis-ack",
        details: {},
      },
      analysis_state: {
        analysis_status: "completed",
        meta: { response_hash: "analysis-hash-ack", seed_used: 1, n_samples: 100 },
        results: [{ option_label: "Option A", win_probability: 0.7 }],
        response_hash: "analysis-hash-ack",
      } as any,
    }), "req-direct-analysis-ack", deps);

    expect(envelope._route_metadata).toEqual({
      outcome: "direct_analysis_ack_only",
      reasoning: "no_followup_message_for_results_narration",
    });
  });

  it("marks narrated direct_analysis_run Path A truthfully in route metadata", async () => {
    const deps = makeMockDeps();

    const envelope = await executePipeline(makeRequest({
      message: "Why was this recommended?",
      graph_state: { nodes: [{ id: "d1", kind: "decision", label: "Decision" }], edges: [] } as any,
      system_event: {
        event_type: "direct_analysis_run",
        timestamp: "2026-03-03T00:00:00Z",
        event_id: "evt-direct-analysis-narrated",
        details: {},
      },
      analysis_state: {
        analysis_status: "completed",
        meta: { response_hash: "analysis-hash-narrated", seed_used: 1, n_samples: 100 },
        results: [{ option_label: "Option A", win_probability: 0.7 }],
        response_hash: "analysis-hash-narrated",
      } as any,
    }), "req-direct-analysis-narrated", deps);

    expect(envelope._route_metadata).toEqual({
      outcome: "direct_analysis_with_narration",
      reasoning: "completed_current_analysis_available",
    });
  });

  it("marks direct_analysis_run narration failures truthfully in debug metadata", async () => {
    mockHandleExplainResults.mockRejectedValueOnce(new Error("narration failed"));
    const deps = makeMockDeps();

    const envelope = await executePipeline(makeRequest({
      message: "Why was this recommended?",
      graph_state: { nodes: [{ id: "d1", kind: "decision", label: "Decision" }], edges: [], hash: "graph-hash" } as any,
      system_event: {
        event_type: "direct_analysis_run",
        timestamp: "2026-03-03T00:00:00Z",
        event_id: "evt-direct-analysis-failed-narration",
        details: {},
      },
      analysis_state: {
        analysis_status: "completed",
        meta: { response_hash: "analysis-hash-failed-narration", seed_used: 1, n_samples: 100 },
        results: [{ option_label: "Option A", win_probability: 0.7 }],
        response_hash: "analysis-hash-failed-narration",
        graph_hash: "graph-hash",
      } as any,
    }), "req-direct-analysis-failed-narration", deps);

    expect(envelope._route_metadata).toEqual({
      outcome: "direct_analysis_narration_skipped",
      reasoning: "explain_results_failed",
    });
    expect(envelope._debug_bundle?.direct_analysis_run).toEqual({
      source_context: "analysis_state",
      narration_branch: "explain_results_failed",
      stale_state_reused: false,
    });
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
        conversational_state_summary: {
          active_entities_count: 1,
          stated_constraints_count: 1,
          current_topic: "editing",
        },
        target_resolution: {
          method: "exact_label",
          confidence: "high",
          resolved_label: "Price",
          alternatives_count: 0,
        },
        resolution_mode: "auto_apply",
        proposal_returned: false,
        branch_taken: "apply",
        branch_reason: null,
        failure_branch: null,
        failure_code: null,
        failure_message: null,
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
    expect(traceCall?.[0].conversational_state_summary).toEqual({
      active_entities_count: 1,
      stated_constraints_count: 1,
      current_topic: "editing",
    });
    expect(traceCall?.[0].target_resolution).toEqual({
      method: "exact_label",
      confidence: "high",
      resolved_label: "Price",
      alternatives_count: 0,
    });
    expect(traceCall?.[0].resolution_mode).toBe("auto_apply");
    expect(traceCall?.[0].proposal_returned).toBe(false);
    expect(traceCall?.[0].branch_taken).toBe("apply");
    expect(traceCall?.[0].failure_branch).toBeNull();
    const debugBundle = traceCall?.[0].debug_bundle as Record<string, unknown>;
    expect(debugBundle.trigger_source).toBe("user_message");
    expect((debugBundle.final_route as Record<string, unknown>).selected_tool).toBe("edit_graph");
    expect((debugBundle.clarification_state as Record<string, unknown>).present).toBe(false);
    expect((debugBundle.pending_proposal_state as Record<string, unknown>).present).toBe(false);
    const effectivePromptComponents = traceCall?.[0].effective_prompt_components as Record<string, unknown>;
    expect(effectivePromptComponents.zone2_structurally_included).toBe(true);
    expect(effectivePromptComponents.narrow_edit_instruction_shaping_applied).toBe(true);
    infoSpy.mockRestore();
  });

  it("emits direct_analysis_run trigger source and narration branch in debug bundle", async () => {
    const infoSpy = vi.spyOn(log, "info").mockImplementation(() => log);
    const deps = makeMockDeps();

    await executePipeline(makeRequest({
      message: "Why was this recommended?",
      graph_state: { nodes: [{ id: "d1", kind: "decision", label: "Decision", hash: "graph-hash" }], edges: [], hash: "graph-hash" } as any,
      system_event: {
        event_type: "direct_analysis_run",
        timestamp: "2026-03-03T00:00:00Z",
        event_id: "evt-direct-analysis-ok",
        details: {},
      },
      analysis_state: {
        analysis_status: "blocked",
        status_reason: "Missing interventions",
        meta: { response_hash: "analysis-hash", seed_used: 1, n_samples: 100 },
        results: [],
        response_hash: "analysis-hash",
        graph_hash: "stale-hash",
      } as any,
    }), "req-direct-analysis-ok", deps);

    const traceCall = infoSpy.mock.calls.find((call) => {
      const payload = call[0] as Record<string, unknown> | undefined;
      return call[1] === "orchestrator.turn.trace" || payload?.event === "orchestrator.turn.trace";
    }) as [Record<string, unknown>, string?] | undefined;

    expect(traceCall).toBeDefined();
    const debugBundle = traceCall?.[0].debug_bundle as Record<string, unknown>;
    expect(debugBundle.trigger_source).toBe("direct_analysis_run");
    expect((debugBundle.direct_analysis_run as Record<string, unknown>).source_context).toBe("analysis_state");
    expect((debugBundle.direct_analysis_run as Record<string, unknown>).narration_branch).toBe("skipped_not_explainable_or_not_current");
    expect((debugBundle.direct_analysis_run as Record<string, unknown>).stale_state_reused).toBe(true);
    infoSpy.mockRestore();
  });

  it("includes carried clarification state in the debug bundle when present", async () => {
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
      assistant_text: "Which one should I update?",
      guidance_items: [],
      pending_clarification: {
        tool: "edit_graph",
        original_edit_request: "Reduce it by 10%",
        candidate_labels: ["Onboarding Time", "Hiring Delay"],
      },
      edit_graph_diagnostics: {
        classified_intent: "parameter_update",
        instruction_mode_applied: "narrow_parameter_update",
        edit_instruction_preview: "This is a narrow parameter/value update.",
        graph_context_node_count: 2,
        graph_context_edge_count: 0,
        operations_proposed_count: 0,
        operations_proposed_types: [],
        validation_outcome: "not_evaluated",
        validation_violation_codes: [],
        recovery_path_chosen: "none",
        conversational_state_summary: null,
        target_resolution: null,
        resolution_mode: "clarify",
        proposal_returned: false,
        branch_taken: "clarify",
        branch_reason: "ambiguous_target_requires_clarification",
        failure_branch: null,
        failure_code: null,
        failure_message: null,
      },
    } as ToolResult);

    await executePipeline(makeRequest({
      message: "Change it",
      context: {
        graph: {
          nodes: [
            { id: "f1", kind: "factor", label: "Onboarding Time" },
            { id: "f2", kind: "factor", label: "Hiring Delay" },
          ],
          edges: [],
        } as any,
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: "test-scenario",
      },
    }), "req-trace-clarification", deps);

    const traceCall = infoSpy.mock.calls.find((call) => {
      const payload = call[0] as Record<string, unknown> | undefined;
      return call[1] === "orchestrator.turn.trace" || payload?.event === "orchestrator.turn.trace";
    }) as [Record<string, unknown>, string?] | undefined;
    const debugBundle = traceCall?.[0].debug_bundle as Record<string, unknown>;
    expect((debugBundle.clarification_state as Record<string, unknown>).present).toBe(true);
    expect((debugBundle.clarification_state as Record<string, unknown>).candidate_labels).toEqual(["Onboarding Time", "Hiring Delay"]);
    expect(debugBundle.outcome).toBe("clarified");
    infoSpy.mockRestore();
  });

  it("includes carried proposal state and exact failure metadata in the debug bundle", async () => {
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
      assistant_text: "I couldn't apply that safely.",
      guidance_items: [],
      pending_proposal: {
        tool: "edit_graph",
        original_edit_request: "Update all three options",
        base_graph_hash: "abc123",
        candidate_labels: ["Option A", "Option B", "Option C"],
        proposed_changes: {
          changes: [
            { description: "Update Option A", element_label: "Option A", action_type: "option_config" },
          ],
        },
      },
      edit_graph_diagnostics: {
        classified_intent: "option_configuration",
        instruction_mode_applied: "narrow_option_configuration",
        edit_instruction_preview: "This is an option/intervention configuration update.",
        graph_context_node_count: 3,
        graph_context_edge_count: 0,
        operations_proposed_count: 2,
        operations_proposed_types: ["update_node"],
        validation_outcome: "plot_semantic_rejected",
        validation_violation_codes: ["CYCLE_DETECTED"],
        recovery_path_chosen: "rejection_block",
        conversational_state_summary: null,
        target_resolution: null,
        resolution_mode: "propose_and_confirm",
        proposal_returned: true,
        branch_taken: "rejection",
        branch_reason: "plot_semantic_rejected",
        failure_branch: "plot_semantic_rejected",
        failure_code: "PLOT_SEMANTIC_REJECTED",
        failure_message: "Cycle detected in the patch",
      },
    } as ToolResult);

    await executePipeline(makeRequest({
      message: "Update all three options",
      context: {
        graph: {
          nodes: [
            { id: "o1", kind: "option", label: "Option A" },
            { id: "o2", kind: "option", label: "Option B" },
            { id: "o3", kind: "option", label: "Option C" },
          ],
          edges: [],
        } as any,
        analysis_response: null,
        framing: null,
        messages: [],
        scenario_id: "test-scenario",
      },
    }), "req-trace-failure", deps);

    const traceCall = infoSpy.mock.calls.find((call) => {
      const payload = call[0] as Record<string, unknown> | undefined;
      return call[1] === "orchestrator.turn.trace" || payload?.event === "orchestrator.turn.trace";
    }) as [Record<string, unknown>, string?] | undefined;
    const debugBundle = traceCall?.[0].debug_bundle as Record<string, unknown>;
    expect((debugBundle.pending_proposal_state as Record<string, unknown>).present).toBe(true);
    expect((debugBundle.pending_proposal_state as Record<string, unknown>).summary).toContain("1 change(s)");
    expect((debugBundle.failure as Record<string, unknown>).branch).toBe("plot_semantic_rejected");
    expect((debugBundle.failure as Record<string, unknown>).code).toBe("PLOT_SEMANTIC_REJECTED");
    expect((debugBundle.failure as Record<string, unknown>).message).toBe("Cycle detected in the patch");
    expect(debugBundle.outcome).toBe("failed");
    infoSpy.mockRestore();
  });
});
