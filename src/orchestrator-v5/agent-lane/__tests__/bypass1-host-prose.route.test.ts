import { runPressToolResponse } from './fixtures/run-press-model.js';
/**
 * ⭐ BYPASS1 THROUGH THE ROUTE (DL, 14 Oct). Harness: target-not-testable-beside-ranges.route.test.ts (served b9-1 readback,
 * real route, scripted AI, no provider contacted). Was: S2l THROUGH THE ROUTE: what the model is sent when the user presses Explain on the SERVED Wave B9 unseen b9-1 Run
 * (guest, staging, CEE df15c8c1; `waveB9-unseen1-df15c8c-readback-pre-challenge.json`, the graph read verbatim). Its screen
 * showed three range lines; its not-testable record (scoped to `carry_on_as_now`) kept the producer's unscoped message,
 * and the Challenge said "Without sized profit effects, the model cannot test your £24,000 target." Harness copied from
 * decision-sensitivity-screen-gate.route.test.ts (real route, fixed narrator, no provider contacted).
 */
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';

type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('./fixtures/waveB9-unseen1-df15c8c-readback-pre-challenge.json', import.meta.url), 'utf8')) as { j: Json }).j;
const SCENARIO = '7e6d5c4b-3a2f-4e1d-8c9b-6a5f4e3d2c1b';
const UNSCOPED = /can.{1,8}t yet test them against your target/u;
const CONTROL_RESULT = ((): Json => {
  const r = structuredClone(READ.analysis_result) as Json;
  r.enrichment.inference_warnings = r.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_RANGE');
  return r;
})();

const rows = new Map<string, { id: string; turn_id: string; request_hash: string }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const NO_TARGET_GRAPH = ((): Json => {
  const g = structuredClone(READ.graph) as Json;
  const goal = (g.nodes as Json[]).find((n) => n.kind === 'goal')!;
  for (const k of ['goal_threshold', 'goal_threshold_raw', 'goal_threshold_cap', 'goal_threshold_cap_provenance', 'success_threshold', 'threshold_source']) delete goal[k];
  return g;
})();
const CHANCE_LINE = /% chance of meeting your goal, in this model/;
const ESTIMATES_FACE = /Olumi's estimates: \d+, see Check estimates\./;

describe('BYPASS1: host prose stops only where the AI wrote the reply; the facts reach the AI', () => {
  let app: FastifyInstance;
  let graph: Json = READ.graph;
  const sent: string[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const runCall = runPressToolResponse(JSON.parse(String(init?.body ?? '{}')));
      if (runCall) return runCall;
      sent.push(typeof init?.body === 'string' ? init.body : '');
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'The analysis ran.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: READ.graph_hash,
      blocks: [READ.analysis_result], analysis_ready: READ.analysis_ready, analysis_state: READ.analysis_state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({
      graph, graph_hash: READ.graph_hash, analysis_state: READ.analysis_state,
      analysis_ready: READ.analysis_ready, analysis_result: READ.analysis_result,
    }, SCENARIO));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); sent.length = 0; graph = READ.graph; });

  /** DGAI's own Run press (sendTurn → buildV5Payload, e218e3d2: turn_class 'frame', a bound run_analysis chip). */
  const runPress = async (): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
      message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json();
  };

  it('NEGATIVE (host-written): the Run press reply keeps every host line (chances, the estimates face line)', async () => {
    const run = await runPress();
    expect(run.assistant_text).toMatch(CHANCE_LINE);
    expect(run.assistant_text).toMatch(ESTIMATES_FACE);
  });

  it('AI-written Explain: no host chance or estimates lines are added, and the AI was given the chance facts', async () => {
    const run = await runPress();
    const chip = (run.suggested_actions as { id: string }[]).find((c) => c.id.startsWith('agent-explain-run:'));
    expect(chip, JSON.stringify(run.suggested_actions)).toBeDefined();
    sent.length = 0;
    const e = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
      message: RUN_EXPLANATION_MESSAGE, source: 'chip_click', chip: { id: chip!.id } } });
    expect(e.statusCode, e.body).toBe(200);
    const explain = e.json() as Json;
    expect(explain._diagnostic_trace.fast_path).toBe('explain');
    expect(explain.assistant_text.startsWith('The analysis ran.')).toBe(true);
    expect(explain.assistant_text).not.toMatch(CHANCE_LINE);
    expect(explain.assistant_text).not.toMatch(ESTIMATES_FACE);
    // The facts those lines carried are in the AI's input (the Explain call's SENT body).
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('goal_chance_range_display');
    expect(sent[0]).toContain('When CURRENT MODEL STATE carries a typed blocker for this turn');
  });

  it('the typed blocker reaches the AI as a fact: a goal with no target is the ONE step, and no host line says it', async () => {
    graph = NO_TARGET_GRAPH;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame',
      message: 'What should I do next?', source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    const body = sent.find((b) => b.includes('CURRENT MODEL STATE'));
    expect(body, 'the converse call carries the state').toBeDefined();
    const state = JSON.stringify(JSON.parse(body!));
    expect(state).toContain('next_step_blocker');
    expect(state).toContain('goal_target_missing');
    expect(state).toContain('monthly profit');
    const reply = (r.json() as Json).assistant_text as string;
    expect(reply.startsWith('The analysis ran.')).toBe(true);
    // No host target ask: the AI asks it from the fact (the conditional basis, whose sentence the AI lacks, stays).
    expect(reply).not.toMatch(/as your target\./);
  });
});
