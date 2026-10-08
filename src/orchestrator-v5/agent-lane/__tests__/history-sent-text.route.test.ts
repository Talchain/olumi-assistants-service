import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Item = Record<string, unknown>;
type Row = {
  id: string; turn_id: string; request_hash: string;
  user_message: string | null; assistant_message: string | null; llm_calls_used: number;
};
const rows = new Map<string, Row>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  readRecent: vi.fn(async () => [...rows.values()].reverse()),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  append: vi.fn(async (w: {
    turn_id: string; request_hash: string; userMessage?: string; assistantMessage?: string; llm_calls_used: number;
  }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash
      ? { id: prior.id, replayedPriorTurn: true as const }
      : { id: prior.id, priorTurnConflict: true as const };
    const row: Row = {
      id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash,
      user_message: w.userMessage ?? null, assistant_message: w.assistantMessage ?? null,
      llm_calls_used: w.llm_calls_used,
    };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const SCENARIO = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const USER_WORDS = 'Which assumptions should we examine?';
const FOLLOW_UP = 'What should we examine next?';
const STRIPPED = 'AI Reporting Sprint currently performs best, leading in 46% of simulations.';
const SAFE = '\n\nCheck the assumptions with your team.';
const GRAPH = { nodes: [
  { id: 'goal', kind: 'goal', label: 'Quarterly revenue' },
  { id: 'ai_reporting_sprint', kind: 'option', label: 'AI Reporting Sprint' },
  { id: 'signup_fix_sprint', kind: 'option', label: 'Signup Fix Sprint' },
], edges: [] };
const messageItem = (text: string, id: string): Item => ({
  type: 'message', role: 'assistant', id, status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }],
});

