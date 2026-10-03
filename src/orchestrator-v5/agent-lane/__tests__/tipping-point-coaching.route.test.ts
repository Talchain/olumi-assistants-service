/** Actual Agent route over inherited served science; provider/store transport stubbed. No served journey claim. */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RUN_EXPLANATION_UNAVAILABLE_TEXT } from '../run-explanation.js';
import { TIPPING_POINT_PRESS_ID } from '../tipping-point-coaching.js';

type Stored = { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] };
const rows = new Map<string, Stored>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const key = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(key)) rows.set(key, { id: randomUUID(), request_hash: w.request_hash,
      assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null,
      llm_calls_used: w.llm_calls_used ?? 0, pending_actions: w.pending_actions ?? [] });
    return { id: rows.get(key)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
type Rec = Record<string, unknown>;
const read = (path: string): Rec => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Rec;
const positive = read('../../../../tests/fixtures/cross-service/b5-per-limit/0e19bb82.served-turn.json');
const control = read('../../coaching/__tests__/fixtures/paul-run-17d1cd3a-next-move.json').analysis_result as Rec;
const sentence = 'Pro plan price is a factor that could change this: the comparison could change if it rises above 55.76 GBP/month.';

describe('SCI-HERO live route consumer', () => {
  let app: FastifyInstance;
  let sid: string;
  let kind: string;
  let at: string;
  let enrichment: unknown;
  let changeAfterRead: boolean;
  let reads: number;
  let calls: number;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Churn falls below 56 USD/month.' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => {
      reads += 1;
      if (changeAfterRead && reads > 1) at = '2026-10-03T00:01:00.000Z';
      return { graph: positive.graph, graph_hash: positive.graph_hash,
        analysis_ready: { status: 'ready', may_run: true },
        analysis_state: { run_state: { kind, computed_at: at }, usable_for_chips: true,
          leader_claim: { permitted: false, withheld_reason: 'close_call' } },
        analysis_result: { type: 'analysis_result', computed_against_hash: positive.graph_hash, enrichment } };
    });
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    const route = await import('../../../routes/agent-v1-turn.js');
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => {
    sid = randomUUID(); kind = 'complete_current'; at = '2026-10-03T00:00:00.000Z';
    enrichment = positive.enrichment; reads = 0; calls = 0; changeAfterRead = false;
  });
  const press = async (turnId?: string) => {
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: sid, message: 'What would most likely change this result?',
      source: 'chip', chip: { id: TIPPING_POINT_PRESS_ID },
      ...(turnId !== undefined ? { turn_id: turnId } : {}),
    } });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as { assistant_text: string; suggested_actions: { id: string }[]; guidance?: unknown;
      _agent: { tool_calls: { name: string; mutated?: boolean }[] } };
  };
  it('withheld winner + flat EVPPI retains the exact deterministic threshold; no provider or mutation', async () => {
    const body = await press();
    expect(body.assistant_text).toBe(sentence);
    expect(calls).toBe(0);
    expect(body._agent.tool_calls).toEqual([]);
    expect(body.guidance).toBeUndefined();
    expect(body.suggested_actions.map(action => action.id)).toEqual(['agent-talk-it-through']);
  });
  it('served no-signal control claims no threshold and does not fall through to generation', async () => {
    enrichment = control.enrichment;
    const body = await press();
    expect(body.assistant_text).not.toMatch(/55\.76|could change if|Churn falls/iu);
    expect(calls).toBe(0);
  });
  it('stale analysis refuses the prior threshold', async () => {
    kind = 'complete_stale';
    expect((await press()).assistant_text).toBe(RUN_EXPLANATION_UNAVAILABLE_TEXT);
    expect(calls).toBe(0);
  });
  it('a competing newer Run on the same graph refuses the earlier threshold as current', async () => {
    changeAfterRead = true;
    expect((await press()).assistant_text).toBe(RUN_EXPLANATION_UNAVAILABLE_TEXT);
    expect(reads).toBeGreaterThan(1);
    expect(calls).toBe(0);
  });
  it('a cold scenario read needs no conversation history', async () => {
    expect((await press()).assistant_text).toBe(sentence);
    sid = randomUUID();
    expect((await press()).assistant_text).toBe(sentence);
    expect(calls).toBe(0);
  });
  it('retry after an edit refuses the stored threshold', async () => {
    const turnId = randomUUID();
    expect((await press(turnId)).assistant_text).toBe(sentence);
    kind = 'complete_stale';
    expect((await press(turnId)).assistant_text).toBe(RUN_EXPLANATION_UNAVAILABLE_TEXT);
    expect(calls).toBe(0);
  });
  it('retry after a newer Run answers the unbound question from the selected current fact, never stored words', async () => {
    const turnId = randomUUID();
    expect((await press(turnId)).assistant_text).toBe(sentence);
    const changed = structuredClone(positive.enrichment) as { flip_thresholds: { factor_id: string; flip_value: number | null }[] };
    changed.flip_thresholds.find(row => row.factor_id === 'pro_plan_price' && row.flip_value !== null)!.flip_value = 60;
    enrichment = changed;
    at = '2026-10-03T00:01:00.000Z';
    const body = await press(turnId);
    expect(body.assistant_text).toBe(sentence.replace('55.76', '60'));
    expect(calls).toBe(0);
  });
});
