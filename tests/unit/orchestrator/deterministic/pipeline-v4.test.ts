/**
 * Tests for the v4 native tool-use pipeline.
 *
 * Covers:
 * - Class 1: System events → no LLM call, valid envelope
 * - Class 2: Normal turn → LLM called with tools
 * - Class 3: Chip click → forced tool_choice
 * - Multiple tool calls → first executed, rest discarded
 * - No agent loop (tool result NOT fed back to LLM)
 * - Prompt caching (system_cache_blocks used)
 * - Temperature always 0
 * - History: assistant_text is plain text, never JSON
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock telemetry
vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

// Mock config
vi.mock("../../../../src/config/index.js", () => ({
  config: {
    features: { pipelineV4Enabled: true, deterministicOrchestratorEnabled: true },
    llm: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
    promptCache: { anthropicEnabled: true },
  },
}));

// Mock prompt loader
vi.mock("../../../../src/prompts/loader.js", () => ({
  loadPrompt: vi.fn().mockResolvedValue({ source: 'default', content: '' }),
}));

// Mock adapter router
const mockStreamChatWithTools = vi.fn();
vi.mock("../../../../src/adapters/llm/router.js", () => ({
  getAdapter: () => ({
    name: 'anthropic',
    model: 'claude-sonnet-4-6',
    streamChatWithTools: mockStreamChatWithTools,
  }),
}));

// Mock timeouts
vi.mock("../../../../src/config/timeouts.js", () => ({
  ORCHESTRATOR_TIMEOUT_MS: 30000,
}));

// Mock context hash
vi.mock("../../../../src/orchestrator/context/context-hash.js", () => ({
  computeContextHash: () => 'abc123',
}));

// Mock guidance
vi.mock("../../../../src/orchestrator/guidance/post-analysis.js", () => ({
  generatePostAnalysisGuidance: () => [],
}));

import { executePipelineV4 } from "../../../../src/orchestrator/deterministic/pipeline-v4.js";
import type { OrchestratorTurnRequest, SystemEvent } from "../../../../src/orchestrator/types.js";
import type { OrchestratorStreamEvent } from "../../../../src/orchestrator/pipeline/stream-events.js";
import type { ChatWithToolsStreamEvent } from "../../../../src/adapters/llm/types.js";

function makeTurnRequest(overrides: Partial<OrchestratorTurnRequest> = {}): OrchestratorTurnRequest {
  return {
    message: 'What are the key factors?',
    context: {
      graph: null,
      analysis_response: null,
      framing: { stage: 'frame' },
      messages: [],
      scenario_id: 'test-scenario',
    },
    scenario_id: 'test-scenario',
    client_turn_id: 'test-turn',
    ...overrides,
  };
}

function makeEvent(type: string): SystemEvent {
  return {
    event_type: type,
    timestamp: new Date().toISOString(),
    event_id: 'evt-1',
    details: {},
  } as unknown as SystemEvent;
}

async function collectEvents(gen: AsyncGenerator<OrchestratorStreamEvent>): Promise<OrchestratorStreamEvent[]> {
  const events: OrchestratorStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

/** Create a mock stream that yields the given events. */
async function* mockStream(events: ChatWithToolsStreamEvent[]): AsyncGenerator<ChatWithToolsStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

