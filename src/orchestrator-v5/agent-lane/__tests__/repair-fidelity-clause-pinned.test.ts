/**
 * ⛔ THE MEASURED REPAIR-FIDELITY SENTENCE IS PINNED ON THE WIRE (AI Quality, 25 Sep 2026).
 *
 * On served `e39f6e0` every explicit Run in the two standard journeys (pricing, hiring) left one user
 * limit unchecked, and the run named its repair: "Tell me which part of your model it applies to …
 * Then run the analysis again." The Agent's reply relayed that repair cleanly in 4/16 (it invented a
 * different fix — "state annual salary spend for each option", "an observed churn measure" — or said
 * nothing). With this one sentence: 11/16 (blind labels, 8 served states × 2, only `instructions`
 * varied). This spec binds to the instructions actually SENT on both reply-writing calls.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '7c3e9a1b-2d4f-4b6c-8a9e-1f2b3c4d5e6f';
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

const REPAIR_RULE = 'When the run says a condition could not be checked and names what it needs, give that repair in its own terms (for example, which part of the model a limit applies to, then run again), and do not propose a different fix, such as supplying a figure it says would not help.';

describe('the repair-fidelity sentence reaches the model on every reply-writing call', () => {
  let app: FastifyInstance;
  let modelBodies: Record<string, unknown>[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      modelBodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Tell Olumi which part of the model the limit applies to, then run again.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: 'h1',
      blocks: [{ type: 'analysis_result', data: { marker: 'the-run' } }], analysis_ready: { status: 'ready', options: [], blockers: [] },
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }], edges: [] }, graph_hash: 'h1',
      analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { modelBodies = []; });

  it('RED: the explicit Run’s one interpreting call carries it', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
    } });
    expect(r.statusCode).toBe(200);
    expect(modelBodies).toHaveLength(1);
    expect(String(modelBodies[0]!['instructions'])).toContain(REPAIR_RULE);
  });

  it('RED: the Agent’s own call carries it', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What does the model say so far?' } });
    expect(r.statusCode).toBe(200);
    const agentCall = modelBodies.find((b) => b['tool_choice'] !== 'none');
    expect(agentCall).toBeDefined();
    expect(String(agentCall!['instructions'])).toContain(REPAIR_RULE);
  });
});
