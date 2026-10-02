/**
 * ⭐ P0 CONTEXT DEFECT 1 (DL 5958515601): the Agent's next-turn history carries the reply the user was SENT, never the
 * model's pre-gate draft. RED on the old write (`result.items` at the loop's end): the withheld turn's ranking sentence,
 * stripped from the wire by the leader gate, came back to the model as its own words on the next turn.
 *
 * Real agent route, scripted OpenAI `fetch` (no provider contacted), the corpus's served withheld pricing state and a real
 * corpus reply that ranks an option (harness from `provisional-view-route.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { withSentAnswer } from '../history-store.js';

const FX = JSON.parse(readFileSync(new URL('../../compose/__tests__/fixtures/leader-gate-real-replies.json', import.meta.url), 'utf8')) as {
  state: { draft_graph: unknown; analysis_state: Record<string, unknown>; analysis_ready: unknown };
  replies: Array<{ id: string; text: string }>;
};
const REPLY = FX.replies.find((r) => r.id === 'stack-1854-714677d5/pricing-run-complete.W.V1.rep2')!;
const RANKING_SENTENCE =
  'Its unconstrained comparison favours the £59-at-release path, driven by higher MRR per Pro subscriber and the assumed **100%** price–release alignment. ';
const RESULT = { type: 'analysis_result', computed_against_hash: '0123456789abcdef', summary: 'Synthetic completed comparison' };
const WITHHELD_STATE = { ...FX.state.analysis_state, run_state: { kind: 'complete_current', computed_at: '2026-10-01T12:00:00.000Z' } };

const SCENARIO = '5e3d2c1b-6f7a-4b8c-9d0e-1f2a3b4c5d70';
type Row = { id: string; turn_id: string; request_hash: string; assistant_message: string | null };
const rows = new Map<string, Row>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string }) => {
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
const modelRequests: Record<string, unknown>[] = [];

/** Every assistant output_text the model is handed as history in a request, in order. */
const assistantTextsIn = (req: Record<string, unknown>): string[] =>
  ((req['input'] as { type?: string; role?: string; content?: { type?: string; text?: string }[] }[] | undefined) ?? [])
    .filter((i) => i.role === 'assistant')
    .flatMap((i) => (i.content ?? []).filter((c) => c.type === 'output_text').map((c) => String(c.text)));

describe('defect 1: the next turn remembers the SENT reply, not the draft', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      modelRequests.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({
      response_version: 2, assistant_text: 'ok', suggested_actions: [], insights: [], graph_hash: 'h-run', blocks: [RESULT],
      analysis_ready: FX.state.analysis_ready, analysis_state: WITHHELD_STATE,
    }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: FX.state.draft_graph, graph_hash: 'h-corpus', analysis_result: RESULT, analysis_state: WITHHELD_STATE, analysis_ready: FX.state.analysis_ready,
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); modelRequests.length = 0; });

  let seq = 0;
  const post = (message: string) => {
    seq += 1;
    return app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message, turn_id: `7a1b2c3d-4e5f-4a6b-8c7d-${String(seq).padStart(12, '0')}` } });
  };

  it('H1: a gated reply — turn 2 is handed the wire text of turn 1, and the stripped ranking sentence is gone', async () => {
    callModelOutputs = [
      [{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }],
      [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: REPLY.text }] }],
    ];
    const t1 = await post('Should we raise Pro to £59?');
    expect(t1.statusCode).toBe(200);
    const sent = String((t1.json() as { assistant_text: string }).assistant_text);
    // Precondition: the gate really rewrote this reply (else the row could not tell draft from sent).
    expect(REPLY.text).toContain(RANKING_SENTENCE.trim());
    expect(sent).not.toContain(RANKING_SENTENCE.trim());

    const before = modelRequests.length;
    callModelOutputs = [[{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Noted.' }] }]];
    const t2 = await post('Thanks. What next?');
    expect(t2.statusCode).toBe(200);
    const req = modelRequests[before]!;
    const remembered = assistantTextsIn(req);
    expect(remembered).toContain(sent);
    expect(remembered.join('\n')).not.toContain(RANKING_SENTENCE.trim());
  });
});

describe('withSentAnswer (unit)', () => {
  const call = { type: 'function_call', name: 'run_analysis', call_id: 'c1', arguments: '{}' };
  const out = { type: 'function_call_output', call_id: 'c1', output: '{}' };
  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [] };
  const draft = { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'draft' }] };
  it('U1: replaces the final answer in place (id + position kept), tool items untouched', () => {
    const got = withSentAnswer([call, out, reasoning, draft], 'sent') as Record<string, unknown>[];
    expect(got.slice(0, 3)).toEqual([call, out, reasoning]);
    expect(got[3]).toEqual({ ...draft, content: [{ type: 'output_text', text: 'sent' }] });
    expect(got).toHaveLength(4);
  });
  it('U2: several draft messages after the last tool output collapse to ONE sent answer', () => {
    const second = { ...draft, id: 'msg_2' };
    const got = withSentAnswer([call, out, draft, second], 'sent') as Record<string, unknown>[];
    expect(got).toHaveLength(3);
    expect(got[2]).toMatchObject({ id: 'msg_1', content: [{ type: 'output_text', text: 'sent' }] });
  });
  it('U3: an assistant message BEFORE a tool output is history, not the answer — kept verbatim', () => {
    const got = withSentAnswer([draft, call, out], 'sent') as Record<string, unknown>[];
    expect(got[0]).toEqual(draft);
    expect(got[3]).toEqual({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'sent' }] });
  });
  it('U4: no drafted answer and nothing sent → unchanged', () => {
    expect(withSentAnswer([call, out], '  ')).toEqual([call, out]);
  });
});
