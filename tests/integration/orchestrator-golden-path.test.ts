/**
 * Orchestrator Golden Path — Pipeline Robustness
 *
 * Exercises the full V2 pipeline (executePipeline) and V1 envelope assembly
 * (assembleEnvelope) with mock LLM/tool deps. No API keys required.
 *
 * Scenarios:
 *   1. FRAME conversational — chips preserved end-to-end
 *   2. V2 tool suppressed, no LLM text → stage+tool-aware fallback injected
 *   3. V2 tool suppressed, LLM text present → text preserved (no fallback)
 *   4. Multi-line chip message → newlines preserved through parse + envelope
 *   5. Malformed LLM XML → graceful degradation, no 500
 *   6. V2 unknown block_type from dispatcher → dropped, assistant_text preserved
 *   7. V2 research_topic in FRAME without explicit intent → suppressed + fallback
 *   8. V1 suppressed-tool scenario (via assembleEnvelope) → fallback injected
 *   9. V1 unknown block_type (via assembleEnvelope) → block dropped, text preserved
 */

import { describe, it, expect, vi } from "vitest";
import { executePipeline } from "../../src/orchestrator/pipeline/pipeline.js";
import { assembleEnvelope } from "../../src/orchestrator/envelope.js";
import type { OrchestratorTurnRequest } from "../../src/orchestrator/types.js";
import type {
  PipelineDeps,
  LLMClient,
  ToolDispatcher,
  ToolResult,
} from "../../src/orchestrator/pipeline/types.js";
import type { ConversationContext, ConversationBlock } from "../../src/orchestrator/types.js";
import { getStageAwareFallback } from "../../src/orchestrator/validation/stage-fallbacks.js";

// ============================================================================
// Module mocks (same pattern as pipeline-integration.test.ts)
// ============================================================================

vi.mock("../../src/config/index.js", () => ({
  isProduction: () => false,
  config: {
    features: { orchestratorV2: false, dskV0: false, zone2Registry: false, bilEnabled: false },
    cee: { clarifierEnabled: false },
  },
}));

vi.mock("../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({ routing: "llm", tool: null }),
}));

vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("System prompt"),
}));

vi.mock("../../src/orchestrator/prompt-assembly.js", () => ({
  assembleMessages: vi.fn().mockReturnValue([{ role: "user", content: "test" }]),
  assembleToolDefinitions: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/orchestrator/tools/registry.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([]),
  isLongRunningTool: vi.fn().mockImplementation((name: string) =>
    name === "draft_graph" || name === "run_analysis"
  ),
  GATE_ONLY_TOOL_NAMES: new Set<string>(),
}));

vi.mock("../../src/orchestrator/blocks/factory.js", () => ({
  createCommentaryBlock: vi.fn(),
  createReviewCardBlock: vi.fn(),
}));

// ============================================================================
// Helpers
// ============================================================================

function makeContext(overrides?: Partial<ConversationContext>): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: "test-scenario",
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<OrchestratorTurnRequest>): OrchestratorTurnRequest {
  return {
    scenario_id: "test-scenario",
    client_turn_id: "client-1",
    message: "Should I raise prices?",
    context: makeContext(),
    ...overrides,
  } as OrchestratorTurnRequest;
}

function makeLLMClient(text: string | null, toolName?: string): LLMClient {
  const content: unknown[] = [];
  if (text !== null) {
    content.push({ type: "text", text });
  }
  if (toolName) {
    content.push({ type: "tool_use", id: "toolu_1", name: toolName, input: {} });
  }
  return {
    chatWithTools: vi.fn().mockResolvedValue({
      content,
      stop_reason: toolName ? "tool_use" : "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
      model: "claude-sonnet-4-6",
      latencyMs: 100,
    }),
    chat: vi.fn(),
  };
}

function makeToolDispatcher(result?: Partial<ToolResult>): ToolDispatcher {
  return {
    dispatch: vi.fn().mockResolvedValue({
      blocks: [],
      side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      assistant_text: null,
      guidance_items: [],
      ...result,
    } as ToolResult),
  };
}

function makeMinimalBlock(block_type: string): ConversationBlock {
  return {
    block_id: "b1",
    block_type: block_type as ConversationBlock["block_type"],
    data: {} as ConversationBlock["data"],
    provenance: { trigger: "test", turn_id: "t1", timestamp: new Date().toISOString() },
  };
}

function makeDeps(llmClient: LLMClient, toolDispatcher?: ToolDispatcher): PipelineDeps {
  return {
    llmClient,
    toolDispatcher: toolDispatcher ?? makeToolDispatcher(),
  };
}

