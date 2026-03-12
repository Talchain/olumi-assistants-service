/**
 * Tests: Resolved model observability in route_metadata and dispatch logs
 *
 * Verifies that resolved_model and resolved_provider are populated on
 * route_metadata after LLM calls.
 */
import { describe, it, expect, vi } from "vitest";
import { phase3Generate } from "../../../../src/orchestrator/pipeline/phase3-llm/index.js";
import { dispatchToolHandler } from "../../../../src/orchestrator/tools/dispatch.js";
import type { EnrichedContext, SpecialistResult, LLMClient } from "../../../../src/orchestrator/pipeline/types.js";
import type { ConversationContext } from "../../../../src/orchestrator/types.js";

// Mock intent gate — llm routing so we reach chatWithTools
vi.mock("../../../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({ routing: "llm", tool: null }),
}));

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
  assembleToolDefinitions: vi.fn().mockReturnValue([
    { name: "draft_graph", description: "draft" },
    { name: "research_topic", description: "research" },
  ]),
}));

vi.mock("../../../../src/orchestrator/tools/registry.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([
    { name: "draft_graph" },
    { name: "research_topic" },
  ]),
  isLongRunningTool: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../../src/orchestrator/blocks/factory.js", () => ({
  createCommentaryBlock: vi.fn(),
  createReviewCardBlock: vi.fn(),
}));

// Mock getAdapter for dispatch tests
vi.mock("../../../../src/adapters/llm/router.js", () => ({
  getAdapter: vi.fn().mockReturnValue({
    model: "gpt-4.1-2025-04-14",
    name: "openai",
    chat: vi.fn().mockResolvedValue({ content: "response" }),
    chatWithTools: vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "<assistant_reply>Hello</assistant_reply>" }],
      stop_reason: "end_turn",
    }),
  }),
  getMaxTokensFromConfig: vi.fn().mockReturnValue(4096),
}));

// Mock handlers for dispatch tests
vi.mock("../../../../src/orchestrator/tools/explain-results.js", () => ({
  handleExplainResults: vi.fn().mockResolvedValue({
    blocks: [],
    assistantText: "explanation",
    latencyMs: 100,
  }),
}));

vi.mock("../../../../src/orchestrator/tools/run-exercise.js", () => ({
  handleRunExercise: vi.fn().mockResolvedValue({
    blocks: [],
    assistantText: "exercise done",
    latencyMs: 50,
  }),
}));

vi.mock("../../../../src/orchestrator/plot-client.js", () => ({
  createPLoTClient: vi.fn().mockReturnValue(null),
}));

vi.mock("../../../../src/orchestrator/analysis-state.js", () => ({
  isAnalysisExplainable: vi.fn().mockReturnValue(true),
  isResultsExplanationEligible: vi.fn().mockReturnValue(false),
  isAnalysisCurrent: vi.fn().mockReturnValue(false),
  isAnalysisRunnable: vi.fn().mockReturnValue(false),
  isAnalysisPresent: vi.fn().mockReturnValue(false),
}));

vi.mock("../../../../src/orchestrator/guidance/post-draft.js", () => ({
  generatePostDraftGuidance: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../../src/orchestrator/guidance/post-analysis.js", () => ({
  generatePostAnalysisGuidance: vi.fn().mockReturnValue([]),
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

function makeMinimalContext(): ConversationContext {
  return {
    graph: null,
    analysis_response: null,
    framing: null,
    messages: [],
    selected_elements: [],
    scenario_id: "test",
    analysis_inputs: null,
    conversational_state: { active_entities: [], stated_constraints: [], current_topic: "framing", last_failed_action: null },
  };
}

describe("model observability: resolved_model in route_metadata", () => {
  it("phase3Generate includes resolved_model and resolved_provider in route_metadata", async () => {
    const client: LLMClient = {
      chatWithTools: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "<assistant_reply>Hello</assistant_reply>" }],
        stop_reason: "end_turn",
      }),
      chat: vi.fn().mockResolvedValue({ content: "Hello" }),
      getResolvedModel: vi.fn().mockReturnValue({ model: "claude-sonnet-4-20250514", provider: "anthropic" }),
    };

    const result = await phase3Generate(
      makeEnrichedContext(),
      makeSpecialistResult(),
      client,
      "req-model-obs",
      "hello",
    );

    expect(result.route_metadata).toBeDefined();
    expect(result.route_metadata?.resolved_model).toBe("claude-sonnet-4-20250514");
    expect(result.route_metadata?.resolved_provider).toBe("anthropic");
  });

  it("phase3Generate handles missing getResolvedModel gracefully (null)", async () => {
    const client: LLMClient = {
      chatWithTools: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "<assistant_reply>Hello</assistant_reply>" }],
        stop_reason: "end_turn",
      }),
      chat: vi.fn().mockResolvedValue({ content: "Hello" }),
      // getResolvedModel omitted — optional per interface
    };

    const result = await phase3Generate(
      makeEnrichedContext(),
      makeSpecialistResult(),
      client,
      "req-model-obs-null",
      "hello",
    );

    expect(result.route_metadata?.resolved_model).toBeNull();
    expect(result.route_metadata?.resolved_provider).toBeNull();
  });

  it("dispatch: explain_results route_metadata includes resolved_model from adapter", async () => {
    const result = await dispatchToolHandler(
      "explain_results",
      { focus: "cost" },
      makeMinimalContext(),
      "turn-1",
      "req-2",
    );

    expect(result.routeMetadata).toBeDefined();
    expect(result.routeMetadata?.resolved_model).toBe("gpt-4.1-2025-04-14");
    expect(result.routeMetadata?.resolved_provider).toBe("openai");
  });

  it("dispatch: run_exercise route_metadata includes resolved_model from adapter", async () => {
    const result = await dispatchToolHandler(
      "run_exercise",
      { exercise: "premortem" },
      makeMinimalContext(),
      "turn-1",
      "req-3",
    );

    expect(result.routeMetadata).toBeDefined();
    expect(result.routeMetadata?.resolved_model).toBe("gpt-4.1-2025-04-14");
    expect(result.routeMetadata?.resolved_provider).toBe("openai");
  });
});
