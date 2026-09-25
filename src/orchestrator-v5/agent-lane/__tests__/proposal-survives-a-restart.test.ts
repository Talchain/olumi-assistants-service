/**
 * ⛔ A PENDING APPROVAL SURVIVES A RESTART (root cause of Paul's failing test, 24 Sep 09:39–09:53Z,
 * scenario `d41e2c21`, #63 5811981438): proposals lived only in process memory
 * (`agent-v1-turn.ts` `new ProposalStore()`), and three merge-driven redeploys landed inside his session.
 * His "yes" reached a fresh process, got `unknown_proposal`, nothing was saved and the model stayed
 * unanalysable.
 *
 * The proposal now travels with the answer row that offered it (an `apply_proposed_change` pending
 * action carrying the stored proposal), rides every later answer row while it is still outstanding, and
 * a fresh process rehydrates it — only when it still hashes to its id, belongs to this scenario and
 * subject, and has not expired. The approval then applies exactly as before: `authorise` still checks
 * the base. The carrier has no `handler_id`, so a conventional "yes" can only REFUSE it, never apply it
 * (pinned below — it does NOT "fall through", as an earlier note claimed).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6e0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d1c${String(n).padStart(2, '0')}`; };
type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] };
const rows = new Map<string, Row>();
const order: string[] = [];
/** The latest ANSWER row for a scenario — claim rows excluded, exactly as the production read excludes them. */
const latestRow = (sid: string = SCENARIO): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
/**
 * ⛔ WHAT A JSONB COLUMN GIVES BACK. Postgres `jsonb` does not keep object key order: it returns every
 * object's keys shorter first, then bytewise, at every depth. A plain `JSON.parse(JSON.stringify())`
 * round trip keeps insertion order, and that is how the served deploy-survival witness FAILED while this
 * suite was green (#69 5833816430 / 5833864687: an assumption proposal's id no longer matched its
 * content, so a restarted process skipped it and the approval met `unknown_proposal`).
 */
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
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  // The committed row a REPLAY is answered from, with its pending actions parsed exactly as
  // `supabase-store.ts` readCommittedTurn parses them (real parser, foreign-scenario entries dropped).
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  // The latest committed ANSWER row's pending actions, JSON round-tripped as the JSONB column returns them
  // AND passed through the REAL parser, exactly as `supabase-store.ts` readMostRecentPendingActions does
  // (Codex #1823 5812296935: a raw-JSON mock hid that the parser drops an item the store would drop). Claim
  // rows are excluded, as the production query's `NOT turn_id LIKE '%:claim'` excludes them.
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(latestRow(sid), sid)),
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
/** Identity is OFF unless a test turns it on — then it is VERIFIED, exactly as a signed-in request resolves. */
let identity: { mode: 'off' } | { mode: 'verified'; userId: string } = { mode: 'off' };
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => identity };
});

type Chip = { id: string; label: string; message: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string }; _agent: { tool_calls: { name: string; ok: boolean; refusal?: string }[]; replayed?: boolean; durability?: string; turn_id?: string } };
type Carrier = { chip_id: string; emitted_at_iso: string; expires_at_iso: string; expires_at_turn_count: number; preconditions: { graph_hash?: string };
  action: { kind: string; proposal_ref: string; inline_patch: { agent_proposal: { proposal_id: string; user_id: string | null; public_label: string } } } };
/** The approval carrier a row persisted, if any. */
const carrierIn = (row: Row | undefined): Carrier | undefined =>
  row?.pending_actions.find((p) => (p as { action?: { kind?: string } }).action?.kind === 'apply_proposed_change') as Carrier | undefined;

