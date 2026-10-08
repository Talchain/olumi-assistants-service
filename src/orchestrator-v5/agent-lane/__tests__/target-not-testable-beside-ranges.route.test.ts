/**
 * S2l THROUGH THE ROUTE: what the model is sent when the user presses Explain on the SERVED Wave B9 unseen b9-1 Run
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

describe('S2l: the model is not sent the unscoped not-testable message beside a range', () => {
  let app: FastifyInstance;
  let result: Json = READ.analysis_result;
  const sent: string[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
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
      blocks: [result], analysis_ready: READ.analysis_ready, analysis_state: READ.analysis_state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({
      graph: READ.graph, graph_hash: READ.graph_hash, analysis_state: READ.analysis_state,
      analysis_ready: READ.analysis_ready, analysis_result: result,
    }, SCENARIO));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); sent.length = 0; result = READ.analysis_result; });

  /** Run, then press the real Explain control; returns the model bodies the Explain turn sent. */
  const runThenExplain = async (): Promise<string[]> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.', source: 'chip_click',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: randomUUID(),
    } });
    expect(r.statusCode, r.body).toBe(200);
    sent.length = 0;
    const first = r.json();
    const chip = first.suggested_actions.find((c: { id: string }) => c.id.startsWith('agent-explain-run:'));
    expect(chip, r.body).toBeDefined();
    const e = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      scenario_id: SCENARIO, agent_session_id: first._agent.session_id, turn_id: randomUUID(), message: RUN_EXPLANATION_MESSAGE, chip: { id: chip.id },
    } });
    expect(e.statusCode, e.body).toBe(200);
    expect((e.json() as { _diagnostic_trace: { fast_path: string } })._diagnostic_trace.fast_path).toBe('explain');
    return sent.splice(0);
  };


  it('fixture control: the served b9-1 readback is a current Run with a range record beside the scoped not-testable record', () => {
    expect(READ.analysis_state.run_state.kind).toBe('complete_current');
    const codes = (READ.analysis_result.enrichment.inference_warnings as Json[]).map((w) => w.code);
    expect(codes).toContain('GOAL_CHANCE_RANGE');
    expect(codes).toContain('GOAL_FIGURES_TARGET_NOT_TESTABLE');
  });

  it('RED at base: the Explain call does not send the model the unscoped "can\'t yet test them against your target"', async () => {
    const explain = await runThenExplain();
    expect(explain.length).toBeGreaterThan(0);
    for (const body of explain) expect(body).not.toMatch(UNSCOPED);
  });

  it('CONTROL (author: the range record removed): the producer\'s message is true, and the Explain call still sends it', async () => {
    result = CONTROL_RESULT;
    const explain = await runThenExplain();
    expect(explain.some((b) => UNSCOPED.test(b)), 'Explain turn').toBe(true);
  });

  it('Codex r1 P0 (author twin): no scoped say + a placeholder withhold beside the range; no Explain body carries the unscoped words', async () => {
    const r = structuredClone(READ.analysis_result) as Json;
    r.enrichment.inference_warnings = [...(r.enrichment.inference_warnings as Json[]).map((w) => {
      if (w.code !== 'GOAL_FIGURES_TARGET_NOT_TESTABLE') return w;
      const { say: _say, ...rest } = w;
      return rest;
    }), { code: 'GOAL_FIGURES_PLACEHOLDER_PATH', severity: 'warning', option_ids: ['open_clifton_shop'], node_ids: ['monthly_profit'],
      withheld_claims: ['goal_probability'], message: 'This comparison turns on the link from ‘Clifton shop opening’ to ‘Clifton monthly operating profit’, whose strength nobody has set yet.' }];
    result = r;
    const explain = await runThenExplain();
    expect(explain.length).toBeGreaterThan(0);
    for (const body of explain) expect(body).not.toMatch(UNSCOPED);
  });
});
