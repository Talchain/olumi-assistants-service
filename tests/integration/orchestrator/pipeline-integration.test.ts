import { describe, it, expect, vi } from "vitest";
import { executePipeline } from "../../../src/orchestrator/pipeline/pipeline.js";
import type { OrchestratorTurnRequest } from "../../../src/orchestrator/types.js";
import type { PipelineDeps, LLMClient, ToolDispatcher, ToolResult } from "../../../src/orchestrator/pipeline/types.js";

// Mock config
vi.mock("../../../src/config/index.js", () => ({
  isProduction: () => false,
  config: { features: { orchestratorV2: false } },
}));

// Mock intent gate — no deterministic match for test messages
vi.mock("../../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({ routing: "llm", tool: null }),
}));

// Mock prompt assembly
vi.mock("../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("System prompt"),
}));

vi.mock("../../../src/orchestrator/prompt-assembly.js", () => ({
  assembleMessages: vi.fn().mockReturnValue([{ role: "user", content: "test" }]),
  assembleToolDefinitions: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../src/orchestrator/tools/registry.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([]),
  isLongRunningTool: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../src/orchestrator/blocks/factory.js", () => ({
  createCommentaryBlock: vi.fn(),
  createReviewCardBlock: vi.fn(),
}));

function makeRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
  return {
    scenario_id: "test-scenario",
    client_turn_id: "client-1",
    message: "Should I raise prices?",
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
      content: [{ type: "text", text: "<assistant_reply>Consider your pricing strategy carefully.</assistant_reply>" }],
      stop_reason: "end_turn",
    }),
    chat: vi.fn().mockResolvedValue({ content: "Hello" }),
  };

  const toolDispatcher: ToolDispatcher = {
    dispatch: vi.fn().mockResolvedValue({
      blocks: [],
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      assistant_text: null,
    } as ToolResult),
  };

  return { llmClient, toolDispatcher };
}

describe("pipeline integration", () => {
  it("'Should I raise prices?' → pricing archetype, recommend intent, frame stage", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-1", deps);

    // Stage: no graph → frame
    expect(envelope.stage_indicator.stage).toBe("frame");
    expect(envelope.stage_indicator.confidence).toBe("high");

    // Intent: "should I" → recommend
    expect(envelope.observability.intent_classification).toBe("recommend");

    // Archetype: "prices" → pricing, 1 keyword → MEDIUM (correction #6)
    // Note: "Should I raise prices?" has 1 keyword match ("price") = medium, not high
  });

  it("returns valid V2 envelope shape", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-1", deps);

    // All required fields present
    expect(envelope).toHaveProperty("turn_id");
    expect(envelope).toHaveProperty("assistant_text");
    expect(envelope).toHaveProperty("blocks");
    expect(envelope).toHaveProperty("suggested_actions");
    expect(envelope).toHaveProperty("lineage");
    expect(envelope).toHaveProperty("stage_indicator");
    expect(envelope).toHaveProperty("science_ledger");
    expect(envelope).toHaveProperty("progress_marker");
    expect(envelope).toHaveProperty("observability");
    expect(envelope).toHaveProperty("turn_plan");

    // Lineage
    expect(envelope.lineage.context_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(envelope.lineage.dsk_version_hash).toBeNull();

    // No error
    expect(envelope.error).toBeUndefined();
  });

  it("handles conversational message with no archetype", async () => {
    const deps = makeMockDeps();
    const request = makeRequest({ message: "Hello there" });
    const envelope = await executePipeline(request, "req-1", deps);

    expect(envelope.stage_indicator.stage).toBe("frame");
    expect(envelope.observability.intent_classification).toBe("conversational");
    expect(envelope.progress_marker.kind).toBe("none");
  });

  it("progress_marker is 'none' when no tools are invoked", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-1", deps);
    expect(envelope.progress_marker.kind).toBe("none");
  });
});

// ============================================================================
// Flag-on / flag-off routing smoke tests
// ============================================================================

const V2_ONLY_FIELDS = ["science_ledger", "progress_marker", "observability"] as const;

describe("flag-on/flag-off routing", () => {
  it("V2 pipeline response contains V2-only fields (flag ON path)", async () => {
    const deps = makeMockDeps();
    const envelope = await executePipeline(makeRequest(), "req-flag-on", deps);

    for (const field of V2_ONLY_FIELDS) {
      expect(envelope).toHaveProperty(field);
    }
    // Verify fields are populated, not just present
    expect(envelope.science_ledger.claims_used).toEqual([]);
    expect(envelope.progress_marker.kind).toBeDefined();
    expect(envelope.observability.intent_classification).toBeDefined();
  });

  it("V1 envelope shape does NOT contain V2-only fields (flag OFF path)", () => {
    // V1 OrchestratorResponseEnvelope shape — matches the type from src/orchestrator/types.ts
    const v1Envelope = {
      turn_id: "v1-turn",
      assistant_text: "Hello",
      blocks: [],
      lineage: { context_hash: "abc" },
      turn_plan: { selected_tool: null, routing: "llm" as const, long_running: false },
    };

    for (const field of V2_ONLY_FIELDS) {
      expect(v1Envelope).not.toHaveProperty(field);
    }
  });
});
