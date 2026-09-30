/**
 * ⛔ THE AGENT'S INTERNAL SUB-TURNS ARE NOT THE CONVERSATION (Canvas #75 5910906799; MG root cause 5910983526).
 *
 * MEASURED on served CEE (MRR scenario `3b6369b0`, 30 Sep 01:43–01:44Z): the Agent's `run_analysis` tool dispatches its
 * own `/orchestrate/v2/turn` with `message: args.reason`, and that sub-turn was committed as a conversation row. Its
 * `user_message` was the MODEL's paraphrase ("The user asked to run the analysis after confirming how MRR is
 * calculated.") and its `assistant_message` the HANDLER's text ("… scored highest in 100% of runs"), neither of which
 * the user saw: the user typed "Run the analysis" and read the Agent's own answer, written as a separate row. Two
 * readers took the sub-turn row as conversation — the signed-in restore (#2352) showed words in the user's voice that
 * they never typed, and `historyFromDurableTurns` seeded the Agent's own memory with them after every redeploy.
 *
 * The rule: a turn row written INSIDE one of the Agent's in-process dispatches keeps everything except the two text
 * columns, which are NULL. Rows the user did see keep their words: the Agent's own answer row, a board edit forwarded
 * from the canvas (its narration came straight back to the user), and a turn posted to `/orchestrate/v2/turn` directly.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

type Row = { id: string; request_hash: string; user_message: string | null; assistant_message: string | null; handler_id: string | null; llm_calls_used: number; pending_actions: unknown[] };
/** Every row the floor handed to the store, keyed by (scenario, turn). */
const rows = new Map<string, Row>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; handler_id?: string | null; userMessage?: string; assistantMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, user_message: w.userMessage ?? null, assistant_message: w.assistantMessage ?? null,
        handler_id: w.handler_id ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) });
    }
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const REASON = 'The user asked to run the analysis after confirming how MRR is calculated.';
const HANDLER_TEXT = 'Raise price to £59 scored highest in 100% of runs.';
const AGENT_REPLY = 'On the current model, raising Pro price to £59 does best.';
const NARRATION = 'Updated Pro price from £49 to £59.';
let agentCalls = 0;

const rowsOf = (sid: string) => [...rows.entries()].filter(([k]) => k.startsWith(`${sid}:`)).map(([k, r]) => ({ turn: k.slice(sid.length + 1), ...r }));

