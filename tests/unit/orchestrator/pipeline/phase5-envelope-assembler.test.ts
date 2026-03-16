import { describe, it, expect, vi } from "vitest";
import {
  assembleV2Envelope,
  buildErrorEnvelope,
} from "../../../../src/orchestrator/pipeline/phase5-validation/envelope-assembler.js";
import { computeContextHash } from "../../../../src/orchestrator/context/context-hash.js";
import type {
  EnrichedContext,
  SpecialistResult,
  LLMResult,
  ToolResult,
  ScienceLedger,
} from "../../../../src/orchestrator/pipeline/types.js";

// Stub isProduction to return false for debug field tests
vi.mock("../../../../src/config/index.js", () => ({
  isProduction: () => false,
  config: { features: { orchestratorV2: false, dskV0: false } },
}));

// Stub dsk-loader so envelope assembler doesn't call getDskVersionHash()/resolveDskHash() against the FS
vi.mock("../../../../src/orchestrator/dsk-loader.js", () => ({
  getDskVersionHash: () => null,
  resolveDskHash: () => null,
}));

function makeEnrichedContext(overrides?: Partial<EnrichedContext>): EnrichedContext {
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

function makeToolResult(overrides?: Partial<ToolResult>): ToolResult {
  return {
    blocks: [],
    side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
    assistant_text: null,
    guidance_items: [],
    ...overrides,
  };
}

function makeSpecialistResult(): SpecialistResult {
  return { advice: null, candidates: [], triggers_fired: [], triggers_suppressed: [] };
}

function makeScienceLedger(): ScienceLedger {
  return {
    claims_used: [],
    techniques_used: [],
    scope_violations: [],
    phrasing_violations: [],
    rewrite_applied: false,
  };
}

// Note: computeContextHash is the canonical implementation from context/context-hash.ts.
// Detailed hash tests live in tests/unit/orchestrator/context/context-hash.test.ts.
// These tests cover the cross-cutting concern: hash is wired correctly into envelopes.
describe("computeContextHash (canonical, from context/context-hash)", () => {
  it("returns a 64-char hex string", () => {
    const hash = computeContextHash({});
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same input", () => {
    const ctx = { messages: [{ role: "user" as const, content: "hello" }] };
    expect(computeContextHash(ctx)).toBe(computeContextHash(ctx));
  });

  it("different messages → different hash", () => {
    const a = computeContextHash({ messages: [{ role: "user" as const, content: "hello" }] });
    const b = computeContextHash({ messages: [{ role: "user" as const, content: "goodbye" }] });
    expect(a).not.toBe(b);
  });
});

describe("assembleV2Envelope", () => {
  it("returns envelope with all required fields", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.turn_id).toBe("test-turn-id");
    expect(envelope.assistant_text).toBe("Hello");
    expect(envelope.blocks).toEqual([]);
    expect(envelope.suggested_actions).toEqual([]);
    expect(envelope.lineage).toBeDefined();
    expect(envelope.lineage.context_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.lineage.dsk_version_hash).toBeNull();
    expect(envelope.stage_indicator).toBeDefined();
    expect(envelope.stage_indicator.stage).toBe("frame");
    expect(envelope.science_ledger).toBeDefined();
    expect(envelope.progress_marker.kind).toBe("none");
    expect(envelope.observability).toBeDefined();
    expect(envelope.turn_plan).toBeDefined();
  });

  it("applies stage transition", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext({ stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" } }),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult({ side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false } }),
      progressKind: "ran_analysis",
      stageTransition: { from: "ideate", to: "evaluate", trigger: "analysis_completed" },
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.stage_indicator.stage).toBe("evaluate");
    expect(envelope.stage_indicator.transition).toEqual({
      from: "ideate",
      to: "evaluate",
      trigger: "analysis_completed",
    });
  });

  it("merges rescue routes when stuck", () => {
    const rescueRoutes = [
      { label: "Test", prompt: "Test prompt", role: "facilitator" as const },
    ];
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext({
        stuck: { detected: true, rescue_routes: rescueRoutes },
      }),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({ suggested_actions: [{ label: "Existing", prompt: "...", role: "challenger" }] }),
      toolResult: makeToolResult(),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.suggested_actions).toHaveLength(2);
    expect(envelope.suggested_actions[0].label).toBe("Existing");
    expect(envelope.suggested_actions[1].label).toBe("Test");
  });

  it("uses tool result assistant_text over LLM text", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({ assistant_text: "LLM text" }),
      toolResult: makeToolResult({ assistant_text: "Tool text" }),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.assistant_text).toBe("Tool text");
  });

  it("falls back to LLM text when tool result has no text", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({ assistant_text: "LLM text" }),
      toolResult: makeToolResult({ assistant_text: null }),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.assistant_text).toBe("LLM text");
  });

  it("sets routing to 'deterministic' when tool has deterministic id", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({
        tool_invocations: [{ name: "run_analysis", input: {}, id: "deterministic" }],
      }),
      toolResult: makeToolResult({ side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false } }),
      progressKind: "ran_analysis",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.turn_plan.routing).toBe("deterministic");
    expect(envelope.turn_plan.selected_tool).toBe("run_analysis");
  });

  it("includes diagnostics in non-production mode", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({ diagnostics: "Debug info" }),
      toolResult: makeToolResult(),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.diagnostics).toBe("Debug info");
  });

  it("emits assistant_tool_calls for structured edit_graph clarification carry-forward", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({
        tool_invocations: [{
          id: "deterministic",
          name: "edit_graph",
          input: { edit_description: "Reduce it by 10%" },
        }],
      }),
      toolResult: makeToolResult({
        assistant_text: "Which one should I update — Onboarding Time or Hiring Delay?",
        pending_clarification: {
          tool: "edit_graph",
          original_edit_request: "Reduce it by 10%",
          candidate_labels: ["Onboarding Time", "Hiring Delay"],
        },
      }),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.assistant_tool_calls).toEqual([{
      name: "edit_graph",
      input: {
        edit_description: "Reduce it by 10%",
        pending_clarification: {
          tool: "edit_graph",
          original_edit_request: "Reduce it by 10%",
          candidate_labels: ["Onboarding Time", "Hiring Delay"],
        },
      },
    }]);
  });

  it("emits assistant_tool_calls for structured edit_graph proposal carry-forward", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({
        tool_invocations: [{
          id: "deterministic",
          name: "edit_graph",
          input: { edit_description: "Update all three options" },
        }],
      }),
      toolResult: makeToolResult({
        assistant_text: "Here’s the change I’d propose. If you want, I can apply it next.",
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
      }),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.assistant_tool_calls).toEqual([{
      name: "edit_graph",
      input: {
        edit_description: "Update all three options",
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
      },
    }]);
  });

  it("stores internal route metadata when a touched path returns it", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult({
        route_metadata: {
          outcome: "proposal_created",
          reasoning: "returned_pending_proposal",
        },
      }),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope._route_metadata).toMatchObject({
      outcome: "proposal_created",
      reasoning: "returned_pending_proposal",
    });
    // Extended observability fields (Task 3)
    expect(envelope._route_metadata).toHaveProperty('contract_version');
    expect(envelope._route_metadata).toHaveProperty('has_graph');
    expect(envelope._route_metadata).toHaveProperty('has_analysis');
  });

  // ==========================================================================
  // Model observability: resolved_model / resolved_provider in _route_metadata
  // P0-1: non-LLM tool turns (run_analysis etc.) fall back to llmResult model fields
  // P0-2: conversational retry propagates model fields via toolResult.route_metadata
  // ==========================================================================

  it("P0-1: _route_metadata carries resolved_model/provider from llmResult when toolResult has none", () => {
    // Simulates a run_analysis turn: tool has no LLM adapter → no model on route_metadata
    // llmResult carries the model from the orchestrator phase3 LLM call
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({
        tool_invocations: [{ id: "deterministic", name: "run_analysis", input: {} }],
        route_metadata: {
          outcome: "default_llm",
          reasoning: "no_deterministic_route_applied",
          resolved_model: "gpt-4o",
          resolved_provider: "openai",
        },
      }),
      toolResult: makeToolResult({
        // run_analysis does not set resolved_model on its route_metadata
        route_metadata: {
          outcome: "default_llm",
          reasoning: "tool_dispatch:run_analysis",
          // no resolved_model or resolved_provider
        },
        side_effects: { graph_updated: false, analysis_ran: true, brief_generated: false },
      }),
      progressKind: "ran_analysis",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope._route_metadata).toBeDefined();
    // Tool metadata takes priority for base fields
    expect(envelope._route_metadata!.outcome).toBe("default_llm");
    // Model fields fall back to llmResult since tool didn't set them
    expect(envelope._route_metadata!.resolved_model).toBe("gpt-4o");
    expect(envelope._route_metadata!.resolved_provider).toBe("openai");
  });

  it("P0-1: toolResult resolved_model/provider overrides llmResult when both are present", () => {
    // Simulates an edit_graph turn: LLM-backed tool sets its own model
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({
        tool_invocations: [{ id: "t1", name: "edit_graph", input: {} }],
        route_metadata: {
          outcome: "default_llm",
          reasoning: "no_deterministic_route_applied",
          resolved_model: "gpt-4o",
          resolved_provider: "openai",
        },
      }),
      toolResult: makeToolResult({
        // edit_graph sets its own model info (different from orchestrator)
        route_metadata: {
          outcome: "default_llm",
          reasoning: "tool_dispatch:edit_graph",
          resolved_model: "claude-sonnet-4-5",
          resolved_provider: "anthropic",
        },
      }),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope._route_metadata).toBeDefined();
    // Tool metadata takes priority for all fields
    expect(envelope._route_metadata!.resolved_model).toBe("claude-sonnet-4-5");
    expect(envelope._route_metadata!.resolved_provider).toBe("anthropic");
  });

  it("P0-2: _route_metadata carries resolved_model from conversational retry via toolResult", () => {
    // Simulates pipeline.ts conversational retry: toolResult.route_metadata is set
    // with the retry model info, llmResult has the original orchestrator model
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({
        tool_invocations: [{ id: "t1", name: "run_analysis", input: {} }],
        route_metadata: {
          outcome: "default_llm",
          reasoning: "no_deterministic_route_applied",
          resolved_model: "gpt-4o",
          resolved_provider: "openai",
        },
      }),
      toolResult: makeToolResult({
        assistant_text: "Great question — let me explain what that means.",
        // pipeline.ts writes retry model info here after the chat() call
        route_metadata: {
          outcome: "default_llm",
          reasoning: "conversational_retry",
          resolved_model: "gpt-4o-mini",
          resolved_provider: "openai",
        },
      }),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope._route_metadata).toBeDefined();
    expect(envelope._route_metadata!.reasoning).toBe("conversational_retry");
    expect(envelope._route_metadata!.resolved_model).toBe("gpt-4o-mini");
    expect(envelope._route_metadata!.resolved_provider).toBe("openai");
  });

  // ==========================================================================
  // Prompt observability: prompt_hash / prompt_version in _route_metadata
  // Phase 3 populates these from getSystemPromptMeta; envelope carries them
  // through for debug bundle and operational tracing.
  // ==========================================================================

  it("P0-3: _route_metadata carries prompt_hash and prompt_version from llmResult", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult({
        route_metadata: {
          outcome: "default_llm",
          reasoning: "no_deterministic_route_applied",
          resolved_model: "gpt-4o",
          resolved_provider: "openai",
          prompt_hash: "abc123def456789012345678901234567890123456789012345678901234abcd",
          prompt_version: "cf-v13",
        },
      }),
      toolResult: makeToolResult(),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope._route_metadata).toBeDefined();
    expect(envelope._route_metadata!.prompt_hash).toBe("abc123def456789012345678901234567890123456789012345678901234abcd");
    expect(envelope._route_metadata!.prompt_version).toBe("cf-v13");
  });

  it("P0-3: prompt_hash absent when llmResult carries no route_metadata", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    // No base route_metadata — _route_metadata still present with features-only
    expect(envelope._route_metadata).toBeDefined();
    expect(envelope._route_metadata!.features).toBeDefined();
  });

  it("guidance_items survives JSON serialisation round-trip", () => {
    const guidanceItem = {
      item_id: 'gi_abc123',
      signal_code: 'DEFAULT_EDGE_STRENGTH',
      category: 'should_fix' as const,
      source: 'structural' as const,
      title: 'Default edge strength',
      primary_action: { type: 'discuss' as const, prompt: 'Review edge strengths' },
      priority: 70,
    };
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult({ guidance_items: [guidanceItem] }),
      progressKind: 'none',
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    const serialised = JSON.stringify(envelope);
    const parsed = JSON.parse(serialised) as typeof envelope;
    expect(parsed.guidance_items).toHaveLength(1);
    expect(parsed.guidance_items[0].item_id).toBe('gi_abc123');
    expect(parsed.guidance_items[0].signal_code).toBe('DEFAULT_EDGE_STRENGTH');
  });

  it("guidance_items defaults to empty array when not provided", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      progressKind: 'none',
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.guidance_items).toEqual([]);
  });

  it("includes analysis_response in the final V2 envelope when a tool produced analysis", () => {
    const analysisResponse = {
      analysis_status: "completed",
      meta: { response_hash: "analysis-hash", seed_used: 7, n_samples: 1000 },
      results: [],
      response_hash: "analysis-hash",
    };
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult({ analysis_response: analysisResponse as any }),
      progressKind: "ran_analysis",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.analysis_response).toEqual(analysisResponse);
    expect(envelope.lineage.response_hash).toBe("analysis-hash");
  });

  it("lineage.dsk_version_hash is null when ENABLE_DSK_V0 is OFF", () => {
    // config mock already has dskV0: false and getDskVersionHash returns null
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext({ dsk: { claims: [], triggers: [], techniques: [], version_hash: null } }),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      progressKind: 'none',
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.lineage.dsk_version_hash).toBeNull();
  });

  it("lineage.dsk_version_hash is populated from loaded bundle when ENABLE_DSK_V0 is ON", async () => {
    // Re-mock config with dskV0: true and dsk-loader returning a bundle hash.
    // We use vi.doMock + re-import for dynamic override within this test.
    vi.doMock("../../../../src/config/index.js", () => ({
      isProduction: () => false,
      config: { features: { orchestratorV2: false, dskV0: true } },
    }));
    vi.doMock("../../../../src/orchestrator/dsk-loader.js", () => ({
      getDskVersionHash: () => 'test-bundle-hash-abc123',
      resolveDskHash: () => 'test-bundle-hash-abc123',
    }));

    const modulePath = "../../../../src/orchestrator/pipeline/phase5-validation/envelope-assembler.js?dsk-on";
    const { assembleV2Envelope: assemble } = await import(modulePath);

    const envelope = assemble({
      enrichedContext: makeEnrichedContext({ dsk: { claims: [], triggers: [], techniques: [], version_hash: null } }),
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      progressKind: 'none',
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    expect(envelope.lineage.dsk_version_hash).toBe('test-bundle-hash-abc123');

    vi.doUnmock("../../../../src/config/index.js");
    vi.doUnmock("../../../../src/orchestrator/dsk-loader.js");
  });
  // ==========================================================================
  // analysis_ready contract tests
  // ==========================================================================

  describe("analysis_ready", () => {
    /** Minimal graph with goal + 2 options + edges — enough for "ready" status */
    function makeReadyGraph() {
      return {
        nodes: [
          { id: "goal-1", kind: "goal" as const, label: "Maximise ROI" },
          { id: "opt-a", kind: "option" as const, label: "Option A", interventions: { "f-1": 0.5 } },
          { id: "opt-b", kind: "option" as const, label: "Option B", interventions: { "f-1": 0.8 } },
          { id: "factor-1", kind: "factor" as const, label: "Revenue" },
        ],
        edges: [
          { id: "e1", from: "opt-a", to: "factor-1" },
          { id: "e2", from: "opt-b", to: "factor-1" },
          { id: "e3", from: "factor-1", to: "goal-1" },
        ],
      } as unknown as import("../../../../src/schemas/cee-v3.js").GraphV3T;
    }

    it("includes analysis_ready with status and options after draft_graph (graph in context)", () => {
      const envelope = assembleV2Envelope({
        enrichedContext: makeEnrichedContext({ graph: makeReadyGraph() }),
        specialistResult: makeSpecialistResult(),
        llmResult: makeLLMResult(),
        toolResult: makeToolResult(),
        progressKind: "changed_model",
        stageTransition: null,
        scienceLedger: makeScienceLedger(),
      });

      expect(envelope.analysis_ready).toBeDefined();
      expect(envelope.analysis_ready!.status).toBe("ready");
      expect(envelope.analysis_ready!.goal_node_id).toBe("goal-1");
      expect(envelope.analysis_ready!.options).toHaveLength(2);
      expect(envelope.analysis_ready!.options[0]).toHaveProperty("option_id");
      expect(envelope.analysis_ready!.options[0]).toHaveProperty("label");
      expect(envelope.analysis_ready!.options[0]).toHaveProperty("status");
      expect(envelope.analysis_ready!.options[0]).toHaveProperty("interventions");
    });

    it("includes updated analysis_ready after edit_graph (applied_graph in block)", () => {
      const updatedGraph = makeReadyGraph();
      const blocks = [
        {
          block_id: "blk-1",
          block_type: "graph_patch" as const,
          data: {
            patch_type: "edit" as const,
            operations: [],
            status: "proposed" as const,
            applied_graph: updatedGraph,
          },
          provenance: { source: "edit_graph" as const },
        },
      ];
      const envelope = assembleV2Envelope({
        enrichedContext: makeEnrichedContext({ graph: null }),
        specialistResult: makeSpecialistResult(),
        llmResult: makeLLMResult(),
        toolResult: makeToolResult({ blocks: blocks as any }),
        progressKind: "changed_model",
        stageTransition: null,
        scienceLedger: makeScienceLedger(),
      });

      expect(envelope.analysis_ready).toBeDefined();
      expect(envelope.analysis_ready!.status).toBe("ready");
      expect(envelope.analysis_ready!.options).toHaveLength(2);
    });

    it("includes envelope-level analysis_ready and model_receipt for full_draft blocks that carry applied_graph", () => {
      const draftedGraph = makeReadyGraph();
      const blocks = [
        {
          block_id: "blk-draft-1",
          block_type: "graph_patch" as const,
          data: {
            patch_type: "full_draft" as const,
            operations: [],
            status: "proposed" as const,
            auto_apply: true,
            applied_graph: draftedGraph,
            summary: "Option A currently looks strongest.",
          },
          provenance: { trigger: "tool:draft_graph", turn_id: "turn-1", timestamp: new Date().toISOString() },
        },
      ];

      const envelope = assembleV2Envelope({
        enrichedContext: makeEnrichedContext({ graph: null }),
        specialistResult: makeSpecialistResult(),
        llmResult: makeLLMResult({
          tool_invocations: [{ name: "draft_graph", input: { brief: "Build a model" }, id: "deterministic" }],
        }),
        toolResult: makeToolResult({ blocks: blocks as any }),
        progressKind: "changed_model",
        stageTransition: null,
        scienceLedger: makeScienceLedger(),
      });

      expect(envelope.analysis_ready).toBeDefined();
      expect(envelope.analysis_ready!.status).toBe("ready");
      expect(envelope.model_receipt).toEqual({
        node_count: 4,
        edge_count: 3,
        option_labels: ["Option A", "Option B"],
        goal_label: "Maximise ROI",
        top_insight: "Option A currently looks strongest.",
        readiness_status: "ready",
        repairs_applied_count: 0,
      });
    });

    it("analysis_ready is absent when no graph exists", () => {
      const envelope = assembleV2Envelope({
        enrichedContext: makeEnrichedContext({ graph: null }),
        specialistResult: makeSpecialistResult(),
        llmResult: makeLLMResult(),
        toolResult: makeToolResult(),
        progressKind: "none",
        stageTransition: null,
        scienceLedger: makeScienceLedger(),
      });

      expect(envelope.analysis_ready).toBeUndefined();
    });

    it("canonical fixture shape for cross-service testing", () => {
      const envelope = assembleV2Envelope({
        enrichedContext: makeEnrichedContext({ graph: makeReadyGraph() }),
        specialistResult: makeSpecialistResult(),
        llmResult: makeLLMResult(),
        toolResult: makeToolResult(),
        progressKind: "changed_model",
        stageTransition: null,
        scienceLedger: makeScienceLedger(),
      });

      const ar = envelope.analysis_ready!;
      expect(ar).toEqual(
        expect.objectContaining({
          status: expect.any(String),
          goal_node_id: expect.any(String),
          options: expect.arrayContaining([
            expect.objectContaining({
              option_id: expect.any(String),
              label: expect.any(String),
              status: expect.any(String),
              interventions: expect.any(Object),
            }),
          ]),
        }),
      );

      // Field name is exactly "analysis_ready" — not "readiness" or "analysis_readiness"
      expect(envelope).toHaveProperty("analysis_ready");
      expect(envelope).not.toHaveProperty("readiness");
      expect(envelope).not.toHaveProperty("analysis_readiness");
    });
  });
}); // assembleV2Envelope

