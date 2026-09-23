/**
 * ⭐ AN AGENT TURN STATES ITS RUN'S FRESHNESS ON `analysis_ready.freshness`
 * (Panel witness, programme-docs #63 5800618648). The UI clears its local
 * "an edit happened" overlay ONLY on that field; without it, a turn that saved
 * values and then ran the analysis on them told the user "The model has
 * changed since this analysis ran" over the run it had just produced.
 *
 * Harness copied from `agent-turn-carries-authoritative-state.test.ts`.
 */
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

const SERVED_FACT = JSON.parse(readFileSync(new URL('./fixtures/served-run-analysis-fact-for-binding.json', import.meta.url), 'utf8')) as { fact_type: string; result: Record<string, unknown> };

const SCENARIO = '4d2c1b0a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const CONSTRAINTS = [{ id: 'c_churn', label: 'Monthly churn', operator: '<', value: 0.04, unit: '%' }];
const GRAPH_A = {
  nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'f', kind: 'factor', label: 'Price' }],
  edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' }],
  goal_constraints: CONSTRAINTS,
};
/** The served pricing graph (c4a6cce): 3 options, so the canonical assessor produces the
 *  `analysis_ready` the real readback relies on. */
const SERVED_PRICING_GRAPH = { ...(JSON.parse(readFileSync(new URL('./fixtures/served-pricing-graph-c4a6cce.json', import.meta.url), 'utf8')) as Record<string, unknown>) };
const SERVED_PRICING_GRAPH_CHANGED = { ...SERVED_PRICING_GRAPH, nodes: [...(SERVED_PRICING_GRAPH.nodes as unknown[]), { id: 'f_new', kind: 'factor', label: 'A new factor' }] };

let currentGraph: unknown = GRAPH_A;
let runFact: unknown = null;
let graphReadFails = false;
let readReturnsReady = false;
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

describe('the Agent turn states its run’s freshness where the UI reads it', () => {
  let app: FastifyInstance;
  let hashOf: (g: unknown) => string | null;
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
      // ⚠ The REAL read route returns NO `analysis_ready`
      // (`assist.v1.scenario-graph.ts`), so the agent's readiness comes from the
      // canonical assessor fallback. A stubbed `analysis_ready` here hid that path
      // (OpenAI Connected N1 on #1766: stamping BEFORE the fallback survived).
      return { graph: currentGraph, graph_hash: hashOf(currentGraph), ...(readReturnsReady ? { analysis_ready: { status: 'ready', options: [], blockers: [] } } : {}), ...read };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { currentGraph = SERVED_PRICING_GRAPH; runFact = null; graphReadFails = false; readReturnsReady = false; afterRun = null; });

  const runThenAnswer = () => {
    callModelOutputs = [
      [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, one option leads.' }] }],
    ];
    return app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run the analysis.' } });
  };
  type State = { marker?: string; run_state?: { kind?: string }; leader_claim?: { permitted?: boolean } };
  type Ready = { freshness?: string; freshness_reason?: string };

  it('RED: run → answer on an UNCHANGED graph — analysis_ready.freshness is "fresh", matching run_state', async () => {
    const r = await runThenAnswer();
    expect(r.statusCode).toBe(200);
    expect((r.json().analysis_state as State).run_state?.kind, 'precondition').toBe('complete_current');
    const ready = r.json().analysis_ready as Ready & { options?: unknown[] };
    expect(ready.options?.length, 'precondition: readiness came from the assessor over the served graph').toBeGreaterThan(0);
    expect(ready.freshness).toBe('fresh');
    expect(ready.freshness_reason).toBe('agent_readback_run_state_current');
  });

  it('RED: the fresh verdict carries its ATTESTATION — graph_hash_at_run === current_graph_hash === the turn graph_hash, so a RELOAD can confirm it', async () => {
    const r = await runThenAnswer();
    const ready = r.json().analysis_ready as Ready & { graph_hash_at_run?: string; current_graph_hash?: string; computed_at?: string };
    const turnHash = r.json().graph_hash as string;
    expect(typeof turnHash === 'string' && turnHash.length > 0, 'precondition: the turn carries graph_hash').toBe(true);
    expect(ready.graph_hash_at_run).toBe(turnHash);
    expect(ready.current_graph_hash).toBe(turnHash);
    expect(ready.computed_at).toBe((r.json().analysis_state as { run_state?: { computed_at?: string } }).run_state?.computed_at);
  });

  it('CONTRAST: the graph CHANGES before readback — never "fresh"', async () => {
    afterRun = () => { currentGraph = SERVED_PRICING_GRAPH_CHANGED; };
    const r = await runThenAnswer();
    expect((r.json().analysis_state as State).run_state?.kind).not.toBe('complete_current');
    expect((r.json().analysis_ready as Ready | undefined)?.freshness).not.toBe('fresh');
  });

  it('the read route’s own analysis_ready (no freshness) is stamped too', async () => {
    readReturnsReady = true;
    const r = await runThenAnswer();
    expect((r.json().analysis_ready as Ready).freshness).toBe('fresh');
  });

  it('CONTRAST: an unavailable readback manufactures no verdict', async () => {
    graphReadFails = true;
    const r = await runThenAnswer();
    expect((r.json().analysis_ready as Ready | undefined)?.freshness).not.toBe('fresh');
  });
});

