/** B4: zero-provider RED rows through the real loop, capabilities, risk door and route-v2 confirm.
 * Storage is in-memory and network calls are scripted or throw. Outcomes are bound by labels and ids.
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

/** How many times the scenario graph was read (slice C1c). */
/** Scripted OpenAI: each Agent model call takes the next reply; anything that is not OpenAI throws. */
let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
/** The inner requests the Agent sent to route-v2, in order. */
let inner: Record<string, unknown>[] = [];
/** Runs inside the inner request's preHandler — BEFORE route-v2 reads the store (a writer racing the confirm). */
let onInner: ((body: Record<string, unknown>) => void) | undefined;
/** Runs as route-v2's answer to an inner request is sent — AFTER it has decided. */
let onInnerSent: ((body: Record<string, unknown>) => void) | undefined;

describe('B4 typed request fulfilment — real loop and held route, zero providers', () => {
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
  /** The hold the Agent's LATEST answer row carries — what the next turn (and route-v2's confirm) will read. */
  const heldOnLatestRow = async () => {
    const pendings = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; expires_at_turn_count: number; action: { kind: string; inline_patch?: { handler_id?: string; operations?: { op: string; path: string }[] } } }[];
    return pendings.filter((p) => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };

  const risks = ['Competitor price cut', 'Key hire leaves', 'Vendor outage', 'Market contraction'];
  const spec = (label: string, target = 'Revenue') => ({ label, affects: [{ target_label: target, direction: 'negative' as const }] });
  const calls = (entries: Record<string, unknown>[]) => entries.map((args, i) => ({ type: 'function_call', name: 'propose_new_risk', call_id: `risk-${i}`, arguments: JSON.stringify({ rationale: 'User asked', ...args }) }));
  const seed = (existing = false) => {
    const g = seedGraph();
    if (existing) g.nodes.push({ id: 'risk_churn', kind: 'risk', label: 'Churn spike' } as never);
    graphOf.set(SCENARIO, g);
  };
  // Real capabilities, in-process risk door and route-v2 confirm. Only the model is scripted.
  const run = async (outputs: Record<string, unknown>[][], message = 'Add the risks.', stampCommitLabels = false) => {
    const { createAgentCapabilities } = await import('../runtime/agent-capabilities.js');
    const { ProposalStore } = await import('../proposal.js');
    const { holdAddRiskInProcess } = await import('../../system-events/dispatch.js');
    const { runAgentTurn } = await import('../runtime/agent-loop.js');
    const { composeProposalReply } = await import('../proposal-reply.js');
    const caps = createAgentCapabilities(async (path, body) => {
      const r = await app.inject({ method: 'POST', url: path, payload: body as Record<string, unknown> });
      const json = r.json() as Record<string, unknown>;
      if (stampCommitLabels && json.draft_graph !== undefined) {
        // Independent commit-authority witness: the response and read-back agree, while the hold still
        // has its old labels. A receipt must read the commit, even when its labels differ from the hold.
        const committed = structuredClone(json.draft_graph) as { nodes: { kind: string; label: string }[] };
        for (const n of committed.nodes) if (n.kind === 'risk') n.label += ' (committed)';
        graphOf.set(SCENARIO, committed);
        const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
        json.draft_graph = committed;
        json.graph_hash = computeAnalysisAffectingGraphHash(committed as never);
      }
      return { status: r.statusCode, json };
    }, new ProposalStore(), undefined, 'full', undefined, {
      readPendingActions: async (sid) => await store.readMostRecentPendingActions(sid) as never,
      holdAddRisk: async (input) => holdAddRiskInProcess(input, 'b4-test'),
    });
    return runAgentTurn({ ctx: { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'b4-test', user_turn_text: message },
      history: [], message, instructions: 'test', maxOutputTokens: 100, maxHops: 5,
      composeReply: (tool, args, result) => composeProposalReply(tool, args, result, message),
    }, caps, async () => ({ output: outputs.shift() ?? (say('Done.') as { output: Record<string, unknown>[] }).output }));
  };
  type Entry = { requested_label: string; outcome: string; reason?: string; entity_id?: string };
  const ledger = (r: { tool_results: readonly Record<string, unknown>[] }): Entry[] => r.tool_results.flatMap((t) => Array.isArray(t.fulfilment) ? t.fulfilment as Entry[] : []);
  const identity = (entries: Entry[]) => entries.map((e) => [e.requested_label, e.outcome, e.reason ?? null, e.entity_id ?? null]);
  const pendingNodes = async () => (await heldOnLatestRow()).flatMap((p) => p.action.inline_patch?.operations ?? []).filter((o) => o.op === 'add_node');

  it('F1: three separate risk calls become one hold; the existing risk is identified; later proposals are typed deferred', async () => {
    seed(true);
    const r = await run([calls([spec(risks[0]!), spec('Churn spike'), spec(risks[1]!)]), (say('I have prepared all three risks for you to approve.') as { output: Record<string, unknown>[] }).output]);
    expect(identity(ledger(r))).toEqual([
      [risks[0], 'proposed', null, 'risk_competitor_price_cut'],
      ['Churn spike', 'already_present', 'risk_exists', 'risk_churn'],
      [risks[1], 'proposed', null, 'risk_key_hire_leaves'],
    ]);
    expect(await heldOnLatestRow()).toHaveLength(1);
    expect((await pendingNodes()).map((o) => o.path)).toEqual(['risk_competitor_price_cut', 'risk_key_hire_leaves']);
    for (const e of ledger(r)) expect(r.assistant_text).toContain(e.requested_label);
    expect(r.assistant_text).not.toContain('all three');
    expect(r.items.filter((x) => (x as { type?: string }).type === 'function_call_output')).toHaveLength(3);
    // F1 also pins the second-proposal guard across hops: this item cannot join an already offered hold.
    nextScenario(); seed();
    const deferred = await run([calls([spec(risks[0]!)]), calls([spec(risks[1]!)]), (say("I've added all of them.") as { output: Record<string, unknown>[] }).output]);
    expect(identity(ledger(deferred))).toEqual([
      [risks[0], 'proposed', null, 'risk_competitor_price_cut'],
      [risks[1], 'deferred', 'one_change_per_approval', null],
    ]);
    expect(deferred.assistant_text).toContain(risks[1]);
    expect(deferred.assistant_text).toContain('deferred');
  }, 120_000);

  it('F2: four new risks have four identities in one hold and one approval chip', async () => {
    seed();
    const r = await run([calls([{ risks: risks.map((l) => spec(l)), whole_request: true }])]);
    expect(ledger(r).map((e) => [e.requested_label, e.outcome])).toEqual(risks.map((l) => [l, 'proposed']));
    const held = await heldOnLatestRow();
    expect(held).toHaveLength(1);
    expect(held[0]!.chip_id).toMatch(/^gmh_/);
    expect(await pendingNodes()).toHaveLength(4);
    for (const label of risks) expect(r.assistant_text).toContain(label);
    expect(r.assistant_text.match(/Approve[^?]*\?/g)).toHaveLength(1);
  }, 120_000);

  it('F3: the fifth requested risk is deferred by name at the cap', async () => {
    seed();
    const r = await run([calls([{ risks: [...risks, 'Regulatory delay'].map((l) => spec(l)), whole_request: true }])]);
    expect(ledger(r).map((e) => [e.requested_label, e.outcome, e.reason])).toEqual([
      ...risks.map((l) => [l, 'proposed', undefined]), ['Regulatory delay', 'deferred', 'cap'],
    ]);
    expect(await pendingNodes()).toHaveLength(4);
    expect(r.assistant_text).toMatch(/Regulatory delay.*deferred/);
  }, 120_000);

  it('F4: a factor target keeps the door refusal code and the other risks are proposed', async () => {
    seed();
    const r = await run([calls([{ risks: [spec(risks[0]!), spec('Never a factor', 'Price'), spec(risks[1]!)], whole_request: true }])]);
    expect(identity(ledger(r))).toEqual([
      [risks[0], 'proposed', null, 'risk_competitor_price_cut'],
      ['Never a factor', 'refused', 'risk_affects_factor', null],
      [risks[1], 'proposed', null, 'risk_key_hire_leaves'],
    ]);
    expect(await pendingNodes()).toHaveLength(2);
    expect(r.assistant_text).toMatch(/Never a factor.*refused/);
  }, 120_000);

  it('F5: approve F2 through real route-v2; receipt identities come from the committed graph', async () => {
    seed();
    const proposed = await run([calls([{ risks: risks.map((l) => spec(l)), whole_request: true }])]);
    const ref = proposed.tool_results[0]!.proposal_id as string;
    const holdNodes = await pendingNodes();
    // The receipt must name each committed identity, with committed (never proposed) outcomes.
    const approved = await run([[{ type: 'function_call', name: 'authorise_change', call_id: 'approve', arguments: JSON.stringify({ proposal_id: ref }) }]], 'Approve the risks.', true);
    const receipt = ledger(approved);
    const g = graphNow();
    expect(receipt.map((e) => [e.entity_id, e.requested_label, e.outcome])).toEqual(holdNodes.map((o) => [o.path, g.nodes.find((n) => n.id === o.path)!.label, 'committed']));
    expect(g.nodes.filter((n) => n.kind === 'risk').map((n) => [n.id, n.label])).toEqual(receipt.map((e) => [e.entity_id, e.requested_label]));
    expect(receipt.map((e) => e.requested_label)).toEqual(risks.map((l) => l + ' (committed)'));
    expect(await heldOnLatestRow()).toEqual([]);
    for (const label of risks) expect(approved.tool_results[0]!.follow_up).toContain(label);
    // A consumed hold cannot produce a second committed ledger.
    const replay = await run([[{ type: 'function_call', name: 'authorise_change', call_id: 'again', arguments: JSON.stringify({ proposal_id: ref }) }]]);
    expect(ledger(replay)).toEqual([]);
    expect(replay.mutated).toBe(false);
  }, 120_000);

  it('F6: false model narration never reaches wire, stored answer or request replay', async () => {
    seed(true);
    const claim = "I've added all of them.";
    script = [() => ({ output: calls([spec(risks[0]!), spec('Churn spike'), spec(risks[1]!)]) }), () => say(claim)];
    const turnId = randomUUID();
    const payload = { message: 'Add all three risks.', turn_id: turnId };
    const wire = await turn(payload);
    for (const label of [risks[0]!, 'Churn spike', risks[1]!]) expect(wire.assistant_text).toContain(label);
    expect(wire.assistant_text).not.toContain(claim);
    expect(wire.suggested_actions.filter((c) => c.id.startsWith('agent-approve-proposal:'))).toHaveLength(1);
    expect(latestRow()!.assistant_message).toBe(wire.assistant_text);
    const callsBefore = openAiCalls;
    const replay = await turn(payload);
    expect(replay.assistant_text).toBe(wire.assistant_text);
    expect(openAiCalls).toBe(callsBefore);
  }, 120_000);

  it('F3 boundary: an existing fifth risk remains already_present past the proposal cap', async () => {
    seed(true);
    const r = await run([calls([{ risks: [...risks, 'Churn spike'].map((l) => spec(l)), whole_request: true }])]);
    expect(ledger(r).at(-1)).toEqual({ requested_label: 'Churn spike', outcome: 'already_present', reason: 'risk_exists', entity_id: 'risk_churn' });
    expect(await pendingNodes()).toHaveLength(4);
  }, 120_000);

  it('F4 boundary: no accepted items means no held change and no approval question', async () => {
    seed(true);
    const r = await run([calls([{ risks: [spec('Churn spike'), spec('Never a factor', 'Price')], whole_request: true }])]);
    expect(ledger(r).map((e) => [e.requested_label, e.outcome])).toEqual([['Churn spike', 'already_present'], ['Never a factor', 'refused']]);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(r.assistant_text).not.toContain('Approve');
  }, 120_000);

  it('F4 boundary: the ledger keeps the builder’s specific dead-end refusal code', async () => {
    seed();
    const g = graphNow();
    graphOf.set(SCENARIO, { ...g, nodes: [...g.nodes, { id: 'out_trust', kind: 'outcome', label: 'Brand trust' }] });
    const r = await run([calls([{ risks: [spec(risks[0]!), spec('Trust loss', 'Brand trust')], whole_request: true }])]);
    expect(ledger(r).at(-1)).toEqual({ requested_label: 'Trust loss', outcome: 'refused', reason: 'risk_unreachable' });
    expect(r.assistant_text).toContain('the risk does not lead to the goal');
    expect(await pendingNodes()).toHaveLength(1);
  }, 120_000);

  it('F2 identity boundary: colliding normalised id bases still identify two separate risks', async () => {
    seed();
    const labels = ['Vendor outage!', 'Vendor outage?'];
    const r = await run([calls([{ risks: labels.map((l) => spec(l)), whole_request: true }])]);
    expect(ledger(r).map((e) => [e.requested_label, e.outcome])).toEqual(labels.map((l) => [l, 'proposed']));
    expect(new Set(ledger(r).map((e) => e.entity_id)).size).toBe(2);
    expect(await pendingNodes()).toHaveLength(2);
  }, 120_000);

  it('F1 boundary: an option already holds the approval; every grouped risk is deferred once', async () => {
    seed();
    const option = { type: 'function_call', name: 'propose_new_option', call_id: 'option', arguments: JSON.stringify({
      label: 'Test 54', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }], rationale: 'User asked',
    }) };
    const r = await run([[option, ...calls([spec(risks[0]!), spec(risks[1]!)])]]);
    expect(identity(ledger(r))).toEqual(risks.slice(0, 2).map((l) => [l, 'deferred', 'one_change_per_approval', null]));
    expect(await pendingNodes()).toHaveLength(1);
    expect(r.assistant_text).toContain('Test 54');
    for (const label of risks.slice(0, 2)) expect(r.assistant_text).toContain(label);
    expect(r.assistant_text.match(/Approve[^?]*\?/g)).toHaveLength(1);
  }, 120_000);

  it('CONTROL single risk marked whole_request keeps the existing byte-exact reply', async () => {
    seed();
    const r = await run([calls([{ ...spec(risks[0]!), whole_request: true }])]);
    const { composeProposalReply } = await import('../proposal-reply.js');
    const legacy = { ...r.tool_results[0] };
    delete legacy.fulfilment;
    expect(r.assistant_text).toBe(composeProposalReply('propose_new_risk', { whole_request: true }, legacy, 'Add the risks.'));
    expect(r.assistant_text).toContain('It threatens Revenue (lowers it).');
  }, 120_000);

  it('CONTROL bulk OPTIONS still use one existing compound hold', async () => {
    seed();
    const r = await run([[{ type: 'function_call', name: 'propose_new_option', call_id: 'options', arguments: JSON.stringify({ options: [
      { label: 'Test 54', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 54, unit: 'GBP' } }] },
      { label: 'Test 64', acts_on: [{ factor_label: 'Price', direction: 'positive', level: { value: 64, unit: 'GBP' } }] },
    ], rationale: 'User asked' }) }]]);
    expect(r.tool_results[0]!.ok).toBe(true);
    expect(await heldOnLatestRow()).toHaveLength(1);
    expect(await pendingNodes()).toHaveLength(2);
  }, 120_000);
});
