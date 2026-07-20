/**
 * Server-boot test — verifies /orchestrate/v2/turn route registration.
 *
 * UNCONDITIONAL since 2026-07-20 (O-7 wave 2: ENABLE_V5_ORCHESTRATOR
 * deleted). Two pins:
 *   - the route registrar itself serves the route (direct registration);
 *   - the REAL `build()` server registers it (this is the make-unconditional
 *     MUTATION CHECK for server.ts — re-gate the registration behind a
 *     default-false conditional and the real-server pin goes RED with 404;
 *     the pre-deletion tests only ever self-simulated the server conditional
 *     in-test, so they could never catch the real gate).
 *
 * The LLM adapter and prompt loader are mocked so boot exercise doesn't touch
 * a real provider (Paul's constraint 9).
 */

import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';

const bootMockAdapter = {
  name: 'boot-mock',
  model: 'boot-mock',
  chat: async () => ({
    content: 'boot-ok',
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'boot-mock',
    latencyMs: 0,
  }),
  chatWithTools: async () => ({
    content: [{ type: 'text' as const, text: 'boot-ok' }],
    stop_reason: 'end_turn' as const,
    usage: { input_tokens: 1, output_tokens: 1 },
    model: 'boot-mock',
    latencyMs: 0,
  }),
};
vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: () => bootMockAdapter,
  // V5 routeWithToolUse resolves the adapter via getAdapterWithResolution.
  getAdapterWithResolution: (task?: string) => ({
    adapter: bootMockAdapter,
    resolution: {
      task,
      resolved_model: 'boot-mock',
      resolution_source: 'task_default' as const,
    },
  }),
  getMaxTokensFromConfig: () => undefined,
  // Real-server build() pin: server.ts warms the provider-config cache at boot.
  warmProviderConfigCache: async () => ({ loaded: false, path: '' }),
}));
// importOriginal-spread, NOT a hand-listed mock: the real server's request
// path also reads isCacheWarmingComplete (and future exports) from this
// module — a hand-list silently breaks them (proven: the first version of
// the real-server pin below 500'd in BOTH mutation states, passing
// vacuously, exactly the derive-don't-mirror trap).
vi.mock('../../src/adapters/llm/prompt-loader.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/adapters/llm/prompt-loader.js')>();
  return {
    ...original,
    getSystemPrompt: async () => 'test prompt',
  };
});

// v5-maintenance: mock session store so commit succeeds without Supabase.
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'boot-mock-row' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const { ceeOrchestratorRouteV2 } = await import('../../src/orchestrator/route-v2.js');

const VALID_PAYLOAD = {
  kind: 'message' as const,
  turn_id: '11111111-1111-4111-8111-111111111111',
  scenario_id: '22222222-2222-4222-8222-222222222222',
  message: 'hello',
  turn_class: 'frame' as const,
  stage: 'frame' as const,
  source: 'composer' as const,
};

// UPDATED 2026-07-20 (O-7 wave 2): ENABLE_V5_ORCHESTRATOR deleted —
// /orchestrate/v2/turn registration is UNCONDITIONAL in server.ts. The former
// flag-gated ON/OFF pair (which also self-simulated the server conditional
// in-test) collapses to the single unconditional registration case.
describe('server-boot: /orchestrate/v2/turn registration is unconditional', () => {
  it('route registered → POST succeeds (200)', async () => {
    const app = Fastify();
    // Mirrors src/server.ts: registration is unconditional.
    await ceeOrchestratorRouteV2(app);
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('REAL server build(): /orchestrate/v2/turn is registered unconditionally (never 404)', async () => {
    vi.stubEnv('LLM_PROVIDER', 'fixtures');
    const { build } = await import('../../src/server.js');
    const app = await build();
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/orchestrate/v2/turn',
        payload: VALID_PAYLOAD,
      });
      // POSITIVE assertion (a not-404 pin proved vacuous — see mock note
      // above): the mocked adapter/session make a valid turn SUCCEED, so
      // registration must yield 200; an unregistered route yields 404.
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
      vi.unstubAllEnvs();
    }
  });
});
