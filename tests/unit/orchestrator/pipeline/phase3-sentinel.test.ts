/**
 * Phase 3 System Event Sentinel Tests
 *
 * Tests for:
 * - '[system]' sentinel never forwarded to the LLM
 * - System event message discarded, event context sent instead
 * - conversation_history '[system]' entries filtered from LLM input
 * - Normal messages pass through unchanged when no system_event
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EnrichedContext, SpecialistResult, LLMClient } from "../../../../src/orchestrator/pipeline/types.js";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("../../../../src/orchestrator/intent-gate.js", () => ({
  classifyIntent: vi.fn().mockReturnValue({ routing: "llm", tool: null }),
}));

vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("System prompt"),
  getSystemPromptMeta: vi.fn(),
}));

vi.mock("../../../../src/orchestrator/prompt-assembly.js", () => ({
  assembleMessages: vi.fn((context, userMessage) => [
    ...context.messages.map((m: { role: string; content: string }) => ({
      role: m.role,
      content: m.content,
    })),
    { role: "user", content: userMessage },
  ]),
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

// ============================================================================
// Import after mocks
// ============================================================================

import { phase3Generate, SYSTEM_EVENT_SENTINEL } from "../../../../src/orchestrator/pipeline/phase3-llm/index.js";
import { assembleMessages } from "../../../../src/orchestrator/prompt-assembly.js";

// ============================================================================
// Helpers
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
    chat: vi.fn().mockResolvedValue({ content: "Hello" }),
  };
}

// ============================================================================
// Tests: SYSTEM_EVENT_SENTINEL constant
// ============================================================================

describe("SYSTEM_EVENT_SENTINEL", () => {
  it("is exported and equals '[system]'", () => {
    expect(SYSTEM_EVENT_SENTINEL).toBe("[system]");
  });
});

// ============================================================================
// Tests: sentinel filtering
// ============================================================================

describe("phase3Generate: system event sentinel filtering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("discards '[system]' message and sends system event context when system_event present", async () => {
    const client = makeMockLLMClient();

    await phase3Generate(
      makeEnrichedContext({
        system_event: { event_type: "direct_graph_edit" as const, timestamp: "2026-03-03T00:00:00Z", event_id: "e1", details: { changed_node_ids: ["n1"], changed_edge_ids: [], operations: ["update" as const] } },
      }),
      makeSpecialistResult(),
      client,
      "req-1",
      "[system]",
    );

    const calls = (assembleMessages as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);

    const userMessageArg = calls[0][1] as string;
    // Must NOT contain the raw sentinel
    expect(userMessageArg).not.toBe("[system]");
    // Must describe the system event
    expect(userMessageArg).toContain("direct_graph_edit");
    expect(userMessageArg).toContain("System event");
  });

  it("discards non-empty user message when system_event present", async () => {
    const client = makeMockLLMClient();

    await phase3Generate(
      makeEnrichedContext({
        system_event: { event_type: "patch_accepted" as const, timestamp: "2026-03-03T00:00:00Z", event_id: "e2", details: { patch_id: "patch-1", operations: [] } },
      }),
      makeSpecialistResult(),
      client,
      "req-1",
      "some user text that should be ignored",
    );

    const calls = (assembleMessages as ReturnType<typeof vi.fn>).mock.calls;
    const userMessageArg = calls[0][1] as string;

    // User text is discarded in favour of system event context
    expect(userMessageArg).not.toContain("some user text that should be ignored");
    expect(userMessageArg).toContain("patch_accepted");
  });

  it("passes user message through unchanged when no system_event", async () => {
    const client = makeMockLLMClient();

    await phase3Generate(
      makeEnrichedContext(),
      makeSpecialistResult(),
      client,
      "req-1",
      "Hello, what should I do?",
    );

    const calls = (assembleMessages as ReturnType<typeof vi.fn>).mock.calls;
    const userMessageArg = calls[0][1] as string;
    expect(userMessageArg).toBe("Hello, what should I do?");
  });

  it("filters '[system]' entries from conversation_history sent to LLM", async () => {
    const client = makeMockLLMClient();

    // History contains a '[system]' sentinel from a previous system event turn
    const historyWithSentinel = [
      { role: "user" as const, content: "I want to draft a model" },
      { role: "assistant" as const, content: "Here's your model." },
      { role: "user" as const, content: "[system]" },  // system event turn — must be filtered
      { role: "assistant" as const, content: "Graph updated." },
    ];

    await phase3Generate(
      makeEnrichedContext({ conversation_history: historyWithSentinel }),
      makeSpecialistResult(),
      client,
      "req-1",
      "run it",
    );

    const calls = (assembleMessages as ReturnType<typeof vi.fn>).mock.calls;
    const contextArg = calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const messages = contextArg.messages;

    // The '[system]' entry must be filtered out
    const sentinelMessages = messages.filter((m) => m.content === "[system]");
    expect(sentinelMessages).toHaveLength(0);

    // Other messages are preserved
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe("I want to draft a model");
  });

  it("all '[system]' entries removed from conversation_history", async () => {
    const client = makeMockLLMClient();

    const historyWithMultipleSentinels = [
      { role: "user" as const, content: "[system]" },
      { role: "assistant" as const, content: "Acknowledged." },
      { role: "user" as const, content: "tell me more" },
      { role: "assistant" as const, content: "Sure." },
      { role: "user" as const, content: "[system]" },
      { role: "assistant" as const, content: "Got it." },
    ];

    await phase3Generate(
      makeEnrichedContext({ conversation_history: historyWithMultipleSentinels }),
      makeSpecialistResult(),
      client,
      "req-1",
      "what's next?",
    );

    const calls = (assembleMessages as ReturnType<typeof vi.fn>).mock.calls;
    const contextArg = calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const messages = contextArg.messages;

    const sentinelMessages = messages.filter((m) => m.content === "[system]");
    expect(sentinelMessages).toHaveLength(0);
    // 4 remaining messages (3 original - 2 sentinels + 3 non-sentinel = 4)
    expect(messages).toHaveLength(4);
  });
});
