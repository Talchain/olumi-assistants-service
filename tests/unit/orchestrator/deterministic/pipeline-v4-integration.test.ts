/**
 * Integration tests for v4 pipeline infrastructure.
 *
 * Verifies adapter routing, provider-agnostic system prompt,
 * non-streaming fallback, and prompt builder async behavior.
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
  shouldUseStagingPrompts: () => false,
}));

// Mock prompt loader — controllable per test
const mockLoadPrompt = vi.fn().mockResolvedValue({ source: 'default', content: '' });
vi.mock("../../../../src/prompts/loader.js", () => ({
  loadPrompt: (...args: unknown[]) => mockLoadPrompt(...args),
}));

// Mock adapter router — captures task argument
const mockStreamChatWithTools = vi.fn();
const mockGetAdapter = vi.fn().mockReturnValue({
  name: 'anthropic',
  model: 'claude-sonnet-4-6',
  streamChatWithTools: mockStreamChatWithTools,
});
vi.mock("../../../../src/adapters/llm/router.js", () => ({
  getAdapter: (...args: unknown[]) => mockGetAdapter(...args),
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
import { buildDeterministicPromptV2, _resetPromptCacheForTesting } from "../../../../src/orchestrator/deterministic/prompt-builder-v2.js";
import type { OrchestratorTurnRequest } from "../../../../src/orchestrator/types.js";
import type { OrchestratorStreamEvent } from "../../../../src/orchestrator/pipeline/stream-events.js";
import type { ChatWithToolsStreamEvent } from "../../../../src/adapters/llm/types.js";
import type { DeterministicTurnContext } from "../../../../src/orchestrator/deterministic/types.js";

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

function makeTurnContext(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  return {
    stage: 'evaluate',
    entities: { nodes: new Map(), edges: [], option_ids: [], goal_id: null },
    graph_summary: { node_count: 3, edge_count: 2, option_count: 2, option_labels: ['A', 'B'], goal_label: 'Success', missing_structural: [] },
    analysis_summary: null,
    capabilities: { can_run_analysis: true, can_explain_results: false, can_edit_graph: true, can_compare_options: false, can_challenge: false, can_generate_artefact: false },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 3, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: ['run_analysis', 'set_factor_value'],
    disambiguation_hints: [],
    graph: null,
    analysis: null,
    conversational_state: null,
    scenario_id: 'test-scenario',
    turn_id: 'test-turn',
    analysis_inputs: null,
    ...overrides,
  };
}

async function collectEvents(gen: AsyncGenerator<OrchestratorStreamEvent>): Promise<OrchestratorStreamEvent[]> {
  const events: OrchestratorStreamEvent[] = [];
  for await (const event of gen) {
    events.push(event);
  }
  return events;
}

async function* mockStream(events: ChatWithToolsStreamEvent[]): AsyncGenerator<ChatWithToolsStreamEvent> {
  for (const event of events) {
    yield event;
  }
}

describe("v4 pipeline infrastructure integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadPrompt.mockResolvedValue({ source: 'default', content: '' });
  });

  // ── Adapter routing ────────────────────────────────────────────────────

  describe("adapter routing", () => {
    it("calls getAdapter with 'orchestrator' task", async () => {
      mockStreamChatWithTools.mockReturnValue(mockStream([
        { type: 'text_delta', delta: 'test' },
        { type: 'message_complete', result: { content: [{ type: 'text', text: 'test' }], stop_reason: 'end_turn', model: 'claude-sonnet-4-6', latencyMs: 100, usage: {} } },
      ]));

      await collectEvents(executePipelineV4(makeTurnRequest(), 'req-route'));

      expect(mockGetAdapter).toHaveBeenCalledWith('orchestrator');
      expect(mockGetAdapter).not.toHaveBeenCalledWith('anthropic');
    });
  });

  // ── Provider-agnostic system prompt ────────────────────────────────────

  describe("provider-agnostic system prompt", () => {
    it("passes non-empty system string alongside cache blocks", async () => {
      mockStreamChatWithTools.mockReturnValue(mockStream([
        { type: 'text_delta', delta: 'test' },
        { type: 'message_complete', result: { content: [{ type: 'text', text: 'test' }], stop_reason: 'end_turn', model: 'claude-sonnet-4-6', latencyMs: 100, usage: {} } },
      ]));

      await collectEvents(executePipelineV4(makeTurnRequest(), 'req-sys'));

      const callArgs = mockStreamChatWithTools.mock.calls[0][0];
      expect(callArgs.system).toBeDefined();
      expect(callArgs.system.length).toBeGreaterThan(0);
      expect(callArgs.system_cache_blocks).toBeDefined();
      expect(callArgs.system_cache_blocks.length).toBe(2);
    });

    it("system string contains both static and dynamic content", async () => {
      mockStreamChatWithTools.mockReturnValue(mockStream([
        { type: 'text_delta', delta: 'test' },
        { type: 'message_complete', result: { content: [{ type: 'text', text: 'test' }], stop_reason: 'end_turn', model: 'claude-sonnet-4-6', latencyMs: 100, usage: {} } },
      ]));

      await collectEvents(executePipelineV4(makeTurnRequest(), 'req-combined'));

      const callArgs = mockStreamChatWithTools.mock.calls[0][0];
      // system should contain the static block content (Olumi identity)
      expect(callArgs.system).toContain('Olumi');
      // system should contain dynamic block content (stage info)
      expect(callArgs.system).toContain('Stage:');
    });
  });

  // ── Non-streaming fallback ─────────────────────────────────────────────

  describe("non-streaming fallback via message_complete", () => {
    it("extracts text from message_complete when no text_delta events were received", async () => {
      // Simulate adapter fallback: only message_complete, no streaming events
      mockStreamChatWithTools.mockReturnValue(mockStream([
        { type: 'message_complete', result: {
          content: [{ type: 'text', text: 'Response from non-streaming path.' }],
          stop_reason: 'end_turn',
          model: 'gpt-4.1',
          latencyMs: 300,
          usage: {},
        }},
      ]));

      const events = await collectEvents(executePipelineV4(makeTurnRequest(), 'req-fallback'));

      // Should still produce text_delta events from the message_complete extraction
      const textDeltas = events.filter(e => e.type === 'text_delta');
      expect(textDeltas.length).toBeGreaterThan(0);

      // Final envelope should contain the text
      const complete = events.find(e => e.type === 'turn_complete') as Extract<OrchestratorStreamEvent, { type: 'turn_complete' }>;
      expect(complete).toBeDefined();
      expect(complete.envelope.assistant_text).toContain('Response from non-streaming path');
    });
  });

  // ── Prompt builder async behavior ──────────────────────────────────────

  describe("prompt builder PMS integration", () => {
    beforeEach(() => {
      _resetPromptCacheForTesting();
    });

    it("uses PMS content when loadPrompt returns source: store", async () => {
      const pmsContent = 'You are a custom PMS-managed assistant.';
      mockLoadPrompt.mockResolvedValue({ source: 'store', content: pmsContent, promptId: 'p1', version: 42 });

      const ctx = makeTurnContext();
      const result = await buildDeterministicPromptV2(ctx);

      // Static block is the PMS content followed by the v4 runtime tool-use
      // suffix. The suffix is appended unconditionally (Task 5) so the LLM
      // gets an explicit native-tool-calling instruction even when the PMS
      // body still carries dead JSON/XML envelope text.
      expect(result.static_block.startsWith(pmsContent)).toBe(true);
      expect(result.static_block).toContain('native tool calling');
    });

    it("falls back to STATIC_PROMPT_FALLBACK when loadPrompt returns source: default", async () => {
      mockLoadPrompt.mockResolvedValue({ source: 'default', content: '' });

      const ctx = makeTurnContext();
      const result = await buildDeterministicPromptV2(ctx);

      // Fallback contains the Olumi identity
      expect(result.static_block).toContain('Olumi');
      expect(result.static_block).toContain('science-powered decision coach');
    });

    it("falls back gracefully when loadPrompt throws", async () => {
      mockLoadPrompt.mockRejectedValue(new Error('Store unavailable'));

      const ctx = makeTurnContext();
      const result = await buildDeterministicPromptV2(ctx);

      // Should use fallback, not throw
      expect(result.static_block).toContain('Olumi');
    });
  });
});
