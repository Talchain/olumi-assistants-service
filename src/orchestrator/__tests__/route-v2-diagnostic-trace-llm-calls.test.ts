/**
 * FULL-ROUTE wiring test (observability lane) — the WIRE
 * `_diagnostic_trace.llm_calls` must be NON-EMPTY on a turn_executor turn.
 *
 * This drives `POST /orchestrate/v2/turn` end-to-end (real route-v2 + real
 * TurnExecutor; mocked LLM router + session store) with
 * `CEE_DIAGNOSTIC_TRACE_ENABLED=true`, then reads the wire body's
 * `_diagnostic_trace`. Before the fix, `sendFinalised200`'s minimal-trace
 * builder was called WITHOUT the turn's `turnTimings`, so `llm_calls` was
 * structurally always `[]` even though a Sonnet routing call happened.
 *
 * MUTATION-CHECK: revert EITHER the `finalizeRun` `turnTimings` exposure OR
 * route-v2's `turnTimings: run.turnTimings` / `turnTimings: ctx.turnTimings`
 * threading and this test goes RED (`llm_calls` collapses to `[]`) — proving
 * it exercises the real production wiring, not a builder in isolation.
 *
 * Harness mirrors `route-v2-held-proposal-confirm.test.ts`, but forces the
 * routing LLM call to return a TEXT-ONLY (converse) result so the turn takes
 * the deterministic direct-answer commit path without a PLoT round-trip.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { _resetConfigCache } from '../../config/index.js';
import type { ChatWithToolsResult } from '../../adapters/llm/types.js';

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';

const CONVERSE_MODEL = 'claude-sonnet-4-6';
const CONVERSE_INPUT_TOKENS = 4200;
const CONVERSE_OUTPUT_TOKENS = 137;
const CONVERSE_CACHE_READ = 150;

// The routing LLM call returns a text-only result → routing interprets it as a
// converse/direct-answer turn (no tool_use, no handler dispatch, no PLoT).
const chatWithToolsMock = vi.fn(async (): Promise<ChatWithToolsResult> => ({
  content: [{ type: 'text', text: 'Here is a brief reflection on your decision.' }],
  stop_reason: 'end_turn',
  usage: {
    input_tokens: CONVERSE_INPUT_TOKENS,
    output_tokens: CONVERSE_OUTPUT_TOKENS,
    cache_read_input_tokens: CONVERSE_CACHE_READ,
  },
  model: CONVERSE_MODEL,
  latencyMs: 640,
}));

vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: CONVERSE_MODEL,
    chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: chatWithToolsMock,
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: CONVERSE_MODEL,
      chat: async () => ({ content: 'reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: chatWithToolsMock,
    },
    resolution: {
      task: 'orchestrator',
      resolved_model: CONVERSE_MODEL,
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    readMostRecentPendingActions: async () => [],
    hasPriorTurns: async () => true,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'message',
    turn_id: '66666666-6666-4666-8666-666666666666',
    scenario_id: SCENARIO_ID,
    stage: 'frame',
    message: 'What do you make of this?',
    turn_class: 'frame',
    source: 'composer',
    ...overrides,
  };
}

describe('POST /orchestrate/v2/turn — _diagnostic_trace.llm_calls is non-empty on a real turn (observability lane)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv('ENABLE_V5_ORCHESTRATOR', 'true');
    vi.stubEnv('CEE_PIPELINE_V4_ENABLED', 'false');
    vi.stubEnv('CEE_DIAGNOSTIC_TRACE_ENABLED', 'true');
    _resetConfigCache();
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    _resetConfigCache();
  });
  beforeEach(() => {
    appendMock.mockClear();
    chatWithToolsMock.mockClear();
  });

  it('flag ON: the wire _diagnostic_trace surfaces the routing LLM call in llm_calls[]', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: payload(),
    });

    expect(res.statusCode).toBe(200);
    // The routing LLM call actually fired.
    expect(chatWithToolsMock).toHaveBeenCalled();

    const body = JSON.parse(res.body) as Record<string, unknown>;
    const trace = body._diagnostic_trace as
      | { llm_calls: Array<Record<string, unknown>>; exit_path: string; correlation_ids: Record<string, unknown> }
      | undefined;

    // The trace is attached (flag on).
    expect(trace).toBeDefined();
    expect(trace!.exit_path).toBe('turn_executor');

    // THE FIX: llm_calls is non-empty and carries the REAL routing call, not [].
    expect(Array.isArray(trace!.llm_calls)).toBe(true);
    expect(trace!.llm_calls.length).toBeGreaterThanOrEqual(1);
    const call = trace!.llm_calls[0]!;
    expect(call.role).toBe('routing');
    expect(call.provider).toBe('anthropic');
    expect(call.model).toBe(CONVERSE_MODEL);
    expect(call.input_tokens).toBe(CONVERSE_INPUT_TOKENS);
    expect(call.output_tokens).toBe(CONVERSE_OUTPUT_TOKENS);
    expect(call.cache_read_tokens).toBe(CONVERSE_CACHE_READ);
    expect(typeof call.latency_ms).toBe('number');
    // Prompt identity threaded to the correlation IDs.
    expect(typeof trace!.correlation_ids.prompt_hash).toBe('string');
  });
});
