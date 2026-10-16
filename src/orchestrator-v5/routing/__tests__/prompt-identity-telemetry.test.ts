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

import { createHash } from 'node:crypto';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

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
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => {},
}));

import { setTestSink } from '../../../utils/telemetry.js';
import {
__resetRoutingPromptSnapshotForTests,
buildRoutingPromptSnapshot,
getCachedRoutingPromptIdentity,
ROUTING_PROMPT_VERSION,
} from '../prompt-loader.js';



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



type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];



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
