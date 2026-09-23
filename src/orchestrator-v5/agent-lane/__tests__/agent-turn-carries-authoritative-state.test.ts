/**
 * ⛔ THE AGENT'S ENVELOPE CARRIES THE SCENARIO'S OWN STATE, BOUND TO THE GRAPH IT
 * RETURNS (preflight UI-contract audit of the OpenAI candidate; independent review
 * of #1760, 5797642232).
 *
 * 1. The route finalises with `{ scenarioId }` only, so the finaliser stamps the
 *    no-context verdict (`unknown_degraded` / `no_graph_this_turn`, leader
 *    withheld) and the UI treats it as the wire authority: a result that had just
 *    run read "Results may be outdated", on every Agent turn.
 * 2. But the fix must not borrow authority from a run of a model the user no longer
 *    has: a turn can run the analysis and THEN change the graph. So the FINAL
 *    readback governs, and the run's blocks are shown only while that readback
 *    holds a result current for the returned graph.
 *
 * PRODUCTION-SHAPED BINDING: the fake graph read answers with the REAL
 * `readScenarioAnalysis`, fed a SERVED run_analysis fact through the session store
 * (`readRecent` → `readFactsFor`), with `graph_hash_at_run` set to the hash of the
 * graph that was actually analysed. Freshness is decided by the product, not here.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SERVED_PRICING = ((j: { graph?: unknown }) => (j.graph ?? j))(JSON.parse(readFileSync(new URL('./fixtures/served-pricing-graph-c4a6cce.json', import.meta.url), 'utf8'))) as { nodes: unknown[]; edges: unknown[] };
const SERVED_FACT = JSON.parse(readFileSync(new URL('./fixtures/served-run-analysis-fact-for-binding.json', import.meta.url), 'utf8')) as { fact_type: string; result: Record<string, unknown> };

const SCENARIO = '4d2c1b0a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const CONSTRAINTS = [{ id: 'c_churn', label: 'Monthly churn', operator: '<', value: 0.04, unit: '%' }];
const GRAPH_A = {
  nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'f', kind: 'factor', label: 'Price' }],
  edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' }],
  goal_constraints: CONSTRAINTS,
};
const GRAPH_B = { ...GRAPH_A, nodes: [...GRAPH_A.nodes, { id: 'f2', kind: 'factor', label: 'Churn' }] };

let currentGraph: unknown = GRAPH_A;
let runFact: unknown = null;
let graphReadFails = false;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
  // The durable turns: one row carrying the run's fact (and no conversation text).
  readRecent: vi.fn(async () => (runFact === null ? [] : [{ id: 'row-run', turn_id: 't-run', turn_class: 'decide', created_at: '2026-09-23T10:00:00Z' }])),
  readFactsFor: vi.fn(async () => (runFact === null ? [] : [runFact])),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

let callModelOutputs: Record<string, unknown>[][] = [];
/** Runs between the run_analysis hop and the final readback (the "another writer" case). */
let afterRun: (() => void) | null = null;

