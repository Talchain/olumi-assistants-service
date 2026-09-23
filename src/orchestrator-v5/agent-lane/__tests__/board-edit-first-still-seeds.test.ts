/**
 * ⛔ A BOARD EDIT MADE FIRST AFTER A RESTART MUST NOT STOP THE CONVERSATION BEING
 * SEEDED (preflight integration of the OpenAI candidate: #1733 × #1757).
 *
 * #1733 appends each forwarded canvas edit to the Agent's history as a
 * `role: 'user'` item whose text starts with BOARD_EDIT_PREFIX. #1757 seeds the
 * durable conversation only when the held history has NO user message — so in a
 * fresh process (after any deploy, restart or eviction) a board edit made first
 * counted as "conversation", the durable turns were never seeded, and "How much did
 * my change matter?" met an Agent that had forgotten everything before the deploy.
 * #1757's own contract test used a self-authored `role: 'developer'` note, not the
 * real writer's shape.
 *
 * Through the REAL route and the REAL writer: edit first, then ask.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const DURABLE = [
  // `readRecent` returns newest first.
  { id: 'r2', turn_id: 't2', turn_class: 'frame', created_at: '2026-09-23T10:02:00Z', user_message: 'Yes, use those.', assistant_message: 'Saved as version 2.' },
  { id: 'r1', turn_id: 't1', turn_class: 'frame', created_at: '2026-09-23T10:00:00Z', user_message: 'Should I hire a Tech lead or two developers? Our budget is fixed at £180k.', assistant_message: 'Here is a starting model.' },
];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
  readRecent: vi.fn(async () => DURABLE),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const NARRATION = 'Updated Tech lead hires from 0 hires to 1 hire. This makes the last analysis stale.';
const SCENARIO = '6a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';
type Item = { role?: string; content?: unknown };
const textOf = (c: unknown): string => (typeof c === 'string' ? c
  : Array.isArray(c) ? c.map((p) => String((p as { text?: unknown }).text ?? '')).join('') : '');

describe('a board edit made first after a restart', () => {
  let app: FastifyInstance;
  let prefix = '';
  const inputs: Item[][] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      inputs.push((JSON.parse(String(init?.body ?? '{}')).input ?? []) as Item[]);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Noted.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const mod = await import('../../../routes/agent-v1-turn.js');
    prefix = mod.BOARD_EDIT_PREFIX;
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: NARRATION, blocks: [], suggested_actions: [], insights: [], graph_hash: 'h2' }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] }, graph_hash: 'h2' }));
    await app.register(mod.agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: edit first, then ask — the model gets the durable conversation FIRST, then the board-edit note, then the question', async () => {
    const e = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: '11111111-1111-4111-8111-111111111111', stage: 'analyse', event: { kind: 'factor_value_edit', target_id: 'tech_lead_hires', value: 1, field: 'value' } } });
    expect(e.statusCode).toBe(200);
    inputs.length = 0;
    await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'How much did my change matter?' } });
    const texts = inputs[0].filter((i) => typeof i.role === 'string').map((i) => textOf(i.content));
    const durable = texts.findIndex((t) => t.includes('Our budget is fixed at £180k'));
    const note = texts.findIndex((t) => t.startsWith(prefix));
    expect(durable, 'the durable conversation was seeded').toBeGreaterThanOrEqual(0);
    expect(note, 'the board-edit note is kept').toBeGreaterThan(durable);
    expect(texts.at(-1)).toBe('How much did my change matter?');
  });
});
