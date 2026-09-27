/**
 * ⭐ SLICE C2 — THE AGENT REACHES THE PRODUCT'S OWN WRITERS FOR A NEW RISK AND A CHANGED LIMIT.
 *
 * Paul's served test (27 Sep, exports 90b8f080 / 08bf9a1f): he asked the Agent to add a "competitive response" risk;
 * it offered, he said "Yes.", it answered "no change awaiting approval", and five turns later admitted it cannot add a
 * risk. He said the budget rose to £30k; the Agent: "I can't update that budget constraint with the available model
 * actions". The product has writers for both; none was reachable by the Agent atomically (seam check #70 5855128799).
 *
 * Canonical State's ruling (#70 5855234599), pinned row by row:
 *   add-risk — ONE `gmh_` hold pinned to the base graph hash; confirm = the existing held resume, ONE commit under CAS;
 *     a refusal, decline or stale base leaves the stored graph BYTE-IDENTICAL; the node carries {id, kind, label} only;
 *     every link is `hypothesisEdgeValue` (placeholder, `defaulted`, `cee_hypothesis`), never `user_specified`; only
 *     factor→risk, risk→outcome, risk→goal — the DOOR refuses any other pair (never risk→factor).
 *   limit edit — only an EXISTING (node_id, operator) goal_constraints row on a non-option node; the row's value_frame
 *     and unit are kept; the new value is the user's (`provenance: 'explicit'`); stale base = nothing written.
 *
 * HARNESS: the same as `agent-add-option-held-seam.test.ts` — the REAL `ceeOrchestratorRouteV2` and the REAL
 * `agentV1TurnRoute` on one Fastify app, a stateful store with the production READ semantics that matter (pending
 * actions from the latest non-claim answer row, JSONB-key-reordered, through the REAL `parsePendingAction`), OpenAI
 * only; route-v2's LLM router throws if touched.
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

describe('SLICE C2 — the Agent reaches the product\'s own writers: a new risk (held) and a changed limit', () => {
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
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never) };
    });
    await app.register(ceeOrchestratorRouteV2);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; routerCalls.length = 0; });

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
  const refOf = async (targetKey: string) => {
    const { gmHeldProposalRef } = await import('../../handlers/edit-graph-referee-gate.js');
    return gmHeldProposalRef(SCENARIO, targetKey);
  };
  const newRisk = () => graphNow().nodes.find((x) => x.kind === 'risk' && x.label === 'Competitive response');
  const RISK_MSG = 'Add a competitive response risk: a price rise could provoke competitors, which lowers revenue.';
  const proposeRisk = (args: Record<string, unknown> = {}, message = RISK_MSG) => {
    script = [
      () => fnCall('propose_new_risk', {
        label: 'Competitive response',
        affects: [{ target_label: 'Revenue', direction: 'negative' }],
        caused_by: [{ factor_label: 'Price', direction: 'positive' }],
        rationale: 'The user asked for it.',
        ...args,
      }),
      () => say('I would add the risk "Competitive response", driven by Price and lowering Revenue. Shall I add it?'),
    ];
    return turn({ message });
  };

  it('CONTROL (passes at base): the seeded model and its Paul-shaped £20,000 limit are what the Agent is given; a question writes nothing', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    let given = '';
    script = [(body) => { given = JSON.stringify(body['input']); return say('Your spend limit is £20,000.'); }];
    await turn({ message: 'What is my spend limit?' });
    expect(given).toMatch(/CURRENT MODEL STATE/);
    expect(given).toContain('20000');
    expect(bytes()).toBe(before);
  }, 120_000);

  // ── add-risk ─────────────────────────────────────────────────────────────

  it('(1) RED: propose → exactly ONE live held hold keyed node:<risk id>; add_node {id,kind,label} first, then one hypothesis link each (cee_hypothesis + defaulted, never user_specified, never into a factor); stored graph unchanged; one approve chip', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    const t1 = await proposeRisk();
    const call = t1._agent.tool_calls.find((c) => c.name === 'propose_new_risk');
    expect(call, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    const held = await heldOnLatestRow();
    expect(held, 'exactly ONE live hold').toHaveLength(1);
    const ops = held[0]!.action.inline_patch!.operations!;
    expect(ops[0]!.op, JSON.stringify(ops)).toBe('add_node');
    const riskId = ops[0]!.path;
    expect(held[0]!.chip_id).toBe(await refOf(`node:${riskId}`));
    expect(call!.proposal_id).toBe(held[0]!.chip_id);
    // The node carries no CEE-owned field.
    expect(Object.keys(ops[0]!.value!).sort()).toEqual(['id', 'kind', 'label']);
    expect(ops[0]!.value).toEqual({ id: riskId, kind: 'risk', label: 'Competitive response' });
    const links = ops.slice(1);
    expect(links.map((o) => o.op)).toEqual(['add_edge', 'add_edge']);
    expect(links.map((o) => o.path).sort()).toEqual([`${riskId}::goal_x`, `fac_price::${riskId}`].sort());
    for (const o of links) {
      expect((o.value!['provenance'] as { source?: unknown }).source, JSON.stringify(o)).toBe('cee_hypothesis');
      expect(o.value!['defaulted'], JSON.stringify(o)).toBe(true);
      expect(JSON.stringify(o.value)).not.toContain('user_specified');
    }
    expect(links.find((o) => o.path === `${riskId}::goal_x`)!.value!['effect_direction']).toBe('negative');
    expect(links.some((o) => o.path.startsWith(`${riskId}::fac_`)), 'never risk → factor').toBe(false);
    expect(bytes(), 'nothing is written before the approval').toBe(before);
    expect(newRisk()).toBeUndefined();
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1.suggested_actions)).toBe(`agent-approve-proposal:${held[0]!.chip_id}`);
    expect(t1.suggested_actions.filter((c) => c.id.startsWith('agent-approve-proposal:')), 'ONE approve chip').toHaveLength(1);
    expect(routerCalls).toEqual([]);
  }, 120_000);

  it('(2) RED: approve → ONE graph-bearing row; the hash moves once; the risk and every link are present', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeRisk();
    const approve = approveChipOf(t1)!;
    expect(approve, JSON.stringify(t1._agent.tool_calls)).toBeDefined();
    const hashBefore = await hashNow();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const calls = openAiCalls;
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(openAiCalls - calls, 'a typed approval makes no model call').toBe(0);
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect((graphWrites.get(SCENARIO) ?? 0) - writesBefore, 'ONE graph-bearing row').toBe(1);
    expect(await hashNow()).not.toBe(hashBefore);
    const risk = newRisk();
    expect(risk, JSON.stringify(graphNow().nodes)).toBeDefined();
    const g = graphNow();
    expect(g.edges.some((e) => e.from === 'fac_price' && e.to === risk!.id)).toBe(true);
    expect(g.edges.some((e) => e.from === risk!.id && e.to === 'goal_x')).toBe(true);
    // ⭐ A6b (DL #70 5855437928): the STORED risk the user approved is theirs — `user_set`, CEE's stamp at the
    // approval seam; the factor it is driven by and the goal it threatens are not.
    expect(risk!['provenance'], 'the approved risk').toBe('user_set');
    expect(g.nodes.find((x) => x.id === 'fac_price')!['provenance'], 'the factor that drives it').toBeUndefined();
    expect(g.nodes.find((x) => x.id === 'goal_x')!['provenance'], 'the goal it threatens').toBeUndefined();
    expect(await heldOnLatestRow(), 'the hold is consumed').toEqual([]);
    expect(t2.assistant_text, t2.assistant_text).toContain('Added "Competitive response" as a risk, affecting "Revenue" and driven by "Price"');
    expect(t2.assistant_text, t2.assistant_text).toMatch(/placeholder strength, not an estimate/);
    expect(routerCalls).toEqual([]);
  }, 120_000);

  it('(3) RED: declined, then left to expire → the stored graph stays BYTE-IDENTICAL, and the old button then writes nothing', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    const t1 = await proposeRisk();
    const approve = approveChipOf(t1)!;
    expect(approve, JSON.stringify(t1._agent.tool_calls)).toBeDefined();
    script = [() => say('Understood, I will leave it out.')];
    await turn({ message: 'No, leave that risk out.' });
    expect(bytes(), 'a decline writes nothing').toBe(before);
    for (let i = 0; i < 8 && (await heldOnLatestRow()).length > 0; i += 1) {
      script = [() => say('Price drives revenue.')];
      await turn({ message: 'What drives revenue?' });
    }
    expect(await heldOnLatestRow(), 'the hold expired').toEqual([]);
    expect(bytes()).toBe(before);
    const late = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(late._agent.tool_calls[0], JSON.stringify(late._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false }));
    expect(bytes(), 'an expired hold writes nothing').toBe(before);
    expect(newRisk()).toBeUndefined();
  }, 180_000);

  it('(4) RED: the model moves before the approval → refused, nothing written; and the door itself refuses a stale base with nothing held', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeRisk())!;
    expect(approve).toBeDefined();
    const g = graphNow();
    graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'opt_b' ? { ...x, interventions: { fac_price: { value: 0.3, raw_value: 60, unit: 'GBP' } } } : x)) });
    const moved = bytes();
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false }));
    expect(bytes(), 'nothing written').toBe(moved);
    expect(newRisk()).toBeUndefined();

    // The door: a base hash that is not the stored model's → stale, no row, nothing held.
    const { holdAddRiskInProcess } = await import('../../system-events/dispatch.js');
    const rowsBefore = order.length;
    const r = await holdAddRiskInProcess({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: 'ffffffffffffffff',
      risk: { label: 'Supplier failure' }, links: [{ to_id: 'goal_x', effect_direction: 'negative' }] }, 'req-stale');
    expect(r).toEqual({ status: 'stale' });
    expect(order.length, 'no row appended').toBe(rowsBefore);
    expect(bytes()).toBe(moved);
  }, 120_000);

  it('(5) RED: a risk INTO a factor is refused by the proposer in plain words and by the DOOR itself — nothing held, nothing written', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    let out: Record<string, unknown> = {};
    script = [
      () => fnCall('propose_new_risk', { label: 'Competitive response', affects: [{ target_label: 'Price', direction: 'negative' }], rationale: 'x' }),
      (body) => { out = toolOutputIn(body); return say('A risk affects the goal or an outcome, not a factor directly.'); },
    ];
    const t1 = await turn({ message: 'Add a competitive response risk that pushes our price down.' });
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_new_risk'), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false }));
    expect(String(out['detail']), JSON.stringify(out)).toContain('a risk affects the goal or an outcome, not a factor directly');
    expect(approveChipOf(t1)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);

    // The door refuses the pair on its own — it does not rely on the proposer or the validator.
    const { holdAddRiskInProcess } = await import('../../system-events/dispatch.js');
    const rowsBefore = order.length;
    const r = await holdAddRiskInProcess({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(),
      risk: { label: 'Competitive response' },
      links: [{ to_id: 'goal_x', effect_direction: 'negative' }, { to_id: 'fac_price', effect_direction: 'negative' }] }, 'req-pair');
    expect(r).toEqual(expect.objectContaining({ status: 'refused', reason: 'kind_pair_not_allowed' }));
    expect(order.length, 'no row appended').toBe(rowsBefore);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('(6) a DEAD-END risk (what it hurts never reaches the goal) is refused, and the refusal NAMES the missing link type — risk → goal — nothing held', async () => {
    const g = seedGraph();
    graphOf.set(SCENARIO, { ...g, nodes: [...g.nodes, { id: 'out_trust', kind: 'outcome', label: 'Brand trust' }] });
    const before = bytes();
    let out: Record<string, unknown> = {};
    script = [
      () => fnCall('propose_new_risk', { label: 'Competitive response', affects: [{ target_label: 'Brand trust', direction: 'negative' }], rationale: 'x' }),
      (body) => { out = toolOutputIn(body); return say('That risk would not reach the goal as the model stands.'); },
    ];
    const t1 = await turn({ message: 'Add a competitive response risk that would damage brand trust.' });
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_new_risk'), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false }));
    expect(out['reason'], JSON.stringify(out)).toBe('risk_unreachable');
    const detail = String(out['detail']);
    expect(detail, detail).toContain('The missing link is risk → goal');
    expect(detail).toContain('"Brand trust" does not lead to "Revenue"');
    expect(detail).toContain('propose it again with "Revenue" in affects');
    // The outcome → goal link is not an Agent move: named as the canvas's, never offered.
    expect(detail).toMatch(/added on the canvas, not here — never offer to add it/);
    expect(approveChipOf(t1)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
  }, 120_000);

  // ── limit edit ───────────────────────────────────────────────────────────

  const spendRows = () => (graphNow().goal_constraints ?? []).filter((c) => c['node_id'] === SPEND);
  const proposeLimit = (args: Record<string, unknown> = {}, message = 'Our six-month decision spend limit has gone up: it is now £30,000.') => {
    script = [
      () => fnCall('propose_limit_change', { limit_label: 'Six-month decision spend', operator: '<=', new_value: 30000, rationale: 'The user raised it.', ...args }),
      () => say('I would change the limit on six-month decision spend from £20,000 to £30,000. Shall I?'),
    ];
    return turn({ message });
  };

  it('(7) RED: "£20,000 → £30,000" on the Paul-shaped row → approve → ONE <= row, same constraint_id, 30000, GBP, value_frame kept, stamped as the user\'s', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeLimit();
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:prop_[0-9a-f]+$/);
    expect(spendRows()[0]!['value'], 'nothing written before the approval').toBe(20000);
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect((graphWrites.get(SCENARIO) ?? 0) - writesBefore, 'ONE graph-bearing row').toBe(1);
    const rowsNow = spendRows();
    expect(rowsNow, JSON.stringify(graphNow().goal_constraints)).toHaveLength(1);
    expect(rowsNow[0]).toEqual(expect.objectContaining({
      constraint_id: 'gc-spend-1', operator: '<=', value: 30000, unit: 'GBP', value_frame: 'level',
      label: 'Six-month decision spend', provenance: 'explicit',
    }));
    // The goal's own row is untouched.
    expect((graphNow().goal_constraints ?? []).find((c) => c['constraint_id'] === 'gc-goal-1')).toEqual(seedGraph().goal_constraints![1]);
    expect(t2.assistant_text, t2.assistant_text).toMatch(/£30,000/);
  }, 120_000);

  it('(7b) Paul\'s own words "£30k" ground the figure', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeLimit({}, 'The budget rose to £30k.');
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_limit_change'), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true }));
  }, 120_000);

  it('(8) RED: the model moves before the approval → nothing written; and the DOOR refuses a stale base as stale, byte-identical', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeLimit())!;
    expect(approve).toBeDefined();
    const g = graphNow();
    graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'opt_b' ? { ...x, interventions: { fac_price: { value: 0.3, raw_value: 60, unit: 'GBP' } } } : x)) });
    const moved = bytes();
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false }));
    expect(bytes()).toBe(moved);

    const { commitLimitEditInProcess } = await import('../../system-events/dispatch.js');
    const rowsBefore = order.length;
    const r = await commitLimitEditInProcess({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: 'ffffffffffffffff',
      node_id: SPEND, operator: '<=', raw_value: 30000 }, 'req-stale-limit');
    expect(r).toEqual({ status: 'stale' });
    expect(order.length, 'no row appended').toBe(rowsBefore);
    expect(bytes()).toBe(moved);
  }, 120_000);

  it('(9) RED: a GOAL is refused on this path — by the proposer (pointing at the target tool) and by the door — nothing written', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    let out: Record<string, unknown> = {};
    script = [
      () => fnCall('propose_limit_change', { limit_label: 'Revenue', operator: '>=', new_value: 70000, rationale: 'x' }),
      (body) => { out = toolOutputIn(body); return say('That is the goal\'s target.'); },
    ];
    const t1 = await turn({ message: 'Revenue must now reach at least £70,000.' });
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_limit_change'), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false }));
    expect(String(out['detail']), JSON.stringify(out)).toContain('propose_goal_target');
    expect(approveChipOf(t1)).toBeUndefined();

    const { commitLimitEditInProcess } = await import('../../system-events/dispatch.js');
    const rowsBefore = order.length;
    const r = await commitLimitEditInProcess({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(),
      node_id: 'goal_x', operator: '>=', raw_value: 70000 }, 'req-goal');
    expect(r).toEqual(expect.objectContaining({ status: 'refused', reason: 'target_is_goal' }));
    expect(order.length).toBe(rowsBefore);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('(10) RED: a figure the user did not write is refused in plain words — nothing prepared, no button', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    let out: Record<string, unknown> = {};
    script = [
      () => fnCall('propose_limit_change', { limit_label: 'Six-month decision spend', operator: '<=', new_value: 30000, rationale: 'x' }),
      (body) => { out = toolOutputIn(body); return say('What should the new limit be?'); },
    ];
    const t1 = await turn({ message: 'Raise the spend limit a bit.' });
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_limit_change'), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, refusal: 'figure_not_stated' }));
    expect(String(out['detail'])).toMatch(/not a figure the user wrote/);
    expect(approveChipOf(t1)).toBeUndefined();
    expect(bytes()).toBe(before);
  }, 120_000);

  it('(11) a limit that does not exist is not created on this path (only an existing row is changed)', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const { commitLimitEditInProcess } = await import('../../system-events/dispatch.js');
    const before = bytes();
    const r = await commitLimitEditInProcess({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(),
      node_id: SPEND, operator: '>=', raw_value: 5000 }, 'req-none');
    expect(r).toEqual(expect.objectContaining({ status: 'refused', reason: 'no_existing_limit' }));
    const r2 = await commitLimitEditInProcess({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(),
      node_id: 'opt_a', operator: '<=', raw_value: 5000 }, 'req-option');
    expect(r2).toEqual(expect.objectContaining({ status: 'refused', reason: 'target_is_option' }));
    expect(bytes()).toBe(before);
  }, 120_000);

  /**
   * Canonical 5856206675 F1: the pricing example's REAL NRR row, stored as a FRACTION (1.1, shown as 110%). The writer
   * stores the figure as given, in the row's unit, and `figureTheUserWrote` accepts 115 for "115%": without the check,
   * "at least 115%" lands as 115 'fraction' — 11,500%. Refused by the proposer AND the door; the stored graph is
   * byte-identical. The percent → fraction conversion is A3's (unit/frame), not this path's.
   */
  const NRR_ROW = {
    constraint_id: 'constraint_out_nrr_min', node_id: 'out_nrr', operator: '>=', value: 1.1, unit: 'fraction',
    label: 'net revenue retention floor', source_quote: 'net revenue retention above 110%', provenance: 'explicit',
    provenance_unit_normalised: { rule: 'percent_to_fraction', original_value: 110, original_unit: '%' },
  };
  const nrrGraph = (): G => {
    const g = seedGraph();
    return {
      ...g,
      nodes: [...g.nodes, { id: 'out_nrr', kind: 'outcome', label: 'Net revenue retention' }],
      edges: [...g.edges, { from: 'out_nrr', to: 'goal_x', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
      goal_constraints: [...(g.goal_constraints ?? []), NRR_ROW],
    };
  };

  it('(12) RED: "NRR at least 115%" on a row stored as a FRACTION is refused by the proposer in plain words — nothing prepared, no button, byte-identical', async () => {
    graphOf.set(SCENARIO, nrrGraph());
    const before = bytes();
    let out: Record<string, unknown> = {};
    script = [
      () => fnCall('propose_limit_change', { limit_label: 'Net revenue retention', operator: '>=', new_value: 115, rationale: 'x' }),
      (body) => { out = toolOutputIn(body); return say('That limit cannot be changed here.'); },
    ];
    const t1 = await turn({ message: 'Make net revenue retention at least 115%.' });
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_limit_change'), JSON.stringify(t1._agent.tool_calls))
      .toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'limit_stored_as_fraction' }));
    expect(String(out['detail']), JSON.stringify(out)).toContain('stored as a fraction');
    expect(approveChipOf(t1)).toBeUndefined();
    expect(bytes()).toBe(before);
  }, 120_000);

  it('(12b) RED: the DOOR refuses the fraction row on its own — no row appended, byte-identical (never 115 as a fraction)', async () => {
    graphOf.set(SCENARIO, nrrGraph());
    const before = bytes();
    const { commitLimitEditInProcess } = await import('../../system-events/dispatch.js');
    const rowsBefore = order.length;
    const r = await commitLimitEditInProcess({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(),
      node_id: 'out_nrr', operator: '>=', raw_value: 115 }, 'req-nrr');
    expect(r).toEqual(expect.objectContaining({ status: 'refused', reason: 'limit_stored_as_fraction' }));
    expect(order.length, 'no row appended').toBe(rowsBefore);
    expect(bytes()).toBe(before);
    expect((graphNow().goal_constraints ?? []).find((c) => c['constraint_id'] === 'constraint_out_nrr_min')).toEqual(NRR_ROW);
  }, 120_000);

  it('(13) the % row: an edit 4% → 5% keeps the unit and DROPS the old unit audit — no stale "original 4" survives the new figure', async () => {
    const g = seedGraph();
    const churnRow = {
      constraint_id: 'gc-churn-1', node_id: 'fac_churn', operator: '<=', value: 4, unit: '%', value_frame: 'level',
      label: 'Monthly churn', provenance: 'explicit',
      provenance_unit_relabelled: { rule: 'percent_word_to_symbol', pre_normalisation_value: 4, pre_normalisation_unit: 'percent per month' },
    };
    graphOf.set(SCENARIO, {
      ...g,
      nodes: [...g.nodes, { id: 'fac_churn', kind: 'factor', label: 'Monthly churn', category: 'external', observed_state: { value: 0.04, raw_value: 4, unit: '%', cap: 100 } }],
      edges: [...g.edges, { from: 'fac_churn', to: 'goal_x', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' }],
      goal_constraints: [...(g.goal_constraints ?? []), churnRow],
    });
    const { commitLimitEditInProcess } = await import('../../system-events/dispatch.js');
    const r = await commitLimitEditInProcess({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(),
      node_id: 'fac_churn', operator: '<=', raw_value: 5 }, 'req-churn');
    expect(r, JSON.stringify(r)).toEqual(expect.objectContaining({ status: 'committed' }));
    const written = (graphNow().goal_constraints ?? []).filter((c) => c['node_id'] === 'fac_churn');
    expect(written, JSON.stringify(graphNow().goal_constraints)).toHaveLength(1);
    expect(written[0]).toEqual(expect.objectContaining({ constraint_id: 'gc-churn-1', value: 5, unit: '%', value_frame: 'level', provenance: 'explicit' }));
    expect(Object.keys(written[0]!).filter((k) => k.startsWith('provenance_unit_')), JSON.stringify(written[0])).toEqual([]);
  }, 120_000);
});
