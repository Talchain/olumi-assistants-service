/** event_risk.v1 slice 2a: real Agent → product hold → approve → committed graph.
 * Harness copied from agent-writer-doors-seam.test.ts, including JSONB order and production pending parsing.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6b1e2d3c-4b5a-4f6e-9d7c-8b9a0e1f3d${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
let graphOf = new Map<string, unknown>();
/** Every append that carried a graph, per scenario: "ONE graph-bearing row". */
const graphWrites = new Map<string, number>();
/** (7c) Refuse every graph read once the scenario has more than this many graph-bearing rows; `undefined` = never. */
let failReadsAfterWrites: number | undefined;
let _readsRefused = 0;
const latestRow = (sid: string = SCENARIO): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
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
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; turn_class?: string; handler_id?: string | null; pending_actions?: unknown[]; graph?: unknown; handler_facts?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      tick += 1;
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[],
        created_at: new Date(Date.UTC(2026, 8, 27, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) {
        graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
        graphWrites.set(w.scenario_id, (graphWrites.get(w.scenario_id) ?? 0) + 1);
      }
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
  readFactsWithTurnFor: vi.fn(async (ids: readonly string[]) => [...rows.values()].filter((r) => ids.includes(r.id))
    .flatMap((r) => r.handler_facts.map((fact) => ({ turn_id: r.id, fact })))),
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
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the writer doors (${what})`); };
vi.mock('../../../adapters/llm/router.js', () => {
  const adapter = { name: 'test', model: 'test-model', chat: refuse('chat'), chatWithTools: refuse('chatWithTools') };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }),
    getMaxTokensFromConfig: () => undefined,
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));

type Chip = { id: string; label: string; message: string; detail?: string };
type Call = { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _agent: { tool_calls: Call[] }; _provider_calls?: { provider: string }[] };
type G = { nodes: { id: string; kind: string; label: string; [k: string]: unknown }[]; edges: { from: string; to: string; [k: string]: unknown }[]; goal_constraints?: Record<string, unknown>[] };

const SPEND = 'six_month_decision_spend';
/**
 * A runnable pricing model: decision, goal "Revenue", an outcome "Market share" that reaches it, the lever "Price",
 * and the Paul-shaped limit — a £20,000 cap on "Six-month decision spend" (unit GBP, value_frame 'level', drafted
 * from the brief) — plus a goal target row, to prove the limit door refuses the goal.
 */
const seedGraph = (): G => {
  const e = (from: string, to: string, mean = 0.5, dir: 'positive' | 'negative' = 'positive') =>
    ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: dir });
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
      { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
      { id: 'out_share', kind: 'outcome', label: 'Market share' },
      { id: 'fac_price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
      { id: SPEND, kind: 'factor', label: 'Six-month decision spend', category: 'external', observed_state: { value: 0.375, raw_value: 15000, unit: 'GBP', cap: 40000 } },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP' } } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: { value: 0.295, raw_value: 59, unit: 'GBP' } } },
    ],
    edges: [e('dec_x', 'opt_a', 1), e('dec_x', 'opt_b', 1), e('opt_a', 'fac_price', 1), e('opt_b', 'fac_price', 1),
      e('fac_price', 'out_share'), e('out_share', 'goal_x'), e('fac_price', 'goal_x'), e(SPEND, 'goal_x', 0.2, 'negative')],
    goal_constraints: [
      { constraint_id: 'gc-spend-1', node_id: SPEND, operator: '<=', value: 20000, unit: 'GBP', value_frame: 'level',
        label: 'Six-month decision spend', provenance: 'inferred', source_quote: 'keep decision spend under £20,000 over six months' },
      { constraint_id: 'gc-goal-1', node_id: 'goal_x', operator: '>=', value: 60000, unit: 'GBP', value_frame: 'level', label: 'Revenue', provenance: 'explicit' },
    ],
  };
};

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
/** The tool output the model was handed on its NEXT call (the first function_call_output in its input). */
const toolOutputIn = (body: Record<string, unknown>): Record<string, unknown> => {
  const out = (body['input'] as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output').at(-1);
  return JSON.parse(String(out?.output ?? '{}')) as Record<string, unknown>;
};

describe('event_risk.v1 slice 2a — add-risk door', () => {
  let app: FastifyInstance;
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
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req, reply) => {
      const id = (req.params as { id: string }).id;
      if (failReadsAfterWrites !== undefined && (graphWrites.get(id) ?? 0) > failReadsAfterWrites) {
        _readsRefused += 1;
        return reply.code(500).send({ error: 'read failed' });
      }
      const g = graphOf.get(id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never) };
    });
    await app.register(ceeOrchestratorRouteV2);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; routerCalls.length = 0; failReadsAfterWrites = undefined; _readsRefused = 0; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const graphNow = () => graphOf.get(SCENARIO) as G;
  const bytes = () => JSON.stringify(graphOf.get(SCENARIO));
  const hashNow = async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    return computeAnalysisAffectingGraphHash(graphNow() as never) as string;
  };
  const approveChipOf = (b: Body) => b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
  const heldOnLatestRow = async () => {
    const pendings = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; action: { kind: string; inline_patch?: { handler_id?: string; operations?: { op: string; path: string; value?: Record<string, unknown> }[] } } }[];
    return pendings.filter((p) => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };
  const newRisk = () => graphNow().nodes.find((x) => x.kind === 'risk' && x.label === 'Competitive response');
  const EVENT_MSG = 'Add a competitive response risk that lowers revenue, maybe 10–30% in the next 6 months.';
  const EVENT = { version: 1, occurrence: { p_low: 0.1, p_high: 0.3, basis: 'user', meaning: 'at_least_once_within_horizon' }, horizon: { months: 6 } };
  const quote = '10–30% in the next 6 months';
  const offer = async (message: string, caused = false) => {
    let result: Record<string, unknown> = {};
    script = [() => fnCall('propose_new_risk', { label: 'Competitive response', affects: [{ target_label: 'Revenue', direction: 'negative' }],
      caused_by: caused ? [{ factor_label: 'Price', direction: 'positive' }] : [], rationale: 'The user asked for it.' }),
      (body) => { result = toolOutputIn(body); return say('Shall I add the risk?'); }];
    const response = await turn({ message });
    expect(response._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_new_risk', ok: true }));
    const approve = approveChipOf(response)!;
    expect(approve).toBeDefined();
    return { result, approve };
  };
  const approveOffer = async (approve: Chip) => {
    const response = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(response._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    return response;
  };

  it('2a-door-event: propose → hold → approve commits the exact user block and conditional affects existence', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    const { result, approve } = await offer(EVENT_MSG);
    expect((result.risk as Record<string, unknown>).likelihood).toEqual({ p_low_pct: 10, p_high_pct: 30, horizon_months: 6, basis: 'user', quote });
    const holds = await heldOnLatestRow();
    expect(holds).toHaveLength(1);
    const patch = holds[0]!.action.inline_patch! as Record<string, unknown>;
    const add = holds[0]!.action.inline_patch!.operations!.find((o) => o.op === 'add_node' && o.value?.label === 'Competitive response')!;
    expect(add.value).toEqual({ id: add.path, kind: 'risk', label: 'Competitive response' });
    expect(patch.user_event_risk).toEqual({ risk_id: add.path, event_risk: EVENT, quote });
    expect(bytes()).toBe(before);
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    await approveOffer(approve);
    expect((graphWrites.get(SCENARIO) ?? 0) - writesBefore).toBe(1);
    const risk = newRisk()!;
    expect(risk.event_risk).toEqual(EVENT);
    const edge = graphNow().edges.find((e) => e.from === risk.id && e.to === 'goal_x')!;
    const { hypothesisEdgeValue } = await import('../../routing/add-option-transaction.js');
    // Existence 1.0 (an event's stated impact); the size stays Olumi's placeholder, still `defaulted: true`.
    expect(edge).toEqual({ ...hypothesisEdgeValue(risk.id, 'goal_x', 'negative'), exists_probability: 1 });
    expect(edge.defaulted).toBe(true);
    const { composeProposalReply } = await import('../proposal-reply.js');
    expect(composeProposalReply('propose_new_risk', { whole_request: true }, result, EVENT_MSG)).toContain('may happen (about 10–30% within 6 months), as you said');
  }, 120_000);

  it('2a-door-control: no likelihood commits the byte-identical ordinary risk and default link', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const { result, approve } = await offer('Add a competitive response risk that lowers revenue.');
    expect((result.risk as Record<string, unknown>).likelihood).toBeUndefined();
    await approveOffer(approve);
    const risk = newRisk()!;
    expect(risk).toEqual({ id: risk.id, kind: 'risk', label: 'Competitive response', ref: 'R1' });
    const { hypothesisEdgeValue } = await import('../../routing/add-option-transaction.js');
    expect(graphNow().edges.find((e) => e.from === risk.id && e.to === 'goal_x')).toEqual(hypothesisEdgeValue(risk.id, 'goal_x', 'negative'));
  }, 120_000);

  it('2a-door-caused: likelihood plus caused_by commits an ordinary risk and explains why', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const { result, approve } = await offer(EVENT_MSG, true);
    const note = "I've added it as an ordinary risk: a risk with a stated cause can't yet be modelled as an event that may happen.";
    expect(result.note).toContain(note);
    expect((result.risk as Record<string, unknown>).likelihood).toBeUndefined();
    await approveOffer(approve);
    const risk = newRisk()!;
    expect(risk.event_risk).toBeUndefined();
    const { hypothesisEdgeValue } = await import('../../routing/add-option-transaction.js');
    expect(graphNow().edges.find((e) => e.from === risk.id && e.to === 'goal_x')).toEqual(hypothesisEdgeValue(risk.id, 'goal_x', 'negative'));
    const { composeProposalReply } = await import('../proposal-reply.js');
    expect(composeProposalReply('propose_new_risk', { whole_request: true }, result, '')).toContain(note);
  }, 120_000);

  it('2a-door-hash-validation: occurrence is hashed and invalid blocks or drivers are refused before holding', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const { holdAddRiskInProcess } = await import('../../system-events/dispatch.js');
    const { readStatedEventRisk } = await import('../../routing/stated-event-risk.js');
    const input = { scenario_id: SCENARIO, base_graph_hash: await hashNow(), risk: { id: 'risk_competitive_response', label: 'Competitive response' },
      links: [{ to_id: 'goal_x', effect_direction: 'negative' as const }] };
    const turnA = randomUUID();
    const turnB = randomUUID();
    const blockA = readStatedEventRisk('10–30% within 6 months')!;
    const blockB = readStatedEventRisk('20–40% within 6 months')!;
    expect(await holdAddRiskInProcess({ ...input, turn_id: turnA, user_event_risk: blockA }, '2a-hash-a')).toMatchObject({ status: 'held' });
    expect(await holdAddRiskInProcess({ ...input, turn_id: turnB, user_event_risk: blockB }, '2a-hash-b')).toMatchObject({ status: 'held' });
    expect(rows.get(`${SCENARIO}:${turnA}`)!.request_hash).not.toBe(rows.get(`${SCENARIO}:${turnB}`)!.request_hash);
    const before = order.length;
    const malformed = { ...blockA, event_risk: { ...blockA.event_risk, horizon: { months: -1 } } };
    expect(await holdAddRiskInProcess({ ...input, turn_id: randomUUID(), user_event_risk: malformed }, '2a-invalid')).toMatchObject({ status: 'refused', reason: 'parameters_invalid' });
    expect(await holdAddRiskInProcess({ ...input, turn_id: randomUUID(), user_event_risk: blockA,
      links: [...input.links, { from_id: 'fac_price', effect_direction: 'positive' }] }, '2a-driver')).toMatchObject({ status: 'refused', reason: 'parameters_invalid' });
    expect(order.length).toBe(before);
    expect(newRisk()).toBeUndefined();
  }, 120_000);

  it.each(['malformed', 'wrong-id', 'driver'] as const)('2a-door-fail-closed-%s: corrupt member refuses the whole confirm', async (shape) => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    const { approve } = await offer(EVENT_MSG, shape === 'driver');
    const held = await heldOnLatestRow();
    const original = latestRow()!;
    const stored = original.pending_actions.find((p) => (p as { chip_id?: string }).chip_id === held[0]!.chip_id) as { action: { inline_patch: Record<string, unknown> } };
    const op = (stored.action.inline_patch.operations as { op: string; path: string }[]).find((o) => o.op === 'add_node')!;
    stored.action.inline_patch.user_event_risk = shape === 'malformed' ? { risk_id: op.path, event_risk: { ...EVENT, horizon: { months: -1 } }, quote }
      : { risk_id: shape === 'wrong-id' ? 'risk_wrong' : op.path, event_risk: EVENT, quote };
    const response = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(response._agent.tool_calls).not.toContainEqual(expect.objectContaining({ name: 'authorise_change', mutated: true }));
    expect(bytes()).toBe(before);
    expect(newRisk()).toBeUndefined();
  }, 120_000);
});
