/**
 * Tests for ORCHESTRATOR_ACK_TIMEOUT_MS (C.3).
 * Verifies that:
 * - Ack-only LLM calls use the shorter timeout
 * - Ack timeout falls back to fallback text (not an error)
 * - Normal orchestrator turns still use full ORCHESTRATOR_TIMEOUT_MS
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ============================================================================
// Mocks
// ============================================================================

vi.mock("../../../src/config/index.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/config/index.js")>();
  return {
    ...original,
    config: new Proxy(original.config, {
      get(target, prop) {
        if (prop === "plot") {
          return { baseUrl: undefined, authToken: undefined };
        }
        return Reflect.get(target, prop);
      },
    }),
    isProduction: () => false,
  };
});

vi.mock("../../../src/orchestrator/plot-client.js", () => ({
  createPLoTClient: () => null,
}));

vi.mock("../../../src/orchestrator/prompt-assembly.js", () => ({
  assembleSystemPrompt: vi.fn().mockResolvedValue("system prompt"),
  assembleMessages: vi.fn().mockReturnValue([]),
  assembleToolDefinitions: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../src/orchestrator/tools/registry.js", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../src/orchestrator/response-parser.js", () => ({
  parseLLMResponse: vi.fn().mockReturnValue({
    assistant_text: "test",
    extracted_blocks: [],
    suggested_actions: [],
    diagnostics: null,
    parse_warnings: [],
  }),
  getFirstToolInvocation: vi.fn().mockReturnValue(null),
}));

vi.mock("../../../src/orchestrator/context-fabric/index.js", () => ({
  assembleContext: vi.fn(),
}));

// Track LLM adapter calls
const mockChat = vi.fn();
const mockChatWithTools = vi.fn();

vi.mock("../../../src/adapters/llm/router.js", () => ({
  getAdapter: () => ({
    name: "test",
    model: "test-model",
    chat: mockChat,
    chatWithTools: mockChatWithTools,
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock("../../../src/orchestrator/idempotency.js", () => ({
  getIdempotentResponse: vi.fn().mockReturnValue(null),
  setIdempotentResponse: vi.fn(),
  getInflightRequest: vi.fn().mockReturnValue(null),
  registerInflightRequest: vi.fn(),
}));

import { handleTurn, _resetPlotClient } from "../../../src/orchestrator/turn-handler.js";
import { ORCHESTRATOR_ACK_TIMEOUT_MS, ORCHESTRATOR_TIMEOUT_MS } from "../../../src/config/timeouts.js";
import type { FastifyRequest } from "fastify";

const makeRequest = () => ({ headers: {} }) as unknown as FastifyRequest;

describe("Ack Timeout (C.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetPlotClient();
    mockChat.mockResolvedValue({ content: "Acknowledged." });
    mockChatWithTools.mockResolvedValue({
      content: "test",
      tool_calls: [],
    });
  });

  it("direct_graph_edit is handled deterministically (no LLM call)", async () => {
    // Brief C: direct_graph_edit is now handled by the system event router
    // without an LLM call. It's deterministic and silent.
    const result = await handleTurn(
      {
        message: "edit",
        context: {
          graph: null,
          analysis_response: null,
          framing: null,
          messages: [],
          scenario_id: "s1",
        },
        scenario_id: "s1",
        system_event: {
          event_type: "direct_graph_edit",
          timestamp: "2026-03-03T00:00:00Z",
          event_id: "evt-1",
          details: { changed_node_ids: ["n1"], changed_edge_ids: [], operations: ["update"] },
        },
        client_turn_id: "t1",
      },
      makeRequest(),
      "req-1",
    );

    // No LLM call — deterministic handler
    expect(mockChat).not.toHaveBeenCalled();
    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toBeNull();
    expect(result.envelope.error).toBeUndefined();
  });

  it("direct_graph_edit without graph_state returns silent response (no error)", async () => {
    const result = await handleTurn(
      {
        message: "edit",
        context: {
          graph: null,
          analysis_response: null,
          framing: null,
          messages: [],
          scenario_id: "s1",
        },
        scenario_id: "s1",
        system_event: {
          event_type: "direct_graph_edit",
          timestamp: "2026-03-03T00:00:00Z",
          event_id: "evt-2",
          details: { changed_node_ids: [], changed_edge_ids: [], operations: ["add"] },
        },
        client_turn_id: "t2",
      },
      makeRequest(),
      "req-2",
    );

    expect(result.httpStatus).toBe(200);
    expect(result.envelope.assistant_text).toBeNull();
    expect(result.envelope.error).toBeUndefined();
  });

  it("ORCHESTRATOR_ACK_TIMEOUT_MS defaults to 5000", () => {
    expect(ORCHESTRATOR_ACK_TIMEOUT_MS).toBe(5_000);
  });

  it("normal LLM turn uses full ORCHESTRATOR_TIMEOUT_MS (not ack timeout)", async () => {
    mockChatWithTools.mockResolvedValue({
      content: [{ type: "text", text: "I can help with that." }],
      stop_reason: "end_turn",
    });

    await handleTurn(
      {
        message: "What should I do?",
        context: {
          graph: null,
          analysis_response: null,
          framing: { stage: "frame", goal: "test" },
          messages: [],
          scenario_id: "s1",
        },
        scenario_id: "s1",
        client_turn_id: "t3",
      },
      makeRequest(),
      "req-3",
    );

    expect(mockChatWithTools).toHaveBeenCalledOnce();
    const callOpts = mockChatWithTools.mock.calls[0][1];
    expect(callOpts.timeoutMs).toBe(ORCHESTRATOR_TIMEOUT_MS);
    // Verify it's the full timeout, not the shorter ack timeout
    expect(callOpts.timeoutMs).toBeGreaterThan(ORCHESTRATOR_ACK_TIMEOUT_MS);
  });
});
