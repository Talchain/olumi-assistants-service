/**
 * ⭐ PJ-C1 LATENCY (DL checkpoint #72 5860966219, batch 5): THE AGENT'S CONVERSATION CALLS ASK FOR LOW REASONING EFFORT.
 *
 * Measured on served journey A (`pj-20260927T233309Z`, CEE e09b8c2, 20 conversation calls): a call takes
 * ≈ 1,395 ms + 8.1 ms per output token (r = 0.89), and 2,127 of the 5,367 output tokens were REASONING ≈ 17 s of the
 * journey. The conversation calls (`agent.converse`, and the Run button's one `agent.interpret` call) sent no
 * `reasoning` at all, so the API default applied; only construction set one (`medium`). Proposal #72 5860893020.
 *
 * Construction is untouched: a whole model is built by a different call with its own measured budget.
 * The acceptance is SERVED, not here (AIQ #72 5860911820): the truth rows, read per row, on a journey-A run. These
 * rows pin only what the request carries.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const store = vi.hoisted(() => ({
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'synthetic-answer-row' })),
}));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Body = Record<string, unknown>;
const GRAPH = {
  nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }],
  edges: [{ from: 'f', to: 'g' }],
};
const STATE = { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } };

describe('batch 5: the conversation calls carry reasoning effort low; construction keeps its own', () => {
  let app: FastifyInstance;
  let modelBodies: Body[] = [];

  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      if (String(url) !== 'https://api.openai.com/v1/responses') throw new Error(`Unexpected mocked fetch target: ${String(url)}`);
      modelBodies.push(JSON.parse(String(init?.body ?? '{}')) as Body);
      const envelope = {
        id: 'resp_synthetic', status: 'completed', incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Capacity drives it.' }] }],
      };
      return new Response(JSON.stringify(envelope), { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    vi.resetModules();
    const route = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'Done.', suggested_actions: [], insights: [], graph_hash: 'h1', analysis_state: STATE,
      blocks: [{ type: 'analysis_result', data: { marker: 'synthetic' } }], analysis_ready: { status: 'ready', options: [], blockers: [] },
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH, graph_hash: 'h1', analysis_state: STATE }));
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    if (app !== undefined) await app.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  beforeEach(() => { modelBodies = []; });

  it('⭐ RED: an ordinary turn’s conversation call asks for reasoning effort low', async () => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: randomUUID(), message: 'What drives the result most?' } });
    expect(res.statusCode, res.body).toBe(200);
    expect(modelBodies.length).toBeGreaterThan(0);
    for (const b of modelBodies) expect(b.reasoning, JSON.stringify(b.reasoning)).toEqual({ effort: 'low' });
  });

  it('⭐ RED: the Run button’s one interpreting call (tool_choice none) asks for reasoning effort low too', async () => {
    const res = await app.inject({
      method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: randomUUID(), message: 'Run the analysis please', source: 'chip_click', chip: { action_type: 'run_analysis' } },
    });
    expect(res.statusCode, res.body).toBe(200);
    const interpreting = modelBodies.filter((b) => b.tool_choice === 'none');
    expect(interpreting.length, 'the typed Run made its interpreting call').toBe(1);
    expect(interpreting[0]!.reasoning).toEqual({ effort: 'low' });
  });

  it('CONTROL: construction keeps its own measured effort (medium); only the conversation budget changed', async () => {
    const { budgetFor } = await import('../model-budgets.js');
    expect(budgetFor('gpt-5.6-terra', 'whole').reasoning_effort).toBe('medium');
    expect(budgetFor('gpt-5.6-terra', 'conversation').reasoning_effort).toBe('low');
  });
});
