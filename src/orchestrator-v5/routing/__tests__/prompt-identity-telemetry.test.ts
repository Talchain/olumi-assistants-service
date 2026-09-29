/**
 * ROADMAP 1.32 — telemetry identity stamp.
 *
 * Turn-lifecycle telemetry (turn-executor `obsPayload()`) and the routing
 * prompt-cache event (`emitV5PromptCache` in route-with-tool-use.ts) used to
 * stamp `prompt_version` / `prompt_hash` / `system_chars` from the static
 * repo-default constants (ROUTING_PROMPT_VERSION 'v40' / 21,439 chars) even
 * when the served PMS snapshot was a different prompt (live specimen:
 * version 112 / 21,860 chars) — every turn-lifecycle event misreported the
 * prompt identity. These tests pin the fix: both emit sites prefer the
 * cached routing-prompt snapshot identity via
 * `getCachedRoutingPromptIdentity()`, falling back to the constants only
 * when the snapshot has not been built yet. Field names are unchanged
 * (`prompt_version`, `prompt_hash`, `system_chars`) so dashboards keep
 * joining on the same keys.
 *
 * Only the prompt store is mocked (getCompiled / db-health) plus the
 * Supabase session store — the rest of the module graph is real.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

// Hoisted so the (hoisted) vi.mock factory can close over it.
const { getCompiledMock } = vi.hoisted(() => ({ getCompiledMock: vi.fn() }));

vi.mock('../../../prompts/store.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../prompts/store.js')>();
  return {
    ...actual,
    isDbBackedStoreHealthy: () => true,
    getPromptStore: () =>
      ({ getCompiled: getCompiledMock, get: vi.fn(async () => null) }) as unknown as ReturnType<
        typeof actual.getPromptStore
      >,
  };
});

// Session store mock — no Supabase (same shape as the turn-executor tests).
vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({
      scope,
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => {},
}));

import { setTestSink } from '../../../utils/telemetry.js';
import {
  buildRoutingPromptSnapshot,
  getCachedRoutingPromptIdentity,
  __resetRoutingPromptSnapshotForTests,
  ROUTING_PROMPT_VERSION,
} from '../prompt-loader.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../../adapters/llm/types.js';

const { runTurnExecutor } = await import('../../turn-executor.js');

// Live-specimen shape: PMS orchestrator version 112 at 21,860 chars —
// inside the routing guard [18,500, 22,000] and distinct from the bundled
// v40 default (21,439 chars).
const SERVED_VERSION = 112;
const SERVED_CONTENT = 'X'.repeat(21_860);
// No newlines / trailing whitespace → the snapshot normaliser is identity,
// so sent_hash is just sha256(SERVED_CONTENT) prefixed.
const SERVED_SENT_HASH = createHash('sha256')
  .update(SERVED_CONTENT)
  .digest('hex')
  .slice(0, 16);

const BASE_PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'Why does the leading option win?',
  turn_class: 'frame',
  stage: 'frame',
};

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];

function textOnlyAdapter() {
  return {
    chatWithTools: vi.fn(
      async (
        _args: ChatWithToolsArgs,
        _opts: { requestId: string },
      ): Promise<ChatWithToolsResult> => ({
        content: [{ type: 'text', text: 'A conversational answer.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 } as unknown as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 50,
      }),
    ),
  };
}

beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
  getCompiledMock.mockReset();
  __resetRoutingPromptSnapshotForTests();
});
afterEach(() => {
  setTestSink(null);
  __resetRoutingPromptSnapshotForTests();
  vi.restoreAllMocks();
});

describe('getCachedRoutingPromptIdentity()', () => {
  it('returns null before the snapshot is built (callers fall back to constants)', () => {
    expect(getCachedRoutingPromptIdentity()).toBeNull();
  });

  it('returns the SERVED snapshot identity after build — version/sent_hash/system_chars', async () => {
    getCompiledMock.mockResolvedValue({
      content: SERVED_CONTENT,
      promptId: 'orchestrator_default',
      version: SERVED_VERSION,
    });
    await buildRoutingPromptSnapshot();

    const identity = getCachedRoutingPromptIdentity();
    expect(identity).not.toBeNull();
    expect(identity!.version).toBe('112');
    expect(identity!.sent_hash).toBe(SERVED_SENT_HASH);
    expect(identity!.system_chars).toBe(21_860);
    // The whole point: the served identity is NOT the repo-default constant.
    expect(identity!.version).not.toBe(ROUTING_PROMPT_VERSION);
  });
});

describe('obsPayload + emitV5PromptCache carry the served snapshot identity (ROADMAP 1.32)', () => {
  it('turn-lifecycle events report the PMS snapshot identity, not v40/21,439', async () => {
    getCompiledMock.mockResolvedValue({
      content: SERVED_CONTENT,
      promptId: 'orchestrator_default',
      version: SERVED_VERSION,
    });
    await buildRoutingPromptSnapshot();

    await runTurnExecutor(BASE_PAYLOAD, 'req-identity-1', {
      routingAdapter: textOnlyAdapter(),
    });

    // obsPayload-consuming lifecycle event (emitted before routing, so it
    // proves the emit site reads the cached snapshot, not the routing call).
    const started = events.find((e) => e.event === 'turn_executor.started');
    expect(started).toBeDefined();
    expect(started!.data.prompt_version).toBe('112');
    expect(started!.data.prompt_hash).toBe(SERVED_SENT_HASH);
    expect(started!.data.system_chars).toBe(21_860);
    expect(started!.data.prompt_version).not.toBe('v40');

    // emitV5PromptCache site in route-with-tool-use.ts — same identity.
    const cacheEvent = events.find((e) => e.event === 'v5.prompt_cache');
    expect(cacheEvent).toBeDefined();
    expect(cacheEvent!.data.prompt_version).toBe('112');
    expect(cacheEvent!.data.sent_hash).toBe(SERVED_SENT_HASH);
  });

  it('falls back to the repo-default constants when the snapshot is not yet built', async () => {
    // No snapshot build before the turn. The turn_executor.started event
    // fires BEFORE the routing call lazily builds the snapshot, so it must
    // carry the constant fallback rather than throwing.
    getCompiledMock.mockResolvedValue(null); // PMS empty → default fallback
    await runTurnExecutor(BASE_PAYLOAD, 'req-identity-2', {
      routingAdapter: textOnlyAdapter(),
    });

    const started = events.find((e) => e.event === 'turn_executor.started');
    expect(started).toBeDefined();
    expect(started!.data.prompt_version).toBe(ROUTING_PROMPT_VERSION);
    expect(typeof started!.data.prompt_hash).toBe('string');
    expect(typeof started!.data.system_chars).toBe('number');
  });
});