describe('a pending approval survives a restart', () => {
  let edges: { from: string; to: string }[] = [];
  /** Every call that could write the model: a forwarded turn to the product's orchestrator. */
  let writes = 0;
  /** The CANONICAL writes: every `system_event` dispatched, and every graph register (none is expected here). */
  let systemEvents = 0;
  let registers = 0;
  let proposeNext = true;
  async function buildRouteApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const a = Fastify({ logger: false });
    a.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
      graph_hash: `h${edges.length}`,
    }));
    // Counted, and never served: a write this harness did not expect fails loudly instead of "landing".
    a.post('/assist/v1/scenarios/:id/graph/register', async (_req, reply) => { registers += 1; return reply.code(503).send({ code: 'NOT_SERVED_BY_THIS_HARNESS' }); });
    a.post('/orchestrate/v2/turn', async (req) => {
      writes += 1;
      const b = req.body as { kind?: string; event?: { from: string; to: string } };
      if (b.kind === 'system_event') systemEvents += 1;
      if (b.kind === 'system_event' && b.event) edges = [...edges, { from: b.event.from, to: b.event.to }];
      return { assistant_text: 'ok', blocks: [], graph_hash: `h${edges.length}` };
    });
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }
  beforeAll(() => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (body['tool_choice'] !== 'none' && proposeNext) {
        proposeNext = false;
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'propose_model_change', call_id: 'c1',
          arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', rationale: 'It moves velocity.' }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'This would connect Team size to Velocity.' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
  });
  // The route's module graph is transformed ONCE, here, not inside the first test's 60 s budget: on a loaded
  // machine that first transform alone overran it, and the timed-out test's still-running turns then wrote
  // into the next test's scenario.
  beforeAll(async () => { await import('../../../routes/agent-v1-turn.js'); }, 600_000);
  afterAll(() => { vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { edges = []; writes = 0; systemEvents = 0; registers = 0; proposeNext = true; identity = { mode: 'off' }; nextScenario(); });
  afterEach(() => { vi.useRealTimers(); });

  /** One process: build the app, run `fn`, close it. A new call is a restarted process (fresh module state). */
  const inProcess = async <T,>(fn: (a: FastifyInstance) => Promise<T>): Promise<T> => {
    const a = await buildRouteApp();
    try { return await fn(a); } finally { await a.close(); }
  };
  const turn = async (a: FastifyInstance, payload: Record<string, unknown>): Promise<Body> => {
    const r = await a.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    return r.json() as Body;
  };
  const offerIn = async (a: FastifyInstance): Promise<Chip> => {
    const t1 = await turn(a, { message: 'Should team size drive velocity?' });
    const approve = t1.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve, `the control: a real proposal was offered — ${JSON.stringify({ tools: t1._agent?.tool_calls, text: String(t1.assistant_text ?? '').slice(0, 200), chips: t1.suggested_actions })}`).toBeDefined();
    return approve!;
  };
  /** A plain question: no tool call, no chip — the turn that used to drop the carrier. */
  const askIn = async (a: FastifyInstance, message = 'What would that change for the team?'): Promise<Body> => {
    const t = await turn(a, { message });
    expect(t.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:')), 'the control: the question turn offered no approve chip').toBe(false);
    return t;
  };
  const approveIn = (a: FastifyInstance, approve: Chip): Promise<Body> =>
    turn(a, { message: approve.message, source: 'chip', chip: { id: approve.id } });
  const propose = (): Promise<Chip> => inProcess(offerIn);
  const approveOnFreshProcess = (approve: Chip): Promise<Body> => inProcess((b) => approveIn(b, approve));
  const expectSaved = (t: Body) => {
    expect(t._diagnostic_trace.fast_path, 'the control: the typed approval path').toBe('approve');
    expect(t._agent.tool_calls, JSON.stringify({ calls: t._agent.tool_calls, text: t.assistant_text.slice(0, 300) })).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true })]);
    expect(edges).toEqual([{ from: 'f1', to: 'o1' }]);
  };

  it('RED: propose, the process restarts, then approve → the SAME proposal applies (one link written, no "no longer hold")', async () => {
    const approve = await propose();
    const t2 = await approveOnFreshProcess(approve);
    expectSaved(t2);
    expect(t2.assistant_text).not.toMatch(/no longer hold/i);
  }, 60_000);

  it('the offer is persisted with the answer row that made it — with no handler_id, so the conventional resumer can only refuse it', async () => {
    const approve = await propose();
    const persisted = latestRow()!.pending_actions.find((p) => (p as { chip_id?: string }).chip_id === approve.id) as { action: { kind: string; proposal_ref: string; inline_patch: Record<string, unknown> } } | undefined;
    expect(persisted?.action.kind).toBe('apply_proposed_change');
    expect(persisted?.action.proposal_ref).toBe(approve.id);
    expect(persisted?.action.inline_patch).not.toHaveProperty('handler_id');
  }, 60_000);

  // Canonical State's deploy-survival witness (#69 5833516415): its turns carried NO turn_id, so the offer's
  // answer row was never written and a real CEE deploy lost the approval (`unknown_proposal`).
  it('(g) RED: NO client turn_id — propose, the process restarts, approve → SAVED; the offer turn was durable', async () => {
    const t1 = await inProcess((a) => turn(a, { message: 'Should team size drive velocity?', turn_id: undefined }));
    const approve = t1.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve, 'the control: a real proposal was offered').toBeDefined();
    expect(t1._agent.durability, 'the offer turn is recorded even with no client id').toBe('recorded');
    expect(carrierIn(latestRow())?.chip_id, 'the offer is persisted with its answer row').toBe(approve!.id);
    const t2 = await inProcess((b) => turn(b, { message: approve!.message, source: 'chip', chip: { id: approve!.id }, turn_id: undefined }));
    expectSaved(t2);
  }, 60_000);

  it('(g) CONTRAST: a client turn_id is used exactly as given (echoed, and the row is keyed by it)', async () => {
    const turnId = randomUUID();
    const t1 = await inProcess((a) => turn(a, { message: 'Should team size drive velocity?', turn_id: turnId }));
    expect(t1._agent.turn_id).toBe(turnId);
    expect(t1._agent.durability).toBe('recorded');
    expect(latestRow()?.turn_id).toBe(turnId);
  }, 60_000);

  it('CONTRAST: a stored proposal altered after it was offered is never rehydrated — nothing is written', async () => {
    const approve = await propose();
    const pa = latestRow()!.pending_actions.find((p) => (p as { chip_id?: string }).chip_id === approve.id) as { action: { inline_patch: { agent_proposal: { public_label: string } } } };
    pa.action.inline_patch.agent_proposal.public_label = 'something else entirely';
    const t2 = await approveOnFreshProcess(approve);
    expect(t2._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: false, refusal: 'unknown_proposal' })]);
    expect(edges).toEqual([]);
  }, 60_000);

  it('CONTRAST: the model moved after the offer → the rehydrated proposal is refused as superseded, nothing written', async () => {
    const approve = await propose();
    edges = [{ from: 'o1', to: 'f1' }];
    const t2 = await approveOnFreshProcess(approve);
    expect(t2._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: false, refusal: 'superseded' })]);
    expect(edges).toEqual([{ from: 'o1', to: 'f1' }]);
  }, 60_000);

  // ── (a) AN INTERVENING TURN ────────────────────────────────────────────────────────────────────────
  it('(a) RED: propose → a plain question → the process restarts → approve → SAVED (the question row carried the offer)', async () => {
    const approve = await inProcess(async (a) => {
      const chip = await offerIn(a);
      await askIn(a);
      return chip;
    });
    expect(carrierIn(latestRow())?.chip_id, 'the latest row — the QUESTION row — carries the offer').toBe(approve.id);
    expectSaved(await approveOnFreshProcess(approve));
  }, 60_000);

  it('(a) RED: restarts at EVERY step — propose | restart | question | restart | approve → SAVED (a restored offer is carried too)', async () => {
    const approve = await propose();
    await inProcess((a) => askIn(a));
    expect(carrierIn(latestRow())?.chip_id, 'the question row, written by a restarted process, carries the offer').toBe(approve.id);
    expectSaved(await approveOnFreshProcess(approve));
  }, 60_000);

  // ── (b) THE CARRIER'S LIFETIME ─────────────────────────────────────────────────────────────────────
  it('(b) RED: the carrier lives 30 minutes / 12 turns — at minute 20 a restarted process still applies it (real parser)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-09-24T10:00:00.000Z');
    vi.setSystemTime(t0);
    const approve = await propose();
    const pa = carrierIn(latestRow())!;
    expect(Date.parse(pa.expires_at_iso) - Date.parse(pa.emitted_at_iso)).toBe(30 * 60_000);
    expect(pa.expires_at_turn_count).toBe(12);
    vi.setSystemTime(t0 + 20 * 60_000);
    expectSaved(await approveOnFreshProcess(approve));
  }, 60_000);

  it('(b) CONTRAST: at minute 31 the carrier has lapsed — a restarted process refuses, nothing written', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-09-24T10:00:00.000Z');
    vi.setSystemTime(t0);
    const approve = await propose();
    vi.setSystemTime(t0 + 31 * 60_000);
    const t2 = await approveOnFreshProcess(approve);
    expect(t2._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: false, refusal: 'unknown_proposal' })]);
    expect(edges).toEqual([]);
  }, 60_000);

  it('(b) a carried copy gets a FRESH lifetime: a question at minute 25 keeps it approvable at minute 50', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.parse('2026-09-24T10:00:00.000Z');
    vi.setSystemTime(t0);
    const approve = await propose();
    vi.setSystemTime(t0 + 25 * 60_000);
    await inProcess((a) => askIn(a));
    expect(Date.parse(carrierIn(latestRow())!.expires_at_iso)).toBe(t0 + 55 * 60_000);
    vi.setSystemTime(t0 + 50 * 60_000);
    expectSaved(await approveOnFreshProcess(approve));
  }, 60_000);

  // ── (c) ANOTHER VERIFIED USER ──────────────────────────────────────────────────────────────────────
  // The scenario is a guest scenario (owner `null`), which the ownership gate opens to any caller — the PoC
  // posture. So the ONLY thing between user B and user A's offer is the proposal's own subject binding.
  it('(c) RED: identity ON — after a restart a DIFFERENT verified user approves → never restored for them, ZERO writes', async () => {
    identity = { mode: 'verified', userId: 'user-a' };
    const approve = await propose();
    expect(carrierIn(latestRow())?.action.inline_patch.agent_proposal.user_id, 'the control: the offer is bound to user A').toBe('user-a');
    const writesBefore = writes;
    identity = { mode: 'verified', userId: 'user-b' };
    const t2 = await approveOnFreshProcess(approve);
    expect(t2._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: false, refusal: 'unknown_proposal' })]);
    expect(writes - writesBefore, 'nothing was sent that could write').toBe(0);
    expect(edges).toEqual([]);
  }, 60_000);

  it('(c) CONTROL: identity ON — the SAME verified user approves after a restart → saved', async () => {
    identity = { mode: 'verified', userId: 'user-a' };
    const approve = await propose();
    expectSaved(await approveOnFreshProcess(approve));
  }, 60_000);

  // ── (d) NEVER CARRIED ONCE APPLIED OR SUPERSEDED ──────────────────────────────────────────────────
  it('(d) RED: once APPLIED, no later row carries it (control: the offer row did)', async () => {
    await inProcess(async (a) => {
      const chip = await offerIn(a);
      expect(carrierIn(latestRow())?.chip_id, 'the control: the offer row carries it').toBe(chip.id);
      expectSaved(await approveIn(a, chip));
      expect(carrierIn(latestRow()), 'the approval row').toBeUndefined();
      await askIn(a);
      expect(carrierIn(latestRow()), 'the next question row').toBeUndefined();
    });
  }, 60_000);

  it('(d) RED: once SUPERSEDED (the model moved), no later row carries it — not even after the model moves back', async () => {
    await inProcess(async (a) => {
      const chip = await offerIn(a);
      expect(carrierIn(latestRow())?.chip_id, 'the control: the offer row carries it').toBe(chip.id);
      edges = [{ from: 'o1', to: 'f1' }];
      await askIn(a);
      expect(carrierIn(latestRow()), 'the question row after the model moved').toBeUndefined();
      edges = [];
      await askIn(a, 'And if we undo that?');
      expect(carrierIn(latestRow()), 'never resurrected by a return to the base').toBeUndefined();
    });
  }, 60_000);

  // ── (e) A LOST RESPONSE, RETRIED ON A FRESH PROCESS (Codex #1823 5819308426, blocker 1) ────────────
  // The client never saw the answer, so it re-sends the SAME committed turn (same turn_id, same body), and
  // the retry reaches a restarted process. The replay must be the original answer — including a way to
  // approve what it proposed — and must never write again.
  const PROPOSING_MESSAGE = 'Should team size drive velocity?';
  const approveChipOf = (t: Body): Chip | undefined => t.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
  const canonical = () => ({ systemEvents, registers, writes, edges: edges.length });

  it('(e) RED: the PROPOSING response is lost → the same turn_id retried on a fresh process replays WITH the exact approve chip → approve → saved exactly once', async () => {
    const turnId = randomUUID();
    const original = await inProcess((a) => turn(a, { message: PROPOSING_MESSAGE, turn_id: turnId }));
    const offered = approveChipOf(original);
    expect(offered, 'the control: the original answer offered the approve chip').toBeDefined();
    const beforeRetry = canonical();
    const replay = await inProcess((a) => turn(a, { message: PROPOSING_MESSAGE, turn_id: turnId }));
    expect(replay._agent.replayed, 'the control: the retry took the REPLAY path, not a second run').toBe(true);
    expect(replay.assistant_text, 'the replay is the original answer').toBe(original.assistant_text);
    expect(canonical(), 'a replay writes nothing').toEqual(beforeRetry);
    // The exact chip the original answer offered — id, label and message — and its amend companion.
    expect(replay.suggested_actions.map((c) => [c.id, c.label, c.message])).toEqual([
      [offered!.id, offered!.label, offered!.message],
      ['agent-amend-proposal', 'Change something first', 'Before you apply it, I want to change some of it.'],
    ]);
    expectSaved(await approveOnFreshProcess(approveChipOf(replay)!));
    expect(systemEvents, 'saved exactly once: ONE canonical write').toBe(1);
    expect(registers).toBe(0);
  }, 60_000);

  it('(e) RED: the APPROVAL response is lost → the same approval turn retried on a fresh process is REPLAYED — zero duplicate canonical writes', async () => {
    const approve = await propose();
    const approvalTurn = randomUUID();
    const approvalBody = { message: approve.message, source: 'chip', chip: { id: approve.id }, turn_id: approvalTurn };
    expectSaved(await inProcess((a) => turn(a, approvalBody)));
    const afterFirst = canonical();
    expect(afterFirst.systemEvents, 'the control: the approval really wrote, once').toBe(1);
    const replay = await inProcess((a) => turn(a, approvalBody));
    expect(replay._agent.replayed, 'the control: the retry took the REPLAY path').toBe(true);
    expect(replay._agent.tool_calls, 'nothing was authorised again').toEqual([]);
    expect(canonical(), 'ZERO duplicate canonical writes — no system_event, no register, no dispatch at all').toEqual(afterFirst);
    expect(edges).toEqual([{ from: 'f1', to: 'o1' }]);
    expect(approveChipOf(replay), 'an applied proposal is never re-offered').toBeUndefined();
  }, 60_000);

  it('(e) CONTRAST: a lost QUESTION response replays with NO approve chip — the row carried the offer, but that answer never showed it', async () => {
    const approve = await propose();
    const turnId = randomUUID();
    await inProcess((a) => turn(a, { message: 'What would that change for the team?', turn_id: turnId }));
    expect(carrierIn(latestRow())?.chip_id, 'the control: the question row carries the offer').toBe(approve.id);
    const replay = await inProcess((a) => turn(a, { message: 'What would that change for the team?', turn_id: turnId }));
    expect(replay._agent.replayed).toBe(true);
    expect(approveChipOf(replay), 'a replay offers only what the original answer offered').toBeUndefined();
  }, 60_000);

  it('(e) CONTRAST: the model moved since → the lost proposing response replays WITHOUT the approve chip, nothing written', async () => {
    const turnId = randomUUID();
    const original = await inProcess((a) => turn(a, { message: PROPOSING_MESSAGE, turn_id: turnId }));
    expect(approveChipOf(original), 'the control: it was offered').toBeDefined();
    edges = [{ from: 'o1', to: 'f1' }];
    const before = canonical();
    const replay = await inProcess((a) => turn(a, { message: PROPOSING_MESSAGE, turn_id: turnId }));
    expect(replay._agent.replayed).toBe(true);
    expect(replay.suggested_actions.filter((c) => c.id.startsWith('agent-approve-proposal:') || c.id === 'agent-amend-proposal')).toEqual([]);
    expect(canonical()).toEqual(before);
  }, 60_000);

  // ── (f) PROPOSAL → RUN → RESTART → APPROVAL (Codex #1823 5819308426, blocker 2) ─────────────────────
  const RUN_CHIP = { id: 'agent-run-analysis', action_type: 'run_analysis' };
  const runIn = async (a: FastifyInstance): Promise<Body> => {
    const t = await turn(a, { message: 'Run analysis.', source: 'chip', chip: RUN_CHIP });
    expect(t._diagnostic_trace.fast_path, 'the control: the typed Run path').toBe('run');
    expect(t._agent.tool_calls).toEqual([expect.objectContaining({ name: 'run_analysis', ok: true })]);
    return t;
  };

  it('(f) RED: propose | restart | Run on a FRESH worker | restart | approve → SAVED once; the Run row carried the offer and the Run answer kept the chip', async () => {
    const approve = await propose();
    // The Run lands on a worker that never saw the offer: nothing process-local knows about it.
    const run = await inProcess(runIn);
    expect(carrierIn(latestRow())?.chip_id, 'the RUN row — now the latest — still carries the offer').toBe(approve.id);
    expect(carrierIn(latestRow())?.action.inline_patch.agent_proposal.proposal_id).toBe(approve.id.slice('agent-approve-proposal:'.length));
    expect(approveChipOf(run), 'the Run answer keeps the exact approve chip').toEqual(approve);
    expect(systemEvents, 'the Run wrote nothing canonical').toBe(0);
    expectSaved(await approveOnFreshProcess(approve));
    expect(systemEvents, 'saved exactly once').toBe(1);
  }, 60_000);

  it('(f) the ordinary order stays explicit: propose | restart | approve → SAVED | restart | explicit Run → runs, carries no stale offer, writes nothing more', async () => {
    const approve = await propose();
    expectSaved(await approveOnFreshProcess(approve));
    const afterApproval = canonical();
    const run = await inProcess(runIn);
    expect(approveChipOf(run), 'an applied proposal is never re-offered by the Run').toBeUndefined();
    expect(carrierIn(latestRow()), 'nor carried by the Run row').toBeUndefined();
    expect(canonical().systemEvents, 'the Run adds no canonical write').toBe(afterApproval.systemEvents);
    expect(edges).toEqual([{ from: 'f1', to: 'o1' }]);
  }, 60_000);
});

