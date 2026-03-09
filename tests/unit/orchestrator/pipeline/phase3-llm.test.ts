import { describe, it, expect, vi, beforeEach } from "vitest";
import { phase3Generate } from "../../../../src/orchestrator/pipeline/phase3-llm/index.js";
import { buildDeterministicLLMResult, parseV2Response } from "../../../../src/orchestrator/pipeline/phase3-llm/response-parser.js";
import type { EnrichedContext, SpecialistResult, LLMClient } from "../../../../src/orchestrator/pipeline/types.js";
import type { ChatWithToolsResult } from "../../../../src/adapters/llm/types.js";

// Mock intent gate — control deterministic routing
vi.mock("../../../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({ routing: "llm", tool: null }),
}));

// Mock prompt assembly
vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("System prompt"),
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
  beforeEach(() => {
    vi.clearAllMocks();
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
      // Provide graph so run_analysis prerequisites pass; use evaluate stage where run_analysis is allowed
      const ctx = makeEnrichedContext({
        graph: { nodes: [], edges: [], options: [] } as unknown as EnrichedContext["graph"],
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
        "draft a graph for me",
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
