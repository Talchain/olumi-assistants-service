import { describe, it, expect, vi, beforeEach } from "vitest";
import { phase3Generate } from "../../../../src/orchestrator/pipeline/phase3-llm/index.js";
import { buildDeterministicLLMResult, parseV2Response } from "../../../../src/orchestrator/pipeline/phase3-llm/response-parser.js";
import type { EnrichedContext, SpecialistResult, LLMClient } from "../../../../src/orchestrator/pipeline/types.js";
import type { ChatWithToolsResult } from "../../../../src/adapters/llm/types.js";
import { log } from "../../../../src/utils/telemetry.js";

// Mock intent gate — control deterministic routing
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
  assembleMessages: vi.fn().mockReturnValue([{ role: "user", content: "hi" }]),
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

function makeSpecialistResult(): SpecialistResult {
  return { advice: null, candidates: [], triggers_fired: [], triggers_suppressed: [] };
}

function makeMockLLMClient(): LLMClient {
  return {
    chatWithTools: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "<assistant_reply>Hello</assistant_reply>" }],
      stop_reason: "end_turn",
    }),
    chat: vi.fn().mockResolvedValue({ content: "Hello from chat" }),
  };
}

describe("phase3-llm", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({ routing: "llm", tool: null });
  });

  describe("buildDeterministicLLMResult", () => {
    it("builds LLMResult with deterministic id", () => {
      const result = buildDeterministicLLMResult("run_analysis", { seed: 42 });
      expect(result.tool_invocations).toHaveLength(1);
      expect(result.tool_invocations[0].id).toBe("deterministic");
      expect(result.tool_invocations[0].name).toBe("run_analysis");
      expect(result.tool_invocations[0].input).toEqual({ seed: 42 });
      expect(result.assistant_text).toBeNull();
      expect(result.science_annotations).toEqual([]);
      expect(result.diagnostics).toBeNull();
    });
  });

  describe("phase3Generate", () => {
    it("calls LLM when intent gate returns llm routing", async () => {
      const client = makeMockLLMClient();
      const result = await phase3Generate(
        makeEnrichedContext(),
        makeSpecialistResult(),
        client,
        "req-1",
        "Hello there",
      );

      expect(client.chatWithTools).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.science_annotations).toEqual([]);
    });

    it("returns deterministic result when intent gate matches and prerequisites met", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "run_analysis",
        confidence: "exact",
        matched_pattern: "run analysis",
      });

      const client = makeMockLLMClient();
      // Provide graph + analysis_inputs so run_analysis prerequisites pass; use evaluate stage where run_analysis is allowed
      const ctx = makeEnrichedContext({
        graph: { nodes: [], edges: [], options: [] } as unknown as EnrichedContext["graph"],
        analysis_inputs: {
          options: [
            { option_id: "opt_a", label: "Option A", interventions: { fac_1: { value: 1 } } },
            { option_id: "opt_b", label: "Option B", interventions: { fac_1: { value: -1 } } },
          ],
        },
        stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" },
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-1",
        "run analysis",
      );

      // Should NOT call LLM
      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations[0].id).toBe("deterministic");
      expect(result.tool_invocations[0].name).toBe("run_analysis");
    });

    it("propagates tool_use block through phase3Generate entrypoint", async () => {
      // Mock chatWithTools to return a tool_use block (not just text)
      const client = makeMockLLMClient();
      (client.chatWithTools as ReturnType<typeof vi.fn>).mockResolvedValue({
        content: [
          { type: "tool_use", id: "call_xyz", name: "draft_graph", input: { brief: "build a model" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 20, output_tokens: 10 },
        model: "gpt-4o",
        latencyMs: 80,
      });

      const result = await phase3Generate(
        makeEnrichedContext(),
        makeSpecialistResult(),
        client,
        "req-1",
        "hello there",
      );

      expect(client.chatWithTools).toHaveBeenCalled();
      expect(result.tool_invocations).toHaveLength(1);
      expect(result.tool_invocations[0].name).toBe("draft_graph");
      expect(result.tool_invocations[0].input).toEqual({ brief: "build a model" });
      expect(result.assistant_text).toBeNull();
    });

    it("falls back to LLM when stage policy blocks deterministic tool", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "run_analysis",
        confidence: "exact",
        matched_pattern: "run analysis",
      });

      const client = makeMockLLMClient();
      // Provide graph so prerequisites pass, but set stage to FRAME where run_analysis is blocked
      const ctx = makeEnrichedContext({
        graph: { nodes: [], edges: [], options: [] } as unknown as EnrichedContext["graph"],
        stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
      });

      await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-1",
        "run analysis",
      );

      // Should fall back to LLM — stage policy blocks run_analysis in FRAME
      expect(client.chatWithTools).toHaveBeenCalled();
    });

    it("falls back to LLM when research_topic lacks intent in FRAME", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "research_topic",
        confidence: "prefix",
        matched_pattern: "research",
        research_query: "pricing",
      });

      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
      });

      await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-1",
        "What about competitor pricing?", // No explicit research intent
      );

      // Should fall back to LLM — research_topic requires explicit intent in FRAME
      expect(client.chatWithTools).toHaveBeenCalled();
    });

    it("falls back to LLM when prerequisites not met", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "run_analysis",
        confidence: "exact",
        matched_pattern: "run analysis",
      });

      const client = makeMockLLMClient();
      // No graph → run_analysis prerequisites NOT met
      const ctx = makeEnrichedContext({ graph: null });

      await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-1",
        "run analysis",
      );

      // Should fall back to LLM
      expect(client.chatWithTools).toHaveBeenCalled();
    });

    it("prefers explain_results in evaluate for explanation follow-up even after prior failed edit context", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "edit_graph",
        confidence: "exact",
        matched_pattern: "change",
      });

      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" },
        analysis: {
          analysis_status: "completed",
          results: [{ option_label: "Option A", win_probability: 0.7 }],
          meta: { response_hash: "hash-a" },
          response_hash: "hash-a",
        } as unknown as EnrichedContext["analysis"],
        graph: { nodes: [{ id: "n1", kind: "factor", label: "Demand" }], edges: [] } as unknown as EnrichedContext["graph"],
        conversation_history: [
          { role: "user", content: "Change" },
          { role: "assistant", content: "I couldn't apply that edit safely." },
        ] as EnrichedContext["conversation_history"],
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-1",
        "Why was this recommended?",
      );

      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations).toHaveLength(1);
      expect(result.tool_invocations[0].name).toBe("explain_results");
    });

    it("keeps genuine edit requests routed to edit_graph in evaluate after analysis", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "edit_graph",
        confidence: "exact",
        matched_pattern: "change",
      });

      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" },
        analysis: {
          analysis_status: "completed",
          results: [{ option_label: "Option A", win_probability: 0.7 }],
          meta: { response_hash: "hash-b" },
          response_hash: "hash-b",
        } as unknown as EnrichedContext["analysis"],
        graph: { nodes: [{ id: "n1", kind: "factor", label: "Demand" }], edges: [] } as unknown as EnrichedContext["graph"],
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-2",
        "Change the model",
      );

      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations).toHaveLength(1);
      expect(result.tool_invocations[0].name).toBe("edit_graph");
    });

    it("uses rationale_explanation before analysis exists instead of explain_results", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "edit_graph",
        confidence: "exact",
        matched_pattern: "change",
      });

      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        analysis: null,
        graph: { nodes: [{ id: "n1", kind: "factor", label: "Demand" }], edges: [] } as unknown as EnrichedContext["graph"],
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-3",
        "Why",
      );

      expect(client.chat).toHaveBeenCalled();
      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations).toHaveLength(0);
      expect(result.route_metadata?.outcome).toBe("rationale_explanation");
    });

    it("uses rationale_explanation before explainable analysis exists", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "explain_results",
        confidence: "exact",
        matched_pattern: "why",
      });

      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        analysis: null,
        graph: { nodes: [{ id: "n1", kind: "factor", label: "Demand" }], edges: [] } as unknown as EnrichedContext["graph"],
        framing: { goal: "Maximise growth" } as EnrichedContext["framing"],
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-rationale",
        "Why is this the current recommendation?",
      );

      expect(client.chat).toHaveBeenCalled();
      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations).toHaveLength(0);
      expect(result.route_metadata).toEqual({
        outcome: "rationale_explanation",
        reasoning: "analysis_not_current_or_not_explainable",
      });
      expect(result.route_debug?.explain_results_selection.explanation_path).toBe("rationale_explanation");
      expect(result.route_debug?.explain_results_selection.reason).toBe("analysis_not_current_or_not_explainable");
    });

    it("resumes pending clarification follow-up into deterministic edit_graph when user replies with an exact visible label", async () => {
      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        graph: {
          nodes: [
            { id: "f1", kind: "factor", label: "Onboarding Time" },
            { id: "f2", kind: "factor", label: "Hiring Delay" },
          ],
          edges: [],
        } as unknown as EnrichedContext["graph"],
        conversational_state: {
          active_entities: [],
          stated_constraints: [],
          current_topic: "editing",
          last_failed_action: null,
          pending_clarification: {
            tool: "edit_graph",
            original_edit_request: "Reduce it by 10%",
            candidate_labels: ["Onboarding Time", "Hiring Delay"],
          },
        },
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-clarify",
        "Onboarding Time",
      );

      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations).toHaveLength(1);
      expect(result.tool_invocations[0].name).toBe("edit_graph");
      expect(result.tool_invocations[0].input).toEqual({
        edit_description: "Reduce it by 10% for Onboarding Time",
      });
      expect(result.route_metadata).toEqual({
        outcome: "clarification_continuation",
        reasoning: "resolved_from_pending_clarification",
      });
      expect(result.route_debug?.clarification_continuation).toEqual({
        present: true,
        grouped: false,
      });
    });

    it("resumes clarification with lowercase user reply (normalised match)", async () => {
      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        graph: {
          nodes: [
            { id: "f1", kind: "factor", label: "Onboarding Time" },
            { id: "f2", kind: "factor", label: "Hiring Delay" },
          ],
          edges: [],
        } as unknown as EnrichedContext["graph"],
        conversational_state: {
          active_entities: [],
          stated_constraints: [],
          current_topic: "editing",
          last_failed_action: null,
          pending_clarification: {
            tool: "edit_graph",
            original_edit_request: "Reduce it by 10%",
            candidate_labels: ["Onboarding Time", "Hiring Delay"],
          },
        },
      });

      // User replies with different capitalisation — should still match
      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-clarify-lower",
        "onboarding time",
      );

      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations[0].name).toBe("edit_graph");
      // Preserved label must use the original casing from candidate_labels
      expect(result.tool_invocations[0].input).toEqual({
        edit_description: "Reduce it by 10% for Onboarding Time",
      });
    });

    it("resumes clarification from a short realistic carried-state reply", async () => {
      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        graph: {
          nodes: [
            { id: "f1", kind: "factor", label: "Onboarding Time" },
            { id: "f2", kind: "factor", label: "Hiring Delay" },
          ],
          edges: [],
        } as unknown as EnrichedContext["graph"],
        conversational_state: {
          active_entities: [],
          stated_constraints: [],
          current_topic: "editing",
          last_failed_action: null,
          pending_clarification: {
            tool: "edit_graph",
            original_edit_request: "Reduce it by 10%",
            candidate_labels: ["Onboarding Time", "Hiring Delay"],
          },
        },
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-clarify-short",
        "onboarding",
      );

      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations[0].name).toBe("edit_graph");
      expect(result.tool_invocations[0].input).toEqual({
        edit_description: "Reduce it by 10% for Onboarding Time",
      });
      expect(result.route_metadata?.outcome).toBe("clarification_continuation");
    });

    it("supports bounded grouped clarification continuation for explicit all-three replies", async () => {
      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        graph: {
          nodes: [
            { id: "o1", kind: "option", label: "Option A" },
            { id: "o2", kind: "option", label: "Option B" },
            { id: "o3", kind: "option", label: "Option C" },
          ],
          edges: [],
        } as unknown as EnrichedContext["graph"],
        conversational_state: {
          active_entities: [],
          stated_constraints: [],
          current_topic: "configuring",
          last_failed_action: null,
          pending_clarification: {
            tool: "edit_graph",
            original_edit_request: "Raise the budget",
            candidate_labels: ["Option A", "Option B", "Option C"],
          },
        },
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-clarify-grouped",
        "all three",
      );

      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations[0]).toEqual({
        id: "deterministic",
        name: "edit_graph",
        input: {
          edit_description: "Raise the budget",
          grouped_target_labels: ["Option A", "Option B", "Option C"],
        },
      });
      expect(result.route_debug?.clarification_continuation).toEqual({
        present: true,
        grouped: true,
      });
    });

    it("confirms a pending proposal deterministically", async () => {
      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        graph: {
          nodes: [{ id: "o1", kind: "option", label: "Option A" }],
          edges: [],
        } as unknown as EnrichedContext["graph"],
        conversational_state: {
          active_entities: [],
          stated_constraints: [],
          current_topic: "editing",
          last_failed_action: null,
          pending_proposal: {
            tool: "edit_graph",
            original_edit_request: "Update Option A",
            // SHA-256 of JSON.stringify({ nodes: [{ id: "o1", kind: "option", label: "Option A" }], edges: [] })
            // Must match computeGraphHash in edit-graph.ts (16-char SHA-256 hex).
            base_graph_hash: "c21e935fc93c86d8",
            candidate_labels: ["Option A"],
            proposed_changes: {
              changes: [
                { description: "Update Option A", element_label: "Option A", action_type: "option_config" },
              ],
            },
          },
        },
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-proposal-confirm",
        "yes, apply it",
      );

      expect(result.tool_invocations[0]).toEqual({
        id: "deterministic",
        name: "edit_graph",
        input: {
          edit_description: "Update Option A",
          confirmation_mode: "apply_pending_proposal",
          pending_proposal: {
            tool: "edit_graph",
            original_edit_request: "Update Option A",
            base_graph_hash: "c21e935fc93c86d8",
            candidate_labels: ["Option A"],
            proposed_changes: {
              changes: [
                { description: "Update Option A", element_label: "Option A", action_type: "option_config" },
              ],
            },
          },
        },
      });
      expect(result.route_metadata).toEqual({
        outcome: "proposal_confirmation",
        reasoning: "confirmed_pending_proposal",
      });
      expect(result.route_debug?.pending_proposal_followup).toEqual({
        present: true,
        action: "confirm",
      });
    });

    it("records explicit generate override reason when deterministic draft_graph is used", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "llm",
        tool: null,
        confidence: "medium",
        matched_pattern: null,
      });

      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
        framing: {
          goal: "Increase activation",
          options: ["Option A", "Option B"],
          constraints: ["Budget"],
        } as EnrichedContext["framing"],
        conversation_history: [
          { role: "user", content: "We need to compare two launch options with a budget constraint." },
        ] as EnrichedContext["conversation_history"],
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-explicit-generate",
        "Build a model for this decision",
      );

      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations[0].name).toBe("draft_graph");
      expect(result.route_metadata).toEqual({
        outcome: "explicit_generate",
        reasoning: "explicit_generate_with_sufficient_context",
      });
      expect(result.route_debug?.explicit_generate_override).toEqual({
        considered: true,
        applied: true,
        reason: "explicit_generate_with_sufficient_context",
      });
      expect(result.route_debug?.draft_graph_selection).toEqual({
        considered: true,
        selected: true,
        reason: "explicit_generate_with_sufficient_context",
      });
    });

    it("dismisses a pending proposal without calling tools", async () => {
      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        conversational_state: {
          active_entities: [],
          stated_constraints: [],
          current_topic: "editing",
          last_failed_action: null,
          pending_proposal: {
            tool: "edit_graph",
            original_edit_request: "Update Option A",
            base_graph_hash: "abc123",
            candidate_labels: ["Option A"],
            proposed_changes: {
              changes: [
                { description: "Update Option A", element_label: "Option A", action_type: "option_config" },
              ],
            },
          },
        },
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-proposal-dismiss",
        "no, leave it",
      );

      expect(result.tool_invocations).toHaveLength(0);
      expect(result.assistant_text).toBe("Okay — I won’t apply that change.");
      expect(client.chatWithTools).not.toHaveBeenCalled();
    });

    it("marks stale pending proposals as truthfully dismissed", async () => {
      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        graph: {
          nodes: [{ id: "o2", kind: "option", label: "Option B" }],
          edges: [],
        } as unknown as EnrichedContext["graph"],
        conversational_state: {
          active_entities: [],
          stated_constraints: [],
          current_topic: "editing",
          last_failed_action: null,
          pending_proposal: {
            tool: "edit_graph",
            original_edit_request: "Update Option A",
            base_graph_hash: "stale-hash",
            candidate_labels: ["Option A"],
            proposed_changes: {
              changes: [
                { description: "Update Option A", element_label: "Option A", action_type: "option_config" },
              ],
            },
          },
        },
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-proposal-stale",
        "apply it",
      );

      expect(result.tool_invocations).toHaveLength(0);
      expect(result.route_metadata).toEqual({
        outcome: "proposal_stale_dismissal",
        reasoning: "pending_proposal_invalidated_by_graph_change",
      });
      expect(result.route_debug?.pending_proposal_followup).toEqual({
        present: true,
        action: "stale",
      });
    });

    it("allows narrow explicit generate override from accumulated framing context", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "draft_graph",
        confidence: "exact",
        matched_pattern: "draft graph",
      });

      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" },
        framing: {
          goal: "Choose the best launch plan",
          options: ["Launch now", "Delay"],
          constraints: ["Budget"],
        } as unknown as EnrichedContext["framing"],
        conversation_history: [
          { role: "user", content: "We need to choose between launching now or delaying." },
        ] as EnrichedContext["conversation_history"],
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-generate",
        "draft the model",
      );

      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations[0].name).toBe("draft_graph");
      expect((result.tool_invocations[0].input.brief as string)).toContain("Choose the best launch plan");
      expect(result.route_metadata).toEqual({
        outcome: "explicit_generate",
        reasoning: "explicit_generate_with_sufficient_context",
      });
    });

    it("routes explicit generate from accumulated context after a compact clarification answer", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "draft_graph",
        confidence: "exact",
        matched_pattern: "build graph",
      });

      const client = makeMockLLMClient();
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        framing: {
          goal: "Choose the best onboarding plan",
          options: ["Guided rollout", "Self-serve rollout"],
        } as unknown as EnrichedContext["framing"],
        conversation_history: [
          { role: "user", content: "I need to decide how to redesign onboarding." },
          { role: "assistant", content: "What options are you comparing?" },
          { role: "user", content: "Guided rollout versus self-serve rollout." },
        ] as EnrichedContext["conversation_history"],
      });

      const result = await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-explicit-generate-after-clarify",
        "build the graph",
      );

      expect(client.chatWithTools).not.toHaveBeenCalled();
      expect(result.tool_invocations).toHaveLength(1);
      expect(result.tool_invocations[0].name).toBe("draft_graph");
      expect(result.route_metadata).toEqual({
        outcome: "explicit_generate",
        reasoning: "explicit_generate_with_sufficient_context",
      });
      expect(result.route_debug?.draft_graph_selection).toEqual({
        considered: true,
        selected: true,
        reason: "explicit_generate_with_sufficient_context",
      });
      expect(result.tool_invocations[0].input.brief).toEqual(expect.stringContaining("Goal: Choose the best onboarding plan"));
    });

    it("returns concise blocked-generation clarification when explicit generate lacks minimum framing", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "draft_graph",
        confidence: "exact",
        matched_pattern: "draft graph",
      });

      const client = makeMockLLMClient();
      const result = await phase3Generate(
        makeEnrichedContext(),
        makeSpecialistResult(),
        client,
        "req-generate-blocked",
        "build the model",
      );

      expect(result.tool_invocations).toHaveLength(0);
      expect(result.assistant_text).toContain("I can draft it once I have");
      expect(result.route_metadata).toEqual({
        outcome: "generation_clarification",
        reasoning: "explicit_generate_missing_minimum_viable_framing",
      });
    });

    it("does not redraft an existing model unless regeneration is explicit", async () => {
      const { classifyIntent } = await import("../../../../src/orchestrator/intent-gate.js");
      (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
        routing: "deterministic",
        tool: "draft_graph",
        confidence: "exact",
        matched_pattern: "draft graph",
      });

      const client = makeMockLLMClient();
      const result = await phase3Generate(
        makeEnrichedContext({
          graph: { nodes: [{ id: "n1", kind: "factor", label: "Demand" }], edges: [] } as unknown as EnrichedContext["graph"],
          framing: { goal: "Choose the best launch plan" } as EnrichedContext["framing"],
        }),
        makeSpecialistResult(),
        client,
        "req-generate-existing",
        "draft the model",
      );

      expect(result.tool_invocations).toHaveLength(0);
      expect(result.assistant_text).toContain("You already have a model");
      expect(client.chatWithTools).not.toHaveBeenCalled();
    });

    it("falls back to LLM when user reply does not match any candidate label", async () => {
      const client = makeMockLLMClient();
      // Use graph: null so edit_graph prerequisite fails; the only path to deterministic dispatch
      // would be via clarification continuation, which must not fire for an unrecognised reply.
      const ctx = makeEnrichedContext({
        stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
        graph: null,
        conversational_state: {
          active_entities: [],
          stated_constraints: [],
          current_topic: "editing",
          last_failed_action: null,
          pending_clarification: {
            tool: "edit_graph",
            original_edit_request: "Reduce it by 10%",
            candidate_labels: ["Onboarding Time", "Hiring Delay"],
          },
        },
      });

      // User reply doesn't match either candidate label
      await phase3Generate(
        ctx,
        makeSpecialistResult(),
        client,
        "req-no-match",
        "Never mind, do something else",
      );

      // No clarification match and no other deterministic path → LLM called
      expect(client.chatWithTools).toHaveBeenCalled();
    });

    it("logs zone2_enabled from the runtime context-fabric flag", async () => {
      const originalFlag = process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED;
      process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = "1";
      const infoSpy = vi.spyOn(log, "info").mockImplementation(() => log);
      const client = makeMockLLMClient();
      let promptLog: [Record<string, unknown>, string] | undefined;

      try {
        await phase3Generate(
          makeEnrichedContext(),
          makeSpecialistResult(),
          client,
          "req-zone2",
          "Hello there",
        );
        promptLog = infoSpy.mock.calls.find((call) => call[1] === "phase3.prompt_identity") as
          | [Record<string, unknown>, string]
          | undefined;
      } finally {
        infoSpy.mockRestore();
        if (originalFlag === undefined) {
          delete process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED;
        } else {
          process.env.CEE_ORCHESTRATOR_CONTEXT_ENABLED = originalFlag;
        }
      }

      expect(promptLog).toBeDefined();
      expect(promptLog?.[0].zone2_enabled).toBe(true);
      expect(promptLog?.[0].v2_prompt_zone2_included).toBe(true);
      // context_fabric_config_enabled reads config.features.contextFabric which is itself sourced
      // from CEE_ORCHESTRATOR_CONTEXT_ENABLED — both flags reflect the same runtime source.
      expect(promptLog?.[0].context_fabric_config_enabled).toBe(true);
    });
  });

  // ============================================================================
  // chatWithTools tool_use block parsing (Part A — C.4)
  //
  // Tests mock at the adapter boundary (chatWithTools) and assert Phase 3's
  // extraction/parsing result via parseV2Response.
  //
  // The OpenAI adapter always normalises tool_use.input to Record<string, unknown>
  // (malformed JSON → {}), so these tests exercise parseV2Response with
  // production-shaped ChatWithToolsResult fixtures.
  // ============================================================================

  describe("chatWithTools tool_use parsing", () => {
    function makeToolUseResult(overrides?: Partial<ChatWithToolsResult>): ChatWithToolsResult {
      return {
        content: [],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5 },
        model: "gpt-4o",
        latencyMs: 50,
        ...overrides,
      };
    }

    it("extracts tool name and input from tool_use block; unknown extra fields ignored", () => {
      const fixture = makeToolUseResult({
        content: [
          // Extra runtime field on text block — parser must not throw or include it in output
          { type: "text", text: "Let me draft a model for you.", extra_field: true } as unknown as ChatWithToolsResult["content"][number],
          // Extra runtime field on tool_use block — parser must not throw or include it in output
          { type: "tool_use", id: "call_123", name: "draft_graph", input: { brief: "test" }, extra_field: true } as unknown as ChatWithToolsResult["content"][number],
        ],
      });

      const result = parseV2Response(fixture);

      expect(result.tool_invocations).toHaveLength(1);
      expect(result.tool_invocations[0].id).toBe("call_123");
      expect(result.tool_invocations[0].name).toBe("draft_graph");
      expect(result.tool_invocations[0].input).toEqual({ brief: "test" });
    });

    it("returns conversational response (no tool_invocations) when response is text-only", () => {
      const fixture = makeToolUseResult({
        stop_reason: "end_turn",
        content: [
          { type: "text", text: "<response><assistant_text>Here is some context.</assistant_text></response>" },
        ],
      });

      const result = parseV2Response(fixture);

      expect(result.tool_invocations).toHaveLength(0);
      expect(result.assistant_text).toBe("Here is some context.");
    });

    it("only the first tool_use block is surfaced — subsequent blocks also parsed but Phase 4 uses first", () => {
      // parseLLMResponse parses all tool_use blocks; Phase 4 dispatch uses tool_invocations[0].
      // This test locks that parseLLMResponse emits all blocks (not dropping extras).
      const fixture = makeToolUseResult({
        content: [
          { type: "tool_use", id: "call_a", name: "draft_graph", input: { brief: "first" } },
          { type: "tool_use", id: "call_b", name: "edit_graph", input: { op: "add" } },
        ],
      });

      const result = parseV2Response(fixture);

      // Parser emits all; first is the one Phase 4 will dispatch
      expect(result.tool_invocations).toHaveLength(2);
      expect(result.tool_invocations[0].name).toBe("draft_graph");
      expect(result.tool_invocations[1].name).toBe("edit_graph");
    });

    it("tool_use with runtime-invalid input (string) — parser completes without throwing, one invocation returned", () => {
      // The TypeScript type says input: Record<string,unknown> but at runtime anything can arrive.
      // The parser must not throw — it passes through whatever is in block.input.
      const fixture = makeToolUseResult({
        content: [
          { type: "tool_use", id: "call_bad_str", name: "draft_graph", input: "bad" as unknown as Record<string, unknown> },
        ],
      });

      expect(() => parseV2Response(fixture)).not.toThrow();
      const result = parseV2Response(fixture);
      expect(result.tool_invocations).toHaveLength(1);
      expect(result.tool_invocations[0].name).toBe("draft_graph");
    });

    it("tool_use with runtime-invalid input (null) — parser completes without throwing, one invocation returned", () => {
      const fixture = makeToolUseResult({
        content: [
          { type: "tool_use", id: "call_bad_null", name: "draft_graph", input: null as unknown as Record<string, unknown> },
        ],
      });

      expect(() => parseV2Response(fixture)).not.toThrow();
      const result = parseV2Response(fixture);
      expect(result.tool_invocations).toHaveLength(1);
      expect(result.tool_invocations[0].name).toBe("draft_graph");
    });

    it("tool_use naming an unknown tool is parsed without error — dispatch is responsible for rejection", () => {
      // parseLLMResponse is a pure parser: it must not validate tool names.
      // The dispatch layer (Phase 4) is responsible for rejecting unknown tools.
      const fixture = makeToolUseResult({
        content: [
          { type: "tool_use", id: "call_unk", name: "nonexistent_tool", input: { x: 1 } },
        ],
      });

      const result = parseV2Response(fixture);

      expect(result.tool_invocations).toHaveLength(1);
      expect(result.tool_invocations[0].name).toBe("nonexistent_tool");
      expect(result.tool_invocations[0].input).toEqual({ x: 1 });
    });
  });

  // ============================================================================
  // Auto-chain: intent classifier contract + dispatch chaining
  //
  // The classifier can emit 'explain' and 'recommend' (verified by phase1-intent-classifier.test.ts).
  // The dispatch auto-chain logic is covered in dispatch-chaining.test.ts.
  // These tests confirm the classifier contract that unlocks auto-chain.
  // ============================================================================

  // ============================================================================
  // P1.1: chat() fallback path — prompt_hash and prompt_version in route_metadata
  // ============================================================================

  describe("chat() fallback path — route_metadata.prompt_hash and prompt_version", () => {
    it("includes prompt_hash and prompt_version from getSystemPromptMeta when chatWithTools is absent", async () => {
      // Simulate an LLM client that only supports chat() — no chatWithTools
      const client: LLMClient = {
        chat: vi.fn().mockResolvedValue({ content: "Fallback response" }),
        // chatWithTools deliberately absent (undefined) to trigger the fallback branch
      };

      const result = await phase3Generate(
        makeEnrichedContext(),
        makeSpecialistResult(),
        client,
        "req-fallback",
        "Hello from chat fallback",
      );

      expect(result.route_metadata).toBeDefined();
      expect(result.route_metadata?.prompt_hash).toBe("test-hash");
      expect(result.route_metadata?.prompt_version).toBe("default:orchestrator");
      expect(result.route_metadata?.outcome).toBe("default_llm");
      expect(result.route_metadata?.reasoning).toBe("no_tool_support_fallback");
    });
  });

  describe("classifyUserIntent contract — values that trigger auto-chain", () => {
    it("returns 'explain' for explain-intent strings", async () => {
      const { classifyUserIntent } = await import("../../../../src/orchestrator/pipeline/phase1-enrichment/intent-classifier.js");
      expect(classifyUserIntent("explain the results")).toBe("explain");
      expect(classifyUserIntent("Why did this happen?")).toBe("explain");
    });

    it("returns 'recommend' for recommend-intent strings", async () => {
      const { classifyUserIntent } = await import("../../../../src/orchestrator/pipeline/phase1-enrichment/intent-classifier.js");
      expect(classifyUserIntent("recommend an option")).toBe("recommend");
      expect(classifyUserIntent("Which option do you recommend?")).toBe("recommend");
    });

    it("does NOT return 'explain' for action strings (auto-chain not triggered)", async () => {
      const { classifyUserIntent } = await import("../../../../src/orchestrator/pipeline/phase1-enrichment/intent-classifier.js");
      expect(classifyUserIntent("run the analysis")).not.toBe("explain");
      expect(classifyUserIntent("run the analysis")).not.toBe("recommend");
    });
  });
});
