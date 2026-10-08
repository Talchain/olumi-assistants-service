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
type Write = { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; turn_class?: string; handler_id?: string | null; pending_actions?: unknown[]; graph?: unknown; handler_facts?: unknown[] };
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
let pendingReadHook: ((options: { onLatestRowId?: unknown } | undefined) => void | Promise<void>) | undefined;
let failAnswerTurnId: string | undefined;
let failedAnswerAppends = 0;
let conditionalMovesRemaining = 0;
let conditionalAppendAttempts = 0;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  scenarioExists: vi.fn(async (sid: string) => graphOf.has(sid)),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    if (row === undefined) return null;
    const { turn_id: _turnId, ...committed } = row;
    return { ...committed, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string, options?: { onLatestRowId?: unknown }) => {
    await pendingReadHook?.(options);
    if (typeof options?.onLatestRowId === 'function') options.onLatestRowId(latestRow(sid)?.id ?? null);
    return parsedPending(latestRow(sid), sid);
  }),
  appendIfLatest: vi.fn(async (w: Write, options: { expectedLatestRowId: string | null }): Promise<{ id: string } | { status: 'latest_moved' }> => {
    conditionalAppendAttempts += 1;
    if (conditionalMovesRemaining > 0) {
      conditionalMovesRemaining -= 1;
      await store.append({ scenario_id: w.scenario_id, turn_id: randomUUID(), request_hash: 'sha256:fix2-concurrent-floor',
        pending_actions: structuredClone(latestRow(w.scenario_id)?.pending_actions ?? []) });
    }
    if ((latestRow(w.scenario_id)?.id ?? null) !== options.expectedLatestRowId) return { status: 'latest_moved' };
    return store.append(w);
  }),
  append: vi.fn(async (w: Write) => {
    if (w.turn_id === failAnswerTurnId && w.request_hash.startsWith('agent_turn:')) {
      failedAnswerAppends += 1;
      throw new Error('FIX2-P1-2 injected outer Agent answer append failure after durable inner hold');
    }
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
  let reloadApp: FastifyInstance;
  const startApp = async () => {
    await reloadApp?.close();
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
    const { default: scenarioGraphRoute } = await import('../../../routes/assist.v1.scenario-graph.js');
    reloadApp = Fastify({ logger: false });
    await reloadApp.register(scenarioGraphRoute);
    await reloadApp.ready();
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
  afterAll(async () => { await app?.close(); await reloadApp?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); script = []; openAiCalls = 0; routerCalls.length = 0; graphReadHook = undefined; pendingReadHook = undefined; failAnswerTurnId = undefined; failedAnswerAppends = 0; conditionalMovesRemaining = 0; conditionalAppendAttempts = 0; });

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
    const press = response.suggested_actions.find((c) => c.label === 'It lowers ‘MRR’ for every option');
    expect(press, JSON.stringify(response.suggested_actions)).toBeDefined();
    return press!;
  };
  const hiddenCard = async () => {
    const { proposalRecord } = await import('../proposal-object/record.js');
    const holds = await heldOnLatestRow();
    expect(holds).toHaveLength(1);
    return proposalRecord(holds[0] as never, graphNow())!;
  };

  const reload = async () => {
    const r = await reloadApp.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: { include_conversation_turns: true } });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as { conversation_turns?: { turn_id: string; suggested_actions?: Chip[] }[];
      proposal_fields?: { proposals: { approve_action: Chip }[] }; held_proposal_offers?: { approve_action: Chip }[] };
  };
  const approveAtSharedRoute = async (record: Awaited<ReturnType<typeof hiddenCard>>) => {
    const { makeMessagePayload } = await import('../../__tests__/fixtures.js');
    const r = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: makeMessagePayload({
      scenario_id: SCENARIO, turn_id: randomUUID(), message: record.approve_action.message,
      source: 'chip', chip: { id: record.proposal_id },
    } as never) });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(200);
    return r.json() as { assistant_text: string; suggested_actions: Chip[] };
  };
  const expectNoOrdinaryReloadCard = (body: Awaited<ReturnType<typeof reload>>) => {
    expect(body.proposal_fields?.proposals ?? []).toEqual([]);
    expect(body.held_proposal_offers ?? []).toEqual([]);
    expect((body.conversation_turns ?? []).flatMap(t => t.suggested_actions ?? [])
      .some(c => c.id.startsWith('agent-approve-proposal:gmh_') || c.id.startsWith('gmh_'))).toBe(false);
  };

  it('FIX2-P1-1 RED: after the trigger, the held card’s exact approval message to /orchestrate/v2/turn with source chip + chip id gmh + a fresh turn id is refused, writes nothing and re-shows choices', async () => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const record = await hiddenCard();
    const before = bytes();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const callsBefore = openAiCalls;
    const refused = await approveAtSharedRoute(record);
    expect(bytes(), 'the shared held writer must refuse before committing risk→MRR').toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
    expect(openAiCalls).toBe(callsBefore);
    expect(refused.suggested_actions).toEqual(response.suggested_actions);
    expect(refused.assistant_text).toContain(PRECONDITION_OFFER_LINE);
  }, 120_000);

  it('FIX2-P1-2 RED: the inner hold commit succeeds and the outer answer append fails; reload shows no ordinary approval and direct approve is refused', async () => {
    seed();
    const triggerTurn = randomUUID();
    failAnswerTurnId = triggerTurn;
    const { response } = await offer(ordinaryArgs(), P44_MESSAGE, { turn_id: triggerTurn });
    failAnswerTurnId = undefined;
    expect(failedAnswerAppends, 'failure injected at the outer answer, after the real inner hold commit').toBe(1);
    expect(rows.has(`${SCENARIO}:${triggerTurn}`)).toBe(false);
    const record = await hiddenCard();
    expect(record.proposal_id).toMatch(/^gmh_/);
    const durableHolds = await heldOnLatestRow();
    expect(durableHolds).toHaveLength(1);
    const before = bytes();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const cold = await reload();
    expectNoOrdinaryReloadCard(cold);
    const refused = await approveAtSharedRoute(record);
    expect(bytes(), 'a direct shared-writer approve after the failed answer must not bypass the choice').toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
    expect(refused.suggested_actions.map(c => c.message)).toEqual(response.suggested_actions.map(c => c.message));
  }, 120_000);

  it('FIX2-P1-3 RED: choose £54, replay the original £59 press with a fresh turn id; replay is refused and the saved £54 approval stamps £54 only', async () => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const old59 = pressForOption(response);
    const chosen54 = await pressPrecondition(pressForOption(response, 'Raise Pro price to £54'));
    const saved54 = approveChipOf(chosen54)!;
    const consentRows = [...rows.values()].filter(row => row.scenario_id === SCENARIO && row.request_hash.startsWith('agent_turn:held_choice:'));
    expect(consentRows).toHaveLength(1);
    expect(consentRows[0]).toMatchObject({ user_message: null, assistant_message: null, handler_id: null, turn_class: 'direct_answer' });
    const current54 = await hiddenCard();
    const before = bytes();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const refused = await pressPrecondition(old59);
    const { RISK_PRECONDITION_CHOICE_REFUSED_REPLY } = await import('../chat-risk-precondition-choice.js');
    expect(refused.assistant_text).toBe(RISK_PRECONDITION_CHOICE_REFUSED_REPLY);
    expect(refused._agent.tool_calls).toEqual([]);
    expect(approveChipOf(refused)).toBeUndefined();
    expect((await hiddenCard()).revision).toBe(current54.revision);
    expect((await hiddenCard()).digest).toBe(current54.digest);
    expect(bytes()).toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
    await approveOffer(saved54);
    expect(riskNow().relies_on).toEqual({ option_id: 'raise_pro_price_to_54' });
    expect(graphNow().edges.filter(e => e.from === RISK_ID || e.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it('FIX2-P1-3-not-now RED: Not now retires the original option presses; replay with a fresh turn id is refused', async () => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const old59 = pressForOption(response);
    const record = await hiddenCard();
    await turn({ message: record.decline_action.message, source: 'chip', chip: { id: record.decline_action.id } });
    expect(await heldOnLatestRow()).toEqual([]);
    const before = bytes();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const refused = await pressPrecondition(old59);
    const { RISK_PRECONDITION_CHOICE_REFUSED_REPLY } = await import('../chat-risk-precondition-choice.js');
    expect(refused.assistant_text).toBe(RISK_PRECONDITION_CHOICE_REFUSED_REPLY);
    expect(refused._agent.tool_calls).toEqual([]);
    expect(approveChipOf(refused)).toBeUndefined();
    expect(await heldOnLatestRow()).toEqual([]);
    expect(bytes()).toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
  }, 120_000);

  it('FIX2-P1-3-overlap RED: a £54 choice arriving after £59 resolves but before its conditional hold append cannot be replaced; saved £54 approval stamps £54', async () => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const ordinaryPending = structuredClone(latestRow()!.pending_actions);
    const old59 = pressForOption(response);
    const chosen54 = await pressPrecondition(pressForOption(response, 'Raise Pro price to £54'));
    const saved54 = approveChipOf(chosen54)!;
    const pending54 = structuredClone(latestRow()!.pending_actions);
    const current54 = await hiddenCard();
    // £59 first resolves against the original marked hold. The conditional floor's next authoritative read
    // observes another request's £54 replacement, carrying the same stable proposal id with a new revision/digest.
    latestRow()!.pending_actions = ordinaryPending;
    let raced = false;
    pendingReadHook = (options) => {
      if (raced || options?.onLatestRowId === undefined) return;
      raced = true;
      const prior = latestRow()!;
      const concurrentTurn = randomUUID();
      const key = `${SCENARIO}:${concurrentTurn}`;
      rows.set(key, { ...prior, id: `row-${rows.size + 1}`, turn_id: concurrentTurn,
        request_hash: 'sha256:fix2-concurrent-option', assistant_message: null, user_message: null, pending_actions: pending54 });
      order.push(key);
    };
    const before = bytes();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const refused = await pressPrecondition(old59);
    pendingReadHook = undefined;
    expect(raced, 'the competing choice arrived at the conditional append floor').toBe(true);
    expect(approveChipOf(refused)).toBeUndefined();
    expect(refused._agent.tool_calls.some(call => call.ok)).toBe(false);
    expect((await hiddenCard()).revision).toBe(current54.revision);
    expect((await hiddenCard()).digest).toBe(current54.digest);
    expect(bytes()).toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
    await approveOffer(saved54);
    expect(riskNow().relies_on).toEqual({ option_id: 'raise_pro_price_to_54' });
    expect(graphNow().edges.filter(edge => edge.from === RISK_ID || edge.to === RISK_ID)).toEqual([]);
  }, 120_000);

  it('FIX2-P1-4 RED: risk label Feature release slips plus delay repeated 80 times cannot expose ordinary approval; the decline press is present', async () => {
    seed();
    const label = 'Feature release slips ' + 'delay '.repeat(80);
    const before = bytes();
    const { response } = await offer(ordinaryArgs(label), `Add a risk: ${label} — MRR will be lower.`);
    expect(approveChipOf(response), 'option assembly cannot fail open to the ordinary approval').toBeUndefined();
    expect(response._proposal_fields).toBeUndefined();
    expect(response.suggested_actions.some(c => c.id.startsWith('agent-risk-mrr-choice:'))).toBe(true);
    expect(response.assistant_text).toMatch(/options couldn[’']t be listed|options could not be listed/i);
    expect(bytes()).toBe(before);
    const ordinary = await hiddenCard();
    const refused = await approveAtSharedRoute(ordinary);
    expect(bytes()).toBe(before);
    expect(refused.suggested_actions.some(c => c.id.startsWith('gmh_') || c.id.startsWith('agent-approve-proposal:gmh_'))).toBe(false);
  }, 120_000);

  it('FIX2-P2-5 RED: trigger T, choose £59, retry T; replay selects the current RC3 revision and exposes no hidden ordinary chip or proposal fields', async () => {
    seed();
    const triggerTurn = randomUUID();
    const { response } = await offer(ordinaryArgs(), P44_MESSAGE, { turn_id: triggerTurn });
    const ordinary = await hiddenCard();
    const rc3 = await pressPrecondition(pressForOption(response));
    const current = await hiddenCard();
    const callsBefore = openAiCalls;
    const replay = await turn({ turn_id: triggerTurn, message: P44_MESSAGE });
    expect(openAiCalls).toBe(callsBefore);
    expect(replay.suggested_actions.some(c => c.message === ordinary.approve_action.message)).toBe(false);
    expect(replay._proposal_fields?.proposals.some(p => p.approve_action.message === ordinary.approve_action.message) ?? false).toBe(false);
    expect(approveChipOf(replay)).toEqual(approveChipOf(rc3));
    expect(replay._proposal_fields?.proposals).toContainEqual(expect.objectContaining({ revision: current.revision, digest: current.digest }));
  }, 120_000);

  it('FIX2-P2-6 RED: two matching risks in one turn reload both choice sets', async () => {
    seed();
    const triggerTurn = randomUUID();
    const otherRisk = 'Pro feature outage';
    // The Agent loop refuses a second proposing call via ONE_CHANGE_PER_APPROVAL. Exercise the reload contract
    // for a durable answer carrying several holds via the real producers, rather than weakening that loop guard.
    const { holdAddRiskInProcess } = await import('../../system-events/dispatch.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    const { riskAddPressFor } = await import('../method-turn/widen-turn.js');
    const { withRiskPreconditionChoice, riskPreconditionChoiceActions } = await import('../chat-risk-precondition-choice.js');
    const { proposalRecord } = await import('../proposal-object/record.js');
    for (const [index, label] of [RISK_LABEL, otherRisk].entries()) {
      const held = await holdAddRiskInProcess({ scenario_id: SCENARIO, turn_id: randomUUID(),
        base_graph_hash: computeAnalysisAffectingGraphHash(graphNow() as never)!,
        risk: { id: index === 0 ? RISK_ID : 'risk_pro_feature_outage', label },
        links: [{ to_id: 'mrr', effect_direction: 'negative' }] }, `fix2-two-held-${index}`);
      expect(held.status).toBe('held');
    }
    const pending = await store.readMostRecentPendingActions(SCENARIO);
    const marked = pending.map(raw => {
      const hold = raw as Parameters<typeof withRiskPreconditionChoice>[0];
      const record = proposalRecord(hold, graphNow());
      if (record === undefined) return hold;
      const label = (record.operations.find(op => op.op === 'add_node')!.value as { label: string }).label;
      const actions = [
        { id: OPTION_ID, label: OPTION_LABEL }, { id: 'raise_pro_price_to_54', label: 'Raise Pro price to £54' },
      ].map(option => riskAddPressFor({ label, mechanism: 'relies_on', hits: { ...option, kind: 'option' } }));
      return withRiskPreconditionChoice(hold, graphNow(), actions, PRECONDITION_OFFER_LINE.replace(RISK_LABEL, label), triggerTurn);
    });
    const actions = marked.flatMap(hold => riskPreconditionChoiceActions(hold, graphNow()));
    expect(actions.filter(c => c.id.startsWith('agent-widen-add:'))).toHaveLength(4);
    expect(actions.filter(c => c.id.startsWith('agent-risk-mrr-choice:'))).toHaveLength(2);
    await store.append({ scenario_id: SCENARIO, turn_id: triggerTurn, request_hash: 'agent_turn:fix2-two-risk-answer',
      userMessage: 'Add risks: Feature release slips and Pro feature outage; each lowers MRR.',
      assistantMessage: PRECONDITION_OFFER_LINE, pending_actions: marked });
    const cold = await reload();
    expectNoOrdinaryReloadCard(cold);
    const restored = cold.conversation_turns?.find(t => t.turn_id === triggerTurn)?.suggested_actions;
    expect(restored).toEqual(actions);
  }, 120_000);

  it('FIX2-P2-7 RED: a matching risk that raises Monthly churn uses its own claim for decline words', async () => {
    const graph = plainGraph();
    graph.nodes.find(node => node.id === 'monthly_churn')!.kind = 'outcome';
    seed(graph);
    const { response } = await offer({ label: RISK_LABEL, affects: [{ target_label: 'Monthly churn', direction: 'positive' }], caused_by: [] },
      'Add a risk: Feature release slips — Monthly churn will rise.');
    const decline = response.suggested_actions.find(c => c.id.startsWith('agent-risk-mrr-choice:'));
    expect(decline).toMatchObject({ label: 'It raises ‘Monthly churn’ for every option', message: 'It raises ‘Monthly churn’ for every option' });
    const ordinary = await hiddenCard();
    const reoffered = await pressPrecondition(decline!);
    expect(approveChipOf(reoffered)).toEqual(ordinary.approve_action);
    await approveOffer(approveChipOf(reoffered)!);
    expect(graphNow().edges).toContainEqual(expect.objectContaining({ from: RISK_ID, to: 'monthly_churn', effect_direction: 'positive' }));
  }, 120_000);

  it.each((['decline', 'option'] as const).flatMap(choice =>
    (['unavailable', 'conflict', 'rpc-missing'] as const).map(shape => ({ choice, shape }))))('FIX2b-CAS-$choice-$shape: refuse without a transition write and re-show the current choices', async ({ choice: choiceKind, shape }) => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const ordinary = await hiddenCard();
    const choice = choiceKind === 'decline' ? declineChoiceOf(response) : pressForOption(response);
    const before = bytes();
    const declineTurn = randomUUID();
    const optionalStore: { appendIfLatest?: typeof store.appendIfLatest } = store;
    const originalCas = store.appendIfLatest;
    const attemptsBefore = conditionalAppendAttempts;
    if (shape === 'unavailable') optionalStore.appendIfLatest = undefined;
    else if (shape === 'conflict') conditionalMovesRemaining = 1;
    else originalCas.mockImplementationOnce(async () => {
      conditionalAppendAttempts += 1;
      const { StateCommitFailedError } = await import('../../session/store.js');
      throw new StateCommitFailedError('The existing conditional answer RPC is unavailable.', { rpc_code: 'PGRST202' });
    });
    let refused: Awaited<ReturnType<typeof turn>>;
    try {
      refused = await turn({ turn_id: declineTurn, message: choice.message, source: 'chip', chip: { id: choice.id } });
    } finally {
      optionalStore.appendIfLatest = originalCas;
      conditionalMovesRemaining = 0;
    }
    expect((refused!._agent as { durability?: string }).durability).toBe('not_recorded');
    expect(rows.has(`${SCENARIO}:${declineTurn}`), 'no unguarded fallback answer may clear the marker').toBe(false);
    expect([...rows.values()].filter(row => row.scenario_id === SCENARIO
      && row.request_hash.startsWith('agent_turn:held_choice:')), 'no inner option consent row may be written').toEqual([]);
    expect(conditionalAppendAttempts - attemptsBefore).toBe(shape === 'unavailable' ? 0 : 1);
    expect(approveChipOf(refused!)).toBeUndefined();
    expect(refused!._proposal_fields).toBeUndefined();
    expect(refused!.suggested_actions).toEqual(response.suggested_actions);
    const { hasRiskPreconditionChoice } = await import('../chat-risk-precondition-choice.js');
    expect((await heldOnLatestRow()).every(hold => hasRiskPreconditionChoice(hold as never))).toBe(true);
    const stillHeld = await hiddenCard();
    expect(stillHeld.revision).toBe(ordinary.revision);
    expect(stillHeld.digest).toBe(ordinary.digest);
    expect(bytes()).toBe(before);
    const direct = await approveAtSharedRoute(stillHeld);
    expect(direct.suggested_actions).toEqual(response.suggested_actions);
    expect(bytes()).toBe(before);
  }, 120_000);

  const FIX2C_REFUSAL = 'Nothing changed: the model changed since these choices were offered. Try again.';
  it.each(['option', 'decline'] as const)('FIX2c-before-press-$choice RED: trigger, ordinary non-conditional append preserving the marked hold, then old press refuses; re-shown current choices work on retry', async choiceKind => {
    seed();
    const triggerTurn = randomUUID();
    const { response } = await offer(ordinaryArgs(), P44_MESSAGE, { turn_id: triggerTurn });
    const ordinary = await hiddenCard();
    const choice = choiceKind === 'decline' ? declineChoiceOf(response) : pressForOption(response);
    const concurrentTurn = randomUUID();
    const pending = structuredClone(latestRow()!.pending_actions);
    await store.append({ scenario_id: SCENARIO, turn_id: concurrentTurn, request_hash: 'sha256:fix2c-ordinary-pre-press',
      userMessage: 'Keep thinking about the feature release.', assistantMessage: 'The release assumption is still open.', pending_actions: pending });
    expect(latestRow()!.turn_id).toBe(concurrentTurn);
    expect(latestRow()!.pending_actions).toEqual(pending);
    const before = bytes();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const refused = await pressPrecondition(choice);
    expect([...rows.values()].filter(row => row.scenario_id === SCENARIO && row.request_hash.startsWith('agent_turn:held_choice:'))).toEqual([]);
    expect(bytes()).toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
    expect(riskNow()).toBeUndefined();
    expect((await hiddenCard()).revision).toBe(ordinary.revision);
    expect((await hiddenCard()).digest).toBe(ordinary.digest);
    expect(approveChipOf(refused)).toBeUndefined();
    expect(refused._proposal_fields).toBeUndefined();
    expect(refused.suggested_actions).toEqual(response.suggested_actions);
    expect(refused.assistant_text).toBe(FIX2C_REFUSAL);
    const replay = await turn({ turn_id: triggerTurn, message: P44_MESSAGE });
    expect(replay.suggested_actions).toEqual(refused.suggested_actions);
    expect(approveChipOf(replay)).toBeUndefined();
    expect(replay._proposal_fields).toBeUndefined();
    const retried = await pressPrecondition(choiceKind === 'decline' ? declineChoiceOf(refused) : pressForOption(refused));
    expect(approveChipOf(retried)).toBeDefined();
    await approveOffer(approveChipOf(retried)!);
    expect(choiceKind === 'option' ? riskNow().relies_on : riskNow().relies_on === undefined).toEqual(choiceKind === 'option' ? { option_id: OPTION_ID } : true);
  }, 120_000);
  it.each(['option', 'decline'] as const)('FIX2c-concurrent-write-$choice RED: an ordinary non-conditional append moves the latest row before choice CAS; consent refuses with the disclosed words and current choices', async choiceKind => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const ordinary = await hiddenCard();
    const choice = choiceKind === 'decline' ? declineChoiceOf(response) : pressForOption(response);
    const before = bytes();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const pressTurn = randomUUID();
    const concurrentTurn = randomUUID();
    const originalCas = store.appendIfLatest.getMockImplementation()!;
    const attemptsBefore = conditionalAppendAttempts;
    let expectedRow: string | null | undefined;
    store.appendIfLatest.mockImplementationOnce(async (write, options) => {
      expectedRow = options.expectedLatestRowId;
      // An ordinary writer, not a competing consent/CAS request. Preserve the marked hold and graph:
      // the only changed state is the authoritative newest conversation row after the floor read.
      await store.append({ scenario_id: SCENARIO, turn_id: concurrentTurn, request_hash: 'sha256:fix2c-ordinary-concurrent-turn',
        userMessage: 'Keep thinking about the feature release.', assistantMessage: 'The release assumption is still open.',
        pending_actions: structuredClone(latestRow()!.pending_actions) });
      return originalCas(write, options);
    });
    const refused = await turn({ turn_id: pressTurn, message: choice.message, source: 'chip', chip: { id: choice.id } });
    expect(rows.get(`${SCENARIO}:${concurrentTurn}`)?.request_hash).toBe('sha256:fix2c-ordinary-concurrent-turn');
    expect(latestRow()!.id).not.toBe(expectedRow);
    expect(conditionalAppendAttempts - attemptsBefore).toBe(1);
    expect(rows.has(`${SCENARIO}:${pressTurn}`), 'no outer consent-bearing answer is written').toBe(false);
    expect([...rows.values()].filter(row => row.scenario_id === SCENARIO && row.request_hash.startsWith('agent_turn:held_choice:'))).toEqual([]);
    expect(bytes()).toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
    expect(riskNow()).toBeUndefined();
    expect((await hiddenCard()).revision).toBe(ordinary.revision);
    expect((await hiddenCard()).digest).toBe(ordinary.digest);
    expect(approveChipOf(refused)).toBeUndefined();
    expect(refused._proposal_fields).toBeUndefined();
    expect(refused.suggested_actions).toEqual(response.suggested_actions);
    expect(refused.assistant_text).toBe(FIX2C_REFUSAL);
  }, 120_000);

  it.each(['option', 'decline'] as const)('FIX2c-floor-write-%s: an ordinary append after press resolution and before the floor read preserves the marker but cannot acquire new consent authority', async choiceKind => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const choice = choiceKind === 'decline' ? declineChoiceOf(response) : pressForOption(response);
    const ordinary = await hiddenCard();
    const concurrentTurn = randomUUID();
    let floorReads = 0;
    pendingReadHook = async options => {
      if (options?.onLatestRowId === undefined || ++floorReads !== 2) return;
      await store.append({ scenario_id: SCENARIO, turn_id: concurrentTurn, request_hash: 'sha256:fix2c-before-floor',
        userMessage: 'Keep that assumption open.', assistantMessage: 'It is still open.', pending_actions: structuredClone(latestRow()!.pending_actions) });
    };
    const before = bytes();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const pressTurn = randomUUID();
    const attemptsBefore = conditionalAppendAttempts;
    const refused = await turn({ turn_id: pressTurn, message: choice.message, source: 'chip', chip: { id: choice.id } });
    pendingReadHook = undefined;
    expect(rows.has(`${SCENARIO}:${concurrentTurn}`)).toBe(true);
    expect(rows.has(`${SCENARIO}:${pressTurn}`)).toBe(false);
    expect(conditionalAppendAttempts).toBe(attemptsBefore);
    expect([...rows.values()].filter(row => row.scenario_id === SCENARIO && row.request_hash.startsWith('agent_turn:held_choice:'))).toEqual([]);
    expect(bytes()).toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
    expect((await hiddenCard()).revision).toBe(ordinary.revision);
    expect((await hiddenCard()).digest).toBe(ordinary.digest);
    expect(approveChipOf(refused)).toBeUndefined();
    expect(refused._proposal_fields).toBeUndefined();
    expect(refused.assistant_text).toBe(FIX2C_REFUSAL);
    expect(refused.suggested_actions).toEqual(response.suggested_actions);
  }, 120_000);

  it.each(['option', 'decline'] as const)('FIX2c-current-graph-%s RED: an ordinary graph-bearing append before press eligibility must re-show choices on the current graph, preserving the marked hold', async choiceKind => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const choice = choiceKind === 'decline' ? declineChoiceOf(response) : pressForOption(response);
    const graph = structuredClone(graphNow());
    const currentOptionLabel = 'Raise Pro price to £59 after reconsideration';
    graph.nodes.find(node => node.id === OPTION_ID)!.label = currentOptionLabel;
    let concurrentTurn: string | undefined;
    pendingReadHook = async options => {
      if (options?.onLatestRowId === undefined || concurrentTurn !== undefined) return;
      concurrentTurn = randomUUID();
      await store.append({ scenario_id: SCENARIO, turn_id: concurrentTurn, request_hash: 'sha256:fix2c-current-graph',
        userMessage: 'Rename that option.', assistantMessage: 'The option was renamed.', graph,
        pending_actions: structuredClone(latestRow()!.pending_actions) });
    };
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const refused = await pressPrecondition(choice);
    pendingReadHook = undefined;
    expect(concurrentTurn).toBeDefined();
    expect(bytes()).toBe(JSON.stringify(jsonbOrder(graph)));
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore + 1);
    expect(riskNow()).toBeUndefined();
    expect([...rows.values()].filter(row => row.scenario_id === SCENARIO && row.request_hash.startsWith('agent_turn:held_choice:'))).toEqual([]);
    expect(approveChipOf(refused)).toBeUndefined();
    expect(refused._proposal_fields).toBeUndefined();
    expect(refused.assistant_text).toBe(FIX2C_REFUSAL);
    expect(refused.suggested_actions.map(c => c.message)).toEqual([
      preconditionPressMessage(currentOptionLabel), preconditionPressMessage('Raise Pro price to £54'), 'It lowers ‘MRR’ for every option',
    ]);
  }, 120_000);

  it.each((['option', 'decline'] as const).flatMap(choice =>
    (['changed-marked', 'unmarked', 'absent'] as const).map(state => ({ choice, state }))))('FIX2c-stale-$choice-$state RED: trigger, ordinary latest-row append, then old press refuses; only current marked choices return', async ({ choice: choiceKind, state }) => {
    seed();
    const { response } = await offer(ordinaryArgs());
    const choice = choiceKind === 'decline' ? declineChoiceOf(response) : pressForOption(response);
    const { withRiskPreconditionChoice, withoutRiskPreconditionChoice, riskPreconditionChoiceActions } = await import('../chat-risk-precondition-choice.js');
    const current = (await store.readMostRecentPendingActions(SCENARIO))[0] as Parameters<typeof withRiskPreconditionChoice>[0];
    const next = state === 'absent' ? [] : state === 'unmarked' ? [withoutRiskPreconditionChoice(current)]
      : [withRiskPreconditionChoice({ ...current, id: randomUUID() }, graphNow(), [], PRECONDITION_OFFER_LINE)];
    const concurrentTurn = randomUUID();
    await store.append({ scenario_id: SCENARIO, turn_id: concurrentTurn, request_hash: 'sha256:fix2c-ordinary-before-press',
      userMessage: 'Revisit that held change.', assistantMessage: 'The held change was revisited.', pending_actions: next });
    const before = bytes();
    const writesBefore = graphWrites.get(SCENARIO) ?? 0;
    const refused = await pressPrecondition(choice);
    expect([...rows.values()].filter(row => row.scenario_id === SCENARIO && row.request_hash.startsWith('agent_turn:held_choice:'))).toEqual([]);
    expect(bytes()).toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(writesBefore);
    expect(riskNow()).toBeUndefined();
    expect(approveChipOf(refused)).toBeUndefined();
    expect(refused._proposal_fields).toBeUndefined();
    expect(refused.suggested_actions).toEqual(state === 'changed-marked' ? riskPreconditionChoiceActions(next[0]!, graphNow()) : []);
    expect(refused.assistant_text).toBe(FIX2C_REFUSAL);
  }, 120_000);

  it('FIX1-a RED: trigger holds the ordinary proposal but shows only the exact question and three ordered choices', async () => {
    seed();
    const before = bytes();
    const { response } = await offer(ordinaryArgs());
    expect(approveChipOf(response), 'no ordinary approve chip before a choice').toBeUndefined();
    expect(response._proposal_fields, 'no ordinary proposal card before a choice').toBeUndefined();
    expect(response.assistant_text).toBe('Your brief launches the change with the next Pro feature release, so ‘Feature release slips’ may be something one option relies on, rather than a threat to MRR for every option. Which is it?');
    expect(response.suggested_actions.map((c) => c.message)).toEqual([
      preconditionPressMessage(OPTION_LABEL), preconditionPressMessage('Raise Pro price to £54'), 'It lowers ‘MRR’ for every option',
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
    expect(refused.assistant_text).toBe(FIX2C_REFUSAL);
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
    expect(refused.assistant_text).toBe(FIX2C_REFUSAL);
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
      expect(offered.response.suggested_actions.some(c => c.label === 'It lowers ‘MRR’ for every option')).toBe(false);
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
      preconditionPressMessage(OPTION_LABEL), preconditionPressMessage('Raise Pro price to £54'), 'It lowers ‘MRR’ for every option',
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
    expect(refused.assistant_text).toBe(FIX2C_REFUSAL);
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
    expect(refused.assistant_text).toBe(FIX2C_REFUSAL);
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
          expect(response.suggested_actions.at(-1)?.label).toBe('It lowers ‘MRR’ for every option');
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
    const choice = offered.response.suggested_actions.find(c => c.label === 'It lowers ‘MRR’ for every option');
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