describe('withRunStateFreshness — restates CEE’s own verdict, never invents one', () => {
  it('maps complete_current → fresh and complete_stale → stale; everything else stays absent', async () => {
    const { withRunStateFreshness } = await import('../analysis-ready-freshness.js');
    const ready = { status: 'ready' };
    expect(withRunStateFreshness(ready, { run_state: { kind: 'complete_current' } })).toMatchObject({ freshness: 'fresh' });
    expect(withRunStateFreshness(ready, { run_state: { kind: 'complete_stale' } })).toMatchObject({ freshness: 'stale' });
    for (const kind of ['running', 'never_run', 'unknown_degraded', undefined]) {
      expect(withRunStateFreshness(ready, { run_state: { kind } })).toBe(ready);
    }
    expect(withRunStateFreshness(ready, undefined)).toBe(ready);
  });

  it('attests ONLY when the run’s own hash equals the current one — a mismatch or an absent hash stamps no hashes', async () => {
    const { withRunStateFreshness } = await import('../analysis-ready-freshness.js');
    const state = { run_state: { kind: 'complete_current', computed_at: '2026-09-23T20:13:05.494Z' } };
    const same = withRunStateFreshness({ status: 'ready' }, state, { graphHash: 'h1', analysisResult: { computed_against_hash: 'h1' } }) as Record<string, unknown>;
    expect(same).toMatchObject({ freshness: 'fresh', graph_hash_at_run: 'h1', current_graph_hash: 'h1', computed_at: '2026-09-23T20:13:05.494Z' });
    const differ = withRunStateFreshness({ status: 'ready' }, state, { graphHash: 'h2', analysisResult: { computed_against_hash: 'h1' } }) as Record<string, unknown>;
    expect(differ.freshness).toBe('fresh');
    expect(differ).not.toHaveProperty('graph_hash_at_run');
    expect(differ).not.toHaveProperty('current_graph_hash');
    const absent = withRunStateFreshness({ status: 'ready' }, state, { graphHash: 'h1', analysisResult: null }) as Record<string, unknown>;
    expect(absent).not.toHaveProperty('graph_hash_at_run');
    const stale = withRunStateFreshness({ status: 'ready' }, { run_state: { kind: 'complete_stale', computed_at: 'x' } }, { graphHash: 'h1', analysisResult: { computed_against_hash: 'h1' } }) as Record<string, unknown>;
    expect(stale).not.toHaveProperty('graph_hash_at_run');
  });

  it('never overwrites a verdict the producer already set', async () => {
    const { withRunStateFreshness } = await import('../analysis-ready-freshness.js');
    const ready = { status: 'ready', freshness: 'stale' };
    expect(withRunStateFreshness(ready, { run_state: { kind: 'complete_current' } })).toBe(ready);
  });
});
