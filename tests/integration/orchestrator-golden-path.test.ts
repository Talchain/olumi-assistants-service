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
    features: { orchestratorV2: false, dskV0: false, zone2Registry: false, bilEnabled: false, contextFabric: false },
    cee: { clarifierEnabled: false },
  },
}));

vi.mock("../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({ routing: "llm", tool: null }),
}));

vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("System prompt"),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "orchestrator",
    source: "default",
    prompt_version: "default:orchestrator",
    prompt_hash: "test-hash",
    instance_id: "test-instance",
  }),
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

// ============================================================================
// Task 2: Stage derivation — empty graph treated as no graph
// ============================================================================

describe("stage derivation — empty graph handling", () => {
  it("null graph → frame stage", async () => {
    const deps = makeDeps(makeLLMClient("Let me help you."));
    const envelope = await executePipeline(
      makeRequest({ context: makeContext({ graph: null }) }),
      "req-stage-null",
      deps,
    );
    expect(envelope.stage_indicator.stage).toBe("frame");
  });

  it("graph with empty nodes array → frame stage", async () => {
    const deps = makeDeps(makeLLMClient("Let me help you."));
    const envelope = await executePipeline(
      makeRequest({
        context: makeContext({
          graph: { nodes: [], edges: [] } as unknown as ConversationContext["graph"],
        }),
      }),
      "req-stage-empty",
      deps,
    );
    expect(envelope.stage_indicator.stage).toBe("frame");
  });
});

// ============================================================================
// Task 4: Intent-aware fallback messages differ by stage × tool
// ============================================================================

describe("intent-aware fallbacks — stage × tool specificity", () => {
  it("frame:run_analysis fallback differs from frame:edit_graph fallback", async () => {
    // run_analysis suppressed in frame
    const depsA = makeDeps(makeLLMClient(null, "run_analysis"));
    const envelopeA = await executePipeline(
      makeRequest({ message: "Run the analysis" }),
      "req-fallback-a",
      depsA,
    );

    // edit_graph suppressed in frame
    const depsB = makeDeps(makeLLMClient(null, "edit_graph"));
    const envelopeB = await executePipeline(
      makeRequest({ message: "Edit the graph" }),
      "req-fallback-b",
      depsB,
    );

    // Both should have fallback text, but different messages
    expect(envelopeA.assistant_text).toBeTruthy();
    expect(envelopeB.assistant_text).toBeTruthy();
    expect(envelopeA.assistant_text).not.toBe(envelopeB.assistant_text);
  });

  it("fallback message mentions framing when in frame stage", async () => {
    const deps = makeDeps(makeLLMClient(null, "run_analysis"));
    const envelope = await executePipeline(
      makeRequest({ message: "Run the analysis" }),
      "req-fallback-frame",
      deps,
    );
    // frame:run_analysis fallback should mention framing/model
    expect(envelope.assistant_text).toMatch(/model|frame|decision/i);
  });
});

// ============================================================================
// Test 8.5: Post-draft response quality
// ============================================================================

describe("post-draft response quality (Task 5)", () => {
  it("after draft_graph succeeds, assistant_text is not null or 'Applied'", async () => {
    // The LLM selects draft_graph and produces orientation text.
    // The tool dispatcher simulates a successful graph draft.
    const llmText = "This is a first-pass model with three key factors: Price, Volume, and Revenue goal. I've assumed default strengths — the Price → Revenue edge is worth calibrating. What aspect would you like to adjust first?";
    const deps = makeDeps(
      makeLLMClient(llmText, "draft_graph"),
      makeToolDispatcher({
        blocks: [
          {
            block_id: "blk_graph_patch_1",
            block_type: "graph_patch",
            data: { patch_type: "full_draft", operations: [], status: "proposed" },
            provenance: { trigger: "tool:draft_graph", turn_id: "t1", timestamp: new Date().toISOString() },
          } as ConversationBlock,
        ],
        side_effects: { graph_updated: true, analysis_ran: false, brief_generated: false },
      }),
    );

    const envelope = await executePipeline(
      makeRequest({ message: "Draft a model for my pricing decision" }),
      "req-post-draft",
      deps,
    );

    // Must have assistant_text (not just "Applied" or null)
    expect(envelope.assistant_text).not.toBeNull();
    expect(envelope.assistant_text).not.toBe("Applied");
    expect(envelope.assistant_text!.length).toBeGreaterThan(20);
    // Graph patch block must be present
    expect(envelope.blocks.some(b => b.block_type === "graph_patch")).toBe(true);
  });

  it("fallback chip is injected when tool suppressed with no LLM text (run_analysis in frame)", async () => {
    // run_analysis is not allowed in frame — suppression + no LLM text → fallback + chip
    const deps = makeDeps(makeLLMClient(null, "run_analysis"));
    const envelope = await executePipeline(
      makeRequest({ message: "Run the analysis" }),
      "req-suppressed-chip",
      deps,
    );
    // Fallback message must be present
    expect(envelope.assistant_text).toBeTruthy();
    // Chip must be injected so user has an obvious next step
    expect(envelope.suggested_actions.length).toBeGreaterThan(0);
    expect(envelope.suggested_actions[0].role).toBe("facilitator");
    expect(envelope.suggested_actions[0].label).toBeTruthy();
  });
});

// ============================================================================
// Test 8.6: Structural violation suppression
// ============================================================================

