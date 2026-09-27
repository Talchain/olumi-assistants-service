/**
 * ⭐ C6 — THE SESSION STORE'S SHARE OF AN ORDINARY AGENT TURN, NAMED AND THEN CUT (OpenAI runtime; served replay
 * 27 Sep, #70 5858519650): an ordinary turn spent ~0.95 s outside the model AND outside the dispatch ledger (#2106).
 * That time is the route's own session-store round trips — the ownership upsert, the pending read, the turn claim and
 * its read-back, the durable history, the end-of-turn held read, the answer row — none of which the trace named.
 *
 * (1) Every store call the route makes is on `_diagnostic_trace.timing.store_calls` as `{op, ms, ok}`, in CALL order,
 *     with `store_ms` their sum — the same sidecar and the same gating as `dispatches`.
 * (2) The ownership check and the FIRST pending read (rehydration) are independent reads: the pending read now STARTS
 *     beside the check instead of after it. Asserted on the fake store's own start/end marks (a logical clock), never
 *     on a wall-clock threshold.
 * (3) SAFETY: the pending result is CONSUMED only after ownership says `allow`. A refused turn discards it unused —
 *     a guest's proposal on a scenario someone else now owns never becomes approvable through a refused request — and
 *     a pending read that rejects beside a refusal is never an unhandled rejection.
 * (4) CONTROL: an ownership oracle that throws is refused exactly as before (409, nothing claimed).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `9c4b3a2d-1e0f-4a9b-8c7d-6e5f4a3b2c${String(n).padStart(2, '0')}`; };
const SOMEONE_ELSE = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] };
const rows = new Map<string, Row>();
const order: string[] = [];
/** The latest ANSWER row for a scenario — claim rows excluded, as the production read excludes them. */
const latestRow = (sid: string = SCENARIO): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
/** Postgres `jsonb` key order (shorter first, then bytewise) — see `proposal-survives-a-restart.test.ts`. */
const jsonbOrder = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(jsonbOrder)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as Record<string, unknown>)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        .map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]))
      : v;
/** A row's pending actions as the production reads return them: JSONB round-trip, the REAL parser, this scenario only. */
const parsedPending = async (row: Row | undefined, sid: string): Promise<unknown[]> => {
  const { parsePendingAction } = await import('../../session/pending-action.js');
  const raw = row ? (jsonbOrder(JSON.parse(JSON.stringify(row.pending_actions))) as unknown[]) : [];
  return raw.map((x) => parsePendingAction(x)).filter((x) => x !== null && x.scenario_id === sid);
};

/**
 * A LOGICAL CLOCK over the fake store's own calls: each start and each end takes the next tick. "The pending read
 * started before ownership resolved" is then `start(pending) < end(ensure)` — an ordering, never a duration.
 */
let tick = 0;
let marks: { op: string; edge: 'start' | 'end'; at: number }[] = [];
const mark = (op: string, edge: 'start' | 'end') => { tick += 1; marks.push({ op, edge, at: tick }); };
const markAt = (op: string, edge: 'start' | 'end', nth = 0): number | undefined => marks.filter((m) => m.op === op && m.edge === edge)[nth]?.at;
const sleep = (ms: number) => new Promise<void>((r) => { setTimeout(r, ms); });

/** What the fake store does, per test. */
let owner: string | null = null;
let ownership: 'answer' | 'throw' = 'answer';
let ensureDelayMs = 0;
let pendingDelayMs = 0;
let pendingOutcome: 'rows' | 'reject' = 'rows';
/** When set, the pending read answers this instead of the latest row (a row the test pins). */
let pendingOverride: unknown[] | undefined;
/** Resolved the moment the fake's pending read rejects — so a test can wait for it WITHOUT touching the route's promise. */
let pendingRejected: Promise<void> = Promise.resolve();
let notifyRejected: () => void = () => {};

