/**
 * Server-boot test — verifies the /orchestrate/v2/turn route registration
 * follows the ENABLE_V5_ORCHESTRATOR flag.
 *
 * A1 scope:
 *   - Flag ON → POST /orchestrate/v2/turn is registered (non-404 on a payload)
 *   - Flag OFF → POST /orchestrate/v2/turn returns 404
 *
 * The LLM adapter and prompt loader are mocked so boot exercise doesn't touch
 * a real provider (Paul's constraint 9).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
}));
vi.mock('../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test prompt',
}));

// v5-maintenance: mock session store so commit succeeds without Supabase.
vi.mock('../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'boot-mock-row' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    checkScenarioExists: async () => true,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

let flagEnabled = true;
vi.mock('../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'orchestratorV5') return flagEnabled;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

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

describe('server-boot: /orchestrate/v2/turn registration is flag-gated', () => {
  beforeEach(() => {
    flagEnabled = true;
  });

  it('flag ON: route registered → POST succeeds (200)', async () => {
    flagEnabled = true;
    const app = Fastify();
    // Mirrors src/server.ts:952-955 flag-gated registration.
    if (flagEnabled) {
      await ceeOrchestratorRouteV2(app);
    }
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('flag OFF: route not registered → 404', async () => {
    flagEnabled = false;
    const app = Fastify();
    if ((flagEnabled as boolean)) {
      await ceeOrchestratorRouteV2(app);
    }
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: VALID_PAYLOAD,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
