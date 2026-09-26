/**
 * ⛔ THROUGH THE ROUTE: a scripted Agent reply that ranks the options on a WITHHELD turn is gated at
 * the wire; the SAME reply on a PERMITTED turn comes back byte-identical.
 *
 * The reply is a real gpt-5.6-terra reply from AI Quality's corpus (#1854's own stack, W.V1.rep2),
 * and the readback serves the corpus's own served `57f903c` pricing state — withheld
 * (`constraint_verdict_withheld`) or, for the contrast, the same state with the claim permitted.
 * The model call is a stubbed `fetch`: no provider is contacted.
 *
 * Harness copied from `agent-turn-carries-authoritative-state.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const FX = JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: unknown; analysis_state: { leader_claim: Record<string, unknown> } & Record<string, unknown>; analysis_ready: unknown };
  replies: Array<{ id: string; label: string; leak_phrases: string[]; text: string }>;
};
const REPLY = FX.replies.find((r) => r.id === 'stack-1854-714677d5/pricing-run-complete.W.V1.rep2')!;
/** The one ranking sentence in REPLY, exactly as served (trailing space included — it rides with the sentence). */
const RANKING_SENTENCE =
  'Its unconstrained comparison favours the £59-at-release path, driven by higher MRR per Pro subscriber and the assumed **100%** price–release alignment. ';
const WITHHELD_STATE = FX.state.analysis_state;
const PERMITTED_STATE = { ...WITHHELD_STATE, leader_claim: { permitted: true, separation: 'separated' } };

const SCENARIO = '5e3d2c1b-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
let readbackState: unknown = WITHHELD_STATE;
/** The durable turn rows, keyed by turn id — the store fake from `agent-turn-replay.test.ts`. */
type Row = { id: string; turn_id: string; request_hash: string; assistant_message: string | null };
const rows = new Map<string, Row>();
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
  readRecent: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

let callModelOutputs: Record<string, unknown>[][] = [];

describe('the Agent route gates a ranking reply on a withheld turn, and only then', () => {
  let app: FastifyInstance;
  let noLeaderSentence: string;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    noLeaderSentence = (await import('../withheld-leader-fail-closed.js')).agentNoLeaderSentence('constraint_verdict_withheld', FX.state.analysis_ready);
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ok', suggested_actions: [], insights: [], graph_hash: 'h-run', blocks: [],
      analysis_ready: FX.state.analysis_ready, analysis_state: readbackState,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: FX.state.draft_graph, graph_hash: 'h-corpus', analysis_state: readbackState, analysis_ready: FX.state.analysis_ready,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); });

  let turnSeq = 0;
  let turnId = '';
  const runThenReply = () => {
    callModelOutputs = [
      [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }],
      [{ type: 'message', content: [{ type: 'output_text', text: REPLY.text }] }],
    ];
    // A client turn id, so the answer row is written — the row a lost-response retry replays.
    turnSeq += 1;
    turnId = `7a1b2c3d-4e5f-4a6b-8c7d-${String(turnSeq).padStart(12, '0')}`;
    return app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Should we raise Pro to £59?', turn_id: turnId } });
  };

  it('fixture control: the reply carries its leak phrase and the ranking sentence exactly once', () => {
    expect(REPLY.label).toBe('names_leader');
    expect(REPLY.text.split(RANKING_SENTENCE).length).toBe(2);
    expect(RANKING_SENTENCE).toContain(REPLY.leak_phrases[0]!);
  });

  it('WITHHELD: the ranking sentence is dropped, every other byte is kept, one no-leader sentence is appended — and that is the text persisted for replay', async () => {
    readbackState = WITHHELD_STATE;
    const r = await runThenReply();
    expect(r.statusCode).toBe(200);
    expect(callModelOutputs, 'the control: both scripted model outputs were consumed').toEqual([]);
    expect((r.json().analysis_state as { leader_claim?: { permitted?: boolean } }).leader_claim?.permitted).toBe(false);
    const text = r.json().assistant_text as string;
    expect(text).toBe(`${REPLY.text.replace(RANKING_SENTENCE, '')}\n\n${noLeaderSentence}`);
    expect(text).not.toContain(REPLY.leak_phrases[0]!);
    expect(rows.get(turnId)?.assistant_message, 'the answer row a replay returns holds the GATED text').toBe(text);
  });

  it('PERMITTED: the SAME reply comes back byte-identical', async () => {
    readbackState = PERMITTED_STATE;
    const r = await runThenReply();
    expect(r.statusCode).toBe(200);
    expect(callModelOutputs, 'the control: both scripted model outputs were consumed').toEqual([]);
    expect((r.json().analysis_state as { leader_claim?: { permitted?: boolean } }).leader_claim?.permitted).toBe(true);
    expect(r.json().assistant_text).toBe(REPLY.text);
    expect(rows.get(turnId)?.assistant_message).toBe(REPLY.text);
  });
});
