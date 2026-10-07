/**
 * S2i P6 (DL, 7 Oct): "make no claim about investigation priority beyond the screen's own driver lines; if the screen
 * shows no driver and no range, say it is not established yet." One row each way, through the real route and its egress.
 *
 * The real route with a fixed narrator (no provider is contacted; harness from goal-chance-screen-lines.explain.route.test.ts)
 * pressing the real Explain control. Runs are SERVED, keys untouched:
 * - Wave B1 unseen 1 (CEE b568cc9): its screen showed two range lines; its narration said "Sensitivity was not
 *   measured, so investigation priority is not established." (served);
 * - Wave B5 T1b readback (CEE 3fce64f): its screen named each option's driver.
 * The no-driver, no-range Runs are the author's derivatives of those two, labelled. The limitation sentence in the DL's
 * words ("…is not established yet.") is the author's.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';

type Json = Record<string, any>;
type Read = { graph: Json; graph_hash: string; analysis_state: Json; analysis_ready: Json; analysis_result: Json };
const fixture = (name: string): Json => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Json;
const T1B: Read = fixture('waveB5-t1b-3fce64f-readback-run1.json').j;
const B1 = ((): Read => {
  const body = fixture('waveB-unseen1-b568cc9-run1-turn003.json');
  return { graph: body.draft_graph, graph_hash: body.graph_hash, analysis_state: body.analysis_state, analysis_ready: body.analysis_ready,
    analysis_result: body.blocks.find((b: Json) => b?.type === 'analysis_result') };
})();
const B1_SENTENCE = 'Sensitivity was not measured, so investigation priority is not established.';
const LIMIT = 'Investigation priority is not established yet.';
const CLAUSE = "make no claim about investigation priority beyond the screen's own driver lines; if the screen shows no driver and no range, say it is not established yet.";
const withResult = (read: Read, edit: (r: Json) => void): Read => {
  const r = structuredClone(read.analysis_result);
  edit(r);
  return { ...read, analysis_result: r };
};
// Author's derivatives: the screen shows no driver and no range.
const T1B_NO_DRIVER = withResult(T1B, (r) => {
  const licence = r.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
  delete licence.driver_by_option;
  licence.no_driver_by_option = Object.fromEntries(licence.option_ids.map((id: string) => [id, 'none']));
});
const B1_NO_RANGE = withResult(B1, (r) => {
  r.enrichment.inference_warnings = r.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_RANGE');
});
const SCENARIO = '7f6e5d4c-3b2a-4f1e-8d0c-9b8a7f6e5d4c';

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

describe('S2i P6: investigation priority — no claim beyond the screen’s driver lines; the limit stays where it is true', () => {
  let app: FastifyInstance;
  let narrator = '';
  let read: Read = T1B;
  const sent: string[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      sent.push(typeof init?.body === 'string' ? init.body : '');
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: narrator }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: read.graph_hash,
      blocks: [read.analysis_result], analysis_ready: read.analysis_ready, analysis_state: read.analysis_state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: read.graph, graph_hash: read.graph_hash, analysis_state: read.analysis_state,
      analysis_ready: read.analysis_ready, analysis_result: read.analysis_result,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); sent.length = 0; narrator = ''; read = T1B; });

  /** Run, then press the real Explain control with the narrator writing `text`; the reply and the Explain call's bodies. */
  const explainSaying = async (on: Read, text: string): Promise<{ reply: string; bodies: string[] }> => {
    read = on;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: randomUUID(),
    } });
    expect(r.statusCode, r.body).toBe(200);
    const first = r.json();
    const chip = first.suggested_actions.find((c: { id: string }) => c.id.startsWith('agent-explain-run:'));
    expect(chip, r.body).toBeDefined();
    sent.length = 0;
    narrator = text;
    const e = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      scenario_id: SCENARIO, agent_session_id: first._agent.session_id, turn_id: randomUUID(), message: RUN_EXPLANATION_MESSAGE, chip: { id: chip.id },
    } });
    expect(e.statusCode, e.body).toBe(200);
    const body = e.json() as { assistant_text: string; _diagnostic_trace: { fast_path: string } };
    expect(body._diagnostic_trace.fast_path).toBe('explain');
    return { reply: body.assistant_text, bodies: sent.splice(0) };
  };

  it('fixture control: B1 carries the served sentence beside its range lines; both Runs are current', () => {
    expect(fixture('waveB-unseen1-b568cc9-run1-turn003.json').assistant_text).toContain(B1_SENTENCE);
    for (const r of [B1, T1B]) expect(r.analysis_state.run_state.kind).toBe('complete_current');
  });

  it('the Explain call carries the DL’s clause (the in-repo constant, code only)', async () => {
    const { bodies } = await explainSaying(T1B, 'The analysis ran.');
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((b) => b.includes(CLAUSE))).toBe(true);
    expect(bodies.some((b) => b.includes('say investigation priority is not established.'))).toBe(false);
  });

  it('(a) served range Run (B1 unseen 1): the served "…so investigation priority is not established." is not said', async () => {
    const { reply } = await explainSaying(B1, B1_SENTENCE);
    expect(reply, reply).not.toMatch(/not established/u);
  });

  it('(a) served driver Run (B5 T1b): the limitation in the DL’s words is not said', async () => {
    const { reply } = await explainSaying(T1B, LIMIT);
    expect(reply, reply).not.toMatch(/not established/u);
  });

  it('(b) no driver and no range (author: B5 T1b with no driver claim; robustness ran): the limitation is still said', async () => {
    const { reply } = await explainSaying(T1B_NO_DRIVER, LIMIT);
    expect(reply.split(LIMIT).length - 1, reply).toBe(1);
  });

  it('(b) no driver and no range (author: B1 unseen 1 with its range record removed): the served sentence is still said', async () => {
    const { reply } = await explainSaying(B1_NO_RANGE, B1_SENTENCE);
    expect(reply, reply).toContain('investigation priority is not established');
  });
});
