/**
 * ⭐ A FIRST BUILD REFUSED AS TOO LARGE OFFERS THE REBUILD ITS OWN REPLY NAMES, ONE CLICK AWAY.
 *
 * Measured on served `6dfb56f` (24 Sep, witness `g6`, a 14-bakery supply brief): the first model came back
 * with 40 links against the 30-link first-model limit, the one bounded retry did not fit either, and the
 * reply said "ask me to build it again" with `suggested_actions: []`. The same brief on a fresh scenario
 * then built a 13-node model at the first attempt — so asking again is a real remedy, and the copy names
 * it, but nothing on screen offered it (a remedy in copy must be a reachable control).
 *
 * The chip is plain text on the Agent route (no `action_type`), so a click is exactly the user typing it:
 * the Agent reads the empty model and calls `build_model_from_brief` again with the brief.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

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

const BRIEF = 'Should I hire a tech lead or two developers to increase velocity?';
const factor = (label: string, provenance = 'ai_proposed') => ({
  label, role: 'observable', baseline_known: false, baseline_value: null, unit: null, provenance, plausible_max: 100,
});
const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'inferred' });
/** A first model far over the compact limit, made of widened factors only (so it is refused, never admitted). */
function oversized() {
  const names = Array.from({ length: 35 }, (_, i) => `Secondary factor ${i}`);
  return {
    goal: { metric: 'Velocity', operator: '>=', value: 20, unit: 'points', horizon_months: 6, provenance: 'explicit' },
    constraints: [],
    options: [
      { label: 'Hire a tech lead', provenance: 'explicit', changes: ['Delivery capacity'], interventions: [] },
      { label: 'Hire two developers', provenance: 'explicit', changes: ['Delivery capacity'], interventions: [] },
    ],
    factors: [factor('Delivery capacity', 'inferred'), ...names.map((n) => factor(n))],
    risks: [],
    outcomes: [{ label: 'Velocity', provenance: 'inferred' }],
    links: [link('Delivery capacity', 'Velocity'), ...names.map((n) => link(n, 'Velocity'))],
    unknowns: [],
  };
}

type Mode = 'too_large' | 'no_build';
let mode: Mode = 'too_large';
let conversation = 0;
let construction = 0;

describe('a first build refused as too large offers "Build it again"', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { text?: { format?: { type?: string } } };
      if (body.text?.format?.type === 'json_schema') {
        construction += 1;
        return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(oversized()) }] }] }), { status: 200 });
      }
      conversation += 1;
      if (conversation === 1 && mode === 'too_large') {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'build_model_from_brief', call_id: 'b1', arguments: JSON.stringify({ brief: BRIEF }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is where things stand.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [], edges: [] }, graph_hash: 'h0' }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  const turn = (sid: string) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: sid, message: BRIEF } });

  it('RED: the refused build ends on a "Build it again" chip — plain text, never a typed action', async () => {
    mode = 'too_large'; conversation = 0; construction = 0;
    const res = await turn('7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');
    expect(res.statusCode).toBe(200);
    const b = res.json() as { assistant_text: string; suggested_actions: { id: string; label: string; message: string; action_type?: string }[]; _agent: { tool_calls: { name: string; ok: boolean; refusal?: string }[] } };
    // Vacuity guards: the real builder refused THIS turn as too large, after its one retry, and said so.
    expect(b._agent.tool_calls).toEqual([expect.objectContaining({ name: 'build_model_from_brief', ok: false, refusal: 'model_too_large' })]);
    expect(construction, 'the first draft plus its one bounded retry').toBe(2);
    expect(b.assistant_text).toContain('ask me to build it again');

    expect(b.suggested_actions).toEqual([{ id: 'agent-rebuild-model', label: 'Build it again', message: 'Build the model again from my brief.' }]);
    expect(b.suggested_actions[0]!.action_type).toBeUndefined();
  });

  it('CONTRAST: a turn that did not try to build offers no rebuild', async () => {
    mode = 'no_build'; conversation = 0; construction = 0;
    const res = await turn('7b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');
    const b = res.json() as { suggested_actions: { id: string }[]; _agent: { tool_calls: unknown[] } };
    expect(b._agent.tool_calls).toEqual([]);
    expect(b.suggested_actions.some((a) => a.id === 'agent-rebuild-model')).toBe(false);
  });

  it('the rebuild chip replays only while the scenario still has no model', async () => {
    const { stillValidOffers, REBUILD_AFTER_TOO_LARGE_CHIP } = await import('../../../routes/agent-v1-turn.js');
    const now = { outstandingProposalIds: new Set<string>(), analysisReady: undefined, analysisState: undefined };
    expect(stillValidOffers([REBUILD_AFTER_TOO_LARGE_CHIP], { ...now, modelExists: false }).map((a) => a.id)).toEqual(['agent-rebuild-model']);
    expect(stillValidOffers([REBUILD_AFTER_TOO_LARGE_CHIP], { ...now, modelExists: true }), 'a model exists now: no stale rebuild').toEqual([]);
  });
});
