/**
 * Cache-Hit Verification Test
 *
 * Verifies that the static prompt block produces a cache hit on the
 * second consecutive turn by checking that system_cache_blocks are
 * structured correctly for Anthropic prompt caching.
 *
 * This test validates the prompt caching design:
 * - Static block is marked with cache_control: { type: 'ephemeral' }
 * - Two consecutive turns with different dynamic blocks should produce
 *   a cache read on the second turn (assuming the adapter returns cache metrics)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

vi.mock("../../../../src/config/index.js", () => ({
  config: {
    features: { pipelineV4Enabled: true, deterministicOrchestratorEnabled: true },
    llm: { model: 'claude-sonnet-4-6', provider: 'anthropic' },
    promptCache: { anthropicEnabled: true },
    cee: { coachingContextEnabled: false, chipEngineEnabled: false },
  },
  shouldUseStagingPrompts: () => false,
}));

vi.mock("../../../../src/prompts/loader.js", () => ({
  loadPrompt: vi.fn().mockResolvedValue({ source: 'default', content: '' }),
}));

// Top-level mock for adapter router — captures all streamChatWithTools calls
const mockStreamChatWithTools = vi.fn();
vi.mock("../../../../src/adapters/llm/router.js", () => ({
  getAdapter: () => ({
    name: 'anthropic',
    model: 'claude-sonnet-4-6',
    streamChatWithTools: mockStreamChatWithTools,
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock("../../../../src/config/timeouts.js", () => ({
  ORCHESTRATOR_TIMEOUT_MS: 30000,
}));

vi.mock("../../../../src/orchestrator/context/context-hash.js", () => ({
  computeContextHash: () => 'abc123',
}));

vi.mock("../../../../src/orchestrator/guidance/post-analysis.js", () => ({
  generatePostAnalysisGuidance: () => [],
}));

import type { ChatWithToolsStreamEvent } from "../../../../src/adapters/llm/types.js";
import type { OrchestratorTurnRequest } from "../../../../src/orchestrator/types.js";
import type { OrchestratorStreamEvent } from "../../../../src/orchestrator/pipeline/stream-events.js";
import { executePipelineV4 } from "../../../../src/orchestrator/deterministic/pipeline-v4.js";

function mockStream(): ReturnType<typeof mockStreamChatWithTools> {
  return (async function* (): AsyncGenerator<ChatWithToolsStreamEvent> {
    yield { type: 'text_delta', delta: 'Response.' };
    yield {
      type: 'message_complete',
      result: {
        content: [{ type: 'text', text: 'Response.' }],
        stop_reason: 'end_turn',
        model: 'claude-sonnet-4-6',
        latencyMs: 100,
        usage: {
          input_tokens: 500,
          output_tokens: 50,
          cache_creation_input_tokens: 400,
          cache_read_input_tokens: 0,
        },
      },
    };
  })();
}

function makeReq(msg: string): OrchestratorTurnRequest {
  return {
    message: msg,
    context: {
      graph: null,
      analysis_response: null,
      framing: { stage: 'frame' },
      messages: [],
      scenario_id: 'test-scenario',
    },
    scenario_id: 'test-scenario',
    client_turn_id: 'test-turn',
  };
}

async function drain(gen: AsyncGenerator<OrchestratorStreamEvent>): Promise<void> {
  for await (const _event of gen) { /* drain */ }
}

describe("Prompt cache-hit verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStreamChatWithTools.mockImplementation(() => mockStream());
  });

  it("second turn receives system_cache_blocks with same static block as first turn", async () => {
    // Turn 1
    await drain(executePipelineV4(makeReq('What factors matter?'), 'req-1'));
    // Turn 2
    await drain(executePipelineV4(makeReq('Tell me more about the model'), 'req-2'));

    expect(mockStreamChatWithTools).toHaveBeenCalledTimes(2);

    const call1 = mockStreamChatWithTools.mock.calls[0][0] as Record<string, unknown>;
    const call2 = mockStreamChatWithTools.mock.calls[1][0] as Record<string, unknown>;

    // Both calls should use system_cache_blocks
    expect(call1.system_cache_blocks).toBeDefined();
    expect(call2.system_cache_blocks).toBeDefined();

    const blocks1 = call1.system_cache_blocks as Array<{ type: string; text: string; cache_control?: { type: string } }>;
    const blocks2 = call2.system_cache_blocks as Array<{ type: string; text: string; cache_control?: { type: string } }>;

    // Static block (index 0) should be identical between turns
    expect(blocks1[0].text).toBe(blocks2[0].text);
    expect(blocks1[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(blocks2[0].cache_control).toEqual({ type: 'ephemeral' });

    // Static block should be non-trivial (> 100 chars)
    expect(blocks1[0].text.length).toBeGreaterThan(100);

    // Dynamic block (index 1) may differ between turns
    // but the static block being identical means the Anthropic cache can match it
  });

  it("dynamic block does not have cache_control", async () => {
    await drain(executePipelineV4(makeReq('test message'), 'req-cache'));

    expect(mockStreamChatWithTools).toHaveBeenCalledTimes(1);
    const blocks = (mockStreamChatWithTools.mock.calls[0][0] as Record<string, unknown>).system_cache_blocks as Array<{ type: string; text: string; cache_control?: { type: string } }>;
    expect(blocks.length).toBe(2);
    // Static block has cache_control
    expect(blocks[0].cache_control).toEqual({ type: 'ephemeral' });
    // Dynamic block does NOT have cache_control
    expect(blocks[1].cache_control).toBeUndefined();
  });
});
