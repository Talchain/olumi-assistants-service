/**
 * FIX-r1 P1: the REAL More-risks press → Add → held-card approval stores a
 * server-stamped zero-link risk. The ordinary Canvas/Agent edge writer must
 * then refuse either direction with the central named reason, preserving the
 * whole saved graph. Harness copied from widen-risks-seam.test.ts: real Agent
 * and route-v2, stateful persistence with production JSONB pending reads.
 * Rows added RED-first by source inspection at 8fb1959; tests are author-owned.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { asSent } from './helpers/as-sent.js';

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
/** route-v2's LLM router: the typed risk Add and its confirm are deterministic — ANY use is a failure. */
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the RC3 precondition-risk seam (${what})`); };
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
/** Extra keys on the graph read (an analysis state), per row. */
let extraRead: Record<string, unknown> = {};

describe('RC3 FIX-r1: real More-risks approval followed by the ordinary edge door', () => {
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
        graph_identity_hash: g === null ? null : computeGraphIdentityHash(g as never), ...extraRead };
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
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; inner = []; onInner = undefined; onInnerSent = undefined; routerCalls.length = 0; extraRead = {}; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const graphNow = () => graphOf.get(SCENARIO) as { nodes: { id: string; kind: string; label: string; proposed_by?: string;
    analysis_participation?: string; interventions?: Record<string, unknown> }[]; edges: { from: string; to: string }[] };
  const approveChipOf = (b: Body) => b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
  const RISKS = { id: 'agent-next-suggest-risks', message: "Suggest risks I haven't considered." };
  const candidates = (items: unknown) => say(`<risk_suggestions>${JSON.stringify(items)}</risk_suggestions>`);
  const addChips = (b: Body) => b.suggested_actions.filter((c) => c.id.startsWith('agent-widen-add:'));
  /** Paul's pricing precondition, approved through the real More-risks door. */
  const RC3_PRICING = {
    nodes: [
      { id: 'dec_pricing', kind: 'decision', label: 'How should we price the Pro plan?' },
      { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold_unit: '£', goal_threshold_raw: 50000 },
      { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 0.49, raw_value: 49, unit: '£', cap: 100 } },
      { id: 'keep_49', kind: 'option', label: 'Keep £49', is_baseline: true, interventions: { pro_plan_price: { value: 0.49, raw_value: 49, unit: '£' } } },
      { id: 'raise_59', kind: 'option', label: 'Raise Pro price to £59', interventions: { pro_plan_price: { value: 0.59, raw_value: 59, unit: '£' } } },
    ],
    edges: [
      { from: 'dec_pricing', to: 'keep_49', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'dec_pricing', to: 'raise_59', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'keep_49', to: 'pro_plan_price', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', origin: 'repair' },
      { from: 'raise_59', to: 'pro_plan_price', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'pro_plan_price', to: 'mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    ],
    goal_node_id: 'mrr',
    goal_constraints: [],
  };
  const RC3_TIMING = {
    label: 'Feature release slips', category: 'timing', hits_id: 'raise_59', through_id: 'pro_plan_price', through_direction: 'negative', mechanism: 'drives',
    affects_id: 'mrr', direction: 'negative', relies_on: 'the feature release enabling the planned price increase', watch_for: 'release date moves',
  };


  const LINK_REFUSAL = "‘Feature release slips’ is tied to ‘Raise Pro price to £59’ and left out of the Run; this model can't link it yet.";
  async function approvePrecondition() {
    graphOf.set(SCENARIO, structuredClone(RC3_PRICING));
    script = [() => candidates([RC3_TIMING])];
    const suggestions = await turn({ message: RISKS.message, source: 'chip', chip: { id: RISKS.id } });
    const add = addChips(suggestions)[0]!;
    expect(add, 'real More-risks Add press').toBeDefined();
    const held = await turn({ message: add.message, source: 'chip', chip: { id: add.id } });
    const approve = approveChipOf(held)!;
    expect(approve, 'real held card has its own approval').toBeDefined();
    await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(graphNow().nodes.find((node) => node.id === 'risk_feature_release_slips'))
      .toMatchObject({ kind: 'risk', relies_on: { option_id: 'raise_59' } });
    expect(graphNow().edges.filter((link) => link.from === 'risk_feature_release_slips' || link.to === 'risk_feature_release_slips')).toEqual([]);
    return graphNow();
  }

  it('rc3-r1-preexisting-held-edge-approval: real approved precondition stays unchanged and the held executor gives the named refusal', async () => {
    const { executeGmHeldResume } = await import('../../handlers/gm-held-execute.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const approved = await approvePrecondition();
    const bytes = JSON.stringify(approved);
    const outcome = executeGmHeldResume({
      operations: [{ op: 'add_edge', path: 'risk_feature_release_slips::mrr', value: {
        from: 'risk_feature_release_slips', to: 'mrr', strength: { mean: -0.85, std: 0.1 }, exists_probability: 1, effect_direction: 'negative',
      } }] as never,
      currentGraph: approved, currentGraphHash: computeAnalysisAffectingGraphHash(approved as never)!,
      freshness: 'none', hasExistingAnalysis: false, scenarioId: SCENARIO, turnId: randomUUID(), requestId: 'rc3-r1-held-edge',
    });
    expect(outcome.status).not.toBe('executed');
    expect(outcome).toMatchObject({ userReason: LINK_REFUSAL });
    expect(JSON.stringify(graphNow())).toBe(bytes);
  }, 120_000);

  it.each([
    ['rc3-r1-real-approved-risk-to-MRR-ordinary-edge-door', 'risk_feature_release_slips', 'mrr'],
    ['rc3-r1-real-approved-factor-to-risk-ordinary-edge-door', 'pro_plan_price', 'risk_feature_release_slips'],
  ])('%s: refused with named reason; approved graph and stamp stay unchanged', async (_row, from, to) => {
    const { applyStructuralAddEdge } = await import('../../system-events/structural-add-edge.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const approved = await approvePrecondition();
    const bytes = JSON.stringify(approved);
    const calls = openAiCalls;
    // The ordinary Canvas/Agent edge writer, not a hand-built risk or a mocked structural validator.
    const event = { kind: 'structural_add_edge' as const, from, to, magnitude: 0.85,
      effect_direction: 'negative' as const, base_graph_hash: computeAnalysisAffectingGraphHash(approved as never)! };
    const payload = { kind: 'system_event' as const, scenario_id: SCENARIO, turn_id: randomUUID(), stage: 'frame' as const, event };
    const result = applyStructuralAddEdge({ payload: payload as never, event, requestId: 'rc3-r1-link', persistedGraph: approved });
    expect(result.kind, 'M-r1-incident-edge: HEAD revives the rejected representation here').toBe('refused');
    if (result.kind !== 'refused') throw new Error('the ordinary edge door returned a graph that could be committed');
    expect(result.reason).toBe('PRECONDITION_RISK_LINKED');
    expect(result.response.assistant_text).toBe(LINK_REFUSAL);
    // Continue through the REAL system-event route/dispatcher as well. Its
    // refusal answer is saved, while no graph bytes or edit fact are written.
    const appendAt = store.append.mock.calls.length;
    const response = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload });
    expect(response.statusCode, response.body.slice(0, 400)).toBe(200);
    expect(response.json().assistant_text).toBe(LINK_REFUSAL);
    const writes = store.append.mock.calls.slice(appendAt).map(([write]) => write);
    expect(writes.length, 'the refusal answer is retained').toBeGreaterThan(0);
    expect(writes.every((write) => write.graph === undefined || write.graph === null), 'no refused graph is dispatched to persistence').toBe(true);
    expect(writes.every((write) => (write.handler_facts ?? []).length === 0), 'the refusal does not claim an applied edit').toBe(true);
    expect(JSON.stringify(graphNow())).toBe(bytes);
    expect(JSON.stringify(approved), 'the rejected writer never mutates its base').toBe(bytes);
    expect(openAiCalls, 'refusal is deterministic').toBe(calls);
    expect(graphNow().nodes.find((node) => node.id === 'risk_feature_release_slips'))
      .toMatchObject({ relies_on: { option_id: 'raise_59' } });
    expect(graphNow().edges.some((link) => link.from === from && link.to === to)).toBe(false);
  }, 120_000);
});
