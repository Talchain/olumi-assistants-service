/**
 * ⭐ SLICE A7 — WHAT OF THE BRIEF DID NOT REACH THE MODEL, ON THE AGENT TURN (DL #70 5855437928; Canonical 5855435365).
 *
 * The graph read route derives `not_modelled` (ROADMAP 2.973) from the very bytes it returns. The Agent lane read that
 * route twice per turn — once for the Agent's own state (`readGraph` → `getCanonicalState`), once for the response
 * (`readBackState`) — and dropped the manifest both times. So on Paul's served pricing model the brief's "12 months"
 * was `verdict: absent` on the read and nowhere on the turn: not in the reply's data, not in what the Agent was told.
 *
 * DERIVED AT READ, NEVER PERSISTED, NEVER RE-DERIVED: the turn carries the read's own manifest, bound to the
 * `graph_hash` of that same read; the Agent is given a compact projection of it; no store write carries either; and a
 * read that has none yields none — never a fabricated empty manifest.
 *
 * The fake read route answers with a SERVED 200 of the graph read route (build 15e332b, scrubbed to graph, graph_hash
 * and not_modelled): `fixtures/served-graph-read-not-modelled-15e332b.json`.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

type Item = { literal: string; char_offset: number; verdict: string };
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-graph-read-not-modelled-15e332b.json', import.meta.url), 'utf8')) as {
  graph: unknown;
  graph_hash: string;
  not_modelled: { quantities: { items: Item[] }; stated_kinds: { unsourced: string[] }; not_tracked: string[] };
};
const identity = (i: Item) => `${i.literal}@${i.char_offset}`;

const SCENARIO = '6b0e7d2a-3c4f-4e5a-9b8c-7d6e5f4a3b2c';
const TURN_ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

/** What the fake graph read answers: the served read as-is, or a variant of it. */
let readPayload: Record<string, unknown> = {};
/** The turn rows, so a claim can be read back exactly as the route requires. */
const rows = new Map<string, { id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used: number }) => {
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used };
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

/** Every model request this turn made, as sent. */
let modelRequests: { input?: unknown[] }[] = [];

/** The state the Agent was GIVEN this turn — the C1 developer item, parsed back from the first model request. */
function givenState(): Record<string, unknown> | undefined {
  const first = modelRequests[0];
  for (const item of first?.input ?? []) {
    const text = ((item as { content?: { text?: unknown }[] }).content ?? []).map((c) => c?.text).find((t) => typeof t === 'string' && t.startsWith('CURRENT MODEL STATE'));
    if (typeof text === 'string') return JSON.parse(text.slice(text.indexOf('{'))) as Record<string, unknown>;
  }
  return undefined;
}

/** Every object key anywhere in a value — the persistence probe walks keys, not a substring. */
function allKeys(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) for (const x of v) allKeys(x, out);
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); allKeys(x, out); }
  return out;
}

