/**
 * GOAL-REACH rows 0 and 2: the real Agent and scenario-read routes over an in-memory database transport.
 * The first run uses untouched agent-v1-turn.ts. The second may explicitly select the owner-facing
 * .p45 patch candidate with GOAL_REACH_ROUTE_CANDIDATE=1; that evidence is candidate-only.
 * No identity writer, action handler, proposal store, reload route or Run payload builder is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import paul from '../../orchestrator-v5/agent-lane/__tests__/fixtures/goal-reach-paul-graph-632b92b9.json';
import { SupabaseSessionStore } from '../../orchestrator-v5/session/supabase-store.js';
import { SessionLRUCache } from '../../orchestrator-v5/session/cache.js';
import type { SessionTurnWrite } from '../../orchestrator-v5/session/store.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { agentProposals } from '../../orchestrator-v5/agent-lane/held-approval-offers.js';
import { actionFactsOf } from '../../orchestrator-v5/agent-lane/actions/state.js';
import { actionBarOf } from '../../orchestrator-v5/agent-lane/actions/rank.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../orchestrator-v5/build-turn-context.js';
import { createRunAnalysisHandler } from '../../orchestrator-v5/tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../orchestrator-v5/__tests__/fixtures.js';
import * as identityCard from '../../orchestrator-v5/agent-lane/identity-card.js';
import * as systemEvents from '../../orchestrator-v5/system-events/dispatch.js';

const { port, source } = vi.hoisted(() => ({
  port: { append: vi.fn(), readRecent: vi.fn(), readLatestAnswerOffers: vi.fn(), readCommittedTurn: vi.fn(), readGuidanceHistory: vi.fn(),
    ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), scenarioExists: vi.fn(), readExistingScenario: vi.fn(), isScenarioMember: vi.fn(),
    readMostRecentPendingActions: vi.fn(), loadGraph: vi.fn(), loadGraphAndBriefText: vi.fn(), readFactsFor: vi.fn(), readFactsWithTurnFor: vi.fn(),
    invalidateScoped: vi.fn(), invalidateAll: vi.fn(), claimTurnFence: vi.fn() },
  source: { graph: {} as Record<string, any>, analysis: {} as Record<string, unknown> },
}));
vi.mock('../../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => port, resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../config/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false },
    cee: { ...actual.config.cee, modelVersionsEnabled: false },
    proxy: { ...actual.config.proxy, agentLaneEnabled: true, agentLanePreview: false } } };
});
vi.mock('../../orchestrator/user-identity.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'verified', userId: OWNER }),
}));
vi.mock('../scenario-graph-analysis-read.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), readScenarioAnalysis: async () => source.analysis,
}));
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, key) => String(key) }),
}));
import scenarioGraphRoute from '../assist.v1.scenario-graph.js';

const OWNER = '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b';
const AT = '2026-10-08T08:00:00.000Z';
const READY = { status: 'ready', may_run: true };
const WORDS = 'Olumi reads ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’. Is that how you work it out?';
const hashOf = (graph: unknown) => computeAnalysisAffectingGraphHash(graph as never)!;
let app: FastifyInstance;
let serial = 0;
let scenario: string;
let table: Record<string, any>[];
let realStore: SupabaseSessionStore;
let modelCalls: number;
let graphWrites: number;
let fenceGenerations: Map<string, number>;
let runRequests: Record<string, any>[];
const client = {
  from: () => {
    let columns: string[] = []; let cap = Infinity;
    const checks: ((row: Record<string, any>) => boolean)[] = [];
    const orders: { key: string; ascending: boolean }[] = [];
    const chain = {
      select: (s: string) => { columns = s.split(',').map(c => c.trim()); return chain; },
      eq: (k: string, v: unknown) => { checks.push(row => row[k] === v); return chain; },
      is: (k: string, v: unknown) => { checks.push(row => row[k] === v); return chain; },
      like: (k: string, v: string) => { checks.push(row => String(row[k]).startsWith(v.slice(0, -1))); return chain; },
      not: (k: string, op: string, v: unknown) => { checks.push(row => op === 'like' ? !String(row[k]).endsWith(String(v).slice(1)) : row[k] !== v); return chain; },
      update: () => chain, order: (key: string, options: { ascending: boolean }) => { orders.push({ key, ...options }); return chain; },
      abortSignal: () => chain, limit: (n: number) => { cap = n; return chain; },
      then: (resolve: (v: unknown) => void) => resolve({ data: table.filter(row => checks.every(check => check(row)))
        .sort((a, b) => { for (const o of orders) { const cmp = String(a[o.key]).localeCompare(String(b[o.key])); if (cmp) return o.ascending ? cmp : -cmp; } return 0; })
        .slice(0, cap).map(row => Object.fromEntries(columns.map(c => [c, row[c]]))), error: null }),
    };
    return chain;
  },
  rpc: async (name: string, args: Record<string, any>) => {
    // Harness correction after the capped second run (UNVERIFIED): the real append enforces
    // the in-process door's fence, so its claim must land through this same fake DB transport.
    if (name === 'v5_claim_turn_fence') {
      const key = `${args.p_scenario_id}/${args.p_turn_id}`;
      if (!fenceGenerations.has(key)) fenceGenerations.set(key, fenceGenerations.size + 1);
      return { data: fenceGenerations.get(key), error: null };
    }
    const prior = table.find(r => r.scenario_id === args.p_scenario_id && r.turn_id === args.p_turn_id);
    const id = prior?.id ?? `11111111-1111-4111-8111-${String(table.length + 1).padStart(12, '0')}`;
    if (!prior) {
      table.unshift({ id, scenario_id: args.p_scenario_id, user_id: OWNER, turn_id: args.p_turn_id, turn_class: args.p_turn_class,
        handler_id: args.p_handler_id, request_hash: args.p_request_hash, response_emitted: args.p_response_emitted,
        llm_calls_used: args.p_llm_calls_used, duration_ms: args.p_duration_ms,
        created_at: new Date(Date.parse(AT) + table.length * 1000).toISOString(),
        user_message: args.p_user_message, assistant_message: args.p_assistant_message, handler_facts: args.p_handler_facts,
        pending_actions: args.p_pending_actions, coaching_state: args.p_coaching_state,
        agent_guidance: args.p_agent_guidance ?? null, suggested_actions: args.p_suggested_actions ?? null,
        suggested_actions_run_key: args.p_suggested_actions_run_key ?? null });
      if (args.p_graph !== null && args.p_graph !== undefined) { source.graph = structuredClone(args.p_graph); graphWrites += 1; }
    }
    return { data: name === 'append_agent_answer_with_offers' || name === 'append_agent_answer_with_guidance'
      ? { id, replayed_prior_turn: !!prior && prior.request_hash === args.p_request_hash,
        prior_turn_conflict: !!prior && prior.request_hash !== args.p_request_hash } : id, error: null };
  },
};
function setWithheld(graph: Record<string, any> = structuredClone(paul)): void {
  source.graph = graph;
  const result = { type: 'analysis_result', computed_against_hash: hashOf(graph), data: {}, enrichment: {
    inference_warnings: [{ code: 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', message: "Olumi reads MRR as a product that hasn't been confirmed." }],
  } };
  source.analysis = { analysis_state: { run_state: { kind: 'complete_current', computed_at: AT }, usable_for_chips: true,
    leader_claim: { permitted: false, withheld_reason: 'run_identity_unconfirmed' } },
    analysis_result: result, current_read: { analysis_ready: READY, result }, analysis_constraint_verdict_state: null };
}
function bindStore(): void {
  realStore = new SupabaseSessionStore(client as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 50 }), { defaultReadLimit: 20 });
  port.append.mockImplementation((w: SessionTurnWrite) => realStore.append(w));
  port.claimTurnFence.mockImplementation((s: string, t: string) => realStore.claimTurnFence(s, t));
  port.readRecent.mockImplementation((s: string, n?: number) => realStore.readRecent(s, n));
  port.readCommittedTurn.mockImplementation((s: string, t: string) => realStore.readCommittedTurn(s, t));
  port.readLatestAnswerOffers.mockImplementation((s: string) => realStore.readLatestAnswerOffers(s));
  port.readGuidanceHistory.mockImplementation((s: string) => realStore.readGuidanceHistory(s));
  port.readMostRecentPendingActions.mockImplementation((s: string) => realStore.readMostRecentPendingActions(s, { validation: 'strict' }));
  port.loadGraph.mockImplementation(async () => structuredClone(source.graph));
  port.loadGraphAndBriefText.mockImplementation(async () => ({ graph: structuredClone(source.graph), briefText: null }));
  port.readExistingScenario.mockImplementation(async () => ({ userId: OWNER, graph: structuredClone(source.graph), briefText: null, analysisInvalidatedAt: null }));
  const factOf = (raw: { payload: Record<string, unknown>; noop: boolean }) => ({ ...raw.payload, noop: raw.noop });
  port.readFactsFor.mockImplementation(async () => table.flatMap(row => (row.handler_facts ?? []).map(factOf)));
  port.readFactsWithTurnFor.mockImplementation(async (ids: readonly string[]) => table.filter(row => ids.includes(row.id))
    .flatMap(row => (row.handler_facts ?? []).map((raw: { payload: Record<string, unknown>; noop: boolean }) => ({ turn_id: row.id, fact_created_at: AT, fact: factOf(raw) }))));
  port.invalidateScoped.mockResolvedValue({ scope: { kind: 'structural' }, entries_invalidated: [] });
  port.invalidateAll.mockResolvedValue({ scope: { kind: 'structural' }, entries_invalidated: [] });
}
beforeEach(async () => {
  vi.clearAllMocks(); serial += 1; scenario = `6f1e2d3c-4b5a-4e6d-9c7b-${String(serial).padStart(12, '0')}`;
  table = []; fenceGenerations = new Map(); runRequests = []; modelCalls = 0; graphWrites = 0; setWithheld(); bindStore();
  port.ensureScenarioExists.mockResolvedValue({ user_id: OWNER }); port.getScenarioOwner.mockResolvedValue(OWNER);
  port.scenarioExists.mockResolvedValue(true); port.isScenarioMember.mockResolvedValue(false);
  vi.stubGlobal('fetch', vi.fn(async () => { modelCalls += 1; throw new Error('GOAL-REACH must not call an LLM'); }));
  app = Fastify({ logger: false }); await scenarioGraphRoute(app);
  // Only the analysis transport is fixed locally. The real run_analysis capability must
  // derive identity_card.available from Paul's stored graph, never from this response.
  app.post('/orchestrate/v2/turn', async req => {
    runRequests.push(req.body as Record<string, any>);
    return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
      graph_hash: hashOf(source.graph), blocks: [source.analysis.analysis_result],
      analysis_ready: READY, analysis_state: source.analysis.analysis_state };
  });
  const route = process.env.GOAL_REACH_ROUTE_CANDIDATE === '1'
    ? await import('../../../.p45/goal-reach-agent-v1-turn.candidate.ts')
    : await import('../agent-v1-turn.js');
  await app.register(route.agentV1TurnRoute); await app.ready();
});
afterEach(async () => { await app?.close(); vi.unstubAllGlobals(); for (const p of agentProposals.outstanding(scenario, OWNER)) agentProposals.discard(p.proposal_id); });
type Offer = { action_id: string; enabled: boolean; press_id: string; offer_key: string; user_line: string; why_now?: string };
type Bar = { priority: Offer[]; standard: Offer[]; more: Offer[] };
const offersOf = (bar: Bar) => [...bar.priority, ...bar.standard, ...bar.more];
async function reload(): Promise<Record<string, any>> {
  const response = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${scenario}/graph`, payload: { include_conversation_turns: true } });
  expect(response.statusCode, response.body).toBe(200); return response.json();
}
let turnSerial = 0;
async function press(id: string, message: string, parameters?: Record<string, unknown>): Promise<Record<string, any>> {
  turnSerial += 1;
  const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: scenario,
    turn_id: `aaaaaaa1-aaaa-4aaa-8aaa-${String(turnSerial).padStart(12, '0')}`, message, source: 'chip', chip: { id, ...(parameters ? { parameters } : {}) } } });
  expect(response.statusCode, response.body).toBe(200); return response.json();
}
async function assertDoorThenNextRun(card: Record<string, any>, tools = ['propose_identity']): Promise<void> {
  expect(card._agent?.tool_calls?.map((call: { name: string }) => call.name)).toEqual(tools);
  const approve = card.suggested_actions.find((a: { id: string }) => a.id.startsWith('agent-approve-proposal:'));
  expect(approve, 'press must expose the held identity card').toBeDefined();
  expect(approve.detail).toBe(WORDS); expect(graphWrites).toBe(0);
  const held = agentProposals.get(approve.id.slice('agent-approve-proposal:'.length));
  expect(held?.operations).toEqual([expect.objectContaining({ op: 'confirm_identity', path: 'mrr', value: expect.objectContaining({
    factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], words: WORDS,
  }) })]);
  const yes = await press(approve.id, approve.message);
  expect(yes._agent?.tool_calls?.map((call: { name: string }) => call.name)).toEqual(['authorise_change']);
  expect(graphWrites, `identity Yes response: ${JSON.stringify(yes)}`).toBe(1);
  expect(source.graph.nodes.find((n: { id: string }) => n.id === 'mrr').nonlinear_identity).toEqual({
    operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: true,
  });
  const freshFacts = actionFactsOf({ scenarioId: scenario, graph: source.graph, graphHash: hashOf(source.graph),
    analysisState: source.analysis.analysis_state, analysisResult: source.analysis.analysis_result, analysisReady: READY });
  expect(offersOf(actionBarOf(freshFacts)).filter(o => o.action_id === 'confirm_reading')).toEqual([]);
  bindStore(); // cold session cache, same committed database bytes
  const cold = await reload();
  expect(cold.graph.nodes.find((n: { id: string }) => n.id === 'mrr').nonlinear_identity.stated_in_brief).toBe(true);
  expect(offersOf(cold.action_bar).filter(o => o.action_id === 'confirm_reading')).toEqual([]);

  // NEXT Run's production snapshot loader + final createRunAnalysisHandler payload builder, whose
  // graph pipeline includes carryUnconfirmedGoalProduct. Probe observes the actual final PLoT payload.
  const snapshot = await loadScenarioSnapshotForRunAnalysis(scenario, 'req-goal-reach-next-run', port as never);
  let wire: Record<string, any> | undefined;
  const plotRun = vi.fn();
  const handler = createRunAnalysisHandler({ plotClient: { run: plotRun, validatePatch: vi.fn() } as never,
    scenarioReader: async () => snapshot, probe: async sent => { wire = sent.plotPayload; } });
  await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
    session_id: scenario, request_id: 'req-goal-reach-next-run', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 },
    prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-goal-reach-next-run', scenario_id: scenario, message: 'Run analysis.', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-goal-reach-next-run', signal: new AbortController().signal, orientationText: '' } as never);
  expect(wire, 'createRunAnalysisHandler must build the next Run payload').toBeDefined();
  expect(wire!.graph.nodes.find((n: { id: string }) => n.id === 'mrr').nonlinear_identity).toEqual({
    operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: true,
  });
  expect(plotRun).not.toHaveBeenCalled(); expect(modelCalls).toBe(0);
}

describe('GOAL-REACH row 2 through the real doors', () => {
  it('row 0 (reply path, no packet): Run reply → identity approval chip → Yes → saved/reloaded identity → NEXT Run wire', async () => {
    expect(process.env.GOAL_REACH_ROUTE_CANDIDATE, 'row 0 uses the untouched route, without the owner packet').not.toBe('1');
    // Call-through spies witness the production hint and identity_confirm door; neither is stubbed.
    const issue = vi.spyOn(identityCard, 'identityCardToIssue');
    const writer = vi.spyOn(systemEvents, 'commitOptionLevelsInProcess');
    try {
      turnSerial += 1;
      const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
        kind: 'message', scenario_id: scenario, turn_id: `aaaaaaa1-aaaa-4aaa-8aaa-${String(turnSerial).padStart(12, '0')}`,
        message: 'Run analysis.', source: 'chip', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' },
      } });
      expect(response.statusCode, response.body).toBe(200);
      const card = response.json();
      expect(card._diagnostic_trace?.fast_path).toBe('run');
      expect(runRequests).toHaveLength(1);
      expect(runRequests[0]).toMatchObject({ stage: 'analyse', chip: { action_type: 'run_analysis' } });
      expect(issue).toHaveBeenCalledWith(
        [expect.objectContaining({ name: 'run_analysis', ok: true, mutated: false })],
        [expect.objectContaining({ ran: true, identity_card: expect.objectContaining({ available: true }) })],
      );
      const approvals = card.suggested_actions.filter((a: { id: string }) => a.id.startsWith('agent-approve-proposal:'));
      expect(approvals).toHaveLength(1);
      expect(approvals[0]).toMatchObject({ label: "Yes, that's how", detail: WORDS });
      await assertDoorThenNextRun(card, ['run_analysis', 'propose_identity']);
      expect(writer).toHaveBeenCalledTimes(1);
      expect(writer.mock.calls[0]![0]).toMatchObject({ identity_confirm: {
        outcome_id: 'mrr', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], words: WORDS,
      } });
      expect(runRequests, 'Yes records the reading without running analysis').toHaveLength(1);
      expect(modelCalls, 'the Run reply and approval press use zero LLM calls').toBe(0);
    } finally { issue.mockRestore(); writer.mockRestore(); }
  });
  it('row 2 RED: withheld Run bar has one enabled confirm_reading, press → held card → Yes → saved/reloaded identity → NEXT Run wire', async () => {
    const cold = await reload();
    const reading = offersOf(cold.action_bar).filter(o => o.action_id === 'confirm_reading');
    expect(reading).toHaveLength(1); expect(reading[0]!.enabled).toBe(true);
    expect(reading[0]!.why_now).toContain('MRR');
    const card = await press(reading[0]!.press_id, reading[0]!.user_line, { offer_key: reading[0]!.offer_key });
    expect(card._action).toMatchObject({ action_id: 'confirm_reading', outcome: 'ran' });
    await assertDoorThenNextRun(card);
  });
  it('row 2 real-door RED: confirm_reading press reaches propose_identity with zero LLM calls', async () => {
    await assertDoorThenNextRun(await press('act:confirm_reading', 'Check how Olumi works out the goal.'));
  });
  it('row 2 CONTROL: already-confirmed product offers no confirm_reading on reload', async () => {
    const graph = structuredClone(paul); graph.nodes.find(n => n.id === 'mrr')!.nonlinear_identity!.stated_in_brief = true;
    setWithheld(graph);
    expect(offersOf((await reload()).action_bar).filter(o => o.action_id === 'confirm_reading')).toEqual([]);
    expect(graphWrites).toBe(0); expect(modelCalls).toBe(0);
  });
  it('condition 5 CONTROL: an unwritable identity base offers no unreachable confirm_reading', async () => {
    const graph = structuredClone(paul); graph.edges.find(e => e.to === 'mrr')!.strength.mean = 2.31;
    setWithheld(graph);
    expect(offersOf((await reload()).action_bar).filter(o => o.action_id === 'confirm_reading')).toEqual([]);
    expect(graphWrites).toBe(0); expect(modelCalls).toBe(0);
  });
});
