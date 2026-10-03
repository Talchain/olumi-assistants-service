/**
 * ⛔ AN EMPTY SCENARIO IS NOT A READBACK FAILURE.
 *
 * MEASURED on served staging `785185b7` (scenario `03b93536`, a turn whose build was
 * refused, so no graph existed yet): the graph read answered 200 with `graph: null`,
 * and `readBackState` dereferenced it (`g.nodes`), threw, and logged
 * `agent_lane.state_readback_failed` — "the client will not learn this turn's
 * revision, so a delete gesture stands down". Nothing had failed: there was simply no
 * model. The event is counted as a real readback failure, so every empty-scenario
 * turn (every refused build) inflated it with a false alarm.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '5b3c2d1e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('an empty scenario is read back without a false failure', () => {
  let app: FastifyInstance;
  let warn: ReturnType<typeof vi.spyOn>;
  let graphReply: Record<string, unknown> | string = {};
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'There is no model yet.' }] }] }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const telemetry = await import('../../../utils/telemetry.js');
    warn = vi.spyOn(telemetry.log, 'warn');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (_req, reply) => (typeof graphReply === 'string' ? reply.type('text/plain').send(graphReply) : graphReply));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const failures = () => warn.mock.calls.filter((c: unknown[]) => (c[0] as { event?: string } | undefined)?.event === 'agent_lane.state_readback_failed');

  it('RED: graph: null (no model yet) answers 200 and logs NO readback failure', async () => {
    warn.mockClear();
    graphReply = { graph: null, graph_present: false, graph_hash: null };
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Hello.' } });
    expect(r.statusCode).toBe(200);
    expect(failures(), JSON.stringify(failures()[0]?.[0] ?? null)).toHaveLength(0);
    expect(r.json().draft_graph, 'nothing to draw, so nothing is drawn').toBeUndefined();
  });

  // CONTRAST lives in `src/routes/__tests__/agent-readback-failure-is-visible.test.ts`: the
  // catch itself is unchanged and still speaks; only a missing model stops counting as a failure.
});
