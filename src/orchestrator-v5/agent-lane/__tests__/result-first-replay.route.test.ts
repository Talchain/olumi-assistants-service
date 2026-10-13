/**
 * AI HARNESS — CODEX_CLI_OVERFLOW CHANGES_REQUIRED on #2470 (5936280278). The two-request Run keeps its promise on the
 * paths a retry, a lost response and a failed explanation take: request 2 explains THE SAME Run or says it is stale;
 * a lost request 1 replays the CURRENT result with its Explain control (across a restart too); a failed explanation
 * offers the same bound control again; a deadlined interpret call is made once. Live route, the model stubbed, and a
 * store double that reads answer rows back as the real store does (snake_case columns).
 */
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { decisionInputAsk } from '../decision-input-ask.js';
import { sentencesOf } from '../reply/compose-reply.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';
import { isRunExplanationChip, RUN_EXPLANATION_MESSAGE, RUN_EXPLANATION_UNAVAILABLE_TEXT, RUN_RESULT_READY_TEXT } from '../run-explanation.js';

const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-withheld-leader-0948Z.json', import.meta.url), 'utf8')) as {
  analysis_state: Record<string, unknown>;
  block: Record<string, unknown>;
};
const SCENARIO = '3c9b1e2d-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const HASH = String(SERVED.block.computed_against_hash);
const GRAPH = { nodes: [{ id: 'g', kind: 'goal', label: 'MRR' }, { id: 'ai_reporting_sprint', kind: 'option', label: 'AI Reporting Sprint' }], edges: [] };
const READY = { status: 'ready', analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
const RUN_A = '2026-10-01T09:48:47.190Z';
const RUN_B = '2026-10-01T09:58:47.190Z';
const PROSE = 'The result depends on the assumptions in your model.';

let computedAt = RUN_A;
let runKind = 'complete_current';
const state = () => ({ ...SERVED.analysis_state, run_state: { kind: runKind, computed_at: computedAt } });
/** Olumi's own line when request 1 ran but no current result can be confirmed (the route's `RUN_RESULT_UNVERIFIED_TEXT`). */
const UNVERIFIED = 'The analysis finished, but I can’t verify a current result. Check the current results before asking again.';

type Row = Record<string, unknown>;
const rows: Row[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  // As the real store reads a row back by its turn id: snake_case columns (the claim row has its own turn id).
  readCommittedTurn: vi.fn(async (_scenario: string, id: string) => {
    const r = rows.find((x) => x.turn_id === id);
    return r === undefined ? null : { id: String(r.turn_id), request_hash: r.request_hash, assistant_message: r.assistantMessage ?? null,
      user_message: r.userMessage ?? null, llm_calls_used: r.llm_calls_used ?? 0, pending_actions: r.pending_actions ?? [] };
  }),
  append: vi.fn(async (row: Row) => { rows.push({ ...row }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let provider: 'ok' | 'empty' | 'fetch_failed' = 'ok';
let modelCalls = 0;
let runs = 0;

async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules();
  process.env.AGENT_LANE_ENABLED = 'true';
  process.env.AGENT_LANE_PREVIEW = 'false';
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/orchestrate/v2/turn', async () => {
    runs += 1;
    return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
      graph_hash: HASH, blocks: [SERVED.block], analysis_state: state(), analysis_ready: READY };
  });
  app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({ graph: GRAPH, graph_hash: HASH, analysis_ready: READY,
    analysis_state: state(), analysis_result: SERVED.block }, SCENARIO));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

type Body = { assistant_text: string; _answer_shape?: AnswerShape; suggested_actions: { id: string }[]; narration?: { status: string; run_key: string };
  blocks?: { type?: string }[]; _agent: { session_id: string } };

describe('result-first on retry, lost response and failed explanation (live route)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      modelCalls += 1;
      if (provider === 'fetch_failed') throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ output: provider === 'empty' ? []
        : [{ type: 'message', content: [{ type: 'output_text', text: PROSE }] }] }), { status: 200 });
    }));
    app = await freshApp();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { computedAt = RUN_A; runKind = 'complete_current'; rows.length = 0; provider = 'ok'; modelCalls = 0; runs = 0; });

  const post = (payload: Record<string, unknown>) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { scenario_id: SCENARIO, ...payload } });
  const runTurn = (turnId: string) => post({ turn_id: turnId, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } });

  it('Run dispatches and interprets once; unbound retry withholds narration after restart', async () => {
    const id = randomUUID();
    const first = (await runTurn(id)).json() as Body;
    expect(first.assistant_text).toContain(PROSE);
    expect(first.narration?.status).toBe('ready');
    expect(first._answer_shape).toBeUndefined();
    expect(first.suggested_actions.some(c => isRunExplanationChip(c.id))).toBe(true);
    expect(runs).toBe(1); expect(modelCalls).toBe(1);
    await app.close(); app = await freshApp();
    const replay = (await runTurn(id)).json() as Body;
    expect(replay.assistant_text).toBe(RUN_EXPLANATION_UNAVAILABLE_TEXT);
    expect(replay.narration).toBeUndefined();
    expect(replay.blocks).toBeUndefined();
    expect(runs).toBe(1); expect(modelCalls).toBe(1);
  });
  it.each(['complete_current', 'stale'])('Explain keeps its request-bound key after a newer or stale Run (%s)', async kind => {
    const first = (await runTurn(randomUUID())).json() as Body;
    const chip = first.suggested_actions.find(c => isRunExplanationChip(c.id))!;
    const id = randomUUID();
    const payload = { turn_id: id, message: RUN_EXPLANATION_MESSAGE, source: 'chip_click', chip };
    const explained = (await post(payload)).json() as Body;
    expect(explained.assistant_text).toContain(PROSE);
    expect(explained.narration?.status).toBe('ready');
    await app.close(); app = await freshApp();
    const same = (await post(payload)).json() as Body;
    expect(same.assistant_text).toBe(explained.assistant_text);
    expect(same.narration).toEqual(explained.narration);
    computedAt = RUN_B; runKind = kind;
    const saved = structuredClone(rows); store.append.mockClear();
    const replay = (await post(payload)).json() as Body;
    expect(replay.assistant_text).toBe(RUN_EXPLANATION_UNAVAILABLE_TEXT);
    expect(replay.narration).toEqual({ status: 'stale', run_key: explained.narration!.run_key });
    expect(replay.blocks).toBeUndefined();
    expect(store.append).not.toHaveBeenCalled();
    expect(rows).toEqual(saved); expect(runs).toBe(1); expect(modelCalls).toBe(2);
  });
  it.each(['empty', 'fetch_failed'] as const)('failed interpretation offers the existing Explain control without rerunning (%s)', async failure => {
    provider = failure;
    const id = randomUUID();
    const first = (await runTurn(id)).json() as Body;
    expect(first.narration?.status).toBe('unavailable');
    expect(first.assistant_text).not.toContain(PROSE);
    expect(first.suggested_actions.some(c => isRunExplanationChip(c.id))).toBe(true);
    const calls = modelCalls;
    const replay = (await runTurn(id)).json() as Body;
    expect(replay.narration).toBeUndefined();
    expect(replay.blocks).toBeUndefined();
    expect(modelCalls).toBe(calls); expect(runs).toBe(1);
  });
});
