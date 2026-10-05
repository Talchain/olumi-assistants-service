/**
 * ⭐ RT-6 S4-A phase 2 THROUGH THE REAL ROUTE: a turn whose sizing is refused with ONE unit question persists that question
 * on its answer row (`pending_actions`), parsed by the session reader, bound to the graph it was asked on — so the next
 * reply's one-word answer can complete it by its id. Seams: the provider's HTTP call (`fetch`) and the graph read.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { parsePendingAction } from '../../session/pending-action.js';

const SCENARIO = 'd39c05ba-0000-4000-8000-0000000000aa';
const GRAPH = JSON.parse(readFileSync(new URL('./fixtures/rt6-graph-d39c05ba.json', import.meta.url), 'utf8')) as Record<string, unknown>;
const C1 = 'Every 2 extra developers add about 1 point of onboarding drag.';
const appended: Record<string, any>[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  readMostRecentPendingActions: vi.fn(async () => []),
  append: vi.fn(async (w: Record<string, any>) => { appended.push(JSON.parse(JSON.stringify(w))); return { id: `row-${appended.length}` }; }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let graphHash = 'h-d39-asked';
let agentCalls = 0;

describe('RT-6 S4-A phase 2: the asked question rides the answer row', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body['tool_choice'] === 'none') {
        return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'What unit is the 1 change in “Onboarding drag” stated in?' }] }] }), { status: 200 });
      }
      agentCalls += 1;
      if (agentCalls % 2 === 1) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'propose_link_effect', call_id: `c${agentCalls}`,
          arguments: JSON.stringify({ from_label: 'Developer headcount', to_label: 'Onboarding drag', amount: 1, amount_unit: 'points',
            per_source_change: 2, per_source_change_unit: 'developers', quote: C1 }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'What unit is the 1 change in “Onboarding drag” stated in?' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH, graph_hash: graphHash }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { appended.length = 0; agentCalls = 0; graphHash = 'h-d39-asked'; });

  const say = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: C1 } });

  it('Acceptance C1 → the answer row carries ONE parsed agent_link_effect_question for this graph', async () => {
    const r = await say();
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json() as { _agent: { tool_calls: { name: string; ok: boolean }[] } };
    expect(b._agent.tool_calls.some((c) => c.name === 'propose_link_effect' && c.ok === false), 'the control: the sizing was refused').toBe(true);
    const rows = appended.filter((w) => Array.isArray(w.pending_actions) && w.pending_actions.length > 0);
    const questions = rows.flatMap((w) => w.pending_actions as unknown[]).map((p) => parsePendingAction(p))
      .filter((p) => p?.action.kind === 'agent_link_effect_question');
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({ scenario_id: SCENARIO, preconditions: { graph_hash: 'h-d39-asked' },
      action: { question: 'What unit is the 1 change in “Onboarding drag” stated in?', quote: C1, asked_ends: ['target'] } });
  });

});
