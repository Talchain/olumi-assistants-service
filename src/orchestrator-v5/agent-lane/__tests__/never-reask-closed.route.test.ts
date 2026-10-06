/**
 * ⭐ NEVER RE-ASK WHAT IS ALREADY ASKED, through the REAL `/agent/v1/turn` route (DL 0df0e1, 6 Oct; Acceptance G1b d4).
 *
 * Served (CEE 5f8f24ce, draft 4): every Run said "I can't yet say how likely any option is to keep monthly recurring revenue
 * at or above £126,000 / month: I need a size for the link from Price rise to MRR lost to price-driven churn. Roughly how
 * much does MRR lost to price-driven churn change, in £/month, when Price rise rises by 1%?". The user answered three times
 * in customers (a unit the £/month link cannot hold), the Agent said "I shouldn't keep asking it", and the next Run asked
 * the same question again. Now a host line's closing question already among the Agent's recent answers is not asked again;
 * the reason is still said. The Run endpoint returns the SERVED d4 Run block; the model is scripted (0 LLM).
 * CONTROLS: the first Run (nothing asked yet) still asks; another question in the history does not silence this one.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const D4 = JSON.parse(readFileSync(new URL('./fixtures/served-g1b-d4-rerun-5f8f24ce.json', import.meta.url), 'utf8')) as {
  graph_hash: string; blocks: unknown[]; analysis_state: unknown; analysis_ready: unknown; draft_graph: unknown;
  first_run_reply: string; shouldnt_keep_asking_reply: string;
};
const REASON = 'I can’t yet say how likely any option is to keep monthly recurring revenue at or above £126,000 / month: '
  + 'I need a size for the link from Price rise to MRR lost to price-driven churn.';
const QUESTION = 'Roughly how much does MRR lost to price-driven churn change, in £/month, when Price rise rises by 1%?';
const plain = (t: string): string => t.replace(/[‘’']/g, '\'');

const SCENARIO = '0173d7d2-0000-4000-8000-0000000000d4';
type Row = { id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message?: string | null };
const rows = new Map<string, Row>();
/** The Agent's earlier answer rows (newest first, as `readRecent` returns them). */
let history: Row[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row: Row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => history),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
const answerRow = (n: number, text: string): Row => ({ id: `h-${n}`, turn_id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  request_hash: `agent_turn:h${n}`, assistant_message: text });

let modelOutputs: Record<string, unknown>[][] = [];

describe('the Run\'s withheld-chance question is asked once (served d4), through the real route', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const output = modelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ok', suggested_actions: [], insights: [], graph_hash: D4.graph_hash, blocks: D4.blocks,
      analysis_ready: D4.analysis_ready, analysis_state: D4.analysis_state,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: D4.draft_graph, graph_hash: D4.graph_hash, analysis_state: D4.analysis_state, analysis_ready: D4.analysis_ready,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); history = []; modelOutputs = []; });

  /** The served rerun: the "Run analysis" chip (the Run fast path). */
  const runChip = async (): Promise<string> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
    } });
    expect(r.statusCode, r.body).toBe(200);
    return plain((r.json() as { assistant_text: string }).assistant_text);
  };
  /** An Agent turn that runs (`run_analysis` scripted), then replies without the withheld sentence. */
  const agentRun = async (): Promise<string> => {
    modelOutputs = [
      [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'rerun' }), call_id: 'c1' }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'The run is done.' }] }],
    ];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), message: 'Run it again please.' } });
    expect(r.statusCode, r.body).toBe(200);
    return plain((r.json() as { assistant_text: string }).assistant_text);
  };

  it('fixture control: the served first Run reply carries the reason AND the question', () => {
    expect(plain(D4.first_run_reply)).toContain(plain(REASON));
    expect(D4.first_run_reply).toContain(QUESTION);
    expect(D4.shouldnt_keep_asking_reply).toContain('I shouldn’t keep asking it');
  });

  it.each([['the Run chip', runChip], ['an Agent turn that runs', agentRun]] as const)(
    'CONTROL (%s): nothing asked yet → the reason and the question', async (_n, turn) => {
      const text = await turn();
      expect(text).toContain(plain(REASON));
      expect(text).toContain(QUESTION);
    });

  it.each([['the Run chip', runChip], ['an Agent turn that runs', agentRun]] as const)(
    '⭐ d4 (%s): asked before, then "I shouldn\'t keep asking it" → the reason is said, the question is NOT asked again', async (_n, turn) => {
      history = [answerRow(3, D4.shouldnt_keep_asking_reply), answerRow(2, 'You’ve already supplied the churn estimate.'), answerRow(1, D4.first_run_reply)];
      const text = await turn();
      expect(text).toContain(plain(REASON));
      expect(text).not.toContain(QUESTION);
      expect(text).not.toContain('Roughly how much');
    });

  it('CONTROL: ANOTHER question in the history does not silence this one', async () => {
    history = [answerRow(1, 'Roughly how much does Starter tier subscribers change, in subscribers, when Starter price rises by £1?')];
    const text = await runChip();
    expect(text).toContain(QUESTION);
  });

  it('CONTROL: a row the Agent route did not write (no agent_turn: hash) is not an answer the user read', async () => {
    history = [{ ...answerRow(1, D4.first_run_reply), request_hash: 'v5:sub-turn' }];
    const text = await runChip();
    expect(text).toContain(QUESTION);
  });

  it('a history read that fails keeps the question (the target ask\'s own rule)', async () => {
    store.readRecent.mockImplementationOnce(async () => { throw new Error('read failed'); });
    const text = await runChip();
    expect(text).toContain(QUESTION);
  });
});
