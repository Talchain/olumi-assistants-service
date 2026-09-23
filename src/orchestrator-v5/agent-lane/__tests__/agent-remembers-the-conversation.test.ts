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

const EARLIER = [
  // `readRecent` returns newest first.
  { turn_id: 't2', turn_class: 'frame', created_at: '2026-09-23T10:02:00Z', user_message: 'Yes, use those.', assistant_message: 'Saved as version 2. In the current model, Hire Two Developers leads.' },
  { turn_id: 't1', turn_class: 'frame', created_at: '2026-09-23T10:00:00Z', user_message: 'Should I hire a Tech lead or two developers? Our budget is fixed at £180k.', assistant_message: 'Here is a starting model with two options.' },
];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
  readRecent: vi.fn(async () => EARLIER),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const SCENARIO = '7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
type Item = { role?: string; content?: unknown; type?: string };
const textOf = (c: unknown): string => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.map((p) => String((p as { text?: unknown }).text ?? '')).join('') : JSON.stringify(c));
const texts = (input: Item[]) => input.filter((i) => typeof i.role === 'string').map((i) => `${i.role}: ${textOf(i.content)}`);

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
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }], edges: [] }, graph_hash: 'h1' }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: the first turn in a fresh process carries the durable conversation, oldest first, before the new message', async () => {
    sent.length = 0;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What did I say the budget was?' } });
    expect(r.statusCode).toBe(200);
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

  it('a durable-read failure degrades to no history — the turn still answers', async () => {
    store.readRecent.mockRejectedValueOnce(new Error('db down'));
    sent.length = 0;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: '9b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', message: 'Hello' } });
    expect(r.statusCode).toBe(200);
    expect(texts(sent[0])).toEqual(['user: Hello']);
  });
});
