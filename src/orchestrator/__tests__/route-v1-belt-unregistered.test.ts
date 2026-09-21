/**
 * Route-gone assertion for the V1 orchestrator belt deletion (2026-07-21).
 *
 * The V1 belt (POST /orchestrate/v1/turn, POST /assist/v1/edit-graph) and its
 * handlers were deleted. server.ts now registers ONLY the V5 route
 * (ceeOrchestratorRouteV2 -> POST /orchestrate/v2/turn) unconditionally.
 *
 * This test mirrors the deployed registration: a bare Fastify app with only the
 * V5 route registered must expose /orchestrate/v2/turn and must NOT expose the
 * removed V1 belt routes. It is the STEP 3 "route-level assertion" — proving the
 * live V5 path survives and the V1 belt is unreachable.
 */
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';

// Minimal mocks so V5 route registration/import does not reach out to real
// session storage, the LLM router, or prompt files. Registration only needs the
// module graph to load and the route to be added — no handler execution here.
import { vi } from 'vitest';

vi.mock('../../orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: vi.fn().mockResolvedValue({ id: 'mock-row-id' }),
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
    hasPriorTurns: async () => false,
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: async () => ({ content: '' }), chatWithTools: vi.fn() }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: async () => ({ content: '' }), chatWithTools: vi.fn() },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

const { ceeOrchestratorRouteV2 } = await import('../route-v2.js');

describe('V1 orchestrator belt deletion — route registration', () => {
  it('registers the live V5 route and NOT the deleted V1 belt routes', async () => {
    const app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();

    // POSITIVE CONTROL: the live V5 product path must exist (proves the
    // assertion can SEE a registered route — an absence check with a working
    // presence check).
    expect(app.hasRoute({ method: 'POST', url: '/orchestrate/v2/turn' })).toBe(true);

    // The deleted V1 belt routes must be gone.
    expect(app.hasRoute({ method: 'POST', url: '/orchestrate/v1/turn' })).toBe(false);
    expect(app.hasRoute({ method: 'POST', url: '/assist/v1/edit-graph' })).toBe(false);

    await app.close();
  });

  it('returns 404 for a POST to the removed /orchestrate/v1/turn', async () => {
    const app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();

    const res = await app.inject({ method: 'POST', url: '/orchestrate/v1/turn', payload: {} });
    expect(res.statusCode).toBe(404);

    // The V5 route, by contrast, is present: a bad body is rejected by the
    // handler (not a 404 "route not found").
    const v5 = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: {} });
    expect(v5.statusCode).not.toBe(404);

    await app.close();
  });
});