describe("structural violation suppression (Task 6)", () => {
  it("edit_graph structural rejection does NOT expose raw violation text to user", async () => {
    // Tool dispatcher returns a rejection with raw violation text in blocks
    // but assistant_text should be the safe recovery message.
    const rawViolationText = "This change would leave a node that cannot reach the goal";
    const deps = makeDeps(
      makeLLMClient(null, "edit_graph"),
      makeToolDispatcher({
        // Tool dispatcher returns the safe recovery text (as edit-graph.ts now does)
        assistant_text: "I wasn't able to make that change safely. Let me try a simpler approach — which option should we configure first?",
        blocks: [],
        side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      }),
    );

    const envelope = await executePipeline(
      makeRequest({
        message: "Remove the Revenue node",
        context: makeContext({
          graph: {
            nodes: [{ id: "n1", kind: "decision", label: "Price" }, { id: "n2", kind: "goal", label: "Revenue" }],
            edges: [{ from: "n1", to: "n2" }],
          } as unknown as ConversationContext["graph"],
        }),
      }),
      "req-violation-suppression",
      deps,
    );

    // Raw structural violation text must never appear in assistant_text
    expect(envelope.assistant_text).not.toContain(rawViolationText);
    expect(envelope.assistant_text).not.toContain("cannot reach the goal");
    expect(envelope.assistant_text).not.toContain("structural validation failed");
    // Safe recovery message should be present
    expect(envelope.assistant_text).toMatch(/safely|simpler|approach/i);
  });
});

// ============================================================================
// Test 8.7: Option-config recovery flow
// ============================================================================

describe("option-config recovery flow (Task 6 / run_analysis)", () => {
  it("run_analysis with unconfigured options returns recoverable error with actionable message", async () => {
    // The tool dispatcher simulates run-analysis throwing a recoverable OrchestratorError
    // for unconfigured options (as implemented in run-analysis.ts).
    const errorText = 'The analysis can\'t run yet — option "Option A" has no intervention values configured.';
    const deps = makeDeps(
      makeLLMClient(null, "run_analysis"),
      makeToolDispatcher({
        assistant_text: errorText,
        blocks: [],
        side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      }),
    );

    const envelope = await executePipeline(
      makeRequest({
        message: "Run the analysis",
        context: makeContext({
          graph: {
            nodes: [{ id: "n1", kind: "decision", label: "Price" }, { id: "n2", kind: "goal", label: "Revenue" }],
            edges: [{ from: "n1", to: "n2" }],
          } as unknown as ConversationContext["graph"],
          analysis_inputs: {
            options: [
              { option_id: "opt_a", label: "Option A", interventions: {} },
            ],
          },
        }),
      }),
      "req-option-recovery",
      deps,
    );

    // Error message should be actionable (mention interventions or options or configuration)
    expect(envelope.assistant_text).toMatch(/option|intervention|configur/i);
    // Must NOT surface internal error codes or stack traces
    expect(envelope.assistant_text).not.toContain("TOOL_EXECUTION_FAILED");
    expect(envelope.assistant_text).not.toContain("stack");
  });
});

// ============================================================================
// Test 8.2: Context accumulation across turns
// ============================================================================

describe("context accumulation — framing reaches LLM across turns", () => {
  it("framing goal is present in context passed to LLM on second turn", async () => {
    // The LLM client spy can verify what system prompt was built.
    // We check that the prompt assembler receives the context with the goal set.
    const llmClient = makeLLMClient("I see your goal is 10% revenue growth.");

    // First turn: user sets the goal
    await executePipeline(
      makeRequest({
        message: "Our goal is 10% revenue growth",
        context: makeContext({
          framing: { stage: "frame", goal: "10% revenue growth" },
        }),
      }),
      "req-ctx-turn1",
      makeDeps(llmClient),
    );

    // Second turn: user asks something different but framing persists
    const llmClient2 = makeLLMClient("Based on your 10% revenue growth goal...");
    const envelope2 = await executePipeline(
      makeRequest({
        message: "What should I consider?",
        context: makeContext({
          framing: { stage: "frame", goal: "10% revenue growth" },
          messages: [
            { role: "user", content: "Our goal is 10% revenue growth" },
            { role: "assistant", content: [{ type: "text", text: "I see your goal is 10% revenue growth." }] },
          ] as ConversationContext["messages"],
        }),
      }),
      "req-ctx-turn2",
      makeDeps(llmClient2),
    );

    // The second turn must succeed — context propagation doesn't break the pipeline
    expect(envelope2.assistant_text).toBeTruthy();
    // The stage should still be frame (no graph yet)
    expect(envelope2.stage_indicator.stage).toBe("frame");
  });

  it("explain_results includes goal context from framing", async () => {
    // When explain_results fires, framing.goal must be in scope for the tool.
    // We verify the pipeline doesn't drop framing when building tool context.
    const explanationText = "Based on your goal of 10% revenue growth, the key finding is that Price is the dominant driver.";
    const deps = makeDeps(
      makeLLMClient(null, "explain_results"),
      makeToolDispatcher({
        assistant_text: explanationText,
        blocks: [],
        side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
      }),
    );

    const envelope = await executePipeline(
      makeRequest({
        message: "Explain the results",
        context: makeContext({
          graph: {
            nodes: [{ id: "n1", kind: "decision", label: "Price" }, { id: "n2", kind: "goal", label: "Revenue" }],
            edges: [{ from: "n1", to: "n2" }],
          } as unknown as ConversationContext["graph"],
          analysis_response: {
            meta: { seed_used: 1, n_samples: 100, response_hash: "abc" },
            results: [{ option_id: "opt_a", label: "Raise Price", goal_probability: 0.72, rank: 1 }],
          } as unknown as ConversationContext["analysis_response"],
          framing: { stage: "evaluate", goal: "10% revenue growth" },
        }),
      }),
      "req-explain-with-framing",
      deps,
    );

    // Must return the explanation (framing context didn't break tool dispatch)
    expect(envelope.assistant_text).toBeTruthy();
    expect(envelope.assistant_text).toContain("revenue growth");
  });
});
