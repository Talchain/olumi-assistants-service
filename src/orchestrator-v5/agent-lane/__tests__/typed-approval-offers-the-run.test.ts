/**
 * ⛔ A TYPED APPROVAL RUNS NOTHING — AND STILL OFFERS THE RUN (AI Quality, #63; Paul 5812069638).
 *
 * `runAnalysis` refuses `run_not_requested` in the request whose approval applied a change, and its
 * detail tells the Agent to say the user can run the analysis when ready. The route's `offerRun` must
 * therefore not count that refused call as "already analysed", or the reply names a Run the user has
 * no control for. Drives the REAL route and capabilities with a scripted model (fetch stubbed).
 *
 * Contrast: a typed request to run, with no change in the turn, does run.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `5e0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d1d${String(n).padStart(2, '0')}`; };
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Chip = { id: string; label: string; message: string; action_type?: string };

describe('K3 at the route — a typed "yes" applies the change, runs nothing, and offers the Run', () => {
  let app: FastifyInstance;
  let edges: { from: string; to: string }[] = [];
  let runs = 0;
  let script: Record<string, unknown>[][] = [];
  const readiness = { status: 'ready', may_run: true };

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const next = script.shift();
      const output = next ?? [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, the link matters.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
      graph_hash: `h${edges.length}`,
      analysis_ready: readiness,
      analysis_state: {},
    }));
    app.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; event?: { from: string; to: string }; chip?: { action_type?: string } };
      if (b.kind === 'system_event' && b.event) edges = [...edges, { from: b.event.from, to: b.event.to }];
      if (b.chip?.action_type === 'run_analysis') runs += 1;
      return { assistant_text: 'ok', blocks: b.chip?.action_type === 'run_analysis' ? [{ type: 'analysis_result', data: {} }] : [], analysis_ready: readiness };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 180_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { edges = []; runs = 0; script = []; nextScenario(); });

  const fnCall = (name: string, args: Record<string, unknown>, id: string) => [{ type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) }];

  /** One Agent turn that proposes a link; returns the proposal id from its approve chip. */
  async function propose(): Promise<string> {
    script = [fnCall('propose_model_change', { from_label: 'Team size', to_label: 'Velocity', direction: 'positive', strength: 'strong', rationale: 'It moves velocity.' }, 'p1')];
    const t1 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Team size strongly drives velocity, so connect them.' } });
    const approve = (t1.json() as { suggested_actions: Chip[] }).suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve, 'the control: a real proposal was offered').toBeDefined();
    return approve!.id.slice('agent-approve-proposal:'.length);
  }

  it('RED-first: typed "yes" → authorise_change then run_analysis → the change applies, NOTHING runs, ONE Run chip is offered', async () => {
    const proposalId = await propose();
    script = [fnCall('authorise_change', { proposal_id: proposalId }, 'a1'), fnCall('run_analysis', { reason: 'after the change' }, 'r1')];
    const t2 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Yes, apply it.' } });
    expect(t2.statusCode).toBe(200);
    expect(edges, 'the typed approval really applied').toHaveLength(1);
    expect(runs, 'no surprise Run in the approving turn').toBe(0);
    // Bound by identity: the model DID ask to run, and the server's approval guard refused it.
    expect((t2.json() as { _agent: { tool_calls: { name: string; mutated: boolean; refusal?: string }[] } })._agent.tool_calls)
      .toEqual([
        expect.objectContaining({ name: 'authorise_change', mutated: true }),
        expect.objectContaining({ name: 'run_analysis', refusal: 'run_not_requested' }),
      ]);
    expect((t2.json() as { suggested_actions: Chip[] }).suggested_actions.filter((c) => c.action_type === 'run_analysis'), 'the refused run analysed nothing, so the Run is still offered')
      .toEqual([expect.objectContaining({ id: 'agent-run-analysis', action_type: 'run_analysis' })]);
  });

  it('CONTRAST: a typed request to run, with no change in the turn, does run', async () => {
    script = [fnCall('run_analysis', { reason: 'the user asked' }, 'r1')];
    const t = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis.' } });
    expect(t.statusCode).toBe(200);
    expect(runs).toBe(1);
  });
});
