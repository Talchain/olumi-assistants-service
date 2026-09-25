/**
 * THE AGENT ROUTE AFTER A RESTORE (same hash, newer marker) — RC #69 5828938080 §1.
 *
 * The Conventional route called a restored model's analysis current on routed
 * turns while the reload said stale (`route-v2-turn-path-restore-marker.test.ts`,
 * bank `bank/turn-path-restore-marker`). RC asked for the same sequence on
 * `/agent/v1/turn`, the OpenAI guest journey, before any lease.
 *
 * Source at 9417228: the agent route takes `analysis_state` / `analysis_result`
 * from a readback of `/assist/v1/scenarios/:id/graph` — the reload itself — and
 * restates `analysis_ready.freshness` from that `run_state`. So the wire should
 * agree with the reload by construction. This file measures it, keylessly.
 *
 * Harness from `agent-turn-states-its-run-freshness.test.ts`: `fetch` is stubbed
 * (no provider call), and the graph read answers with the REAL
 * `readScenarioAnalysis`, fed the served run fact and the store's marker.
 *
 *   CONTROL  the reload itself says complete_stale (marker newer than the run);
 *   CHECK    an Agent turn on the same store — analysis_state and
 *            analysis_ready.freshness — agrees with it;
 *   CHECK    and the MODEL, reading `get_canonical_state`, is handed the same
 *            verdict (the tool reads the same route);
 *   CONTROL  marker OLDER than the run → complete_current / fresh;
 *   CONTROL  no marker → complete_current / fresh.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SERVED_FACT = JSON.parse(readFileSync(new URL('./fixtures/served-run-analysis-fact-for-binding.json', import.meta.url), 'utf8')) as { fact_type: string; result: Record<string, unknown> };
const SERVED_PRICING_GRAPH = { ...(JSON.parse(readFileSync(new URL('./fixtures/served-pricing-graph-c4a6cce.json', import.meta.url), 'utf8')) as Record<string, unknown>) };

const SCENARIO = '4d2c1b0a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const RUN_AT = SERVED_FACT.result.computed_at as string;
const shift = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const AFTER_RUN = shift(RUN_AT, 30 * 60_000);
const BEFORE_RUN = shift(RUN_AT, -30 * 60_000);

let runFact: unknown = null;
let marker: string | null = null;
const modelRequests: string[] = [];
/** Scripted model outputs, one per model call; a plain answer once exhausted. */
let modelOutputs: Record<string, unknown>[][] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
  readRecent: vi.fn(async () => (runFact === null ? [] : [{ id: 'row-run', turn_id: 't-run', turn_class: 'decide', created_at: RUN_AT }])),
  readFactsFor: vi.fn(async () => (runFact === null ? [] : [runFact])),
  readAnalysisInvalidatedAt: vi.fn(async () => marker),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('the Agent turn after a restore agrees with the reload', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      modelRequests.push(typeof init?.body === 'string' ? init.body : '');
      const output = modelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Here is where the model stands.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const hash = computeAnalysisAffectingGraphHash(SERVED_PRICING_GRAPH as never);
    if (hash === null) throw new Error('premise: the served graph has an analysis hash');
    // The restore case: the run was computed against EXACTLY the stored graph.
    runFact = { ...SERVED_FACT, noop: false, result: { ...SERVED_FACT.result, scenario_id: SCENARIO, graph_hash_at_run: hash } };
    const { readScenarioAnalysis } = await import('../../../routes/scenario-graph-analysis-read.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => {
      const read = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: SERVED_PRICING_GRAPH, requestId: 'test' });
      return { graph: SERVED_PRICING_GRAPH, graph_hash: hash, ...read };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { marker = null; modelRequests.length = 0; modelOutputs = []; });

  /**
   * What the MODEL reads: it calls `get_canonical_state`, and the tool result it
   * is handed on the next request is found by its call id and parsed whole.
   */
  let stateCalls = 0;
  const analysisTheModelReads = async (): Promise<{ run_state?: { kind?: string } } | undefined> => {
    // A unique id per call: the lane replays earlier turns' tool calls as
    // conversation history, so a shared id would match a previous turn's result.
    stateCalls += 1;
    const callId = `c-state-${stateCalls}`;
    modelOutputs = [[{ type: 'function_call', name: 'get_canonical_state', arguments: '{}', call_id: callId }]];
    modelRequests.length = 0;
    await agentTurn();
    expect(modelRequests.length, 'premise: the tool result went back to the model').toBeGreaterThanOrEqual(2);
    const input = (JSON.parse(modelRequests[1]!) as { input?: Array<{ type?: string; call_id?: string; output?: string }> }).input ?? [];
    const outputs = input.filter((i) => i.type === 'function_call_output' && i.call_id === callId);
    expect(outputs, 'premise: exactly one get_canonical_state result').toHaveLength(1);
    return (JSON.parse(outputs[0]!.output!) as { analysis?: { run_state?: { kind?: string } } }).analysis;
  };

  type Body = { analysis_state?: { run_state?: { kind?: string } }; analysis_ready?: { freshness?: string } };
  const agentTurn = async (): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Where does the analysis stand?' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(modelRequests.length, 'premise: the turn reached the (stubbed) model').toBeGreaterThan(0);
    return r.json() as Body;
  };
  const reload = async (): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
    expect(r.statusCode).toBe(200);
    return r.json() as Body;
  };

  it('CONTROL (the authority): the reload says complete_stale when the marker is newer than the run', async () => {
    marker = AFTER_RUN;
    expect((await reload()).analysis_state?.run_state?.kind).toBe('complete_stale');
  });

  it('CHECK: an Agent turn agrees — complete_stale, and analysis_ready.freshness is not "fresh"', async () => {
    marker = AFTER_RUN;
    const body = await agentTurn();
    expect(body.analysis_state?.run_state?.kind).toBe('complete_stale');
    expect(body.analysis_state?.run_state?.kind).toBe((await reload()).analysis_state?.run_state?.kind);
    expect(body.analysis_ready?.freshness).toBe('stale');
  });

  it('CHECK: the MODEL reads complete_stale from get_canonical_state (and complete_current with an older marker)', async () => {
    marker = AFTER_RUN;
    expect((await analysisTheModelReads())?.run_state?.kind).toBe('complete_stale');
    marker = BEFORE_RUN;
    expect((await analysisTheModelReads())?.run_state?.kind).toBe('complete_current');
  });

  it('CONTROL: marker OLDER than the run → complete_current / fresh (time, not presence)', async () => {
    marker = BEFORE_RUN;
    const body = await agentTurn();
    expect(body.analysis_state?.run_state?.kind).toBe('complete_current');
    expect(body.analysis_ready?.freshness).toBe('fresh');
  });

  it('CONTROL: no marker → complete_current / fresh', async () => {
    const body = await agentTurn();
    expect(body.analysis_state?.run_state?.kind).toBe('complete_current');
    expect(body.analysis_ready?.freshness).toBe('fresh');
  });
});