// ============================================================================
// Scenarios 1–7: V2 pipeline (executePipeline)
// ============================================================================

describe("orchestrator golden path — pipeline robustness", () => {
  // --------------------------------------------------------------------------
  // Scenario 1: FRAME conversational — chips flow through intact
  // --------------------------------------------------------------------------
  it("(1) FRAME conversational: assistant_text + 2 chips present, stage=frame", async () => {
    const xml = `<diagnostics>Mode: INTERPRET</diagnostics>
<response>
  <assistant_text>Let me help you frame this decision.</assistant_text>
  <suggested_actions>
    <action>
      <role>facilitator</role>
      <label>Set the goal</label>
      <message>What outcome are you optimising for?</message>
    </action>
    <action>
      <role>challenger</role>
      <label>Stress-test timing</label>
      <message>Is now the right time to raise prices?</message>
    </action>
  </suggested_actions>
</response>`;

    const deps = makeDeps(makeLLMClient(xml));
    const envelope = await executePipeline(makeRequest(), "req-1", deps);

    expect(envelope.stage_indicator.stage).toBe("frame");
    expect(envelope.assistant_text).toBe("Let me help you frame this decision.");
    expect(envelope.suggested_actions).toHaveLength(2);
    expect(envelope.suggested_actions[0].label).toBe("Set the goal");
    expect(envelope.suggested_actions[0].prompt).toBe("What outcome are you optimising for?");
    expect(envelope.suggested_actions[1].label).toBe("Stress-test timing");
    expect(envelope.error).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Scenario 2: V2 tool suppressed, LLM sent no text → stage+tool fallback
  // --------------------------------------------------------------------------
  it("(2) V2 tool suppressed + no LLM text → stage+tool-aware fallback injected", async () => {
    // No graph → frame stage. run_analysis is not in frame allowlist.
    const deps = makeDeps(makeLLMClient(null, "run_analysis"));
    const envelope = await executePipeline(
      makeRequest({ message: "Run the analysis now" }),
      "req-2",
      deps,
    );

    expect(envelope.assistant_text).toBeTruthy();
    expect(envelope.assistant_text).not.toBeNull();
    // Should match the stage+tool specific fallback
    const expectedFallback = getStageAwareFallback("frame", "run_analysis");
    expect(envelope.assistant_text).toBe(expectedFallback);
    expect(envelope.error).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Scenario 3: V2 tool suppressed, but LLM text present → text preserved
  // --------------------------------------------------------------------------
  it("(3) V2 tool suppressed + LLM text present → text preserved, no fallback substitution", async () => {
    const xml = `<diagnostics>Mode: ACT</diagnostics>
<response>
  <assistant_text>I'd like to run an analysis but let's first frame the decision.</assistant_text>
</response>`;

    // No graph → frame stage. run_analysis blocked.
    const deps = makeDeps(makeLLMClient(xml, "run_analysis"));
    const envelope = await executePipeline(
      makeRequest({ message: "Run the analysis now" }),
      "req-3",
      deps,
    );

    expect(envelope.assistant_text).toContain("frame the decision");
    expect(envelope.error).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Scenario 4: Multi-line chip message → newlines preserved end-to-end
  // --------------------------------------------------------------------------
  it("(4) Multi-line chip <message> content preserved through parse → envelope", async () => {
    const xml = `<diagnostics>Mode: INTERPRET</diagnostics>
<response>
  <assistant_text>Here are your options.</assistant_text>
  <suggested_actions>
    <action>
      <role>facilitator</role>
      <label>Explore pricing</label>
      <message>
What drives the price sensitivity
in your target market?
      </message>
    </action>
  </suggested_actions>
</response>`;

    const deps = makeDeps(makeLLMClient(xml));
    const envelope = await executePipeline(makeRequest(), "req-4", deps);

    expect(envelope.suggested_actions).toHaveLength(1);
    const prompt = envelope.suggested_actions[0].prompt;
    expect(prompt).toContain("What drives the price sensitivity");
    expect(prompt).toContain("in your target market");
  });

  // --------------------------------------------------------------------------
  // Scenario 5: Malformed LLM XML → graceful degradation, no 500
  // --------------------------------------------------------------------------
  it("(5) Malformed LLM XML → graceful degradation, non-empty response", async () => {
    const broken = `<diagnostics>Mode: INTERPRET<broken>
<<unclosed response tag
some plain text that should be extracted`;

    const deps = makeDeps(makeLLMClient(broken));
    const envelope = await executePipeline(makeRequest(), "req-5", deps);

    // No error, and some assistant_text was extracted or a fallback was injected
    expect(envelope.error).toBeUndefined();
    expect(envelope.assistant_text).toBeTruthy();
  });

  // --------------------------------------------------------------------------
  // Scenario 6: V2 unknown block_type from dispatcher → dropped, text preserved
  // --------------------------------------------------------------------------
  it("(6) V2 unknown block_type dropped by contract validator, assistant_text preserved", async () => {
    const xml = `<diagnostics>Mode: ACT</diagnostics>
<response>
  <assistant_text>I ran something for you.</assistant_text>
</response>`;

    const dispatcher = makeToolDispatcher({
      blocks: [makeMinimalBlock("unknown_invalid") as ConversationBlock],
      assistant_text: "Tool says hello.",
    });

    // Use draft_graph which IS allowed in frame stage
    const deps = makeDeps(makeLLMClient(xml, "draft_graph"), dispatcher);
    const envelope = await executePipeline(makeRequest(), "req-6", deps);

    // Unknown block type stripped by contract validator
    expect(envelope.blocks.every((b) => (b.block_type as string) !== "unknown_invalid")).toBe(true);
    // assistant_text still present (from LLM or tool)
    expect(envelope.assistant_text).toBeTruthy();
    expect(envelope.error).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Scenario 7: research_topic in FRAME without explicit research intent → suppressed + fallback
  // --------------------------------------------------------------------------
  it("(7) research_topic in FRAME without explicit research intent → suppressed, fallback injected", async () => {
    // No graph → frame stage. research_topic requires explicit research keywords.
    // "Tell me about pricing" has no "research", "find data", "benchmarks", etc.
    const deps = makeDeps(makeLLMClient(null, "research_topic"));
    const envelope = await executePipeline(
      makeRequest({ message: "Tell me about pricing" }),
      "req-7",
      deps,
    );

    expect(envelope.assistant_text).toBeTruthy();
    const expectedFallback = getStageAwareFallback("frame", "research_topic");
    expect(envelope.assistant_text).toBe(expectedFallback);
    expect(envelope.error).toBeUndefined();
  });
});

// ============================================================================
// Scenarios 8–9: V1 envelope (assembleEnvelope direct)
// ============================================================================

describe("orchestrator golden path — V1 envelope contract validation", () => {
  const baseContext: ConversationContext = {
    graph: null,
    analysis_response: null,
    framing: { stage: "frame" },
    messages: [],
    scenario_id: "v1-test",
  };

  // --------------------------------------------------------------------------
  // Scenario 8: V1 suppressed-tool → null assistant_text + no blocks → fallback
  // --------------------------------------------------------------------------
  it("(8) V1 envelope: null assistant_text + no blocks → contract validator injects fallback", () => {
    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: baseContext,
      computedStage: "frame",
    });

    expect(envelope.assistant_text).toBeTruthy();
    expect(envelope.assistant_text).not.toBeNull();
    // Should be the frame stage fallback
    const expectedFallback = getStageAwareFallback("frame");
    expect(envelope.assistant_text).toBe(expectedFallback);
  });

  // --------------------------------------------------------------------------
  // Scenario 9: V1 unknown block_type → block dropped, assistant_text preserved
  // --------------------------------------------------------------------------
  it("(9) V1 envelope: block with unknown block_type is dropped, assistant_text preserved", () => {
    const envelope = assembleEnvelope({
      assistantText: "Here is my response.",
      blocks: [makeMinimalBlock("unknown_invalid")],
      context: baseContext,
      computedStage: "frame",
    });

    expect(envelope.blocks).toHaveLength(0);
    expect(envelope.assistant_text).toBe("Here is my response.");
  });

  // --------------------------------------------------------------------------
  // Extra: V1 error envelope is NOT given a fallback (error takes precedence)
  // --------------------------------------------------------------------------
  it("V1 error envelope: null assistant_text with error set is NOT overwritten by fallback", () => {
    const envelope = assembleEnvelope({
      assistantText: null,
      blocks: [],
      context: baseContext,
      computedStage: "frame",
      error: { code: "UNKNOWN", message: "Pipeline failed", recoverable: false },
    });

    // Error envelopes: assistant_text may remain null — that is expected
    expect(envelope.error).toBeDefined();
    expect(envelope.error?.code).toBe("UNKNOWN");
    // The contract validator skips fallback injection when error is set
    expect(envelope.assistant_text).toBeNull();
  });
});
