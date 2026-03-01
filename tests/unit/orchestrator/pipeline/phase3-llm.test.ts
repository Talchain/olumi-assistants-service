import { describe, it, expect, vi, beforeEach } from "vitest";
import { phase3Generate } from "../../../../src/orchestrator/pipeline/phase3-llm/index.js";
import { buildDeterministicLLMResult } from "../../../../src/orchestrator/pipeline/phase3-llm/response-parser.js";
import type { EnrichedContext, SpecialistResult, LLMClient } from "../../../../src/orchestrator/pipeline/types.js";

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
      // Provide graph so run_analysis prerequisites pass
      const ctx = makeEnrichedContext({
        graph: { nodes: [], edges: [], options: [] } as unknown as EnrichedContext["graph"],
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
});
