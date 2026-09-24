/**
 * ⛔ A PENDING APPROVAL SURVIVES A RESTART (root cause of Paul's failing test, 24 Sep 09:39–09:53Z,
 * scenario `d41e2c21`, #63 5811981438): proposals lived only in process memory
 * (`agent-v1-turn.ts` `new ProposalStore()`), and three merge-driven redeploys landed inside his session.
 * His "yes" reached a fresh process, got `unknown_proposal`, nothing was saved and the model stayed
 * unanalysable.
 *
 * The proposal now travels with the answer row that offered it (an `apply_proposed_change` pending
 * action carrying the stored proposal; no `handler_id`, so the conventional resumer falls through) and a
 * fresh process rehydrates it — only when it still hashes to its id, belongs to this scenario and subject,
 * and has not expired. The approval then applies exactly as before: `authorise` still checks the base.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6e0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d1c${String(n).padStart(2, '0')}`; };
type Row = { id: string; scenario_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] };
const rows = new Map<string, Row>();
const order: string[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  // The latest committed row's pending actions, JSON round-tripped as the JSONB column returns them AND
  // passed through the REAL parser, exactly as `supabase-store.ts` readMostRecentPendingActions does
  // (Codex #1823 5812296935: a raw-JSON mock hid that the parser drops an item the store would drop).
  readMostRecentPendingActions: vi.fn(async (sid: string) => {
    const { parsePendingAction } = await import('../../session/pending-action.js');
    const latest = [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid);
    const raw = latest ? (JSON.parse(JSON.stringify(latest.pending_actions)) as unknown[]) : [];
    return raw.map((x) => parsePendingAction(x)).filter((x) => x !== null);
  }),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) });
      order.push(k);
    }
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Chip = { id: string; label: string; message: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string }; _agent: { tool_calls: { name: string; ok: boolean; refusal?: string }[] } };

describe('a pending approval survives a restart', () => {
  let edges: { from: string; to: string }[] = [];
  let proposeNext = true;
  async function buildRouteApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const a = Fastify({ logger: false });
    a.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }], edges },
      graph_hash: `h${edges.length}`,
    }));
    a.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; event?: { from: string; to: string } };
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
  afterAll(() => { vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { edges = []; proposeNext = true; nextScenario(); });

  const propose = async (): Promise<Chip> => {
    const a = await buildRouteApp();
    try {
      const t1 = (await a.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), message: 'Should team size drive velocity?' } })).json() as Body;
      const approve = t1.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
      expect(approve, `the control: a real proposal was offered — ${JSON.stringify({ tools: t1._agent?.tool_calls, text: String(t1.assistant_text ?? '').slice(0, 200), chips: t1.suggested_actions })}`).toBeDefined();
      return approve!;
    } finally { await a.close(); }
  };
  const approveOnFreshProcess = async (approve: Chip): Promise<Body> => {
    const b = await buildRouteApp();
    try {
      const r = await b.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), message: approve.message, source: 'chip', chip: { id: approve.id } } });
      expect(r.statusCode).toBe(200);
      return r.json() as Body;
    } finally { await b.close(); }
  };

  it('RED: propose, the process restarts, then approve → the SAME proposal applies (one link written, no "no longer hold")', async () => {
    const approve = await propose();
    const t2 = await approveOnFreshProcess(approve);
    expect(t2._diagnostic_trace.fast_path, 'the control: the typed approval path').toBe('approve');
    expect(t2._agent.tool_calls, JSON.stringify({ calls: t2._agent.tool_calls, text: t2.assistant_text.slice(0, 300) })).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true })]);
    expect(edges).toEqual([{ from: 'f1', to: 'o1' }]);
    expect(t2.assistant_text).not.toMatch(/no longer hold/i);
  }, 60_000);

  it('the offer is persisted with the answer row that made it — the conventional resumer cannot act on it', async () => {
    const approve = await propose();
    const row = [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === SCENARIO)!;
    const persisted = row.pending_actions.find((p) => (p as { chip_id?: string }).chip_id === approve.id) as { action: { kind: string; proposal_ref: string; inline_patch: Record<string, unknown> } } | undefined;
    expect(persisted?.action.kind).toBe('apply_proposed_change');
    expect(persisted?.action.proposal_ref).toBe(approve.id);
    expect(persisted?.action.inline_patch).not.toHaveProperty('handler_id');
  }, 60_000);

  it('CONTRAST: a stored proposal altered after it was offered is never rehydrated — nothing is written', async () => {
    const approve = await propose();
    const row = [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === SCENARIO)!;
    const pa = row.pending_actions.find((p) => (p as { chip_id?: string }).chip_id === approve.id) as { action: { inline_patch: { agent_proposal: { public_label: string } } } };
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