describe('the Agent turn carries the scenario’s state, bound to the graph it returns', () => {
  let app: FastifyInstance;
  let hashOf: (g: unknown) => string | null;
  let canonicalRead: (graph: unknown) => Promise<{ analysis_state: unknown; analysis_result: unknown }>;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    hashOf = (g) => computeAnalysisAffectingGraphHash(g as never) ?? null;
    const { readScenarioAnalysis } = await import('../../../routes/scenario-graph-analysis-read.js');
    canonicalRead = (graph) => readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'test' }) as never;
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      // The run: it analyses the graph as it is NOW, and persists that as its fact.
      // A persisted handler-fact row carries `noop: false` for a run that executed;
      // the banked served fact was captured without that column.
      runFact = { ...SERVED_FACT, noop: false, result: { ...SERVED_FACT.result, scenario_id: SCENARIO, graph_hash_at_run: hashOf(currentGraph) } };
      const response = {
        response_version: 2, assistant_text: 'ok', suggested_actions: [], insights: [], graph_hash: 'h-run',
        blocks: [{ type: 'analysis_result', data: { marker: 'the-agent-run-A-block' } }],
        analysis_ready: { status: 'ready', options: [], blockers: [] },
        analysis_state: { marker: 'the-run-s-own-verdict' },
      };
      afterRun?.();
      return response;
    });
    app.post('/assist/v1/scenarios/:id/graph', async (_req, reply) => {
      if (graphReadFails) return reply.code(500).send({ error: 'unavailable' });
      const read = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: currentGraph, requestId: 'test' });
      return { graph: currentGraph, graph_hash: hashOf(currentGraph), ...read };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { currentGraph = GRAPH_A; runFact = null; graphReadFails = false; afterRun = null; });

  const runThenAnswer = () => {
    callModelOutputs = [
      [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, one option leads.' }] }],
    ];
    return app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis.' } });
  };
  type State = { marker?: string; run_state?: { kind?: string }; leader_claim?: { permitted?: boolean } };

  it('RED: run → answer on an UNCHANGED graph — the readback says current, and the run’s result is shown', async () => {
    const r = await runThenAnswer();
    expect(r.statusCode).toBe(200);
    const s = r.json().analysis_state as State;
    expect(s.marker, 'the readback governs, not the run’s own verdict').toBeUndefined();
    expect(s.run_state?.kind).toBe('complete_current');
    expect((r.json().blocks as { type: string }[]).some((b) => b.type === 'analysis_result')).toBe(true);
  });

  it('RED: run → the graph CHANGES before readback — stale, leader withheld, and NO result shown as current', async () => {
    afterRun = () => { currentGraph = GRAPH_B; };
    const r = await runThenAnswer();
    const s = r.json().analysis_state as State;
    expect(s.marker).toBeUndefined();
    expect(s.run_state?.kind).not.toBe('complete_current');
    expect(s.leader_claim?.permitted).toBe(false);
    expect(((r.json().blocks ?? []) as { type: string }[]).some((b) => b.type === 'analysis_result')).toBe(false);
    expect((r.json().draft_graph as { node_count?: number }).node_count, 'the NEW graph is returned').toBe(3);
  });

  it('RED: run A → graph changes to B → ANOTHER analysis of B commits before readback — B\u2019s bound result and verdict, never A\u2019s', async () => {
    afterRun = () => {
      currentGraph = GRAPH_B;
      // Another writer's successful run of B, with a distinguishable leader.
      runFact = { ...SERVED_FACT, noop: false, result: { ...SERVED_FACT.result, scenario_id: SCENARIO, leading_option_id: 'the_b_run_leader', graph_hash_at_run: hashOf(GRAPH_B) } };
    };
    const r = await runThenAnswer();
    const blocks = (r.json().blocks ?? []) as { type: string }[];
    const results = blocks.filter((b) => b.type === 'analysis_result');
    expect(JSON.stringify(results), 'never the Agent\u2019s run-A block').not.toContain('the-agent-run-A-block');
    // Bound by IDENTITY to what the canonical reader selects for the FINAL graph.
    const canonical = await canonicalRead(GRAPH_B);
    expect(canonical.analysis_result, 'the control: B is current in the canonical reader').not.toBeNull();
    expect(results).toEqual([canonical.analysis_result]);
    expect(r.json().analysis_state).toEqual(canonical.analysis_state);
  });

  it('CONTRAST: an unavailable readback cannot manufacture currentness — the finaliser’s honest unknown, and no result', async () => {
    graphReadFails = true;
    const r = await runThenAnswer();
    const s = r.json().analysis_state as State;
    expect(s.marker).toBeUndefined();
    expect(s.run_state?.kind).toBe('unknown_degraded');
    expect(((r.json().blocks ?? []) as { type: string }[]).some((b) => b.type === 'analysis_result')).toBe(false);
  });

  it('RED: mutate/run → current readback — analysis_ready.freshness is "fresh", so the UI clears "Model changed" (Panel 5800618648)', async () => {
    // A SERVED model, so readiness comes from the canonical assessor exactly as on the wire.
    currentGraph = SERVED_PRICING;
    const r = await runThenAnswer();
    const s = r.json().analysis_state as State;
    expect(s.run_state?.kind, 'the control: the readback says current').toBe('complete_current');
    const ar = r.json().analysis_ready as { freshness?: string; freshness_reason?: string };
    expect(ar.freshness).toBe('fresh');
    expect(ar.freshness_reason).toBe('agent_readback_complete_current');
  });

  it('CONTRAST: the graph changes before readback — never "fresh"; a stale verdict is stamped "stale", not omitted', async () => {
    currentGraph = SERVED_PRICING;
    afterRun = () => { currentGraph = { ...SERVED_PRICING, nodes: [...SERVED_PRICING.nodes, { id: 'f_new', kind: 'factor', label: 'Competitor price' }] }; };
    const r = await runThenAnswer();
    const kind = (r.json().analysis_state as State).run_state?.kind;
    expect(r.json().analysis_ready, 'the control: readiness is on the wire').toBeDefined();
    const ar = r.json().analysis_ready as { freshness?: string };
    expect(kind).not.toBe('complete_current');
    expect(ar.freshness).not.toBe('fresh');
    if (kind === 'complete_stale') expect(ar.freshness).toBe('stale');
  });

  it('CONTRAST: an unavailable readback stamps no freshness at all', async () => {
    currentGraph = SERVED_PRICING;
    graphReadFails = true;
    const r = await runThenAnswer();
    const ar = r.json().analysis_ready as { freshness?: string } | undefined;
    expect(ar?.freshness).toBeUndefined();
  });

  it('RED: draft_graph carries the model’s goal_constraints, so the canvas keeps the user’s limits', async () => {
    callModelOutputs = [[{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }]];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Show me the model.' } });
    const dg = r.json().draft_graph as { goal_constraints?: unknown; node_count?: number; edge_count?: number };
    expect(dg.goal_constraints).toEqual(CONSTRAINTS);
    expect([dg.node_count, dg.edge_count]).toEqual([2, 1]);
  });
});
