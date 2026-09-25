/**
 * ⭐ THE EXPLICIT RUN AFTER AN OPENAI APPROVAL (RC #63; Codex 5805970015: "served Agent
 * approval calls approvalChipsFor after authorise_change and that helper returns no chips").
 *
 * Fast path 2 applies the approved values and — by design — runs nothing. Without an offer
 * the user had no Run to press on the Agent route. After a change, and ONLY when the
 * canonical readiness in the SAME response admits a run, the reply offers one typed Run chip;
 * clicking it takes fast path 3. Nothing runs implicitly.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// A fresh scenario per case: proposals are identified per scenario, and a re-proposed link
// on the same one would replay as already applied.
let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `5e0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d1c${String(n).padStart(2, '0')}`; };
/** Records committed answer rows by (scenario, turn), so a same-turn_id retry takes the REAL replay path. */
// The durable row carries `pending_actions` exactly as the store persists them, JSON round-tripped
// the way the JSONB column would be.
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Chip = { id: string; label: string; message: string; action_type?: string };

describe('the explicit Run is offered after a change the canonical readiness admits', () => {
  let app: FastifyInstance;
  let edges: { from: string; to: string }[] = [];
  let readiness: Record<string, unknown> = {};
  let runs = 0;
  let modelBodies: Record<string, unknown>[] = [];
  let proposeNext = true;
  let lastApproveId = '';
  let analysisState: Record<string, unknown> = {};
  /**
   * The route's final readback fails while the approval itself verified. After the write there are two graph
   * reads (measured): the approval's own verification, then the route's readback. Only the second is refused —
   * refusing the first would make the approval report `not_applied`, and the control would never reach the
   * condition it exists to test.
   */
  let failReadbackAfterWrite = false;
  let postWriteReads = 0;
  /** A route instance on FRESH modules: an empty process cache and an empty proposal store. */
  async function buildRouteApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const a = Fastify({ logger: false });
    a.post('/assist/v1/scenarios/:id/graph', async (_req, reply) => {
      if (edges.length > 0) postWriteReads += 1;
      if (failReadbackAfterWrite && postWriteReads >= 2) return reply.code(500).send({ error: 'read failed' });
      return {
        graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
        graph_hash: `h${edges.length}`,
        analysis_ready: readiness,
        analysis_state: analysisState,
      };
    });
    a.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; event?: { from: string; to: string }; chip?: { action_type?: string } };
      if (b.kind === 'system_event' && b.event) edges = [...edges, { from: b.event.from, to: b.event.to }];
      if (b.chip?.action_type === 'run_analysis') runs += 1;
      return { assistant_text: 'ok', blocks: b.chip?.action_type === 'run_analysis' ? [{ type: 'analysis_result', data: {} }] : [], analysis_ready: readiness };
    });
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelBodies.push(body);
      if (body['tool_choice'] !== 'none' && proposeNext) {
        proposeNext = false;
        return new Response(JSON.stringify({ output: [{
          type: 'function_call', name: 'propose_model_change', call_id: `c${modelBodies.length}`,
          arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', rationale: 'It moves velocity.' }),
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, the link matters.' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    app = await buildRouteApp();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { edges = []; runs = 0; modelBodies = []; proposeNext = true; analysisState = {}; failReadbackAfterWrite = false; postWriteReads = 0; nextScenario(); });

  /** Propose (one Agent turn), then approve through the typed chip (fast path 2). */
  async function proposeThenApprove(approveTurnId?: string): Promise<{ suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string } }> {
    const t1 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Should team size drive velocity?' } });
    const approve = (t1.json() as { suggested_actions: Chip[] }).suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve, 'the control: a real proposal was offered').toBeDefined();
    lastApproveId = approve!.id;
    const t2 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: approve!.message, source: 'chip', chip: { id: approve!.id }, ...(approveTurnId ? { turn_id: approveTurnId } : {}) } });
    expect(t2.statusCode).toBe(200);
    return t2.json() as { suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string } };
  }

  it('RED: approval applied and the canonical readiness admits a run → ONE typed Run chip, and nothing ran', async () => {
    readiness = { status: 'needs_user_input', may_run: true };
    const b = await proposeThenApprove();
    expect(b._diagnostic_trace.fast_path).toBe('approve');
    expect(edges, 'the approval really applied').toHaveLength(1);
    expect(b.suggested_actions.filter((c) => c.action_type === 'run_analysis')).toEqual([
      expect.objectContaining({ id: 'agent-run-analysis', label: 'Run analysis', action_type: 'run_analysis' }),
    ]);
    expect(runs, 'the offer runs nothing').toBe(0);
  });

  it('the offered chip, echoed as the UI sends it, takes fast path 3 — one run, one interpreting call', async () => {
    readiness = { status: 'ready', may_run: true };
    const b = await proposeThenApprove();
    const run = b.suggested_actions.find((c) => c.action_type === 'run_analysis')!;
    modelBodies = [];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: run.message, source: 'chip', chip: { id: run.id, action_type: run.action_type },
    } });
    expect((r.json() as { _diagnostic_trace: { fast_path?: string } })._diagnostic_trace.fast_path).toBe('run');
    expect(runs).toBe(1);
    expect(modelBodies.map((m) => m['tool_choice'])).toEqual(['none']);
  });

  it.each([
    ['may_run false wins over a ready status', { status: 'ready', may_run: false }],
    ['may_run false', { status: 'needs_user_input', may_run: false }],
    ['no may_run and not ready', { status: 'needs_user_input' }],
  ])('CONTRAST: %s → no Run offered', async (_l, r) => {
    readiness = r;
    const b = await proposeThenApprove();
    expect(edges, 'the approval really applied').toHaveLength(1);
    expect(b.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
  });

  /**
   * ⛔ P0, 25 Sep (RC #69 5826744045 §2): the served hiring dead end. The approval applied, the readiness is
   * the served `21e3b38` shape (AI Quality fixture `p0-post-approval-dead-end/dead-end.eng-hiring-2.approve.json`:
   * `status: blocked`, `may_run: false`, `blockers: null`), and the reply offered NOTHING.
   */
  it('RED: approval applied but the model is still blocked (served shape) → the next-step chip, and no Run', async () => {
    readiness = { status: 'blocked', may_run: false, blockers: null };
    const b = await proposeThenApprove();
    expect(edges, 'the approval really applied').toHaveLength(1);
    expect(b.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    expect(b.suggested_actions.map((c) => c.id), 'the user always has one reachable next action').toEqual(['agent-suggest-what-it-needs']);
    expect(runs).toBe(0);
  });

  it('CONTROL: approval applied and a run is admitted → Run, and NOT the next-step chip', async () => {
    readiness = { status: 'ready', may_run: true };
    const b = await proposeThenApprove();
    expect(b.suggested_actions.map((c) => c.id)).toEqual(['agent-run-analysis']);
  });

  it('OPPOSITE CONTROL: the approval commits but the readback FAILS → no next-step chip and no Run (unknown is not a refusal)', async () => {
    readiness = { status: 'ready', may_run: true }; // what the model really is — the route just cannot read it
    failReadbackAfterWrite = true;
    const b = await proposeThenApprove() as unknown as { suggested_actions: Chip[]; _agent: { tool_calls: { name: string; mutated: boolean }[] } };
    expect(edges, 'the approval really committed').toHaveLength(1);
    expect(b._agent.tool_calls.find((c) => c.name === 'authorise_change')?.mutated, 'PRECONDITION: the approval reports it applied').toBe(true);
    expect(postWriteReads, 'PRECONDITION: the readback was attempted and refused').toBeGreaterThanOrEqual(2);
    expect(b.suggested_actions.some((c) => c.id === 'agent-suggest-what-it-needs'), 'no blocked claim on an unknown state').toBe(false);
    expect(b.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
  });

  it('knownNotRunnable, exactly: only a READ refusal counts; unknown or empty is never a refusal', async () => {
    const { knownNotRunnable } = await import('../../../routes/agent-v1-turn.js');
    expect(knownNotRunnable(undefined)).toBe(false);
    expect(knownNotRunnable(null)).toBe(false);
    expect(knownNotRunnable({})).toBe(false);
    expect(knownNotRunnable({ may_run: false })).toBe(true);
    expect(knownNotRunnable({ status: 'blocked', may_run: false, blockers: null })).toBe(true);
    expect(knownNotRunnable({ status: 'blocked' })).toBe(true);
    expect(knownNotRunnable({ status: 'ready' })).toBe(false);
    expect(knownNotRunnable({ status: 'blocked', may_run: true }), 'may_run decides when present').toBe(false);
  });

  it('CONTRAST: a turn that changed nothing is not offered a Run, even when a run is admitted', async () => {
    readiness = { status: 'ready', may_run: true };
    proposeNext = false; // the Agent just answers
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What does this model say?' } });
    expect((r.json() as { suggested_actions: Chip[] }).suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
  });

  it('the admission rule, exactly: may_run decides when present; status only when it is absent', async () => {
    const { admitsRunOffer, typedRunOf, RUN_OFFER_CHIP } = await import('../../../routes/agent-v1-turn.js');
    expect(admitsRunOffer({ status: 'ready' })).toBe(true);
    expect(admitsRunOffer({ status: 'ready', may_run: false })).toBe(false);
    expect(admitsRunOffer({ status: 'blocked', may_run: true })).toBe(true);
    expect(admitsRunOffer(undefined)).toBe(false);
    expect(typedRunOf({ kind: 'message', chip: { id: RUN_OFFER_CHIP.id } }), 'the id alone is recognised').toBe(true);
    expect(typedRunOf({ kind: 'message', chip: { id: 'agent-approve-proposal:prop_abc123' } })).toBe(false);
  });
  /**
   * ⛔ Independent review of #1792 (5806213240): the durable row keeps the words only, so a
   * retry of the SAME turn_id after a lost response replayed with no Run and no approve control.
   */
  describe('a durable replay re-offers the original typed actions, re-validated on today\'s state', () => {
    const replay = async (payload: Record<string, unknown>) => {
      const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
      expect(r.statusCode).toBe(200);
      return r.json() as { suggested_actions: Chip[]; _agent: { replayed?: boolean }; _provider_calls: unknown[] };
    };

    it('RED: approve with a stable turn_id, lose the response, retry → the same ONE Run chip, zero runs, no model call, no extra write', async () => {
      readiness = { status: 'needs_user_input', may_run: true };
      const T = '11111111-2222-4333-8444-555555555555';
      const first = await proposeThenApprove(T);
      expect(first.suggested_actions.filter((c) => c.action_type === 'run_analysis')).toHaveLength(1);
      const writesBefore = edges.length; const callsBefore = modelBodies.length;
      // The retry is byte-identical to the first request (the UI resends it).
      const again = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'Yes, make that change.', source: 'chip', chip: { id: lastApproveId }, turn_id: T });
      expect(again._agent.replayed, 'the real replay path').toBe(true);
      expect(again.suggested_actions.filter((c) => c.action_type === 'run_analysis')).toEqual([expect.objectContaining({ id: 'agent-run-analysis' })]);
      expect(runs, 'the replay runs nothing').toBe(0);
      expect(modelBodies.length - callsBefore, 'no model call').toBe(0);
      expect(edges.length - writesBefore, 'no second write').toBe(0);
    });

    it('CONTRAST: readiness later says may_run:false → the replay does NOT carry the stale Run chip', async () => {
      readiness = { status: 'needs_user_input', may_run: true };
      const T = '21111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      readiness = { status: 'ready', may_run: false };
      const again = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'Yes, make that change.', source: 'chip', chip: { id: lastApproveId }, turn_id: T });
      expect(again._agent.replayed).toBe(true);
      expect(again.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: a refused approval offered no Run, so its replay acquires none', async () => {
      readiness = { status: 'ready', may_run: true };
      const T = '31111111-2222-4333-8444-555555555555';
      const body = { kind: 'message', scenario_id: SCENARIO, message: 'Yes, make that change.', source: 'chip', chip: { id: 'agent-approve-proposal:prop_0123456789abcdef0123456789abcdef' }, turn_id: T };
      const first = await replay(body);
      expect(first.suggested_actions.some((c) => c.action_type === 'run_analysis'), 'the refused original offered none').toBe(false);
      const again = await replay(body);
      expect(again._agent.replayed).toBe(true);
      expect(again.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: another scenario reusing the same turn_id never acquires this scenario\'s offer', async () => {
      readiness = { status: 'ready', may_run: true };
      const T = '41111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      const mine = SCENARIO;
      nextScenario();
      expect(SCENARIO).not.toBe(mine);
      const other = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'What does this model say?', turn_id: T });
      expect(other._agent.replayed ?? false, 'a different scenario is not a replay of mine').toBe(false);
      expect(other.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('the SAME invariant covers the approve chip: replayed while its proposal is outstanding, dropped once it is applied', async () => {
      readiness = { status: 'needs_user_input', may_run: false };
      const T = '51111111-2222-4333-8444-555555555555';
      const offer = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'Should team size drive velocity?', turn_id: T });
      const chip = offer.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'))!;
      expect(chip, 'the control: a proposal was offered').toBeDefined();
      const again = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'Should team size drive velocity?', turn_id: T });
      expect(again._agent.replayed).toBe(true);
      expect(again.suggested_actions.map((c) => c.id)).toEqual([chip.id, 'agent-amend-proposal']);
      await replay({ kind: 'message', scenario_id: SCENARIO, message: chip.message, source: 'chip', chip: { id: chip.id } });
      const afterApply = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'Should team size drive velocity?', turn_id: T });
      expect(afterApply._agent.replayed).toBe(true);
      expect(afterApply.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:')), 'an applied proposal is never re-offered').toBe(false);
    });

    it('the rule, exactly: stillValidOffers keeps only what today\'s state still admits', async () => {
      const { stillValidOffers, RUN_OFFER_CHIP } = await import('../../../routes/agent-v1-turn.js');
      const approve = { id: 'agent-approve-proposal:prop_abc123', label: 'Make this change', message: 'Yes, make that change.' };
      const amend = { id: 'agent-amend-proposal', label: 'Change something first', message: 'Before you apply it, I want to change some of it.' };
      const all = [approve, amend, RUN_OFFER_CHIP];
      expect(stillValidOffers(all, { outstandingProposalIds: new Set(['prop_abc123']), analysisReady: { may_run: true }, analysisState: {}, modelExists: true }).map((a) => a.id))
        .toEqual([approve.id, amend.id, RUN_OFFER_CHIP.id]);
      expect(stillValidOffers(all, { outstandingProposalIds: new Set(), analysisReady: { may_run: true }, analysisState: { run_state: { kind: 'complete_current' } }, modelExists: true })).toEqual([]);
      expect(stillValidOffers([], { outstandingProposalIds: new Set(['prop_abc123']), analysisReady: { may_run: true }, analysisState: {}, modelExists: true }), 'nothing is invented').toEqual([]);
    });
  });
  /**
   * ⛔ Independent review of #1792 (5806428423): the same-process cache cannot carry a replay
   * across a restart or another worker. The Run offer is persisted WITH the answer row and read
   * back from that exact row; these replays run on a FRESH route instance (empty cache, empty
   * proposal store), so only the durable record can supply the offer.
   */
  describe('a replay in a FRESH process recovers the Run offer from the committed row', () => {
    const approveBody = (T: string) => ({ kind: 'message', scenario_id: SCENARIO, message: 'Yes, make that change.', source: 'chip', chip: { id: lastApproveId }, turn_id: T });
    const onFresh = async (payload: Record<string, unknown>) => {
      const fresh = await buildRouteApp();
      try {
        const r = await fresh.inject({ method: 'POST', url: '/agent/v1/turn', payload });
        expect(r.statusCode).toBe(200);
        return r.json() as { suggested_actions: Chip[]; _agent: { replayed?: boolean } };
      } finally { await fresh.close(); }
    };

    it('RED: approve, lose the response, the process restarts, retry → the SAME Run offer from the durable row; 0 runs, 0 model calls, 0 writes', async () => {
      readiness = { status: 'needs_user_input', may_run: true };
      const T = '61111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      const row = rows.get(`${SCENARIO}:${T}`)!;
      expect(row.pending_actions, 'the offer was persisted with the answer row').toEqual([expect.objectContaining({ chip_id: 'agent-run-analysis', action: { kind: 'run_analysis' } })]);
      const writes = edges.length; const calls = modelBodies.length;
      const again = await onFresh(approveBody(T));
      expect(again._agent.replayed, 'the real replay path, on a fresh instance').toBe(true);
      expect(again.suggested_actions.filter((c) => c.action_type === 'run_analysis')).toEqual([expect.objectContaining({ id: 'agent-run-analysis' })]);
      expect(runs).toBe(0);
      expect(modelBodies.length - calls).toBe(0);
      expect(edges.length - writes).toBe(0);
    });

    it('CONTRAST: today\'s readiness no longer admits a run → the durable offer is NOT re-offered', async () => {
      readiness = { status: 'needs_user_input', may_run: true };
      const T = '71111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      readiness = { status: 'ready', may_run: false };
      expect((await onFresh(approveBody(T))).suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: a current analysis already exists → not re-offered', async () => {
      readiness = { status: 'ready', may_run: true };
      const T = '81111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      analysisState = { run_state: { kind: 'complete_current' } };
      expect((await onFresh(approveBody(T))).suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: the ORIGINAL turn offered no Run (not admitted then) and the model became ready since → none; a historical absence confers nothing', async () => {
      readiness = { status: 'needs_user_input', may_run: false };
      const T = '91111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      expect(rows.get(`${SCENARIO}:${T}`)!.pending_actions).toEqual([]);
      readiness = { status: 'ready', may_run: true };
      expect((await onFresh(approveBody(T))).suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: the persisted offer has expired (its own 10-minute lifetime) → none', async () => {
      readiness = { status: 'ready', may_run: true };
      const T = 'a1111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      const row = rows.get(`${SCENARIO}:${T}`)!;
      row.pending_actions = row.pending_actions.map((pa) => ({ ...(pa as Record<string, unknown>), expires_at_iso: '2020-01-01T00:00:00.000Z' }));
      expect((await onFresh(approveBody(T))).suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: an approve chip fails closed after a restart — its proposal lived in the old process', async () => {
      readiness = { status: 'needs_user_input', may_run: false };
      const T = 'b1111111-2222-4333-8444-555555555555';
      const first = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Should team size drive velocity?', turn_id: T } });
      expect((first.json() as { suggested_actions: Chip[] }).suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:')), 'the control: offered originally').toBe(true);
      const again = await onFresh({ kind: 'message', scenario_id: SCENARIO, message: 'Should team size drive velocity?', turn_id: T });
      expect(again._agent.replayed).toBe(true);
      expect(again.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:')), 'never an approval for a proposal this process does not hold').toBe(false);
    });
  });
});