const store = {
  ensureScenarioExists: vi.fn(async () => {
    mark('ensure', 'start');
    if (ensureDelayMs > 0) await sleep(ensureDelayMs);
    mark('ensure', 'end');
    if (ownership === 'throw') throw new Error('ownership oracle unavailable (test)');
    return { user_id: owner };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => {
    mark('pending', 'start');
    if (pendingDelayMs > 0) await sleep(pendingDelayMs);
    mark('pending', 'end');
    if (pendingOutcome === 'reject') { notifyRejected(); throw new Error('pending read failed (test)'); }
    return pendingOverride ?? parsedPending(latestRow(sid), sid);
  }),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readRecent: vi.fn(async () => []),
  releaseTurnClaim: vi.fn(async () => {}),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[] });
      order.push(k);
    }
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
// Anonymous callers throughout: a guest scenario is open to them; one owned by someone else is refused.
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Chip = { id: string; label: string; message: string };
type StoreCall = { op: string; ms: number; ok: boolean };
type Body = {
  assistant_text: string; suggested_actions: Chip[];
  _diagnostic_trace: { fast_path?: string; timing?: { store_calls?: StoreCall[]; store_ms?: number; dispatches?: unknown[] } };
  _agent: { tool_calls: { name: string; ok: boolean; refusal?: string }[]; durability?: string };
};

