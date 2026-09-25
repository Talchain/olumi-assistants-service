/**
 * ⛔ P0 (RC 5826809371, 25 Sep): THE HIRING ONE-LINER DEAD-ENDED AFTER "Use as starting assumptions".
 * The approval applied (`authorise_change` mutated), the model stayed `blocked` (OPTION_NO_FACTOR_EDGES),
 * and the turn carried NO action — no Run (correctly: it cannot run) and no next step. The readiness here is
 * AI Quality's SERVED capture, verbatim (`aiq/agent-reply-paired-evidence` @ c4c923bb,
 * `Docs/evals/agent-reply/p0-post-approval-dead-end/`): `eng-hiring-2` is the dead end, `eng-hiring-1` the
 * ready control from the same brief class.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const FX = join(__dirname, 'fixtures', 'p0-post-approval-dead-end');
const served = (f: string) => JSON.parse(readFileSync(join(FX, f), 'utf8')) as { analysis_ready: Record<string, unknown>; suggested_actions: unknown[]; _agent: { tool_calls: { name: string; mutated: boolean }[] } };
const DEAD_END = served('dead-end.eng-hiring-2.approve.json');
const READY = served('control-ready.eng-hiring-1.approve.json');

// One scenario per case: a proposal's id is derived from its scenario, base and content, so a second identical
// approval in the SAME scenario would be the first one, already applied.
const BLOCKED_SCENARIO = '7a2d3e4f-5b6c-4d7e-8f90-a1b2c3d4e5f6';
const READY_SCENARIO = '8b3e4f50-6c7d-4e8f-9a01-b2c3d4e5f607';
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

describe('P0: an approval that leaves the model unable to run offers the next step', () => {
  let app: FastifyInstance;
  let edges: { from: string; to: string }[] = [];
  let proposeNext = true;
  let readiness: Record<string, unknown> = DEAD_END.analysis_ready;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (proposeNext) {
        proposeNext = false;
        return new Response(JSON.stringify({ output: [{
          type: 'function_call', name: 'propose_model_change', call_id: 'c1',
          arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', rationale: 'It moves velocity.' }),
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'This would connect Team size to Velocity. Approve it if that is right.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
      graph_hash: `h${edges.length}`,
      analysis_ready: readiness,
    }));
    app.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; event?: { from: string; to: string } };
      if (b.kind === 'system_event' && b.event) edges = [...edges, { from: b.event.from, to: b.event.to }];
      return { assistant_text: 'Added.' };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const approveWith = async (scenario: string, ar: Record<string, unknown>) => {
    edges = []; proposeNext = true; readiness = ar;
    const t1 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenario, message: 'Should team size drive velocity?' } });
    const approve = (t1.json() as { suggested_actions: { id: string; message: string }[] }).suggested_actions[0]!;
    expect(approve.id, 'PRECONDITION: a real approve chip was offered').toMatch(/^agent-approve-proposal:/);
    const t2 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: scenario, message: approve.message, source: 'chip', chip: { id: approve.id },
    } });
    return t2.json() as { suggested_actions: { id: string; label: string; action_type?: string }[]; _agent: { tool_calls: { name: string; ok: boolean; mutated: boolean }[] } };
  };

  it('PRECONDITION: the served captures are the dead end and its control', () => {
    expect(DEAD_END.analysis_ready).toMatchObject({ status: 'blocked', may_run: false });
    expect(DEAD_END.suggested_actions, 'served: the dead end offered nothing').toEqual([]);
    expect(DEAD_END._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', mutated: true })]);
    expect(READY.analysis_ready).toMatchObject({ status: 'ready', may_run: true });
  });

  it('RED: an applied approval on the served blocked readiness offers "Suggest what it still needs" — never Run', async () => {
    const b = await approveWith(BLOCKED_SCENARIO, DEAD_END.analysis_ready);
    expect(b._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(b.suggested_actions.map((a) => a.id)).toEqual(['agent-suggest-what-it-needs']);
    expect(b.suggested_actions[0]!.action_type, 'a plain Agent turn, never a Run').toBeUndefined();
  });

  it('CONTROL: the same approval on the served READY readiness still offers Run, and no remedy', async () => {
    const b = await approveWith(READY_SCENARIO, READY.analysis_ready);
    expect(b._agent.tool_calls, 'PRECONDITION: this approval applied too').toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(b.suggested_actions.map((a) => a.id)).toEqual(['agent-run-analysis']);
  });
});