describe('A7 — the Agent turn carries the read’s not-modelled manifest, derived at read and never persisted', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      modelRequests.push(typeof init?.body === 'string' ? JSON.parse(init.body) as { input?: unknown[] } : {});
      const output = [{ type: 'message', content: [{ type: 'output_text', text: 'Here is what the model holds.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => readPayload);
    await app.register(agentV1TurnRoute);
    await app.ready();
  });
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    readPayload = { graph: SERVED.graph, graph_hash: SERVED.graph_hash, not_modelled: SERVED.not_modelled };
    modelRequests = [];
    rows.clear();
    store.append.mockClear();
  });

  const turn = (extra: Record<string, unknown> = {}) => app.inject({
    method: 'POST', url: '/agent/v1/turn',
    payload: { kind: 'message', scenario_id: SCENARIO, message: 'What does the model hold?', ...extra },
  });

  it('control: the served read carries both kinds of verdict, so the rows below can discriminate', () => {
    const items = SERVED.not_modelled.quantities.items;
    expect(items.filter((i) => i.verdict === 'in_model').map(identity)).toEqual(['£100k@27', '4%@104', '£49@151', '£59@158']);
    expect(items.filter((i) => i.verdict !== 'in_model').map(identity)).toEqual(['12 months@44']);
  });

  it('(a) RED: the turn carries `_not_modelled` — the read’s manifest byte-for-byte, bound to the graph_hash it was derived against', async () => {
    const r = await turn();
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    const carrier = body._not_modelled as { graph_hash?: unknown; manifest?: unknown } | undefined;
    expect(carrier, 'the sidecar is on the turn').toBeDefined();
    expect(Object.keys(carrier!).sort()).toEqual(['graph_hash', 'manifest']);
    expect(JSON.stringify(carrier!.manifest), 'exactly as read — nothing re-derived, re-ordered or trimmed').toBe(JSON.stringify(SERVED.not_modelled));
    expect(carrier!.graph_hash).toBe(SERVED.graph_hash);
    // The same read the response's own revision comes from.
    expect(body.graph_hash).toBe(SERVED.graph_hash);
  });

  it('(b) RED: the Agent is given a compact projection — the "12 months" the model lacks, and none of what it holds', async () => {
    const r = await turn();
    expect(r.statusCode).toBe(200);
    const state = givenState();
    expect(state, 'control: the Agent was given the state this turn').toBeDefined();
    expect(state!.graph_revision, 'control: from the same read').toBe(SERVED.graph_hash);
    const nm = state!.not_modelled as { status?: unknown; items?: Item[]; stated_kinds?: unknown; not_tracked?: unknown } | undefined;
    expect(nm, 'the projection is in the Agent’s state').toBeDefined();
    expect(Object.keys(nm!).sort(), 'compact: no scope, tallies, producers or inferred factors').toEqual(['items', 'not_tracked', 'stated_kinds', 'status']);
    expect(nm!.status).toBe('derived');
    expect((nm!.items ?? []).map(identity)).toEqual(['12 months@44']);
    // Verbatim items — reused, never re-derived.
    expect(nm!.items).toEqual(SERVED.not_modelled.quantities.items.filter((i) => i.verdict !== 'in_model'));
    expect(nm!.stated_kinds).toEqual({ unsourced: SERVED.not_modelled.stated_kinds.unsourced });
    expect(nm!.not_tracked).toEqual(SERVED.not_modelled.not_tracked);
  });

  it.each([
    ['the read carries no `not_modelled` (an older route)', () => { const { not_modelled: _n, ...rest } = readPayload; readPayload = rest; }],
    ['the read’s `not_modelled` is null', () => { readPayload = { ...readPayload, not_modelled: null }; }],
  ])('(c) CONTRAST: %s → no `_not_modelled` on the turn and none in the Agent’s state — absence stays absence', async (_name, arrange) => {
    arrange();
    const r = await turn();
    expect(r.statusCode).toBe(200);
    const body = r.json() as Record<string, unknown>;
    expect(body.graph_hash, 'control: the read was taken').toBe(SERVED.graph_hash);
    expect('_not_modelled' in body).toBe(false);
    const state = givenState();
    expect(state?.graph_revision, 'control: the Agent was given the state').toBe(SERVED.graph_hash);
    expect('not_modelled' in state!).toBe(false);
  });

  it('(d) RED: no store write carries the manifest or its projection', async () => {
    const r = await turn({ turn_id: TURN_ID });
    expect(r.statusCode).toBe(200);
    expect((r.json() as Record<string, unknown>)._not_modelled, 'control: this turn DID carry it').toBeDefined();
    const writes: Record<string, unknown>[] = store.append.mock.calls.map((c) => ({ ...c[0] }));
    // Control: the probe sees the rows — the claim, and the answer row with the final text.
    expect(writes.map((w) => w.turn_id)).toEqual([`${TURN_ID}:claim`, TURN_ID]);
    expect(writes[1]!.assistantMessage).toBe('Here is what the model holds.');
    expect(allKeys(writes).filter((k) => /not_modelled/i.test(k))).toEqual([]);
    expect(JSON.stringify(writes)).not.toContain('not_modelled.v1');
  });
});