describe('the persisted carrier satisfies the production parser', () => {
  it('parsePendingAction accepts what proposalPendingAction emits, with the proposal base as graph_hash', async () => {
    const { parsePendingAction } = await import('../../session/pending-action.js');
    const { proposalPendingAction } = await import('../durable-proposal.js');
    const { createProposal } = await import('../proposal.js');
    const p = createProposal({ scenario_id: 'scn', user_id: null, base_graph_identity_hash: 'hash-base', operations: [{ op: 'add_edge', path: 'a::b' }],
      provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Connect a to b' });
    const pa = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: 'Make this change', message: 'Yes, make that change.' }, { scenario_id: 'scn', emitted_at_iso: new Date().toISOString() });
    const parsed = parsePendingAction(JSON.parse(JSON.stringify(pa)));
    expect(parsed, 'the production read would otherwise drop the carrier').not.toBeNull();
    expect(parsed?.preconditions).toEqual({ graph_hash: 'hash-base' });
  });
});

describe('(b) the shared pending-action machinery respects the stamped 12-turn / 30-minute lifetime', () => {
  const T0 = Date.parse('2026-09-24T10:00:00.000Z');
  const carrier = async () => {
    const { parsePendingAction } = await import('../../session/pending-action.js');
    const { proposalPendingAction } = await import('../durable-proposal.js');
    const { createProposal } = await import('../proposal.js');
    const p = createProposal({ scenario_id: 'scn', user_id: 'u1', base_graph_identity_hash: 'hash-base', operations: [{ op: 'add_edge', path: 'a::b' }],
      provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Connect a to b' });
    const emitted = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: 'Make this change', message: 'Yes, make that change.' }, { scenario_id: 'scn', emitted_at_iso: new Date(T0).toISOString() });
    return { p, pa: parsePendingAction(JSON.parse(JSON.stringify(emitted)))! };
  };
  it('the real parser keeps it, it is live at minute 20 and lapsed at minute 31, and it restores at minute 20', async () => {
    const { isPendingActionExpired } = await import('../../session/pending-action.js');
    const { rehydrateProposals } = await import('../durable-proposal.js');
    const { ProposalStore } = await import('../proposal.js');
    const { pa } = await carrier();
    expect(pa.expires_at_turn_count).toBe(12);
    expect(Date.parse(pa.expires_at_iso)).toBe(T0 + 30 * 60_000);
    expect(isPendingActionExpired(pa, T0 + 20 * 60_000)).toBe(false);
    expect(isPendingActionExpired(pa, T0 + 31 * 60_000)).toBe(true);
    expect(rehydrateProposals([pa], new ProposalStore(), { scenario_id: 'scn', user_id: 'u1' }, T0 + 20 * 60_000)).toBe(1);
  });
  it('the recorded-ask widen and clamp leave it untouched; a conventional carry-forward decrements its count and keeps its wall expiry', async () => {
    const { withRecordedAskLifetime, clampRecordedAskWindow } = await import('../../session/pending-action.js');
    const { computeSurvivingPriorPendingsDetailed } = await import('../../commit.js');
    const { pa } = await carrier();
    expect(withRecordedAskLifetime(pa, T0)).toBe(pa);
    expect(clampRecordedAskWindow(pa)).toBe(pa);
    const carried = computeSurvivingPriorPendingsDetailed([pa], [], [], 'hash-base', T0 + 20 * 60_000);
    expect(carried.survivors).toHaveLength(1);
    expect(carried.survivors[0]!.expires_at_turn_count).toBe(11);
    expect(carried.survivors[0]!.expires_at_iso).toBe(pa.expires_at_iso);
  });
  it('a conventional "yes" can only refuse it: no handler_id → invalid on the same revision, superseded on another', async () => {
    const { decideProposedChangeSynthesis } = await import('../../routing/proposed-change-synthesis.js');
    const { pa } = await carrier();
    expect(decideProposedChangeSynthesis({ pending: pa, currentGraphHash: 'hash-base', priorFactsWithTurn: [] })).toEqual({ status: 'invalid', reason: 'unknown_handler_id' });
    expect(decideProposedChangeSynthesis({ pending: pa, currentGraphHash: 'hash-other', priorFactsWithTurn: [] })).toEqual({ status: 'superseded' });
  });
});

