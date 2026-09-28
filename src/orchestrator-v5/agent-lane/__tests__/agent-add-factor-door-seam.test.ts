/**
 * ⭐ PJ-E-FIG — THE AGENT ADDS NEW FACTORS WITH THE FIGURES THE USER STATED, HELD ON THE PRODUCT'S OWN SEAM.
 * Ruling: Delivery Lead #72 5866036457, on Canonical 5866021645 — the TWIN of the add-risk door
 * (`agent-writer-doors-seam.test.ts` rows (1)–(6), whose harness this file copies).
 *
 * Journey E's user says "Senior engineers cost £120k a year each and juniors £65k a year each." Before this door the
 * Agent had no path: the figures were never held on typed factors. Pinned row by row:
 *   (a) ONE call carries both factors → ONE `gmh_` hold → ONE approval → ONE commit whose graph has both factors, each
 *       with `observed_state` {raw_value, value, cap: Olumi's default range, declared_scale, unit, source: the user's}
 *       and ONE placeholder link (`hypothesisEdgeValue`) to its target; each range is disclosed ONCE
 *       (`ranges_added_for_analysis`); the spend factor and its £400k limit are untouched.
 *   (a′) the same on journey E's SERVED draft graph, where "Annual salary spend" is a lever the options set (refused as a
 *       target, byte-identical) and the outcome takes the link.
 *   (b) a figure the user did not write → refused and said, nothing held, byte-identical (all-or-nothing);
 *   (c) the model moves before the approval → refused, byte-identical; the door itself refuses a stale base;
 *   (d) a decline (and the hold's expiry) → byte-identical;
 *   (e) a link into an option → refused by the proposer AND by the door;
 *   (f) a negative or non-number figure → refused;
 *   (g) a label the model already has → refused, naming the tool that sets an existing factor's value.
 *   (l)–(n) DL CHANGES_REQUIRED on #2235 (1): a figure is the user's for THIS factor only where they wrote it about it —
 *       the two figures swapped, or the £400k limit typed in the same message, are refused; the correct pairing holds —
 *       including journey E's own typed E04 clarification, in "£120,000" and "£120k" (DL re-review, 13:07Z, blocking);
 *   (o) DL ruling (b): two figures no label word owns are refused for every factor (fail closed), never credited.
 *
 * ⛔ SOURCE. The ruling's `user_specified` is not a legal `ObservedStateV3.source` (see `add-factor-transaction.test.ts`
 * S0); the door stamps `USER_EDIT_SOURCE`, the product's literal for a figure the user typed in chat.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `7c2f3e4d-5c6b-4a7f-8e8d-9c0b1f2a4e${String(n).padStart(2, '0')}`; };

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
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the add-factor door (${what})`); };
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
type Body = { assistant_text: string; suggested_actions: Chip[]; _agent: { tool_calls: Call[]; state_facts?: { ranges_added?: { factor: string; range: number }[] } } };
type G = { nodes: { id: string; kind: string; label: string; [k: string]: unknown }[]; edges: { from: string; to: string; [k: string]: unknown }[]; goal_constraints?: Record<string, unknown>[] };

const SPEND = 'annual_salary_spend';
const UNIT = 'GBP/year per engineer';
const FIG_MSG = 'Senior engineers cost £120k a year each and juniors £65k a year each.';
/**
 * Journey E's shape, runnable: a hiring decision, the goal, an outcome that reaches it, the two headcount levers the
 * options set, and "Annual salary spend" (GBP/year) — here an EXTERNAL factor the headcounts drive (so a factor may link
 * into it) — with the user's £400k limit on it.
 */
