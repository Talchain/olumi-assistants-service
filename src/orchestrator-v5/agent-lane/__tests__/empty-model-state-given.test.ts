/**
 * ⭐ C6-1b: AN EMPTY MODEL IS A KNOWN STATE — THE FIRST BRIEF IS GIVEN IT, NOT SENT TO FETCH IT.
 *
 * Measured (DL C6 design, 25 served first briefs, 27 Sep 2026): EVERY first brief spent its first conversation
 * call (median 1.9 s) asking for `get_canonical_state` on an empty model. Slice C1 (#2092) gives the Agent the turn's
 * state as input and withholds that tool — but the route mints the packet only when `graph_revision !== ''`, and
 * the product's graph read answers an EMPTY scenario with `graph_hash: null` (`assist.v1.scenario-graph.ts`: "null
 * when the graph is absent"), so `get_canonical_state` reports `graph_revision: ''` and the first brief got no
 * packet. The existing route harnesses answer an empty read with a string hash, which is why nothing caught it.
 *
 * The rule under test: a read that SUCCEEDED and found NO graph is a known state, so it is given like any other,
 * under a typed empty revision. What stays fail-safe: a failed read, and a POPULATED graph that came back without a
 * revision, give no packet — the tool stays offered, exactly as before.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
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

const BRIEF = 'Should we hire a tech lead or two developers to lift delivery reliability?';
const POPULATED = {
  nodes: [
    { id: 'dec_x', kind: 'decision', label: 'Choose an option' },
    { id: 'goal_x', kind: 'goal', label: 'Delivery reliability' },
    { id: 'opt_a', kind: 'option', label: 'Hire a tech lead' },
  ],
  edges: [{ from: 'dec_x', to: 'opt_a' }],
};

/** What the product's graph read answers for the scenario under test. */
let read: { status: number; body: Record<string, unknown> } = { status: 200, body: {} };
/** Every conversation call's request body, in order. */
let bodies: { tools?: { name: string }[]; input?: unknown[] }[] = [];

const stateItems = (input: readonly unknown[] | undefined) => (input ?? []).filter((i) => {
  const c = (i as { content?: { text?: unknown }[] }).content;
  return Array.isArray(c) && c.some((x) => typeof x?.text === 'string' && /^CURRENT MODEL STATE/.test(x.text));
});
const toolNames = (b: { tools?: { name: string }[] }) => (b.tools ?? []).map((t) => t.name);

describe('C6-1b: the first brief is given the empty model, not sent to fetch it', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { tools?: { name: string }[]; input?: unknown[] };
      bodies.push(body);
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Here is where things stand.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (_req, reply) => reply.code(read.status).send(read.body));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { bodies = []; });

  let n = 0;
  const turn = async () => {
    n += 1;
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: `8b1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a${String(n).padStart(2, '0')}`, message: BRIEF } });
    expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    expect(bodies.length, 'control: a conversation call was made').toBeGreaterThan(0);
    return bodies[0]!;
  };

  it('RED: an EMPTY scenario (the read route’s real answer: graph_hash null) → the state is GIVEN and get_canonical_state is not offered', async () => {
    read = { status: 200, body: { graph: null, graph_hash: null } };
    const first = await turn();
    expect(toolNames(first), 'control: the catalogue is present').toContain('build_model_from_brief');
    expect(toolNames(first)).not.toContain('get_canonical_state');
    const given = stateItems(first.input);
    expect(given, JSON.stringify(first.input)).toHaveLength(1);
    const text = JSON.stringify(given[0]);
    expect(text).toContain('\\"empty\\":true');
    expect(text).toContain('\\"entities\\":[]');
    // Given before the user's message, so the brief is still the last thing the model reads.
    expect(first.input!.indexOf(given[0]!)).toBe(first.input!.length - 2);
  });

  it('RED: the same for an empty graph object (nodes: [], graph_hash null)', async () => {
    read = { status: 200, body: { graph: { nodes: [], edges: [] }, graph_hash: null } };
    const first = await turn();
    expect(toolNames(first)).not.toContain('get_canonical_state');
    expect(stateItems(first.input)).toHaveLength(1);
  });

  it('CONTROL: a populated scenario with a real revision → given (the C1 path this harness must see)', async () => {
    read = { status: 200, body: { graph: POPULATED, graph_hash: 'a'.repeat(64) } };
    const first = await turn();
    expect(toolNames(first)).not.toContain('get_canonical_state');
    const given = stateItems(first.input);
    expect(given).toHaveLength(1);
    expect(JSON.stringify(given[0])).toContain('opt_a');
  });

  it('CONTRAST (fail-safe kept): a POPULATED graph that came back with NO revision → nothing given, the tool stays offered', async () => {
    read = { status: 200, body: { graph: POPULATED, graph_hash: null } };
    const first = await turn();
    expect(toolNames(first)).toContain('get_canonical_state');
    expect(stateItems(first.input)).toEqual([]);
  });

  it('CONTRAST (fail-safe kept): a FAILED read → nothing given, the tool stays offered', async () => {
    read = { status: 500, body: { error: 'boom' } };
    const first = await turn();
    expect(toolNames(first)).toContain('get_canonical_state');
    expect(stateItems(first.input)).toEqual([]);
  });
});
