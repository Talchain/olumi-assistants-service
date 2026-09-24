/**
 * ⭐ A TYPED APPROVAL SAYS WHAT THE CAPABILITY SAYS MUST BE SAID NEXT.
 *
 * Fast path 2 composes its reply from Olumi's status line only — no model reads the tool
 * result. Core's add-option (#1788) returns a server-authored `follow_up` ("… it cannot be
 * compared yet — say what it would change …"): on the Agent path the model relays it, on the
 * one-click path it was dropped, so the user read "Saved" and nothing about the option still
 * blocking the comparison. The capability's own sentence is appended — never model text.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const SCENARIO = '4d3c2b1a-0f9e-4d8c-8b7a-6f5e4d3c2b1a';
const FOLLOW_UP = '"Hire a contractor" is in the model and linked to Delivery capacity. It does not yet say what it does to that factor, so it cannot be compared yet.';
let followUp: unknown = FOLLOW_UP;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
// The capability as #1788 shapes its result: applied, plus a server-authored follow-up.
vi.mock('../runtime/agent-capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown> & { createAgentCapabilities: (...a: unknown[]) => Record<string, unknown> }>();
  return {
    ...actual,
    createAgentCapabilities: (...args: unknown[]) => {
      const caps = actual.createAgentCapabilities(...args);
      return { ...caps, authoriseChange: async () => ({ ok: true, mutated: true, applied: true, outcome: 'applied', receipts: [], ...(followUp !== undefined ? { follow_up: followUp } : {}) }) };
    },
  };
});

describe('fast path 2 relays the capability\'s follow-up', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { modelCalls += 1; return new Response('{}', { status: 500 }); }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [], edges: [] }, graph_hash: 'h0', analysis_ready: { status: 'needs_user_input', may_run: false } }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const approve = () => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: SCENARIO, message: 'Yes, add that option.', source: 'chip', chip: { id: 'agent-approve-proposal:prop_0123456789abcdef0123456789abcdef' },
  } });

  it('RED: the one-click approval tells the user what the capability says comes next — with no model call', async () => {
    followUp = FOLLOW_UP;
    const r = await approve();
    const b = r.json() as { assistant_text: string; _diagnostic_trace: { fast_path?: string } };
    expect(b._diagnostic_trace.fast_path).toBe('approve');
    expect(modelCalls).toBe(0);
    expect(b.assistant_text).toContain('cannot be compared yet');
  });

  it('CONTRAST: no follow-up (or a non-string one) adds nothing — the status line alone, as before', async () => {
    for (const f of [undefined, 42, '']) {
      followUp = f;
      const b = (await approve()).json() as { assistant_text: string };
      expect(b.assistant_text).not.toContain('cannot be compared');
      expect(b.assistant_text.length).toBeGreaterThan(0);
    }
  });
});
