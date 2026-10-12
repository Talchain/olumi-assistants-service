/**
 * ⭐ RECOVERY BATCH E (DL ruling, 12 Oct): THE V5 ROUTE'S EXIT REMOVES A SHARE OF RUNS (non-Agent path).
 *
 * The real `POST /orchestrate/v2/turn` (real route-v2 + real TurnExecutor; mocked LLM router + session store; the harness of
 * `route-v2-diagnostic-trace-llm-calls.test.ts`). The exit function (`withoutRunShareTextAtEgress`, the real one, wrapped
 * by a spy) runs on this exit path, LAST: what it returns is byte for byte what ships. With no licensed Run, this route's
 * withheld-explanation guard already replaces any run talk, so a converse probe cannot isolate the exit; the census
 * (`run-share-census.test.ts`) proves what the function removes. Mutation: drop the route's call and the spy is never
 * called (RED).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { _resetConfigCache } from '../../config/index.js';
import { RUN_SHARE_CENSUS } from '../../orchestrator-v5/compose/run-share-text.js';

const exitCalls: { exitPath: string; returned: Record<string, unknown> }[] = [];
vi.mock('../../orchestrator-v5/compose/run-share-text.js', async () => {
  const actual = await vi.importActual<typeof import('../../orchestrator-v5/compose/run-share-text.js')>('../../orchestrator-v5/compose/run-share-text.js');
  return { ...actual, withoutRunShareTextAtEgress: <T extends object>(body: T, opts: { exitPath: string }): T => {
    const returned = actual.withoutRunShareTextAtEgress(body, opts);
    exitCalls.push({ exitPath: opts.exitPath, returned: returned as Record<string, unknown> });
    return returned;
  } };
});
import type { ChatWithToolsResult } from '../../adapters/llm/types.js';

const SCENARIO_ID = '55555555-5555-4555-8555-555555555555';
/** A reply that states an option's share of runs, then a sentence that must survive. */
const REPLY = 'Here is a brief reflection on your decision.';

const CONVERSE_MODEL = 'claude-sonnet-4-6';
const CONVERSE_INPUT_TOKENS = 4200;
const CONVERSE_OUTPUT_TOKENS = 137;
const CONVERSE_CACHE_READ = 150;

// The routing LLM call returns a text-only result → routing interprets it as a
// converse/direct-answer turn (no tool_use, no handler dispatch, no PLoT).
const chatWithToolsMock = vi.fn(async (): Promise<ChatWithToolsResult> => ({
  content: [{ type: 'text', text: REPLY }],
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

describe('POST /orchestrate/v2/turn — no CEE text states an option\'s share of runs on the wire', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubEnv('ENABLE_V5_ORCHESTRATOR', 'true');
    vi.stubEnv('CEE_PIPELINE_V4_ENABLED', 'false');
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

  it('the exit runs on this route, last: what it returns is what ships; the census finds nothing', async () => {
    exitCalls.length = 0;
    const res = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: payload() });
    expect(res.statusCode).toBe(200);
    expect(chatWithToolsMock).toHaveBeenCalled();
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(exitCalls.map((c) => c.exitPath)).toEqual(['turn_executor']);
    expect(exitCalls[0]!.returned.assistant_text).toBe(body.assistant_text);
    expect(exitCalls[0]!.returned.blocks).toEqual(body.blocks);
    expect(res.body).not.toMatch(RUN_SHARE_CENSUS);
  });
});
