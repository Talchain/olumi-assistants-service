/**
 * ⭐ LIVING MODEL — ONE SLICE (PTL #85 5963052437 item 7; lease 5963140107):
 *   1. ONE explicit, unresolved assumption is preserved in the canonical model: a goal-path link whose size is Olumi's
 *      estimate nobody confirmed (`edge.provenance.magnitude: 'olumi_estimate'`, read by the ONE reader `linkSizing`);
 *   2. Olumi questions it and proposes ONE genuinely different mechanism as a PROPOSAL (the Widen door's held `gmh_`
 *      card), never as truth: an option that reaches the goal WITHOUT that link;
 *   3. the user adopts it (the existing approve chip) or rejects it (nothing is written);
 *   4. an adopted option enters the existing Analysis Projection (the Run's PLoT request);
 *   5. a rerun shows the changed consequence (the new option's result; the old Run reads stale);
 *   6. a cold reload keeps the question, the objective, the assumption (byte for byte) and the provenance (Olumi's
 *      estimate on the adopted level; the answer row that named the assumption).
 *
 * HARNESS: `widen-turn-seam.test.ts` (the REAL route-v2 and the REAL Agent route in one app, a stateful store with
 * production read semantics, OpenAI scripted, route-v2's LLM router throws if touched). The Run is the REAL run_analysis
 * handler over the REAL snapshot loader reading the graph the route wrote; only PLoT's calculation is stubbed. The reload
 * is the REAL `readScenarioAnalysis`. 0 LLM, 0 network, 0 Supabase.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { asSent } from './helpers/as-sent.js';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6b1e2d3c-4b5a-4f6e-9d7c-8b9a0f1e3d${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
/** Run facts the REAL handler committed, as the durable analysis record serves them. */
const runFacts: Record<string, any>[] = [];
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
        handler_facts: jsonbOrder(JSON.parse(JSON.stringify(w.handler_facts ?? []))) as unknown[],
        created_at: new Date(Date.UTC(2026, 9, 3, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => [...runFacts]),
  readFactsWithTurnFor: vi.fn(async (ids: readonly string[]) => [
    ...[...rows.values()].filter((r) => ids.includes(r.id)).flatMap((r) => r.handler_facts.map((fact) => ({ turn_id: r.id, fact }))),
    ...runFacts.map((fact, i) => ({ fact, fact_row_id: `run-${i}`, fact_created_at: fact.result.computed_at, turn_id: `run-turn-${i}` })),
  ]),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({
    facts: runFacts.map((fact, i) => ({ fact, fact_row_id: `run-${i}`, fact_created_at: fact.result.computed_at })), total_count: runFacts.length })),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
  storeDraftGraph: vi.fn(async (sid: string, g: unknown) => { graphOf.set(sid, g); }),
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSessionStore: () => store, resetSessionStoreForTests: () => {},
}));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
const refuse = (what: string) => async () => { throw new Error(`route-v2 LLM router must not be used on this seam (${what})`); };
vi.mock('../../../adapters/llm/router.js', () => {
  const adapter = { name: 'test', model: 'test-model', chat: refuse('chat'), chatWithTools: refuse('chatWithTools') };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }),
    getMaxTokensFromConfig: () => undefined,
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));

type Rec = Record<string, any>;
type Chip = { id: string; label: string; message: string };
type Body = { assistant_text: string; suggested_actions: Chip[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string }[] } };

/** The ONE assumption this slice is about: Olumi's unconfirmed estimate of how Price moves Customer churn. */
const ASSUMED = { from: 'fac_price', to: 'fac_churn' } as const;
const assumedEdge = () => ({
  from: ASSUMED.from, to: ASSUMED.to, strength: { mean: 0.3, std: 0.15 }, exists_probability: 0.8, effect_direction: 'positive' as const,
  provenance: { source: 'cee_hypothesis' as const, magnitude: 'olumi_estimate' as const },
});
/**
 * A decision, a goal, Price (the lever both options set), Customer churn (lowers Revenue), and Olumi's assumed link
 * Price → Customer churn. Both of the user's options work through Price, so their whole difference rests partly on that
 * assumed link. Interventions are in the STORED shape ({ value, raw_value, unit }).
 */
