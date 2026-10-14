/**
 * ⭐ T4i P1 THROUGH THE ROUTE (DL 14 Oct; the BYPASS1 lesson: stopping a host line is not the AI holding the fact). On a
 * typed turn over the served hiring-post3007 graph with its drafter risk STAMPED as Olumi's, the AI's own input for that
 * turn (the CURRENT MODEL STATE the model is sent) holds the left-out suggestion by its label, and the Run is admitted;
 * unstamped, it does not, and the Run is withheld. Harness: `bypass1-host-prose.route.test.ts` (real route, scripted AI,
 * no provider contacted).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type Json = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/t4i/served-hiring-post3007-turn01-20261014.json', 'utf8')) as { graph: Json };
const SCENARIO = '2d1c0b9a-8f7e-4d6c-9b5a-4f3e2d1c0b9a';
const RISK = 'code_quality_deterioration';
const LABEL = 'Code quality deterioration';
const stamped = (): Json => ({ ...FX.graph, nodes: (FX.graph.nodes as Json[]).map((n) => n.id === RISK ? { ...n, proposed_by: 'olumi' } : n) });

const rows = new Map<string, { id: string; turn_id: string; request_hash: string }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string }) => {
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

describe('T4i P1 through the route: the left-out Olumi suggestion is a fact in that turn\'s AI input', () => {
  let app: FastifyInstance;
  let graph: Json = FX.graph;
  const sent: string[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      sent.push(typeof init?.body === 'string' ? init.body : '');
      return new Response(JSON.stringify({ output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Noted.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: 'h-t4i', analysis_state: null }));
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [] }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { rows.clear(); sent.length = 0; });

  /** The readiness the model was SENT on this turn: the item that IS the CURRENT MODEL STATE (not the prompt naming it). */
  const sentReadiness = async (): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, message: 'What should I look at first?', source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    const body = sent.find((b) => b.includes('CURRENT MODEL STATE'));
    expect(body, 'the converse call carries the state').toBeDefined();
    const items = (JSON.parse(body!).input ?? []) as Json[];
    const state = items.flatMap((i) => (Array.isArray(i.content) ? i.content as Json[] : []))
      .map((c) => String(c.text ?? '')).find((t) => t.startsWith('CURRENT MODEL STATE'))!;
    const json = state.slice(state.indexOf('{'));
    return (JSON.parse(json.slice(0, json.lastIndexOf('}') + 1)) as Json).readiness as Json;
  };

  it('STAMPED: the AI is sent the suggestion it may say was left out, and a Run it may offer', async () => {
    graph = stamped();
    const readiness = await sentReadiness();
    expect(readiness).toMatchObject({ checked: true, may_run: true, olumi_suggestions_left_out_until_added: [LABEL] });
    // By identity: the one label is the stamped node's own.
    expect((graph.nodes as Json[]).filter((n) => n.label === LABEL).map((n) => n.id)).toEqual([RISK]);
  });

  it('UNSTAMPED (as served): no such fact, and the Run is withheld with the ask (T4 unchanged)', async () => {
    graph = FX.graph;
    const readiness = await sentReadiness();
    expect(readiness).toMatchObject({ checked: true, may_run: false });
    expect(readiness).not.toHaveProperty('olumi_suggestions_left_out_until_added');
    expect(JSON.stringify(readiness.needs_from_user)).toContain(LABEL);
  });
});
