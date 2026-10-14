/** Live route behaviour for PR-S2: the shipped narration agrees with the selected Run driver display. */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sentenceMultiset } from '../reply/compose-reply.js';

type Json = Record<string, any>;
const PROD = JSON.parse(readFileSync(new URL('./fixtures/prod-cut6-smoke-cdcd44c3-turn003.json', import.meta.url), 'utf8')) as Json;

type Row = { id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number };
const rows = new Map<string, Row>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used: number }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row: Row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const provider = { calls: 0, text: PROD.assistant_text };
const fakeFetch = vi.fn(async () => {
  provider.calls += 1;
  return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: provider.text }] }] }), { status: 200 });
});

const SID = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const T1 = '3c8c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';
const MESSAGE = 'Explain the recorded analysis.';
const ABSENCE_CLAUSE = '; sensitivity has not established which assumption matters most.';
let analysisResult: Json;

async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({
    graph: PROD.draft_graph,
    graph_hash: PROD.graph_hash,
    analysis_state: PROD.analysis_state,
    analysis_ready: PROD.analysis_ready,
    analysis_result: analysisResult,
  }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

describe('live Agent final egress respects the selected Run goal-chance drivers', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    // No committed row is seeded: each POST must call the model and traverse the live exit.
    rows.clear(); provider.calls = 0; provider.text = PROD.assistant_text;
    analysisResult = JSON.parse(JSON.stringify(PROD.blocks.find((b: Json) => b.type === 'analysis_result')));
    vi.stubGlobal('fetch', fakeFetch);
    app = await freshApp();
  }, 60_000);
  afterEach(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  async function liveTurn() {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SID, message: MESSAGE, turn_id: T1,
    } });
    expect(r.statusCode, r.body).toBe(200);
    const body = r.json() as { assistant_text: string; _agent?: { replayed?: boolean }; analysis_state?: Json };
    expect(body._agent?.replayed).not.toBe(true);
    expect(provider.calls, 'the production narration came from a live model call').toBeGreaterThan(0);
    expect(body.analysis_state?.run_state.kind).toBe('complete_current');
    return body;
  }

  it('ships the production narration with only the driver-absence clause removed', async () => {
    const body = await liveTurn();
    expect(body.assistant_text.endsWith('Six underlying values were supplied by Olumi, not you.')).toBe(true);
    expect(body.assistant_text).not.toContain('has not established which assumption matters most');
    // S-A (#2748): only that clause changes; the ONE composer may then move sentences, never change one.
    expect(sentenceMultiset(body.assistant_text)).toEqual(sentenceMultiset(PROD.assistant_text.replace(ABSENCE_CLAUSE, '.')));
  });

  it('CONTRAST: the same live turn without licensed drivers ships the clause unchanged', async () => {
    const licence = analysisResult.enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
    delete licence.driver_by_option;
    licence.no_driver_by_option = Object.fromEntries(licence.option_ids.map((id: string) => [id, 'none']));
    const body = await liveTurn();
    expect(body.assistant_text).toContain(ABSENCE_CLAUSE);
    expect(sentenceMultiset(body.assistant_text)).toEqual(sentenceMultiset(PROD.assistant_text));
  });
});
