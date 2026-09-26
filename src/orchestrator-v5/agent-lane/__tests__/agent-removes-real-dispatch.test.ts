/**
 * ⭐ THE AGENT'S REMOVAL, THROUGH THE REAL PRODUCT DISPATCH — not a fake of it.
 *
 * `agent-removes-a-link-or-option.test.ts` pins the capability against a writer modelled from its contract. A fake is
 * not evidence about the wire, so these rows drive the REAL `ceeOrchestratorRouteV2` and the REAL `agentV1TurnRoute` in
 * one Fastify app (the harness of `agent-add-option-held-seam.test.ts`): the Agent proposes a removal, the user clicks
 * the ONE approve chip on a later turn, and the Agent's in-process `/orchestrate/v2/turn` system event reaches
 * `dispatchStructuralDelete` → `applyStructuralDelete` → the atomic commit, which persists the graph. The product
 * itself proves it accepts the event and performs the write — and, on its own refusal, its own sentence reaches the user.
 *
 * The session store is stateful with the production read semantics that matter here (latest answer row, JSONB key
 * order, the REAL `parsePendingAction`; a graph-bearing append persists). The scenario graph read is a stub serving the
 * stored graph with the REAL `computeAnalysisAffectingGraphHash` — the same hash the product's stale gate compares.
 * Every model call to anything but OpenAI throws; route-v2's LLM router throws if touched at all.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { OrchestratorTurnPayloadSchema, SystemEventTurnPayloadSchema } from '@talchain/schemas/boundary';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `7b1e2d3c-4a5f-4e6d-9c7b-8a9f0e1d3c${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
const latestRow = (sid: string = SCENARIO): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
/** What a Postgres `jsonb` column gives back: keys shorter-first then bytewise, `undefined` dropped. */
const jsonbOrder = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(jsonbOrder)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as Record<string, unknown>)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        .map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]))
      : v;