describe('rehydrateProposals restores only this subject\'s own, unexpired, unaltered proposal', () => {
  const build = async (over: { scenario?: string; user?: string | null; expiresInMs?: number } = {}) => {
    const { proposalPendingAction } = await import('../durable-proposal.js');
    const { createProposal } = await import('../proposal.js');
    const p = createProposal({ scenario_id: over.scenario ?? 'scn', user_id: over.user === undefined ? 'u1' : over.user, base_graph_identity_hash: 'hash-base',
      operations: [{ op: 'add_edge', path: 'a::b' }], provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Connect a to b' });
    const pa = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: 'Make this change', message: 'Yes, make that change.' }, { scenario_id: 'scn', emitted_at_iso: new Date().toISOString() });
    return { p, pa: JSON.parse(JSON.stringify(over.expiresInMs === undefined ? pa : { ...pa, expires_at_iso: new Date(Date.now() + over.expiresInMs).toISOString() })) as unknown };
  };
  const restore = async (pending: unknown[], subject = { scenario_id: 'scn', user_id: 'u1' as string | null }) => {
    const { rehydrateProposals } = await import('../durable-proposal.js');
    const { ProposalStore } = await import('../proposal.js');
    const store = new ProposalStore();
    return { n: rehydrateProposals(pending, store, subject), store };
  };
  it('the control: its own proposal is restored, exactly once', async () => {
    const { p, pa } = await build();
    const { n, store } = await restore([pa, pa]);
    expect(n).toBe(1);
    expect(store.get(p.proposal_id)?.proposal_id).toBe(p.proposal_id);
  });
  it('another user\'s proposal on the same scenario is never restored', async () => {
    const { pa } = await build({ user: 'someone-else' });
    expect((await restore([pa])).n).toBe(0);
  });
  it('a proposal made for another scenario is never restored', async () => {
    const { pa } = await build({ scenario: 'other-scn' });
    expect((await restore([pa])).n).toBe(0);
  });
  it('an expired carrier is never restored', async () => {
    const { pa } = await build({ expiresInMs: -1 });
    expect((await restore([pa])).n).toBe(0);
  });
});

