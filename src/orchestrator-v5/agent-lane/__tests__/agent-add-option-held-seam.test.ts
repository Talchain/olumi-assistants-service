/**
 * ⭐ (A0) THE AGENT ADDS AN OPTION THROUGH THE PRODUCT'S OWN ATOMIC SEAM (#70 lift; C52, Canonical #69 5839809620).
 *
 * Paul's manual test (25 Sep 17:26–17:54Z, scenario cbd15f83): every option the Agent added reached the model with
 * NO link from the decision — `planNewOption` never resolved one and the apply wrote N separate system events — so
 * the canonical readiness said `OPTION_NOT_LINKED_TO_DECISION` and Run was (correctly) withheld while the Agent said
 * "no structural blocker".
 *
 * The fix routes the Agent onto the SAME typed add-option transaction the product uses:
 *   propose → an in-process `/orchestrate/v2/turn` chip turn (`intent: 'add_option'`) → `dispatchAddOptionTransaction`
 *   → ONE held `graph_management_held_v1` pending (decision→option edge INCLUDED, referee-checked);
 *   approve → the UI-shaped confirm → `commitGmHeldResume` → ONE commit.
 * And because pending actions are read from the LATEST answer row only, the Agent's own answer rows carry the live
 * hold forward (without that, the Agent's row written after the propose silently drops the hold).
 *
 * HARNESS (deliberately not a self-authored model of route-v2): the REAL `ceeOrchestratorRouteV2` and the REAL
 * `agentV1TurnRoute` share one Fastify app; the Agent reaches route-v2 by its own in-process dispatch. The session
 * store is stateful with the production READ semantics that matter here: pending actions come from the latest
 * non-claim answer row, JSONB-key-reordered, through the REAL `parsePendingAction`; a committed graph persists.
 * The scenario graph read (`/assist/v1/scenarios/:id/graph`) is a stub that serves the stored graph with the REAL
 * hash functions (`computeAnalysisAffectingGraphHash`), since the Agent only compares its own before/after reads.
 * Every model call to anything but OpenAI throws; route-v2's LLM router throws if touched at all.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `5a0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d2c${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
let graphOf = new Map<string, unknown>();
/** The latest ANSWER row for a scenario — claim rows excluded, exactly as the production read excludes them. */
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
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; turn_class?: string; handler_id?: string | null; pending_actions?: unknown[]; graph?: unknown; handler_facts?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      tick += 1;
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        // Stored with the turn, as `append_turn_atomic` does, so a writer's own read-back of its fact is served.
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[],
        created_at: new Date(Date.UTC(2026, 8, 26, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
  // The production shape (`supabase-store.ts` readFactsWithTurnFor): each stored fact with the id of the turn row it rode on.
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
/** route-v2's LLM router: the typed add-option and its confirm are deterministic — ANY use is a failure. */
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the typed add-option seam (${what})`); };
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
type Body = { assistant_text: string; suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string }; _provider_calls?: { provider: string; outcome?: string }[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string; conflict_fields?: string[]; rejected_levels?: Record<string, unknown>[] }[] } };

/**
 * A decision, a goal, one factor with a declared scale, two linked options: runnable before anything is added.
 * Interventions are in the STORED object shape ({ value, raw_value, unit }): the analysis hash — the hold's pin —
 * projects `.value`, so a bare-number intervention would be invisible to it (measured).
 */
const seedGraph = (factorCount = 1, decisions = 1, priceFrame: 'cap' | 'scale_frame' | 'none' = 'cap') => {
  const e = (from: string, to: string, mean = 1) => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const });
  // Price is a lever the decision sets: `category: 'controllable'` (the readiness authority blocks an option that
  // leaves a controllable factor unset — and only then).
  const factors = Array.from({ length: factorCount }, (_, i) => ({ id: i === 0 ? 'fac_price' : `fac_${i}`, kind: 'factor', label: i === 0 ? 'Price' : `Factor ${i}`,
    ...(i === 0 ? { category: 'controllable' } : {}),
    // How Price carries its range: a declared cap (a baseline was stated), the declared `scale_frame` carrier (a
    // model built with no baseline, `admit-model.ts`), or none at all.
    ...(i !== 0 || priceFrame === 'cap' ? { observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } }
      : priceFrame === 'scale_frame' ? { scale_frame: 200 } : { observed_state: { value: 0.5 } }) }));
  const decs = Array.from({ length: decisions }, (_, i) => ({ id: i === 0 ? 'dec_x' : `dec_${i}`, kind: 'decision', label: i === 0 ? 'Choose a price' : `Other decision ${i}` }));
  return {
    nodes: [
      ...decs,
      { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
      ...factors,
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP' } } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: { value: 0.295, raw_value: 59, unit: 'GBP' } } },
    ],
    edges: [e('dec_x', 'opt_a'), e('dec_x', 'opt_b'), e('opt_a', 'fac_price'), e('opt_b', 'fac_price'),
      ...factors.map((f) => e(f.id, 'goal_x'))],
    goal_node_id: 'goal_x',
  };
};

/** How many times the scenario graph was read (slice C1c). */
let graphReads = 0;
/** Scripted OpenAI: each Agent model call takes the next reply; anything that is not OpenAI throws. */
let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
/** The inner requests the Agent sent to route-v2, in order. */
let inner: Record<string, unknown>[] = [];
/** Runs inside the inner request's preHandler — BEFORE route-v2 reads the store (a writer racing the confirm). */
let onInner: ((body: Record<string, unknown>) => void) | undefined;
/** Runs as route-v2's answer to an inner request is sent — AFTER it has decided. */
let onInnerSent: ((body: Record<string, unknown>) => void) | undefined;

describe('(A0) the Agent adds an option through the typed add-option seam — linked from the decision, one approval, one commit', () => {
  async function buildApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const { computeGraphIdentityHash } = await import('../../context/graph-identity.js');
    const a = Fastify({ logger: false });
    a.addHook('preHandler', async (req) => { if (req.url === '/orchestrate/v2/turn') { inner.push(req.body as Record<string, unknown>); onInner?.(req.body as Record<string, unknown>); } });
    a.addHook('onSend', async (req, _reply, payload) => { if (req.url === '/orchestrate/v2/turn') onInnerSent?.(req.body as Record<string, unknown>); return payload; });
    a.post('/assist/v1/scenarios/:id/graph', async (req) => {
      graphReads += 1;
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never),
        graph_identity_hash: g === null ? null : computeGraphIdentityHash(g as never) };
    });
    await a.register(ceeOrchestratorRouteV2);
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }
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
    app = await buildApp();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; inner = []; onInner = undefined; onInnerSent = undefined; routerCalls.length = 0; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const graphNow = () => graphOf.get(SCENARIO) as { nodes: { id: string; kind: string; label: string; proposed_by?: string;
    analysis_participation?: string; interventions?: Record<string, unknown> }[]; edges: { from: string; to: string }[] };
  const approveChipOf = (b: Body) => b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
  const readiness = async () => {
    const { buildCanonicalAnalysisReadyFromGraph } = await import('../../../orchestrator/tools/analysis-ready-helper.js');
    return buildCanonicalAnalysisReadyFromGraph(graphNow()) as { may_run?: boolean; status?: string } | undefined;
  };
  /** The hold the Agent's LATEST answer row carries — what the next turn (and route-v2's confirm) will read. */
  const heldOnLatestRow = async () => {
    const pendings = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; expires_at_turn_count: number; action: { kind: string; inline_patch?: { handler_id?: string; operations?: { op: string; path: string }[] } } }[];
    return pendings.filter((p) => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };
  const proposeOptionC = (level: number | undefined, message = 'Add an option: test £54 at release.') => {
    script = [
      () => fnCall('propose_new_option', { label: 'Test £54 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', ...(level !== undefined ? { level: { value: level, unit: 'GBP' } } : {}) }], rationale: 'The user asked for it.' }),
      () => say('I would add "Test £54 at release", linked from the decision and setting the price. Shall I add it?'),
    ];
    return turn({ message });
  };
  const newOption = () => graphNow().nodes.find((x) => x.kind === 'option' && x.label === 'Test £54 at release');

  it('CONTROL (passes at base): the REAL route-v2 in this harness mints ONE gmh_ hold for a typed add-option chip turn, with the decision edge, and no LLM', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const r = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), stage: 'frame', turn_class: 'frame', source: 'chip',
      message: 'Add the option "Control option".',
      chip: { id: 'control-add-option', intent: 'add_option', parameters: { parent_decision_id: 'dec_x', label: 'Control option', option_id: 'ctl0001', interventions: [{ factor_id: 'fac_price', value: 0.27, unit: 'GBP', raw_value: 54 }] } },
    } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    const held = await heldOnLatestRow();
    expect(held.map((p) => p.chip_id), r.body.slice(0, 600)).toEqual([expect.stringMatching(/^gmh_[0-9a-f]{12}$/)]);
    expect(held[0]!.action.inline_patch!.operations!.some((o) => o.op === 'add_edge' && o.path === 'dec_x::ctl0001')).toBe(true);
    expect(routerCalls).toEqual([]);
  }, 120_000);

  /**
   * ⭐ SLICE C1 (P3A replay of Paul's transcript, 27 Sep): an ordinary question cost two model calls, the first only
   * to fetch `get_canonical_state`. The route now reads the model once and GIVES it; the read tool is not offered.
   */
  it('[C1] RED: an ordinary question → ONE model call; its request carries the CURRENT MODEL STATE (the model\'s entities) and does not offer get_canonical_state', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const bodies: Record<string, unknown>[] = [];
    script = [(body) => { bodies.push(body); return say('Price drives revenue here.'); }];
    const t = await turn({ message: 'What drives revenue in my model?' });
    expect(openAiCalls, 'one model call').toBe(1);
    const tools = ((bodies[0]!['tools'] ?? []) as { name?: string }[]).map((x) => x.name);
    expect(tools).not.toContain('get_canonical_state');
    const given = JSON.stringify((bodies[0]!['input'] ?? []) as unknown[]);
    expect(given).toMatch(/CURRENT MODEL STATE/);
    expect(given).toContain('fac_price');
    expect(t._agent.tool_calls).toEqual([]);
    // The next turn is given its OWN state; the earlier one is not carried in the history.
    script = [(body) => { bodies.push(body); return say('Still price.'); }];
    await turn({ message: 'And now?' });
    expect((JSON.stringify(bodies[1]!['input']).match(/CURRENT MODEL STATE/g) ?? []).length, 'exactly one state item on turn 2').toBe(1);
  }, 120_000);

  /**
   * ⭐ SLICE C1c (served replay on 339ed34): an ordinary turn read the scenario twice at ~1.3 s of server time each —
   * the state the Agent is given and the readback for the response. With nothing written, the first read serves both.
   */
  it('[C1c] RED: an ordinary question reads the scenario ONCE', async () => {
    graphOf.set(SCENARIO, seedGraph());
    script = [() => say('Price drives revenue here.')];
    graphReads = 0;
    await turn({ message: 'What drives revenue in my model?' });
    expect(graphReads, 'one read serves the given state and the readback').toBe(1);
  }, 120_000);

  it('[C1c] CONTRAST: a turn that WRITES reads again after the write — its readback is the changed model, never the one before', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeOptionC(54);
    const approve = approveChipOf(t1)!;
    graphReads = 0;
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(graphReads).toBeGreaterThanOrEqual(2);
    // The response's readiness is the POST-write verdict (the option now exists and the model can run).
    expect(t2.assistant_text, t2.assistant_text).toMatch(/The analysis can run now\./);
  }, 120_000);

  it('[a] RED: one option with the user\'s £54 → ONE held proposal on the typed rail → one click → linked from the decision, levelled, runnable', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeOptionC(54);
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify({ chips: t1.suggested_actions, tools: t1._agent.tool_calls })).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    // ONE inner write, on the typed rail — never the old N system events.
    expect(inner.filter((b) => b['kind'] === 'system_event'), 'no structural system events').toEqual([]);
    expect(inner.filter((b) => (b['chip'] as { intent?: string } | undefined)?.intent === 'add_option')).toHaveLength(1);
    // [d] the Agent's own answer row (the latest) still carries the hold, with the decision edge IN the held batch.
    const held = await heldOnLatestRow();
    expect(held.map((p) => p.chip_id)).toEqual([approve!.id.slice('agent-approve-proposal:'.length)]);
    const ops = held[0]!.action.inline_patch!.operations!;
    const optId = ops.find((o) => o.op === 'add_node')!.path;
    expect(ops.some((o) => o.op === 'add_edge' && o.path === `dec_x::${optId}`), JSON.stringify(ops)).toBe(true);
    expect(newOption(), 'nothing is written before the approval').toBeUndefined();

    const callsBefore = openAiCalls;
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(openAiCalls - callsBefore, 'a typed approval makes no model call').toBe(0);
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const opt = newOption();
    expect(opt, JSON.stringify(graphNow().nodes)).toBeDefined();
    expect(graphNow().edges.some((e) => e.from === 'dec_x' && e.to === opt!.id), 'linked FROM THE DECISION').toBe(true);
    expect(graphNow().edges.some((e) => e.from === opt!.id && e.to === 'fac_price')).toBe(true);
    // [g] the user's £54 on a 0–£200 scale is stored normalised, with its raw figure.
    expect(JSON.stringify(opt!.interventions)).toMatch(/0\.27/);
    expect((await readiness())?.may_run, 'runnable after the add').toBe(true);
    // (B) Olumi says so beneath the reply, from the same verdict as the Run control.
    expect(t2.assistant_text, t2.assistant_text).toMatch(/The analysis can run now\./);
    expect(await heldOnLatestRow(), 'the hold is consumed').toEqual([]);
    // [e] OpenAI only; route-v2's router untouched on both turns.
    expect(routerCalls).toEqual([]);
    for (const b of [t1, t2]) for (const p of b._provider_calls ?? []) expect(p.provider).toBe('openai');
  }, 120_000);

  /**
   * ⛔ B3 (Paul's test, 27 Sep 09:31Z, export user_actions[14]): the approve button read "Add option '£59 for new Pro
   * customers; grandfather existi..." — the product's `clampLabel` cut the sentence at 57 characters and sent the whole
   * sentence in `detail`, which the UI shows on the button; the Agent's copy of the chip dropped `detail`.
   */
  it('[B3] RED: a long option name → the approve button carries the product\'s FULL sentence (`detail`), never only the cut label; one click still adds it', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const LONG = '£59 for new Pro customers; grandfather existing customers';
    script = [
      () => fnCall('propose_new_option', { label: LONG, acts_on: [{ factor_label: 'Price', direction: 'positive' }], rationale: 'The user asked for it.' }),
      () => say(`I would add "${LONG}". Shall I add it?`),
    ];
    const t1 = await turn({ message: `Add an option: ${LONG}.` });
    const approve = approveChipOf(t1) as (Chip & { detail?: string }) | undefined;
    expect(approve?.id, JSON.stringify({ chips: t1.suggested_actions, tools: t1._agent.tool_calls })).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    // A multi-part change: the button is short and whole ("Approve N changes"); the full words ride in `detail`,
    // one change per line, and the UI shows them above the button (UI #2194).
    expect(approve!.label, approve!.label).toMatch(/^Approve \d+ changes$/);
    expect(approve!.label).not.toContain(LONG);
    // The product's OWN sentence, by identity: its first line names the option whole.
    expect(approve!.detail, JSON.stringify(approve)).toEqual(expect.stringContaining(`'${LONG}'`));
    expect(approve!.detail!.split('\n')[0], JSON.stringify(approve)).toContain(`'${LONG}'`);
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(graphNow().nodes.some((x) => x.kind === 'option' && x.label === LONG), JSON.stringify(graphNow().nodes)).toBe(true);
  }, 120_000);

  it('[b] an option with NO stated level is linked from the decision and left honestly unset — the authority names the missing value for THAT option, and the reply names the step', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeOptionC(undefined);
    const approve = approveChipOf(t1)!;
    expect(approve.id).toMatch(/gmh_/);
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0]).toEqual(expect.objectContaining({ ok: true, mutated: true }));
    const opt = newOption()!;
    expect(graphNow().edges.some((e) => e.from === 'dec_x' && e.to === opt.id), 'linked FROM THE DECISION').toBe(true);
    expect(JSON.stringify(opt.interventions ?? {})).not.toMatch(/\d/);
    // The ONE readiness authority decides admission (one unset option: runnable, leaving it out). What A0 owns is
    // that the unknown stays unknown and is NAMED, bound to this option by identity — never filled in.
    const r = await readiness() as { readiness_issues?: { code: string; option_id?: string; factor_id?: string; repairability?: string }[] } | undefined;
    expect(r?.readiness_issues, JSON.stringify(r?.readiness_issues)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'MISSING_OPTION_VALUE', option_id: opt.id, factor_id: 'fac_price', repairability: 'human_input_required' }),
    ]));
    expect(t2.assistant_text, 'the completion step is named, in plain words').toMatch(/does not yet set a level for "Price"/);
    // (B) and whether it can run NOW, from the one verdict: it can, leaving this option out until its level is set.
    expect(t2.assistant_text, t2.assistant_text).toMatch(/The analysis can run now; it will leave out "Test £54 at release" until its levels are set\./);
    expect(t2.assistant_text, 'no raw codes in user prose').not.toMatch(/\b[A-Z]+(?:_[A-Z]+){2,}\b/);
  }, 120_000);

  it('[d] a question between the offer and the click does not drop the hold', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeOptionC(54))!;
    script = [() => say('It would test the lower price before rollout.')];
    const ttlOffered = (await heldOnLatestRow())[0]!.expires_at_turn_count;
    await turn({ message: 'What would that change?' });
    expect((await heldOnLatestRow()).map((p) => p.chip_id), 'the question turn\'s answer row carries the hold').toEqual([approve.id.slice('agent-approve-proposal:'.length)]);
    // Canonical #1933 condition 2: carried by the product's own survival rule, so the turn count runs down.
    expect((await heldOnLatestRow())[0]!.expires_at_turn_count, 'one carried turn spends one turn of the hold').toBe(ttlOffered - 1);
    const t3 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t3._agent.tool_calls[0]).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect(graphNow().edges.some((e) => e.from === 'dec_x' && e.to === newOption()!.id)).toBe(true);
  }, 120_000);

  it('[i] a typed "yes" — the Agent authorises the held proposal by its id and it applies', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeOptionC(54);
    const ref = t1._agent.tool_calls.find((c) => c.name === 'propose_new_option')?.proposal_id;
    expect(ref).toMatch(/^gmh_[0-9a-f]{12}$/);
    let seenByModel = '';
    script = [() => fnCall('authorise_change', { proposal_id: ref }), (body) => { seenByModel = JSON.stringify(body['input']); return say('Added.'); }];
    const t2 = await turn({ message: 'Yes, add it.' });
    // (B) the Agent is told what the model needs NOW, from the stored graph after the write — in plain words.
    expect(seenByModel, seenByModel.slice(-1500)).toMatch(/readiness_after/);
    expect(seenByModel).toMatch(/\\"may_run\\":true/);
    expect(t2._agent.tool_calls.find((c) => c.name === 'authorise_change'), JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: true }));
    expect(graphNow().edges.some((e) => e.from === 'dec_x' && e.to === newOption()!.id)).toBe(true);
  }, 120_000);

  it('[w] RED (P2 of the A16 defect): the Agent WITHDRAWS its held option before replying → no button, the answer row carries no hold, and a later "yes" adds nothing', async () => {
    graphOf.set(SCENARIO, seedGraph());
    /** The id the model was given back by its last proposing call (the `gmh_` handle), read from its own request. */
    const heldIdIn = (body: Record<string, unknown>): string | undefined => {
      const outs = (body['input'] as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output');
      const id = (JSON.parse(String(outs[outs.length - 1]?.output ?? '{}')) as { proposal_id?: unknown }).proposal_id;
      return typeof id === 'string' ? id : undefined;
    };
    script = [
      () => fnCall('propose_new_option', { label: 'Test £54 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }], rationale: 'The user asked for it.' }),
      (body) => fnCall('withdraw_proposal', { proposal_id: heldIdIn(body) }),
      () => say('I have withdrawn that option: it was not what you asked for.'),
    ];
    const t1 = await turn({ message: 'Add an option: test £54 at release.' });
    const ref = t1._agent.tool_calls.find((c) => c.name === 'propose_new_option')?.proposal_id;
    expect(ref).toMatch(/^gmh_[0-9a-f]{12}$/);
    expect(t1._agent.tool_calls.map((c) => [c.name, c.ok]), JSON.stringify(t1._agent.tool_calls)).toEqual([['propose_new_option', true], ['withdraw_proposal', true]]);
    expect(approveChipOf(t1), 'a withdrawn change has no approve button').toBeUndefined();
    expect(await heldOnLatestRow(), 'the answer row leaves the withdrawn hold off, so nothing can confirm it').toEqual([]);
    script = [() => fnCall('authorise_change', { proposal_id: ref }), () => say('Done.')];
    const t2 = await turn({ message: 'Yes, add it.' });
    expect(t2._agent.tool_calls.find((c) => c.name === 'authorise_change'), JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false }));
    expect(newOption(), 'nothing was added').toBeUndefined();
  }, 120_000);

  it('[s] the model moves between the offer and the click → the product answers 200 but applies nothing, and the Agent does NOT report it as added', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeOptionC(54))!;
    // Another writer changes the model after the offer — an ANALYSIS-AFFECTING change (a label rename is not:
    // the pin is the analysis hash, which ignores labels) — so the hold's pinned base no longer matches.
    const g = graphNow();
    graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'opt_b' ? { ...x, interventions: { fac_price: { value: 0.3, raw_value: 60, unit: 'GBP' } } } : x)) });
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false }));
    expect(newOption(), 'nothing was added').toBeUndefined();
    expect(t2.assistant_text).not.toMatch(/^Added\b/);
    expect(t2.assistant_text, 'nothing was written, so no readiness line').not.toMatch(/The analysis can/);
  }, 120_000);

  it('[c2] the model moves after the offer → the next answer row does NOT carry the stale hold (it could only be refused)', async () => {
    graphOf.set(SCENARIO, seedGraph());
    await proposeOptionC(54);
    expect(await heldOnLatestRow()).toHaveLength(1);
    const g = graphNow();
    graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'opt_b' ? { ...x, interventions: { fac_price: { value: 0.3, raw_value: 60, unit: 'GBP' } } } : x)) });
    script = [() => say('It would test the lower price before rollout.')];
    await turn({ message: 'What would that change?' });
    expect(await heldOnLatestRow(), 'a hold pinned to a model that has since moved is not carried forward').toEqual([]);
  }, 120_000);

  it('[c3] another writer lands the SAME option id, linked from the decision, while the confirm is in flight → the product refuses the stale hold (200), the hold is retired, and the Agent does NOT claim it', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeOptionC(54))!;
    const hold = (await heldOnLatestRow())[0]!;
    const optId = hold.action.inline_patch!.operations!.find((o) => o.op === 'add_node')!.path;
    const isConfirm = (b: Record<string, unknown>) => (b['chip'] as { id?: string } | undefined)?.id === hold.chip_id;
    // Before route-v2 reads the store: the racing writer's model, holding an option with THIS id, linked from the decision.
    onInner = (b) => {
      if (!isConfirm(b)) return;
      const g = graphNow();
      const e = (from: string, to: string) => ({ from, to, strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const });
      graphOf.set(SCENARIO, { ...g,
        nodes: [...g.nodes, { id: optId, kind: 'option', label: 'Test £54 at release', interventions: { fac_price: { value: 0.3, raw_value: 60, unit: 'GBP' } } }],
        edges: [...g.edges, e('dec_x', optId), e(optId, 'fac_price')] });
    };
    // After route-v2 has refused the stale hold: the hold is retired (the product drops a hold whose pin moved).
    onInnerSent = (b) => { if (isConfirm(b)) void store.append({ scenario_id: SCENARIO, turn_id: `racing-writer-${randomUUID()}`, request_hash: 'racing', pending_actions: [] }); };
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false }));
    expect(t2.assistant_text, t2.assistant_text).not.toMatch(/\bAdded\b|Partly saved/);
  }, 120_000);

  it('[c3b] the confirm lands, then another writer moves the model before the Agent reads it back → saved, but NOT reported as "Added" (what it holds is unconfirmed)', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeOptionC(54))!;
    const hold = (await heldOnLatestRow())[0]!;
    onInnerSent = (b) => {
      if ((b['chip'] as { id?: string } | undefined)?.id !== hold.chip_id) return;
      const g = graphNow();
      graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'opt_b' ? { ...x, interventions: { fac_price: { value: 0.3, raw_value: 60, unit: 'GBP' } } } : x)) });
    };
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: true, refusal: 'not_verified' }));
    expect(t2.assistant_text, t2.assistant_text).not.toMatch(/\bAdded\b/);
    /**
     * ⛔ RED (fix/agent-never-shows-instructions-or-codes; code-read of `write-outcome.ts`): the option DID land, and
     * the user read "Partly saved: the change was refused (not_verified)." — a code, and "refused" for a saved change.
     * What the user reads is that it could not be confirmed, in words.
     */
    expect(t2.assistant_text, t2.assistant_text).toMatch(/could not be confirmed/);
    expect(t2.assistant_text, t2.assistant_text).not.toMatch(/Not saved|refused|not_verified|\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/);
  }, 120_000);

  it('[p1] RED (independent review 00:16Z): a factor whose range is its declared scale_frame — the user\'s £54 is stored on THAT range (0.27, figure kept), never as a bare 54', async () => {
    graphOf.set(SCENARIO, seedGraph(1, 1, 'scale_frame'));
    const approve = approveChipOf(await proposeOptionC(54))!;
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    const iv = (newOption()?.interventions ?? {})['fac_price'] as { value?: number; raw_value?: number } | undefined;
    expect(iv?.value, JSON.stringify(iv)).toBeCloseTo(0.27, 6);
    expect(iv?.raw_value).toBe(54);
  }, 120_000);

  it('[p2] RED: a figure outside the factor\'s range (£250 on 0–£200) is refused in plain words — nothing is prepared, nothing is sent, no button', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeOptionC(250, 'Add an option: test £250 at release.');
    const c = t1._agent.tool_calls.find((x) => x.name === 'propose_new_option');
    expect(c, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, refusal: 'level_out_of_range' }));
    expect(inner.filter((b) => (b['chip'] as { intent?: string } | undefined)?.intent === 'add_option'), 'nothing sent').toEqual([]);
    expect(approveChipOf(t1)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
  }, 120_000);

  it('[p4] RED (served fbb12b8, #70 5843805457 / 5843825647): a level the user never wrote — 0 sent to mean "not set" — is stored UNSET through the real route, never as the user\'s 0', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeOptionC(0);
    const approve = approveChipOf(t1)!;
    expect(approve, JSON.stringify(t1._agent.tool_calls)).toBeDefined();
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    const iv = (newOption()?.interventions ?? {})['fac_price'];
    expect(newOption(), 'the option itself is added').toBeDefined();
    expect(iv, JSON.stringify(iv)).toBeUndefined();
  }, 120_000);

  it('[p5] RED (#1978 review B1): a board edit Olumi narrates with a 0 does not make a later 0 level the user\'s', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const edit = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'system_event', scenario_id: SCENARIO, turn_id: randomUUID(), stage: 'frame', event: { kind: 'factor_value_edit', target_id: 'fac_price', value: 0, field: 'value' } } });
    const narration = String((edit.json() as { assistant_text?: unknown }).assistant_text ?? '');
    expect(edit.statusCode, edit.body.slice(0, 400)).toBe(200);
    expect(narration, 'the board edit is narrated with its 0 (the path under test)').toMatch(/\b0\b/);
    const t1 = await proposeOptionC(0, 'Add an option: test a new price at release.');
    const approve = approveChipOf(t1)!;
    expect(approve, JSON.stringify(t1._agent.tool_calls)).toBeDefined();
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(newOption(), 'the option itself is added').toBeDefined();
    expect((newOption()?.interventions ?? {})['fac_price'], narration).toBeUndefined();
  }, 120_000);

  it('[p6] RED (#1978 review 5844805634 B2): an approval click replays Olumi\'s own "£54" label; a later level of 54 is still not the user\'s', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeOptionC(undefined, 'Add an option for the release price.');
    const approve = approveChipOf(t1)!;
    expect(approve.message, 'the click replays the Agent\'s label, with its figure').toContain('£54');
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    script = [
      () => fnCall('propose_new_option', { label: 'Release price trial', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }], rationale: 'The user asked for one more.' }),
      () => say('I would add it. Shall I?'),
    ];
    const t3 = await turn({ message: 'Add one more like it.' });
    const again = approveChipOf(t3)!;
    await turn({ message: again.message, source: 'chip', chip: { id: again.id } });
    const trial = graphNow().nodes.find((x) => x.kind === 'option' && x.label === 'Release price trial');
    expect(trial, 'the second option is added').toBeDefined();
    expect((trial?.interventions ?? {})['fac_price']).toBeUndefined();
  }, 120_000);

  it('[p7] RED (#1978 review 5844805634 B3): after a restart, a row Olumi itself dispatched ("Add the option \u201cTest \u00a354 at release\u201d.") is reseeded — and never read as the user\'s', async () => {
    graphOf.set(SCENARIO, seedGraph());
    // The durable conversation as route-v2 records the Agent's own add-option dispatch (route-v2 commit userMessage).
    await store.append({ scenario_id: SCENARIO, turn_id: 'seeded-agent-dispatch', request_hash: 'x', userMessage: 'Add the option "Test £54 at release".', assistantMessage: 'Added.', turn_class: 'handler', handler_id: 'add_option' });
    const t1 = await proposeOptionC(54, 'Add an option for the release price.');
    const approve = approveChipOf(t1)!;
    expect(approve, JSON.stringify(t1._agent.tool_calls)).toBeDefined();
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(newOption(), 'the option itself is added').toBeDefined();
    expect((newOption()?.interventions ?? {})['fac_price']).toBeUndefined();
  }, 120_000);

  it('CONTRAST [p8]: a figure the user TYPED in an earlier turn of this session is still theirs', async () => {
    graphOf.set(SCENARIO, seedGraph());
    script = [() => say('Noted — £54 at release. Shall I add it as an option?')];
    await turn({ message: 'I want to test £54 at release.' });
    const t2 = await proposeOptionC(54, 'Yes, add it.');
    const approve = approveChipOf(t2)!;
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect((newOption()?.interventions ?? {})['fac_price'], 'the user\'s £54').toEqual(expect.objectContaining({ raw_value: 54 }));
  }, 120_000);

  it('[q1] RED (served F4, DL 5843303596; needs Canonical\'s builder): an option on a factor the model LACKS → ONE held change adds the factor AND the option → one click → both present, the factor reaching the goal', async () => {
    graphOf.set(SCENARIO, seedGraph());
    script = [
      () => fnCall('propose_new_option', {
        label: 'Keep £49 and add a paid AI add-on', acts_on: [{ factor_label: 'AI add-on price', direction: 'positive' }],
        new_factors: [{ label: 'AI add-on price', affects: [{ label: 'Revenue', direction: 'positive' }] }], rationale: 'The user asked for it.',
      }),
      () => say('I would add the option and the add-on price factor it needs, in one change. Shall I add them?'),
    ];
    const t1 = await turn({ message: 'Add an option: keep £49 and add a paid AI add-on. The add-on raises revenue.' });
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect(inner.filter((b) => (b['chip'] as { intent?: string } | undefined)?.intent === 'add_option'), 'ONE typed change').toHaveLength(1);
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    const g = graphNow();
    const opt = g.nodes.find((x) => x.kind === 'option' && x.label === 'Keep £49 and add a paid AI add-on');
    const fac = g.nodes.find((x) => x.kind === 'factor' && x.label === 'AI add-on price');
    expect(opt, JSON.stringify(g.nodes)).toBeDefined();
    expect(fac, JSON.stringify(g.nodes)).toBeDefined();
    expect(g.edges.some((e) => e.from === 'dec_x' && e.to === opt!.id), 'linked from the decision').toBe(true);
    expect(g.edges.some((e) => e.from === opt!.id && e.to === fac!.id), 'the option acts on the new factor').toBe(true);
    expect(g.edges.some((e) => e.from === fac!.id && e.to === 'goal_x'), 'the new factor reaches the goal').toBe(true);
    // ⭐ A6b (DL CR on #2131, option (a)): the STORED graph after the real commit. The user TYPED this option's name
    // ("Add an option: keep £49 and add a paid AI add-on"), so the option is theirs (`user_set`, CEE's stamp at the
    // approval seam). The new factor is one OLUMI minted for it: approving it does not make it the user's, so it keeps
    // the provenance it was proposed with. The options already there are untouched.
    const provenanceOf = (id: string) => (g.nodes.find((x) => x.id === id) as { provenance?: unknown } | undefined)?.provenance;
    expect(provenanceOf(opt!.id), 'the option the user named').toBe('user_set');
    expect(provenanceOf(fac!.id), 'the new factor Olumi minted').not.toBe('user_set');
    expect(provenanceOf('opt_a'), 'an option the user did not add in this approval').toBeUndefined();
    expect(t2.assistant_text, t2.assistant_text).toMatch(/Also added the factor "AI add-on price", which changes "Revenue"/);
    expect(t2.assistant_text, 'the factor is never reported as an option').not.toMatch(/Added "AI add-on price"/);
    // Audit MAG-2 (served 201724Z steps 06–07): the new factor's link is the flat default, so its size is a placeholder,
    // never "Olumi's estimate".
    expect(t2.assistant_text, t2.assistant_text).toMatch(/"Revenue"; how strongly is not known yet: Olumi used a placeholder strength, not an estimate\./);
    expect(t2.assistant_text).not.toMatch(/how strongly is Olumi's estimate/);
  }, 120_000);

  it('[q2] RED (C2, #70 5844173937; needs Canonical\'s builder to stamp it): Olumi\'s own suggested level → ONE approval → COMMITTED as cee_hypothesis and said as Olumi\'s estimate — never stored as the user\'s', async () => {
    graphOf.set(SCENARIO, seedGraph());
    script = [
      () => fnCall('propose_new_option', {
        label: 'Test £54 at release',
        // The estimate agrees with the option's own name (#1982 review N2: £64 under "Test £54" contradicted itself).
        acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP', estimate: true, basis: 'the release price Olumi suggested, below the £59 option' } }],
        rationale: 'Olumi suggested it; the user asked to add all of them.',
      }),
      () => say('I would add it at my own estimate of £54. Shall I add it?'),
    ];
    const t1 = await turn({ message: 'Add all of the options you suggested.' });
    const approve = approveChipOf(t1)!;
    expect(approve, JSON.stringify(t1._agent.tool_calls)).toBeDefined();
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    const iv = (newOption()?.interventions ?? {})['fac_price'] as { raw_value?: unknown; source?: unknown } | undefined;
    expect(iv?.raw_value, JSON.stringify(iv)).toBe(54);
    expect(iv?.source, 'Olumi\'s figure is never stored as the user\'s').toBe('cee_hypothesis');
    expect(t2.assistant_text, t2.assistant_text).toMatch(/Its level for "Price" is Olumi's estimate, for you to correct\./);
  }, 120_000);

  /**
   * ⛔ ROUND-2 REVIEW, BLOCKER 3: the boundary every fast-path follow-up passes (`withoutAgentDirections`) dropped this
   * producer's sentences whenever a factor LABEL tripped it — "the user" inside "Size of the user base", a snake_case
   * label, or the id `labelOf` falls back to — so one click showed only "Saved.": what was added, and the C2
   * disclosure that the level is Olumi's estimate, were both lost. A label is the user's data, never an instruction.
   */
  const estimateOn = (factorLabel: string) => [
    () => fnCall('propose_new_option', {
      label: 'Test £54 at release',
      acts_on: [{ factor_label: factorLabel, direction: 'positive', level: { value: 54, unit: 'GBP', estimate: true, basis: 'the release price Olumi suggested, below the £59 option' } }],
      rationale: 'Olumi suggested it; the user asked to add all of them.',
    }),
    () => say('I would add it at my own estimate of £54. Shall I add it?'),
  ];
  const withPriceLabelled = (label: string) => {
    const g = seedGraph();
    return { ...g, nodes: g.nodes.map((x) => (x.id === 'fac_price' ? { ...x, label } : x)) };
  };
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const bothSentences = (text: string, label: string) => {
    // Quote-agnostic first: the defect is the sentence being DROPPED.
    expect(text, text).toMatch(new RegExp(`Added "Test £54 at release", linked from the decision and acting on "?${esc(label)}"?\\.`));
    expect(text, text).toMatch(new RegExp(`Its level for "?${esc(label)}"? is Olumi's estimate, for you to correct\\.`));
    // Then the exact sentences: each label quoted, as the user's data.
    expect(text, text).toContain(`Added "Test £54 at release", linked from the decision and acting on "${label}".`);
    expect(text, text).toContain(`Its level for "${label}" is Olumi's estimate, for you to correct.`);
  };
  for (const label of ['Size of the user base', 'cost_per_hire']) {
    it(`[lbl] RED (round-2 blocker 3): a factor labelled "${label}" → one click → BOTH sentences reach the user`, async () => {
      graphOf.set(SCENARIO, withPriceLabelled(label));
      script = estimateOn(label);
      const t1 = await turn({ message: 'Add all of the options you suggested.' });
      const approve = approveChipOf(t1);
      expect(approve?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
      const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
      expect(t2._diagnostic_trace.fast_path).toBe('approve');
      expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
      bothSentences(t2.assistant_text, label);
    }, 120_000);
  }

  it('[lbl-id] RED (round-2 blocker 3): the factor has no label by the time it is read back (labelOf\'s id fallback) → BOTH sentences still reach the user', async () => {
    graphOf.set(SCENARIO, seedGraph());
    script = estimateOn('Price');
    const t1 = await turn({ message: 'Add all of the options you suggested.' });
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    const hold = (await heldOnLatestRow())[0]!;
    // After route-v2 has committed: the label goes (labels are outside the analysis hash, so the confirm still verifies).
    onInnerSent = (b) => {
      if ((b['chip'] as { id?: string } | undefined)?.id !== hold.chip_id) return;
      const g = graphNow();
      graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'fac_price' ? (({ label: _l, ...rest }) => rest)(x) : x)) });
    };
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    bothSentences(t2.assistant_text, 'fac_price');
  }, 120_000);

  it('[q3] RED (#1982 review N2): Olumi\'s £64 under an option NAMED "Test £54" → left unset and the Agent is told why; one click adds the option with no level', async () => {
    graphOf.set(SCENARIO, seedGraph());
    let proposed = '';
    script = [
      () => fnCall('propose_new_option', {
        label: 'Test £54 at release',
        acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 64, unit: 'GBP', estimate: true, basis: 'a step above the £59 option' } }],
        rationale: 'Olumi suggested it; the user asked to add all of them.',
      }),
      (body) => { proposed = JSON.stringify(body['input']); return say('I would add it; its price level is left for you to set. Shall I add it?'); },
    ];
    const t1 = await turn({ message: 'Add all of the options you suggested.' });
    expect(proposed, proposed.slice(-1500)).toMatch(/does not match the figure in the option's own name/);
    const approve = approveChipOf(t1)!;
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(newOption(), 'the option itself is added').toBeDefined();
    expect((newOption()?.interventions ?? {})['fac_price']).toBeUndefined();
  }, 120_000);

  it('[q4] RED (#1990 follow-up): an option with the same level as "Raise to £59" → the Agent is told WHICH option it repeats; nothing is sent', async () => {
    graphOf.set(SCENARIO, seedGraph());
    let toolOutput: { refusal?: string; same_levels_as?: string; detail?: string } = {};
    script = [
      () => fnCall('propose_new_option', { label: 'Test £59 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 59, unit: 'GBP' } }], rationale: 'The user asked for it.' }),
      (body) => {
        const out = (body['input'] as { type?: string; output?: string }[]).find((i) => i.type === 'function_call_output');
        toolOutput = JSON.parse(String(out?.output ?? '{}')) as typeof toolOutput;
        return say('That would repeat "Raise to £59". Which level should it change?');
      },
    ];
    const t1 = await turn({ message: 'Add an option: test £59 at release.' });
    expect(toolOutput.refusal, JSON.stringify(toolOutput)).toBe('not_prepared');
    expect(toolOutput.same_levels_as).toBe('Raise to £59');
    expect(toolOutput.detail).toContain('It would set exactly the same levels as "Raise to £59"');
    expect(inner.filter((b) => (b['chip'] as { intent?: string } | undefined)?.intent === 'add_option'), 'nothing sent').toEqual([]);
    expect(approveChipOf(t1)).toBeUndefined();
  }, 120_000);

  it('an exact-label Olumi suggestion waits for its displayed card; model yes cannot write, and the card includes the same option', async () => {
    const graph = seedGraph();
    graphOf.set(SCENARIO, { ...graph, nodes: [...graph.nodes.map((node) => node.id === 'opt_b'
      ? { ...node, label: 'Raise to £54', proposed_by: 'olumi',
        interventions: { fac_price: { value: 0.27, raw_value: 54, unit: 'GBP', source: 'cee_hypothesis' } } }
      : node), { id: 'opt_c', kind: 'option', label: 'Lower to £44',
        interventions: { fac_price: { value: 0.22, raw_value: 44, unit: 'GBP' } } }],
      edges: [...graph.edges, { ...graph.edges[0]!, to: 'opt_c' }, { ...graph.edges[2]!, from: 'opt_c' }] });
    let toolOutput: { ok?: boolean; detail?: string; proposal_id?: string; option?: { label?: string } } = {};
    script = [
      () => fnCall('propose_new_option', { label: 'Raise to £54', acts_on: [], rationale: 'Please add your suggestion.' }),
      (body) => {
        const out = (body['input'] as { type?: string; output?: string }[]).find((i) => i.type === 'function_call_output');
        toolOutput = JSON.parse(String(out?.output ?? '{}')) as typeof toolOutput;
        return say("Olumi suggested Raise to £54. Its £54 Price level is Olumi's estimate. Add that option to your comparison?");
      },
    ];
    const turnResult = await turn({ message: 'Please add "Raise to £54" as one of my options.' });
    expect(toolOutput.ok, JSON.stringify(toolOutput)).toBe(true);
    expect(toolOutput.proposal_id).toMatch(/^prop_[0-9a-f]+$/);
    expect(toolOutput.option?.label).toBe('Raise to £54');
    expect(inner, 'no write or held proposal').toEqual([]);
    const approve = approveChipOf(turnResult);
    expect(approve?.message).toContain('Olumi\'s suggestion');
    expect(approve?.detail).toContain("Price: 54 GBP (Olumi's suggested estimate)");
    expect(graphNow().nodes.find((node) => node.id === 'opt_b')).toMatchObject({ proposed_by: 'olumi' });

    const before = structuredClone(graphNow());
    script = [() => fnCall('authorise_change', { proposal_id: toolOutput.proposal_id }), () => say('Please use the card.')];
    const plainYes = await turn({ message: 'yes' });
    expect(plainYes._agent.tool_calls.find((call) => call.name === 'authorise_change'))
      .toMatchObject({ ok: false, mutated: false, refusal: 'approve_on_card' });
    expect(graphNow()).toEqual(before);

    script = [() => say('Included the suggestion; the old Run is stale. Run again to compare all three options.')];
    const pressed = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(pressed._agent.tool_calls.find((call) => call.name === 'authorise_change'))
      .toMatchObject({ ok: true, mutated: true });
    expect(approveChipOf(pressed), 'the applied proposal is no longer offered').toBeUndefined();
    const after = graphNow();
    expect(after.nodes.filter((node) => node.kind === 'option')).toHaveLength(3);
    expect(after.nodes.find((node) => node.id === 'opt_b')).toMatchObject({
      proposed_by: 'olumi', analysis_participation: 'included', interventions: before.nodes.find((node) => node.id === 'opt_b')!.interventions,
    });
    expect(after.edges).toEqual(before.edges);
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    expect(computeAnalysisAffectingGraphHash(after as never)).not.toBe(computeAnalysisAffectingGraphHash(before as never));
    const { filterOlumiProposedOptions } = await import('../../tools/handlers/olumi-option-filter.js');
    const submitted = after.nodes.filter((node) => node.kind === 'option');
    expect(filterOlumiProposedOptions({ graph: before, submitted }).options.map((node) => node.id)).toEqual(['opt_a', 'opt_c']);
    expect(filterOlumiProposedOptions({ graph: after, submitted }).options.map((node) => node.id)).toEqual(['opt_a', 'opt_b', 'opt_c']);
    const graphWrites = () => store.append.mock.calls.filter(([write]) => write.scenario_id === SCENARIO && write.graph !== undefined).length;
    expect(graphWrites()).toBe(1);
    const coldBodies: Record<string, unknown>[] = [];
    script = [(body) => { coldBodies.push(body); return say('The £54 suggestion now participates; its earlier Run is stale.'); }];
    await turn({ message: 'Is the £54 suggestion in my comparison now?' });
    const coldState = JSON.stringify(coldBodies[0]?.input ?? []);
    expect(coldState).toMatch(/opt_b.{0,500}proposed_by.{0,30}olumi.{0,100}analysis_participation.{0,30}included/);
    script = [() => fnCall('authorise_change', { proposal_id: toolOutput.proposal_id }), () => say('No second write.')];
    const retried = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(retried._agent.tool_calls.find((call) => call.name === 'authorise_change'))
      .toMatchObject({ ok: true, mutated: false });
    expect(graphWrites(), 'the same card cannot create a second graph version').toBe(1);
  }, 120_000);

  it('does not claim a failed adoption when the atomic write landed but its readback failed', async () => {
    const graph = seedGraph();
    graphOf.set(SCENARIO, { ...graph, nodes: graph.nodes.map((node) => node.id === 'opt_b'
      ? { ...node, label: 'Raise to £54', proposed_by: 'olumi',
        interventions: { fac_price: { value: 0.27, raw_value: 54, unit: 'GBP', source: 'cee_hypothesis' } } }
      : node) });
    script = [
      () => fnCall('propose_new_option', { label: 'Raise to £54', acts_on: [], rationale: 'Please add your suggestion.' }),
      () => say('I can offer this suggestion for your comparison.'),
    ];
    const offered = await turn({ message: 'Please add "Raise to £54" as one of my options.' });
    const approve = approveChipOf(offered)!;
    store.loadGraph.mockImplementation(async (sid: string) => {
      const current = graphOf.get(sid) as { nodes?: { analysis_participation?: string }[] } | undefined;
      if (current?.nodes?.some((node) => node.analysis_participation === 'included')) throw new Error('readback unavailable');
      return current ?? null;
    });
    try {
      const pressed = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
      expect(graphNow().nodes.find((node) => node.id === 'opt_b')?.analysis_participation).toBe('included');
      expect(pressed._agent.tool_calls.find((call) => call.name === 'authorise_change'))
        .toMatchObject({ ok: false, mutated: true, refusal: 'not_confirmed' });
      expect(pressed.assistant_text).toMatch(/could not be confirmed/i);
      expect(pressed.assistant_text).not.toMatch(/not saved|nothing was changed|not added/i);
    } finally {
      store.loadGraph.mockImplementation(async (sid: string) => graphOf.get(sid) ?? null);
    }
  }, 120_000);

  it('a unique marked £54 suggestion can be offered when the user refers to its figure without repeating its exact label', async () => {
    const graph = seedGraph();
    graphOf.set(SCENARIO, { ...graph, nodes: graph.nodes.map((node) => node.id === 'opt_b'
      ? { ...node, label: 'Raise to £54', proposed_by: 'olumi',
        interventions: { fac_price: { value: 0.27, raw_value: 54, unit: 'GBP', source: 'cee_hypothesis' } } }
      : node) });
    let output: { ok?: boolean; refusal?: string } = {};
    script = [
      () => fnCall('propose_new_option', { label: 'Raise to £54', acts_on: [], rationale: 'The user asked to include the suggestion.' }),
      (body) => {
        const out = (body['input'] as { type?: string; output?: string }[]).find((i) => i.type === 'function_call_output');
        output = JSON.parse(String(out?.output ?? '{}')) as typeof output;
        return say('I can offer the £54 suggestion for your comparison.');
      },
    ];
    const result = await turn({ message: 'Please add your £54 suggestion to my options.' });
    expect(output.ok, JSON.stringify(output)).toBe(true);
    expect(approveChipOf(result)).toBeDefined();
    expect(graphNow().nodes.find((node) => node.id === 'opt_b')?.analysis_participation).toBeUndefined();
  }, 120_000);

  it('a figure-only reference does not choose among multiple marked suggestions', async () => {
    const graph = seedGraph();
    graphOf.set(SCENARIO, { ...graph, nodes: graph.nodes.map((node) => node.kind === 'option'
      ? { ...node, proposed_by: 'olumi' }
      : node) });
    let output: { ok?: boolean; refusal?: string } = {};
    script = [
      () => fnCall('propose_new_option', { label: 'Raise to £59', acts_on: [], rationale: 'The user asked to include the suggestion.' }),
      (body) => {
        const out = (body['input'] as { type?: string; output?: string }[]).find((i) => i.type === 'function_call_output');
        output = JSON.parse(String(out?.output ?? '{}')) as typeof output;
        return say('Which suggestion do you mean?');
      },
    ];
    const result = await turn({ message: 'Please add your £59 suggestion to my options.' });
    expect(output.refusal).toBe('option_not_requested');
    expect(approveChipOf(result)).toBeUndefined();
    expect(graphNow().nodes.find((node) => node.id === 'opt_b')?.analysis_participation).toBeUndefined();
  }, 120_000);

  it('the adoption card names each existing level source without making Olumi the author of a user level', async () => {
    const graph = seedGraph(3);
    graphOf.set(SCENARIO, { ...graph, nodes: graph.nodes.map((node) => node.id === 'opt_b'
      ? { ...node, proposed_by: 'olumi', interventions: {
        fac_price: { value: 0.295, raw_value: 59, unit: 'GBP', source: 'cee_hypothesis' },
        fac_1: { value: 0.4, raw_value: 4, unit: 'units', source: 'brief_extraction' },
        fac_2: { value: 0.5, raw_value: 5, unit: 'units', source: 'user_specified' },
      } }
      : node) });
    script = [
      () => fnCall('propose_new_option', { label: 'Raise to £59', acts_on: [], rationale: 'Please add this suggestion.' }),
      () => say('I can offer this suggestion for your comparison.'),
    ];
    const result = await turn({ message: 'Please add "Raise to £59" as one of my options.' });
    const detail = approveChipOf(result)?.detail;
    expect(detail).toContain("Price: 59 GBP (Olumi's suggested estimate)");
    expect(detail).toContain('Factor 1: 4 units (from your original brief)');
    expect(detail).toContain('Factor 2: 5 units (set by you)');
  }, 120_000);

  it('keeps the approval card when a stored level has only a normalized decimal', async () => {
    const graph = seedGraph();
    graphOf.set(SCENARIO, { ...graph, nodes: graph.nodes.map((node) => node.id === 'opt_b'
      ? { ...node, label: 'Raise to £57', proposed_by: 'olumi',
        interventions: { fac_price: { value: 0.285, source: 'cee_hypothesis' } } }
      : node) });
    script = [
      () => fnCall('propose_new_option', { label: 'Raise to £57', acts_on: [], rationale: 'Please add your suggestion.' }),
      () => say('I can offer this suggestion for your comparison.'),
    ];
    const offered = await turn({ message: 'Please add "Raise to £57" as one of my options.' });
    const approve = approveChipOf(offered);
    expect(approve, 'the finalised response keeps the approval button').toBeDefined();
    expect(approve?.label).toBe('Add this suggestion to my comparison');
    expect(approve?.detail).toContain("Price: 57 GBP (Olumi's suggested estimate)");
    expect(graphNow().nodes.find((node) => node.id === 'opt_b')?.analysis_participation).toBeUndefined();
  }, 120_000);

  it('[q5] RED (DL #70 5846812818, served F4/F4e): TWO options in one request, one a twin of "Raise to £59" → the valid one is still proposed as ONE change with ONE chip, the twin is named as not added, and approving adds only the valid one', async () => {
    graphOf.set(SCENARIO, seedGraph());
    let toolOutput: { ok?: boolean; refusal?: string; not_added?: { option: string; same_levels_as: string }[]; not_added_note?: string; options?: unknown; option?: { label?: string } } = {};
    script = [
      () => fnCall('propose_new_option', { options: [
        { label: 'Test £59 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 59, unit: 'GBP' } }] },
        { label: 'Test £54 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }] },
      ], rationale: 'The user asked for both.' }),
      (body) => {
        const out = (body['input'] as { type?: string; output?: string }[]).find((i) => i.type === 'function_call_output');
        toolOutput = JSON.parse(String(out?.output ?? '{}')) as typeof toolOutput;
        return say('I can add "Test £54 at release"; "Test £59 at release" would repeat "Raise to £59". Add the £54 one?');
      },
    ];
    const t1 = await turn({ message: 'Add two options: test £59 at release, and test £54 at release.' });
    expect(toolOutput.ok, JSON.stringify(toolOutput)).toBe(true);
    expect(toolOutput.not_added).toEqual([{ option: 'Test £59 at release', same_levels_as: 'Raise to £59' }]);
    expect(toolOutput.not_added_note).toMatch(/Never promise to add it later/);
    expect(toolOutput.option?.label).toBe('Test £54 at release');
    const approve = approveChipOf(t1);
    expect(approve, 'ONE approve chip for the valid option').toBeDefined();
    await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    const labels = graphNow().nodes.filter((x) => x.kind === 'option').map((x) => x.label);
    expect(labels).toContain('Test £54 at release');
    expect(labels).not.toContain('Test £59 at release');
    expect(graphNow().edges.some((e) => e.from === 'dec_x' && e.to === newOption()!.id), 'linked from the decision').toBe(true);
  }, 120_000);

  it('a batch can prepare the distinct option without promising adoption of a marked Olumi twin', async () => {
    const graph = seedGraph();
    graphOf.set(SCENARIO, { ...graph, nodes: graph.nodes.map((node) => node.id === 'opt_b'
      ? { ...node, proposed_by: 'olumi' }
      : node) });
    let toolOutput: { ok?: boolean; not_added_note?: string; option?: { label?: string } } = {};
    script = [
      () => fnCall('propose_new_option', { options: [
        { label: 'Test £59 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 59, unit: 'GBP' } }] },
        { label: 'Test £54 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }] },
      ], rationale: 'The user asked for both.' }),
      (body) => {
        const out = (body['input'] as { type?: string; output?: string }[]).find((i) => i.type === 'function_call_output');
        toolOutput = JSON.parse(String(out?.output ?? '{}')) as typeof toolOutput;
        return say("The £59 one is Olumi's suggestion and cannot be adopted yet. I can prepare the distinct £54 option for approval.");
      },
    ];
    const turnResult = await turn({ message: 'Add both the £59 suggestion and a new £54 option.' });
    expect(toolOutput.ok).toBe(true);
    expect(toolOutput.option?.label).toBe('Test £54 at release');
    expect(toolOutput.not_added_note).toContain("Olumi's suggestion, not compared as yours");
    expect(toolOutput.not_added_note).toContain('adoption is unavailable');
    expect(toolOutput.not_added_note).not.toContain('it is added only by a new proposal');
    expect(approveChipOf(turnResult)).toBeDefined();
  }, 120_000);

  it('[q6] RED (DL #70 5846924842, served BF5): the user gives a level for an option NOT linked to Price → ONE proposal carries the link and the level → one click → the REAL product adds the link and records the level (never "once approved, I can record…")', async () => {
    const g = seedGraph();
    g.nodes.push({ id: 'opt_c', kind: 'option', label: 'Cohort test' } as never);
    g.edges.push({ from: 'dec_x', to: 'opt_c', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
    graphOf.set(SCENARIO, g);
    let toolOutput: { ok?: boolean; adds_links_note?: string; not_linked?: unknown } = {};
    script = [
      () => fnCall('propose_option_interventions', { interventions: [{ option_label: 'Cohort test', factor_label: 'Price', value: 54, basis: 'the user said £54', user_stated: true }] }),
      (body) => {
        const out = (body['input'] as { type?: string; output?: string }[]).find((i) => i.type === 'function_call_output');
        toolOutput = JSON.parse(String(out?.output ?? '{}')) as typeof toolOutput;
        return say('This links Cohort test to Price and records £54. Approve?');
      },
    ];
    const t1 = await turn({ message: 'The cohort test is £54 on Pro plan price.' });
    expect(toolOutput.ok, JSON.stringify(toolOutput)).toBe(true);
    expect(toolOutput.not_linked).toBeUndefined();
    expect(toolOutput.adds_links_note).toMatch(/also adds that link/);
    const approve = approveChipOf(t1);
    expect(approve, 'ONE approve chip').toBeDefined();
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    // What the user reads: the level is saved — never "Not saved" for a level the model now holds.
    expect(String(t2.assistant_text), String(t2.assistant_text)).not.toMatch(/Not saved|Partly saved|could not/i);
    const after = graphNow();
    expect(after.edges.some((e) => e.from === 'opt_c' && e.to === 'fac_price'), 'the link was added').toBe(true);
    const lvl = after.nodes.find((x) => x.id === 'opt_c')?.interventions?.['fac_price'] as { raw_value?: unknown; value?: unknown } | undefined;
    expect(lvl, JSON.stringify(after.nodes.find((x) => x.id === 'opt_c'))).toBeDefined();
    expect(Number(lvl!.value)).toBeCloseTo(54 / 200, 6);
  }, 120_000);

  it('[p3] RED: a factor with no range at all — the user\'s £54 cannot be stored on one, so the level is left UNSET (never a bare 54) and the Agent is told why', async () => {
    graphOf.set(SCENARIO, seedGraph(1, 1, 'none'));
    let proposed = '';
    script = [
      () => fnCall('propose_new_option', { label: 'Test £54 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }], rationale: 'The user asked for it.' }),
      (body) => { proposed = JSON.stringify(body['input']); return say('I would add it; the price level needs a range first. Shall I add it?'); },
    ];
    const t1 = await turn({ message: 'Add an option: test £54 at release.' });
    expect(proposed, proposed.slice(-1200)).toMatch(/levels_not_set/);
    const approve = approveChipOf(t1)!;
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(graphNow().edges.some((e) => e.from === 'dec_x' && e.to === newOption()!.id), 'still linked from the decision').toBe(true);
    expect(JSON.stringify(newOption()!.interventions ?? {}), 'no number stored without a range').not.toMatch(/\d/);
  }, 120_000);

  it('[F4] RED: "add two options" → ONE proposal carrying both → ONE button → one click → BOTH added, each linked from the decision and levelled, runnable, OpenAI only', async () => {
    graphOf.set(SCENARIO, seedGraph());
    script = [
      () => fnCall('propose_new_option', { options: [
        { label: 'Test £54 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }] },
        { label: 'Raise to £64 for new customers', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 64, unit: 'GBP' } }] },
      ], rationale: 'The user asked for both.' }),
      () => say('I would add both options, each linked from the decision. Shall I add them?'),
    ];
    const t1 = await turn({ message: 'Add two options: test £54 at release, and raise to £64 for new customers.' });
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify({ chips: t1.suggested_actions, tools: t1._agent.tool_calls })).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect(t1.suggested_actions.filter((c) => c.id.startsWith('agent-approve-proposal:')), 'exactly ONE approve button').toHaveLength(1);
    expect(inner.filter((b) => (b['chip'] as { intent?: string } | undefined)?.intent === 'add_option'), 'ONE inner add').toHaveLength(1);
    const held = await heldOnLatestRow();
    expect(held, 'ONE hold').toHaveLength(1);
    const added = held[0]!.action.inline_patch!.operations!.filter((o) => o.op === 'add_node').map((o) => o.path);
    expect(added, 'the hold carries BOTH options').toHaveLength(2);

    const callsBefore = openAiCalls;
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(openAiCalls - callsBefore, 'a typed approval makes no model call').toBe(0);
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const g = graphNow();
    for (const [label, level] of [['Test £54 at release', 0.27], ['Raise to £64 for new customers', 0.32]] as const) {
      const opt = g.nodes.find((x) => x.kind === 'option' && x.label === label);
      expect(opt, label).toBeDefined();
      expect(g.edges.some((e) => e.from === 'dec_x' && e.to === opt!.id), `${label}: linked FROM THE DECISION`).toBe(true);
      expect(((opt!.interventions ?? {})['fac_price'] as { value?: number } | undefined)?.value, label).toBeCloseTo(level, 6);
    }
    expect((await readiness())?.may_run, 'runnable after the add').toBe(true);
    expect(await heldOnLatestRow(), 'the hold is consumed').toEqual([]);
    expect(t2.assistant_text, t2.assistant_text).toMatch(/Added "Test £54 at release".*Added "Raise to £64 for new customers"/s);
    expect(routerCalls).toEqual([]);
    for (const b of [t1, t2]) for (const pc of b._provider_calls ?? []) expect(pc.provider).toBe('openai');
  }, 120_000);

  it('[F4] the hold the store keeps must add EVERY option asked for — a hold missing one is never offered', async () => {
    graphOf.set(SCENARIO, seedGraph());
    // After route-v2 answers the propose, the stored hold loses the second option (its node and every op after it).
    onInnerSent = (b) => {
      if ((b['chip'] as { intent?: string } | undefined)?.intent !== 'add_option') return;
      const row = latestRow();
      const pa = (row?.pending_actions ?? [])[0] as { action?: { inline_patch?: { operations?: { op: string }[] } } } | undefined;
      const ops = pa?.action?.inline_patch?.operations;
      if (ops === undefined) return;
      const second = ops.findIndex((o, i) => i > 0 && o.op === 'add_node');
      if (second > 0) pa!.action!.inline_patch!.operations = ops.slice(0, second);
    };
    script = [
      () => fnCall('propose_new_option', { options: [
        { label: 'Test £54 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }] },
        { label: 'Raise to £64 for new customers', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 64, unit: 'GBP' } }] },
      ], rationale: 'x' }),
      () => say('That could not be prepared.'),
    ];
    const t1 = await turn({ message: 'Add both.' });
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_new_option'), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, refusal: 'not_prepared' }));
    expect(approveChipOf(t1)).toBeUndefined();
  }, 120_000);

  it('[F4] all or nothing: one option in the batch cannot be prepared (it names a factor the model does not have) → NOTHING is prepared or sent', async () => {
    graphOf.set(SCENARIO, seedGraph());
    script = [
      () => fnCall('propose_new_option', { options: [
        { label: 'Test £54 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }] },
        { label: 'Bundle support', acts_on: [{ factor_label: 'Support quality', direction: 'positive' }] },
      ], rationale: 'x' }),
      () => say('One of those could not be prepared.'),
    ];
    const t1 = await turn({ message: 'Add both.' });
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_new_option'), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false }));
    expect(inner, 'nothing sent').toEqual([]);
    expect(approveChipOf(t1)).toBeUndefined();
  }, 120_000);

  it('[F4] more options than one change can carry (5 > 4) → refused in plain words, nothing sent', async () => {
    graphOf.set(SCENARIO, seedGraph());
    script = [
      () => fnCall('propose_new_option', { options: Array.from({ length: 5 }, (_, i) => ({ label: `Price point ${i + 1}`, acts_on: [{ factor_label: 'Price', direction: 'positive' }] })), rationale: 'x' }),
      () => say('That is more than one change can carry.'),
    ];
    const t1 = await turn({ message: 'Add five price points.' });
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_new_option')).toEqual(expect.objectContaining({ ok: false, refusal: 'too_many_options' }));
    expect(inner).toEqual([]);
  }, 120_000);

  it('two options asked for in one turn → the FIRST is held and offered (one button), the second is refused in plain words — never zero buttons', async () => {
    graphOf.set(SCENARIO, seedGraph());
    script = [
      () => fnCall('propose_new_option', { label: 'Test £54 at release', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }], rationale: 'x' }),
      () => fnCall('propose_new_option', { label: 'Keep £49 with an add-on', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 49, unit: 'GBP' } }], rationale: 'y' }),
      () => say('I have prepared the first option; I will add the second after you approve it.'),
    ];
    const t1 = await turn({ message: 'Add two options: test £54 at release, and keep £49 with an add-on.' });
    const calls = t1._agent.tool_calls.filter((c) => c.name === 'propose_new_option');
    expect(calls.map((c) => c.ok), JSON.stringify(calls)).toEqual([true, false]);
    // The loop's one-change-per-approval rule refuses it before the capability's own `one_option_per_approval` check.
    expect(calls[1]).toEqual(expect.objectContaining({ refusal: 'one_change_per_approval' }));
    expect(t1.suggested_actions.filter((c) => c.id.startsWith('agent-approve-proposal:gmh_')), 'exactly ONE approve button').toHaveLength(1);
    expect(inner.filter((b) => (b['chip'] as { intent?: string } | undefined)?.intent === 'add_option'), 'one inner add').toHaveLength(1);
  }, 120_000);

  it('refuses, and sends NOTHING, when the model has no single decision to link the option from', async () => {
    graphOf.set(SCENARIO, seedGraph(1, 2));
    const t1 = await proposeOptionC(54);
    const call = t1._agent.tool_calls.find((c) => c.name === 'propose_new_option');
    expect(call).toEqual(expect.objectContaining({ ok: false, refusal: 'no_single_decision' }));
    expect(inner, 'no inner turn').toEqual([]);
    expect(approveChipOf(t1)).toBeUndefined();
  }, 120_000);

  it('[F4] an option acting on 7 factors (9 changes) is HELD — the typed transaction\'s cap, not the model-batch cap of 8', async () => {
    graphOf.set(SCENARIO, seedGraph(7));
    script = [
      () => fnCall('propose_new_option', { label: 'Broad relaunch', acts_on: Array.from({ length: 7 }, (_, i) => ({ factor_label: i === 0 ? 'Price' : `Factor ${i}`, direction: 'positive' })), rationale: 'x' }),
      () => say('Shall I add it?'),
    ];
    const t1 = await turn({ message: 'Add a broad relaunch option.' });
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_new_option'), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true }));
    expect(approveChipOf(t1)?.id).toMatch(/gmh_/);
  }, 120_000);

  it('refuses, and sends NOTHING, a change too large to hold as one (over the typed transaction\'s 32-change cap)', async () => {
    graphOf.set(SCENARIO, seedGraph(31));
    script = [
      () => fnCall('propose_new_option', { label: 'Everything at once', acts_on: Array.from({ length: 31 }, (_, i) => ({ factor_label: i === 0 ? 'Price' : `Factor ${i}`, direction: 'positive' })), rationale: 'x' }),
      () => say('That is too many links for one change.'),
    ];
    const t1 = await turn({ message: 'Add an option that changes everything.' });
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_new_option')).toEqual(expect.objectContaining({ ok: false, refusal: 'too_many_links' }));
    expect(inner).toEqual([]);
  }, 120_000);

  // ─── A1 (DL build train #70 5855068711; Canonical 5854919806 item 1; AIQ 5854838919) ───────────────────────────────
  // Paul's grandfathering add on HIS persisted graph (scenario a295e4a1, with that one transaction removed — see the
  // fixture's `_provenance`), through the whole product: the Agent's propose → route-v2's typed hold → the UI-shaped
  // approval → turn-executor's `commitGmHeldResume` → ONE commit.
  const PAUL = (() => {
    const fx = JSON.parse(readFileSync(new URL('../../routing/__tests__/fixtures/paul-a295e4a1-before-grandfathering.json', import.meta.url), 'utf8')) as Record<string, unknown>;
    const { _provenance: _p, ...graph } = fx;
    return graph;
  })();
  const GRANDFATHER = '£59 for new Pro customers; grandfather existing customers';
  const SWITCH_FAC = 'fac_existing_customers_grandfathered';
  /**
   * ⛔ AIQ (c) (#70 5859422189; DL on #2132 @510bfa00): what an option COMMITS for a new switch it turns on — 1, and
   * never Olumi's estimate (`cee_hypothesis`): the on-state is structural. Every accepted form (no level, a bare 1,
   * `{ 1, estimate: true }`) is bound to this ONE object, so they are stored identically.
   */
  const ON_LEVEL = (id: string) => ({ value: 1, source: 'user_specified', target_match: { node_id: id, match_type: 'exact_id', confidence: 'high' } });
  const proposeGrandfathering = (kind: 'switch' | undefined) => {
    script = [
      () => fnCall('propose_new_option', {
        label: GRANDFATHER,
        acts_on: [
          { factor_label: 'Pro plan price', direction: 'positive', level: { value: 59, unit: 'GBP per month' } },
          { factor_label: 'Existing customers grandfathered', direction: 'positive' },
        ],
        new_factors: [{ label: 'Existing customers grandfathered', ...(kind !== undefined ? { kind } : {}),
          affects: [{ label: 'Monthly churn', direction: 'negative' }, { label: 'MRR', direction: 'negative' }] }],
        rationale: 'The user asked for it.',
      }),
      () => say('I would add it. Shall I?'),
    ];
    return turn({ message: `Let's add ${GRANDFATHER}.` });
  };

  it('[A1] RED: Paul\'s grandfathering option as a SWITCH → one hold → one click → off today (Olumi\'s), on under the option, in ONE commit', async () => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeGrandfathering('switch');
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    const held = await heldOnLatestRow();
    expect((held[0]!.action.inline_patch as Record<string, unknown>)['switch_factors']).toEqual([SWITCH_FAC]);
    expect(graphNow().nodes.some((x) => x.id === SWITCH_FAC), 'nothing is written before the approval').toBe(false);

    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const g = graphNow() as unknown as { nodes: Record<string, any>[] };
    const factor = g.nodes.find((x) => x.id === SWITCH_FAC)!;
    expect(factor.observed_state).toEqual({ value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' });
    const option = g.nodes.find((x) => x.kind === 'option' && x.label === GRANDFATHER)!;
    expect(option.interventions[SWITCH_FAC]).toEqual(ON_LEVEL(SWITCH_FAC));
    // ⭐ A6b (DL CR on #2131, option (a)): Paul TYPED the option ("Let's add £59 for new Pro customers; …"), so it is
    // his; the switch is a factor OLUMI minted for it, and approving it keeps Olumi's node provenance.
    expect(option.provenance, 'the option Paul named').toBe('user_set');
    expect(factor.provenance, 'the switch Olumi minted').toBe('ai_inferred');
    // The approval said what was committed: off today is Olumi's, for the user to correct — never asked for (#2103's one ask).
    expect(t2.assistant_text).toContain('Olumi takes it as off today and the option switches it on');
    expect(t2.assistant_text).not.toMatch(/Tell me (its value today|today's value)/);
    const r = await readiness() as { readiness_issues?: { code: string; option_id?: string }[] } | undefined;
    expect((r?.readiness_issues ?? []).filter((i) => i.option_id === option.id && i.code === 'MISSING_OPTION_VALUE')).toEqual([]);
    expect(routerCalls).toEqual([]);
  }, 120_000);

  // ⭐ R2 (DL #72 5862693164): a new factor's links are sized by the FIRST MODEL's own rule (D6 `frameAwarePlaceholder`),
  // never `hypothesisEdgeValue`'s flat ±0.5. Served journey A: the grandfathering switch → Monthly churn at −0.5 moved
  // churn by −50 points from 3%, 80% of the leader's draws fell out of churn's domain, and the churn limit withheld it.
  // Paul's graph: churn 0.03 in "% per month" (domain [0, 1]) → −min(0.5, 0.03/4) = −0.0075; MRR 0.6 in "GBP MRR"
  // (money, [0, ∞)) → −min(0.5, 0.6/4) = −0.15. Each std is |mean|/2, stamped `olumi_placeholder`.
  const linkOf = (g: { edges: Record<string, any>[] }, from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to)!;

  it('[R2] RED: the grandfathering SWITCH\'s links are committed at the first model\'s D6 size, never the flat −0.5', async () => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeGrandfathering('switch');
    const approve = approveChipOf(t1)!;
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: true }));
    const g = graphNow() as unknown as { edges: Record<string, any>[] };
    const churn = linkOf(g, SWITCH_FAC, 'monthly_churn');
    expect(churn.strength.mean).toBeCloseTo(-0.0075, 12);
    expect(churn.strength.std).toBeCloseTo(0.00375, 12);
    expect(churn.provenance).toEqual(expect.objectContaining({ source: 'cee_hypothesis', magnitude: 'olumi_placeholder' }));
    expect(churn.defaulted).toBe(true);
    const mrr = linkOf(g, SWITCH_FAC, 'mrr');
    expect(mrr.strength.mean).toBeCloseTo(-0.15, 12);
    expect(mrr.strength.std).toBeCloseTo(0.075, 12);
  }, 120_000);

  it.each([['switch' as const]])('[R2] the committed new-factor links (%s) ARE the first model\'s rule: re-sizing them again changes nothing', async (kind) => {
    const { frameDefaultedLinks } = await import('../../../cee/magnitude/frame-defaulted-links.js');
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeGrandfathering(kind);
    const approve = approveChipOf(t1)!;
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    const g = graphNow() as unknown as { edges: Record<string, any>[] };
    expect(g.edges.some((e) => e.from === SWITCH_FAC), 'the factor and its links landed').toBe(true);
    // By VALUE: `frameDefaultedLinks` compares `natural_effect` with JSON.stringify, so the persisted key order alone makes it
    // list a link as re-sized (pre-existing; disclosed on the PR). The claim here is that the numbers are the rule's.
    const again = frameDefaultedLinks(structuredClone(g), SWITCH_FAC).graph as { edges: Record<string, any>[] };
    const own = (x: { edges: Record<string, any>[] }) => x.edges.filter((e) => e.from === SWITCH_FAC);
    expect(own(again)).toEqual(own(g));
  }, 120_000);

  it('[R2] CONTRAST: a GRADED new factor keeps its own path — its links commit at the default, re-sized when its level arrives', async () => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeGrandfathering(undefined);
    const approve = approveChipOf(t1)!;
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    const churn = linkOf(graphNow() as unknown as { edges: Record<string, any>[] }, SWITCH_FAC, 'monthly_churn');
    expect(churn.strength).toEqual({ mean: -0.5, std: 0.125 });
  }, 120_000);

  it('[A1] CONTRAST: the same add with no kind (graded) lands exactly as before — no today value, the level asked for', async () => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeGrandfathering(undefined);
    const approve = approveChipOf(t1)!;
    expect((((await heldOnLatestRow())[0]!.action.inline_patch) as Record<string, unknown>)['switch_factors']).toBeUndefined();
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0]).toEqual(expect.objectContaining({ ok: true, mutated: true }));
    const g = graphNow() as unknown as { nodes: Record<string, any>[] };
    expect(g.nodes.find((x) => x.id === SWITCH_FAC)!.observed_state).toBeUndefined();
    const option = g.nodes.find((x) => x.kind === 'option' && x.label === GRANDFATHER)!;
    expect(option.interventions[SWITCH_FAC]).toBeUndefined();
    expect(t2.assistant_text).toContain('Tell me its value today and I\'ll record it.');
    expect(t2.assistant_text).not.toContain('Olumi takes it as off today');
  }, 120_000);

  /**
   * ⛔ [A1] EVERY ENTRY NAMING THE SWITCH IS READ; A FACTOR IS NAMED ONCE PER OPTION (independent verification of A1 r2,
   * VERIFIER-S1; staging CEE #2107). Through the whole product: a bare entry for the switch followed by `{1, '%'}` was
   * held, approved and committed — today-0 as Olumi's, the option at a bare 1, the user's "1%" dropped — while the
   * reverse order was refused. Both orders are now refused before anything reaches route-v2; so is a factor named twice.
   */
  const keyed = (x: unknown): string => {
    const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort)
      : v !== null && typeof v === 'object' ? Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v);
    return JSON.stringify(sort(x));
  };
  const proposeSwitchEntries = (switchEntries: Record<string, unknown>[]) => {
    script = [
      () => fnCall('propose_new_option', {
        label: GRANDFATHER,
        acts_on: [
          { factor_label: 'Pro plan price', direction: 'positive', level: { value: 59, unit: 'GBP per month' } },
          ...switchEntries.map((e) => ({ factor_label: 'Existing customers grandfathered', direction: 'positive', ...e })),
        ],
        new_factors: [{ label: 'Existing customers grandfathered', kind: 'switch',
          affects: [{ label: 'Monthly churn', direction: 'negative' }, { label: 'MRR', direction: 'negative' }] }],
        rationale: 'The user asked for it.',
      }),
      () => say('I could not add it as asked.'),
    ];
    return turn({ message: `Let's add ${GRANDFATHER}.` });
  };

  it.each([
    ['bare first, then 1%', [{}, { level: { value: 1, unit: '%' } }], 'switch_level_not_on'],
    ['1% first, then bare', [{ level: { value: 1, unit: '%' } }, {}], 'switch_level_not_on'],
    ['two bare 1s', [{ level: { value: 1 } }, { level: { value: 1 } }], 'duplicate_acts_on'],
  ])('[A1] RED: the switch named twice (%s) → refused, nothing sent to route-v2, no hold, the stored graph byte-identical', async (_name, entries, refusal) => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const before = keyed(graphNow());
    const t1 = await proposeSwitchEntries(entries as Record<string, unknown>[]);
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_new_option'), JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, refusal }));
    expect(inner).toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(approveChipOf(t1)).toBeUndefined();
    expect(keyed(graphNow())).toBe(before);
    expect(routerCalls).toEqual([]);
  }, 120_000);

  it('[A1] CONTRAST: ONE entry for the switch with a bare level 1 → held, approved, committed: off today as cee_inference, on (1) under the option', async () => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeSwitchEntries([{ level: { value: 1 } }]);
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect((((await heldOnLatestRow())[0]!.action.inline_patch) as Record<string, unknown>)['switch_factors']).toEqual([SWITCH_FAC]);
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const g = graphNow() as unknown as { nodes: Record<string, any>[] };
    expect(g.nodes.find((x) => x.id === SWITCH_FAC)!.observed_state).toEqual({ value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' });
    expect(g.nodes.find((x) => x.kind === 'option' && x.label === GRANDFATHER)!.interventions[SWITCH_FAC]).toEqual(ON_LEVEL(SWITCH_FAC));
    expect(routerCalls).toEqual([]);
  }, 120_000);

  /**
   * ⛔ [A1] SERVED (OpenAI Runtime #70 5859406197; X3 on CEE cd489f1): journey A's add-two-options was NOT DONE in 3/3
   * runs — `propose_new_option` refused `switch_level_not_on`, the Agent retried with a level, refused again. Suspected
   * (UNVERIFIED: no tool arguments are kept) `{ value: 1, estimate: true }` after "just add them with your assumptions".
   * A numeric 1 with no unit is ON: one hold, one click, each option switches its own switch on, and each switch's
   * today-0 is Olumi's (`cee_inference`) — through the real route-v2, as served.
   */
  const ANNUAL_OPT = '£54 for new Pro customers; offer an annual plan';
  const ANNUAL_FAC = 'fac_annual_plan_offered';
  const proposeTwoSwitchOptions = (level: unknown, graded = false) => {
    script = [
      () => fnCall('propose_new_option', {
        options: [
          { label: GRANDFATHER, acts_on: [
            { factor_label: 'Pro plan price', direction: 'positive', level: { value: 59, unit: 'GBP per month' } },
            { factor_label: 'Existing customers grandfathered', direction: 'positive', level }] },
          { label: ANNUAL_OPT, acts_on: [
            { factor_label: 'Pro plan price', direction: 'positive', level: { value: 54, unit: 'GBP per month' } },
            { factor_label: 'Annual plan offered', direction: 'positive', level }] },
        ],
        new_factors: [
          { label: 'Existing customers grandfathered', ...(graded ? {} : { kind: 'switch' }),
            affects: [{ label: 'Monthly churn', direction: 'negative' }, { label: 'MRR', direction: 'negative' }] },
          { label: 'Annual plan offered', ...(graded ? {} : { kind: 'switch' }),
            affects: [{ label: 'Monthly churn', direction: 'negative' }] },
        ],
        rationale: 'The user asked for both, with Olumi\u2019s assumptions.',
      }),
      () => say('I would add both. Shall I?'),
    ];
    return turn({ message: `Add two options: ${GRANDFATHER}, and ${ANNUAL_OPT}. Just add them with your assumptions.` });
  };

  it('[A1] RED (served shape): two options, each a new switch at { value: 1, estimate: true } → ONE proposal, 0 refusals → one click → both on, both today-0 as cee_inference', async () => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeTwoSwitchOptions({ value: 1, estimate: true, basis: 'the option turns it on' });
    const calls = t1._agent.tool_calls;
    expect(calls.filter((c) => c.name === 'propose_new_option'), JSON.stringify(calls)).toEqual([expect.objectContaining({ ok: true })]);
    expect(calls.filter((c) => c.refusal !== undefined), JSON.stringify(calls)).toEqual([]);
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect((((await heldOnLatestRow())[0]!.action.inline_patch) as Record<string, unknown>)['switch_factors']).toEqual([SWITCH_FAC, ANNUAL_FAC]);
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const g = graphNow() as unknown as { nodes: Record<string, any>[] };
    for (const id of [SWITCH_FAC, ANNUAL_FAC]) {
      expect(g.nodes.find((x) => x.id === id)?.observed_state, id).toEqual({ value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' });
    }
    // ⛔ AIQ (c) (#70 5859422189): the accepted { 1, estimate: true } is STORED as the structural on-level — no estimate
    // stamp, exactly as a bare 1 is (the CONTRAST row above) — and the approval never calls it Olumi's estimate.
    expect(g.nodes.find((x) => x.kind === 'option' && x.label === GRANDFATHER)!.interventions[SWITCH_FAC]).toEqual(ON_LEVEL(SWITCH_FAC));
    expect(g.nodes.find((x) => x.kind === 'option' && x.label === ANNUAL_OPT)!.interventions[ANNUAL_FAC]).toEqual(ON_LEVEL(ANNUAL_FAC));
    expect(t2.assistant_text).not.toMatch(/Its level for [^.]*is Olumi.s estimate/);
    expect(routerCalls).toEqual([]);
  }, 120_000);

  /**
   * [A1] WHAT THE MODEL SENT reaches `_agent.tool_calls`: a refused call carries its conflict fields, so the next served
   * run shows which part of the level fired (unit, estimate, a non-number, a number other than 1) — names only, no payload.
   */
  it.each([
    ["{ 1, '%' }", { value: 1, unit: '%' }, ['unit']],
    ["'0.5'", { value: '0.5' }, ['non_number']],
    ['{ 2, estimate: true }', { value: 2, estimate: true, basis: 'a guess' }, ['not_one', 'estimate']],
  ])('[A1] RED: a refused switch level %s → nothing sent to route-v2, and its _agent.tool_calls entry carries conflict_fields', async (_name, level, fields) => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const before = keyed(graphNow());
    const t1 = await proposeTwoSwitchOptions(level);
    expect(t1._agent.tool_calls.find((c) => c.name === 'propose_new_option'), JSON.stringify(t1._agent.tool_calls))
      .toEqual(expect.objectContaining({ ok: false, refusal: 'switch_level_not_on', conflict_fields: fields }));
    expect(inner).toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(keyed(graphNow())).toBe(before);
  }, 120_000);

  /**
   * [R7] (DL #72 5862693164) the refused entry ITSELF reaches `_agent.tool_calls`: the loop grew 1 → 2 → 7 → 10 refusals with
   * `conflict_fields: ["unit","estimate"]` and no arguments kept. The served shape is inferred as { 1, a unit, estimate };
   * whatever it is, the next run now shows it. Labels and the level's scalars only: never the basis. The served shapes it
   * then showed — `{1, 'binary'}`, `{1, 'enabled', estimate: true}` — are ON since switch-loop step 2, so the refused
   * shape here is a 1 in a QUANTITY unit with an estimate, which fires the same two fields.
   */
  it('[R7] RED: a refused switch level → its _agent.tool_calls entry keeps what was sent (option, factor, value, unit, estimate), never the basis', async () => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeTwoSwitchOptions({ value: 1, unit: 'GBP', estimate: true, basis: 'the user said grandfather them' });
    const call = t1._agent.tool_calls.find((c) => c.name === 'propose_new_option')!;
    expect(call, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, refusal: 'switch_level_not_on', conflict_fields: ['unit', 'estimate'] }));
    expect(call.rejected_levels, JSON.stringify(call)).toEqual(expect.arrayContaining([
      { option: GRANDFATHER, factor: 'Existing customers grandfathered', value: 1, unit: 'GBP', estimate: true },
    ]));
    for (const r of call.rejected_levels!) expect(Object.keys(r).sort()).toEqual(['estimate', 'factor', 'option', 'unit', 'value']);
    expect(JSON.stringify(call)).not.toContain('the user said grandfather them');
  }, 120_000);

  it('[R7] CONTRAST: a call that was not refused carries no rejected_levels', async () => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeSwitchEntries([{ level: { value: 1 } }]);
    const call = t1._agent.tool_calls.find((c) => c.name === 'propose_new_option')!;
    expect(call, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true }));
    expect(call).not.toHaveProperty('rejected_levels');
  }, 120_000);

  /**
   * ⛔ [A1] SERVED (DL run pj-20260927T233309Z on CEE e09b8c2, journey A step A05): "Let's add the grandfathering of
   * existing customers: …". SIX `propose_new_option` calls, every one refused `switch_level_not_on`, then hop_limit
   * (~20 s, "I was not able to finish that"). A06 re-modelled the switch as a graded factor "at 100%", so the refused
   * level was almost certainly `{ value: 100, unit: '%…' }` — fully on (UNVERIFIED: the served record kept no
   * arguments). Exactly 100 in a percent-class unit MEANS on: ONE call, a held proposal, the option switches it on.
   */
  it('[A1] R6 RED (A05 shape): the switch at { 100, "% of existing Pro customers" } → ONE propose_new_option call, no refusal, held → one click → on (1), structural', async () => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeSwitchEntries([{ level: { value: 100, unit: '% of existing Pro customers' } }]);
    const calls = t1._agent.tool_calls;
    expect(calls.filter((c) => c.name === 'propose_new_option'), JSON.stringify(calls)).toEqual([expect.objectContaining({ ok: true })]);
    expect(calls.filter((c) => c.refusal !== undefined), JSON.stringify(calls)).toEqual([]);
    // R5 CONTRAST: a call that was not refused carries no conflict_fields.
    expect(calls.find((c) => c.name === 'propose_new_option')).not.toHaveProperty('conflict_fields');
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect((((await heldOnLatestRow())[0]!.action.inline_patch) as Record<string, unknown>)['switch_factors']).toEqual([SWITCH_FAC]);
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const g = graphNow() as unknown as { nodes: Record<string, any>[] };
    expect(g.nodes.find((x) => x.id === SWITCH_FAC)!.observed_state).toEqual({ value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' });
    // The 100% is not written as a figure: the option's level on the switch is the structural ON, as a bare 1's is.
    expect(g.nodes.find((x) => x.kind === 'option' && x.label === GRANDFATHER)!.interventions[SWITCH_FAC]).toEqual(ON_LEVEL(SWITCH_FAC));
    expect(routerCalls).toEqual([]);
  }, 120_000);

  /**
   * [A1] R5: a refused call's served `_agent.tool_calls` entry names WHICH fields fired — names only, never the figure.
   * (Already GREEN at this branch's base: the plumbing landed with A1 round 4 and was not in served e09b8c2. Pinned by the
   * drop-conflict_fields mutant.)
   */
  it.each([
    ["{ 50, '%' }", { value: 50, unit: '%' }, ['unit', 'not_one']],
    ["{ 59, 'GBP' }", { value: 59, unit: 'GBP' }, ['unit', 'not_one']],
    ["{ 1, '%' }", { value: 1, unit: '%' }, ['unit']],
  ])('[A1] R5: a refused switch level %s → its _agent.tool_calls entry carries conflict_fields (names only), nothing sent', async (_name, level, fields) => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeSwitchEntries([{ level }]);
    const refused = t1._agent.tool_calls.find((c) => c.name === 'propose_new_option');
    expect(refused, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, refusal: 'switch_level_not_on', conflict_fields: fields }));
    // The figure is in ONE place only, `rejected_levels` (R7, DL #72 5862693164: the refused entry as sent); the rest of
    // the record stays identity only.
    const { rejected_levels: sent, ...identity } = refused as Record<string, unknown>;
    expect(JSON.stringify(identity)).not.toMatch(/"value"|"unit"\s*:|GBP|%/);
    expect(sent).toEqual([expect.objectContaining({ value: (level as { value: unknown }).value, unit: (level as { unit: unknown }).unit })]);
    expect(inner).toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]);
  }, 120_000);

  it('[A1] CONTRAST: the same two options with GRADED new factors → committed with no level and no today value — never 0', async () => {
    graphOf.set(SCENARIO, structuredClone(PAUL));
    const t1 = await proposeTwoSwitchOptions({ value: 1, estimate: true, basis: 'a guess' }, true);
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    const g = graphNow() as unknown as { nodes: Record<string, any>[] };
    for (const id of [SWITCH_FAC, ANNUAL_FAC]) {
      expect(g.nodes.find((x) => x.id === id), id).toBeDefined();
      expect(g.nodes.find((x) => x.id === id)!.observed_state, id).toBeUndefined();
    }
    expect(g.nodes.find((x) => x.kind === 'option' && x.label === GRANDFATHER)!.interventions[SWITCH_FAC]).toBeUndefined();
    expect(g.nodes.find((x) => x.kind === 'option' && x.label === ANNUAL_OPT)!.interventions[ANNUAL_FAC]).toBeUndefined();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // ⭐ A6b (DL CR on #2131 @ a86820f5, option (a)) — WHOSE OPTION. `user_set` says the USER put the node in the model,
  // and its readers say so in words. An option the Agent PROPOSED and the user only APPROVED is Olumi's suggestion; an
  // option whose name the user TYPED is theirs. Through the whole product: the Agent's propose → route-v2's typed hold
  // → the approval → turn-executor's confirm → the STORED graph → the "why is X here?" answer and the Agent's view.
  // ---------------------------------------------------------------------------
  const ORIGIN_Q = (label: string) => `Why is "${label}" in my model?`;
  const originAnswer = async (label: string, graph: unknown) => {
    const { tryStructureOriginAnswer } = await import('../../../cee/context-integrity/structure-origin-answer.js');
    return tryStructureOriginAnswer(ORIGIN_Q(label), graph);
  };
  const agentView = async (node: unknown) => {
    const { projectEntity } = await import('../runtime/agent-capabilities.js');
    return projectEntity(node as Parameters<typeof projectEntity>[0]);
  };
  const statedOnHold = async () => ((await heldOnLatestRow())[0]!.action.inline_patch as Record<string, unknown>)['user_stated_node_ids'];

  it('[A6b-1] RED (DL CR): an option the Agent PROPOSED (the user never named it), APPROVED → keeps Olumi\'s provenance; "why is it here?" never says "not because I suggested it"; the Agent never sees it as the user\'s', async () => {
    graphOf.set(SCENARIO, seedGraph());
    // The user asks for a suggestion; the Agent picks the option and its name.
    const t1 = await proposeOptionC(undefined, 'What else could we try on price? Suggest one more option and prepare it.');
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect(await statedOnHold(), 'the hold records no option as the user\'s').toBeUndefined();
    await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    const opt = newOption();
    expect(opt, JSON.stringify(graphNow().nodes)).toBeDefined();
    expect((opt as { provenance?: unknown }).provenance, 'Olumi\'s suggestion is never stored as the user\'s').not.toBe('user_set');
    const answer = await originAnswer(opt!.label, graphNow());
    expect(answer ?? '', String(answer)).not.toMatch(/not because I suggested it/);
    expect(answer ?? '', String(answer)).not.toMatch(/you set it yourself/);
    expect((await agentView(opt))['provenance'], 'the Agent\'s state view').not.toBe('user_set');
    // POSITIVE CONTROL, same run, same graph, same question: the probe DOES resolve this option — stamped user_set, the
    // answer is the user-authorship sentence. So the absence above is the provenance, not a probe that sees nothing.
    const stamped = structuredClone(graphNow());
    (stamped.nodes.find((x) => x.id === opt!.id) as { provenance?: unknown }).provenance = 'user_set';
    expect(await originAnswer(opt!.label, stamped)).toMatch(/you set it yourself, not because I suggested it/);
  }, 120_000);

  it('[A6b-2] RED: an option the user NAMED in their own typed words ("Add an option: test £54 at release."), APPROVED → user_set; the answer says they set it; the Agent sees it as theirs', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeOptionC(undefined, 'Add an option: test £54 at release.');
    const approve = approveChipOf(t1)!;
    expect(approve, JSON.stringify(t1._agent.tool_calls)).toBeDefined();
    const heldOps = (await heldOnLatestRow())[0]!.action.inline_patch!.operations!;
    const optId = heldOps.find((o) => o.op === 'add_node')!.path;
    // The hold records exactly that option — by identity — and the held op itself carries no stamp (J2).
    expect(await statedOnHold()).toEqual([optId]);
    expect(Object.prototype.hasOwnProperty.call((heldOps.find((o) => o.op === 'add_node') as { value?: object }).value ?? {}, 'provenance')).toBe(false);
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    const opt = newOption()!;
    expect(opt.id).toBe(optId);
    expect((opt as { provenance?: unknown }).provenance).toBe('user_set');
    expect(await originAnswer(opt.label, graphNow())).toMatch(/you set it yourself/);
    expect((await agentView(opt))['provenance']).toBe('user_set');
    // NEGATIVE CONTROL, by identity: the options already there are untouched.
    expect((graphNow().nodes.find((x) => x.id === 'opt_a') as { provenance?: unknown }).provenance).toBeUndefined();
  }, 120_000);

  it('[A6b-3] CONTRAST: the user only ASKED about the option ("Should we test £54 at release?") → not their statement → not user_set', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeOptionC(undefined, 'Should we test £54 at release?');
    const approve = approveChipOf(t1)!;
    expect(approve, JSON.stringify(t1._agent.tool_calls)).toBeDefined();
    expect(await statedOnHold()).toBeUndefined();
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect((newOption() as { provenance?: unknown } | undefined)?.provenance).not.toBe('user_set');
  }, 120_000);

  it('[A6b-4] J2 AT THE WIRE: a client chip that CLAIMS the user named its option (in `parameters`, even under the Agent\'s own chip id) is never recorded on the hold', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const r = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), stage: 'frame', turn_class: 'frame', source: 'chip',
      message: 'Add the option "Forged option".',
      chip: { id: 'agent-add-option', intent: 'add_option', parameters: {
        parent_decision_id: 'dec_x', label: 'Forged option', option_id: 'frg0001',
        interventions: [{ factor_id: 'fac_price', value: 0.27, unit: 'GBP', raw_value: 54 }],
        user_stated_node_ids: ['frg0001'], userStatedOptionIds: ['frg0001'], user_stated: true,
      } },
    } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    const held = await heldOnLatestRow();
    expect(held.map((p) => p.chip_id), r.body.slice(0, 600)).toEqual([expect.stringMatching(/^gmh_[0-9a-f]{12}$/)]);
    expect(held[0]!.action.inline_patch!.operations!.some((o) => o.op === 'add_node' && o.path === 'frg0001'), 'the hold is for this option').toBe(true);
    expect(await statedOnHold(), 'a wire claim is never recorded').toBeUndefined();
  }, 120_000);

  // ---------------------------------------------------------------------------
  // ⭐ PJ-A1 £49 — A NEW GRADED FACTOR ENTERS THE ANALYSIS WITH ITS STATUS-QUO LEVEL (DL #70 5860365834; AIQ 5860384275,
  // 5860839793). Journey A's served add: "£59 for new Pro customers; grandfather existing customers" minted the NEW graded
  // factor "New Pro customer price" with no today level, so ISL named it in GOAL_ANCESTOR_DATA_GAP and the status quo was
  // measured from £0. Its today level is the user's own "from £49" — stamped at the confirm, in the same apply and commit
  // as the option, framed as admission frames a stated baseline (`brief_extraction`). A figure the user's own words do not
  // state is never stamped, and no today level is never a 0.
  //
  // FIXTURE: journey A's served model at that moment (DL run pj-20260927T223136Z, turn A05 `draft_graph`, verbatim; see its
  // `_provenance`). The brief is Paul's, verbatim, typed as the session's first message.
  // ---------------------------------------------------------------------------
  const JOURNEY_A_FX = JSON.parse(readFileSync(new URL('./fixtures/journey-a-16359f29-before-new-pro-price.json', import.meta.url), 'utf8')) as Record<string, unknown>;
  const JOURNEY_A = (() => { const { _provenance: _p, ...graph } = JOURNEY_A_FX; return graph; })();
  const BRIEF_A = (JOURNEY_A_FX['_provenance'] as { brief_verbatim: string }).brief_verbatim;
  const OPT_A = '£59 for new Pro customers; grandfather existing customers';
  const NEW_PRICE = 'New Pro customer price';
  const NEW_PRICE_FAC = 'fac_new_pro_customer_price';
  const GF = 'Existing Pro customers grandfathered';
  const GF_FAC = 'fac_existing_pro_customers_grandfathered';
  /** Today's £49, exactly as admission frames a baseline the brief states (`framedObservedState`): raw kept, on 0–100. */
  const STATED_49 = { value: 0.49, raw_value: 49, cap: 100, declared_scale: 'unit_interval', unit: 'GBP/month', source: 'brief_extraction' };
  /**
   * Journey A's add, as served: the option acts on a NEW graded price (Olumi's £59 for the option — left for its own
   * level write, as today) and a NEW switch. `today` is what the Agent gives for the price, if anything.
   */
  const proposeJourneyA = async (today: Record<string, unknown> | undefined, firstMessage: string = BRIEF_A, olumiSaid = 'Noted. Shall I build on the model you have?',
    // A1 £59 rows: the option's label, its level on the new price (`null` = none given) and the user's message.
    opts: { label?: string; level?: Record<string, unknown> | null; message?: string } = {}) => {
    const level = opts.level === undefined ? { value: 59, unit: 'GBP/month', estimate: true, basis: 'the option is named for £59' } : opts.level;
    script = [() => say(olumiSaid)];
    await turn({ message: firstMessage });
    script = [
      () => fnCall('propose_new_option', {
        label: opts.label ?? OPT_A,
        acts_on: [
          { factor_label: NEW_PRICE, direction: 'positive', ...(level !== null ? { level } : {}) },
          { factor_label: GF, direction: 'positive' },
        ],
        new_factors: [
          { label: NEW_PRICE, affects: [{ label: 'Pro plan MRR', direction: 'positive' }], ...(today !== undefined ? { today } : {}) },
          { label: GF, kind: 'switch', affects: [{ label: 'Monthly churn rate', direction: 'negative' }] },
        ],
        rationale: 'The user asked for it, with Olumi’s assumptions.',
      }),
      (body) => { toolOutputSeen = JSON.stringify(body['input'] ?? []); return say('I would add it. Shall I?'); },
    ];
    return turn({ message: opts.message ?? `Let's add the grandfathering of existing customers: "${OPT_A}". Just add it with your assumptions, and I'll review it.` });
  };
  /** What the Agent's model was given back from its propose_new_option call (the second model call's input). */
  let toolOutputSeen = '';
  const heldPatch = async () => (await heldOnLatestRow())[0]!.action.inline_patch as Record<string, unknown> & { operations: { op: string; path: string; value?: Record<string, unknown> }[] };
  type WireNode = { id: string; kind: string; label?: string; observed_state?: { value?: unknown; raw_value?: unknown }; interventions?: Record<string, unknown> };
  type PlotBound = { graph: { nodes: WireNode[]; edges: { from: string; to: string }[] }; goal_node_id?: string; parameter_uncertainties?: { node_id?: string }[] };
  /** The REAL run loader and the REAL run_analysis handler over the stored graph, PLoT faked: what CEE sends PLoT. */
  const plotBoundRequest = async (): Promise<PlotBound> => {
    const { loadScenarioSnapshotForRunAnalysis } = await import('../../build-turn-context.js');
    const { createRunAnalysisHandler } = await import('../../tools/handlers/run-analysis.js');
    const { makeMessagePayload } = await import('../../__tests__/fixtures.js');
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-load', store as never);
    const run = vi.fn(async (_request: unknown) => ({
      meta: { seed_used: 1, n_samples: 1, response_hash: 'sha256:s' }, results: [], response_hash: 'sha256:t', analysis_status: 'completed',
    }));
    const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as never, scenarioReader: vi.fn(async () => snapshot) });
    await handler({
      context: {
        stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
        session_id: SCENARIO, request_id: 'req-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
        prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
      },
      payload: makeMessagePayload({ turn_id: 't-run', scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
      requestId: 'req-run', signal: new AbortController().signal, orientationText: '',
    } as never);
    expect(run, 'PLoT was called exactly once').toHaveBeenCalledTimes(1);
    return run.mock.calls[0]![0] as PlotBound;
  };
  /**
   * The roots ISL names in GOAL_ANCESTOR_DATA_GAP for a request — ISL's own rule (Inference-Service-Layer d1cef9a1,
   * `robustness_analyzer_v2.py` :2185–2198 and `_defaulted_roots_reaching` :3829): a ROOT with no `observed_state.value`,
   * no ParameterUncertainty and not intervened by EVERY option, with a directed path to the goal through nodes not
   * intervened by every option. Options and the decision are not causal nodes there (an option reaches ISL as its
   * interventions). Read off the PLoT-bound request; PLoT's own hop is not exercised here.
   */
  const islDefaultedRootsReachingGoal = (req: PlotBound): string[] => {
    const nodes = req.graph.nodes;
    const goal = req.goal_node_id ?? nodes.find((n) => n.kind === 'goal')?.id;
    const causal = new Set(nodes.filter((n) => n.kind !== 'option' && n.kind !== 'decision').map((n) => n.id));
    const edges = req.graph.edges.filter((e) => causal.has(e.from) && causal.has(e.to));
    const options = nodes.filter((n) => n.kind === 'option');
    const everyOption = new Set([...causal].filter((id) => options.length > 0
      && options.every((o) => o.interventions !== undefined && Object.prototype.hasOwnProperty.call(o.interventions, id))));
    const withPu = new Set((req.parameter_uncertainties ?? []).map((p) => p.node_id));
    const defaulted = [...causal].filter((id) => !edges.some((e) => e.to === id)).filter((id) => {
      const os = nodes.find((n) => n.id === id)!.observed_state;
      return !(os !== undefined && typeof os.value === 'number') && !withPu.has(id) && !everyOption.has(id);
    });
    return defaulted.filter((root) => {
      const stack = [root];
      const seen = new Set([root]);
      while (stack.length > 0) {
        const at = stack.pop()!;
        for (const e of edges) {
          if (e.from !== at || seen.has(e.to)) continue;
          seen.add(e.to);
          if (everyOption.has(e.to)) continue;
          if (e.to === goal) return true;
          stack.push(e.to);
        }
      }
      return false;
    }).sort();
  };

  it('[PJ-A1 £49] RED (journey A, served shape): the new graded price given today\'s £49 from Paul\'s brief → the hold names it → one click → framed £49 as brief_extraction, in the SAME commit as the option; the switch exactly as A1', async () => {
    graphOf.set(SCENARIO, structuredClone(JOURNEY_A));
    const t1 = await proposeJourneyA({ value: 49, unit: 'GBP/month' });
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    const ip = await heldPatch();
    // The hold records the stated level, by the factor's id, as CEE's own member — the held add_node carries no value (R4).
    expect(ip['graded_today'], JSON.stringify(ip)).toEqual([{ factor_id: NEW_PRICE_FAC, observed_state: STATED_49 }]);
    expect(ip['switch_factors']).toEqual([GF_FAC]);
    expect(ip.operations.find((o) => o.op === 'add_node' && o.path === NEW_PRICE_FAC)!.value).not.toHaveProperty('observed_state');
    expect(graphNow().nodes.some((x) => x.id === NEW_PRICE_FAC), 'nothing is written before the approval').toBe(false);

    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const g = graphNow() as unknown as { nodes: Record<string, any>[] };
    expect(g.nodes.find((x) => x.id === NEW_PRICE_FAC)!.observed_state).toEqual(STATED_49);
    // CONTRAST, same commit: the switch is exactly A1's — today-0 as Olumi's, ON structural (no estimate stamp).
    expect(g.nodes.find((x) => x.id === GF_FAC)!.observed_state).toEqual({ value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' });
    const option = g.nodes.find((x) => x.kind === 'option' && x.label === OPT_A)!;
    expect(option.interventions[GF_FAC]).toEqual(ON_LEVEL(GF_FAC));
    // ⭐ A1 £59 (DL 5861782245; was `toBeUndefined()`, "set by its own write"): the option's own £59 lands in this SAME
    // commit, on today's frame (0–100). The user wrote it ("from £49 to £59", and the option's own name typed in this turn),
    // so it is theirs (no estimate stamp) although the Agent flagged it as its estimate — as for an existing factor.
    expect(option.interventions[NEW_PRICE_FAC]).toEqual({ value: 0.59, raw_value: 59, unit: 'GBP/month', source: 'user_specified',
      target_match: { node_id: NEW_PRICE_FAC, match_type: 'exact_id', confidence: 'high' } });
    // The approval says what was committed: today's £49 is the user's, and it is not asked for again.
    expect(t2.assistant_text).toContain(`"${NEW_PRICE}"`);
    expect(t2.assistant_text).toMatch(/today is 49 GBP\/month, as you said/);
    expect(t2.assistant_text).not.toMatch(/Tell me (its value today|today's value for "New Pro customer price")/);
    expect(routerCalls).toEqual([]);
  }, 120_000);

  it('[PJ-A1 £49] RED: through run_analysis — PLoT receives the new price at its status-quo £49 (and the option at its £59), and ISL\'s GOAL_ANCESTOR_DATA_GAP rule names nothing new', async () => {
    graphOf.set(SCENARIO, structuredClone(JOURNEY_A));
    const t1 = await proposeJourneyA({ value: 49, unit: 'GBP/month' });
    const approve = approveChipOf(t1)!;
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    // ⭐ A1 £59 (DL 5861782245): the option's £59 on the new price landed in that SAME approval, on the SAME frame — the
    // follow-up level write this row used to make (propose_option_interventions) is gone: it would now set nothing.

    const req = await plotBoundRequest();
    // ⛔ THE DL's MUTANT BINDS HERE FIRST: without the stamp, ISL's own rule names the new price (GOAL_ANCESTOR_DATA_GAP).
    expect(islDefaultedRootsReachingGoal(req), 'ISL GOAL_ANCESTOR_DATA_GAP roots').toEqual([]);
    const factor = req.graph.nodes.find((n) => n.id === NEW_PRICE_FAC)!;
    expect(factor.observed_state, JSON.stringify(factor)).toEqual(expect.objectContaining({ value: 0.49, raw_value: 49, source: 'brief_extraction' }));
    const option = req.graph.nodes.find((n) => n.kind === 'option' && n.label === OPT_A)!;
    expect(option.interventions?.[NEW_PRICE_FAC], JSON.stringify(option)).toEqual(expect.objectContaining({ value: 0.59, raw_value: 59 }));
  }, 120_000);

  it('[PJ-A1 £49] CONTRAST (the probe\'s positive control): no today level given → committed with NO observed_state (never 0), and the Run is refused naming the new price (MISSING_FACTOR_LEVEL, #2164) — never a silent 0 to PLoT', async () => {
    graphOf.set(SCENARIO, structuredClone(JOURNEY_A));
    const t1 = await proposeJourneyA(undefined);
    const approve = approveChipOf(t1)!;
    expect((await heldPatch())['graded_today']).toBeUndefined();
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    const g = graphNow() as unknown as { nodes: Record<string, any>[] };
    expect(g.nodes.find((x) => x.id === NEW_PRICE_FAC)).toBeDefined();
    expect(g.nodes.find((x) => x.id === NEW_PRICE_FAC)!.observed_state).toBeUndefined();
    expect(t2.assistant_text).toMatch(/Tell me its value today|Tell me today's value for "New Pro customer price"/);
    // The SAME £59 follow-up as the positive row, so the ONLY difference between the two rows is the today level.
    script = [
      () => fnCall('propose_option_interventions', { interventions: [{ option_label: OPT_A, factor_label: NEW_PRICE, value: 59, unit: 'GBP/month', basis: 'the user said £59 for new Pro customers', user_stated: true }] }),
      () => say('I would set it. Shall I?'),
    ];
    const t3 = await turn({ message: `Set "${NEW_PRICE}" to £59 under "${OPT_A}".` });
    const approveLevel = approveChipOf(t3);
    expect(approveLevel?.id, JSON.stringify(t3._agent.tool_calls)).toBeDefined();
    await turn({ message: approveLevel!.message, source: 'chip', chip: { id: approveLevel!.id } });
    // ⭐ With #2164's placeholder-zero readiness (merged in at this head), a new factor with no status-quo level never
    // reaches PLoT as a silent 0: the Run is refused, and the ONE gap it names is the new price, by id. The positive row
    // above (same path + the user's £49) passes this same loader, so the refusal is bound to the missing today level.
    const refused = await plotBoundRequest().then(() => null, (e: unknown) => e) as
      { name?: string; verdict?: { reasonCodes?: readonly string[]; issues?: readonly { code?: string; factor_id?: string }[] } } | null;
    expect(refused?.name, 'the Run is refused before PLoT (never a silent 0)').toBe('AnalysisNotReadyError');
    expect(refused!.verdict!.reasonCodes, JSON.stringify(refused!.verdict!.reasonCodes)).toContain('MISSING_FACTOR_LEVEL');
    expect((refused!.verdict!.issues ?? []).filter((i) => i.code === 'MISSING_FACTOR_LEVEL').map((i) => i.factor_id)).toEqual([NEW_PRICE_FAC]);
  }, 120_000);

  it('[PJ-A1 £49] CONTRAST: a today figure only OLUMI wrote (never the user) → not stamped: no graded_today on the hold, no observed_state, and the Agent is told why', async () => {
    graphOf.set(SCENARIO, structuredClone(JOURNEY_A));
    // The user never writes 45; Olumi's own reply does.
    const t1 = await proposeJourneyA({ value: 45, unit: 'GBP/month' }, 'Let\'s look at pricing for new Pro customers.', 'New Pro customers pay £45 today, I would guess.');
    const call = t1._agent.tool_calls.find((c) => c.name === 'propose_new_option');
    expect(call, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true }));
    const approve = approveChipOf(t1)!;
    expect((await heldPatch())['graded_today']).toBeUndefined();
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0]).toEqual(expect.objectContaining({ ok: true, mutated: true }));
    const g = graphNow() as unknown as { nodes: Record<string, any>[] };
    expect(g.nodes.find((x) => x.id === NEW_PRICE_FAC)!.observed_state).toBeUndefined();
    // The Agent was told, in the tool result, that today's value was not taken and why — to ask for it.
    expect(toolOutputSeen).toMatch(/today_not_set/);
    expect(toolOutputSeen).toMatch(/do not state 45/);
    // The switch is untouched by the dropped figure.
    expect(g.nodes.find((x) => x.id === GF_FAC)!.observed_state).toEqual({ value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' });
  }, 120_000);

  // ─── A03 (MG; served DL run pj-20260928T011147Z on CEE 84440ff, journey A step A03) ──────────────────────────────────
  // "Please add two options to compare: "Improve trial-to-Pro conversion" and "Retention intervention for at-risk
  // accounts"." FIVE `propose_new_option` calls, each refused `switch_level_not_on` with `not_one` (~23 s), then a 13 s
  // clarification turn. Inferred from the served reply (the arguments are not kept — UNVERIFIED): ONE change carried both
  // options and ONE new switch, and the Agent listed the switch at 0 under the conversion option ("this option leaves it
  // off"). SPEC: a new switch listed at exactly 0 under an option, when ANOTHER option in the change turns it on, means
  // that option does not act on it — the entry is dropped (no intervention, no link), the switch keeps Olumi's today-0.
  // FIXTURE: Paul's graph (a295e4a1) with the two options A03 asked for removed — the model as A03 found it.
  const CONV = 'Improve trial-to-Pro conversion';
  const RET = 'Retention intervention for at-risk accounts';
  const RET_SWITCH = 'Retention intervention in place';
  const A03_MESSAGE = `Please add two options to compare: "${CONV}" and "${RET}".`;
  const BEFORE_A03 = (() => {
    const g = structuredClone(PAUL) as { nodes: { id: string; label?: string }[]; edges: { from: string; to: string }[] };
    const gone = new Set(g.nodes.filter((x) => x.label === CONV || x.label === RET).map((x) => x.id));
    if (gone.size !== 2) throw new Error('the fixture must hold both A03 options, removed here');
    return { ...g, nodes: g.nodes.filter((x) => !gone.has(x.id)), edges: g.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to)) };
  })();
  let a03ToolOutput = '';
  const proposeA03 = (offLevel: unknown) => {
    script = [
      () => fnCall('propose_new_option', {
        options: [
          { label: CONV, acts_on: [
            { factor_label: 'Monthly new Pro subscribers', direction: 'positive', level: { value: 90, unit: 'subscribers per month', estimate: true, basis: 'a modest conversion uplift' } },
            { factor_label: RET_SWITCH, direction: 'positive', level: offLevel }] },
          { label: RET, acts_on: [{ factor_label: RET_SWITCH, direction: 'positive' }] },
        ],
        new_factors: [{ label: RET_SWITCH, kind: 'switch', affects: [{ label: 'Monthly churn', direction: 'negative' }] }],
        rationale: 'The user asked to compare both.',
      }),
      (body) => { a03ToolOutput = JSON.stringify(body['input'] ?? []); return say('I would add both. Shall I?'); },
    ];
    return turn({ message: A03_MESSAGE });
  };

  it.each([
    ['{ value: 0 } (A03)', { value: 0 }],
    ["{ value: 0, unit: '%' }", { value: 0, unit: '%' }],
  ])('[A03] R1/R2/R6 RED: the switch at %s under the conversion option, turned on by the retention option → ONE propose_new_option call, held → one click → retention on (1), conversion NOT linked to it, today-0 Olumi\'s', async (_name, offLevel) => {
    graphOf.set(SCENARIO, structuredClone(BEFORE_A03));
    const t1 = await proposeA03(offLevel);
    const calls = t1._agent.tool_calls;
    // R6: ONE call, not refused — the served turn made five, every one refused.
    expect(calls.filter((c) => c.name === 'propose_new_option'), JSON.stringify(calls)).toEqual([expect.objectContaining({ ok: true })]);
    expect(calls.filter((c) => c.refusal !== undefined), JSON.stringify(calls)).toEqual([]);
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    // The Agent is told which entry was dropped, by option and factor.
    expect(a03ToolOutput).toContain('switch_off_entries_dropped');
    expect(a03ToolOutput).toContain(JSON.stringify(JSON.stringify({ option: CONV, factor: RET_SWITCH })).slice(1, -1));

    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const g = graphNow() as unknown as { nodes: Record<string, any>[]; edges: { from: string; to: string }[] };
    const sw = g.nodes.filter((x) => x.kind === 'factor' && x.label === RET_SWITCH);
    expect(sw, 'the switch is added once').toHaveLength(1);
    const swId = String(sw[0]!.id);
    const conv = g.nodes.find((x) => x.kind === 'option' && x.label === CONV)!;
    const ret = g.nodes.find((x) => x.kind === 'option' && x.label === RET)!;
    expect(conv, 'the conversion option is added').toBeDefined();
    expect(ret, 'the retention option is added').toBeDefined();
    // The retention option turns the switch on: the structural 1.
    expect(ret.interventions[swId]).toEqual(ON_LEVEL(swId));
    expect(g.edges.some((e) => e.from === ret.id && e.to === swId), 'retention → switch').toBe(true);
    // The conversion option does not act on it: no intervention, no link.
    expect(Object.prototype.hasOwnProperty.call(conv.interventions ?? {}, swId), JSON.stringify(conv.interventions)).toBe(false);
    expect(g.edges.some((e) => e.from === conv.id && e.to === swId), 'NO conversion → switch link').toBe(false);
    // CONTRAST: the conversion option IS linked to what it does act on.
    expect(g.edges.some((e) => e.from === conv.id && e.to === 'monthly_new_pro_subscribers'), 'conversion → Monthly new Pro subscribers').toBe(true);
    // The switch's today is Olumi's off.
    expect(sw[0]!.observed_state).toEqual({ value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' });
    expect(routerCalls).toEqual([]);
  }, 120_000);

  // ---------------------------------------------------------------------------
  // ⭐ A1 £59 — THE OPTION'S OWN LEVEL ON A NEW GRADED FACTOR LANDS IN THE SAME PROPOSAL AS ITS TODAY LEVEL (DL 5861782245).
  // Served CEE 0db4f43, DL run pj-20260928T013016Z turn A05: "£59 for new Pro customers; grandfather existing customers"
  // minted "New Pro customer price" with today's £49 (#2132) but left the option's £59 unset ("The £59 level needs setting
  // after the new price factor exists, because it has no range yet"), so the approved option held no level on it and the
  // final Run was refused MISSING_OPTION_VALUE, asking the user for the £59 they had already typed. With an accepted today
  // level the frame is known in the proposal, so the option's level is written there, on THAT frame, in the same commit.
  // ---------------------------------------------------------------------------
  /** A05 as the user typed it (DL run pj-20260928T013016Z, SUMMARY.md step table), verbatim. */
  const A05_SERVED = `Let's add the grandfathering of existing customers: "${OPT_A}".`;
  /** The served unit (A06 draft_graph: `observed_state.unit` "GBP per month"). */
  const STATED_49_SERVED = { ...STATED_49, unit: 'GBP per month' };
  const levelOn = (id: string, value: number, raw: number, unit: string, source: 'user_specified' | 'cee_hypothesis') =>
    ({ value, raw_value: raw, unit, source, target_match: { node_id: id, match_type: 'exact_id', confidence: 'high' } });
  const heldOptionOf = (ip: Awaited<ReturnType<typeof heldPatch>>, label: string) =>
    ip.operations.find((o) => o.op === 'add_node' && o.value?.['kind'] === 'option' && o.value?.['label'] === label)!.value as { interventions: Record<string, unknown> };

  it('[A1-59 R1] RED (A05 served shape): today\'s £49 AND the option\'s £59 in ONE call → one hold → one approval → the option holds 59 user_specified on the SAME frame as the £49, and the Run reaches PLoT (never MISSING_OPTION_VALUE)', async () => {
    graphOf.set(SCENARIO, structuredClone(JOURNEY_A));
    const t1 = await proposeJourneyA({ value: 49, unit: 'GBP per month' }, BRIEF_A, undefined, { level: { value: 59, unit: 'GBP per month' }, message: A05_SERVED });
    expect(t1._agent.tool_calls.filter((c) => c.name === 'propose_new_option'), JSON.stringify(t1._agent.tool_calls)).toEqual([expect.objectContaining({ ok: true })]);
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    // The Agent is told the level IS set, and by the user — never "no range yet", never asked again.
    expect(toolOutputSeen).not.toMatch(/no range yet/);
    expect(toolOutputSeen, 'no level left unset (the readiness view\'s own list is empty)').not.toMatch(/levels_not_set\\*":\[\{/);
    expect(toolOutputSeen).toMatch(/\\"factor\\":\\"New Pro customer price\\",\\"value\\":59,\\"unit\\":\\"GBP per month\\",\\"stated_by\\":\\"user\\"/);
    // ONE hold carries both: today's £49 (CEE's member) and the option's £59 (in the option's own add_node).
    const ip = await heldPatch();
    expect(ip['graded_today'], JSON.stringify(ip)).toEqual([{ factor_id: NEW_PRICE_FAC, observed_state: STATED_49_SERVED }]);
    expect(heldOptionOf(ip, OPT_A).interventions[NEW_PRICE_FAC]).toEqual(levelOn(NEW_PRICE_FAC, 0.59, 59, 'GBP per month', 'user_specified'));

    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    const g = graphNow() as unknown as { nodes: Record<string, any>[] };
    const factor = g.nodes.find((x) => x.id === NEW_PRICE_FAC)!;
    expect(factor.observed_state).toEqual(STATED_49_SERVED);
    const option = g.nodes.find((x) => x.kind === 'option' && x.label === OPT_A)!;
    // Bound by the option's label and the factor's id: 59, the user's (no estimate stamp), framed.
    expect(option.interventions[NEW_PRICE_FAC]).toEqual(levelOn(NEW_PRICE_FAC, 0.59, 59, 'GBP per month', 'user_specified'));
    expect(option.interventions[GF_FAC]).toEqual(ON_LEVEL(GF_FAC));
    // ONE frame for both, and no clamp: the frame is built over the largest figure (59), so 59 and 49 both sit inside it.
    const iv = option.interventions[NEW_PRICE_FAC] as { value: number; raw_value: number };
    expect(factor.observed_state.cap).toBe(100);
    expect(Math.abs(iv.value * factor.observed_state.cap - iv.raw_value)).toBeLessThan(1e-9);
    expect(Math.abs(factor.observed_state.value * factor.observed_state.cap - factor.observed_state.raw_value)).toBeLessThan(1e-9);
    expect(iv.raw_value).toBeLessThan(factor.observed_state.cap);
    expect(iv.value).toBeGreaterThan(factor.observed_state.value);
    // The approval never asks for the £59 it just recorded.
    expect(t2.assistant_text).not.toMatch(/does not yet set a level for "New Pro customer price"/);
    expect(t2.assistant_text).not.toMatch(/What should option "£59 for new Pro customers; grandfather existing customers" set it to/);

    // The final Run: no MISSING_OPTION_VALUE for the new price — PLoT receives the option at 0.59/59 and today at 0.49/49.
    const out = await plotBoundRequest().then((req) => ({ req, refused: undefined }), (e: unknown) => ({ req: undefined, refused: e as { verdict?: { reasonCodes?: readonly string[]; issues?: readonly { code?: string; factor_id?: string }[] } } }));
    expect(out.refused?.verdict?.issues ?? [], JSON.stringify(out.refused?.verdict?.reasonCodes ?? [])).not.toContainEqual(expect.objectContaining({ code: 'MISSING_OPTION_VALUE' }));
    expect(out.refused, JSON.stringify(out.refused?.verdict?.reasonCodes ?? [])).toBeUndefined();
    const plotOption = out.req!.graph.nodes.find((n) => n.kind === 'option' && n.label === OPT_A)!;
    expect(plotOption.interventions?.[NEW_PRICE_FAC], JSON.stringify(plotOption)).toEqual(expect.objectContaining({ value: 0.59, raw_value: 59 }));
    expect(out.req!.graph.nodes.find((n) => n.id === NEW_PRICE_FAC)!.observed_state).toEqual(expect.objectContaining({ value: 0.49, raw_value: 49, source: 'brief_extraction' }));
    expect(islDefaultedRootsReachingGoal(out.req!), 'ISL GOAL_ANCESTOR_DATA_GAP roots').toEqual([]);
    expect(routerCalls).toEqual([]);
  }, 120_000);

  it('[A1-59 R2] RED: the option\'s figure only in OLUMI\'s words → set on the same frame, but stamped as Olumi\'s estimate (cee_hypothesis) and said so — never the user\'s', async () => {
    graphOf.set(SCENARIO, structuredClone(JOURNEY_A));
    const LABEL_R2 = 'A higher price for new Pro customers; grandfather existing customers';
    const t1 = await proposeJourneyA({ value: 49, unit: 'GBP per month' }, 'Our Pro plan is £49 a month today. We want to reach £100k MRR within 12 months.',
      'I would suggest £59 a month for new customers.', {
        label: LABEL_R2,
        level: { value: 59, unit: 'GBP per month', estimate: true, basis: 'Olumi’s suggestion: £10 above today’s £49' },
        message: `Let's add "${LABEL_R2}". Just add it with your assumptions, and I'll review it.`,
      });
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    // Said to the Agent as Olumi's estimate, with its basis.
    expect(toolOutputSeen).toMatch(/\\"factor\\":\\"New Pro customer price\\",\\"value\\":59,\\"unit\\":\\"GBP per month\\",\\"stated_by\\":\\"olumi_estimate\\"/);
    expect(toolOutputSeen).not.toMatch(/no range yet/);
    const ip = await heldPatch();
    expect(ip['graded_today']).toEqual([{ factor_id: NEW_PRICE_FAC, observed_state: STATED_49_SERVED }]);
    expect(heldOptionOf(ip, LABEL_R2).interventions[NEW_PRICE_FAC]).toEqual(levelOn(NEW_PRICE_FAC, 0.59, 59, 'GBP per month', 'cee_hypothesis'));
    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls[0]).toEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    const g = graphNow() as unknown as { nodes: Record<string, any>[] };
    const option = g.nodes.find((x) => x.kind === 'option' && x.label === LABEL_R2)!;
    expect(option.interventions[NEW_PRICE_FAC], 'Olumi\'s figure is never stored as the user\'s').toEqual(levelOn(NEW_PRICE_FAC, 0.59, 59, 'GBP per month', 'cee_hypothesis'));
    expect(g.nodes.find((x) => x.id === NEW_PRICE_FAC)!.observed_state).toEqual(STATED_49_SERVED);
    expect(t2.assistant_text, t2.assistant_text).toMatch(/Its level for "New Pro customer price" is Olumi's estimate, for you to correct\./);
  }, 120_000);

  it('[A1-59 R3] CONTRAST (unchanged): a new graded factor with NO today level → the option\'s level is not set ("no range yet"); nothing rides the hold', async () => {
    graphOf.set(SCENARIO, structuredClone(JOURNEY_A));
    const t1 = await proposeJourneyA(undefined, BRIEF_A, undefined, { level: { value: 59, unit: 'GBP per month' }, message: A05_SERVED });
    expect(approveChipOf(t1)?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect(toolOutputSeen).toMatch(/levels_not_set\\*":\[\{/);
    expect(toolOutputSeen).toMatch(/New Pro customer price\\*" is new in this change and has no range yet/);
    const ip = await heldPatch();
    expect(ip['graded_today']).toBeUndefined();
    expect(heldOptionOf(ip, OPT_A).interventions).not.toHaveProperty(NEW_PRICE_FAC);
    expect(ip.operations.some((o) => o.op === 'add_edge' && o.path.endsWith(`::${NEW_PRICE_FAC}`) && !o.path.startsWith(`${NEW_PRICE_FAC}::`)), 'the option is still linked to it').toBe(true);
  }, 120_000);

  it.each([
    ['a non-number ("59")', { value: '59', unit: 'GBP per month' }, /is not a figure \\*"New Pro customer price\\*" can hold/],
    ['a figure in another kind of unit (59%)', { value: 59, unit: '%' }, /is not a level for \\*"New Pro customer price\\*", which is measured in GBP per month/],
  ])('[A1-59 R4] RED: %s → the option\'s level is not set, and said; today\'s £49 still lands on its own frame', async (_name, level, said) => {
    graphOf.set(SCENARIO, structuredClone(JOURNEY_A));
    const t1 = await proposeJourneyA({ value: 49, unit: 'GBP per month' }, BRIEF_A, undefined, { level, message: A05_SERVED });
    expect(approveChipOf(t1)?.id, JSON.stringify(t1._agent.tool_calls)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect(toolOutputSeen).toMatch(/levels_not_set\\*":\[\{/);
    expect(toolOutputSeen).toMatch(said);
    const ip = await heldPatch();
    expect(ip['graded_today']).toEqual([{ factor_id: NEW_PRICE_FAC, observed_state: STATED_49_SERVED }]);
    expect(heldOptionOf(ip, OPT_A).interventions).not.toHaveProperty(NEW_PRICE_FAC);
  }, 120_000);
});
