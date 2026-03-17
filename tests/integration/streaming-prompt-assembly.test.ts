/**
 * High-fidelity Streaming Prompt Assembly Test
 *
 * Tests that phase3PrepareForStreaming and phase3Generate both use
 * assembleV2SystemPrompt (real implementation) with a production-size
 * Zone 1 prompt. Mocks only the prompt-store retrieval.
 *
 * Prevents regression: 310-char hardcoded prompt instead of ~63K full prompt.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EnrichedContext, SpecialistResult, LLMClient } from "../../src/orchestrator/pipeline/types.js";

// ============================================================================
// Mocks — only mock external I/O, keep routing + assembly real
// ============================================================================

// A production-size Zone 1 prompt (~60K chars) — hoisted so vi.mock factory can reference it
const { ZONE1_PROMPT } = vi.hoisted(() => ({
  ZONE1_PROMPT: "You are an expert decision-support assistant.\n" + "X".repeat(60_000),
}));

vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue(ZONE1_PROMPT),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "orchestrator",
    source: "store",
    prompt_version: "orchestrator_default@v19 (staging)",
    prompt_hash: "test-hash-60k",
    instance_id: "test-instance",
  }),
}));

vi.mock("../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({
    routing: "llm", tool: null, confidence: "none",
    normalised_message: "",
  }),
}));

vi.mock("../../src/orchestrator/prompt-assembly.js", () => ({
  assembleMessages: vi.fn().mockReturnValue([
    { role: "user", content: "Should I hire a tech lead or two developers?" },
  ]),
  assembleToolDefinitions: vi.fn((defs: unknown[]) => defs),
}));

vi.mock("../../src/orchestrator/tools/registry.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([
    { name: "draft_graph", description: "Draft a graph", parameters: {} },
    { name: "edit_graph", description: "Edit a graph", parameters: {} },
    { name: "run_analysis", description: "Run analysis", parameters: {} },
    { name: "explain_results", description: "Explain results", parameters: {} },
  ]),
  isLongRunningTool: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/orchestrator/blocks/factory.js", () => ({
  createCommentaryBlock: vi.fn(),
  createReviewCardBlock: vi.fn(),
}));

// ============================================================================
// Imports (after mocks — real phase3 + assembler)
// ============================================================================

import { phase3Generate, phase3PrepareForStreaming } from "../../src/orchestrator/pipeline/phase3-llm/index.js";

// ============================================================================
// Fixtures
// ============================================================================

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

// ============================================================================
// Tests
// ============================================================================

describe("Streaming prompt assembly parity (high-fidelity)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("phase3PrepareForStreaming: LLM path system prompt > 50000 chars", async () => {
    const client = makeMockLLMClient();
    // LLM path: no graph, no explanation keywords → routing:'llm'
    const ctx = makeEnrichedContext();

    const prep = await phase3PrepareForStreaming(
      ctx, makeSpecialistResult(), client, "req-stream-1",
      "Should I hire a tech lead or two developers?",
    );

    expect(prep.kind).toBe("llm");
    if (prep.kind !== "llm") throw new Error("expected llm");

    // System prompt must include Zone 1 (60K) + Zone 2
    expect(prep.callArgs.system.length).toBeGreaterThan(50_000);
    expect(prep.callArgs.system).toContain("You are an expert decision-support assistant");
    // Cache blocks must also be populated
    expect(prep.callArgs.system_cache_blocks).toBeDefined();
    expect(prep.callArgs.system_cache_blocks!.length).toBeGreaterThan(0);
  });

  it("phase3Generate: LLM path passes full prompt to chatWithTools", async () => {
    const client = makeMockLLMClient();
    const ctx = makeEnrichedContext();

    await phase3Generate(
      ctx, makeSpecialistResult(), client, "req-nonstream-1",
      "Should I hire a tech lead or two developers?",
    );

    expect(client.chatWithTools).toHaveBeenCalledTimes(1);
    const callArgs = (client.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.system.length).toBeGreaterThan(50_000);
    expect(callArgs.system).toContain("You are an expert decision-support assistant");
  });

  it("phase3Generate: rationale path uses full assembled prompt (not 310-char)", async () => {
    const client = makeMockLLMClient();
    // Trigger rationale: graph exists + recommend keyword ("should i") + no analysis
    const ctx = makeEnrichedContext({
      stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
      analysis: null,
      graph: { nodes: [{ id: "n1", kind: "factor", label: "Demand" }], edges: [] } as unknown as EnrichedContext["graph"],
      framing: { goal: "Maximise growth" } as EnrichedContext["framing"],
    });

    const result = await phase3Generate(
      ctx, makeSpecialistResult(), client, "req-rationale-1",
      "Should I hire a tech lead or two developers?",
    );

    // Rationale path uses llmClient.chat (not chatWithTools)
    expect(client.chat).toHaveBeenCalledTimes(1);
    expect(client.chatWithTools).not.toHaveBeenCalled();
    expect(result.route_metadata?.outcome).toBe("rationale_explanation");

    // System prompt must be the full assembled prompt + RATIONALE MODE suffix
    const chatArgs = (client.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(chatArgs.system.length).toBeGreaterThan(50_000);
    expect(chatArgs.system).toContain("You are an expert decision-support assistant");
    expect(chatArgs.system).toContain("[RATIONALE MODE]");
  });

  it("phase3PrepareForStreaming: rationale path returns deterministic (delegates to phase3Generate)", async () => {
    const client = makeMockLLMClient();
    const ctx = makeEnrichedContext({
      stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
      analysis: null,
      graph: { nodes: [{ id: "n1", kind: "factor", label: "Demand" }], edges: [] } as unknown as EnrichedContext["graph"],
      framing: { goal: "Maximise growth" } as EnrichedContext["framing"],
    });

    const prep = await phase3PrepareForStreaming(
      ctx, makeSpecialistResult(), client, "req-stream-rationale",
      "Should I hire a tech lead or two developers?",
    );

    expect(prep.kind).toBe("deterministic");
    if (prep.kind !== "deterministic") throw new Error("expected deterministic");

    // Even though it's deterministic, the underlying chat call used the full prompt
    expect(client.chat).toHaveBeenCalledTimes(1);
    const chatArgs = (client.chat as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(chatArgs.system.length).toBeGreaterThan(50_000);
    expect(chatArgs.system).toContain("[RATIONALE MODE]");
  });

  it("phase3PrepareForStreaming: returns LLM (not deterministic) when prerequisites fail", async () => {
    // Intent gate matches run_analysis deterministically, but no graph → prerequisites fail
    // → wouldSkipLLM must return false → streaming gets LLM path with full prompt
    const { classifyIntent } = await import("../../src/orchestrator/intent-gate.js");
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      routing: "deterministic",
      tool: "run_analysis",
      confidence: "exact",
      matched_pattern: "run analysis",
      normalised_message: "run analysis",
    });

    const client = makeMockLLMClient();
    // No graph → run_analysis prerequisites NOT met
    const ctx = makeEnrichedContext({
      stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" },
      graph: null,
    });

    const prep = await phase3PrepareForStreaming(
      ctx, makeSpecialistResult(), client, "req-prereq-fail",
      "run analysis",
    );

    // Must return LLM, not deterministic — prerequisites failure falls through
    expect(prep.kind).toBe("llm");
    if (prep.kind !== "llm") throw new Error("expected llm");
    expect(prep.callArgs.system.length).toBeGreaterThan(50_000);

    // Reset mock
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      routing: "llm", tool: null, confidence: "none", normalised_message: "",
    });
  });

  // ── brief_detection bypass regression (F-BD-01) ──────────────────────────
  // Before the fix: wouldSkipLLM returned false for brief_detection + empty framing
  // because DETERMINISTIC_PREREQUISITES.draft_graph checked only structured framing
  // fields and lacked the brief_detection bypass that V1 (turn-handler.ts) had.
  // After the fix: both phase3Generate and wouldSkipLLM bypass prerequisites when
  // matched_pattern === 'brief_detection', mirroring V1 behaviour.

  it("phase3Generate: brief_detection with empty framing dispatches draft_graph deterministically (not LLM)", async () => {
    const { classifyIntent } = await import("../../src/orchestrator/intent-gate.js");
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      routing: "deterministic",
      tool: "draft_graph",
      confidence: "high",
      matched_pattern: "brief_detection",
      normalised_message: "i need to decide whether to hire a cto or outsource engineering",
    });

    const client = makeMockLLMClient();
    // Empty framing — exactly the condition that caused the prerequisite failure
    const ctx = makeEnrichedContext({
      graph: null,
      framing: null,
      stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    });

    const result = await phase3Generate(
      ctx, makeSpecialistResult(), client, "req-bd-phase3",
      "I need to decide whether to hire a CTO or outsource engineering",
    );

    // Must NOT call LLM — brief_detection bypasses framing prerequisites
    expect(client.chatWithTools).not.toHaveBeenCalled();
    expect(result.tool_invocations).toHaveLength(1);
    expect(result.tool_invocations[0].name).toBe("draft_graph");
    expect(result.tool_invocations[0].id).toBe("deterministic");

    // Reset mock
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      routing: "llm", tool: null, confidence: "none", normalised_message: "",
    });
  });

  it("phase3PrepareForStreaming: brief_detection with empty framing returns deterministic (wouldSkipLLM: true)", async () => {
    const { classifyIntent } = await import("../../src/orchestrator/intent-gate.js");
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      routing: "deterministic",
      tool: "draft_graph",
      confidence: "high",
      matched_pattern: "brief_detection",
      normalised_message: "i need to decide whether to hire a cto or outsource engineering",
    });

    const client = makeMockLLMClient();
    const ctx = makeEnrichedContext({
      graph: null,
      framing: null,
      stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    });

    const prep = await phase3PrepareForStreaming(
      ctx, makeSpecialistResult(), client, "req-bd-stream",
      "I need to decide whether to hire a CTO or outsource engineering",
    );

    // wouldSkipLLM must return true → prep.kind === 'deterministic'
    expect(prep.kind).toBe("deterministic");
    if (prep.kind !== "deterministic") throw new Error("expected deterministic");

    // The deterministic result must target draft_graph
    expect(prep.result.tool_invocations).toHaveLength(1);
    expect(prep.result.tool_invocations[0].name).toBe("draft_graph");
    expect(prep.result.tool_invocations[0].id).toBe("deterministic");

    // LLM must not have been called
    expect(client.chatWithTools).not.toHaveBeenCalled();

    // Reset mock
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      routing: "llm", tool: null, confidence: "none", normalised_message: "",
    });
  });

  it("phase3PrepareForStreaming: brief_detection parity — streaming matches non-streaming for empty framing", async () => {
    // Both paths must return deterministic draft_graph when brief_detection fires with empty framing.
    // This is the exact regression scenario: streaming returned 'llm' (no draft_graph) before the fix.
    const { classifyIntent } = await import("../../src/orchestrator/intent-gate.js");
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      routing: "deterministic",
      tool: "draft_graph",
      confidence: "high",
      matched_pattern: "brief_detection",
      normalised_message: "deciding between two vendors for our erp system",
    });

    const ctx = makeEnrichedContext({
      graph: null,
      framing: null,
      stage_indicator: { stage: "frame", confidence: "high", source: "inferred" },
    });
    const message = "Deciding between two vendors for our ERP system";

    const streamClient = makeMockLLMClient();
    const nonStreamClient = makeMockLLMClient();

    const [prep, nonStreamResult] = await Promise.all([
      phase3PrepareForStreaming(ctx, makeSpecialistResult(), streamClient, "req-parity-bd-s", message),
      phase3Generate(ctx, makeSpecialistResult(), nonStreamClient, "req-parity-bd-ns", message),
    ]);

    // Both must be deterministic draft_graph — no LLM calls on either path
    expect(prep.kind).toBe("deterministic");
    expect(streamClient.chatWithTools).not.toHaveBeenCalled();
    expect(nonStreamClient.chatWithTools).not.toHaveBeenCalled();
    if (prep.kind !== "deterministic") throw new Error("expected deterministic");
    expect(prep.result.tool_invocations[0].name).toBe("draft_graph");
    expect(nonStreamResult.tool_invocations[0].name).toBe("draft_graph");

    // Reset mock
    (classifyIntent as ReturnType<typeof vi.fn>).mockReturnValue({
      routing: "llm", tool: null, confidence: "none", normalised_message: "",
    });
  });

  // ── end brief_detection bypass regression ────────────────────────────────

  it("streaming and non-streaming LLM paths produce same system prompt length", async () => {
    const streamClient = makeMockLLMClient();
    const nonStreamClient = makeMockLLMClient();
    const ctx = makeEnrichedContext();
    const message = "What are my options?";

    // Streaming path
    const prep = await phase3PrepareForStreaming(
      ctx, makeSpecialistResult(), streamClient, "req-parity-s",
      message,
    );
    expect(prep.kind).toBe("llm");
    const streamPromptLen = prep.kind === "llm" ? prep.callArgs.system.length : 0;

    // Non-streaming path
    await phase3Generate(
      ctx, makeSpecialistResult(), nonStreamClient, "req-parity-ns",
      message,
    );
    const nsCallArgs = (nonStreamClient.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const nonStreamPromptLen = nsCallArgs.system.length;

    // Must be identical
    expect(streamPromptLen).toBe(nonStreamPromptLen);
    expect(streamPromptLen).toBeGreaterThan(50_000);
  });
});
