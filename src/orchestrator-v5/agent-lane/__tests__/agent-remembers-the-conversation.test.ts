import type { SessionAppendOptions, SessionTurnWrite } from '../../session/store.js';
/**
 * ⛔ THE CONVERSATION OUTLIVES THE PROCESS — the Agent's memory of it must too.
 *
 * The Agent's history is in-process (`HistoryStore`). cee-staging runs ONE instance
 * (Render API, 23 Sep: numInstances 1, no autoscaling) and redeploys on every merge
 * to `staging`, so after any deploy the browser still shows the whole conversation
 * (read from `v5_conversation_turns`) while the Agent starts from nothing and can
 * no longer answer "as I said earlier…". This drives the REAL route with an empty
 * process and a store holding two earlier turns, and records what the model is sent.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { REASONING_CONTEXT_LABEL } from '../turn-context.js';

const EARLIER = [
  // `readRecent` returns newest first. Each is the Agent route's own answer row, so it carries the route's request hash
  // (`agent_turn:`), as every stored Agent answer row does (CURRENT-READ-v1 row 5; sub-turn rows are `sha256:`).
  { turn_id: 't2', turn_class: 'direct_answer', request_hash: `agent_turn:${'2'.repeat(64)}`, created_at: '2026-09-23T10:02:00Z', user_message: 'Yes, use those.', assistant_message: 'Saved as version 2. In the current model, Hire Two Developers leads.' },
  // CONTRAST (DL 5912285829): an Agent sub-turn row the user never saw (the turn executor's `sha256:` hash) is dropped.
  { turn_id: 's1', turn_class: 'handler', request_hash: `sha256:${'5'.repeat(32)}`, created_at: '2026-09-23T10:01:00Z', user_message: 'the user pressed Run', assistant_message: 'Hire Two Developers scored highest in 100% of runs.' },
  { turn_id: 't1', turn_class: 'direct_answer', request_hash: `agent_turn:${'1'.repeat(64)}`, created_at: '2026-09-23T10:00:00Z', user_message: 'Should I hire a Tech lead or two developers? Our budget is fixed at £180k.', assistant_message: 'Here is a starting model with two options.' },
];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async (write: SessionTurnWrite, options?: SessionAppendOptions) => { write = Object.assign({}, write, options?.prepare?.(write as typeof write & SessionTurnWrite, { finalPending: (write as typeof write & SessionTurnWrite).pending_actions ?? [], prospectiveGuidance: null })); return ({ id: 'row-1' }); }),
  readRecent: vi.fn(async () => EARLIER),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const negativeScenarios = [
  ['no verified source', '1b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'],
  ['the verified £180k statement belongs only to another scenario', '2b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'],
] as const;
const verifiedReceipt = { version: 2, version_id: 'saved-v2', mutation_id: 'mutation-v2', source_turn_id: 'prior-change' };
vi.mock('../runtime/agent-loop.js', async original => {
  const actual = await original<typeof import('../runtime/agent-loop.js')>();
  return { ...actual, runAgentTurn: async (...args: Parameters<typeof actual.runAgentTurn>) => {
    const result = await actual.runAgentTurn(...args);
    if (!negativeScenarios.some(([, scenario]) => scenario === args[0].ctx.scenario_id)) return result;
    // An actual tool-result fixture receipt must survive refusal of the unrelated budget attribution.
    return { ...result, tool_calls: [{ name: 'authorise_change', ok: true, mutated: false }],
      tool_results: [{ ok: true, already_applied: true, receipts: [verifiedReceipt] }] };
  } };
});

const SCENARIO = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const VERIFIED_BUDGET_SCENARIO = '9b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const budgetStatement = { id: 'budget', kind: 'factor', label: 'Budget', unit: 'GBP',
  user_statements: [{ subject_key: 'factor|budget|||level', field: 'level', recorded_at: '2026-10-17T20:00:00Z', statements: [{
    speaker: 'user', quote: 'Our budget is fixed at £180k.', source: 'Our budget is fixed at £180k.',
    subject: { quantity: 'level', node_id: 'budget' }, form: 'point', low: 180000, high: 180000, unit: 'GBP', reading: 'olumi',
  }] }] };
type Item = { role?: string; content?: unknown; type?: string };
const textOf = (c: unknown): string => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.map((p) => String((p as { text?: unknown }).text ?? '')).join('') : JSON.stringify(c));
// Conversation turns exclude the labelled reference item as well as Olumi's developer context.
const texts = (input: Item[]) => {
  const context = input.filter((i) => i.role === 'user' && textOf(i.content).split('\n')[0] === REASONING_CONTEXT_LABEL);
  expect(context, 'one labelled reference item, separate from conversation turns').toHaveLength(1);
  return input.filter((i) => typeof i.role === 'string' && i.role !== 'developer' && i !== context[0])
    .map((i) => `${i.role}: ${textOf(i.content)}`);
};

describe('after a restart, the Agent still knows the conversation the user can see', () => {
  let app: FastifyInstance;
  const sent: Item[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      sent.push((JSON.parse(String(init?.body ?? '{}')).input ?? []) as Item[]);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'You said the budget is fixed at £180k.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async request => ({ graph: { nodes: [
      { id: 'g', kind: 'goal', label: 'Velocity' },
      // DL 2j ruling: the durable-read failure has a verified source in THIS scenario.
      ...((request.params as { id: string }).id === VERIFIED_BUDGET_SCENARIO ? [budgetStatement] : []),
    ], edges: [] }, graph_hash: 'h1' }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: the first turn in a fresh process carries the durable conversation, oldest first, before the new message', async () => {
    const readsBefore = store.readRecent.mock.calls.length;
    sent.length = 0;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What did I say the budget was?' } });
    expect(r.statusCode).toBe(200);
    expect(store.readRecent.mock.calls.length, 'the seed is the only conversation-history read').toBe(readsBefore + 1);
    expect(JSON.stringify(sent[0]), 'the sub-turn row is not the conversation').not.toMatch(/the user pressed Run|100% of runs/);
    expect(texts(sent[0])).toEqual([
      'user: Should I hire a Tech lead or two developers? Our budget is fixed at £180k.',
      'assistant: Here is a starting model with two options.',
      'user: Yes, use those.',
      'assistant: Saved as version 2. In the current model, Hire Two Developers leads.',
      'user: What did I say the budget was?',
    ]);
  });

  it('CONTRAST: once the process holds the history, the durable record is not re-read or duplicated', async () => {
    const readsBefore = store.readRecent.mock.calls.length;
    sent.length = 0;
    await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'And the options?' } });
    expect(store.readRecent.mock.calls.length).toBe(readsBefore);
    const t = texts(sent[0]);
    expect(t.filter((x) => x.startsWith('user: Should I hire'))).toHaveLength(1);
    expect(t.at(-1)).toBe('user: And the options?');
  });

  it('a history holding only a board-edit note (no user message) still needs the seed; a real conversation does not', async () => {
    // Contract with #1733: a forwarded canvas edit appends a note to a session the
    // process may not have held before. That note must not stop the seeding.
    const { needsDurableSeed, BOARD_EDIT_PREFIX } = await import('../history-store.js');
    expect(needsDurableSeed([])).toBe(true);
    // The REAL writer's shape (agent-v1-turn.ts forwarded-edit append): a USER item
    // whose text starts with BOARD_EDIT_PREFIX. The earlier fixture here was a
    // self-authored 'developer' note, which is why the clash went unseen.
    expect(needsDurableSeed([{ role: 'user', content: [{ type: 'input_text', text: `${BOARD_EDIT_PREFIX} Updated Tech lead hires from 0 to 1.` }] }])).toBe(true);
    expect(needsDurableSeed([{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }])).toBe(false);
  });

  it('a durable-read failure degrades to no history — the turn still answers', async () => {
    const readsBefore = store.readRecent.mock.calls.length;
    store.readRecent.mockRejectedValue(new Error('db down'));
    sent.length = 0;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: VERIFIED_BUDGET_SCENARIO, message: 'Hello' } });
    expect(r.statusCode).toBe(200);
    expect(r.json().assistant_text).toBe('You said the budget is fixed at £180k.');
    expect(store.readRecent.mock.calls.length, 'failed seed is not retried by egress').toBe(readsBefore + 1);
    expect(texts(sent[0])).toEqual(['user: Hello']);
  });
  it.each(negativeScenarios)('unsupported attribution: %s regenerates once then becomes unavailable', async (_premise, scenario) => {
    // The positive row has read VERIFIED_BUDGET_SCENARIO; neither scenario may borrow its statement.
    store.readRecent.mockRejectedValue(new Error('db down'));
    sent.length = 0;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: scenario, message: 'Hello',
    } });
    expect(response.statusCode, response.body).toBe(200);
    expect(sent).toHaveLength(2);
    const retry = JSON.parse(textOf(sent[1]!.find(item => item.role === 'user')!.content));
    expect(retry.failures.map((failure: { id: string }) => failure.id)).toEqual(['b']);
    expect(retry.canonical_snapshot.receipts).toHaveLength(1);
    expect(response.json().assistant_text).toBe(retry.canonical_snapshot.receipts.join('\n\n'));
    expect(response.json()._agent.receipts).toEqual([verifiedReceipt]);
    expect(response.json().suggested_actions).toEqual(expect.any(Array));
  });

});