const seedGraph = (assumed: Rec = assumedEdge(), withReferral = false) => {
  const e = (from: string, to: string, mean = 1) => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1,
    effect_direction: mean < 0 ? 'negative' as const : 'positive' as const });
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
      { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
      { id: 'fac_price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
      { id: 'fac_churn', kind: 'factor', label: 'Customer churn', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
      ...(withReferral ? [{ id: 'fac_referral', kind: 'factor', label: 'Referral rate', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } }] : []),
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP' } } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: { value: 0.295, raw_value: 59, unit: 'GBP' } } },
    ],
    edges: [e('dec_x', 'opt_a'), e('dec_x', 'opt_b'), e('opt_a', 'fac_price'), e('opt_b', 'fac_price'),
      e('fac_price', 'goal_x'), e('fac_churn', 'goal_x', -0.6), ...(withReferral ? [e('fac_referral', 'goal_x', 0.4)] : []), assumed],
    goal_node_id: 'goal_x',
  };
};

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
let inner: Record<string, unknown>[] = [];

const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as Rec;

describe('LIVING MODEL: question ONE assumption → ONE different mechanism as a proposal → adopt/reject → Run → reload', () => {
  let app: FastifyInstance;
  async function buildApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const { computeGraphIdentityHash } = await import('../../context/graph-identity.js');
    const a = Fastify({ logger: false });
    a.addHook('preHandler', async (req) => { if (req.url === '/orchestrate/v2/turn') inner.push(req.body as Record<string, unknown>); });
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
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; inner = []; runFacts.length = 0; });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as Body;
  };
  const graphNow = () => graphOf.get(SCENARIO) as { nodes: Rec[]; edges: Rec[]; goal_node_id?: string };
  const edgeOf = (g: { edges: Rec[] }, from: string, to: string) => g.edges.find((x) => x.from === from && x.to === to);
  const approveChipOf = (b: Body) => b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
  const optionLabels = () => graphNow().nodes.filter((x) => x.kind === 'option').map((x) => String(x.label)).sort();
  const heldOnLatestRow = async () => {
    const pendings = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; action: { kind: string;
      inline_patch?: { handler_id?: string; operations?: { op: string; path: string; value?: Rec }[] } } }[];
    return pendings.filter((p) => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };
  const addsOption = () => inner.filter((b) => (b['chip'] as { intent?: string } | undefined)?.intent === 'add_option');
  const hashes = async () => {
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    return computeAnalysisAffectingGraphHash(graphNow() as never);
  };

  /** The press, exactly as a client sends it: the typed chip naming the stored link by its endpoints. */
  const pressFor = async (from: string, to: string, turnId = randomUUID()) => {
    const { challengePressFor } = await import('../method-turn/widen-turn.js');
    const chip = challengePressFor(from, to);
    return turn({ turn_id: turnId, message: chip.message, source: 'chip', chip: { id: chip.id } });
  };
  /** Olumi's estimate for a LOWER churn (cap 200: 20 → 0.1), the door's own level shape. */
  const retention = { label: 'Retention offer', acts_on: [{ factor_label: 'Customer churn', direction: 'negative',
    level: { value: 20, unit: 'GBP', estimate: true, basis: 'a typical retention programme for this price band' } }] };

  /** The REAL run_analysis handler over the REAL snapshot loader reading the stored graph; PLoT's maths stubbed. */
  const plotBodies: Rec[] = [];
  async function runAnalysis(turnId: string): Promise<Rec> {
    const { createRunAnalysisHandler } = await import('../../tools/handlers/run-analysis.js');
    const { loadScenarioSnapshotForRunAnalysis } = await import('../../build-turn-context.js');
    const { createNoopSessionStore } = await import('../../session/__tests__/fixtures.js');
    const { makeMessagePayload } = await import('../../__tests__/fixtures.js');
    const plotClient = {
      validatePatch: vi.fn().mockResolvedValue({}),
      run: vi.fn(async (body: Rec) => {
        plotBodies.push(structuredClone(body));
        const response = structuredClone(happy);
        response.results = (body.options as Rec[]).map((o, i) => ({ option_id: o.option_id, option_label: o.label,
          win_probability: [0.5, 0.3, 0.2][i] ?? 0, percentile_p10: 0.1, percentile_p90: 0.9 }));
        response.fact_objects = [];
        response.review_cards = [];
        return response;
      }),
    };
    const handler = createRunAnalysisHandler({
      plotClient: plotClient as never,
      scenarioReader: (id: string) => loadScenarioSnapshotForRunAnalysis(id, turnId, createNoopSessionStore({ loadGraphResult: structuredClone(graphNow()) })),
    } as never);
    const out = await handler({
      context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
        messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO, request_id: turnId,
        budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
      payload: makeMessagePayload({ turn_id: turnId, scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
      requestId: turnId, signal: new AbortController().signal, orientationText: '',
    } as never);
    const fact = (out as unknown as { handler_facts: Rec[] }).handler_facts.find((f) => f.fact_type === 'run_analysis');
    expect(fact, 'the handler commits one Run fact').toBeDefined();
    runFacts.push(fact!);
    return fact!;
  }
  const coldRead = async () => {
    const { readScenarioAnalysis } = await import('../../../routes/scenario-graph-analysis-read.js');
    return readScenarioAnalysis({ scenarioId: SCENARIO, graph: structuredClone(graphNow()), requestId: 'cold-reload' }) as Promise<Rec>;
  };

  it('LM-1 the assumption is explicit and unresolved on the stored model, read by the ONE reader', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const { linkSizing } = await import('../../../cee/magnitude/link-sizing.js');
    expect(linkSizing(edgeOf(graphNow(), ASSUMED.from, ASSUMED.to))).toBe('olumi_estimate');
  });

  it('LM-2 PROPOSAL, NOT TRUTH: the press is ONE model call whose only tool is the door, told the assumed link; ONE held card naming it; nothing written', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = await hashes();
    const assumedBefore = structuredClone(edgeOf(graphNow(), ASSUMED.from, ASSUMED.to));
    const bodies: Record<string, unknown>[] = [];
    script = [(body) => { bodies.push(asSent(body) as Record<string, unknown>); return fnCall('propose_new_option', { ...retention,
      rationale: 'Lowers churn directly, whatever price does to it.' }); }];
    const t1 = await pressFor(ASSUMED.from, ASSUMED.to);
    expect(openAiCalls, 'ONE model call').toBe(1);
    expect(((bodies[0]!['tools'] ?? []) as { name?: string }[]).map((x) => x.name), 'the door is the ONLY tool').toEqual(['propose_new_option']);
    const instructions = JSON.stringify(bodies[0]!['instructions'] ?? '');
    expect(instructions).toContain('‘Price’ → ‘Customer churn’');
    expect(instructions).toContain('METHOD TURN: the user asked Olumi to question one assumption');
    // ⛔ Nothing is truth yet: the model, its options and the assumption are byte-identical before the approval.
    expect(await hashes()).toBe(before);
    expect(optionLabels()).toEqual(['Keep £49', 'Raise to £59']);
    expect(edgeOf(graphNow(), ASSUMED.from, ASSUMED.to)).toEqual(assumedBefore);
    expect(t1._agent.tool_calls.map((c) => [c.name, c.ok])).toEqual([['propose_new_option', true]]);
    const approve = approveChipOf(t1);
    expect(approve?.id, JSON.stringify(t1.suggested_actions)).toMatch(/^agent-approve-proposal:gmh_[0-9a-f]{12}$/);
    // S-D, DL 7 Oct, Canvas capture #2614: Not now follows Change something first.
    expect(t1.suggested_actions.map((c) => c.id)).toEqual([approve!.id, 'agent-amend-proposal', `agent-decline-proposal:${approve!.id.slice('agent-approve-proposal:'.length)}`,
      `agent-question-keep:${approve!.id.slice('agent-approve-proposal:'.length)}`]);
    // The reply names the assumption it questions (typed labels) and the ONE option it holds.
    expect(t1.assistant_text).toContain('‘Price’ → ‘Customer churn’');
    expect(t1.assistant_text).toContain('Retention offer');
    expect((await heldOnLatestRow()).map((p) => p.chip_id)).toEqual([approve!.id.slice('agent-approve-proposal:'.length)]);
  }, 120_000);

  it('LM-3 GENUINELY DIFFERENT, by identity: an option on the link’s own source is refused inside the door — no hold, no chip, nothing stored', async () => {
    graphOf.set(SCENARIO, seedGraph());
    script = [() => fnCall('propose_new_option', { label: 'Cut price to win share', rationale: 'r',
      acts_on: [{ factor_label: 'Price', direction: 'negative', level: { value: 45, unit: 'GBP', estimate: true, basis: 'just below £49' } }] })];
    const t1 = await pressFor(ASSUMED.from, ASSUMED.to);
    expect(t1._agent.tool_calls.map((c) => [c.name, c.ok, c.refusal])).toEqual([['propose_new_option', false, 'widen_gate']]);
    expect(addsOption(), 'route-v2 never reached').toEqual([]);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(approveChipOf(t1)).toBeUndefined();
    expect(t1.assistant_text).toContain('‘Price’ → ‘Customer churn’');
    expect(optionLabels()).toEqual(['Keep £49', 'Raise to £59']);
  }, 120_000);

  it('LM-3b ONE alternative per press: two DISTINCT options (each one passing alone, on different factors) are refused', async () => {
    graphOf.set(SCENARIO, seedGraph(assumedEdge(), true));
    script = [() => fnCall('propose_new_option', { rationale: 'r', options: [retention,
      { label: 'Referral programme', acts_on: [{ factor_label: 'Referral rate', direction: 'positive', level: { value: 80, unit: 'GBP', estimate: true, basis: 'b' } }] }] })];
    const t1 = await pressFor(ASSUMED.from, ASSUMED.to);
    expect(t1._agent.tool_calls.map((c) => c.refusal)).toEqual(['widen_gate']);
    expect(await heldOnLatestRow()).toEqual([]);
  }, 120_000);

  it('LM-U a press on a link that is NOT an open assumption (the user sized it, or no such link) runs no model call and holds nothing', async () => {
    graphOf.set(SCENARIO, seedGraph({ ...assumedEdge(), provenance: { source: 'user_specified' } }));
    const t1 = await pressFor(ASSUMED.from, ASSUMED.to);
    expect(openAiCalls).toBe(0);
    expect(await heldOnLatestRow()).toEqual([]);
    expect(t1.assistant_text).toContain('isn’t an open assumption');
    graphOf.set(SCENARIO, seedGraph());
    const t2 = await pressFor('fac_churn', 'fac_price');
    expect(openAiCalls).toBe(0);
    expect(approveChipOf(t2)).toBeUndefined();
  }, 120_000);

  it('LM-4..6 ADOPT → the option joins the Analysis Projection → the rerun shows its consequence → a cold reload keeps question, objective, assumption and provenance', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const assumedBefore = structuredClone(edgeOf(graphNow(), ASSUMED.from, ASSUMED.to));
    plotBodies.length = 0;
    const first = await runAnalysis('turn-run-1');
    expect((plotBodies[0]!.options as Rec[]).map((o) => o.option_id)).toEqual(['opt_a', 'opt_b']);
    expect((await coldRead()).analysis_state?.run_state.kind).toBe('complete_current');

    script = [() => fnCall('propose_new_option', { ...retention, rationale: 'Lowers churn directly.' })];
    const questionTurnId = randomUUID();
    const t1 = await pressFor(ASSUMED.from, ASSUMED.to, questionTurnId);
    const approve = approveChipOf(t1)!;
    const answerRow = latestRow()!;
    expect(answerRow.turn_id).toBe(questionTurnId);
    const held = (await heldOnLatestRow())[0]!;
    expect(held.chip_id).toBe(approve.id.slice('agent-approve-proposal:'.length));
    const heldNode = held.action.inline_patch!.operations!.find((o) => o.op === 'add_node' && o.value?.kind === 'option')!;
    expect(heldNode, 'the approval names this exact held option').toBeDefined();
    expect(graphNow().nodes.some((x) => x.id === heldNode.path)).toBe(false);
    const adoptionTurnId = randomUUID();
    const t2 = await turn({ turn_id: adoptionTurnId, message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(t2._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    // 3: adopted — and the adopted level is OLUMI'S ESTIMATE, never the user's figure.
    expect(latestRow()!.turn_id).toBe(adoptionTurnId);
    const added = graphNow().nodes.find((x) => x.id === heldNode.path)!;
    expect(added).toMatchObject({ id: heldNode.path, kind: 'option', label: 'Retention offer' });
    expect(Object.keys(added.interventions)).toEqual(['fac_churn']);
    expect(added.interventions.fac_churn).toMatchObject({ value: 0.1, raw_value: 20, source: 'cee_hypothesis' });
    expect(graphNow().edges.some((x) => x.from === 'dec_x' && x.to === added.id)).toBe(true);
    // The old Run no longer describes this model.
    expect((await coldRead()).analysis_state?.run_state.kind).toBe('complete_stale');

    // 4 + 5: the rerun's Analysis Projection carries the adopted option, and its result is in the cold read.
    const second = await runAnalysis('turn-run-2');
    expect((plotBodies.at(-1)!.options as Rec[]).map((o) => o.option_id)).toEqual(['opt_a', 'opt_b', added.id]);
    // The Run's existing request projection converts the stored 0.1 on cap 200 to its native wire scale, 20.
    expect((plotBodies.at(-1)!.options as Rec[]).find((o) => o.option_id === heldNode.path)!.interventions)
      .toEqual({ fac_churn: 20 });
    expect(second.result.graph_hash_at_run).not.toBe(first.result.graph_hash_at_run);

    // 6: a COLD reload — the stored graph and the analysis read, nothing carried in memory.
    const reloaded = structuredClone(graphOf.get(SCENARIO)) as { nodes: Rec[]; edges: Rec[]; goal_node_id?: string };
    const read = await coldRead();
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
    expect((read.analysis_result as Rec).computed_against_hash).toBe(second.result.graph_hash_at_run);
    expect(((read.analysis_result as Rec).enrichment.results as Rec[]).map((r) => r.option_id)).toContain(added.id);
    expect(reloaded.nodes.find((x) => x.kind === 'decision')!.label, 'the question').toBe('Choose a price');
    expect(reloaded.nodes.find((x) => x.kind === 'goal')!.label, 'the objective').toBe('Revenue');
    expect(edgeOf(reloaded, ASSUMED.from, ASSUMED.to), 'the assumption, byte for byte: still Olumi’s, still open').toEqual(assumedBefore);
    const { linkSizing } = await import('../../../cee/magnitude/link-sizing.js');
    expect(linkSizing(edgeOf(reloaded, ASSUMED.from, ASSUMED.to))).toBe('olumi_estimate');
    expect(reloaded.nodes.find((x) => x.id === added.id)!.interventions.fac_churn.source, 'provenance: Olumi’s estimate').toBe('cee_hypothesis');
    // The conversation's own record of WHICH assumption the option answers survives on the stored answer row.
    const recordedAnswer = await store.readCommittedTurn(SCENARIO, questionTurnId);
    expect(recordedAnswer).toMatchObject({ id: answerRow.id, turn_id: answerRow.turn_id, scenario_id: SCENARIO });
    expect(recordedAnswer!.assistant_message).toContain('‘Price’ → ‘Customer churn’');
    expect(recordedAnswer!.assistant_message).toContain('Retention offer');
    const answerHold = (recordedAnswer!.pending_actions as typeof held[]).find((p) => p.chip_id === held.chip_id)!;
    expect(answerHold.action.inline_patch!.operations!.find((o) => o.op === 'add_node' && o.path === added.id))
      .toEqual(heldNode);
  }, 180_000);

  it('LM-R REJECT (control): the user keeps their options → nothing is written, and the next Run compares only their options', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = await hashes();
    script = [() => fnCall('propose_new_option', { ...retention, rationale: 'r' })];
    const t1 = await pressFor(ASSUMED.from, ASSUMED.to);
    const approve = approveChipOf(t1)!;
    const ref = approve.id.slice('agent-approve-proposal:'.length);
    const keep = t1.suggested_actions.find((c) => c.id === `agent-question-keep:${ref}`)!;
    expect(keep, JSON.stringify(t1.suggested_actions)).toBeDefined();
    const rejected = await turn({ message: keep.message, source: 'chip', chip: { id: keep.id } });
    expect(rejected._agent.tool_calls).toEqual([expect.objectContaining({ name: 'withdraw_proposal', ok: true, mutated: false, proposal_id: ref })]);
    expect(openAiCalls, 'Keep withdraws the exact hold without interpretation').toBe(1);
    expect(await heldOnLatestRow(), 'the hold is retired on the answer row').toEqual([]);
    script = [() => fnCall('authorise_change', { proposal_id: ref }), () => say('Nothing changed.')];
    const afterRejection = await turn({ message: 'Do not add anything.' });
    expect(afterRejection._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: false,
      mutated: false, refusal: 'approval_required', proposal_id: ref }));
    await app.close();
    app = await buildApp();
    const oldCard = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(oldCard._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: false,
      mutated: false, refusal: 'unknown_proposal', proposal_id: ref })]);
    expect(await hashes()).toBe(before);
    expect(optionLabels()).toEqual(['Keep £49', 'Raise to £59']);
    plotBodies.length = 0;
    await runAnalysis('turn-run-reject');
    expect((plotBodies[0]!.options as Rec[]).map((o) => o.option_id)).toEqual(['opt_a', 'opt_b']);
  }, 120_000);

  it('LM-Keep identity: declining one hold retires only that hold, including an old Keep press after reload', async () => {
    graphOf.set(SCENARIO, seedGraph());
    script = [() => fnCall('propose_new_option', { ...retention, rationale: 'r' })];
    const first = await pressFor(ASSUMED.from, ASSUMED.to);
    const firstApprove = approveChipOf(first)!;
    const firstRef = firstApprove.id.slice('agent-approve-proposal:'.length);
    const keep = first.suggested_actions.find((c) => c.id === `agent-question-keep:${firstRef}`)!;
    script = [() => fnCall('propose_new_option', { ...retention, label: 'Retention support', rationale: 'r' })];
    const second = await pressFor(ASSUMED.from, ASSUMED.to);
    const secondApprove = approveChipOf(second)!;
    const secondRef = secondApprove.id.slice('agent-approve-proposal:'.length);
    expect(secondRef).not.toBe(firstRef);
    expect((await heldOnLatestRow()).map((p) => p.chip_id).sort()).toEqual([firstRef, secondRef].sort());
    await turn({ message: keep.message, source: 'chip', chip: { id: keep.id } });
    expect((await heldOnLatestRow()).map((p) => p.chip_id)).toEqual([secondRef]);
    await app.close();
    app = await buildApp();
    await turn({ message: keep.message, source: 'chip', chip: { id: keep.id } });
    expect((await heldOnLatestRow()).map((p) => p.chip_id)).toEqual([secondRef]);
    expect(optionLabels()).toEqual(['Keep £49', 'Raise to £59']);
    const applied = await turn({ message: secondApprove.message, source: 'chip', chip: { id: secondApprove.id } });
    expect(applied._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true,
      proposal_id: secondRef })]);
    expect(graphNow().nodes.some((x) => x.label === 'Retention support')).toBe(true);
    expect(graphNow().nodes.some((x) => x.label === 'Retention offer')).toBe(false);
  }, 120_000);

  it.each([false, true])('LM-consent: a model calling authorise_change on negative user text is refused, including reload (%s) and retry', async (reload) => {
    graphOf.set(SCENARIO, seedGraph());
    const before = structuredClone(graphNow());
    script = [() => fnCall('propose_new_option', { ...retention, rationale: 'r' })];
    const offered = await pressFor(ASSUMED.from, ASSUMED.to);
    const approve = approveChipOf(offered)!;
    const ref = approve.id.slice('agent-approve-proposal:'.length);
    if (reload) { await app.close(); app = await buildApp(); }
    const turnId = randomUUID();
    script = [() => fnCall('authorise_change', { proposal_id: ref }), () => say('Nothing changed.')];
    const refused = await turn({ turn_id: turnId, message: 'Do not add anything.' });
    expect(refused._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: false,
      mutated: false, refusal: 'approval_required', proposal_id: ref }));
    const callsBeforeRetry = openAiCalls;
    await turn({ turn_id: turnId, message: 'Do not add anything.', source: 'retry' });
    expect(openAiCalls, 'retry replays without confirming').toBe(callsBeforeRetry);
    expect(addsOption()).toHaveLength(1);
    expect(inner.filter((b) => (b.chip as { id?: string } | undefined)?.id === ref), 'no held confirm dispatched').toEqual([]);
    expect(graphNow()).toEqual(before);
    // Positive control: the same live hold can still be approved by the exact typed card.
    const applied = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(applied._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true,
      mutated: true, proposal_id: ref })]);
  }, 120_000);

  it('LM-card binding: a correct held ID with different approval words cannot confirm its stored operation', async () => {
    graphOf.set(SCENARIO, seedGraph());
    const before = structuredClone(graphNow());
    script = [() => fnCall('propose_new_option', { ...retention, rationale: 'r' })];
    const t1 = await pressFor(ASSUMED.from, ASSUMED.to);
    const approve = approveChipOf(t1)!;
    const refused = await turn({ message: 'Do not add anything.', source: 'chip', chip: { id: approve.id } });
    expect(refused._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: false,
      mutated: false, refusal: 'approval_required' })]);
    expect(inner.filter((b) => (b.chip as { id?: string } | undefined)?.id === approve.id.slice('agent-approve-proposal:'.length)))
      .toEqual([]);
    expect(graphNow()).toEqual(before);
    const applied = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(applied._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
  }, 120_000);
});
