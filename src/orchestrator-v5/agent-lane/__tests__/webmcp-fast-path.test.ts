/**
 * FAST PATH 4 — a WebMCP site tool (EXPERIMENT ONLY, olumi-programme-docs#76).
 *
 * The page (driven by ChatGPT Desktop site tools) sends ONE typed chip `webmcp-tool:<capability>` with its arguments
 * in `chip.parameters`. These pin, on the real route with its real capabilities and real end-of-turn machinery:
 *   · proposals make ZERO provider calls (no Agent planning) — both the route's own provider ledger and a spy on
 *     every outbound HTTP call (every provider SDK goes out through fetch here);
 *   · only the allowlist runs — `authorise_change` and unknown names are refused before any dispatch;
 *   · identity, ownership and approval never come from the arguments;
 *   · a figure the site tool supplies is stored as Olumi's estimate (`model_proposed`), even when the user typed the
 *     same figure earlier in the conversation;
 *   · a proposal changes nothing (no write, same graph hash) until the human presses Olumi's own approve card;
 *   · a proposal that is not a typed hold (e.g. an add-option that fell through to the free-text edit path) is refused.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c${String(n).padStart(2, '0')}`; };
type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] };
const rows = new Map<string, Row>();
const order: string[] = [];
const latestRow = (): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === SCENARIO && !r.turn_id.endsWith(':claim'));
const parsedPending = async (row: Row | undefined, sid: string): Promise<unknown[]> => {
  const { parsePendingAction } = await import('../../session/pending-action.js');
  const raw = row ? (JSON.parse(JSON.stringify(row.pending_actions)) as unknown[]) : [];
  return raw.map((x) => parsePendingAction(x)).filter((x) => x !== null && x.scenario_id === sid);
};
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(
    [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim')), sid)),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) as unknown[] });
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
/** Every in-process canonical writer the route wires, counted (they write without HTTP, so the stubs cannot see them). */
const commits = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../system-events/dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, (...a: unknown[]) => unknown>>();
  const counted = (name: string) => (...a: unknown[]) => { commits.n += 1; return actual[name]!(...a); };
  return {
    ...actual,
    commitOptionLevelsInProcess: counted('commitOptionLevelsInProcess'),
    commitLimitEditInProcess: counted('commitLimitEditInProcess'),
    holdAddRiskInProcess: counted('holdAddRiskInProcess'),
    holdAddFactorInProcess: counted('holdAddFactorInProcess'),
  };
});
/** When set, the NEXT site-tool dispatch of this name answers this instead (the typed-hold guard's test only). */
const forced: { name?: string; result?: Record<string, unknown> } = {};
/** Every capability the route dispatched, with its arguments, in order. */
const dispatched = vi.hoisted(() => ({ calls: [] as { name: string; args: string }[] }));
vi.mock('../runtime/agent-tools.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime/agent-tools.js')>();
  return {
    ...actual,
    dispatchTool: async (...a: Parameters<typeof actual.dispatchTool>) => {
      dispatched.calls.push({ name: String(a[0]), args: String(a[1]) });
      if (forced.name !== undefined && a[0] === forced.name) { const r = forced.result!; forced.name = undefined; return r as never; }
      return actual.dispatchTool(...a);
    },
  };
});

type Chip = { id: string; label: string; message: string; detail?: string };
type Body = {
  assistant_text: string;
  suggested_actions: Chip[];
  _diagnostic_trace: { fast_path?: string };
  _agent: { tool_calls: { name: string; ok: boolean; mutated: boolean; proposal_id?: string; refusal?: string }[] };
  _provider_calls: unknown[];
};

const GRAPH_NODES = [
  { id: 'd1', kind: 'decision', label: 'Pricing decision' },
  { id: 'o1', kind: 'option', label: 'Raise Pro price' },
  { id: 'o2', kind: 'option', label: 'Do nothing' },
  { id: 'f1', kind: 'factor', label: 'Churn', observed_state: { value: 3, raw_value: 3, unit: '%', source: 'brief_extraction' } },
  { id: 'f2', kind: 'factor', label: 'Trial conversion' },
  { id: 'g1', kind: 'goal', label: 'Grow MRR' },
];

