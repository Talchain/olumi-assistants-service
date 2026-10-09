/** Real executor/HTTP/SSE paths; only the provider and persistence ports are doubles. */
import Fastify from 'fastify';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SessionStore } from '../session/store.js';
import { createMockSessionStore } from '../../../tests/utils/mock-session-store.js';
import { installOwnershipHarness, verifyFixtureIdentity } from '../../../tests/utils/ownership-route-harness.js';
import { ceeOrchestratorRouteV2 } from '../../orchestrator/route-v2.js';
import streamRoute from '../../routes/orchestrate.v2.turn-stream.js';
import proxyStreamRoute from '../../routes/proxy-v5-turn-stream.js';

const state = vi.hoisted(() => ({ store: undefined as SessionStore | undefined }));
vi.mock('../session/index.js', async load => ({
  ...await load<typeof import('../session/index.js')>(), getSessionStore: () => state.store!,
}));
vi.mock('../../utils/supabase-user-jwt.js', async load => ({
  ...await load<typeof import('../../utils/supabase-user-jwt.js')>(),
  verifySupabaseUserJwt: (token: string) => verifyFixtureIdentity(token),
}));
vi.mock('../../adapters/llm/router.js', async load => {
  const actual = await load<typeof import('../../adapters/llm/router.js')>();
  const adapter = { name: 'ownership-wire', chat: vi.fn(), chatWithTools: vi.fn(async () => ({
    content: [{ type: 'text', text: 'Consider the assumptions together.' }],
    stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, model: 'ownership-wire', latencyMs: 0,
  })) };
  return { ...actual, getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { resolved_model: adapter.name, resolution_source: 'task_default' } }) };
});
vi.mock('../../adapters/llm/prompt-loader.js', async load => ({
  ...await load<typeof import('../../adapters/llm/prompt-loader.js')>(), getSystemPrompt: async () => 'fixture',
}));
vi.mock('../../config/index.js', async load => {
  const actual = await load<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config,
    auth: { ...actual.config.auth, requireUserJwt: false, assistApiKey: 'ownership-wire-fixture-key' },
    proxy: { ...actual.config.proxy, proxyV5Target: 'orchestrator', browserProxyEnabled: true,
      browserProxyAllowedOrigins: 'https://staging--olumi.netlify.app' },
  } };
});
const SID = 'a6ccf5cf-aab0-4f01-b889-e0d6c072067c';
const OWNER = 'u-owner';
const GRAPH = { nodes: [{ id: 'goal', kind: 'goal', label: 'Growth' }, { id: 'factor', kind: 'factor', label: 'Capacity' }], edges: [] };
const REFUSAL = { error: 'model_write_ownership_refused', message: 'Nothing was saved. This model belongs to another account.' };
beforeEach(() => vi.clearAllMocks());

const ROUTES = ['/orchestrate/v2/turn', '/orchestrate/v2/turn/stream', '/proxy/v5/turn/stream'];
it.each(ROUTES.flatMap(route => (['not_owner', 'owner_unreadable'] as const).map(reason => ({ route, reason }))))(
  'door refusal $reason on $route is honest, terminal, and distinct from a revision conflict', async ({ route, reason }) => {
    const append = vi.fn(async () => ({ id: 'must-not-write' }));
    const appendIfLatest = vi.fn(async () => ({ id: 'must-not-write' }));
    // Admission still sees the owner; the door catches ownership changing before commit.
    const getScenarioOwner = vi.fn(async () => {
      if (reason === 'owner_unreadable') throw new Error('ownership reader unavailable');
      return 'u-other';
    });
    state.store = createMockSessionStore({ append, appendIfLatest, getScenarioOwner,
      readExistingScenario: async () => ({ userId: OWNER, graph: GRAPH, briefText: null, analysisInvalidatedAt: null }),
      loadGraph: async () => GRAPH, loadGraphAndBriefText: async () => ({ graph: GRAPH, briefText: null }),
    });
    const app = Fastify();
    try {
      await installOwnershipHarness(app, () => ({ mode: 'verified', userId: OWNER }));
      await ceeOrchestratorRouteV2(app); await streamRoute(app); await proxyStreamRoute(app);
      const response = await app.inject({ method: 'POST', url: route,
        headers: { 'x-request-id': 'door-r2', origin: 'https://staging--olumi.netlify.app' },
        payload: { kind: 'message', scenario_id: SID, turn_id: 'b1111111-1111-4111-8111-111111111111',
          message: 'Consider the strategic framing.', turn_class: 'frame', stage: 'analyse', source: 'composer' },
      });
      let body: unknown;
      if (route.endsWith('/stream')) {
        expect(response.statusCode).toBe(200); // SSE transport status; the terminal status is below.
        const rawFrames = response.payload.split('\n\n').filter(f => f.startsWith('event: stage\n'));
        const frames = rawFrames.map(f => JSON.parse(f.split('\ndata: ')[1]!) as { stage: string; status_code?: number; payload?: unknown });
        const terminal = frames.filter(f => f.stage === 'COMPLETE');
        expect(terminal).toHaveLength(1);
        process.stdout.write(`OWNERSHIP_WIRE ${route} ${JSON.stringify(terminal[0])}\n`);
        const rawTerminal = rawFrames.find(f => f.includes('"stage":"COMPLETE"'))!;
        process.stdout.write(`OWNERSHIP_SSE_BYTES ${route} ${JSON.stringify(rawTerminal + '\n\n')}\n`);
        expect(rawTerminal).toBe(`event: stage\ndata: ${JSON.stringify(terminal[0])}`);
        expect(terminal[0]!.status_code).toBe(403); body = terminal[0]!.payload;
        expect(frames.at(-1)).toBe(terminal[0]);
      } else {
        process.stdout.write(`OWNERSHIP_WIRE ${route} ${response.payload}\n`);
        expect(response.statusCode, response.payload).toBe(403); body = response.json();
      }
      expect(body).toEqual(reason === 'not_owner' ? REFUSAL : { ...REFUSAL,
        message: 'Nothing was saved. Model ownership could not be verified.',
      });
      expect(JSON.stringify(body)).not.toContain('revision_conflict');
      expect(JSON.stringify(body)).not.toContain('The scenario changed while I was saving');
      expect(append).not.toHaveBeenCalled(); expect(appendIfLatest).not.toHaveBeenCalled();
      expect(getScenarioOwner).toHaveBeenCalledExactlyOnceWith(SID);
    } finally { await app.close(); state.store = undefined; }
  }, 30_000,
);
