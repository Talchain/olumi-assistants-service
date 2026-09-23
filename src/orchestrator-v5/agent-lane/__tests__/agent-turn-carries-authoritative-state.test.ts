/**
 * ⛔ THE AGENT'S ENVELOPE MUST CARRY THE SCENARIO'S OWN STATE, NOT A NO-CONTEXT
 * DEFAULT (preflight UI-contract audit of the OpenAI candidate, verified).
 *
 * The route finalises with `{ scenarioId }` only, so the finaliser stamps the
 * verdict that is true of a turn with NO analysis context:
 * `run_state.kind: 'unknown_degraded'`, `cause: 'no_graph_this_turn'`, leader
 * withheld. The UI treats `analysis_state` as the wire authority, so on EVERY Agent
 * turn a result that had just run read "Results may be outdated" and the leading
 * option was withheld. And `draft_graph` was assembled by hand without
 * `goal_constraints`, so a constraint the model holds (e.g. "churn under 4%") was
 * cleared from the canvas on the first build.
 *
 * Bound by IDENTITY: each state is a distinct sentinel, so the assertion cannot be
 * satisfied by the wrong one.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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

const SCENARIO = '4d2c1b0a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const RUN_STATE = { marker: 'from-the-internal-run', run_state: { kind: 'complete_current' }, leader_claim: { permitted: true } };
const GRAPH_STATE = { marker: 'from-the-graph-read', run_state: { kind: 'complete_current' }, leader_claim: { permitted: true } };
const CONSTRAINTS = [{ id: 'c_churn', label: 'Monthly churn', operator: '<', value: 0.04, unit: '%' }];

let callModelOutputs: Record<string, unknown>[][] = [];
let graphState: unknown = GRAPH_STATE;

describe('the Agent turn carries the scenario’s authoritative state', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ok', suggested_actions: [], insights: [], graph_hash: 'h1',
      blocks: [{ type: 'analysis_result', data: {} }],
      analysis_ready: { status: 'ready', options: [], blockers: [] },
      analysis_state: RUN_STATE,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'f', kind: 'factor', label: 'Price' }], edges: [{ from: 'f', to: 'g' }], goal_constraints: CONSTRAINTS },
      graph_hash: 'h1',
      analysis_state: graphState,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { graphState = GRAPH_STATE; });

  const turn = (message: string) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message } });

  it('RED: a turn that ran the analysis carries THAT run’s analysis_state', async () => {
    callModelOutputs = [
      [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, A leads.' }] }],
    ];
    const r = await turn('Run the analysis.');
    expect(r.statusCode).toBe(200);
    expect((r.json().analysis_state as { marker?: string }).marker).toBe('from-the-internal-run');
  });

  it('RED: a turn with no run carries the scenario-bound analysis_state from the graph read', async () => {
    callModelOutputs = [[{ type: 'message', content: [{ type: 'output_text', text: 'Here is what the model says.' }] }]];
    const r = await turn('What does the model say?');
    expect((r.json().analysis_state as { marker?: string }).marker).toBe('from-the-graph-read');
  });

  it('RED: draft_graph carries the model’s goal_constraints, so the canvas keeps the user’s limits', async () => {
    callModelOutputs = [[{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }]];
    const r = await turn('Show me the model.');
    const dg = r.json().draft_graph as { goal_constraints?: unknown; node_count?: number; edge_count?: number };
    expect(dg.goal_constraints).toEqual(CONSTRAINTS);
    expect([dg.node_count, dg.edge_count]).toEqual([2, 1]);
  });

  it('CONTRAST: with no scenario-bound verdict, the finaliser’s own analysis_state stays (present, never deleted)', async () => {
    graphState = null;
    callModelOutputs = [[{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }]];
    const r = await turn('Hello.');
    const s = r.json().analysis_state as { marker?: string; run_state?: { kind?: string } } | undefined;
    expect(s).toBeDefined();
    expect(s?.marker).toBeUndefined();
    expect(s?.run_state?.kind).toBe('unknown_degraded');
  });
});