/**
 * ⛔ THE PROPOSALS USERS ACTUALLY APPROVE CARRY OBJECT VALUES — and those must survive the JSONB column.
 *
 * Served (#69 5833816430, CEE `8a2f291` → `cee4772`): `propose_assumptions` offered a proposal, the proposing
 * row was durable, CEE redeployed, the approval met `unknown_proposal`. `set_factor_value` values are
 * `{value, unit, basis, authored_by}` and `set_option_intervention` values are `{normalised, raw, cap, basis,
 * derived_frame, authored_by}` (`agent-capabilities.ts`); JSONB hands both back re-keyed, and an id hashed over
 * insertion order no longer matched. The route tests above propose one `add_edge` whose value has ONE key, so
 * they could never see it.
 */
describe('a proposal with object operation values survives the JSONB round trip', () => {
  const assumptions = async (over: { value?: number } = {}) => {
    const { proposalPendingAction } = await import('../durable-proposal.js');
    const { createProposal } = await import('../proposal.js');
    const p = createProposal({ scenario_id: 'scn', user_id: null, base_graph_identity_hash: 'hash-base',
      operations: [
        { op: 'set_factor_value', path: 'fac_admin', value: { value: 15, unit: 'hours', basis: 'the director said about 15', authored_by: 'user_stated' } },
        { op: 'set_option_intervention', path: 'opt_pa::fac_admin', value: { normalised: 0.5, raw: 20, cap: 40, basis: 'a PA takes half', derived_frame: { lo: 0, hi: 40 }, authored_by: 'model_proposed' } },
      ],
      provenance: { authored_by: 'model_proposed', basis: 'starting assumptions' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Use as starting assumptions' });
    const pa = proposalPendingAction(p, { id: `agent-approve-proposal:${p.proposal_id}`, label: 'Use as starting assumptions', message: 'Yes, use those.' }, { scenario_id: 'scn', emitted_at_iso: new Date().toISOString() });
    const stored = jsonbOrder(JSON.parse(JSON.stringify(pa))) as { action: { inline_patch: { agent_proposal: { operations: { value: { value?: number } }[] } } } };
    if (over.value !== undefined) stored.action.inline_patch.agent_proposal.operations[0]!.value.value = over.value;
    const { parsePendingAction } = await import('../../session/pending-action.js');
    return { p, read: parsePendingAction(stored) };
  };
  const restore = async (pending: unknown[]) => {
    const { rehydrateProposals } = await import('../durable-proposal.js');
    const { ProposalStore } = await import('../proposal.js');
    const store = new ProposalStore();
    return { n: rehydrateProposals(pending, store, { scenario_id: 'scn', user_id: null }), store };
  };

  it('the precondition: JSONB really re-keys these values (else this test proves nothing)', async () => {
    const { read } = await assumptions();
    const ops = (read as unknown as { action: { inline_patch: { agent_proposal: { operations: { value: Record<string, unknown> }[] } } } }).action.inline_patch.agent_proposal.operations;
    expect(Object.keys(ops[0]!.value)).toEqual(['unit', 'basis', 'value', 'authored_by']);
    expect(Object.keys(ops[1]!.value)).toEqual(['cap', 'raw', 'basis', 'normalised', 'authored_by', 'derived_frame']);
  });

  it('RED: an assumption + option-level proposal read back from JSONB is restored, and the store would execute it on its base', async () => {
    const { p, read } = await assumptions();
    expect(read, 'the control: the real parser keeps the carrier').not.toBeNull();
    const { n, store } = await restore([read]);
    expect(n).toBe(1);
    expect(store.get(p.proposal_id)?.proposal_id).toBe(p.proposal_id);
    expect(store.authorise({ proposal_id: p.proposal_id, scenario_id: 'scn', authenticated_user_id: null, current_graph_identity_hash: 'hash-base' }).status).toBe('execute');
  });

  it('CONTRAST: the same proposal with a value altered after it was offered is still never restored', async () => {
    const { read } = await assumptions({ value: 16 });
    expect((await restore([read])).n).toBe(0);
  });

  it('the id does not depend on key order at any depth; it still changes when a value changes', async () => {
    const { computeProposalId } = await import('../proposal.js');
    const { p } = await assumptions();
    const { proposal_id: _id, ...content } = p;
    expect(computeProposalId(jsonbOrder(content) as typeof content)).toBe(p.proposal_id);
    const changed = { ...content, operations: [{ ...content.operations[0]!, value: { value: 16, unit: 'hours', basis: 'the director said about 15', authored_by: 'user_stated' } }, content.operations[1]!] };
    expect(computeProposalId(changed)).not.toBe(p.proposal_id);
  });

  it('a skipped carrier is logged with its id and scenario only, never its content', async () => {
    const { log } = await import('../../../utils/telemetry.js');
    const warn = vi.spyOn(log, 'warn');
    try {
      const { read } = await assumptions({ value: 16 });
      await restore([read]);
      const call = warn.mock.calls.find((c) => String(c[1] ?? '').includes('does not match its content'));
      expect(call, 'the integrity skip is no longer silent').toBeDefined();
      expect(Object.keys(call![0] as object).sort()).toEqual(['proposal_id', 'scenario_id']);
    } finally { warn.mockRestore(); }
  });
});