describe('sent-text replacement boundaries', () => {
  it('keeps earlier replies and intermediate tool-hop prose while replacing only the terminal draft', async () => {
    const { historyWithSentText } = await import('../history-store.js');
    const prefix = [
      { role: 'user', content: 'Earlier question' }, messageItem('Earlier sent reply', 'msg_earlier'),
      { role: 'user', content: USER_WORDS }, messageItem('Let me check that.', 'msg_intermediate'),
      { type: 'reasoning', id: 'rs_pair', summary: [] },
      { type: 'function_call', call_id: 'c_pair', name: 'withdraw_proposal', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c_pair', output: '{"ok":false}' },
    ];
    const reasoning = { type: 'reasoning', id: 'rs_terminal', summary: [] };
    const result = historyWithSentText([...prefix, reasoning, messageItem('Unsent draft', 'msg_unsent')], 'Final sent reply') as Item[];
    expect(result.slice(0, prefix.length)).toEqual(prefix);
    expect(result.slice(prefix.length, -1)).toEqual([reasoning]);
    expect(assistants(result).map(textOf)).toEqual(['Earlier sent reply', 'Let me check that.', 'Final sent reply']);
    expect(historyWithSentText(result, 'Final sent reply')).toEqual(result);
  });

  it('records a host fallback when an incomplete turn produced no terminal assistant message', async () => {
    const { historyWithSentText } = await import('../history-store.js');
    const before = [
      { role: 'user', content: 'Earlier question' }, messageItem('Earlier sent reply', 'msg_earlier'),
      { role: 'user', content: USER_WORDS }, { type: 'reasoning', id: 'rs_incomplete', summary: [] },
    ];
    const result = historyWithSentText(before, 'The answer was incomplete.') as Item[];
    expect(result.slice(0, -1)).toEqual(before);
    expect(assistants(result).map(textOf)).toEqual(['Earlier sent reply', 'The answer was incomplete.']);
  });
});
const textOf = (item: Item): string => typeof item.content === 'string' ? item.content
  : Array.isArray(item.content) ? item.content.map((p: { text?: string }) => p.text ?? '').join('') : '';
const assistants = (input: Item[]): Item[] => input.filter((i) => i.role === 'assistant');
type Reply = { assistant_text: string; _agent: { session_id: string; replayed?: boolean } };

let permitted = false;
let scripted: Item[][] = [];
let modelInputs: Item[][] = [];
async function freshApp(): Promise<FastifyInstance> {
  vi.resetModules(); // New route module and HistoryStore, as after a deploy; durable rows survive.
  vi.stubEnv('AGENT_LANE_ENABLED', 'true');
  vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false });
  app.post('/assist/v1/scenarios/:id/graph', async () => ({
    graph: GRAPH, graph_hash: 'h1',
    analysis_state: { leader_claim: permitted ? { permitted: true }
      : { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
  }));
  await app.register(agentV1TurnRoute);
  await app.ready();
  return app;
}

describe('ordinary Agent history remembers the final sent text', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    rows.clear(); permitted = false; scripted = []; modelInputs = [];
    vi.clearAllMocks();
    // ALL fetches are intercepted. No provider or Supabase connection is possible through this stub.
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      expect(String(url)).toMatch(/\/v1\/responses$/);
      const body = JSON.parse(String(init?.body ?? '{}')) as { input: Item[] };
      modelInputs.push(body.input);
      const output = scripted.shift();
      expect(output, 'every model response is scripted locally').toBeDefined();
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    app = await freshApp();
  });
  afterEach(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const say = async (message: string, turnId?: string, sessionId?: string): Promise<Reply> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message,
      ...(turnId === undefined ? {} : { turn_id: turnId }),
      ...(sessionId === undefined ? {} : { agent_session_id: sessionId }),
    } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Reply;
  };
  const nextInput = async (sessionId?: string): Promise<Item[]> => {
    scripted.push([messageItem('Look at the assumptions together.', 'msg_follow_up')]);
    const n = modelInputs.length;
    await say(FOLLOW_UP, undefined, sessionId);
    expect(modelInputs).toHaveLength(n + 1);
    return modelInputs[n]!;
  };
  const editedFirst = async (turnId = randomUUID()): Promise<Reply> => {
    // Multiple trailing messages exercise consolidation, with final reasoning retained too.
    scripted.push([
      { type: 'reasoning', id: 'rs_answer', summary: [] },
      messageItem(STRIPPED, 'msg_draft_leader'), messageItem(SAFE, 'msg_draft_safe'),
    ]);
    const first = await say(USER_WORDS, turnId);
    expect(modelInputs).toHaveLength(1);
    expect(first.assistant_text).not.toContain(STRIPPED);
    expect(first.assistant_text).not.toBe(STRIPPED + SAFE); // The real final gates edited the draft.
    expect(rows.get(turnId)?.assistant_message).toBe(first.assistant_text);
    return first;
  };

  it('H1: the next HTTP turn carries ONE prior assistant message byte-equal to the edited wire text', async () => {
    const first = await editedFirst();
    const input = await nextInput(first._agent.session_id);
    expect(assistants(input).map(textOf)).toEqual([first.assistant_text]);
    expect(JSON.stringify(input)).not.toContain(STRIPPED);
    expect(input.find((i) => i.id === 'rs_answer')).toEqual({ type: 'reasoning', id: 'rs_answer', summary: [] });
    expect(input.filter((i) => i.role === 'user').map(textOf)).toEqual([USER_WORDS, FOLLOW_UP]);
  });

  it('H2 CONTROL: a licensed unedited single reply retains today\'s message bytes and reasoning', async () => {
    permitted = true;
    const reasoning = { type: 'reasoning', id: 'rs_licensed', summary: [] };
    const draft = messageItem(STRIPPED + SAFE, 'msg_licensed');
    scripted.push([reasoning, draft]);
    const first = await say(USER_WORDS, randomUUID());
    expect(first.assistant_text).toBe(STRIPPED + SAFE);
    const input = await nextInput(first._agent.session_id);
    expect(JSON.stringify(assistants(input))).toBe(JSON.stringify([draft]));
    expect(input.find((i) => i.id === 'rs_licensed')).toEqual(reasoning);
  });

  it('H3: function call, typed output and reasoning survive in order, with no orphaned call', async () => {
    const reasoning = { type: 'reasoning', id: 'rs_tool', summary: [] };
    const call = { type: 'function_call', id: 'fc_withdraw', call_id: 'c_withdraw',
      name: 'withdraw_proposal', arguments: JSON.stringify({ proposal_id: 'not_proposed_this_turn' }) };
    // A real tool refusal, handled locally without a write; its context must still be paired and remembered.
    scripted.push([reasoning, call], [messageItem(STRIPPED + SAFE, 'msg_after_tool')]);
    const first = await say(USER_WORDS, randomUUID());
    expect(modelInputs).toHaveLength(2);
    const pair = modelInputs[1]!.filter((i) => i.id === 'rs_tool' || i.call_id === 'c_withdraw');
    expect(pair.slice(0, 2)).toEqual([reasoning, call]);
    expect(pair[2]?.type).toBe('function_call_output');
    expect(JSON.parse(String(pair[2]?.output))).toMatchObject({ ok: false, refusal: 'not_proposed_this_turn' });
    const input = await nextInput(first._agent.session_id);
    expect(input.filter((i) => i.id === 'rs_tool' || i.call_id === 'c_withdraw')).toEqual(pair);
    const calls = input.filter((i) => i.type === 'function_call');
    const outputs = input.filter((i) => i.type === 'function_call_output');
    expect(calls).toHaveLength(1);
    expect(outputs.map((i) => i.call_id)).toEqual(calls.map((i) => i.call_id));
    expect(assistants(input).map(textOf)).toEqual([first.assistant_text]);
  });

  it('H4: hot history and a cold durable answer-row reseed carry the same assistant text', async () => {
    const first = await editedFirst();
    const hot = assistants(await nextInput(first._agent.session_id)).map(textOf);
    const readsBefore = store.readRecent.mock.calls.length;
    await app.close();
    app = await freshApp();
    const cold = assistants(await nextInput()).map(textOf);
    expect(store.readRecent.mock.calls.length).toBe(readsBefore + 1);
    expect(cold).toEqual([first.assistant_text]);
    expect(hot).toEqual(cold);
  });

  it('H5: idempotent redelivery appends no duplicate assistant message', async () => {
    const turnId = randomUUID();
    const first = await editedFirst(turnId);
    const appendsBefore = store.append.mock.calls.length;
    const readsBefore = store.readRecent.mock.calls.length;
    const replay = await say(USER_WORDS, turnId, first._agent.session_id);
    expect(replay._agent.replayed).toBe(true);
    expect(replay.assistant_text).toBe(first.assistant_text);
    expect(modelInputs).toHaveLength(1);
    expect(store.append.mock.calls.length).toBe(appendsBefore);
    expect(store.readRecent.mock.calls.length, 'only the base replay sizing-history read; egress reuses it').toBe(readsBefore + 1);
    const input = await nextInput(first._agent.session_id);
    expect(assistants(input).map(textOf)).toEqual([first.assistant_text]);
    expect(input.filter((i) => i.role === 'user').map(textOf)).toEqual([USER_WORDS, FOLLOW_UP]);
    expect(rows).toHaveLength(2); // One claim and one answer row.
  });
});
