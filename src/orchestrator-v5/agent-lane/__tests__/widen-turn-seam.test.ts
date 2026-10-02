/**
 * ⭐ WIDEN THE OPTIONS on the LIVE route, end to end (PTL 5947349533; DL 5947426886 rows; RC `method_turns.RC-WIDEN`):
 *   "Suggest options" press → ONE model call whose ONLY tool is `propose_new_option` → RC's gate INSIDE the door →
 *   ONE held `gmh_` card → the user's approve → the options are in the model, linked from the decision.
 * A gate refusal stores NOTHING: no hold on the answer row, no approve chip, RC's fallback text.
 *
 * HARNESS: copied from `agent-add-option-held-seam.test.ts` (the REAL route-v2 and the REAL Agent route in one app,
 * a stateful store with production read semantics, OpenAI scripted, route-v2's LLM router throws if touched).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

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

describe('WIDEN on the live route: one gated card, or nothing stored', () => {
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
  /** The hold the Agent's LATEST answer row carries — what the next turn (and route-v2's confirm) will read. */
  const heldOnLatestRow = async () => {
    const pendings = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; expires_at_turn_count: number; action: { kind: string; inline_patch?: { handler_id?: string; operations?: { op: string; path: string }[] } } }[];
    return pendings.filter((p) => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };

  const WIDEN = { id: 'agent-next-widen', message: 'Suggest options I haven’t considered.' };
  const press = () => turn({ message: WIDEN.message, source: 'chip', chip: { id: WIDEN.id } });
  /** Price + one more driver, so a DIFFERENT mechanism exists to propose (opt_a and opt_b both set Price). */
  const seeded = () => {
    const g = seedGraph(2) as { nodes: Record<string, unknown>[] };
    g.nodes = g.nodes.map((n) => (n['id'] === 'fac_1' ? { ...n, label: 'Customer churn' } : n));
    graphOf.set(SCENARIO, g);
  };
  const est = { value: 60, unit: 'GBP', estimate: true, basis: 'a typical retention programme for this price band' };
  const optionLabels = () => graphNow().nodes.filter((x) => x.kind === 'option').map((x) => x.label).sort();

  it('W-R1 PASS: ONE model call whose only tool is the door → ONE held card + Something else; nothing written before the yes; the yes adds both, linked from the decision', async () => {
    seeded();
    const before = optionLabels();
    const bodies: Record<string, unknown>[] = [];
    script = [(body) => { bodies.push(body); return fnCall('propose_new_option', { options: [
      { label: 'Retention offer', acts_on: [{ factor_label: 'Customer churn', direction: 'negative', level: est }] },
      { label: 'Cut price to win share', acts_on: [{ factor_label: 'Price', direction: 'negative', level: { value: 45, unit: 'GBP', estimate: true, basis: 'just below today’s £49' } }] },
    ], rationale: 'Both work through a different mechanism from the two price rises.' }); }];
    const t1 = await press();
    expect(openAiCalls, 'ONE model call').toBe(1);
    expect(((bodies[0]!['tools'] ?? []) as { name?: string }[]).map((x) => x.name), 'the door is the ONLY tool').toEqual(['propose_new_option']);
    expect(JSON.stringify(bodies[0]!['instructions'] ?? '')).toContain('METHOD TURN: the user asked Olumi to suggest options');
    expect(t1._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_new_option', true]]);
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1.suggested_actions)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    expect(t1.suggested_actions.map((c) => c.id)).toEqual([approve!.id, 'agent-amend-proposal', 'agent-widen-something-else']);
    // The card's text names BOTH options and what each moves; never the fallback beside a live card.
    expect(t1.assistant_text).toContain('Retention offer');
    expect(t1.assistant_text).toContain('Cut price to win share');
    expect(t1.assistant_text).not.toContain('What other way could you reach');
    const held = await heldOnLatestRow();
    expect(held.map((p) => p.chip_id)).toEqual([approve!.id.slice('agent-approve-proposal:'.length)]);
    const ops = held[0]!.action.inline_patch!.operations! as { op: string; path: string; value?: { kind?: string; label?: string; interventions?: Record<string, unknown> } }[];
    const added = ops.filter((o) => o.op === 'add_node' && o.value?.kind === 'option');
    expect(Object.fromEntries(added.map((o) => [o.value!.label, Object.keys(o.value!.interventions ?? {})])))
      .toEqual({ 'Retention offer': ['fac_1'], 'Cut price to win share': ['fac_price'] });
    expect(optionLabels(), 'nothing is written before the approval').toEqual(before);

    const t2 = await turn({ message: approve!.message, source: 'chip', chip: { id: approve!.id } });
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(optionLabels()).toEqual([...before, 'Cut price to win share', 'Retention offer'].sort());
    const g = graphNow();
    for (const label of ['Retention offer', 'Cut price to win share']) {
      const id = g.nodes.find((x) => x.kind === 'option' && x.label === label)!.id;
      expect(g.edges.some((e) => e.from === 'dec_x' && e.to === id), `${label} is linked from the decision`).toBe(true);
    }
  }, 120_000);

  it('W-R2 REFUSED (identity, not wording): a reworded copy of a current option is refused INSIDE the door — no hold, no approve chip, RC’s fallback', async () => {
    seeded();
    const before = optionLabels();
    // "Lift what we charge" shares no word with "Raise to £59", but it changes the SAME factor the same way.
    script = [() => fnCall('propose_new_option', { label: 'Lift what we charge', acts_on: [{ factor_label: 'Price', direction: 'positive' }], rationale: 'r' })];
    const t1 = await press();
    expect(openAiCalls).toBe(1);
    expect(t1._agent.tool_calls.map((c) => [c.name, c.ok, c.refusal])).toEqual([['propose_new_option', false, 'widen_gate']]);
    expect(inner.filter((b) => (b['chip'] as { intent?: string } | undefined)?.intent === 'add_option'), 'the door never reached route-v2').toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(approveChipOf(t1)).toBeUndefined();
    expect(t1.assistant_text).toBe('What other way could you reach ‘Revenue’? For example, a different lever, a smaller first step, or a mix of these options.');
    expect(t1.suggested_actions.map((c) => c.id)).toEqual(['agent-talk-it-through']);
    expect(optionLabels()).toEqual(before);
  }, 120_000);

  it('W-R3 REFUSED (grounding): a factor the model does not have is refused before route-v2 is reached', async () => {
    seeded();
    script = [() => fnCall('propose_new_option', { label: 'Hire two sellers', acts_on: [{ factor_label: 'Sales headcount', direction: 'positive' }], rationale: 'r' })];
    const t1 = await press();
    expect(t1._agent.tool_calls.map((c) => c.refusal)).toEqual(['widen_gate']);
    expect(inner.filter((b) => (b['chip'] as { intent?: string } | undefined)?.intent === 'add_option')).toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]);
  }, 120_000);

  it('W-R5 (HARNESS P2): TWO door calls in ONE response, each passing alone → exactly ONE stored card, ONE approve chip, the card\u2019s own reply', async () => {
    seeded();
    const call = (id: string, label: string, factor: string) => ({ type: 'function_call', name: 'propose_new_option', call_id: id,
      arguments: JSON.stringify({ label, acts_on: [{ factor_label: factor, direction: 'negative' }], rationale: 'r' }) });
    script = [() => ({ output: [call('c-a', 'Retention offer', 'Customer churn'), call('c-b', 'Cut price to win share', 'Price')] })];
    const t1 = await press();
    expect(openAiCalls).toBe(1);
    const oks = t1._agent.tool_calls.filter((c) => c.name === 'propose_new_option' && c.ok);
    expect(oks, JSON.stringify(t1._agent.tool_calls)).toHaveLength(1);
    expect(t1.suggested_actions.filter((c) => c.id.startsWith('agent-approve-proposal:'))).toHaveLength(1);
    expect(await heldOnLatestRow()).toHaveLength(1);
    expect(t1.assistant_text).toContain('Retention offer');
    expect(t1.assistant_text).not.toContain('What other way could you reach');
  }, 120_000);

  it('W-R6 (DL P1-B): two gate-passing options, one a SAME-LEVEL twin of an existing option → the door holds ONE; the reply names only it + the twin note', async () => {
    seeded();
    const before = optionLabels();
    script = [() => fnCall('propose_new_option', { options: [
      { label: 'Retention offer', acts_on: [{ factor_label: 'Customer churn', direction: 'negative', level: est }] },
      // Lowering Price passes the gate (no current option lowers it), but at £49 it sets EXACTLY "Keep £49"'s level.
      { label: 'Hold at £49', acts_on: [{ factor_label: 'Price', direction: 'negative', level: { value: 49, unit: 'GBP', estimate: true, basis: 'today\u2019s price' } }] },
    ], rationale: 'r' })];
    const t1 = await press();
    expect(t1._agent.tool_calls.map((c) => [c.name, c.ok]), JSON.stringify(t1._agent.tool_calls)).toEqual([['propose_new_option', true]]);
    // Bound to the HELD ops: exactly one new option node, carrying a lever on Customer churn (fac_1) and none on Price.
    const held = await heldOnLatestRow();
    expect(held).toHaveLength(1);
    const ops = held[0]!.action.inline_patch!.operations! as { op: string; path: string; value?: { kind?: string; label?: string; interventions?: Record<string, unknown> } }[];
    const added = ops.filter((o) => o.op === 'add_node' && o.value?.kind === 'option');
    expect(added.map((o) => o.value!.label), JSON.stringify(ops)).toEqual(['Retention offer']);
    expect(Object.keys(added[0]!.value!.interventions ?? {})).toEqual(['fac_1']);
    expect(ops.some((o) => o.op === 'add_edge' && o.path === `dec_x::${added[0]!.path}`)).toBe(true);
    // The words match the card: only the held option is offered for approval; the twin is named as left out.
    expect(t1.assistant_text).toContain('Retention offer');
    expect(t1.assistant_text).toMatch(/Hold at £49.{0,80}(same levels|NOT in this change|Not in this change)/s);
    expect(t1.assistant_text).not.toMatch(/Approve to add them/);
    expect(optionLabels()).toEqual(before);
  }, 120_000);

  it('W-R4 CONTROL: the same model reply on an ORDINARY turn (not a Widen press) is not gated — the door holds it', async () => {
    seeded();
    script = [
      () => fnCall('propose_new_option', { label: 'Lift what we charge', acts_on: [{ factor_label: 'Price', direction: 'positive' }], rationale: 'The user asked for it.' }),
      () => say('I would add it. Shall I?'),
    ];
    const t1 = await turn({ message: 'Add an option: lift what we charge.' });
    expect(t1._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_new_option', true]]);
  }, 120_000);
});