describe("buildErrorEnvelope", () => {
  it("returns envelope with error field and safe defaults", () => {
    const envelope = buildErrorEnvelope("err-turn", "PIPELINE_ERROR", "Something broke");

    expect(envelope.turn_id).toBe("err-turn");
    expect(envelope.error).toEqual({ code: "PIPELINE_ERROR", message: "Something broke" });
    expect(envelope.assistant_text).toBe("I ran into a problem processing that. Could you try again?");
    expect(envelope.blocks).toEqual([]);
    expect(envelope.suggested_actions).toEqual([]);
    expect(envelope.lineage.context_hash).toBe("");
    expect(envelope.lineage.dsk_version_hash).toBeNull();
    expect(envelope.science_ledger.claims_used).toEqual([]);
    expect(envelope.progress_marker.kind).toBe("none");
    expect(envelope.observability.triggers_fired).toEqual([]);
    expect(envelope.turn_plan.selected_tool).toBeNull();
    expect(envelope.stage_indicator.stage).toBe("frame");
    expect(envelope.stage_indicator.confidence).toBe("low");
  });

  it("uses enriched context for hash and stage when available", () => {
    const ctx = makeEnrichedContext({
      stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" },
    });
    const envelope = buildErrorEnvelope("err-turn", "PIPELINE_ERROR", "fail", ctx);

    expect(envelope.lineage.context_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.stage_indicator.stage).toBe("evaluate");
    expect(envelope.observability.intent_classification).toBe("conversational");
  });

  // Task 1 new tests: three-tier hash rule

  it("buildErrorEnvelope without enrichedContext → lineage.context_hash is ''", () => {
    const envelope = buildErrorEnvelope("err-turn", "PIPELINE_ERROR", "fail");
    expect(envelope.lineage.context_hash).toBe('');
  });

  it("normal and error envelope produce identical context_hash for same enriched context", () => {
    const ctx = makeEnrichedContext();

    const normalEnvelope = assembleV2Envelope({
      enrichedContext: ctx,
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });

    const errorEnvelope = buildErrorEnvelope("err-turn", "PIPELINE_ERROR", "fail", ctx);

    expect(normalEnvelope.lineage.context_hash).toBe(errorEnvelope.lineage.context_hash);
  });

  it("uses pre-computed context_hash from Phase 1 when present (tier-1 of three-tier rule)", () => {
    const precomputedHash = 'a'.repeat(64);
    const ctx = makeEnrichedContext({ context_hash: precomputedHash });

    const errorEnvelope = buildErrorEnvelope("err-turn", "PIPELINE_ERROR", "fail", ctx);
    expect(errorEnvelope.lineage.context_hash).toBe(precomputedHash);

    const normalEnvelope = assembleV2Envelope({
      enrichedContext: ctx,
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    });
    expect(normalEnvelope.lineage.context_hash).toBe(precomputedHash);
  });

  it("snapshot: context_hash value is stable across envelope types (locks hash algorithm)", () => {
    // Fixed context: no graph, no analysis, no framing, messages [], selected_elements [].
    // scenario_id is excluded from the canonical hash per context-hash.ts spec.
    // If this snapshot breaks, the canonicalisation rules or hash version changed —
    // increment HASH_VERSION in context/context-hash.ts and update this snapshot.
    const ctx = makeEnrichedContext({ scenario_id: "snap-scenario" });

    const normalHash = assembleV2Envelope({
      enrichedContext: ctx,
      specialistResult: makeSpecialistResult(),
      llmResult: makeLLMResult(),
      toolResult: makeToolResult(),
      progressKind: "none",
      stageTransition: null,
      scienceLedger: makeScienceLedger(),
    }).lineage.context_hash;

    const errorHash = buildErrorEnvelope("snap-turn", "ERR", "msg", ctx).lineage.context_hash;

    // Both envelopes produce the same hash
    expect(normalHash).toBe(errorHash);
    // Inline snapshot — locks the exact hash value
    expect({ normalHash, errorHash }).toMatchInlineSnapshot(`
      {
        "errorHash": "5d7adcb32559636faec6c6c2ac6d45faef469a58cd8df2800d2e55b3e43ae22a",
        "normalHash": "5d7adcb32559636faec6c6c2ac6d45faef469a58cd8df2800d2e55b3e43ae22a",
      }
    `);
  });
});