const parsedPending = async (row: Row | undefined, sid: string): Promise<unknown[]> => {
  const { parsePendingAction } = await import('../../session/pending-action.js');
  const raw = row ? (jsonbOrder(JSON.parse(JSON.stringify(row.pending_actions))) as unknown[]) : [];
  return raw.map((x) => parsePendingAction(x)).filter((x) => x !== null && x.scenario_id === sid);
};
let tick = 0;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(latestRow(sid), sid)),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; turn_class?: string; handler_id?: string | null; pending_actions?: unknown[]; graph?: unknown }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      tick += 1;
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        created_at: new Date(Date.UTC(2026, 8, 26, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
  readFactsWithTurnFor: vi.fn(async () => []),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
  storeDraftGraph: vi.fn(async (sid: string, g: unknown) => { graphOf.set(sid, g); }),
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
/** route-v2's LLM router: a typed system event is deterministic — ANY use is a failure. */
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the typed removal seam (${what})`); };
vi.mock('../../../adapters/llm/router.js', () => {
  const adapter = { name: 'test', model: 'test-model', chat: refuse('chat'), chatWithTools: refuse('chatWithTools') };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }),
    getMaxTokensFromConfig: () => undefined,
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));

type Chip = { id: string; label: string; message: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _provider_calls?: { provider: string }[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string }[] } };

/** A decision, a goal, two factors and THREE linked options, so removing one still leaves a comparison. */
const seedGraph = (duplicateLink = false) => {
  const e = (from: string, to: string, mean = 0.5) => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const });
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
      { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
      { id: 'fac_price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
      { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', observed_state: { value: 0.05 } },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP' } } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: { value: 0.295, raw_value: 59, unit: 'GBP' } } },
      { id: 'opt_c', kind: 'option', label: 'Test £54', interventions: { fac_price: { value: 0.27, raw_value: 54, unit: 'GBP' } } },
    ],
    edges: [
      e('dec_x', 'opt_a'), e('dec_x', 'opt_b'), e('dec_x', 'opt_c'),
      e('opt_a', 'fac_price'), e('opt_b', 'fac_price'), e('opt_c', 'fac_price'),
      e('fac_price', 'goal_x'), e('fac_churn', 'goal_x'), e('fac_price', 'fac_churn', 0.3),
      ...(duplicateLink ? [e('fac_price', 'fac_churn', 0.3)] : []),
    ],
    goal_node_id: 'goal_x',
  };
};

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
/** The inner requests the Agent sent to route-v2, in order, with route-v2's own status for each. */
let inner: { body: Record<string, unknown>; status?: number }[] = [];

describe('the Agent removes a link or an option through the REAL product dispatch (structural_delete)', () => {
  async function buildApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const a = Fastify({ logger: false });
    a.addHook('preHandler', async (req) => { if (req.url === '/orchestrate/v2/turn') inner.push({ body: req.body as Record<string, unknown> }); });
    a.addHook('onSend', async (req, reply, payload) => {
      if (req.url === '/orchestrate/v2/turn') { const hit = inner.find((x) => x.body === req.body); if (hit !== undefined) hit.status = reply.statusCode; }
      return payload;
    });
    a.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never) };
    });
    await a.register(ceeOrchestratorRouteV2);
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }
  let app: FastifyInstance;
  let hashOf: (g: unknown) => string | null;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      if (!String(url).includes('openai')) throw new Error(`non-OpenAI network call: ${String(url)}`);
      openAiCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const next = script.shift();
      return new Response(JSON.stringify(next !== undefined ? next(body) : say('Done.')), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    app = await buildApp();
    hashOf = (await import('../../context/graph-hash.js')).computeAnalysisAffectingGraphHash as never;
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; inner = []; routerCalls.length = 0; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const graphNow = () => graphOf.get(SCENARIO) as { nodes: { id: string; kind: string; label: string }[]; edges: { from: string; to: string }[] };
  const approveChipOf = (b: Body) => b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
  const systemEvents = () => inner.filter((x) => x.body['kind'] === 'system_event');
  const RAW_CODE = /\b[a-z]+(?:_[a-z]+)+\b|\b[A-Z]+(?:_[A-Z]+)+\b/;
  const proposeRemoval = (args: Record<string, unknown>, message: string) => {
    script = [() => fnCall('propose_removal', { ...args, rationale: 'The user asked for it.' }), () => say('I would remove that. Shall I?')];
    return turn({ message });
  };
  const parsesOnTheWire = (body: Record<string, unknown>): void => {
    const a = SystemEventTurnPayloadSchema.safeParse(body);
    expect(a.success, a.success ? '' : JSON.stringify(a.error.issues)).toBe(true);
    const b = OrchestratorTurnPayloadSchema.safeParse(body);
    expect(b.success, b.success ? '' : JSON.stringify(b.error.issues)).toBe(true);
  };

  it('RED [r1]: remove an OPTION → one approve chip → click on a later turn → ONE structural_delete the REAL product accepts and commits → option and its links gone → plain receipt', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const base = hashOf(graphNow());
    const t1 = await proposeRemoval({ options: ['Test £54'] }, 'Drop the £54 test option.');
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_removal'), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1.suggested_actions)).toMatch(/^agent-approve-proposal:prop_[0-9a-f]+$/);
    expect(systemEvents(), 'nothing is sent before the approval').toEqual([]);
    expect(graphNow().nodes.some((x) => x.id === 'opt_c')).toBe(true);

    const callsBefore = openAiCalls;
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(openAiCalls - callsBefore, 'a typed approval makes no model call').toBe(0);
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const sent = systemEvents();
    expect(sent, 'exactly one typed event').toHaveLength(1);
    parsesOnTheWire(sent[0]!.body);
    expect(sent[0]!.body['event']).toEqual({ kind: 'structural_delete', removed_node_ids: ['opt_c'], removed_edges: [], base_graph_hash: base });
    expect(sent[0]!.status, 'the product accepted and committed it').toBe(200);
    // The product's own commit wrote the model: the option and every link to or from it are gone; nothing else is.
    const g = graphNow();
    expect(g.nodes.map((x) => x.id).sort()).toEqual(['dec_x', 'fac_churn', 'fac_price', 'goal_x', 'opt_a', 'opt_b']);
    expect(g.edges.some((x) => x.from === 'opt_c' || x.to === 'opt_c')).toBe(false);
    expect(g.edges).toHaveLength(seedGraph().edges.length - 2);
    expect(t2.assistant_text, t2.assistant_text).toContain('Removed the option "Test £54" and its 2 links.');
    expect(t2.assistant_text).not.toMatch(RAW_CODE);
    expect(routerCalls).toEqual([]);
    for (const b of [t1, t2]) for (const p of b._provider_calls ?? []) expect(p.provider).toBe('openai');
  }, 120_000);

  it('RED [r2]: remove a LINK → the REAL product removes exactly that link', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const base = hashOf(graphNow());
    const t1 = await proposeRemoval({ links: [{ from_label: 'Price', to_label: 'Monthly churn' }] }, 'Price does not drive churn; remove that link.');
    const approve = approveChipOf(t1);
    expect(approve, JSON.stringify(t1._agent.tool_calls)).toBeDefined();
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    const sent = systemEvents();
    expect(sent).toHaveLength(1);
    parsesOnTheWire(sent[0]!.body);
    expect(sent[0]!.body['event']).toEqual({ kind: 'structural_delete', removed_node_ids: [], removed_edges: [{ from: 'fac_price', to: 'fac_churn' }], base_graph_hash: base });
    expect(graphNow().edges.some((x) => x.from === 'fac_price' && x.to === 'fac_churn')).toBe(false);
    expect(graphNow().edges).toHaveLength(seedGraph().edges.length - 1);
    expect(t2.assistant_text).toContain('Removed the link "Price" → "Monthly churn".');
  }, 120_000);

  it('RED [r3]: the REAL product refuses (a link it holds twice) → its own sentence reaches the user, nothing removed, no code', async () => {
    graphOf.set(SCENARIO, seedGraph(true));
    const t1 = await proposeRemoval({ links: [{ from_label: 'Price', to_label: 'Monthly churn' }] }, 'Remove the price to churn link.');
    const approve = approveChipOf(t1);
    expect(approve, JSON.stringify(t1._agent.tool_calls)).toBeDefined();
    const before = JSON.stringify(graphNow());
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(systemEvents(), 'the event reached the product').toHaveLength(1);
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false, refusal: 'not_applied' }));
    // The product's own words (`structural-delete.ts`, edge_target_unresolvable), relayed — never its code.
    expect(t2.assistant_text, t2.assistant_text).toMatch(/I couldn.t match every connection you deleted to the saved model, so I haven.t removed anything\./);
    expect(t2.assistant_text).toMatch(/Not saved/);
    expect(t2.assistant_text).not.toMatch(RAW_CODE);
    expect(JSON.stringify(graphNow())).toBe(before);
  }, 120_000);

  it('RED [r4]: the model moves between the offer and the click → superseded, NOTHING sent to the product', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeRemoval({ options: ['Test £54'] }, 'Drop the £54 test option.'));
    expect(approve).toBeDefined();
    const g = graphNow();
    graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'opt_b' ? { ...x, interventions: { fac_price: { value: 0.3, raw_value: 60, unit: 'GBP' } } } : x)) });
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false, refusal: 'superseded' }));
    expect(systemEvents()).toEqual([]);
    expect(graphNow().nodes.some((x) => x.id === 'opt_c')).toBe(true);
  }, 120_000);
});
