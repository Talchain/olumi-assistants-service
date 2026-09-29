/**
 * ⛔ A RUN'S INTERPRETATION IS KEPT IN HISTORY WITH ITS REASONING ITEM, OR THE NEXT TURN IS REFUSED.
 *
 * MEASURED on served `f828a61` (witness `c9`, 24 Sep 05:39Z, both the hiring and pricing journeys): the
 * turn straight after a typed Run returned HTTP 502 `UPSTREAM_ERROR`, because OpenAI refused the request:
 *
 *     openai_400: Item 'msg_0fb4…' of type 'message' was provided without its required
 *     'reasoning' item: 'rs_0fb4…'.
 *
 * Fast path 3 saved only the interpreting call's `message` items into the conversation of record,
 * dropping the `reasoning` item each one belongs to. The Agent loop never had this bug because it keeps
 * the whole output array (`agent-loop.ts`: "the reasoning item must accompany the calls"). And the Run
 * is offered after every approval, so every journey that pressed it lost the conversation at once.
 *
 * The fake below enforces the API's own rule, so it goes RED exactly where production did.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '8c3e4d5c-6f7a-4b8c-9d0e-1f2a3b4c5d70';
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

/** The Responses API's rule: a message item that came with a reasoning item must be sent WITH it. */
function refusalFor(input: readonly Record<string, unknown>[]): string | null {
  const ids = new Set(input.map((i) => i['id']).filter((x): x is string => typeof x === 'string'));
  for (const i of input) {
    const id = i['id'];
    if (i['type'] === 'message' && typeof id === 'string' && id.startsWith('msg_')) {
      const rs = `rs_${id.slice(4)}`;
      if (!ids.has(rs)) return `Item '${id}' of type 'message' was provided without its required 'reasoning' item: '${rs}'.`;
    }
  }
  return null;
}

describe('the turn after a typed Run is accepted by the model API', () => {
  let app: FastifyInstance;
  let n = 0;
  const inputs: Record<string, unknown>[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: Record<string, unknown>[] };
      const input = body.input ?? [];
      inputs.push(input);
      const refused = refusalFor(input);
      if (refused !== null) return new Response(JSON.stringify({ error: { message: refused, type: 'invalid_request_error' } }), { status: 400 });
      n += 1;
      // Every reply comes the way the real API sends it: a reasoning item, then the message it belongs to.
      return new Response(JSON.stringify({ output: [
        { type: 'reasoning', id: `rs_${n}`, summary: [] },
        { type: 'message', id: `msg_${n}`, role: 'assistant', content: [{ type: 'output_text', text: `Answer ${n}.` }] },
      ] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: 'h1',
      blocks: [{ type: 'analysis_result', data: { marker: 'the-run' } }], analysis_ready: { status: 'ready', options: [], blockers: [] } }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }], edges: [{ from: 'f', to: 'g' }] },
      graph_hash: 'h1',
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: typed Run, then an ordinary question → HTTP 200, and the history carries the reasoning item beside its message', async () => {
    const run = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
    } });
    expect(run.statusCode).toBe(200);
    expect((run.json() as { _diagnostic_trace: { fast_path?: string } })._diagnostic_trace.fast_path, 'the control: fast path 3 ran').toBe('run');
    const sessionId = (run.json() as { _agent: { session_id?: string } })._agent.session_id;

    const next = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'How much did my change matter?', ...(sessionId !== undefined ? { agent_session_id: sessionId } : {}),
    } });
    const sent = inputs[inputs.length - 1]!;
    // Vacuity guard: the next turn really did send the Run's interpretation back as history.
    expect(sent.some((i) => i['id'] === 'msg_1'), 'the Run turn is in the next turn’s history').toBe(true);
    expect(next.statusCode, JSON.stringify(next.json()).slice(0, 300)).toBe(200);
    expect(sent.findIndex((i) => i['id'] === 'rs_1')).toBeLessThan(sent.findIndex((i) => i['id'] === 'msg_1'));
  });
});
