/**
 * S2i THROUGH THE ROUTE: what the model is actually sent when the user presses Explain on a current Run.
 *
 * The real route with a fixed narrator (no provider is contacted; harness from goal-chance-screen-lines.explain.route.test.ts),
 * on the SERVED Wave B5 T1b readback (CEE 3fce64f, keys untouched): its screen named each option's driver and its
 * robustness check ran. Every request body the route sends to the model is captured. Before S2i the Explain call carried
 * `decision_sensitivity: not_measured` and `tipping_point: not_evaluated`; the CONTROL is the author's derivative with
 * no driver claim and no robustness check, where the screen shows neither and both are still sent.
 * The Run turn here makes no model call (its reply is the orchestrate stub's); the run tool's projection is rowed through
 * the real `runAnalysis` in decision-sensitivity-from-evppi-only.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';

type Json = Record<string, any>;
const READ = (JSON.parse(readFileSync(new URL('./fixtures/waveB5-t1b-3fce64f-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
const SCENARIO = '6e5d4c3b-2a1f-4e0d-9c8b-7a6f5e4d3c2b';
// A key in the facts the model reads (JSON inside JSON), never the instruction text that names the field.
const SENT_SENSITIVITY = /decision_sensitivity\\*"\s*:/u;
const SENT_NOT_EVALUATED = /tipping_point\\*"\s*:\s*\{\s*\\*"status\\*"\s*:\s*\\*"not_evaluated/u;
const DRIVER_ONLY_RESULT = ((): Json => {
  const r = structuredClone(READ.analysis_result) as Json;
  delete r.enrichment.robustness; delete r.robustness;
  return r;
})();
const CONTROL_RESULT = ((): Json => {
  const r = structuredClone(READ.analysis_result) as Json;
  delete r.enrichment.robustness; delete r.robustness;
  const licence = r.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
  delete licence.driver_by_option;
  licence.no_driver_by_option = Object.fromEntries(licence.option_ids.map((id: string) => [id, 'none']));
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

describe('S2i: the model is not sent an absence status beside a screen that shows a driver', () => {
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
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: READ.graph, graph_hash: READ.graph_hash, analysis_state: READ.analysis_state,
      analysis_ready: READ.analysis_ready, analysis_result: result,
    }));
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

  it('fixture control: the served T1b readback is a current Run whose producers say not_measured / not_evaluated', () => {
    expect(READ.analysis_state.run_state.kind).toBe('complete_current');
    expect(READ.analysis_result.enrichment).not.toHaveProperty('factor_evppi');
    expect(READ.analysis_result.enrichment.flip_thresholds ?? []).toEqual([]);
  });

  it('RED at base: the Explain call sends the model no absence status', async () => {
    const explain = await runThenExplain();
    expect(explain.length).toBeGreaterThan(0);
    for (const body of explain) {
      expect(body).not.toMatch(SENT_SENSITIVITY);
      expect(body).not.toMatch(SENT_NOT_EVALUATED);
    }
  });

  it('driver alone (author: robustness removed): still none — the Explain caller gates on the screen’s labels', async () => {
    result = DRIVER_ONLY_RESULT;
    const explain = await runThenExplain();
    expect(explain.length).toBeGreaterThan(0);
    for (const body of explain) {
      expect(body).not.toMatch(SENT_SENSITIVITY);
      expect(body).not.toMatch(SENT_NOT_EVALUATED);
    }
  });

  it('CONTROL (author: no driver claim, no robustness): the Explain call still sends both statuses', async () => {
    result = CONTROL_RESULT;
    const explain = await runThenExplain();
    expect(explain.some((b) => SENT_SENSITIVITY.test(b)), 'Explain turn').toBe(true);
    expect(explain.some((b) => SENT_NOT_EVALUATED.test(b)), 'Explain turn tipping point').toBe(true);
  });
});