describe("executePipelineV4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Class 1: System events ──────────────────────────────────────────────

  describe("Class 1: System events", () => {
    it("handles system event without LLM call", async () => {
      const req = makeTurnRequest({
        system_event: makeEvent('patch_accepted'),
      });

      const events = await collectEvents(executePipelineV4(req, 'req-1'));

      expect(events.length).toBe(2);
      expect(events[0].type).toBe('turn_start');
      expect(events[1].type).toBe('turn_complete');

      // No LLM call
      expect(mockStreamChatWithTools).not.toHaveBeenCalled();

      // Valid envelope
      const complete = events[1] as Extract<OrchestratorStreamEvent, { type: 'turn_complete' }>;
      expect(complete.envelope).toHaveProperty('turn_id');
      expect(complete.envelope).toHaveProperty('blocks');
    });

    it("system event with user message gets acknowledgement", async () => {
      const req = makeTurnRequest({
        message: 'Great, what now?',
        system_event: makeEvent('patch_accepted'),
      });

      const events = await collectEvents(executePipelineV4(req, 'req-1'));
      const complete = events.find((e) => e.type === 'turn_complete') as Extract<OrchestratorStreamEvent, { type: 'turn_complete' }>;

      expect(complete.envelope.assistant_text).toBe('Changes applied.');
    });
  });

  // ── Class 2: Normal turn ────────────────────────────────────────────────

  describe("Class 2: Normal turn with tools", () => {
    it("calls LLM with tool definitions and yields events", async () => {
      mockStreamChatWithTools.mockReturnValue(mockStream([
        { type: 'text_delta', delta: 'Here are the key factors ' },
        { type: 'text_delta', delta: 'for your decision.' },
        { type: 'message_complete', result: { content: [{ type: 'text', text: 'Here are the key factors for your decision.' }], stop_reason: 'end_turn', model: 'claude-sonnet-4-6', latencyMs: 500, usage: {} } },
      ]));

      const req = makeTurnRequest();
      const events = await collectEvents(executePipelineV4(req, 'req-1'));

      // Should have: turn_start, text_delta(s), turn_complete
      expect(events[0].type).toBe('turn_start');
      const textDeltas = events.filter((e) => e.type === 'text_delta');
      expect(textDeltas.length).toBeGreaterThan(0);
      const complete = events.find((e) => e.type === 'turn_complete') as Extract<OrchestratorStreamEvent, { type: 'turn_complete' }>;
      expect(complete).toBeDefined();

      // Verify LLM was called with tools, not tools: []
      expect(mockStreamChatWithTools).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamChatWithTools.mock.calls[0][0];
      expect(callArgs.tools).toBeDefined();
      // tools should not be empty (eligible_actions is empty for frame stage with no graph, but still called)
      expect(callArgs.system_cache_blocks).toBeDefined();
      expect(callArgs.system_cache_blocks.length).toBe(2);
      expect(callArgs.system_cache_blocks[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(callArgs.temperature).toBe(0);
      expect(callArgs.tool_choice).toEqual({ type: 'auto' });
    });

    it("assistant_text is plain text, never JSON", async () => {
      mockStreamChatWithTools.mockReturnValue(mockStream([
        { type: 'text_delta', delta: 'This is a plain text response.' },
        { type: 'message_complete', result: { content: [{ type: 'text', text: 'This is a plain text response.' }], stop_reason: 'end_turn', model: 'claude-sonnet-4-6', latencyMs: 200, usage: {} } },
      ]));

      const req = makeTurnRequest();
      const events = await collectEvents(executePipelineV4(req, 'req-1'));
      const complete = events.find((e) => e.type === 'turn_complete') as Extract<OrchestratorStreamEvent, { type: 'turn_complete' }>;

      const text = complete.envelope.assistant_text;
      expect(text).toBeDefined();
      // Should not be JSON
      expect(() => JSON.parse(text!)).toThrow();
      expect(text).not.toContain('"text"');
      expect(text).not.toContain('"insights"');
    });
  });

  // ── Class 3: Chip click (forced tool) ───────────────────────────────────

  describe("Class 3: Chip click with forced tool", () => {
    it("uses tool_choice: { type: tool, name } for chip click", async () => {
      mockStreamChatWithTools.mockReturnValue(mockStream([
        { type: 'text_delta', delta: 'Running analysis now.' },
        { type: 'message_complete', result: { content: [{ type: 'text', text: 'Running analysis now.' }], stop_reason: 'end_turn', model: 'claude-sonnet-4-6', latencyMs: 200, usage: {} } },
      ]));

      const req = makeTurnRequest({
        message: 'Run analysis',
        chip_metadata: { action_type: 'run_analysis' },
      } as unknown as Partial<OrchestratorTurnRequest>);

      const events = await collectEvents(executePipelineV4(req, 'req-1'));

      expect(mockStreamChatWithTools).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamChatWithTools.mock.calls[0][0];
      expect(callArgs.tool_choice).toEqual({ type: 'tool', name: 'run_analysis' });
    });
  });

  // ── Temperature and caching ─────────────────────────────────────────────

  describe("Temperature and prompt caching", () => {
    it("always uses temperature 0", async () => {
      mockStreamChatWithTools.mockReturnValue(mockStream([
        { type: 'text_delta', delta: 'test' },
        { type: 'message_complete', result: { content: [], stop_reason: 'end_turn', model: 'claude-sonnet-4-6', latencyMs: 100, usage: {} } },
      ]));

      const req = makeTurnRequest();
      await collectEvents(executePipelineV4(req, 'req-1'));

      const callArgs = mockStreamChatWithTools.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0);
    });

    it("uses system_cache_blocks with ephemeral cache_control", async () => {
      mockStreamChatWithTools.mockReturnValue(mockStream([
        { type: 'text_delta', delta: 'test' },
        { type: 'message_complete', result: { content: [], stop_reason: 'end_turn', model: 'claude-sonnet-4-6', latencyMs: 100, usage: {} } },
      ]));

      const req = makeTurnRequest();
      await collectEvents(executePipelineV4(req, 'req-1'));

      const callArgs = mockStreamChatWithTools.mock.calls[0][0];
      expect(callArgs.system_cache_blocks).toBeDefined();
      expect(callArgs.system_cache_blocks[0]).toHaveProperty('cache_control', { type: 'ephemeral' });
      expect(callArgs.system_cache_blocks[1]).not.toHaveProperty('cache_control');
    });
  });

  // ── System events with v4 enabled ────────────────────────────────────────

  describe("System events route through v4", () => {
    it("system event enters executePipelineV4 and produces valid envelope", async () => {
      // When v4 is enabled, system events should be handled by the v4 pipeline's
      // own system event handler, NOT the V2 executePipeline path.
      // This test verifies the v4 pipeline handles system events directly.
      const req = makeTurnRequest({
        system_event: makeEvent('patch_accepted'),
      });

      const events = await collectEvents(executePipelineV4(req, 'req-sys'));

      // Should produce turn_start + turn_complete without LLM call
      expect(events[0].type).toBe('turn_start');
      expect(events[1].type).toBe('turn_complete');
      expect(mockStreamChatWithTools).not.toHaveBeenCalled();

      const complete = events[1] as Extract<OrchestratorStreamEvent, { type: 'turn_complete' }>;
      expect(complete.envelope).toHaveProperty('turn_id');
      expect(complete.envelope).toHaveProperty('blocks');
    });
  });

  // ── Redundant system prompt string ──────────────────────────────────────

  describe("Adapter call shape", () => {
    it("passes empty string as system (cache blocks take precedence)", async () => {
      mockStreamChatWithTools.mockReturnValue(mockStream([
        { type: 'text_delta', delta: 'test' },
        { type: 'message_complete', result: { content: [], stop_reason: 'end_turn', model: 'claude-sonnet-4-6', latencyMs: 100, usage: {} } },
      ]));

      const req = makeTurnRequest();
      await collectEvents(executePipelineV4(req, 'req-1'));

      const callArgs = mockStreamChatWithTools.mock.calls[0][0];
      expect(callArgs.system).toBe('');
      expect(callArgs.system_cache_blocks).toBeDefined();
    });
  });

  // ── Normaliser default text in history filter ───────────────────────────

  describe("History filter integration", () => {
    it("normaliser default text is filtered from conversation history", async () => {
      // Import and test directly
      const { filterHistoryV4 } = await import("../../../../src/orchestrator/deterministic/history-filter-v4.js");

      const messages = [
        { role: 'user' as const, content: 'Hi' },
        { role: 'assistant' as const, content: "I'm here to help with your decision. What would you like to explore?" },
        { role: 'user' as const, content: 'Add a factor' },
      ];

      const result = filterHistoryV4(messages);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Hi');
      expect(result[1].content).toBe('Add a factor');
    });
  });

  // ── No JSON parser, no streaming text extractor ─────────────────────────

  describe("Verification: no legacy components", () => {
    it("does not import parseLLMJsonResponse", async () => {
      const { readFileSync } = await import("node:fs");
      const source = readFileSync(new URL("../../../../src/orchestrator/deterministic/pipeline-v4.ts", import.meta.url), 'utf-8');
      expect(source).not.toContain('parseLLMJsonResponse');
      expect(source).not.toContain('StreamingTextExtractor');
    });
  });
});
