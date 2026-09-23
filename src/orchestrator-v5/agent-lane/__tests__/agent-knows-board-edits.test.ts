/**
 * ⛔ The Agent must know what the user changed on the board.
 *
 * Measured on served cc7b26c (scenario 05bd861b, UI transport, OpenAI mode): after a
 * canvas `factor_value_edit` (Tech lead hires 0 → 1), "Re-run the analysis. How much
 * did my change matter?" was answered about the EARLIER approved baseline — the
 * forwarded edit never entered the Agent's history.
 *
 * Through the REAL route: a forwarded board edit is followed by a message, and what
 * the model is actually sent must carry the product's own narration of the edit,
 * marked as a board edit.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

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

const NARRATION = 'Updated Tech lead hires from 0 hires to 1 hire. This makes the last analysis stale.';
const SCENARIO = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('a board edit reaches the Agent’s context', () => {
  let app: FastifyInstance;
  let prefix = '';
  let editStatus = 200;
  const sentToModel: string[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      sentToModel.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Noted.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const mod = await import('../../../routes/agent-v1-turn.js');
    prefix = mod.BOARD_EDIT_PREFIX;
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async (_req, reply) =>
      reply.code(editStatus).send(editStatus === 200
        ? { response_version: 2, assistant_text: NARRATION, blocks: [], suggested_actions: [], insights: [], graph_hash: 'h2' }
        : { error: 'BAD_INPUT', assistant_text: 'That edit could not be applied.' }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] }, graph_hash: 'h2' }));
    await app.register(mod.agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const edit = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: '11111111-1111-4111-8111-111111111111', stage: 'analyse', event: { kind: 'factor_value_edit', target_id: 'tech_lead_hires', value: 1, field: 'value' } } });
  const ask = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'How much did my change matter?' } });

  it('RED: after a forwarded edit, the next turn sends the model the edit’s own narration, marked as a board edit', async () => {
    const r = await edit();
    expect(r.statusCode).toBe(200);
    expect((r.json() as { _diagnostic_trace: { exit_path: string } })._diagnostic_trace.exit_path).toBe('agent_lane_forwarded');
    sentToModel.length = 0;
    await ask();
    const body = sentToModel.join('\n');
    expect(body).toContain(prefix);
    expect(body).toContain(NARRATION);
  });

  it('CONTRAST: a refused edit adds nothing to the Agent’s context', async () => {
    editStatus = 422;
    const before = (await (async () => { sentToModel.length = 0; await ask(); return sentToModel.join('\n'); })()).split(prefix).length;
    const r = await edit();
    expect(r.statusCode).toBe(422);
    sentToModel.length = 0;
    await ask();
    expect(sentToModel.join('\n').split(prefix).length).toBe(before);
    editStatus = 200;
  });
});
