/**
 * ⛔ Every Agent turn runs under the OpenAI-only provider policy — and the policy
 * reaches the CONVENTIONAL handlers the Agent dispatches to internally.
 *
 * Measured on served c4a6cce: the Agent's run_analysis reached the legacy
 * decision_review (Claude) through `/orchestrate/v2/turn`. The guard only works if the
 * request-scoped policy survives that internal `app.inject()` hop, so this records
 * the policy AS SEEN INSIDE the internal handler, through the real route.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { currentProviderPolicy } from '../../../adapters/llm/provider-policy.js';

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

const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('the Agent route is OpenAI-only, all the way down', () => {
  let app: FastifyInstance;
  const seenInsideOrchestrate: (string | null)[] = [];
  let call = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      const output = call === 1
        ? [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }]
        : [{ type: 'message', content: [{ type: 'output_text', text: 'Here is the comparison.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const policyMod = await import('../../../adapters/llm/provider-policy.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      // What a conventional handler (e.g. decision_review) would see.
      seenInsideOrchestrate.push(policyMod.currentProviderPolicy()?.route ?? null);
      return { response_version: 2, assistant_text: 'ok', blocks: [], suggested_actions: [], insights: [], graph_hash: 'h1' };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] }, graph_hash: 'h1' }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: the Agent’s run_analysis dispatch reaches the conventional handler UNDER the OpenAI-only policy', async () => {
    seenInsideOrchestrate.length = 0;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis.' } });
    expect(r.statusCode).toBe(200);
    expect(seenInsideOrchestrate).toEqual(['agent_v1_turn']);
  });

  it('RED: a forwarded canvas edit is under the same policy', async () => {
    seenInsideOrchestrate.length = 0;
    await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: '11111111-1111-4111-8111-111111111111', stage: 'analyse', event: { kind: 'factor_value_edit', target_id: 'f', value: 0.5, field: 'value' } } });
    expect(seenInsideOrchestrate).toEqual(['agent_v1_turn']);
  });

  it('CONTRAST: a request that does not come through the Agent route has no policy', () => {
    expect(currentProviderPolicy()).toBeUndefined();
  });
});
