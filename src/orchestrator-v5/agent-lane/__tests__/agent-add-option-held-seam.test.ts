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

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `5a0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d2c${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; created_at: string };
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

type Chip = { id: string; label: string; message: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string }; _provider_calls?: { provider: string; outcome?: string }[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string }[] } };

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
    const a = Fastify({ logger: false });
    a.addHook('preHandler', async (req) => { if (req.url === '/orchestrate/v2/turn') { inner.push(req.body as Record<string, unknown>); onInner?.(req.body as Record<string, unknown>); } });
    a.addHook('onSend', async (req, _reply, payload) => { if (req.url === '/orchestrate/v2/turn') onInnerSent?.(req.body as Record<string, unknown>); return payload; });
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
  const graphNow = () => graphOf.get(SCENARIO) as { nodes: { id: string; kind: string; label: string; interventions?: Record<string, unknown> }[]; edges: { from: string; to: string }[] };
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
    expect(t2.assistant_text, 'the completion step is named, in plain words').toMatch(/does not yet set a level for Price/);
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
    expect(t2.assistant_text, t2.assistant_text).toMatch(/Also added the factor "AI add-on price", which changes Revenue/);
    expect(t2.assistant_text, 'the factor is never reported as an option').not.toMatch(/Added "AI add-on price"/);
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
    expect(calls[1]).toEqual(expect.objectContaining({ refusal: 'one_option_per_approval' }));
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
});
