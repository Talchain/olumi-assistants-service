/**
 * ⭐ THE AGENT'S GOAL TARGET, WRITTEN BY THE REAL PRODUCT — not by a model of it.
 *
 * `agent-sets-the-goal-target.test.ts` pins the Agent's side against a writer modelled from the contract. A fake is not
 * evidence about the wire, so this file drives the REAL seam end to end:
 *   the REAL `agentV1TurnRoute` (propose turn, then the typed approve-chip click on a LATER turn: fast path 2)
 *   → its in-process dispatch → the REAL `ceeOrchestratorRouteV2` → `dispatchGoalTargetEdit` → `applyGoalTargetEdit`
 *   → the REAL `add_constraint` handler → the atomic commit into the session store
 *   → the Agent reads the stored graph back and reports what it holds.
 *
 * HARNESS (the held-seam file's, trimmed): both real routes share one Fastify app. The session store is stateful with
 * the production READ semantics that matter: the committed graph persists, pending actions come from the latest answer
 * row through the REAL `parsePendingAction`, JSONB-key-reordered. The scenario graph read is a stub serving the stored
 * graph with the REAL analysis hash (`computeAnalysisAffectingGraphHash`) — the same hash the writer's stale gate uses.
 * OpenAI is scripted; any other network call throws; route-v2's LLM router and the Anthropic transport throw and are
 * asserted untouched.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { SystemEventTurnPayloadSchema } from '@talchain/schemas/boundary';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6b1e2d3c-4b5a-4f6e-9d7c-8b9a0f1e3d${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
const latestRow = (sid: string): Row | undefined =>
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
  readAnalysisInvalidatedAt: vi.fn(async () => null),
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
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the goal-target writer (${what})`); };
vi.mock('../../../adapters/llm/router.js', () => {
  const adapter = { name: 'test', model: 'test-model', chat: refuse('chat'), chatWithTools: refuse('chatWithTools') };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }),
    getMaxTokensFromConfig: () => undefined,
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));
/** The Anthropic transport the post-commit summariser could reach. Asserted untouched after every case. */
const anthropicCalls: unknown[] = [];
vi.mock('../../../adapters/llm/anthropic.js', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, chatWithAnthropic: async (...args: unknown[]) => { anthropicCalls.push(args); throw new Error('Anthropic transport is forbidden in this suite'); } };
});

type Chip = { id: string; label: string; message: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _provider_calls?: { provider: string }[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string }[] } };

/** A decision, a £-priced factor, and the goal the user will set a target on — no target yet. */
const seedGraph = () => {
  const e = (from: string, to: string) => ({ from, to, strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const });
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'fac_price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP' } } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: { value: 0.295, raw_value: 59, unit: 'GBP' } } },
    ],
    edges: [e('dec_x', 'opt_a'), e('dec_x', 'opt_b'), e('opt_a', 'fac_price'), e('opt_b', 'fac_price'), e('fac_price', 'goal_mrr')],
    goal_node_id: 'goal_mrr',
  };
};

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
/** Every request that reached route-v2, in order. */
let inner: Record<string, unknown>[] = [];
/** Runs inside the inner request's preHandler — BEFORE route-v2 reads the store (a writer racing the approval). */
let onInner: ((body: Record<string, unknown>) => void) | undefined;
let innerStatus: number[] = [];
let registerStale = false;
let registrations: unknown[] = [];

const SAID = 'We need at least £60k MRR by the end of the year.';
const RAW_CODE = /\b[a-z]+(?:_[a-z]+)+\b|\b[A-Z]+(?:_[A-Z]+)+\b/;