const seedGraph = (): G => {
  const e = (from: string, to: string, mean = 0.5, dir: 'positive' | 'negative' = 'positive') =>
    ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: dir });
  return {
    nodes: [
      { id: 'dec_hire', kind: 'decision', label: 'Choose a hiring plan' },
      { id: 'goal_ship', kind: 'goal', label: 'Ship the new platform', goal_threshold: 0.8 },
      { id: 'out_capacity', kind: 'outcome', label: 'Delivery capacity' },
      { id: 'fac_seniors', kind: 'factor', label: 'New senior engineers hired', category: 'controllable', observed_state: { value: 0, raw_value: 0, unit: 'engineers', cap: 20 } },
      { id: 'fac_juniors', kind: 'factor', label: 'New junior engineers hired', category: 'controllable', observed_state: { value: 0, raw_value: 0, unit: 'engineers', cap: 30 } },
      { id: SPEND, kind: 'factor', label: 'Annual salary spend', category: 'external', observed_state: { value: 0.3, raw_value: 300000, unit: 'GBP/year', cap: 1000000 } },
      { id: 'risk_budget', kind: 'risk', label: 'Budget cap breach risk' },
      { id: 'opt_seniors', kind: 'option', label: 'Hire two senior engineers', interventions: { fac_seniors: { value: 0.1, raw_value: 2, unit: 'engineers' } } },
      { id: 'opt_juniors', kind: 'option', label: 'Hire four junior engineers', interventions: { fac_juniors: { value: 0.1333, raw_value: 4, unit: 'engineers' } } },
    ],
    edges: [e('dec_hire', 'opt_seniors', 1), e('dec_hire', 'opt_juniors', 1), e('opt_seniors', 'fac_seniors', 1), e('opt_juniors', 'fac_juniors', 1),
      e('fac_seniors', 'out_capacity'), e('fac_juniors', 'out_capacity'), e('fac_seniors', SPEND), e('fac_juniors', SPEND),
      e(SPEND, 'risk_budget'), e('risk_budget', 'out_capacity', 0.3, 'negative'), e('out_capacity', 'goal_ship')],
    goal_constraints: [
      { constraint_id: 'gc-spend-1', node_id: SPEND, operator: '<=', value: 400000, unit: 'GBP/year', value_frame: 'level',
        label: 'Annual salary spend', provenance: 'explicit', source_quote: 'keep annual salary spend under £400k' },
    ],
  };
};
const journeyE = (): G => JSON.parse(readFileSync(new URL('./fixtures/journey-e-e07-draft-graph.json', import.meta.url), 'utf8')) as G;

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
/** The tool output the model was handed on its NEXT call (the last function_call_output in its input). */
const toolOutputIn = (body: Record<string, unknown>): Record<string, unknown> => {
  const out = (body['input'] as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output').at(-1);
  return JSON.parse(String(out?.output ?? '{}')) as Record<string, unknown>;
};

describe('PJ-E-FIG — the Agent adds new factors with the user\'s figures, held on the product\'s own seam (the add-risk door\'s twin)', () => {
  let app: FastifyInstance;
  let USER_SOURCE = '';
  let GM_HELD_USER_TODAY = '';
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
    USER_SOURCE = (await import('../../../orchestrator/canonicalise-value-ops.js')).USER_EDIT_SOURCE;
    GM_HELD_USER_TODAY = (await import('../../routing/add-factor-transaction.js')).GM_HELD_USER_TODAY_KEY;
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const id = (req.params as { id: string }).id;
      const g = graphOf.get(id) ?? null;
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
    const pendings = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; action: { kind: string; inline_patch?: { handler_id?: string; operations?: { op: string; path: string; value?: Record<string, unknown> }[]; [k: string]: unknown } } }[];
    return pendings.filter((p) => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };
  const refOf = async (targetKey: string) => {
    const { gmHeldProposalRef } = await import('../../handlers/edit-graph-referee-gate.js');
    return gmHeldProposalRef(SCENARIO, targetKey);
  };
  const newFactors = () => graphNow().nodes.filter((x) => x.kind === 'factor' && /engineer salary$/.test(x.label));
  const factorArgs = (over: Record<string, unknown>[] = [], target = 'Annual salary spend') => [
    { label: 'Senior engineer salary', unit: UNIT, today: { value: 120000 }, affects: target, direction: 'positive', ...(over[0] ?? {}) },
    { label: 'Junior engineer salary', unit: UNIT, today: { value: 65000 }, affects: target, direction: 'positive', ...(over[1] ?? {}) },
  ];
  /** The Agent's call, then (when it is not composed) its reply; `seen` receives the tool output it was handed. */
  const propose = (factors: unknown, message = FIG_MSG, seen?: (out: Record<string, unknown>) => void) => {
    script = [
      () => fnCall('propose_new_factor', { factors, rationale: 'The user stated both salaries.' }),
      (body) => { seen?.(toolOutputIn(body)); return say('I would add both salaries as factors, as you gave them. Shall I?'); },
    ];
    return turn({ message });
  };
  const callOf = (b: Body) => b._agent.tool_calls.find((c) => c.name === 'propose_new_factor');

  it('CONTROL (passes at base): the seeded model and its £400k limit are what the Agent is given; a question writes nothing', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    let given = '';
    script = [(body) => { given = JSON.stringify(body['input']); return say('Your salary limit is £400,000.'); }];
    await turn({ message: 'What is my salary limit?' });
    expect(given).toMatch(/CURRENT MODEL STATE/);
    expect(given).toContain('400000');
    expect(bytes()).toBe(before);
  }, 120_000);

  it('(a) RED: ONE call, both figures → ONE hold → approve → ONE commit with both factors as the user\'s figures on Olumi\'s ranges, ONE placeholder link each, the ranges said once; spend + limit untouched', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    const spendBefore = JSON.stringify(graphNow().nodes.find((x) => x.id === SPEND));
    const limitBefore = JSON.stringify(graphNow().goal_constraints);
    const t1 = await propose(factorArgs());
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    const held = await heldOnLatestRow();
    expect(held, 'exactly ONE live hold').toHaveLength(1);
    const ops = held[0]!.action.inline_patch!.operations!;
    expect(ops.map((o) => o.op), JSON.stringify(ops)).toEqual(['add_node', 'add_node', 'add_edge', 'add_edge']);
    const [senior, junior] = [ops[0]!.path, ops[1]!.path];
    expect(held[0]!.chip_id).toBe(await refOf(`node:${senior}`));
    expect(callOf(t1)!.proposal_id).toBe(held[0]!.chip_id);
    // The ops carry no value (R4): {id, kind, label, category} only.
    expect(ops[0]!.value).toEqual({ id: senior, kind: 'factor', label: 'Senior engineer salary', category: 'external' });
    expect(ops[1]!.value).toEqual({ id: junior, kind: 'factor', label: 'Junior engineer salary', category: 'external' });
    expect(ops.slice(2).map((o) => o.path)).toEqual([`${senior}::${SPEND}`, `${junior}::${SPEND}`]);
    for (const o of ops.slice(2)) {
      expect((o.value!['provenance'] as { source?: unknown }).source).toBe('cee_hypothesis');
      expect(o.value!['defaulted']).toBe(true);
    }
    expect(JSON.stringify(ops)).not.toContain('user_specified');
    expect(bytes(), 'nothing is written before the approval').toBe(before);
    expect(t1.suggested_actions.filter((c) => c.id.startsWith('agent-approve-proposal:')), 'ONE approve chip').toHaveLength(1);

    const approve = approveChipOf(t1)!;
    const hashBefore = await hashNow();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const calls = openAiCalls;
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(openAiCalls - calls, 'a typed approval makes no model call').toBe(0);
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect((graphWrites.get(SCENARIO) ?? 0) - writesBefore, 'ONE graph-bearing row').toBe(1);
    expect(await hashNow()).not.toBe(hashBefore);
    const g = graphNow();
    const node = (id: string) => g.nodes.find((x) => x.id === id)!;
    expect(node(senior)['observed_state']).toEqual({ value: 0.12, raw_value: 120000, cap: 1000000, declared_scale: 'unit_interval', unit: UNIT, source: USER_SOURCE });
    expect(node(junior)['observed_state']).toEqual({ value: 0.65, raw_value: 65000, cap: 100000, declared_scale: 'unit_interval', unit: UNIT, source: USER_SOURCE });
    const { hypothesisEdgeValue } = await import('../../routing/add-option-transaction.js');
    for (const id of [senior, junior]) {
      expect(node(id)['provenance'], 'no node-level field beyond the value').toBeUndefined();
      const out = g.edges.filter((e) => e.from === id);
      expect(out, JSON.stringify(out)).toHaveLength(1);
      expect(out[0]).toMatchObject(hypothesisEdgeValue(id, SPEND, 'positive'));
      expect(g.edges.filter((e) => e.to === id), 'links go from the new factor only').toHaveLength(0);
    }
    // Key-order-insensitive (the store reorders keys as JSONB does): the same members, the same values.
    expect(g.nodes.find((x) => x.id === SPEND), 'the spend factor is untouched').toEqual(JSON.parse(spendBefore));
    expect(g.goal_constraints, 'the £400k limit is untouched').toEqual(JSON.parse(limitBefore));
    expect(await heldOnLatestRow(), 'the hold is consumed').toEqual([]);
    // The range is Olumi's, said ONCE — on the turn it is written.
    expect(t2._agent.state_facts?.ranges_added, JSON.stringify(t2._agent)).toEqual([
      { factor: 'Senior engineer salary', range: 1000000 }, { factor: 'Junior engineer salary', range: 100000 },
    ]);
    expect(t2.assistant_text, t2.assistant_text).toContain('Added "Senior engineer salary"');
    expect(t2.assistant_text, t2.assistant_text).toMatch(/120000 GBP\/year per engineer, as you said/);
    expect(t2.assistant_text, t2.assistant_text).toMatch(/65000 GBP\/year per engineer, as you said/);
    expect(t2.assistant_text, 'never asked again for a figure the user gave').not.toMatch(/tell me (?:the|its|their) (?:figure|value)/i);
    expect(routerCalls).toEqual([]);
  }, 180_000);

  it('(a′) RED on journey E\'s SERVED graph: "Annual salary spend" is a lever the options set → refused, byte-identical; linked to the outcome → both figures committed as the user\'s', async () => {
    graphOf.set(SCENARIO, journeyE());
    const before = bytes();
    let out: Record<string, unknown> = {};
    const t0 = await propose(factorArgs(), FIG_MSG, (o) => { out = o; });
    expect(callOf(t0), JSON.stringify(t0._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'target_is_a_lever' }));
    expect(String(out['detail']), JSON.stringify(out)).toContain('"Annual salary spend" is set by the options');
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);

    const t1 = await propose(factorArgs([], 'Incremental platform delivery…'));
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    const approve = approveChipOf(t1)!;
    expect(approve, JSON.stringify(t1.suggested_actions)).toBeDefined();
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const figs = newFactors().map((f) => f['observed_state'] as Record<string, unknown>);
    expect(figs.map((o) => [o['raw_value'], o['source']]).sort(), JSON.stringify(figs)).toEqual([[120000, USER_SOURCE], [65000, USER_SOURCE]].sort());
    const g = graphNow();
    const e07 = journeyE();
    expect(g.nodes.find((x) => x.id === SPEND), 'the spend lever is untouched').toEqual(e07.nodes.find((x) => x.id === SPEND));
    expect(g.goal_constraints, 'the £400k limit is untouched').toEqual(e07.goal_constraints);
  }, 180_000);

  it('(h) C1: with whole_request the reply is composed from the result — ONE model call — and names both figures as the user\'s before they approve', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const calls = openAiCalls;
    script = [() => fnCall('propose_new_factor', { factors: factorArgs(), rationale: 'The user stated both salaries.', whole_request: true })];
    const t1 = await turn({ message: FIG_MSG });
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(openAiCalls - calls, 'one model call, no narrating call').toBe(1);
    expect(t1.assistant_text, t1.assistant_text).toMatch(/Senior engineer salary’ is £?120,?000/);
    expect(t1.assistant_text, t1.assistant_text).toMatch(/Junior engineer salary’ is £?65,?000/);
    expect(t1.assistant_text).toMatch(/placeholder strength/);
    expect(t1.assistant_text).not.toMatch(/propose_new_factor|gmh_/);
    expect(approveChipOf(t1), 'the approve chip is offered').toBeDefined();
  }, 120_000);

  it('(k) RED (F4): figures the user typed in an EARLIER message are not this message\'s words → refused and said, nothing held, byte-identical', async () => {
    graphOf.set(SCENARIO, seedGraph());
    await turn({ message: FIG_MSG });
    const before = bytes();
    let out: Record<string, unknown> = {};
    const t2 = await propose(factorArgs(), 'Add those two to the model.', (o) => { out = o; });
    expect(callOf(t2), JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'today_not_set' }));
    expect(String(JSON.stringify(out)), JSON.stringify(out)).toContain('in this message');
    expect(approveChipOf(t2)).toBeUndefined();
    expect(bytes()).toBe(before);
    expect(newFactors()).toEqual([]);
  }, 120_000);

  // ⛔ DL CHANGES_REQUIRED on #2235 (1): a figure is the user's for THIS factor only where they wrote it ABOUT it. The
  // unscoped matcher asked only whether the figure is somewhere in the message, so a swap and the £400k limit passed.
  const CONJOINED = 'Seniors are £120k a year and juniors £65k a year, with a £400k salary budget.';
  // ⛔ DL re-review of #2235 (13:07Z), BLOCKING: journey E's OWN typed clarification (served, `source: composer`, pj E04/E06).
  const E04 = 'Record them as annual salaries: £120,000 per senior engineer and £65,000 per junior engineer.';
  const E04_K = 'Record them as annual salaries: £120k per senior engineer and £65k per junior engineer.';
  it.each([
    ['the seeded model', FIG_MSG, 'seed'],
    ['journey E\'s served graph', FIG_MSG, 'e07'],
    ['journey E\'s served graph, "…a year and juniors…"', CONJOINED, 'e07'],
    ['journey E\'s served graph, E04 "£120,000 per senior engineer and £65,000 per junior engineer"', E04, 'e07'],
    ['journey E\'s served graph, E04 in "£120k … £65k"', E04_K, 'e07'],
  ] as const)('(l) RED: on %s, the two figures SWAPPED (senior 65000, junior 120000) → refused today_not_set naming both, nothing held, byte-identical', async (_what, message, which) => {
    graphOf.set(SCENARIO, which === 'seed' ? seedGraph() : journeyE());
    const target = which === 'seed' ? 'Annual salary spend' : 'Incremental platform delivery…';
    const before = bytes();
    let out: Record<string, unknown> = {};
    const t1 = await propose(factorArgs([{ today: { value: 65000 } }, { today: { value: 120000 } }], target), message, (o) => { out = o; });
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'today_not_set' }));
    expect((out['today_not_set'] as { factor: string }[]).map((x) => x.factor).sort(), JSON.stringify(out)).toEqual(['Junior engineer salary', 'Senior engineer salary']);
    expect(approveChipOf(t1)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
    expect(newFactors()).toEqual([]);
  }, 120_000);

  it.each([
    ['the seeded model', 'Senior engineers cost £120k a year each and juniors £65k a year each, and annual salary spend must stay under £400k.', 'seed'],
    ['journey E\'s served graph', 'Senior engineers cost £120k a year each and juniors £65k a year each, and our salary budget is £400k.', 'e07'],
  ] as const)('(m) RED: on %s, the £400k limit typed in the SAME message offered as a factor\'s figure → refused today_not_set naming that factor, nothing held, byte-identical', async (_what, message, which) => {
    graphOf.set(SCENARIO, which === 'seed' ? seedGraph() : journeyE());
    const target = which === 'seed' ? 'Annual salary spend' : 'Incremental platform delivery…';
    const before = bytes();
    let out: Record<string, unknown> = {};
    const t1 = await propose(factorArgs([{ today: { value: 400000 } }], target), message, (o) => { out = o; });
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'today_not_set' }));
    expect((out['today_not_set'] as { factor: string }[]).map((x) => x.factor), JSON.stringify(out)).toEqual(['Senior engineer salary']);
    expect(approveChipOf(t1)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
    expect(newFactors()).toEqual([]);
  }, 120_000);

  it.each([
    ['journey E\'s sentence', FIG_MSG],
    ['"…a year and juniors…"', CONJOINED],
    ['E04 "£120,000 per senior engineer and £65,000 per junior engineer" (RED at 0efb03f6: the pairing was refused)', E04],
    ['E04 in "£120k … £65k" (RED at 0efb03f6)', E04_K],
  ] as const)('(n) CONTROL (RED under a scope that lets "New senior engineers hired" claim "senior"): on journey E\'s served graph, %s with the CORRECT pairing → ONE hold carrying both figures as the user\'s', async (_what, message) => {
    graphOf.set(SCENARIO, journeyE());
    const t1 = await propose(factorArgs([], 'Incremental platform delivery…'), message);
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    const held = await heldOnLatestRow();
    expect(held, 'exactly ONE live hold').toHaveLength(1);
    const ops = held[0]!.action.inline_patch!.operations!;
    const idOf = (label: string) => ops.find((o) => o.op === 'add_node' && o.value?.['label'] === label)!.path;
    const member = held[0]!.action.inline_patch![GM_HELD_USER_TODAY] as { factor_id: string; observed_state: Record<string, unknown> }[];
    const figureOf = (label: string) => member.find((m) => m.factor_id === idOf(label))!.observed_state;
    expect(figureOf('Senior engineer salary'), JSON.stringify(member)).toEqual(expect.objectContaining({ raw_value: 120000, source: USER_SOURCE }));
    expect(figureOf('Junior engineer salary'), JSON.stringify(member)).toEqual(expect.objectContaining({ raw_value: 65000, source: USER_SOURCE }));
    expect(USER_SOURCE).toBe('user_override');
  }, 120_000);

  it('(o) RED (DL ruling (b), fail closed): two figures no label word owns — "£120,000 and £65,000" — are the user\'s for NEITHER factor → refused today_not_set naming both, nothing held, byte-identical', async () => {
    graphOf.set(SCENARIO, journeyE());
    const before = bytes();
    let out: Record<string, unknown> = {};
    const t1 = await propose(factorArgs([], 'Incremental platform delivery…'), 'Record them as annual salaries: £120,000 and £65,000.', (o) => { out = o; });
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'today_not_set' }));
    expect((out['today_not_set'] as { factor: string }[]).map((x) => x.factor).sort(), JSON.stringify(out)).toEqual(['Junior engineer salary', 'Senior engineer salary']);
    expect(approveChipOf(t1)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
    expect(newFactors()).toEqual([]);
  }, 120_000);

  it('(b) RED: a figure the user did NOT write → refused and said; NOTHING held (all-or-nothing, the written one too); byte-identical', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    let out: Record<string, unknown> = {};
    const t1 = await propose(factorArgs(), 'Senior engineers cost £120k a year each.', (o) => { out = o; });
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'today_not_set' }));
    expect(JSON.stringify(out['today_not_set']), JSON.stringify(out)).toContain('Junior engineer salary');
    expect(String(JSON.stringify(out)), JSON.stringify(out)).toContain('do not state 65000');
    expect(approveChipOf(t1)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
    expect(newFactors()).toEqual([]);
  }, 120_000);

  it('(c) RED: the model moves before the approval → refused, nothing written; and the DOOR refuses a stale base with no row', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await propose(factorArgs()))!;
    expect(approve).toBeDefined();
    const g = graphNow();
    graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'opt_juniors' ? { ...x, interventions: { fac_juniors: { value: 0.1667, raw_value: 5, unit: 'engineers' } } } : x)) });
    const moved = bytes();
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false }));
    expect(bytes(), 'nothing written').toBe(moved);
    expect(newFactors()).toEqual([]);

    const { holdAddFactorInProcess } = await import('../../system-events/dispatch.js');
    const rowsBefore = order.length;
    const r = await holdAddFactorInProcess({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: 'ffffffffffffffff',
      factors: [{ label: 'Senior engineer salary', link: { to_id: SPEND, effect_direction: 'positive' },
        observed_state: { value: 0.12, raw_value: 120000, cap: 1000000, declared_scale: 'unit_interval', unit: UNIT, source: USER_SOURCE } }] }, 'req-stale');
    expect(r).toEqual({ status: 'stale' });
    expect(order.length, 'no row appended').toBe(rowsBefore);
    expect(bytes()).toBe(moved);
  }, 120_000);

  it('(d) RED: declined, then left to expire → BYTE-IDENTICAL, and the old button then writes nothing', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    const approve = approveChipOf(await propose(factorArgs()))!;
    expect(approve).toBeDefined();
    script = [() => say('Understood, I will leave them out.')];
    await turn({ message: 'No, leave those out.' });
    expect(bytes(), 'a decline writes nothing').toBe(before);
    for (let i = 0; i < 8 && (await heldOnLatestRow()).length > 0; i += 1) {
      script = [() => say('Headcount drives capacity.')];
      await turn({ message: 'What drives delivery capacity?' });
    }
    expect(await heldOnLatestRow(), 'the hold expired').toEqual([]);
    expect(bytes()).toBe(before);
    const late = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(late._agent.tool_calls[0], JSON.stringify(late._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false }));
    expect(bytes(), 'an expired hold writes nothing').toBe(before);
    expect(newFactors()).toEqual([]);
  }, 180_000);

  it('(e) RED: a link INTO an option is refused by the proposer and by the DOOR itself — nothing held, byte-identical', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    let out: Record<string, unknown> = {};
    const t1 = await propose(factorArgs([], 'Hire two senior engineers'), FIG_MSG, (o) => { out = o; });
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'target_not_allowed' }));
    expect(String(out['detail']), JSON.stringify(out)).toContain('is an option');
    expect(approveChipOf(t1)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);

    const { holdAddFactorInProcess } = await import('../../system-events/dispatch.js');
    const rowsBefore = order.length;
    const r = await holdAddFactorInProcess({ scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: await hashNow(),
      factors: [{ label: 'Senior engineer salary', link: { to_id: 'opt_seniors', effect_direction: 'positive' },
        observed_state: { value: 0.12, raw_value: 120000, cap: 1000000, declared_scale: 'unit_interval', unit: UNIT, source: USER_SOURCE } }] }, 'req-option');
    expect(r).toEqual(expect.objectContaining({ status: 'refused', reason: 'target_not_allowed' }));
    expect(order.length, 'no row appended').toBe(rowsBefore);
    expect(bytes()).toBe(before);
  }, 120_000);

  it.each([
    ['a negative figure', -120000],
    ['a non-number', 'a lot'],
  ])('(f) RED: %s → refused, nothing held, byte-identical', async (_what, value) => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    const t1 = await propose(factorArgs([{ today: { value } }]));
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'today_not_set' }));
    expect(approveChipOf(t1)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('(i) RED: a canvas add of a factor by the SAME name between the proposal and the approval (a real system-event commit) → the hold lapses, said; the approval commits nothing — never a second "Senior engineer salary"', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await propose(factorArgs()))!;
    expect(approve).toBeDefined();
    expect(await heldOnLatestRow()).toHaveLength(1);
    const { dispatchSystemEvent } = await import('../../system-events/dispatch.js');
    const canvas = await dispatchSystemEvent({
      payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: randomUUID(), stage: 'frame',
        event: { kind: 'structural_add', node_id: 'senior_engineer_salary', node_kind: 'factor', label: 'Senior engineer salary', base_graph_hash: await hashNow() } },
      requestId: 'req-canvas-add',
    } as never);
    expect(canvas.commitPerformed, JSON.stringify(canvas)).toBe(true);
    expect(graphNow().nodes.filter((x) => x.label === 'Senior engineer salary').map((x) => x.id), 'the canvas add landed').toEqual(['senior_engineer_salary']);
    expect(await heldOnLatestRow(), 'the hold is not carried onto a model that already has that name').toEqual([]);
    expect(String((canvas.response as { assistant_text?: unknown }).assistant_text), 'the lapse is said').toMatch(/has lapsed because the model changed/);
    const moved = bytes();
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false }));
    expect(bytes(), 'nothing written by the approval').toBe(moved);
    expect(graphNow().nodes.filter((x) => /^senior engineer salary$/i.test(x.label)), 'ONE node by that name').toHaveLength(1);
  }, 180_000);

  it('(j) RED: a money figure for a factor measured in another kind of unit (today.unit GBP on "engineers") → refused and said, nothing held; CONTROL: today.unit of the same kind is taken', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    let out: Record<string, unknown> = {};
    const t1 = await propose(factorArgs([{ unit: 'engineers', today: { value: 120000, unit: 'GBP' } }, { unit: 'engineers', today: { value: 65000, unit: 'GBP' } }]), FIG_MSG, (o) => { out = o; });
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'today_not_set' }));
    expect(JSON.stringify(out['today_not_set']), JSON.stringify(out)).toContain('measured in engineers');
    expect(approveChipOf(t1)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);

    const t2 = await propose(factorArgs([{ today: { value: 120000, unit: 'GBP' } }, { today: { value: 65000, unit: 'GBP' } }]));
    expect(callOf(t2), JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
  }, 120_000);

  it('(g) RED: a label the model already has → refused, naming the tool that sets an existing factor\'s value — nothing held', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = bytes();
    let out: Record<string, unknown> = {};
    const t1 = await propose(factorArgs([{ label: 'Annual salary spend', affects: 'Delivery capacity' }]), FIG_MSG, (o) => { out = o; });
    expect(callOf(t1), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'factor_exists' }));
    expect(String(out['detail']), JSON.stringify(out)).toContain('propose_assumptions');
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
  }, 120_000);
});
