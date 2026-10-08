/** Chat precondition lease: RED-first P44 real Agent → product hold → Apply → saved graph.
 * Harness follows agent-event-risk-door-seam.test.ts, including JSONB order and production pending parsing.
 * Unexecuted when BRIEF load check is blocked; no claim of a witnessed RED or GREEN.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `7b1e2d3c-4b5a-4f6e-9d7c-8b9a0e1f3d${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
const briefOf = new Map<string, string | null>();
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
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: briefOf.get(sid) ?? null })),
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
type G = { nodes: { id: string; kind: string; label: string; [k: string]: unknown }[]; edges: { from: string; to: string; [k: string]: unknown }[]; goal_constraints?: Record<string, unknown>[]; ref_high_water?: Record<string, number> };

const P44 = JSON.parse(readFileSync(new URL('./fixtures/chat-precondition/p44-r5-graph-after.json', import.meta.url), 'utf8')) as { graph: G; brief_text: string };
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/chat-precondition/p44-r5-add-risk.turns.json', import.meta.url), 'utf8')) as Body[];
const RISK_ID = 'risk_feature_release_slips';
const RISK_LABEL = 'Feature release slips';
const OPTION_ID = 'raise_pro_price_to_59';
const OPTION_LABEL = 'Raise Pro price to £59';
const P44_MESSAGE = 'Add a risk: Feature release slips — if the next Pro feature release slips, MRR will be lower.';
const DISCLOSURE = `‘${RISK_LABEL}’: ‘${OPTION_LABEL}’ relies on this not happening. This model can't yet apply that risk to that option alone, so the Run leaves it out, and that option's chance doesn't include it yet.`;
const plainGraph = (): G => {
  const g = structuredClone(P44.graph);
  g.nodes = g.nodes.filter((n) => n.id !== RISK_ID);
  g.edges = g.edges.filter((e) => e.from !== RISK_ID && e.to !== RISK_ID);
  return g;
};
const seed = (graph = plainGraph(), brief: string | null = P44.brief_text) => {
  graphOf.set(SCENARIO, jsonbOrder(graph));
  briefOf.set(SCENARIO, brief);
};

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const toolOutputIn = (body: Record<string, unknown>): Record<string, unknown> => {
  const out = (body.input as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output').at(-1);
  return JSON.parse(String(out?.output ?? '{}')) as Record<string, unknown>;
};

describe('chat precondition — real /agent/v1/turn door', () => {
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
      const id = (req.params as { id: string }).id;
      const g = graphOf.get(id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never), brief_text: briefOf.get(id) ?? null };
    });
    await app.register(ceeOrchestratorRouteV2);
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; routerCalls.length = 0; });

  const turn = async (payload: Record<string, unknown>): Promise<Body & { _proposal_fields?: { proposals: { approve_action: Chip; missing: unknown[] }[] } }> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json();
  };
  const graphNow = () => graphOf.get(SCENARIO) as G;
  const bytes = () => JSON.stringify(graphNow());
  const riskNow = (label = RISK_LABEL) => graphNow().nodes.find((n) => n.kind === 'risk' && n.label === label)!;
  const approveChipOf = (b: Body) => b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:gmh_'));
  const heldOnLatestRow = async () => {
    const pending = (await store.readMostRecentPendingActions(SCENARIO)) as { chip_id: string; action: { kind: string; inline_patch?: { handler_id?: string; operations?: { op: string; path: string; value?: Record<string, unknown> }[] } } }[];
    return pending.filter((p) => p.action.kind === 'apply_proposed_change' && p.action.inline_patch?.handler_id === 'graph_management_held_v1');
  };
  const offer = async (args: Record<string, unknown>, message = P44_MESSAGE) => {
    let result: Record<string, unknown> = {};
    script = [() => fnCall('propose_new_risk', { rationale: 'The user asked for it.', ...args }),
      (body) => { result = toolOutputIn(body); return say('Shall I add the risk?'); }];
    const response = await turn({ message });
    expect(response._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_new_risk', ok: true }));
    const approve = approveChipOf(response)!;
    expect(approve).toBeDefined();
    return { response, result, approve };
  };
  const approveOffer = async (approve: Chip) => {
    const response = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(response._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    return response;
  };
  const ordinaryArgs = (label = RISK_LABEL) => ({ label, affects: [{ target_label: 'MRR', direction: 'negative' }], caused_by: [] });
  const preconditionArgs = () => ({ label: RISK_LABEL, relies_on_option: OPTION_LABEL, affects: [], caused_by: [] });

  /** Production snapshot loader → production final payload assembly, stopped at its existing read-only probe. */
  const runInputsOf = async (graph: G): Promise<Record<string, unknown>> => {
    const { loadScenarioSnapshotForRunAnalysis } = await import('../../build-turn-context.js');
    const { createRunAnalysisHandler } = await import('../../tools/handlers/run-analysis.js');
    const { makeMessagePayload } = await import('../../__tests__/fixtures.js');
    const snapshotStore = {
      readMostRecentPendingActions: async () => [],
      loadGraphAndBriefText: async () => ({ graph: structuredClone(graph), briefText: P44.brief_text }),
      loadGraph: async () => structuredClone(graph),
    };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'chat-precondition-run-inputs', snapshotStore as never);
    let captured: Record<string, unknown> | undefined;
    const run = vi.fn(async () => { throw new Error('input witness must stop at the read-only probe'); });
    const handler = createRunAnalysisHandler({
      plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as never,
      scenarioReader: async () => snapshot,
      probe: async ({ plotPayload }) => { captured = plotPayload; },
    });
    const before = JSON.stringify(graph);
    await handler({
      context: {
        stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
        session_id: SCENARIO, request_id: 'chat-precondition-run-inputs', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
        prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
      },
      payload: makeMessagePayload({ turn_id: 'chat-precondition-run', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
      requestId: 'chat-precondition-run-inputs', signal: new AbortController().signal, orientationText: '',
    } as never);
    expect(captured, 'production final Run payload reached the probe').toBeDefined();
    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify(graph)).toBe(before);
    return captured!;
  };

  it('chat-precondition-p44-r5: exact served turn offers Science card; Apply stamps zero-edge precondition; readiness and final Run inputs unchanged', async () => {
    seed();
    const before = structuredClone(graphNow());
    const { assessCanonicalAnalysisReadiness } = await import('../../../orchestrator/tools/analysis-ready-helper.js');
    const readinessBefore = assessCanonicalAnalysisReadiness(before);
    const { response, approve } = await offer(preconditionArgs());
    expect(approve.detail).toBe(DISCLOSURE);
    expect(response.assistant_text, 'the disclosure is never left to narration').toContain(DISCLOSURE);
    expect(openAiCalls, 'only the scripted proposal call, no narration call').toBe(1);
    const card = response._proposal_fields!.proposals.find((p) => p.approve_action.id === approve.id)!;
    expect(card.approve_action.detail).toBe(approve.detail);
    expect(card.missing).toEqual([]);
    const held = await heldOnLatestRow();
    expect(held).toHaveLength(1);
    expect(held[0]!.action.inline_patch!.operations).toEqual([{ op: 'add_node', path: RISK_ID,
      value: { id: RISK_ID, kind: 'risk', label: RISK_LABEL, relies_on: { option_id: OPTION_ID } } }]);
    expect(bytes()).toBe(JSON.stringify(before));
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    await approveOffer(approve);
    expect((graphWrites.get(SCENARIO) ?? 0) - writesBefore).toBe(1);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(graphNow().edges.filter((e) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
    const readinessAfter = assessCanonicalAnalysisReadiness(graphNow());
    expect(readinessAfter.safeToAnalyse).toBe(readinessBefore.safeToAnalyse);
    expect(readinessAfter.blockingIssues).toEqual(readinessBefore.blockingIssues);
    const control = await runInputsOf(before);
    const stamped = await runInputsOf(graphNow());
    expect(JSON.stringify(stamped)).toBe(JSON.stringify(control));
    expect(JSON.stringify(stamped)).not.toContain(RISK_ID);
    expect(routerCalls).toEqual([]);
  }, 120_000);

  it('chat-precondition-p44-r5-today: without the lease, served risk→mrr card and ordinary graph bytes stay unchanged', async () => {
    seed();
    const { approve } = await offer(ordinaryArgs());
    const servedChip = SERVED[0]!.suggested_actions.find((c) => c.detail?.includes("Add risk 'Feature release slips'"))!;
    expect(approve.detail).toBe(servedChip.detail);
    await approveOffer(approve);
    const expected = structuredClone(P44.graph);
    // BRIEF says remove only the risk and its edge. Keep its allocator high-water;
    // the next ordinary Add therefore receives R3, without recycling removed R2.
    const nextRiskRef = (plainGraph().ref_high_water?.R ?? 0) + 1;
    expected.nodes.find((n) => n.id === RISK_ID)!.ref = `R${nextRiskRef}`;
    expected.ref_high_water!.R = nextRiskRef;
    expect(bytes()).toBe(JSON.stringify(jsonbOrder(expected)));
    expect(riskNow().relies_on).toBeUndefined();
  }, 120_000);

  it('chat-precondition-drives: ordinary risk retains factor→risk and risk→mrr hypothesis bytes without a precondition stamp', async () => {
    seed();
    const { approve } = await offer({ ...ordinaryArgs(), caused_by: [{ factor_label: 'Pro plan price', direction: 'positive' }] },
      'Add a risk: Feature release slips because Pro plan price rises — the slip lowers MRR.');
    expect(approve.detail ?? '').not.toContain('relies on this not happening');
    await approveOffer(approve);
    expect(riskNow().relies_on).toBeUndefined();
    expect(riskNow().event_risk).toBeUndefined();
    const { hypothesisEdgeValue } = await import('../../routing/add-option-transaction.js');
    const driver = hypothesisEdgeValue('pro_plan_price', RISK_ID, 'positive');
    const affects = hypothesisEdgeValue(RISK_ID, 'mrr', 'negative');
    expect(graphNow().edges.find((e) => e.from === 'pro_plan_price' && e.to === RISK_ID)).toEqual(driver);
    expect(graphNow().edges.find((e) => e.from === RISK_ID && e.to === 'mrr')).toEqual(affects);
    const expected = structuredClone(P44.graph);
    const nextRiskRef = (plainGraph().ref_high_water?.R ?? 0) + 1;
    expected.nodes.find((n) => n.id === RISK_ID)!.ref = `R${nextRiskRef}`;
    expected.ref_high_water!.R = nextRiskRef;
    expected.edges.push(driver as G['edges'][number]);
    expect(bytes()).toBe(JSON.stringify(jsonbOrder(expected)));
  }, 120_000);

  it('chat-precondition-unrelated: unrelated words fail sanity gate and preserve byte-identical ordinary affects', async () => {
    seed();
    const { approve } = await offer({ ...ordinaryArgs('Office flood'), relies_on_option: OPTION_LABEL }, 'Add a risk: Office flood lowers MRR.');
    expect(approve.detail ?? '').not.toContain('relies on this not happening');
    await approveOffer(approve);
    const invalidLeaseBytes = bytes();
    expect(riskNow('Office flood').relies_on).toBeUndefined();
    expect(graphNow().edges.some((e) => e.from === riskNow('Office flood').id && e.to === 'mrr')).toBe(true);
    nextScenario(); seed();
    await approveOffer((await offer(ordinaryArgs('Office flood'), 'Add a risk: Office flood lowers MRR.')).approve);
    expect(bytes()).toBe(invalidLeaseBytes);
  }, 120_000);

  it.each(['Pro plan price', 'Keep current Pro price', 'absent option', OPTION_ID])('chat-precondition-forged-%s: non-option, status quo, unknown option and id spelling fall back to today byte for byte', async (relies_on_option) => {
    seed();
    const { approve } = await offer({ ...ordinaryArgs(), relies_on_option });
    expect(approve.detail ?? '').not.toContain('relies on this not happening');
    await approveOffer(approve);
    const ignoredLeaseBytes = bytes();
    expect(riskNow().relies_on).toBeUndefined();
    nextScenario(); seed();
    await approveOffer((await offer(ordinaryArgs())).approve);
    expect(bytes()).toBe(ignoredLeaseBytes);
  }, 120_000);

  it('chat-precondition-ambiguous-option: duplicate option labels ignore the lease and retain ordinary graph bytes', async () => {
    const ambiguous = plainGraph();
    ambiguous.nodes.find((n) => n.id === 'raise_pro_price_to_54')!.label = OPTION_LABEL;
    seed(ambiguous);
    const { approve } = await offer({ ...ordinaryArgs(), relies_on_option: OPTION_LABEL });
    await approveOffer(approve);
    const ignoredLeaseBytes = bytes();
    expect(riskNow().relies_on).toBeUndefined();
    nextScenario(); seed(ambiguous);
    await approveOffer((await offer(ordinaryArgs())).approve);
    expect(bytes()).toBe(ignoredLeaseBytes);
  }, 120_000);

  it.each(['top-true-data-false', 'top-false-data-true'] as const)('chat-precondition-split-baseline-%s: either true baseline flag denies the lease even when multiple baselines make status-quo identity null', async (shape) => {
    const split = plainGraph();
    const option = split.nodes.find((n) => n.id === OPTION_ID)!;
    option.is_baseline = shape === 'top-true-data-false';
    option.data = { is_baseline: shape === 'top-false-data-true' };
    const { statusQuoOptionId } = await import('../structural-facts.js');
    expect(statusQuoOptionId(split.nodes, split.edges), 'existing Keep plus split true means multiple effective baselines').toBeNull();
    seed(split);
    const { approve } = await offer({ ...ordinaryArgs(), relies_on_option: OPTION_LABEL });
    expect(approve.detail ?? '').not.toContain('relies on this not happening');
    await approveOffer(approve);
    const ignoredLeaseBytes = bytes();
    expect(riskNow().relies_on).toBeUndefined();
    nextScenario(); seed(split);
    await approveOffer((await offer(ordinaryArgs())).approve);
    expect(bytes()).toBe(ignoredLeaseBytes);
  }, 120_000);

  it('chat-precondition-conflicting-links: valid precondition wins over both affects and caused_by; links dropped and reason said', async () => {
    seed();
    const { result, approve, response } = await offer({ ...preconditionArgs(), affects: [{ target_label: 'MRR', direction: 'negative' }],
      caused_by: [{ factor_label: 'Pro plan price', direction: 'positive' }] });
    expect(approve.detail).toContain(DISCLOSURE);
    expect(`${String(result.note ?? '')} ${response.assistant_text}`).toMatch(/(?:without|no) links.*precondition|precondition.*(?:without|no) links/i);
    await approveOffer(approve);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(graphNow().edges.filter((e) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it.each([
    ["I'd put it at 10–30% within 6 months."],
    ['If it slips, MRR will be lower by 10% within 6 months.'],
  ])('chat-precondition-likelihood: a precondition stores no occurrence and claims none (%s)', async (extra) => {
    seed();
    const { response, approve } = await offer(preconditionArgs(), `${P44_MESSAGE} ${extra}`);
    expect(approve.detail).toBe(DISCLOSURE);
    expect(`${approve.detail}\n${response.assistant_text}`).not.toMatch(/may happen|likelihood|10%|10–30%/);
    await approveOffer(approve);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(riskNow().event_risk).toBeUndefined();
    expect(graphNow().edges.filter((e) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it.each(['Office flood while away', 'Shoulder injury'])('chat-precondition-filler-words: %s cannot pass the sanity gate through a function word', async (riskLabel) => {
    seed();
    const { approve } = await offer({ ...ordinaryArgs(riskLabel), relies_on_option: OPTION_LABEL }, `Add a risk: ${riskLabel} lowers MRR.`);
    expect(approve.detail).not.toContain('relies on this not happening');
    await approveOffer(approve);
    expect(riskNow(riskLabel).relies_on).toBeUndefined();
    expect(graphNow().edges.some((e) => e.from === riskNow(riskLabel).id && e.to === 'mrr')).toBe(true);
  }, 120_000);

  it('chat-precondition-invalid-conflicting-links: accepted option lease drops unresolvable model links before ordinary link validation', async () => {
    seed();
    const { approve } = await offer({ ...preconditionArgs(), affects: [{ target_label: 'nonexistent outcome', direction: 'negative' }],
      caused_by: [{ factor_label: 'nonexistent factor', direction: 'positive' }] });
    expect(approve.detail).toContain(DISCLOSURE);
    await approveOffer(approve);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(graphNow().edges.filter((e) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it('chat-precondition-deterministic-mixed-links: whole request says in the assistant reply why both model links are dropped, without narration', async () => {
    seed();
    const { response, approve } = await offer({ ...preconditionArgs(), whole_request: true,
      affects: [{ target_label: 'MRR', direction: 'negative' }], caused_by: [{ factor_label: 'Pro plan price', direction: 'positive' }] });
    expect(openAiCalls, 'only the scripted proposal call, no narration call').toBe(1);
    expect(response.assistant_text).toContain(DISCLOSURE);
    expect(response.assistant_text).toContain(`It is kept without links because it is a precondition of ‘${OPTION_LABEL}’.`);
    await approveOffer(approve);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(graphNow().edges.filter((e) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it('chat-precondition-deterministic-price: the user’s £59 is carried by the option label in one proposal call', async () => {
    seed();
    const message = 'Add a risk: Feature release slips. The rise to £59 relies on the next Pro feature release.';
    const { response, approve } = await offer({ ...preconditionArgs(), whole_request: true }, message);
    expect(openAiCalls, '£59 in the option label is covered without narration').toBe(1);
    expect(response.assistant_text).toContain(DISCLOSURE);
    await approveOffer(approve);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(graphNow().edges.filter((e) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it('chat-precondition-pricing-stem: “Pricing rollout delayed” is corroborated by “price” (four-letter stem)', async () => {
    seed();
    const label = 'Pricing rollout delayed';
    const { approve } = await offer({ label, relies_on_option: OPTION_LABEL, affects: [], caused_by: [], whole_request: true },
      'Add a risk: Pricing rollout delayed — the £59 price rise cannot go live until billing supports the new pricing.');
    expect(approve.detail).toBe(`‘${label}’: ‘${OPTION_LABEL}’ relies on this not happening. This model can't yet apply that risk to that option alone, so the Run leaves it out, and that option's chance doesn't include it yet.`);
    await approveOffer(approve);
    expect(riskNow(label).relies_on).toEqual({ option_id: OPTION_ID });
  }, 120_000);

  it('chat-precondition-not-whole-request: an explicit whole_request:false leaves the other request to narration', async () => {
    seed();
    await offer({ ...preconditionArgs(), whole_request: false }, `${P44_MESSAGE} Also explain why Keep current Pro price is the baseline.`);
    expect(openAiCalls, 'narration answers the rest of the request').toBe(2);
  }, 120_000);

  it('chat-precondition-dropped-link-figures: figures only in discarded links are not counted as carried', async () => {
    seed();
    await offer({ ...preconditionArgs(), affects: [{ target_label: 'MRR lower by 10% within 6 months', direction: 'negative' }] },
      'Add a risk: Feature release slips — if it slips, MRR will be lower by 10% within 6 months.');
    expect(openAiCalls, 'the uncarried 10% / 6 months go to narration, not a reply that drops them').toBe(2);
  }, 120_000);

  it('chat-precondition-raw-stamp-arg: a model-authored relies_on on the exposed tool is ignored', async () => {
    seed();
    const { approve } = await offer({ ...ordinaryArgs(), relies_on: { option_id: OPTION_ID } });
    expect(approve.detail).not.toContain('relies on this not happening');
    await approveOffer(approve);
    expect(riskNow().relies_on).toBeUndefined();
    expect(graphNow().edges.some((e) => e.from === RISK_ID && e.to === 'mrr')).toBe(true);
  }, 120_000);

  it('chat-precondition-empty-lease: an empty lease with no affects keeps today\'s no_affects refusal before any read', async () => {
    seed();
    script = [() => fnCall('propose_new_risk', { rationale: 'x', label: RISK_LABEL, relies_on_option: '  ', affects: [], caused_by: [] }), () => say('Nothing changed.')];
    const response = await turn({ message: P44_MESSAGE });
    expect(response._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_new_risk', ok: false, refusal: 'no_affects' }));
  }, 120_000);

  it('chat-precondition-model-cannot-author: invented generic writer denied; existing field-safety still rejects model-authored node stamp', async () => {
    seed();
    const before = bytes();
    const operations = [{ op: 'add_node', path: RISK_ID, value: { id: RISK_ID, kind: 'risk', label: RISK_LABEL, relies_on: { option_id: OPTION_ID } } }];
    script = [() => fnCall('edit_graph', { operations }), () => say('Nothing changed.')];
    const response = await turn({ message: P44_MESSAGE });
    expect(response._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'edit_graph', ok: false, refusal: 'unknown_tool' }));
    expect(approveChipOf(response)).toBeUndefined();
    expect(bytes()).toBe(before);
    const { evaluateEditGraphMutations } = await import('../../handlers/edit-graph-referee-gate.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const hash = computeAnalysisAffectingGraphHash(graphNow() as never);
    const generic = evaluateEditGraphMutations({ scenarioId: SCENARIO, turnId: randomUUID(), requestId: 'chat-forged-stamp', mode: 'live',
      operations: operations as never, currentGraph: graphNow(), currentGraphHash: hash, baseGraphHash: hash, freshness: 'fresh' });
    expect(generic.governing).toBe('rejected');
    expect(bytes()).toBe(before);
  }, 120_000);
});
