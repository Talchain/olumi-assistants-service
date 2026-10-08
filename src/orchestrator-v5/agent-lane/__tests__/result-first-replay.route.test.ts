/**
 * AI HARNESS — CODEX_CLI_OVERFLOW CHANGES_REQUIRED on #2470 (5936280278). The two-request Run keeps its promise on the
 * paths a retry, a lost response and a failed explanation take: request 2 explains THE SAME Run or says it is stale;
 * a lost request 1 replays the CURRENT result with its Explain control (across a restart too); a failed explanation
 * offers the same bound control again; a deadlined interpret call is made once. Live route, the model stubbed, and a
 * store double that reads answer rows back as the real store does (snake_case columns).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: GRAPH, graph_hash: HASH, analysis_ready: READY,
    analysis_state: state(), analysis_result: SERVED.block }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

type Body = { assistant_text: string; suggested_actions: { id: string }[]; narration?: { status: string; run_key: string };
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
  const explainTurn = (turnId: string, first: Body) => {
    const chip = first.suggested_actions.find((c) => isRunExplanationChip(c.id));
    expect(chip, JSON.stringify(first.suggested_actions)).toBeDefined();
    return post({ turn_id: turnId, agent_session_id: first._agent.session_id, message: RUN_EXPLANATION_MESSAGE, chip: { id: chip!.id } });
  };
  const explainIds = (b: Body) => b.suggested_actions.filter((c) => isRunExplanationChip(c.id)).map((c) => c.id);

  for (const [version, storedText] of [
    ['legacy', 'I can’t explain that result as current. Check the current results before asking again. Nothing in your model changed.'],
    ['current', 'I can’t explain that result as current. Check the current results before asking again.'],
  ] as const) {
    it(`keeps a saved ${version} unavailable reply unavailable on the same Run, including after restart; a changed Run is stale`, async () => {
      const first = (await runTurn(randomUUID())).json() as Body;
      provider = 'empty';
      const turnId = randomUUID();
      const failed = (await explainTurn(turnId, first)).json() as Body;
      expect(failed.narration?.status).toBe('unavailable');
      // Seed the durable answer text, independently of the current constants, as an older process would have saved it.
      const row = rows.find((x) => x.turn_id === turnId && typeof x.assistantMessage === 'string')!;
      row.assistantMessage = storedText;
      const savedRows = structuredClone(rows);
      const calls = modelCalls;
      const runCount = runs;
      store.append.mockClear();
      for (const restart of [false, true]) {
        if (restart) { await app.close(); app = await freshApp(); }
        const replay = (await explainTurn(turnId, first)).json() as Body;
        expect(replay.narration, `restart=${restart}`).toEqual({ status: 'unavailable', run_key: first.narration!.run_key });
        expect(replay.assistant_text).toBe('I can’t explain that result as current. Check the current results before asking again.');
        expect(explainIds(replay)).toEqual(explainIds(first));
      }
      computedAt = RUN_B;
      const stale = (await explainTurn(turnId, first)).json() as Body;
      expect(stale.narration).toEqual({ status: 'stale', run_key: first.narration!.run_key });
      expect(stale.assistant_text).toBe('I can’t explain that result as current. Check the current results before asking again.');
      expect(explainIds(stale)).toEqual([]);
      expect(modelCalls, 'replay calls no provider').toBe(calls);
      expect(runs, 'replay makes no Run').toBe(runCount);
      expect(store.append, 'replay writes no answer or claim').not.toHaveBeenCalled();
      expect(rows, 'old stored words are not rewritten').toEqual(savedRows);
    });
  }

  it('RED (P1): explain Run A, complete Run B, retry A\'s explanation turn → stale, never A\'s words beside B; CONTROL before B → the stored words', async () => {
    const first = (await runTurn(randomUUID())).json() as Body;
    const e1 = randomUUID();
    const explained = (await explainTurn(e1, first)).json() as Body;
    expect(explained.narration).toEqual({ status: 'ready', run_key: first.narration!.run_key });
    expect(explained.assistant_text).toContain(PROSE);
    const calls = modelCalls;
    // CONTROL: the same retry while Run A is current replays the stored explanation.
    const same = (await explainTurn(e1, first)).json() as Body;
    expect(same.narration).toEqual({ status: 'ready', run_key: first.narration!.run_key });
    expect(same.assistant_text).toContain(PROSE);
    computedAt = RUN_B;
    const retried = (await explainTurn(e1, first)).json() as Body;
    expect(retried.narration).toEqual({ status: 'stale', run_key: first.narration!.run_key });
    expect(retried.assistant_text).toBe(RUN_EXPLANATION_UNAVAILABLE_TEXT);
    expect(retried.assistant_text).not.toContain(PROSE);
    expect(explainIds(retried)).toEqual([]);
    expect(modelCalls, 'a replay calls no model').toBe(calls);
  });

  it('RED (P2 lost response): a retried Run turn replays the CURRENT result, its narration and the bound Explain control — across a restart too', async () => {
    const r1 = randomUUID();
    const first = (await runTurn(r1)).json() as Body;
    expect(first.narration?.status).toBe('pending');
    for (const restart of [false, true]) {
      if (restart) { await app.close(); app = await freshApp(); }
      const replay = (await runTurn(r1)).json() as Body;
      expect(replay.narration, `restart=${restart}`).toEqual(first.narration);
      expect(replay.blocks?.some((b) => b.type === 'analysis_result'), `restart=${restart}`).toBe(true);
      expect(explainIds(replay), `restart=${restart}`).toEqual(explainIds(first));
    }
    // The replayed control works: it explains that same Run.
    const replay = (await runTurn(r1)).json() as Body;
    const explained = (await explainTurn(randomUUID(), replay)).json() as Body;
    expect(explained.narration).toEqual({ status: 'ready', run_key: first.narration!.run_key });
  });

  it('CONTROL (P2 lost response): after a newer Run B, the replay is built on the CURRENT result — B\'s key and control, never A\'s', async () => {
    const r1 = randomUUID();
    const runA = (await runTurn(r1)).json() as Body;
    computedAt = RUN_B;
    const replay = (await runTurn(r1)).json() as Body;
    const runB = (await runTurn(randomUUID())).json() as Body;
    expect(runB.narration!.run_key).not.toBe(runA.narration!.run_key);
    expect(replay.narration).toEqual({ status: 'pending', run_key: runB.narration!.run_key });
    expect(explainIds(replay)).toEqual(explainIds(runB));
  });

  it('RED (P1 @b30759b2): retry Run A after the figures changed and Run B completed → Olumi\'s fixed line, never A\'s stored figures — also after a restart', async () => {
    const r1 = randomUUID();
    const runA = (await runTurn(r1)).json() as Body;
    // What request 1 stored can carry paragraphs built from ITS readback (the break-even arithmetic, the provisional
    // view): A's figures, persisted with A's answer row.
    const row = rows.find((x) => x.turn_id === r1 && typeof x.assistantMessage === 'string')!;
    row.assistantMessage = `${String(row.assistantMessage)}\n\nIf MRR is £1,234,567 a month, the price covers it at 4,321 subscribers.`;
    computedAt = RUN_B;
    // What a live Run turn says on the CURRENT state: the replay must say the same, never A's paragraphs.
    const live = (await runTurn(randomUUID())).json() as Body;
    expect(live.assistant_text.startsWith(RUN_RESULT_READY_TEXT)).toBe(true);
    for (const restart of [false, true]) {
      if (restart) { await app.close(); app = await freshApp(); }
      const replay = (await runTurn(r1)).json() as Body;
      expect(replay.assistant_text, `restart=${restart}`).toBe(live.assistant_text);
      // 2b-0 (DL: reload = same): the replay passes the same composer, so the layout is the live one, byte for byte.
      expect((replay as { _answer_shape?: unknown })._answer_shape, `restart=${restart}`).toEqual((live as { _answer_shape?: unknown })._answer_shape);
      expect(replay.assistant_text).not.toMatch(/1,234,567|4,321/);
      expect(replay.narration?.run_key).not.toBe(runA.narration!.run_key);
    }
  });

  it('CONTROL (P1 @b30759b2): no current Run to show → Olumi\'s "can\'t verify" line, no pending narration, no control, none of A\'s figures', async () => {
    const r1 = randomUUID();
    await runTurn(r1);
    const row = rows.find((x) => x.turn_id === r1 && typeof x.assistantMessage === 'string')!;
    row.assistantMessage = `${String(row.assistantMessage)}\n\nIf MRR is £1,234,567 a month, the price covers it at 4,321 subscribers.`;
    runKind = 'complete_stale';
    const replay = (await runTurn(r1)).json() as Body;
    expect(replay.assistant_text).toBe(UNVERIFIED);
    expect(replay.narration).toBeUndefined();
    expect(explainIds(replay)).toEqual([]);
  });

  for (const mode of ['empty', 'fetch_failed'] as const) {
    it(`RED (P2 fallback): an ${mode} explanation on a current Run says so and offers the SAME bound control again — live and on replay`, async () => {
      const first = (await runTurn(randomUUID())).json() as Body;
      provider = mode;
      const e1 = randomUUID();
      const before = modelCalls;
      const failed = (await explainTurn(e1, first)).json() as Body;
      expect(failed.narration).toEqual({ status: 'unavailable', run_key: first.narration!.run_key });
      expect(explainIds(failed)).toEqual(explainIds(first));
      // P2-1: a deadlined interpret call is made ONCE, a `fetch failed` included (no fresh-deadline second attempt).
      expect(modelCalls - before, 'one interpret attempt').toBe(1);
      const replay = (await explainTurn(e1, first)).json() as Body;
      expect(replay.narration).toEqual({ status: 'unavailable', run_key: first.narration!.run_key });
      expect(explainIds(replay)).toEqual(explainIds(first));
    });
  }
});