describe('a row written inside an Agent sub-turn is not the user’s conversation', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body['tool_choice'] === 'none') {
        return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: AGENT_REPLY }] }] }), { status: 200 });
      }
      agentCalls += 1;
      if (agentCalls === 1) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'run_analysis', call_id: 'c1', arguments: JSON.stringify({ reason: REASON }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: AGENT_REPLY }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { appendCheckedGraphWrite } = await import('../../persist-graph-write.js');
    app = Fastify({ logger: false });
    // The orchestrator's own commit, reduced to what matters here: it writes its turn row through the SAME floor the
    // turn executor uses, with the request's message as `user_message` and its own text as `assistant_message`.
    app.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { scenario_id: string; turn_id: string; kind: string; message?: string };
      const isEvent = b.kind === 'system_event';
      await appendCheckedGraphWrite({
        store: store as never, writesGraph: false, source: 'test_orchestrator',
        write: {
          scenario_id: b.scenario_id, turn_id: b.turn_id, turn_class: 'handler', handler_id: isEvent ? 'factor_value_edit' : 'run_analysis',
          request_hash: `h:${b.turn_id}`, response_emitted: true, llm_calls_used: 0, duration_ms: 1, handler_facts: [],
          ...(isEvent ? {} : { userMessage: b.message }),
          assistantMessage: isEvent ? NARRATION : HANDLER_TEXT,
        } as never,
      });
      return { response_version: 2, assistant_text: isEvent ? NARRATION : HANDLER_TEXT, suggested_actions: [], insights: [], graph_hash: 'h1',
        blocks: [{ type: 'analysis_result', data: { marker: 'the-run' } }], analysis_ready: { status: 'ready', options: [], blockers: [] } };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Pro price' }, { id: 'o1', kind: 'outcome', label: 'MRR' }], edges: [] }, graph_hash: 'h1',
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 180_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: the Agent’s run tool — its sub-turn row keeps no words; the Agent’s answer row keeps the user’s and the reply', async () => {
    const S = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a01';
    const T = '8b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a01';
    agentCalls = 0;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: S, turn_id: T, message: 'Yes, that is how MRR works. Go ahead.' } });
    expect(r.statusCode).toBe(200);
    const sub = rowsOf(S).filter((x) => x.handler_id === 'run_analysis');
    expect(sub.length, 'the control: the run tool really dispatched a sub-turn that wrote a row').toBe(1);
    expect(sub[0]).toMatchObject({ user_message: null, assistant_message: null });
    const answer = rowsOf(S).find((x) => x.turn === T);
    expect(answer?.user_message, 'the Agent\u2019s answer row keeps the user\u2019s own words').toBe('Yes, that is how MRR works. Go ahead.');
    expect(answer?.assistant_message, 'and the reply the user was given').toBe((r.json() as { assistant_text: string }).assistant_text);
    expect(answer?.assistant_message).not.toBe(HANDLER_TEXT);
    expect(JSON.stringify(rowsOf(S)), 'the model’s paraphrase is stored nowhere as conversation').not.toContain(REASON);
  });

  it('RED: the Run chip fast path — the same rule', async () => {
    const S = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a02';
    const T = '8b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a02';
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: S, turn_id: T, message: 'Run analysis.', source: 'chip', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } } });
    expect(r.statusCode).toBe(200);
    const sub = rowsOf(S).filter((x) => x.handler_id === 'run_analysis');
    expect(sub.length, 'the control: the fast path dispatched a sub-turn').toBe(1);
    expect(sub[0]).toMatchObject({ user_message: null, assistant_message: null });
    expect(rowsOf(S).find((x) => x.turn === T)?.user_message).toBe('Run analysis.');
  });

  it('CONTRAST: a board edit forwarded from the canvas keeps its narration (the user saw it come back)', async () => {
    const S = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a03';
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'system_event', scenario_id: S, turn_id: '8b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a03', event: { kind: 'factor_value_edit', node_id: 'f1', value: 59 } } });
    expect(r.statusCode).toBe(200);
    expect(rowsOf(S)).toEqual([expect.objectContaining({ handler_id: 'factor_value_edit', user_message: null, assistant_message: NARRATION })]);
  });

  it('CONTRAST: a turn posted to /orchestrate/v2/turn directly (not by the Agent) keeps both texts', async () => {
    const S = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a04';
    await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: { kind: 'message', scenario_id: S, turn_id: 't-direct', message: 'Run the analysis' } });
    expect(rowsOf(S)).toEqual([expect.objectContaining({ user_message: 'Run the analysis', assistant_message: HANDLER_TEXT })]);
  });
});

describe('the floor binds the mark to ONE scenario', () => {
  it('inside a sub-turn for scenario A, a row for scenario B keeps its texts; a row for A does not', async () => {
    const { runAsAgentSubturn } = await import('../../session/agent-subturn-context.js');
    const { appendCheckedGraphWrite } = await import('../../persist-graph-write.js');
    const seen: { scenario_id: string; userMessage?: string; assistantMessage?: string }[] = [];
    const s = { append: async (w: never) => { seen.push(w); return { id: 'x' }; } };
    const write = (sid: string) => ({ scenario_id: sid, turn_id: 't', turn_class: 'handler', handler_id: 'run_analysis', request_hash: 'h',
      response_emitted: true, llm_calls_used: 0, duration_ms: 1, handler_facts: [], userMessage: 'u', assistantMessage: 'a' }) as never;
    await runAsAgentSubturn('A', async () => {
      await appendCheckedGraphWrite({ store: s as never, writesGraph: false, source: 'test', write: write('A') });
      await appendCheckedGraphWrite({ store: s as never, writesGraph: false, source: 'test', write: write('B') });
    });
    await appendCheckedGraphWrite({ store: s as never, writesGraph: false, source: 'test', write: write('A') });
    expect(seen.map((w) => [w.scenario_id, w.userMessage ?? null, w.assistantMessage ?? null])).toEqual([
      ['A', null, null], ['B', 'u', 'a'], ['A', 'u', 'a'],
    ]);
  });
});
