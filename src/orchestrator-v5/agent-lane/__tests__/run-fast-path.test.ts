/**
 * ⭐ FAST PATH 3 — AN EXPLICIT RUN IS RUN DETERMINISTICALLY, THEN INTERPRETED ONCE
 * (RC #63 5803960423 / 5803995225). Paul's staging test: ~18 s, 3 provider calls, 2 tool
 * hops. The UI's Run control is a typed chip (`action_type: 'run_analysis'`), so the
 * analysis runs through the SAME capability and ONE model call interprets it, forbidden
 * from calling tools.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '8b3e4d5c-6f7a-4b8c-9d0e-1f2a3b4c5d6f';
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

describe('fast path 3: a typed Run chip runs the analysis and makes ONE interpreting call', () => {
  let app: FastifyInstance;
  let modelBodies: Record<string, unknown>[] = [];
  let runs = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelBodies.push(body);
      if (body['tool_choice'] !== 'none' && modelBodies.length === 1) {
        // The Agent path: it would first decide to call run_analysis.
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'run_analysis', call_id: 'c1', arguments: JSON.stringify({ reason: 'asked' }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, Hire a tech lead leads, but only weakly.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      runs += 1;
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: 'h1',
        blocks: [{ type: 'analysis_result', data: { marker: 'the-run' } }], analysis_ready: { status: 'ready', options: [], blockers: [] } };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity' }], edges: [{ from: 'f', to: 'g' }] },
      graph_hash: 'h1',
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { modelBodies = []; runs = 0; });

  it('RED: a typed Run chip → the analysis runs once, and exactly ONE model call interprets it with tool_choice none', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
    } });
    expect(r.statusCode).toBe(200);
    const b = r.json() as { assistant_text: string; _diagnostic_trace: { fast_path?: string }; _agent: { tool_calls: { name: string }[] } };
    expect(runs, 'the analysis ran once').toBe(1);
    expect(modelBodies, 'exactly ONE model call').toHaveLength(1);
    expect(modelBodies[0]!['tool_choice'], 'it may interpret, never act').toBe('none');
    const input = JSON.stringify(modelBodies[0]!['input']);
    expect(input, 'the call sees the real run result').toContain('function_call_output');
    expect(b._diagnostic_trace.fast_path).toBe('run');
    expect(b._agent.tool_calls.map((c) => c.name)).toEqual(['run_analysis']);
    expect(b.assistant_text).toContain('Hire a tech lead leads');
  });

  it('CONTRAST: "Run the analysis" typed as words still goes to the Agent', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis please' } });
    expect(modelBodies.length, 'the Agent decides, then answers').toBeGreaterThanOrEqual(2);
    expect((r.json() as { _diagnostic_trace: { fast_path?: string } })._diagnostic_trace.fast_path).toBeUndefined();
  });
});