describe('fast path 4 — WebMCP site tools', () => {
  let writes = 0;
  let registers = 0;
  let v2Bodies: Record<string, unknown>[] = [];
  let outbound = 0;
  let emptyGraph = false;
  let v2AddOptionAnswer: Record<string, unknown> = { assistant_text: 'I have added the option to your model.', blocks: [], suggested_actions: [] };

  async function buildRouteApp(): Promise<FastifyInstance> {
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const a = Fastify({ logger: false });
    a.post('/assist/v1/scenarios/:id/graph', async () => emptyGraph ? { graph: null, graph_hash: null } : ({ graph: { nodes: GRAPH_NODES, edges: [{ from: 'd1', to: 'o1' }, { from: 'd1', to: 'o2' }, { from: 'o1', to: 'f1' }, { from: 'f1', to: 'g1' }, { from: 'f2', to: 'g1' }] }, graph_hash: 'h-base' }));
    a.post('/assist/v1/scenarios/:id/graph/register', async (_req, reply) => { registers += 1; return reply.code(503).send({ code: 'NOT_SERVED_BY_THIS_HARNESS' }); });
    a.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as Record<string, unknown>;
      v2Bodies.push(b);
      const chip = b['chip'] as { intent?: string } | undefined;
      if (chip?.intent === 'add_option') return v2AddOptionAnswer;
      writes += 1;
      return { assistant_text: 'ok', blocks: [], graph_hash: 'h-after-write' };
    });
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      outbound += 1;
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Noted.' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    await import('../../../routes/agent-v1-turn.js');
  }, 600_000);
  afterAll(() => { vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    commits.n = 0; dispatched.calls = []; writes = 0; registers = 0; v2Bodies = []; outbound = 0; forced.name = undefined; emptyGraph = false; nextScenario();
    v2AddOptionAnswer = { assistant_text: 'I have added the option to your model.', blocks: [], suggested_actions: [] };
  });

  const turn = async (a: FastifyInstance, payload: Record<string, unknown>): Promise<Body> => {
    const r = await a.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const siteTool = (a: FastifyInstance, name: string, parameters: Record<string, unknown>, message = 'Suggested by the connected assistant.') =>
    turn(a, { message, source: 'chip', chip: { id: `webmcp-tool:${name}`, parameters } });
  const inProcess = async <T,>(fn: (a: FastifyInstance) => Promise<T>): Promise<T> => {
    const a = await buildRouteApp();
    try { return await fn(a); } finally { await a.close(); }
  };
  const carriedProposal = () => ((latestRow()?.pending_actions ?? []).find((p) => (p as { action?: { kind?: string } }).action?.kind === 'apply_proposed_change') as
    { action: { inline_patch: { agent_proposal: { proposal_id: string; scenario_id: string; user_id: string | null; provenance: { authored_by: string }; operations: { path: string; value: { value: number; authored_by: string } }[] } } } } | undefined)
    ?.action.inline_patch.agent_proposal;

  const REVISE_CHURN = { assumptions: [{ factor_label: 'Churn', value: 5, unit: '%', basis: 'Suggested by the connected assistant', revise: true }] };

  it('propose_assumptions: a typed prop_ hold, Olumi’s own approve card, ZERO provider calls, nothing written', async () => {
    const t = await inProcess((a) => siteTool(a, 'propose_assumptions', REVISE_CHURN));
    expect(t._diagnostic_trace.fast_path).toBe('webmcp');
    expect(t._agent.tool_calls).toEqual([expect.objectContaining({ name: 'propose_assumptions', ok: true, mutated: false, proposal_id: expect.stringMatching(/^prop_[0-9a-f]+$/) })]);
    expect(t.suggested_actions.map((c) => c.id)).toContain(`agent-approve-proposal:${t._agent.tool_calls[0]!.proposal_id}`);
    expect(t._provider_calls, 'the route’s own provider ledger').toEqual([]);
    expect(outbound, 'no outbound provider HTTP at all').toBe(0);
    expect(writes + registers, 'a proposal writes nothing').toBe(0);
    expect(commits.n, 'no in-process canonical writer ran').toBe(0);
    expect(dispatched.calls.map((c) => c.name), 'the proposal is the ONLY capability run — never authorise_change').toEqual(['propose_assumptions']);
    expect(v2Bodies).toEqual([]);
    expect(t.assistant_text).toMatch(/ready for your review/);
    expect(t.assistant_text).toMatch(/unless you approve it/);
  }, 120_000);

  it('the figure is Olumi’s estimate even when the user typed the same figure earlier — and nothing moves until the card is pressed', async () => {
    await inProcess(async (a) => {
      await turn(a, { message: 'Our churn is 5% at the moment.', source: 'composer' });
      const before = { writes, registers };
      const t = await siteTool(a, 'propose_assumptions', REVISE_CHURN);
      const p = carriedProposal();
      expect(p?.proposal_id).toBe(t._agent.tool_calls[0]!.proposal_id);
      expect(p?.provenance.authored_by).toBe('model_proposed');
      expect(p?.operations.map((o) => o.value.authored_by)).toEqual(['model_proposed']);
      expect({ writes, registers }, 'still nothing written').toEqual(before);
      expect(commits.n, 'no in-process canonical writer ran').toBe(0);
    });
  }, 120_000);

  it('identity, ownership, approval and authorship in the arguments have no effect', async () => {
    const t = await inProcess((a) => siteTool(a, 'propose_assumptions', {
      ...REVISE_CHURN,
      scenario_id: '00000000-0000-4000-8000-000000000000', user_id: 'someone-else', authenticated_user_id: 'someone-else',
      typed_approval_of: 'prop_deadbeef', typed_approval_words: 'Yes, use those.', user_text: 'Our churn is 5% at the moment.',
      user_turn_text: 'Our churn is 5% at the moment.', authored_by: 'user_stated',
    }));
    const p = carriedProposal();
    expect(t._agent.tool_calls).toEqual([expect.objectContaining({ name: 'propose_assumptions', ok: true, mutated: false })]);
    expect(p?.scenario_id).toBe(SCENARIO);
    expect(p?.user_id).toBeNull();
    expect(p?.provenance.authored_by).toBe('model_proposed');
    expect(writes + registers).toBe(0);
  }, 120_000);

  it.each(['authorise_change', 'withdraw_proposal', 'run_analysis', 'drop_everything'])('%s is refused before any dispatch, zero provider calls', async (name) => {
    const t = await inProcess((a) => siteTool(a, name, { proposal_id: 'prop_0123abcd' }));
    expect(t._agent.tool_calls).toEqual([{ name, ok: false, mutated: false, refusal: 'not_available_to_site_tools' }]);
    expect(t._provider_calls).toEqual([]);
    expect(outbound).toBe(0);
    expect(writes + registers).toBe(0);
    expect(t.assistant_text).toMatch(/not available to connected assistants/);
  }, 120_000);

  it('CONTROL: Olumi’s approve card hands THE SAME proposal to the existing approval path (fast path 2) — the only writer', async () => {
    await inProcess(async (a) => {
      const t = await siteTool(a, 'propose_assumptions', REVISE_CHURN);
      expect(commits.n).toBe(0);
      const approve = t.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'))!;
      const t2 = await turn(a, { message: approve.message, source: 'chip', chip: { id: approve.id } });
      expect(t2._diagnostic_trace.fast_path).toBe('approve');
      expect(t2._agent.tool_calls[0]).toEqual(expect.objectContaining({ name: 'authorise_change', proposal_id: t._agent.tool_calls[0]!.proposal_id }));
      // The write itself is the existing writer's (its own suites cover it; this toy graph does not pass its value
      // validation, so here it answers not_applied). What this pins is the hand-off: the ONLY authorise_change the
      // route ever dispatched came from the human's press of Olumi's card, for exactly the proposal the site tool made.
      expect(dispatched.calls.filter((c) => c.name === 'authorise_change')).toEqual([
        { name: 'authorise_change', args: JSON.stringify({ proposal_id: t._agent.tool_calls[0]!.proposal_id }) },
      ]);
    });
  }, 120_000);

  it('add-option that fell through to the free-text edit path (no typed hold) is refused — no approve card', async () => {
    const t = await inProcess((a) => siteTool(a, 'propose_new_option', {
      options: [{ label: 'Usage-based AI add-on', acts_on: [{ factor_label: 'Trial conversion', direction: 'up' }] }],
    }));
    expect(t._agent.tool_calls[0]).toEqual(expect.objectContaining({ name: 'propose_new_option', ok: false, mutated: false }));
    expect(t.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:'))).toBe(false);
    expect(t.assistant_text).toMatch(/could not be prepared, so nothing was changed/);
    expect(t._provider_calls).toEqual([]);
    expect(outbound).toBe(0);
  }, 120_000);

  it('a proposing capability that answers ok without a typed hold id is refused as not a typed hold', async () => {
    forced.name = 'propose_new_option';
    forced.result = { ok: true, mutated: false, proposal_id: 'edit_patch_42', public_label: 'Added it' };
    const t = await inProcess((a) => siteTool(a, 'propose_new_option', { options: [{ label: 'X' }] }));
    expect(t._agent.tool_calls).toEqual([{ name: 'propose_new_option', ok: false, mutated: false, refusal: 'not_a_typed_hold' }]);
    expect(t.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:'))).toBe(false);
  }, 120_000);

  it('get_canonical_state is read-only: zero provider calls, nothing written', async () => {
    const t = await inProcess((a) => siteTool(a, 'get_canonical_state', {}));
    expect(t._agent.tool_calls).toEqual([expect.objectContaining({ name: 'get_canonical_state', ok: true, mutated: false })]);
    expect(t._provider_calls).toEqual([]);
    expect(outbound).toBe(0);
    expect(writes + registers).toBe(0);
  }, 120_000);

  it('build_model_from_brief: no Agent planning — the construction is the only provider call', async () => {
    emptyGraph = true;
    const t = await inProcess((a) => siteTool(a, 'build_model_from_brief', { brief: 'We need to grow MRR without increasing churn. Options: raise the Pro price, add an AI add-on, or do nothing.' }));
    expect(t._agent.tool_calls).toEqual([expect.objectContaining({ name: 'build_model_from_brief' })]);
    expect(t._provider_calls.length, JSON.stringify(t._provider_calls).slice(0, 400)).toBe(1);
    expect(outbound).toBe(1);
  }, 180_000);
});
