/**
 * Tests: Pre-LLM stage-based tool filtering in phase3Generate
 *
 * Verifies that STAGE_TOOL_POLICY is applied to tool definitions BEFORE the LLM call,
 * so the LLM only sees tools allowed at the current stage.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { phase3Generate } from "../../../../src/orchestrator/pipeline/phase3-llm/index.js";
import type { EnrichedContext, SpecialistResult, LLMClient } from "../../../../src/orchestrator/pipeline/types.js";

// Mock intent gate — always return llm routing so we reach the tool assembly code
vi.mock("../../../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({ routing: "llm", tool: null }),
}));

// Mock prompt assembly — capture tool definitions passed to chatWithTools
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
  assembleToolDefinitions: vi.fn().mockImplementation((defs: unknown[]) =>
    // Return the defs with a .name property so filtering works
    (defs as Array<{ name: string }>).map(d => ({ name: d.name, description: "test" }))
  ),
}));

// Mock registry to return all 6 tools
vi.mock("../../../../src/orchestrator/tools/registry.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([
    { name: "draft_graph" },
    { name: "edit_graph" },
    { name: "run_analysis" },
    { name: "explain_results" },
    { name: "generate_brief" },
    { name: "research_topic" },
  ]),
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

function makeMockLLMClient(): LLMClient & { capturedTools: Array<{ name: string }> } {
  const capturedTools: Array<{ name: string }> = [];
  return {
    capturedTools,
    chatWithTools: vi.fn().mockImplementation(async ({ tools }: { tools: Array<{ name: string }> }) => {
      capturedTools.push(...tools);
      return {
        content: [{ type: "text", text: "<assistant_reply>Hello</assistant_reply>" }],
        stop_reason: "end_turn",
      };
    }),
    chat: vi.fn().mockResolvedValue({ content: "Hello" }),
    getResolvedModel: vi.fn().mockReturnValue({ model: "gpt-4o", provider: "openai" }),
  };
}

describe("phase3-llm: stage-based tool filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset intent gate mock
    vi.doMock("../../../../src/orchestrator/intent-gate.js", () => ({
      classifyIntent: vi.fn().mockReturnValue({ routing: "llm", tool: null }),
    }));
  });

  it("FRAME stage: only draft_graph reaches the LLM for a generic message (research_topic gated by intent)", async () => {
    // "hello" has no explicit research intent → research_topic filtered by isToolAllowedAtStage.
    // explain_results is always pre-filtered when no analysis is present.
    const client = makeMockLLMClient();
    await phase3Generate(
      makeEnrichedContext({ stage_indicator: { stage: "frame", confidence: "high", source: "inferred" } }),
      makeSpecialistResult(),
      client,
      "req-frame",
      "hello",
    );

    expect(client.chatWithTools).toHaveBeenCalledOnce();
    const callArgs = (client.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: { name: string }) => t.name).sort();
    expect(toolNames).toContain("draft_graph");
    // research_topic NOT present — "hello" lacks explicit research intent (FRAME intent gate)
    expect(toolNames).not.toContain("research_topic");
    expect(toolNames).not.toContain("run_analysis");
    expect(toolNames).not.toContain("edit_graph");
    expect(toolNames).not.toContain("generate_brief");
  });

  it("FRAME stage: research_topic reaches LLM when message has explicit research intent", async () => {
    const client = makeMockLLMClient();
    await phase3Generate(
      makeEnrichedContext({ stage_indicator: { stage: "frame", confidence: "high", source: "inferred" } }),
      makeSpecialistResult(),
      client,
      "req-frame-research",
      "research the benchmarks for this decision",
    );

    expect(client.chatWithTools).toHaveBeenCalledOnce();
    const callArgs = (client.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: { name: string }) => t.name);
    expect(toolNames).toContain("draft_graph");
    expect(toolNames).toContain("research_topic");
    expect(toolNames).not.toContain("run_analysis");
    expect(toolNames).not.toContain("edit_graph");
  });

  it("IDEATE stage: explain_results and generate_brief are excluded", async () => {
    const client = makeMockLLMClient();
    await phase3Generate(
      makeEnrichedContext({ stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" } }),
      makeSpecialistResult(),
      client,
      "req-ideate",
      "hello",
    );

    expect(client.chatWithTools).toHaveBeenCalledOnce();
    const callArgs = (client.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: { name: string }) => t.name);
    expect(toolNames).not.toContain("explain_results");
    expect(toolNames).not.toContain("generate_brief");
    expect(toolNames).toContain("edit_graph");
    expect(toolNames).toContain("research_topic");
  });

  it("EVALUATE stage: all tools are available (subject to analysis check)", async () => {
    // Provide a mock analysis so explain_results passes the analysis check
    const client = makeMockLLMClient();
    await phase3Generate(
      makeEnrichedContext({
        stage_indicator: { stage: "evaluate", confidence: "high", source: "inferred" },
        analysis: { status: "complete" } as unknown as EnrichedContext["analysis"],
      }),
      makeSpecialistResult(),
      client,
      "req-evaluate",
      "hello",
    );

    expect(client.chatWithTools).toHaveBeenCalledOnce();
    const callArgs = (client.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: { name: string }) => t.name);
    // EVALUATE allows: run_analysis, explain_results (gated by analysis), generate_brief, edit_graph
    expect(toolNames).toContain("run_analysis");
    expect(toolNames).toContain("generate_brief");
    expect(toolNames).toContain("edit_graph");
    // draft_graph and research_topic not in EVALUATE policy
    expect(toolNames).not.toContain("draft_graph");
    expect(toolNames).not.toContain("research_topic");
  });

  it("unknown stage: all tools pass through (permissive fallback, no crash)", async () => {
    // Unknown stage → isToolAllowedAtStage returns allowed:true for all tools (permissive fallback).
    // explain_results is still pre-filtered by hasExplainableCurrentAnalysis (no analysis in context),
    // so 5 of the 6 mocked tools reach the LLM.
    const client = makeMockLLMClient();
    await phase3Generate(
      makeEnrichedContext({ stage_indicator: { stage: "unknown_stage" as never, confidence: "high", source: "inferred" } }),
      makeSpecialistResult(),
      client,
      "req-unknown",
      "hello",
    );
    // Should still call chatWithTools (no crash)
    expect(client.chatWithTools).toHaveBeenCalledOnce();
    const callArgs = (client.chatWithTools as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const toolNames = callArgs.tools.map((t: { name: string }) => t.name);
    // 5 of 6 mocked tools: explain_results pre-filtered by analysis absence (not by stage policy)
    expect(toolNames).not.toContain("explain_results");
    // All other tools pass through the permissive unknown-stage fallback
    expect(toolNames).toContain("draft_graph");
    expect(toolNames).toContain("edit_graph");
    expect(toolNames).toContain("run_analysis");
    expect(toolNames).toContain("generate_brief");
    expect(toolNames).toContain("research_topic");
  });
});
