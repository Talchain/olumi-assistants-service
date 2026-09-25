/**
 * THE PROVISIONAL MARKER REACHES THE BROWSER ON THE AGENT TURN.
 *
 * The Agent turn's `analysis_result` is the FINAL graph readback's block
 * (agent-v1-turn.ts `readBackState`), which is `readScenarioAnalysis` — the same
 * leg the reload read serves. So once `run_provenance` is on the transport
 * keep-list, a turn that returns a current auto-run result carries the marker
 * with no Agent-lane code of its own. This pins that through the real route.
 *
 * The persisted fact is a SERVED capture (`served-run-analysis-fact-for-binding
 * .json`, ~60 enrichment keys), not a fact written for this test, so the marker
 * is shown surviving the real projection over a real envelope: the deep
 * internal-key strip, the critiques projection and the unrequested-run
 * confinement all run on it.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SERVED_FACT = JSON.parse(readFileSync(new URL('./fixtures/served-run-analysis-fact-for-binding.json', import.meta.url), 'utf8')) as { fact_type: string; result: Record<string, unknown> };

const SCENARIO = '4d2c1b0a-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const BRIEF = 'Should we move the engineering team to a new delivery system this year?';
const GRAPH = {
  nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'f', kind: 'factor', label: 'Price' }],
  edges: [{ from: 'f', to: 'g', strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive' }],
};

let runFact: unknown = null;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
  readRecent: vi.fn(async () => (runFact === null ? [] : [{ id: 'row-run', turn_id: 't-run', turn_class: 'decide', created_at: '2026-09-24T10:00:00Z' }])),
  readFactsFor: vi.fn(async () => (runFact === null ? [] : [runFact])),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('the Agent turn carries run_provenance on its analysis_result', () => {
  let app: FastifyInstance;
  let stamp: Record<string, unknown>;
  let hashOf: (g: unknown) => string | null;
  let canonicalRead: (graph: unknown) => Promise<{ analysis_result: unknown }>;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is where the model stands.' }] }],
    }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    hashOf = (g) => computeAnalysisAffectingGraphHash(g as never) ?? null;
    const { buildConstructionAutoRunProvenance } = await import('../../context/run-initiator.js');
    const { registrationTurnId } = await import('../../graph-registration/registration-identity.js');
    const { constructionOperationId } = await import('../runtime/build-model.js');
    stamp = buildConstructionAutoRunProvenance(
      registrationTurnId(SCENARIO, constructionOperationId(SCENARIO, BRIEF)),
    ) as unknown as Record<string, unknown>;
    const { readScenarioAnalysis } = await import('../../../routes/scenario-graph-analysis-read.js');
    canonicalRead = (graph) => readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'test' }) as never;
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => {
      const read = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'test' });
      return { graph: GRAPH, graph_hash: hashOf(GRAPH), ...read };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 180_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { runFact = null; });

  const persist = (provenance: Record<string, unknown> | null) => {
    const enrichment = { ...(SERVED_FACT.result.enrichment as Record<string, unknown>) };
    if (provenance !== null) enrichment.run_provenance = provenance;
    runFact = { ...SERVED_FACT, noop: false, result: { ...SERVED_FACT.result, scenario_id: SCENARIO, graph_hash_at_run: hashOf(GRAPH), enrichment } };
  };
  const turn = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Where are we?' } });
  const resultBlocks = (json: { blocks?: unknown[] }) =>
    ((json.blocks ?? []) as { type: string; enrichment?: Record<string, unknown> }[]).filter((b) => b.type === 'analysis_result');

  it('a current construction auto-run: the turn’s analysis_result carries the stamp, exactly', async () => {
    persist(stamp);
    const r = await turn();
    expect(r.statusCode).toBe(200);
    const results = resultBlocks(r.json());
    expect(results).toHaveLength(1);
    expect(results[0].enrichment?.run_provenance).toEqual({
      initiated_by: 'auto_post_construction',
      provisional: true,
      construction_turn_id: stamp.construction_turn_id,
    });
    // ONE producer for both paths: the Agent turn's block IS the reload read's block.
    expect(results[0]).toEqual((await canonicalRead(GRAPH)).analysis_result);
  });

  it('CONTRAST: the same served fact without a stamp (a user-initiated run) — block present, key absent', async () => {
    persist(null);
    const r = await turn();
    const results = resultBlocks(r.json());
    expect(results, 'the control: a result is still served').toHaveLength(1);
    expect(Object.prototype.hasOwnProperty.call(results[0].enrichment ?? {}, 'run_provenance')).toBe(false);
  });
});
