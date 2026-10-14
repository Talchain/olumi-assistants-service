import { describe, expect, it, vi } from 'vitest';
import { SupabaseSessionStore } from '../supabase-store.js';
import type { SessionStore } from '../store.js';
import { createMockSessionStore } from '../../../../tests/utils/mock-session-store.js';
import Fastify from 'fastify';

const routeStore = vi.hoisted(() => ({ value: null as SessionStore | null }));
vi.mock('../index.js', async original => ({
  ...(await original<typeof import('../index.js')>()), getSessionStore: () => routeStore.value!,
}));
vi.mock('../../../config/index.js', async original => {
  const actual = await original<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } } };
});
vi.mock('../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_target, key) => String(key) }),
}));
import scenarioGraphRoute from '../../../routes/assist.v1.scenario-graph.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
describe('canonical view scenario snapshot revision', () => {
  it('DATA-REVISION: reads graph and revision in one existing-scenario SELECT', async () => {
    const row = { id: SCENARIO, user_id: null, graph: { nodes: [], edges: [] }, brief_text: 'A brief', analysis_invalidated_at: null, revision: 7, created_at: '2026-10-09T10:00:00Z' };
    const select = vi.fn();
    const query = { select, eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: row, error: null })) };
    select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const client = { from: vi.fn(() => query) };
    const store = new SupabaseSessionStore(client as never, {} as never, {} as never);
    const snapshot = await store.readExistingScenario(SCENARIO);
    expect(select).toHaveBeenCalledExactlyOnceWith('id, user_id, graph, brief_text, analysis_invalidated_at, revision, created_at');
    expect(snapshot).toMatchObject({ graph: row.graph, revision: 7, createdAt: row.created_at });
    expect(client.from).toHaveBeenCalledExactlyOnceWith('scenarios');
    expect(query.maybeSingle).toHaveBeenCalledTimes(1);
  });
});

describe('scenario creation timestamp on the existing graph read', () => {
  it.each(['2026-10-09T10:00:00Z', undefined, 'not-a-timestamp'])('/graph carries the same stored brief and server creation date: %s', async created_at => {
    const row = { id: SCENARIO, user_id: null, graph: { nodes: [], edges: [] }, brief_text: 'The stored brief',
      analysis_invalidated_at: null, revision: 7, created_at };
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(async () => ({ data: row, error: null })) };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    const client = { from: vi.fn(() => query) };
    const store = new SupabaseSessionStore(client as never, {} as never, {} as never);
    routeStore.value = createMockSessionStore({ readExistingScenario: id => store.readExistingScenario(id) });
    const app = Fastify();
    try {
      await scenarioGraphRoute(app);
      const response = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ graph: row.graph, brief_text: row.brief_text,
        scenario_created_at: created_at === '2026-10-09T10:00:00Z' ? created_at : null });
      expect(client.from).toHaveBeenCalledExactlyOnceWith('scenarios');
      expect(query.select).toHaveBeenCalledExactlyOnceWith('id, user_id, graph, brief_text, analysis_invalidated_at, revision, created_at');
      expect(query.maybeSingle).toHaveBeenCalledTimes(1);
    } finally { await app.close(); routeStore.value = null; }
  });
});