describe('the Agent sets the goal\'s success target through the REAL typed writer (route-v2 → goal_target_edit → add_constraint)', () => {
  let app: FastifyInstance;
  let analysisHash: (g: unknown) => string | null;
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
    analysisHash = (g) => computeAnalysisAffectingGraphHash(g as never);
    app = Fastify({ logger: false });
    app.addHook('preHandler', async (req) => { if (req.url === '/orchestrate/v2/turn') { inner.push(req.body as Record<string, unknown>); onInner?.(req.body as Record<string, unknown>); } });
    app.addHook('onSend', async (req, reply, payload) => { if (req.url === '/orchestrate/v2/turn') innerStatus.push(reply.statusCode); return payload; });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never) };
    });
    // The level door's writer (`applyGoalCurrentLevel`): the registration seam, CAS on the analysis hash it was approved on.
    app.post('/assist/v1/scenarios/:id/graph/register', async (req, reply) => {
      const sid = (req.params as { id: string }).id;
      const body = req.body as { graph: unknown; expected_graph_hash?: string };
      if (registerStale || (body.expected_graph_hash !== undefined && body.expected_graph_hash !== computeAnalysisAffectingGraphHash(graphOf.get(sid) as never))) {
        return reply.code(409).send({ code: 'GRAPH_STALE' });
      }
      registrations.push(body.graph);
      graphOf.set(sid, jsonbOrder(JSON.parse(JSON.stringify(body.graph))));
      return { model_version: { version_number: 2, version_id: 'v-level', mutation_id: 'm-level' } };
    });
    await app.register(ceeOrchestratorRouteV2);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; inner = []; innerStatus = []; onInner = undefined; routerCalls.length = 0; anthropicCalls.length = 0; registerStale = false; registrations = []; });
  afterEach(() => {
    expect(routerCalls, 'route-v2\'s LLM router was reached').toEqual([]);
    expect(anthropicCalls, 'the Anthropic transport was reached').toEqual([]);
  });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  type G = { nodes: { id: string; kind: string; label: string; [k: string]: unknown }[]; goal_constraints?: { node_id: string; operator: string; value: number; unit?: string; [k: string]: unknown }[] };
  const graphNow = () => graphOf.get(SCENARIO) as G;
  const goalNow = () => graphNow().nodes.find((x) => x.id === 'goal_mrr')!;
  const approveChipOf = (b: Body) => b.suggested_actions.filter((c) => c.id.startsWith('agent-approve-proposal:'));
  const proposeTarget = (value = 60000, message = SAID) => {
    script = [
      () => fnCall('propose_goal_target', { constraint_type: 'at_least', value, unit: '£', rationale: 'The user stated their MRR target.' }),
      () => say('I would set MRR\'s success target to at least £60,000. Shall I record it?'),
    ];
    return turn({ message });
  };
  const systemEvents = () => inner.filter((b) => b['kind'] === 'system_event');

  it('RED: "at least £60k" → ONE proposal, ONE approve chip, nothing written → the chip on a LATER turn → ONE goal_target_edit the REAL writer commits → read back → a plain receipt', async () => {
    const seed = seedGraph();
    graphOf.set(SCENARIO, seed);
    const baseHash = analysisHash(seed);
    expect(typeof baseHash).toBe('string');

    const t1 = await proposeTarget();
    const propose = t1._agent.tool_calls.find((c) => c.name === 'propose_goal_target');
    expect(propose, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    const approve = approveChipOf(t1);
    expect(approve.map((c) => c.id), JSON.stringify(t1.suggested_actions)).toEqual([`agent-approve-proposal:${String(propose!.proposal_id)}`]);
    expect(systemEvents(), 'a proposal writes nothing').toEqual([]);
    expect(graphNow(), 'the stored model is untouched').toEqual(seed);

    const callsBefore = openAiCalls;
    const t2 = await turn({ message: approve[0]!.message, source: 'chip', chip: { id: approve[0]!.id } });
    expect(openAiCalls - callsBefore, 'a typed approval makes no model call').toBe(0);
    expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);

    // Exactly ONE typed write reached the product, the contract's own shape, carrying exactly the approved target.
    const events = systemEvents();
    expect(events, JSON.stringify(inner)).toHaveLength(1);
    const parsed = SystemEventTurnPayloadSchema.safeParse(events[0]);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(events[0]!['event']).toEqual({ kind: 'goal_target_edit', goal_node_id: 'goal_mrr', constraint_type: 'at_least', raw_value: 60000, unit: '£', base_graph_hash: baseHash });
    expect(innerStatus.at(-1), 'the product accepted and committed it').toBe(200);

    // What the REAL handler stored: the goal's >= row and its own raw target, stamped as the user's.
    expect(graphNow().goal_constraints?.filter((c) => c.node_id === 'goal_mrr'), JSON.stringify(graphNow().goal_constraints))
      .toEqual([expect.objectContaining({ operator: '>=', value: 60000, unit: '£', provenance: 'explicit', value_frame: 'level' })]);
    expect(goalNow()).toEqual(expect.objectContaining({ goal_threshold_raw: 60000, goal_threshold_unit: '£', success_threshold: 60000, threshold_source: 'user', goal_threshold_frame: 'level' }));

    // The plain receipt the user reads.
    expect(t2.assistant_text, t2.assistant_text).toMatch(/Saved\./);
    expect(t2.assistant_text, t2.assistant_text).toContain('The goal "MRR" now has the target at least £60,000, as you stated it.');
    expect(t2.assistant_text, t2.assistant_text).not.toMatch(RAW_CODE);
    for (const b of [t1, t2]) for (const p of b._provider_calls ?? []) expect(p.provider).toBe('openai');
  }, 180_000);

  it('RED: another writer moves the model between the approval and the write → the REAL stale-base gate refuses (409), the Agent says superseded, nothing of ours is written', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeTarget())[0]!;
    expect(approve).toBeDefined();
    // Before route-v2 reads the store: an analysis-affecting edit by someone else.
    onInner = (b) => {
      if (b['kind'] !== 'system_event') return;
      const g = graphNow();
      graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'fac_price' ? { ...x, observed_state: { value: 0.3, raw_value: 60, unit: 'GBP', cap: 200 } } : x)) });
    };
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(innerStatus.at(-1), 'the product refused the stale base').toBe(409);
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false, refusal: 'superseded' }));
    expect(graphNow().goal_constraints ?? [], 'no target was written').toEqual([]);
    expect(goalNow().goal_threshold_raw).toBeUndefined();
    expect(t2.assistant_text, t2.assistant_text).not.toMatch(/\bSaved\b|now has the target/);
  }, 180_000);

  it('RED: the model moved before the approval → superseded, and NOTHING reaches the writer', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const approve = approveChipOf(await proposeTarget())[0]!;
    const g = graphNow();
    graphOf.set(SCENARIO, { ...g, nodes: g.nodes.map((x) => (x.id === 'fac_price' ? { ...x, observed_state: { value: 0.3, raw_value: 60, unit: 'GBP', cap: 200 } } : x)) });
    const t2 = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls[0], JSON.stringify(t2._agent.tool_calls)).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'superseded' }));
    expect(systemEvents(), 'nothing sent').toEqual([]);
  }, 180_000);

  it('RED: the REAL writer refuses (422 — an at-least target of 0, restored from a durable carrier) → not saved, its sentence relayed in plain words, never a code', async () => {
    const seed = seedGraph();
    graphOf.set(SCENARIO, seed);
    const { createProposal } = await import('../proposal.js');
    const { proposalPendingAction } = await import('../durable-proposal.js');
    const { approvalChipIdFor } = await import('../approval-chips.js');
    const { ADD_CONSTRAINT_USER_GUIDANCE } = await import('../../tools/handlers/d1-shared/user-guidance.js');
    // A proposal the product itself must refuse (the Agent refuses to PREPARE this; the product is the authority).
    const p = createProposal({
      scenario_id: SCENARIO, user_id: null, base_graph_identity_hash: analysisHash(seed)!,
      operations: [{ op: 'set_goal_target', path: 'goal_mrr', value: { constraint_type: 'at_least', raw_value: 0, unit: '£' } }],
      provenance: { authored_by: 'user_stated', basis: 'x' }, validation: { admitted: true, loss_count: 0, refusals: [] },
      public_label: 'Set the goal "MRR" to at least £0',
    });
    const chip = { id: approvalChipIdFor(p.proposal_id), label: 'Set this target', message: 'Yes, set that target.' };
    await store.append({ scenario_id: SCENARIO, turn_id: randomUUID(), request_hash: 'seeded', pending_actions: [proposalPendingAction(p, chip, { scenario_id: SCENARIO, emitted_at_iso: new Date().toISOString() })] });
    const t = await turn({ message: chip.message, source: 'chip', chip: { id: chip.id } });
    expect(systemEvents()).toHaveLength(1);
    expect(innerStatus.at(-1), 'the product refused with no write').toBe(422);
    expect(t._agent.tool_calls[0], JSON.stringify(t._agent.tool_calls)).toEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false, refusal: 'not_applied' }));
    expect(t.assistant_text, t.assistant_text).toContain(ADD_CONSTRAINT_USER_GUIDANCE);
    expect(t.assistant_text, t.assistant_text).not.toMatch(RAW_CODE);
    expect(graphNow(), 'nothing was written').toEqual(seed);
  }, 180_000);

  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
  // ⭐ TODAY'S LEVEL ON THE SAME CARD (AIQ #75 5913873948 row G6 · 5913897396 · 5913952911; DL 5913935708). R3's run of
  // Paul's brief: "We have secured £0 so far and need at least £1 million" gave a card for the target only, and "I'll then
  // record the current £0 level", which nothing recorded. A stated level (0 included) is the user's figure: ONE card, ONE
  // approval, both written, either failure named.
  // ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
  const proposeWithToday = (today: number, message: string) => {
    script = [
      () => fnCall('propose_goal_target', { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'The user stated their target and today\'s MRR.', current_level: { value: today, unit: '£' } }),
      () => say('I would set MRR\'s target to at least £60,000 and record today\'s £0. Shall I?'),
    ];
    return turn({ message });
  };

  for (const [today, message, said] of [
    [0, 'We have £0 MRR so far and need at least £60k MRR.', '£0'],
    [12000, 'Our MRR is £12,000 today and we need at least £60k MRR.', '£12,000'],
  ] as const) {
    it(`RED: target + today's ${said} on ONE card → ONE approval writes both, in the user's figures, and the goal's scale is left as the target writer set it`, async () => {
      graphOf.set(SCENARIO, seedGraph());
      const t1 = await proposeWithToday(today, message);
      const propose = t1._agent.tool_calls.find((c) => c.name === 'propose_goal_target');
      expect(propose, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
      const chips = approveChipOf(t1);
      expect(chips, JSON.stringify(t1.suggested_actions)).toHaveLength(1);
      expect(systemEvents(), 'a proposal writes nothing').toEqual([]);
      expect(registrations).toEqual([]);

      const t2 = await turn({ message: chips[0]!.message, source: 'chip', chip: { id: chips[0]!.id } });
      expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
      const goal = goalNow() as Record<string, unknown>;
      expect(goal).toEqual(expect.objectContaining({ goal_threshold_raw: 60000, threshold_source: 'user' }));
      expect(goal.observed_state, JSON.stringify(goal)).toEqual(expect.objectContaining({ raw_value: today, baseline: expect.any(Number), source: 'user_override' }));
      expect(registrations, 'exactly one level write').toHaveLength(1);
      expect(t2.assistant_text, t2.assistant_text).toContain(`Its level today is recorded as ${said}, your figure.`);
      expect(t2.assistant_text, t2.assistant_text).not.toMatch(RAW_CODE);
    }, 180_000);
  }

  it('CONTROL (R3/AIQ case d): the goal\'s cap and its provenance are exactly the target writer\'s, with or without today\'s level', async () => {
    const scaleOf = () => { const g = goalNow() as Record<string, unknown>; return { cap: g.goal_threshold_cap, provenance: g.goal_threshold_cap_provenance }; };
    graphOf.set(SCENARIO, seedGraph());
    const plain = approveChipOf(await proposeTarget())[0]!;
    await turn({ message: plain.message, source: 'chip', chip: { id: plain.id } });
    const targetOnly = scaleOf();
    expect(targetOnly.cap, 'the control: the target writer set a scale').toEqual(expect.any(Number));
    nextScenario();
    graphOf.set(SCENARIO, seedGraph());
    const both = approveChipOf(await proposeWithToday(0, 'We have £0 MRR so far and need at least £60k MRR.'))[0]!;
    await turn({ message: both.message, source: 'chip', chip: { id: both.id } });
    expect(scaleOf()).toEqual(targetOnly);
  }, 180_000);

  // E1 (DL 5924370309): the level is LEFT OUT of the card, never a reason to offer none — and the card promises nothing about it.
  it('RED: a today\'s level the user did not write → left out: the TARGET card goes out, promising no level, writing none, and saying nothing about a figure that was never theirs', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const t1 = await proposeWithToday(5000, 'We need at least £60k MRR.');
    const propose = t1._agent.tool_calls.find((c) => c.name === 'propose_goal_target');
    expect(propose, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    const chips = approveChipOf(t1);
    expect(chips).toHaveLength(1);
    expect(chips[0]!.label ?? chips[0]!.message, 'the card names the target only').not.toMatch(/Today:/);
    expect(t1.assistant_text, 'the £5,000 was never the user\'s: no line about it').not.toContain('Not included in this proposal: today');
    await turn({ message: chips[0]!.message, source: 'chip', chip: { id: chips[0]!.id } });
    expect(goalNow()).toEqual(expect.objectContaining({ goal_threshold_raw: 60000 }));
    expect((goalNow() as Record<string, unknown>).observed_state, 'no level written').toBeUndefined();
  }, 180_000);

  it('RED: the level write is refused after the target lands → the target is set, and the reply says today\'s level was NOT recorded', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const chip = approveChipOf(await proposeWithToday(0, 'We have £0 MRR so far and need at least £60k MRR.'))[0]!;
    registerStale = true;
    const t2 = await turn({ message: chip.message, source: 'chip', chip: { id: chip.id } });
    expect(goalNow()).toEqual(expect.objectContaining({ goal_threshold_raw: 60000 }));
    expect((goalNow() as Record<string, unknown>).observed_state).toBeUndefined();
    expect(t2.assistant_text, t2.assistant_text).toContain('The goal "MRR" now has the target at least £60,000, as you stated it.');
    expect(t2.assistant_text, t2.assistant_text).toContain('Its level today (£0) was not recorded');
    expect(t2.assistant_text, t2.assistant_text).not.toMatch(/level today is recorded/);
    // ⛔ P0 PARTNER CR (5914335527): the NEXT turn has no pending level approval — one "yes" would record what was refused.
    let seen = '';
    script = [
      () => fnCall('get_canonical_state', {}),
      (body) => { seen = JSON.stringify(body); return say('Here is the model.'); },
    ];
    await turn({ message: 'What does the model hold now?' });
    expect(seen, 'the control: the state read reached the model').toContain('awaiting_your_approval');
    expect(seen).not.toContain('Record the current level');
  }, 180_000);

  // ⛔ AIQ CHANGES_REQUIRED on #2373: the level must be bound to the GOAL, in the target's own statement. Paul's exact
  // answer (R3 `accept-paul.mjs` ANSWER) holds three £ amounts; only the one written as the goal's level today may ride.
  const PAUL = 'We have about £180k in the bank and spend roughly £45k a month, so about 4 months of runway. We have secured £0 so far and need at least £1 million.';
  const fundingSeed = () => {
    const g = seedGraph() as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[]; goal_node_id: string };
    return {
      ...g,
      nodes: g.nodes.map((n) => (n.id === 'goal_mrr' ? { id: 'goal_mrr', kind: 'goal', label: 'securing funding', goal_threshold_unit: '£' } : n)),
    };
  };
  const proposeFunding = (today: number) => {
    script = [
      () => fnCall('propose_goal_target', { constraint_type: 'at_least', value: 1000000, unit: '£', rationale: 'Paul stated his target.', current_level: { value: today, unit: '£' } }),
      () => say('Shall I record it?'),
    ];
    return turn({ message: PAUL });
  };
  // ⭐ E1 (R3 #75 5924332644; DL 5924370309): a level that cannot be bound is LEFT OUT of the card — the target card still
  // goes out (served: the Agent resent the level 6× to `hop_limit`, so NO card reached Paul) — and is never written.
  for (const [today, name] of [[180000, 'cash in the bank (£180k)'], [45000, 'monthly spend (£45k)']] as const) {
    it(`RED: Paul's answer — ${name} as today's level → left out; the TARGET card still goes out and writes no level`, async () => {
      graphOf.set(SCENARIO, fundingSeed());
      const t1 = await proposeFunding(today);
      const propose = t1._agent.tool_calls.find((c) => c.name === 'propose_goal_target');
      expect(propose, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
      const chips = approveChipOf(t1);
      expect(chips, JSON.stringify(t1.suggested_actions)).toHaveLength(1);
      expect(t1.assistant_text, 'said as not included, never "recorded"').toContain(`Not included in this proposal: today's level you gave, "£${today / 1000}k".`);
      expect(t1.assistant_text).toContain('Approving sets only the target.');
      const t2 = await turn({ message: chips[0]!.message, source: 'chip', chip: { id: chips[0]!.id } });
      expect(t2._agent.tool_calls, JSON.stringify(t2._agent.tool_calls)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
      expect(goalNow()).toEqual(expect.objectContaining({ goal_threshold_raw: 1000000, threshold_source: 'user' }));
      expect((goalNow() as Record<string, unknown>).observed_state, 'the misread level is never written').toBeUndefined();
      expect(t2.assistant_text).not.toContain('Its level today is recorded');
    }, 180_000);
  }

  // The SERVED shape (`train-0341Z`, CEE ff5453bd): the A4f draft's sibling outcomes "Investment-firm funding secured" /
  // "Angel funding secured" take both of the goal's words, so the strict scope cannot bind "secured £0 so far".
  const servedSiblingsSeed = () => {
    const g = fundingSeed();
    return { ...g, nodes: [
      ...g.nodes.map((n) => (n.id === 'goal_mrr' ? { ...n, label: 'Funding secured' } : n)),
      { id: 'out_firm', kind: 'outcome', label: 'Investment-firm funding secured' },
      { id: 'out_angel', kind: 'outcome', label: 'Angel funding secured' },
    ] };
  };
  it('RED (served E1): siblings "…funding secured" → his £0 cannot be bound, so it is left out — the £1m card STILL goes out, and the reply says the £0 was not recorded', async () => {
    graphOf.set(SCENARIO, servedSiblingsSeed());
    const t1 = await proposeFunding(0);
    const propose = t1._agent.tool_calls.find((c) => c.name === 'propose_goal_target');
    expect(propose, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(approveChipOf(t1), JSON.stringify(t1.suggested_actions)).toHaveLength(1);
    // AIQ words 5924376899: DGAI's producer opener, the verbatim span, the rivals the door found, no question.
    expect(t1.assistant_text, t1.assistant_text).toContain('Not included in this proposal: today\'s level you gave, "£0". It could belong to more than one figure in this model ("Investment-firm funding secured", "Angel funding secured"), so it isn’t recorded. Approving sets only the target.');
    expect(t1.assistant_text.split('Not included in this proposal: today').length - 1, 'said once').toBe(1);
  }, 180_000);
  it('CONTROL: the same answer on a draft with NO sibling "…secured" labels binds his £0 to the card, and no "not recorded" line', async () => {
    graphOf.set(SCENARIO, { ...fundingSeed(), nodes: fundingSeed().nodes.map((n) => (n.id === 'goal_mrr' ? { ...n, label: 'Funding secured' } : n)) });
    const t1 = await proposeFunding(0);
    expect(approveChipOf(t1)).toHaveLength(1);
    expect(t1.assistant_text).not.toContain('Not included in this proposal: today');
  }, 180_000);
  // ⛔ A DECIMAL IS NOT A SENTENCE END (MG SUCCESSOR #75 5918338227, measured on staging `d3d28031`): with Paul's real
  // target, "£1.2m", the level's quote was cut at "£1." ("…need at least £1"), so the target was not in its statement and
  // his own £0 was refused `current_level_not_bound`: no card, so the funding goal had no today's level (DR row 4 P1).
  for (const message of [
    'We have secured £0 so far and need at least £1.2m.',
    'We have about £180k in the bank and spend roughly £45k a month, so about 4 months of runway. We have secured £0 so far and need at least £1.2m.',
  ]) {
    it(`RED: "${message.slice(-52)}" → his £0 secured rides the £1.2m target card`, async () => {
      graphOf.set(SCENARIO, fundingSeed());
      script = [
        () => fnCall('propose_goal_target', { constraint_type: 'at_least', value: 1200000, unit: '£', rationale: 'Paul stated his target.', current_level: { value: 0, unit: '£' } }),
        () => say('Shall I record it?'),
      ];
      const t1 = await turn({ message });
      const propose = t1._agent.tool_calls.find((c) => c.name === 'propose_goal_target');
      expect(propose, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
      expect(approveChipOf(t1)).toHaveLength(1);
    }, 180_000);
  }

  it('CONTROL: Paul\'s answer — his stated £0 secured rides the target card (the positive control)', async () => {
    graphOf.set(SCENARIO, fundingSeed());
    const t1 = await proposeFunding(0);
    const propose = t1._agent.tool_calls.find((c) => c.name === 'propose_goal_target');
    expect(propose, JSON.stringify(t1._agent.tool_calls)).toEqual(expect.objectContaining({ ok: true, mutated: false }));
    expect(approveChipOf(t1)).toHaveLength(1);
  }, 180_000);
});