describe('C6: the route names every session-store call, and reads pending actions beside the ownership check', () => {
  let edges: { from: string; to: string }[] = [];
  let proposeNext = false;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

  async function buildRouteApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const a = Fastify({ logger: false });
    a.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
      graph_hash: `h${edges.length}`,
    }));
    a.post('/assist/v1/scenarios/:id/graph/register', async (_req, reply) => reply.code(503).send({ code: 'NOT_SERVED_BY_THIS_HARNESS' }));
    a.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; event?: { from: string; to: string } };
      if (b.kind === 'system_event' && b.event) edges = [...edges, { from: b.event.from, to: b.event.to }];
      return { assistant_text: 'ok', blocks: [], graph_hash: `h${edges.length}` };
    });
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }
  /** One process: build the app, run `fn`, close it. A new call is a restarted process (fresh module state). */
  const inProcess = async <T,>(fn: (a: FastifyInstance) => Promise<T>): Promise<T> => {
    const a = await buildRouteApp();
    try { return await fn(a); } finally { await a.close(); }
  };
  const post = (a: FastifyInstance, payload: Record<string, unknown>) =>
    a.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
  const turn = async (a: FastifyInstance, payload: Record<string, unknown>): Promise<Body> => {
    const r = await post(a, payload);
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return r.json() as Body;
  };
  const storeCallsOf = (b: Body): StoreCall[] => {
    const calls = b._diagnostic_trace.timing?.store_calls;
    expect(Array.isArray(calls), `store_calls is on the trace: ${JSON.stringify(b._diagnostic_trace.timing ?? null).slice(0, 400)}`).toBe(true);
    return calls!;
  };

  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body['tool_choice'] !== 'none' && proposeNext) {
        proposeNext = false;
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'propose_model_change', call_id: 'c1',
          arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', strength: 'strong', rationale: 'It moves velocity.' }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Team size is the factor to watch here.' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    process.on('unhandledRejection', onUnhandled);
  });
  // The route's module graph is transformed ONCE, here, not inside the first test's budget (see the restart suite).
  beforeAll(async () => { await import('../../../routes/agent-v1-turn.js'); }, 600_000);
  afterAll(() => {
    process.off('unhandledRejection', onUnhandled);
    vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => {
    nextScenario();
    edges = []; proposeNext = false; unhandled.length = 0;
    owner = null; ownership = 'answer'; ensureDelayMs = 0; pendingDelayMs = 0; pendingOutcome = 'rows'; pendingOverride = undefined;
    tick = 0; marks = [];
    pendingRejected = new Promise<void>((r) => { notifyRejected = r; });
    for (const f of Object.values(store)) f.mockClear();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('(1) RED: an ordinary turn lists each store call once, in call order, with numeric ms — and store_ms is their sum', async () => {
    const b = await inProcess((a) => turn(a, { message: 'Which factor matters most for velocity?' }));
    expect(b._diagnostic_trace.fast_path, 'the control: an ordinary Agent turn, no fast path').toBeUndefined();
    expect(Array.isArray(b._diagnostic_trace.timing?.dispatches), 'the control: the sibling dispatch ledger is on the same timing object').toBe(true);
    const calls = storeCallsOf(b);
    // Identity, by the call site: the two pending reads and the two committed-turn reads are different calls.
    expect(calls.map((c) => c.op)).toEqual([
      'ensureScenarioExists',
      'readMostRecentPendingActions:rehydrate',
      'readCommittedTurn:prior',
      'appendCheckedGraphWrite:claim',
      'readCommittedTurn:claim',
      'readRecent',
      // The canonical-state read the Agent is given lists the product's held add-options (C52) from the same row.
      'readMostRecentPendingActions:capability',
      'readMostRecentPendingActions:held',
      'appendCheckedGraphWrite:answer',
    ]);
    for (const c of calls) {
      expect(typeof c.ms, c.op).toBe('number');
      expect(c.ms, c.op).toBeGreaterThanOrEqual(0);
      expect(c.ok, c.op).toBe(true);
    }
    expect(b._diagnostic_trace.timing!.store_ms).toBe(calls.reduce((s, c) => s + c.ms, 0));
    // The ledger and the store agree on how many calls there were (no call site missed, none invented).
    const made = store.ensureScenarioExists.mock.calls.length + store.readMostRecentPendingActions.mock.calls.length
      + store.readCommittedTurn.mock.calls.length + store.append.mock.calls.length + store.readRecent.mock.calls.length;
    expect(calls).toHaveLength(made);
  }, 200_000);

  it('(2) RED: with the ownership check and the pending read each ~200 ms, the pending read STARTS before ownership RESOLVES', async () => {
    ensureDelayMs = 200;
    pendingDelayMs = 200;
    const b = await inProcess((a) => turn(a, { message: 'Which factor matters most for velocity?' }));
    const ensureEnd = markAt('ensure', 'end');
    const pendingStart = markAt('pending', 'start');
    expect(ensureEnd, 'the control: ownership was checked').toBeDefined();
    expect(pendingStart, 'the control: the rehydrate read ran').toBeDefined();
    expect(pendingStart!, JSON.stringify(marks)).toBeLessThan(ensureEnd!);
    // And both are still named on the trace, each once, as the ledger's first two calls.
    expect(storeCallsOf(b).slice(0, 2).map((c) => c.op)).toEqual(['ensureScenarioExists', 'readMostRecentPendingActions:rehydrate']);
  }, 200_000);

  it('(3) SAFETY: ownership DENIES → 404 as before; the pending read that ran beside it is never consumed — its proposal never becomes approvable', async () => {
    // The scenario is still a guest's: an anonymous turn proposes, and its answer row carries the proposal.
    proposeNext = true;
    const offer = await inProcess((a) => turn(a, { message: 'Team size strongly drives velocity, so connect them.' }));
    const approve = offer.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve, `the control: a real proposal was offered — ${JSON.stringify(offer._agent.tool_calls)}`).toBeDefined();
    const carried = await parsedPending(latestRow(), SCENARIO);
    expect(carried.some((p) => (p as { chip_id?: string }).chip_id === approve!.id), 'the control: the latest row carries the offer').toBe(true);

    // CONTROL: a restarted process that IS allowed, reading that row, restores the proposal and applies it.
    pendingOverride = carried;
    const allowed = await inProcess((a) => turn(a, { message: approve!.message, source: 'chip', chip: { id: approve!.id } }));
    expect(allowed._agent.tool_calls, 'the control: the carried proposal is consumable when ownership allows').toEqual([expect.objectContaining({ name: 'authorise_change', ok: true })]);
    expect(edges).toEqual([{ from: 'f1', to: 'o1' }]);

    // The refused case, on a fresh model and a fresh restarted process: the scenario now belongs to someone else.
    edges = [];
    const approveOnceRefused = await inProcess(async (a) => {
      owner = SOMEONE_ELSE;
      pendingOverride = carried;
      store.readMostRecentPendingActions.mockClear();
      store.append.mockClear();
      const r = await post(a, { message: 'What would that change for the team?' });
      expect(r.statusCode).toBe(404);
      expect(r.json()).toEqual({ error: 'NOT_FOUND', detail: 'No readable conversation for that scenario.' });
      expect(store.append, 'a refused turn claims and records nothing').not.toHaveBeenCalled();
      expect(store.readMostRecentPendingActions, 'the control: the pending read DID run beside the refused check, so its result existed to be misused')
        .toHaveBeenCalledTimes(1);
      // The scenario is open again and the latest row now carries NOTHING: only a proposal the REFUSED turn restored
      // into this process could still be approved.
      owner = null;
      pendingOverride = [];
      return turn(a, { message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    });
    expect(approveOnceRefused._agent.tool_calls, 'the refused turn restored nothing').toEqual([expect.objectContaining({ name: 'authorise_change', ok: false, refusal: 'unknown_proposal' })]);
    expect(approveOnceRefused.suggested_actions.some((c) => c.id === approve!.id), 'no approve chip for it either').toBe(false);
    expect(edges, 'nothing written').toEqual([]);
  }, 400_000);

  it('(3) SAFETY: a pending read that REJECTS beside a refused check is discarded — 404, and no unhandled rejection', async () => {
    owner = SOMEONE_ELSE;
    pendingOutcome = 'reject';
    // The rejection lands AFTER the refusal is sent: nothing in the route is waiting for it any more.
    pendingDelayMs = 150;
    const r = await inProcess(async (a) => {
      const res = await post(a, { message: 'What would that change for the team?' });
      if (store.readMostRecentPendingActions.mock.calls.length > 0) await pendingRejected;
      // Two macrotask turns: Node reports an unhandled rejection once the microtask queue drains after it.
      await new Promise((x) => { setImmediate(x); });
      await new Promise((x) => { setImmediate(x); });
      return res;
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ error: 'NOT_FOUND', detail: 'No readable conversation for that scenario.' });
    expect(unhandled.map(String), 'a discarded pending read never surfaces as an unhandled rejection').toEqual([]);
  }, 200_000);

  it('(4) CONTROL: the ownership oracle throws → the same 409 refusal as before, nothing claimed, nothing unhandled', async () => {
    ownership = 'throw';
    pendingOutcome = 'reject';
    pendingDelayMs = 50;
    const r = await inProcess(async (a) => {
      const res = await post(a, { message: 'Which factor matters most for velocity?' });
      if (store.readMostRecentPendingActions.mock.calls.length > 0) await pendingRejected;
      await new Promise((x) => { setImmediate(x); });
      await new Promise((x) => { setImmediate(x); });
      return res;
    });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: 'SCENARIO_OWNERSHIP_UNVERIFIABLE', detail: 'Could not verify the scenario. Nothing was changed.' });
    expect(store.append).not.toHaveBeenCalled();
    expect(store.readCommittedTurn).not.toHaveBeenCalled();
    expect(unhandled.map(String)).toEqual([]);
  }, 200_000);

  it('CONTROL: an ALLOWED turn whose pending read fails still answers, as before — and the ledger records that call ok:false', async () => {
    pendingOutcome = 'reject';
    const b = await inProcess((a) => turn(a, { message: 'Which factor matters most for velocity?' }));
    const calls = storeCallsOf(b);
    expect(calls.filter((c) => c.op.startsWith('readMostRecentPendingActions')).map((c) => [c.op, c.ok])).toEqual([
      ['readMostRecentPendingActions:rehydrate', false],
      ['readMostRecentPendingActions:capability', false],
      ['readMostRecentPendingActions:held', false],
    ]);
    expect(b._agent.durability, 'the answer row is still recorded').toBe('recorded');
    expect(b._diagnostic_trace.timing!.store_ms).toBe(calls.reduce((s, c) => s + c.ms, 0));
  }, 200_000);
});
