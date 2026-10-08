/** Chat precondition lease: RED-first P44 real Agent → product hold → Apply → saved graph.
 * Harness follows agent-event-risk-door-seam.test.ts, including JSONB order and production pending parsing.
 * Unexecuted when BRIEF load check is blocked; no claim of a witnessed RED or GREEN.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

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
let pendingReadHook: ((options: { onLatestRowId?: unknown } | undefined) => void) | undefined;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    if (row === undefined) return null;
    const { turn_id: _turnId, ...committed } = row;
    return { ...committed, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string, options?: { onLatestRowId?: unknown }) => {
    pendingReadHook?.(options);
    return parsedPending(latestRow(sid), sid);
  }),
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
type ReconstructedRiskReplayRow = {
  id: string; graph: G; brief_text: string | null; request: Record<string, unknown> & { message: string; scenario_id: string };
  observed_card: { detail?: string; chip_detail?: string } | null; args: Record<string, unknown> | null;
  args_provenance: string; expected_precondition_offer_count: number; do_not_replay?: boolean;
};

const P44 = JSON.parse(readFileSync(new URL('./fixtures/chat-precondition/p44-r5-graph-after.json', import.meta.url), 'utf8')) as { graph: G; brief_text: string };
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/chat-precondition/p44-r5-add-risk.turns.json', import.meta.url), 'utf8')) as Body[];
const SIX_SERVED_RECONSTRUCTED = JSON.parse(readFileSync(new URL('./fixtures/chat-precondition/p44-six-served-draws.json', import.meta.url), 'utf8')) as { rows: ReconstructedRiskReplayRow[] };
const STORED_RUNNERS_RECONSTRUCTED = JSON.parse(readFileSync(new URL('./fixtures/chat-precondition/stored-runner-add-risk-corpus.json', import.meta.url), 'utf8')) as { rows: ReconstructedRiskReplayRow[] };
const RISK_ID = 'risk_feature_release_slips';
const RISK_LABEL = 'Feature release slips';
const OPTION_ID = 'raise_pro_price_to_59';
const OPTION_LABEL = 'Raise Pro price to £59';
const P44_MESSAGE = 'Add a risk: Feature release slips — if the next Pro feature release slips, MRR will be lower.';
const PRECONDITION_OFFER_LINE = 'Your brief launches the change with the next Pro feature release, so ‘Feature release slips’ may be something one option relies on, rather than a threat to MRR for every option. Which is it?';
const FRAMING_OFFER_LINE = PRECONDITION_OFFER_LINE.replace('Your brief launches', 'The model’s framing times');
const preconditionPressMessage = (optionLabel: string, riskLabel = RISK_LABEL) =>
  `Add the risk ‘${riskLabel}’ to ‘${optionLabel}’: that option relies on this not happening. The Run leaves it out until it can apply to that option alone.`;
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
/** Off by default; a race row can advance the stored graph at a specific real canonical read. */
let graphReadHook: ((scenarioId: string) => void) | undefined;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const toolOutputIn = (body: Record<string, unknown>): Record<string, unknown> => {
  const out = (body.input as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output').at(-1);
  return JSON.parse(String(out?.output ?? '{}')) as Record<string, unknown>;
};

describe('chat precondition — real /agent/v1/turn door', () => {
  let app: FastifyInstance;
  const startApp = async () => {
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const id = (req.params as { id: string }).id;
      graphReadHook?.(id);
      const g = graphOf.get(id) ?? null;
      return { graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never), brief_text: briefOf.get(id) ?? null };
    });
    await app.register(ceeOrchestratorRouteV2);
    await app.register(agentV1TurnRoute);
    await app.ready();
  };
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
    await startApp();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; routerCalls.length = 0; graphReadHook = undefined; pendingReadHook = undefined; });

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
  const offer = async (args: Record<string, unknown>, message = P44_MESSAGE, payload: Record<string, unknown> = {}) => {
    let result: Record<string, unknown> = {};
    script = [() => fnCall('propose_new_risk', { rationale: 'The user asked for it.', ...args }),
      (body) => { result = toolOutputIn(body); return say('Shall I add the risk?'); }];
    const response = await turn({ ...payload, message });
    expect(response._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_new_risk', ok: true }));
    const approve = approveChipOf(response)!;
    return { response, result, approve };
  };
  const approveOffer = async (approve: Chip) => {
    const response = await turn({ message: approve.message, source: 'chip', chip: { id: approve.id } });
    expect(response._agent.tool_calls).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    return response;
  };
  const ordinaryArgs = (label = RISK_LABEL) => ({ label, affects: [{ target_label: 'MRR', direction: 'negative' }], caused_by: [] });
  const preconditionArgs = () => ({ label: RISK_LABEL, relies_on_option: OPTION_LABEL, affects: [], caused_by: [] });
  const preconditionPressesOf = (response: Body) => response.suggested_actions.filter((chip) => chip.id.startsWith('agent-widen-add:'));
  const pressForOption = (response: Body, optionLabel = OPTION_LABEL) => {
    const press = preconditionPressesOf(response).find((chip) => chip.message === preconditionPressMessage(optionLabel));
    expect(press, JSON.stringify(response.suggested_actions)).toBeDefined();
    return press!;
  };
  const pressPrecondition = async (press: Chip) => {
    const callsBefore = openAiCalls;
    const response = await turn({ message: press.message, source: 'chip', chip: { id: press.id } });
    expect(openAiCalls, 'the host-bound precondition press calls no model').toBe(callsBefore);
    return response;
  };

  const declineChoiceOf = (response: Body) => {
    const press = response.suggested_actions.find((c) => c.label === 'It lowers MRR for every option');
    expect(press, JSON.stringify(response.suggested_actions)).toBeDefined();
    return press!;
  };
  const hiddenCard = async () => {
    const { proposalRecord } = await import('../proposal-object/record.js');
    const holds = await heldOnLatestRow();
    expect(holds).toHaveLength(1);
    return proposalRecord(holds[0] as never, graphNow())!;
  };

  it('FIX1-a RED: trigger holds the ordinary proposal but shows only the exact question and three ordered choices', async () => {
    seed();
    const before = bytes();
    const { response } = await offer(ordinaryArgs());
    expect(approveChipOf(response), 'no ordinary approve chip before a choice').toBeUndefined();
    expect(response._proposal_fields, 'no ordinary proposal card before a choice').toBeUndefined();
    expect(response.assistant_text).toBe('Your brief launches the change with the next Pro feature release, so ‘Feature release slips’ may be something one option relies on, rather than a threat to MRR for every option. Which is it?');
    expect(response.suggested_actions.map((c) => c.message)).toEqual([
      preconditionPressMessage(OPTION_LABEL), preconditionPressMessage('Raise Pro price to £54'), 'It lowers MRR for every option',
    ]);
    const record = await hiddenCard();
    const decline = declineChoiceOf(response);
    expect(decline.id).toContain(record.proposal_id);
    expect(decline.id).toContain(record.digest);
    expect(record.approve_action.detail).toBe(SERVED[0]!.suggested_actions.find((c) => c.detail?.includes("Add risk 'Feature release slips'"))!.detail);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('FIX1-a-direct RED: a hidden ordinary card cannot be approved by a direct request before the choice', async () => {
    seed();
    await offer(ordinaryArgs());
    const record = await hiddenCard();
    const before = bytes();
    const callsBefore = openAiCalls;
    const refused = await turn({ message: record.approve_action.message, source: 'chip', chip: { id: record.approve_action.id } });
    expect(refused._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false }));
    expect(approveChipOf(refused)).toBeUndefined();
    expect(openAiCalls).toBe(callsBefore);
    expect(bytes()).toBe(before);
  }, 120_000);

  it('FIX1-b RED: decline re-offers the exact held card by identity with no LLM or new proposal, then approval commits risk → MRR', async () => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const record = await hiddenCard();
    const before = bytes();
    const callsBefore = openAiCalls;
    const reoffer = await pressPrecondition(declineChoiceOf(response));
    expect(openAiCalls).toBe(callsBefore);
    expect(reoffer._agent.tool_calls).toEqual([]);
    expect(approveChipOf(reoffer)).toEqual(record.approve_action);
    expect(reoffer.assistant_text).toContain(record.approve_action.detail!);
    const sameHold = await hiddenCard();
    expect(sameHold.proposal_id).toBe(record.proposal_id);
    expect(sameHold.revision).toBe(record.revision);
    expect(sameHold.digest).toBe(record.digest);
    expect(bytes()).toBe(before);
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    await approveOffer(approveChipOf(reoffer)!);
    expect((graphWrites.get(SCENARIO) ?? 0) - writesBefore).toBe(1);
    expect(riskNow().relies_on).toBeUndefined();
    expect(graphNow().edges).toContainEqual(expect.objectContaining({ from: RISK_ID, to: 'mrr' }));
  }, 120_000);

  it.each(['unknown-gmh', 'changed-digest'] as const)('FIX1-c-%s RED: forged or stale decline is terminal, re-offers no card and writes nothing', async (shape) => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const original = await hiddenCard();
    const press = { ...declineChoiceOf(response) };
    if (shape === 'unknown-gmh') press.id = press.id.replace(original.proposal_id, 'gmh_000000000000');
    else {
      const row = latestRow()!;
      const raw = row.pending_actions as { chip_id: string; action: { inline_patch?: { operations?: { op: string; value?: { strength?: { mean: number } } }[] } } }[];
      const edge = raw.find((p) => p.chip_id === original.proposal_id)!.action.inline_patch!.operations!.find((o) => o.op === 'add_edge')!;
      edge.value!.strength!.mean = 0.23;
      expect((await hiddenCard()).digest).not.toBe(original.digest);
    }
    const before = bytes();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const refused = await pressPrecondition(press);
    expect(refused._agent.tool_calls).toEqual([]);
    expect(refused.assistant_text).toContain('Nothing in the model changed.');
    expect(approveChipOf(refused)).toBeUndefined();
    expect(refused._proposal_fields).toBeUndefined();
    expect(bytes()).toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
  }, 120_000);

  it('FIX1-c-floor-race RED: decline cannot resurrect ordinary operations after a same-handle RC3 replacement arrives at the append floor', async () => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const ordinaryPending = structuredClone(latestRow()!.pending_actions);
    const ordinary = await hiddenCard();
    const rc3 = await pressPrecondition(pressForOption(response));
    const rc3Pending = structuredClone(latestRow()!.pending_actions);
    const rc3Record = await hiddenCard();
    expect(rc3Record.proposal_id).toBe(ordinary.proposal_id);
    expect(rc3Record.revision).not.toBe(ordinary.revision);
    // Decline resolves the original still-held choice, then a concurrent option press replaces it at the CAS read.
    latestRow()!.pending_actions = ordinaryPending;
    let raced = false;
    pendingReadHook = (options) => {
      if (raced || options?.onLatestRowId === undefined) return;
      raced = true;
      latestRow()!.pending_actions = rc3Pending;
    };
    const before = bytes();
    const refused = await pressPrecondition(declineChoiceOf(response));
    pendingReadHook = undefined;
    expect(raced).toBe(true);
    expect(refused.assistant_text).toContain('Nothing in the model changed.');
    expect(refused.suggested_actions.some(c => c.message === ordinary.approve_action.message)).toBe(false);
    expect((await hiddenCard()).digest).toBe(rc3Record.digest);
    expect(bytes()).toBe(before);
    await approveOffer(approveChipOf(rc3)!);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(graphNow().edges.filter(e => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it('FIX1-control-bytes: every non-trigger offer control and captured non-trigger draw retains reply/chip/card/operation/receipt/write bytes', async () => {
    const noTiming = plainGraph();
    for (const node of noTiming.nodes) if (node.kind === 'decision') { node.label = 'How can we grow MRR?'; delete node.description; }
    const allBaseline = plainGraph();
    for (const node of allBaseline.nodes) if (node.kind === 'option') node.is_baseline = true;
    const controls = [
      { id: 'competitor', graph: plainGraph(), brief: P44.brief_text, args: ordinaryArgs('Competitor cuts prices'), message: 'Add a risk: Competitor cuts prices — MRR will be lower.' },
      { id: 'competitor-no-timing', graph: noTiming, brief: 'Our goal is MRR growth while churn stays below 4%.', args: ordinaryArgs('Competitor cuts prices'), message: 'Add a risk: Competitor cuts prices — MRR will be lower.' },
      { id: 'no-timing', graph: noTiming, brief: 'Grow MRR through a Pro price change. The feature release is a separate project.', args: ordinaryArgs(), message: P44_MESSAGE },
      { id: 'outside-phrase', graph: noTiming, brief: 'Launch the Pro change with the next customer campaign. The feature release is a separate project.', args: ordinaryArgs(), message: P44_MESSAGE },
      { id: 'all-baseline', graph: allBaseline, brief: P44.brief_text, args: ordinaryArgs(), message: P44_MESSAGE },
      { id: 'valid-lease', graph: plainGraph(), brief: P44.brief_text, args: preconditionArgs(), message: P44_MESSAGE },
      { id: 'valid-lease-conflicting-links', graph: plainGraph(), brief: P44.brief_text, args: { ...preconditionArgs(), affects: [{ target_label: 'MRR', direction: 'negative' }], caused_by: [{ factor_label: 'Pro plan price', direction: 'positive' }] }, message: P44_MESSAGE },
      { id: 'valid-lease-occurrence', graph: plainGraph(), brief: P44.brief_text, args: preconditionArgs(), message: P44_MESSAGE + " I'd put it at 10–30% within 6 months." },
      { id: 'unrelated-invalid-lease', graph: plainGraph(), brief: P44.brief_text, args: { ...ordinaryArgs('Office flood'), relies_on_option: OPTION_LABEL }, message: 'Add a risk: Office flood lowers MRR.' },
      ...[...SIX_SERVED_RECONSTRUCTED.rows, ...STORED_RUNNERS_RECONSTRUCTED.rows]
        .filter(row => row.args !== null && row.do_not_replay !== true && row.expected_precondition_offer_count === 0)
        .map(row => ({ id: row.id, graph: row.graph, brief: row.brief_text, args: row.args!, message: row.request.message })),
    ];
    const captures = [];
    for (const [index, control] of controls.entries()) {
      SCENARIO = `7b1e2d3c-4b5a-4f6e-9d7c-8b9a0e1f3c${String(index).padStart(2, '0')}`;
      seed(structuredClone(control.graph), control.brief);
      const offered = await offer(control.args, control.message);
      expect(preconditionPressesOf(offered.response)).toEqual([]);
      expect(offered.response.suggested_actions.some(c => c.label === 'It lowers MRR for every option')).toBe(false);
      const card = await hiddenCard();
      const receipt = await approveOffer(offered.approve);
      // Random carrier revisions/digests, provider timings and issuance ids are not user-content bytes.
      captures.push({ id: control.id, reply: offered.response.assistant_text, chips: offered.response.suggested_actions,
        card: { approve: card.approve_action, decline: card.decline_action, operations: card.operations, fields: card.fields, missing: card.missing },
        receipt: receipt.assistant_text, receipt_chips: receipt.suggested_actions, graph: graphNow() });
    }
    const capture = process.env.OFFER_FIX1_CONTROL_CAPTURE;
    if (capture !== undefined) writeFileSync(capture, JSON.stringify(captures, null, 2) + '\n');
    expect(captures).toHaveLength(12);
  }, 120_000);

  it('FIX1-d RED: £59 choice supersedes the ordinary hold before RC3 approval; its old direct approval is refused', async () => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const ordinary = await hiddenCard();
    const rc3 = await pressPrecondition(pressForOption(response));
    const approve = approveChipOf(rc3)!;
    expect(approve?.detail).toBe(DISCLOSURE);
    expect(rc3.suggested_actions.some((c) => c.message === ordinary.approve_action.message)).toBe(false);
    const replacement = await hiddenCard();
    expect(replacement.digest).not.toBe(ordinary.digest);
    expect(replacement.operations.some((o) => o.op === 'add_edge')).toBe(false);
    const before = bytes();
    const refused = await turn({ message: ordinary.approve_action.message, source: 'chip', chip: { id: ordinary.approve_action.id } });
    expect(refused._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false }));
    expect(bytes()).toBe(before);
    await approveOffer(approve);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(graphNow().edges.filter((e) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
    const stamped = bytes();
    const writesAfterStamp = graphWrites.get(SCENARIO) ?? 0;
    const refusedAfterStamp = await turn({ message: ordinary.approve_action.message, source: 'chip', chip: { id: ordinary.approve_action.id } });
    expect(refusedAfterStamp._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: false, mutated: false }));
    expect(bytes()).toBe(stamped);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesAfterStamp);
  }, 120_000);

  it('FIX1-e RED: persisted trigger replay keeps all three choices with no ordinary approval card', async () => {
    seed();
    const turnId = randomUUID();
    const { response } = await offer(ordinaryArgs(), P44_MESSAGE, { turn_id: turnId });
    const callsBefore = openAiCalls;
    const replay = await turn({ turn_id: turnId, message: P44_MESSAGE });
    expect(openAiCalls).toBe(callsBefore);
    expect(replay.suggested_actions.map((c) => c.message)).toEqual([
      preconditionPressMessage(OPTION_LABEL), preconditionPressMessage('Raise Pro price to £54'), 'It lowers MRR for every option',
    ]);
    expect(replay.suggested_actions).toEqual(response.suggested_actions);
    expect(replay.assistant_text).toBe(response.assistant_text);
    expect(approveChipOf(replay)).toBeUndefined();
    expect(replay._proposal_fields).toBeUndefined();
    await app.close();
    await startApp();
    const cold = await turn({ turn_id: turnId, message: P44_MESSAGE });
    expect(openAiCalls).toBe(callsBefore);
    expect(cold.suggested_actions).toEqual(response.suggested_actions);
    expect(cold.assistant_text).toBe(response.assistant_text);
    expect(approveChipOf(cold)).toBeUndefined();
    expect(cold._proposal_fields).toBeUndefined();
  }, 120_000);

  // BRIEF-offer: RED rows precede the existing lease controls. Scripted provider, real product doors, no live LLM.
  it('chat-precondition-offer-p44 RED: exact unleased turn holds the unchanged ordinary card behind both option choices; £59 press reaches RC3 hold → approve → zero-edge stamp', async () => {
    seed();
    const before = bytes();
    const { response } = await offer(ordinaryArgs());
    const approve = (await hiddenCard()).approve_action;
    expect(approveChipOf(response)).toBeUndefined();
    const servedChip = SERVED[0]!.suggested_actions.find((chip) => chip.detail?.includes("Add risk 'Feature release slips'"))!;
    expect(approve.detail, 'the ordinary model card is unchanged').toBe(servedChip.detail);
    expect(response.assistant_text.split(PRECONDITION_OFFER_LINE)).toHaveLength(2);
    const presses = preconditionPressesOf(response);
    expect(presses.map((chip) => chip.message)).toEqual([
      preconditionPressMessage(OPTION_LABEL), preconditionPressMessage('Raise Pro price to £54'),
    ]);
    expect(presses.map((chip) => chip.id)).toEqual([
      expect.stringMatching(/^agent-widen-add:[0-9a-f]{16}$/), expect.stringMatching(/^agent-widen-add:[0-9a-f]{16}$/),
    ]);
    expect(presses.map((chip) => chip.label)).toEqual([`Add to ‘${OPTION_LABEL}’`, 'Add to ‘Raise Pro price to £54’']);
    expect(new Set(presses.map((chip) => chip.id)).size, 'option identity binds each press').toBe(2);
    expect(bytes(), 'offers neither choose an option nor write a risk').toBe(before);
    const rc3 = await pressPrecondition(pressForOption(response));
    expect(rc3._agent.tool_calls).toEqual([expect.objectContaining({ name: 'propose_new_risk', ok: true, mutated: false })]);
    const rc3Approve = approveChipOf(rc3)!;
    expect(rc3Approve?.detail).toBe(DISCLOSURE);
    expect(rc3.assistant_text).toContain(DISCLOSURE);
    const held = await heldOnLatestRow();
    const { heldProposalId } = await import('../proposal-object/record.js');
    const rc3Held = held.find((pending) => `agent-approve-proposal:${heldProposalId(pending as never)}` === rc3Approve.id)!;
    expect(rc3Held, 'the visible Agent approval names the persisted product hold').toBeDefined();
    expect(rc3Held?.action.inline_patch?.operations).toEqual([{ op: 'add_node', path: RISK_ID,
      value: { id: RISK_ID, kind: 'risk', label: RISK_LABEL, relies_on: { option_id: OPTION_ID } } }]);
    expect(bytes(), 'RC3 still holds until human approval').toBe(before);
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    await approveOffer(rc3Approve);
    expect((graphWrites.get(SCENARIO) ?? 0) - writesBefore).toBe(1);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(graphNow().edges.filter((edge) => edge.from === RISK_ID || edge.to === RISK_ID)).toEqual([]);
    expect(routerCalls).toEqual([]);
  }, 120_000);

  it('chat-precondition-offer-competitor CONTROL: an unrelated risk in the same brief has no presses and preserves ordinary reply/card/write bytes', async () => {
    const label = 'Competitor cuts prices';
    seed();
    const withTiming = await offer(ordinaryArgs(label), `Add a risk: ${label} — MRR will be lower.`);
    expect(preconditionPressesOf(withTiming.response)).toEqual([]);
    expect(withTiming.response.assistant_text).not.toContain(PRECONDITION_OFFER_LINE);
    await approveOffer(withTiming.approve);
    const ordinaryBytes = bytes();
    nextScenario();
    seed(plainGraph(), 'Our goal is MRR growth while churn stays below 4%.');
    const withoutTiming = await offer(ordinaryArgs(label), `Add a risk: ${label} — MRR will be lower.`);
    expect(withTiming.response.assistant_text).toBe(withoutTiming.response.assistant_text);
    // The existing approval/decline identity is scoped to its scenario. Compare every wire byte except those
    // scenario-bound handles, while preserving the same ordinary card text, messages, labels and graph write.
    const unscopedActions = (actions: Chip[]) => actions.map((chip) => ({ ...chip,
      id: chip.id.replace(/^(agent-(?:approve|decline)-proposal:)gmh_[0-9a-f]{12}$/, '$1gmh_SCENARIO'),
    }));
    expect(unscopedActions(withTiming.response.suggested_actions)).toEqual(unscopedActions(withoutTiming.response.suggested_actions));
    await approveOffer(withoutTiming.approve);
    expect(bytes()).toBe(ordinaryBytes);
  }, 120_000);

  it('chat-precondition-offer-no-timing CONTROL: neither stored brief nor decision contains a timing phrase; request text alone cannot offer it', async () => {
    const graph = plainGraph();
    for (const node of graph.nodes) if (node.kind === 'decision') { node.label = 'How can we grow MRR?'; delete node.description; }
    seed(graph, 'Grow MRR through a Pro price change. The feature release is a separate project.');
    const { response, approve } = await offer(ordinaryArgs());
    expect(preconditionPressesOf(response)).toEqual([]);
    expect(response.assistant_text).not.toContain(PRECONDITION_OFFER_LINE);
    expect(approve.detail).toBe(SERVED[0]!.suggested_actions.find((chip) => chip.detail?.includes("Add risk 'Feature release slips'"))!.detail);
  }, 120_000);

  it('chat-precondition-offer-valid-lease CONTROL: existing valid lease holds RC3 directly, without duplicate presses or ambiguity line', async () => {
    seed();
    const { response, approve } = await offer(preconditionArgs());
    expect(approve.detail).toBe(DISCLOSURE);
    expect(preconditionPressesOf(response)).toEqual([]);
    expect(response.assistant_text).not.toContain(PRECONDITION_OFFER_LINE);
  }, 120_000);

  it('chat-precondition-offer-producer-contract RED: the host-computed result carries option identities and labels through the tool contract', async () => {
    seed();
    // Explicitly permit narration so the scripted provider sees the actual function_call_output, rather than
    // reading a copied implementation result. The offer itself remains deterministic and host-owned.
    const { result, response } = await offer({ ...ordinaryArgs(), whole_request: false });
    const approve = (await hiddenCard()).approve_action;
    expect(result.precondition_offers).toEqual([
      { option_id: OPTION_ID, option_label: OPTION_LABEL },
      { option_id: 'raise_pro_price_to_54', option_label: 'Raise Pro price to £54' },
    ]);
    expect(approve.detail).toBe(SERVED[0]!.suggested_actions.find((chip) => chip.detail?.includes("Add risk 'Feature release slips'"))!.detail);
    expect(preconditionPressesOf(response)).toHaveLength(2);
    expect(response.assistant_text).toContain(PRECONDITION_OFFER_LINE);
  }, 120_000);

  it('chat-precondition-offer-outside-phrase CONTROL: a risk word elsewhere in stored context cannot corroborate an unrelated timing clause', async () => {
    const graph = plainGraph();
    for (const node of graph.nodes) if (node.kind === 'decision') { node.label = 'How can we grow MRR?'; delete node.description; }
    seed(graph, 'Launch the Pro change with the next customer campaign. The feature release is a separate project.');
    const { response } = await offer(ordinaryArgs());
    expect(preconditionPressesOf(response)).toEqual([]);
    expect(response.assistant_text).not.toContain(PRECONDITION_OFFER_LINE);
  }, 120_000);

  it('chat-precondition-offer-decision-label RED: a corroborating phrase in the stored decision works when the stored brief is absent', async () => {
    const graph = plainGraph();
    graph.nodes.find((node) => node.kind === 'decision')!.label = 'Increase the Pro price with the next Pro feature release?';
    seed(graph, null);
    const { response } = await offer(ordinaryArgs());
    expect(preconditionPressesOf(response).map((chip) => chip.message)).toEqual([
      preconditionPressMessage(OPTION_LABEL), preconditionPressMessage('Raise Pro price to £54'),
    ]);
    expect(response.assistant_text).toContain(FRAMING_OFFER_LINE);
    expect(response.assistant_text).not.toContain('Your brief launches');
  }, 120_000);

  it('chat-precondition-offer-rc3-replay RED: pressed RC3 card survives persisted JSONB replay, and its original approval still stamps zero edges', async () => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const press = pressForOption(response);
    const turnId = randomUUID();
    const payload = { turn_id: turnId, message: press.message, source: 'chip', chip: { id: press.id } };
    const rc3 = await turn(payload);
    const approve = approveChipOf(rc3)!;
    expect(approve?.detail).toBe(DISCLOSURE);
    const before = bytes();
    const callsBefore = openAiCalls;
    const replay = await turn(payload);
    expect(openAiCalls, 'persisted same-turn replay has no provider call').toBe(callsBefore);
    expect(approveChipOf(replay)).toEqual(approve);
    expect(replay.assistant_text).toContain(DISCLOSURE);
    expect(bytes()).toBe(before);
    expect((await store.readCommittedTurn(SCENARIO, turnId))?.pending_actions,
      'approval identity is rehydrated by the production pending parser').toEqual(await store.readMostRecentPendingActions(SCENARIO));
    await approveOffer(approve);
    const reloadedGraph = await store.loadGraph(SCENARIO) as G;
    expect(reloadedGraph.nodes.find((node) => node.id === RISK_ID)?.relies_on).toEqual({ option_id: OPTION_ID });
    expect(reloadedGraph.edges.filter((edge) => edge.from === RISK_ID || edge.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it.each(['top-true-data-false', 'top-false-data-true'] as const)('chat-precondition-offer-baseline-%s RED: true on either baseline surface excludes that option even when status-quo identity is ambiguous', async (shape) => {
    const graph = plainGraph();
    const option = graph.nodes.find((node) => node.id === OPTION_ID)!;
    option.is_baseline = shape === 'top-true-data-false';
    option.data = { is_baseline: shape === 'top-false-data-true' };
    seed(graph);
    const { response } = await offer(ordinaryArgs());
    expect(preconditionPressesOf(response).map((chip) => chip.message)).toEqual([preconditionPressMessage('Raise Pro price to £54')]);
    expect(preconditionPressesOf(response).some((chip) => chip.message.includes('Keep current Pro price'))).toBe(false);
  }, 120_000);

  it('chat-precondition-offer-all-baseline CONTROL: timing corroboration alone offers nothing when every option is baseline', async () => {
    const graph = plainGraph();
    for (const node of graph.nodes) if (node.kind === 'option') node.is_baseline = true;
    seed(graph);
    const { response } = await offer(ordinaryArgs());
    expect(preconditionPressesOf(response)).toEqual([]);
    expect(response.assistant_text).not.toContain(PRECONDITION_OFFER_LINE);
  }, 120_000);

  it.each(['edited-option-message', 'forged-id', 'removed', 'renamed-and-reidentified', 'became-baseline'] as const)('chat-precondition-offer-refused-%s RED: a forged or stale press cannot prepare or write a precondition', async (shape) => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const press = pressForOption(response);
    let pressed = { ...press };
    const graph = structuredClone(graphNow());
    if (shape === 'edited-option-message') pressed.message = preconditionPressMessage('Raise Pro price to £54');
    if (shape === 'forged-id') pressed.id = `${press.id.slice(0, -1)}${press.id.endsWith('0') ? '1' : '0'}`;
    if (shape === 'removed') {
      graph.nodes = graph.nodes.filter((node) => node.id !== OPTION_ID);
      graph.edges = graph.edges.filter((edge) => edge.from !== OPTION_ID && edge.to !== OPTION_ID);
    }
    if (shape === 'renamed-and-reidentified') {
      graph.nodes.find((node) => node.id === OPTION_ID)!.label = 'Renamed original option';
      graph.nodes.push({ ...structuredClone(graph.nodes.find((node) => node.id === OPTION_ID)!), id: 'replacement_59', label: OPTION_LABEL });
      const validOptionEdge = graph.edges.find((edge) => edge.from === OPTION_ID && edge.to === 'pro_plan_price')!;
      expect(validOptionEdge, 'replacement keeps a structurally valid option edge').toBeDefined();
      graph.edges.push({ ...structuredClone(validOptionEdge), from: 'replacement_59' });
    }
    if (shape === 'became-baseline') graph.nodes.find((node) => node.id === OPTION_ID)!.is_baseline = true;
    graphOf.set(SCENARIO, jsonbOrder(graph));
    const before = bytes();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const refused = await pressPrecondition(pressed);
    expect(refused._agent.tool_calls, 'terminal refusal; no fallthrough to the model or RC3 door').toEqual([]);
    expect(refused.assistant_text).toContain('I couldn’t prepare that risk as a change, so nothing was added.');
    expect(bytes()).toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
    expect((await heldOnLatestRow()).flatMap((pending) => pending.action.inline_patch?.operations ?? [])
      .some((operation) => operation.value?.relies_on !== undefined), 'no stamped hold created').toBe(false);
  }, 120_000);

  it('chat-precondition-offer-no-levers RED: a non-baseline option can be offered and pressed before its interventions are filled', async () => {
    const graph = plainGraph();
    delete graph.nodes.find((node) => node.id === OPTION_ID)!.interventions;
    graph.edges = graph.edges.filter((edge) => edge.from !== OPTION_ID);
    seed(graph);
    const { response } = await offer(ordinaryArgs());
    expect(preconditionPressesOf(response).map((chip) => chip.message)).toEqual([
      preconditionPressMessage(OPTION_LABEL), preconditionPressMessage('Raise Pro price to £54'),
    ]);
    const rc3 = await pressPrecondition(pressForOption(response));
    expect(rc3._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_new_risk', ok: true }));
    expect(approveChipOf(rc3)?.detail).toBe(DISCLOSURE);
  }, 120_000);

  it('chat-precondition-offer-race-became-baseline RED: canonical writer read refuses a target that became baseline after press resolution', async () => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const press = pressForOption(response);
    let reads = 0;
    let mutations = 0;
    let changedBytes: string | undefined;
    graphReadHook = (scenarioId) => {
      if (scenarioId !== SCENARIO) return;
      reads += 1;
      if (reads !== 2) return;
      mutations += 1;
      // The first read resolves the host-bound press on a non-baseline option. Advance the model immediately
      // before proposeNewRisk's separate canonical read, retaining Keep's original baseline and splitting flags.
      const graph = structuredClone(graphNow());
      const option = graph.nodes.find((node) => node.id === OPTION_ID)!;
      option.is_baseline = false;
      option.data = { ...(option.data as Record<string, unknown> | undefined), is_baseline: true };
      graphOf.set(SCENARIO, jsonbOrder(graph));
      changedBytes = bytes();
    };
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const refused = await pressPrecondition(press);
    graphReadHook = undefined;
    expect(reads, 'both resolver and canonical writer reads occurred').toBeGreaterThanOrEqual(2);
    expect(mutations, 'the between-read mutation fired exactly once').toBe(1);
    expect(changedBytes, 'the current graph changed between the two reads').toBeDefined();
    expect(graphNow().nodes.find((node) => node.id === OPTION_ID)).toMatchObject({ is_baseline: false, data: { is_baseline: true } });
    expect(graphNow().nodes.find((node) => node.id === 'keep_current_pro_price')?.is_baseline).toBe(true);
    expect(refused._agent.tool_calls).toEqual([expect.objectContaining({
      name: 'propose_new_risk', ok: false, mutated: false, refusal: 'invalid_precondition',
    })]);
    expect(refused.assistant_text).toContain('I couldn’t prepare that risk as a change, so nothing was added.');
    expect(bytes(), 'the writer preserves the concurrent baseline change and adds nothing').toBe(changedBytes);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
    expect(riskNow()).toBeUndefined();
    expect((await heldOnLatestRow()).flatMap((pending) => pending.action.inline_patch?.operations ?? [])
      .some((operation) => operation.value?.relies_on !== undefined), 'the stale host marker creates no stamped hold').toBe(false);
  }, 120_000);

  for (const [corpus, rows] of [
    ['six-served-P44-draws', SIX_SERVED_RECONSTRUCTED.rows],
    ['stored-runner-add-risk-turns', STORED_RUNNERS_RECONSTRUCTED.rows],
  ] as const) {
    it.each(rows.filter((row) => row.args !== null && row.do_not_replay !== true))(
      `chat-precondition-offer-reconstructed-minimal ${corpus} $id: exact captured graph/brief/request/card, reconstructed args, no live LLM`, async (row) => {
        // These captures retained the card, not function_call.arguments. The fixture and row name state that
        // limit explicitly: this tests the observed semantic shape without calling it exact-arguments replay.
        expect(row.args_provenance).toBe('reconstructed_minimal_from_served_card_and_brief');
        SCENARIO = row.request.scenario_id;
        seed(structuredClone(row.graph), row.brief_text);
        const before = bytes();
        const { response, approve } = await offer(row.args!, row.request.message, row.request);
        const recordedCard = row.expected_precondition_offer_count > 0 ? (await hiddenCard()).approve_action : approve;
        expect(recordedCard.detail, 'the captured model card stays unchanged').toBe(row.observed_card?.detail);
        const presses = preconditionPressesOf(response);
        expect(presses).toHaveLength(row.expected_precondition_offer_count);
        if (row.expected_precondition_offer_count > 0) {
          expect(approveChipOf(response)).toBeUndefined();
          expect(response._proposal_fields).toBeUndefined();
          expect(response.suggested_actions.at(-1)?.label).toBe('It lowers MRR for every option');
          expect(response.assistant_text).toContain(PRECONDITION_OFFER_LINE);
          expect(presses.map((chip) => chip.label)).toEqual(row.graph.nodes
            .filter((node) => node.kind === 'option' && node.is_baseline !== true && (node.data as { is_baseline?: boolean } | undefined)?.is_baseline !== true)
            .map((node) => `Add to ‘${node.label}’`));
        } else {
          expect(response.assistant_text).not.toContain(PRECONDITION_OFFER_LINE);
        }
        expect(bytes(), 'offers and held cards never write the model').toBe(before);
        expect(routerCalls).toEqual([]);
      }, 120_000,
    );
  }

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

  // The invalid-lease controls also meet the timing trigger. Choose the ordinary interpretation deliberately,
  // then compare the same card/write as before FIX1. Non-trigger and valid-lease rows take their unchanged path.
  const offerAndChooseOrdinary = async (...args: Parameters<typeof offer>) => {
    const offered = await offer(...args);
    const choice = offered.response.suggested_actions.find(c => c.label === 'It lowers MRR for every option');
    if (choice === undefined) return offered;
    expect(approveChipOf(offered.response)).toBeUndefined();
    const response = await pressPrecondition(choice);
    return { ...offered, response, approve: approveChipOf(response)! };
  };

  it('chat-precondition-p44-r5-today: without the lease, served risk→mrr card and ordinary graph bytes stay unchanged', async () => {
    seed();
    const { approve } = await offerAndChooseOrdinary(ordinaryArgs());
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
    const { approve } = await offerAndChooseOrdinary({ ...ordinaryArgs(), caused_by: [{ factor_label: 'Pro plan price', direction: 'positive' }] },
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
    const { approve } = await offerAndChooseOrdinary({ ...ordinaryArgs('Office flood'), relies_on_option: OPTION_LABEL }, 'Add a risk: Office flood lowers MRR.');
    expect(approve.detail ?? '').not.toContain('relies on this not happening');
    await approveOffer(approve);
    const invalidLeaseBytes = bytes();
    expect(riskNow('Office flood').relies_on).toBeUndefined();
    expect(graphNow().edges.some((e) => e.from === riskNow('Office flood').id && e.to === 'mrr')).toBe(true);
    nextScenario(); seed();
    await approveOffer((await offerAndChooseOrdinary(ordinaryArgs('Office flood'), 'Add a risk: Office flood lowers MRR.')).approve);
    expect(bytes()).toBe(invalidLeaseBytes);
  }, 120_000);

  it.each(['Pro plan price', 'Keep current Pro price', 'absent option', OPTION_ID])('chat-precondition-forged-%s: non-option, status quo, unknown option and id spelling fall back to today byte for byte', async (relies_on_option) => {
    seed();
    const { approve } = await offerAndChooseOrdinary({ ...ordinaryArgs(), relies_on_option });
    expect(approve.detail ?? '').not.toContain('relies on this not happening');
    await approveOffer(approve);
    const ignoredLeaseBytes = bytes();
    expect(riskNow().relies_on).toBeUndefined();
    nextScenario(); seed();
    await approveOffer((await offerAndChooseOrdinary(ordinaryArgs())).approve);
    expect(bytes()).toBe(ignoredLeaseBytes);
  }, 120_000);

  it('chat-precondition-ambiguous-option: duplicate option labels ignore the lease and retain ordinary graph bytes', async () => {
    const ambiguous = plainGraph();
    ambiguous.nodes.find((n) => n.id === 'raise_pro_price_to_54')!.label = OPTION_LABEL;
    seed(ambiguous);
    const { approve } = await offerAndChooseOrdinary({ ...ordinaryArgs(), relies_on_option: OPTION_LABEL });
    await approveOffer(approve);
    const ignoredLeaseBytes = bytes();
    expect(riskNow().relies_on).toBeUndefined();
    nextScenario(); seed(ambiguous);
    await approveOffer((await offerAndChooseOrdinary(ordinaryArgs())).approve);
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
    const { approve } = await offerAndChooseOrdinary({ ...ordinaryArgs(), relies_on_option: OPTION_LABEL });
    expect(approve.detail ?? '').not.toContain('relies on this not happening');
    await approveOffer(approve);
    const ignoredLeaseBytes = bytes();
    expect(riskNow().relies_on).toBeUndefined();
    nextScenario(); seed(split);
    await approveOffer((await offerAndChooseOrdinary(ordinaryArgs())).approve);
    expect(bytes()).toBe(ignoredLeaseBytes);
  }, 120_000);

  it('chat-precondition-conflicting-links: valid precondition wins over both affects and caused_by; links dropped and reason said', async () => {
    seed();
    const { result, approve, response } = await offerAndChooseOrdinary({ ...preconditionArgs(), affects: [{ target_label: 'MRR', direction: 'negative' }],
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
    const { response, approve } = await offerAndChooseOrdinary(preconditionArgs(), `${P44_MESSAGE} ${extra}`);
    expect(approve.detail).toBe(DISCLOSURE);
    expect(`${approve.detail}\n${response.assistant_text}`).not.toMatch(/may happen|likelihood|10%|10–30%/);
    await approveOffer(approve);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(riskNow().event_risk).toBeUndefined();
    expect(graphNow().edges.filter((e) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it.each(['Office flood while away', 'Shoulder injury'])('chat-precondition-filler-words: %s cannot pass the sanity gate through a function word', async (riskLabel) => {
    seed();
    const { approve } = await offerAndChooseOrdinary({ ...ordinaryArgs(riskLabel), relies_on_option: OPTION_LABEL }, `Add a risk: ${riskLabel} lowers MRR.`);
    expect(approve.detail).not.toContain('relies on this not happening');
    await approveOffer(approve);
    expect(riskNow(riskLabel).relies_on).toBeUndefined();
    expect(graphNow().edges.some((e) => e.from === riskNow(riskLabel).id && e.to === 'mrr')).toBe(true);
  }, 120_000);

  it('chat-precondition-invalid-conflicting-links: accepted option lease drops unresolvable model links before ordinary link validation', async () => {
    seed();
    const { approve } = await offerAndChooseOrdinary({ ...preconditionArgs(), affects: [{ target_label: 'nonexistent outcome', direction: 'negative' }],
      caused_by: [{ factor_label: 'nonexistent factor', direction: 'positive' }] });
    expect(approve.detail).toContain(DISCLOSURE);
    await approveOffer(approve);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(graphNow().edges.filter((e) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it('step-12 receipt (DL 58e392, Paul try-guide 8 Oct): a precondition risk with no links is "Added … as a risk.", never "affecting ;"', async () => {
    seed();
    const { approve } = await offerAndChooseOrdinary(preconditionArgs());
    const receipt = (await approveOffer(approve)).assistant_text;
    expect(receipt, receipt).toContain(`Added "${RISK_LABEL}" as a risk.`);
    expect(receipt, receipt).not.toMatch(/affecting\s*[;.,]|affecting\s*$|driven by\s*[;.,]/m);
  }, 120_000);

  it('chat-precondition-deterministic-mixed-links: whole request says in the assistant reply why both model links are dropped, without narration', async () => {
    seed();
    const { response, approve } = await offerAndChooseOrdinary({ ...preconditionArgs(), whole_request: true,
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
    const { response, approve } = await offerAndChooseOrdinary({ ...preconditionArgs(), whole_request: true }, message);
    expect(openAiCalls, '£59 in the option label is covered without narration').toBe(1);
    expect(response.assistant_text).toContain(DISCLOSURE);
    await approveOffer(approve);
    expect(riskNow().relies_on).toEqual({ option_id: OPTION_ID });
    expect(graphNow().edges.filter((e) => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it('chat-precondition-pricing-stem: “Pricing rollout delayed” is corroborated by “price” (four-letter stem)', async () => {
    seed();
    const label = 'Pricing rollout delayed';
    const { approve } = await offerAndChooseOrdinary({ label, relies_on_option: OPTION_LABEL, affects: [], caused_by: [], whole_request: true },
      'Add a risk: Pricing rollout delayed — the £59 price rise cannot go live until billing supports the new pricing.');
    expect(approve.detail).toBe(`‘${label}’: ‘${OPTION_LABEL}’ relies on this not happening. This model can't yet apply that risk to that option alone, so the Run leaves it out, and that option's chance doesn't include it yet.`);
    await approveOffer(approve);
    expect(riskNow(label).relies_on).toEqual({ option_id: OPTION_ID });
  }, 120_000);

  it('chat-precondition-not-whole-request: an explicit whole_request:false leaves the other request to narration', async () => {
    seed();
    await offerAndChooseOrdinary({ ...preconditionArgs(), whole_request: false }, `${P44_MESSAGE} Also explain why Keep current Pro price is the baseline.`);
    expect(openAiCalls, 'narration answers the rest of the request').toBe(2);
  }, 120_000);

  it('chat-precondition-dropped-link-figures: figures only in discarded links are not counted as carried', async () => {
    seed();
    await offerAndChooseOrdinary({ ...preconditionArgs(), affects: [{ target_label: 'MRR lower by 10% within 6 months', direction: 'negative' }] },
      'Add a risk: Feature release slips — if it slips, MRR will be lower by 10% within 6 months.');
    expect(openAiCalls, 'the uncarried 10% / 6 months go to narration, not a reply that drops them').toBe(2);
  }, 120_000);

  it('chat-precondition-raw-stamp-arg: a model-authored relies_on on the exposed tool is ignored', async () => {
    seed();
    const { approve } = await offerAndChooseOrdinary({ ...ordinaryArgs(), relies_on: { option_id: OPTION_ID } });
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
