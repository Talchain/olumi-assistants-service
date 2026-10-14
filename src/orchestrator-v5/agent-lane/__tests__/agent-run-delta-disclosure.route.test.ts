/**
 * AI HARNESS — F5 I3.1 ("never says `prior_facts_absent`"). Every Agent turn reported the run delta as skipped for
 * `prior_facts_absent`: the lane's three finalise calls pass no facts, because the lane binds the Run's OWN delta from
 * the captured route-v2 response (`runDeltaBoundToReadback`). A false "no facts" on every turn hides the real ones.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';

const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const events: Array<{ name: string; data: Record<string, unknown> }> = [];

describe('the Agent lane names who binds the run delta', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'The link from team size matters most.' }] }] }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const telemetry = await import('../../../utils/telemetry.js');
    telemetry.setTestSink((name, data) => { events.push({ name, data: data as Record<string, unknown> }); });
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges: [] },
      graph_hash: 'h0',
      analysis_ready: { status: 'ready', may_run: true },
      analysis_state: { run_state: { kind: 'complete_current', computed_at: '2026-10-01T12:00:00.000Z' }, usable_for_chips: true, leader_claim: { permitted: false } },
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); setTestSink(null); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: an Agent turn reports caller_binds_run_delta, never prior_facts_absent', async () => {
    events.length = 0;
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: '8c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f', message: 'What matters most here?' } });
    expect(res.statusCode, res.body).toBe(200);
    const outcomes = events.filter((e) => e.name === TelemetryEvents.V5RunDeltaOutcome).map((e) => e.data.reason);
    expect(outcomes.length, 'vacuity: the finaliser disclosed').toBeGreaterThan(0);
    expect(outcomes).not.toContain('prior_facts_absent');
    expect(outcomes).toContain('caller_binds_run_delta');
  });
});
