/**
 * ⭐ S-B THROUGH THE REAL ROUTES (lane ACTION-BAR-CEE; github-a2 contract amendments 1–11 + v1.1; ACTION-SYSTEM-DRAFT §E).
 * The real Agent turn route and the real scenario-graph (reload) route, the real session store over a fake database
 * transport (the X4 harness), and a counted provider `fetch`. Only the canonical analysis read is fixed locally.
 *
 *  · every registry press reaches its typed path, never the free Agent turn (pre-Run, withheld Run, licensed Run);
 *  · every turn carries `action_bar` v1; every action turn carries its `_action` receipt;
 *  · the reload GET's bar === the live turn's bar, byte for byte, on an unchanged state; a changed state moves state_key;
 *  · a press after an edit is re-derived: still valid → runs; precondition gone → typed "can't yet" + a working exit;
 *  · the same offer pressed twice prepares ONE card;
 *  · three bars captured from these turns are the committed fixtures DGAI binds to (amendment 11).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync, writeFileSync } from 'node:fs';
import type { SessionTurnWrite } from '../../orchestrator-v5/session/store.js';
import { SupabaseSessionStore } from '../../orchestrator-v5/session/supabase-store.js';
import { SessionLRUCache } from '../../orchestrator-v5/session/cache.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { agentProposals } from '../../orchestrator-v5/agent-lane/held-approval-offers.js';
import served from '../../orchestrator-v5/agent-lane/__tests__/fixtures/m1-s1-served-graphs.json';
import { chanceGoalDeadlineAsk } from '../../orchestrator-v5/goal-target/goal-kind.js';
import { composeGoalTargetQuestion } from '../../orchestrator-v5/goal-target/decide-goal-target-ask.js';
import { ACTION_REGISTRY } from '../../orchestrator-v5/agent-lane/actions/registry.js';
import { SUGGEST_RISKS_CHIP } from '../../orchestrator-v5/agent-lane/method-turn/widen-turn.js';
import type { PendingAction } from '../../orchestrator-v5/session/pending-action.js';
import { estimateGraph, estimateLicence } from '../../orchestrator-v5/agent-lane/actions/__tests__/estimate-fixture.js';
import { resolveDskClaimProvenance } from '../../orchestrator-v5/compose/dsk-claim-record.js';
import { actionFactsOf, estimatePointsOf } from '../../orchestrator-v5/agent-lane/actions/state.js';

const { port, source, identity, logs } = vi.hoisted(() => ({
  port: { append: vi.fn(), readRecent: vi.fn(), readLatestAnswerOffers: vi.fn(), readCommittedTurn: vi.fn(), readGuidanceHistory: vi.fn(),
    ensureScenarioExists: vi.fn(), getScenarioOwner: vi.fn(), scenarioExists: vi.fn(),
    readExistingScenario: vi.fn(), isScenarioMember: vi.fn(), readMostRecentPendingActions: vi.fn() },
  source: { analysis: {} as Record<string, unknown>, graph: {} as unknown },
  identity: { userId: '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b' },
  logs: [] as Record<string, unknown>[],
}));
vi.mock('../../orchestrator-v5/session/index.js', () => ({ getSessionStore: () => port }));
vi.mock('../../config/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false },
    proxy: { ...actual.config.proxy, agentLaneEnabled: true, agentLanePreview: false } } };
});
vi.mock('../../orchestrator/user-identity.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'verified', userId: identity.userId }),
}));
vi.mock('../scenario-graph-analysis-read.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), readScenarioAnalysis: async () => source.analysis,
}));
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn((o: unknown) => { logs.push(o as Record<string, unknown>); }), warn: vi.fn((o: unknown) => { logs.push(o as Record<string, unknown>); }),
    error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, key) => String(key) }) }));

import scenarioGraphRoute from '../assist.v1.scenario-graph.js';
import { agentV1TurnRoute } from '../agent-v1-turn.js';

const OWNER = identity.userId;
const D1 = served.cases.find((c) => c.id === 'D1-sprint-run')!;
const D3 = served.cases.find((c) => c.id === 'D3-cost-run')!;
const AT = '2026-10-07T12:00:00.000Z';
const READY = { status: 'ready', may_run: true };
const PARTICIPATION = [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }];
const FIXTURES = new URL('../../orchestrator-v5/agent-lane/actions/__tests__/fixtures/', import.meta.url);
const hashOf = (g: unknown) => computeAnalysisAffectingGraphHash(g as never)!;

type State = 'pre_run' | 'withheld' | 'licensed' | 'stale';
function setState(state: State, graph: unknown = state === 'licensed' ? D3.graph : D1.graph): void {
  source.graph = graph;
  const h = hashOf(graph);
  // The licensed Run measured one fragile link (the review's F5 row), so its bar carries a target-bearing Test link offer.
  const result = state === 'licensed'
    ? { type: 'analysis_result', computed_against_hash: h, data: {}, enrichment: { robustness: { fragile_edges: [{ from_id: 'gcp_workload_share', to_id: 'monthly_cloud_savings' }] } } }
    : { type: 'analysis_result', computed_against_hash: h, data: {} };
  const ready = state === 'licensed' ? { ...READY, analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } } : READY;
  const claim = state === 'licensed' ? { permitted: true, separation: 'separated' } : { permitted: false, withheld_reason: 'goal_path_unsized' };
  source.analysis = state === 'pre_run'
    ? { analysis_state: null, analysis_result: null, current_read: { analysis_ready: ready }, analysis_constraint_verdict_state: null }
    : { analysis_state: { run_state: { kind: state === 'stale' ? 'complete_stale' : 'complete_current', computed_at: AT },
      usable_for_chips: state !== 'stale', leader_claim: claim },
      analysis_result: result, current_read: { analysis_ready: ready, result }, analysis_constraint_verdict_state: null,
      ...(state === 'licensed' ? {} : { analysis_option_participation: PARTICIPATION }) };
  port.readExistingScenario.mockResolvedValue({ userId: OWNER, graph: source.graph, briefText: 'Which sprint plan?', analysisInvalidatedAt: null });
}

let serial = 0;
let scenario: string;
let table: Record<string, unknown>[];
let app: FastifyInstance;
let modelCalls = 0;
let realStore: SupabaseSessionStore;
const client = {
  from: () => {
    let columns: string[] = []; let cap = Infinity;
    const checks: ((row: Record<string, unknown>) => boolean)[] = [];
    const orders: { key: string; ascending: boolean }[] = [];
    const chain = {
      select: (s: string) => { columns = s.split(',').map(c => c.trim()); return chain; },
      eq: (k: string, v: unknown) => { checks.push(row => row[k] === v); return chain; },
      is: (k: string, v: unknown) => { checks.push(row => row[k] === v); return chain; },
      like: (k: string, v: string) => { checks.push(row => String(row[k]).startsWith(v.slice(0, -1))); return chain; },
      not: (k: string, op: string, v: unknown) => { checks.push(row => op === 'like' ? !String(row[k]).endsWith(String(v).slice(1)) : row[k] !== v); return chain; },
      order: (key: string, options: { ascending: boolean }) => { orders.push({ key, ...options }); return chain; },
      abortSignal: () => chain,
      limit: (n: number) => { cap = n; return chain; },
      then: (resolve: (v: unknown) => void) => resolve({ data: table.filter(row => checks.every(check => check(row)))
        .sort((a, b) => { for (const o of orders) { const cmp = String(a[o.key]).localeCompare(String(b[o.key])); if (cmp) return o.ascending ? cmp : -cmp; } return 0; })
        .slice(0, cap).map(row => Object.fromEntries(columns.map(c => [c, row[c]]))), error: null }),
    };
    return chain;
  },
  rpc: async (name: string, args: Record<string, unknown>) => {
    const prior = table.find(r => r.scenario_id === args.p_scenario_id && r.turn_id === args.p_turn_id);
    const id = prior?.id ?? `11111111-1111-4111-8111-${String(table.length + 1).padStart(12, '0')}`;
    if (!prior) table.unshift({ id, scenario_id: args.p_scenario_id, user_id: OWNER, turn_id: args.p_turn_id, turn_class: args.p_turn_class,
      handler_id: args.p_handler_id, request_hash: args.p_request_hash, response_emitted: args.p_response_emitted,
      llm_calls_used: args.p_llm_calls_used, duration_ms: args.p_duration_ms,
      created_at: new Date(Date.parse(AT) + table.length * 1000).toISOString(),
      user_message: args.p_user_message, assistant_message: args.p_assistant_message,
      pending_actions: args.p_pending_actions, coaching_state: args.p_coaching_state,
      agent_guidance: args.p_agent_guidance ?? null, suggested_actions: args.p_suggested_actions ?? null,
      suggested_actions_run_key: args.p_suggested_actions_run_key ?? null });
    return { data: name === 'append_agent_answer_with_offers' || name === 'append_agent_answer_with_guidance'
      ? { id, replayed_prior_turn: !!prior && prior.request_hash === args.p_request_hash,
        prior_turn_conflict: !!prior && prior.request_hash !== args.p_request_hash } : id, error: null };
  },
};
const coldStore = () => {
  realStore = new SupabaseSessionStore(client as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 50 }), { defaultReadLimit: 20 });
  port.append.mockImplementation((w: SessionTurnWrite) => realStore.append(w));
  port.readRecent.mockImplementation((s: string, n?: number) => realStore.readRecent(s, n));
  port.readCommittedTurn.mockImplementation((s: string, t: string) => realStore.readCommittedTurn(s, t));
  port.readLatestAnswerOffers.mockImplementation((s: string) => realStore.readLatestAnswerOffers(s));
  port.readGuidanceHistory.mockImplementation((s: string) => realStore.readGuidanceHistory(s));
  port.readMostRecentPendingActions.mockImplementation((s: string) => realStore.readMostRecentPendingActions(s, { validation: 'strict' }));
};

beforeEach(async () => {
  vi.clearAllMocks(); serial += 1; scenario = `6f1e2d3c-4b5a-4e6d-9c7b-${String(serial).padStart(12, '0')}`;
  table = []; logs.length = 0; modelCalls = 0; identity.userId = OWNER;
  setState('pre_run');
  coldStore();
  port.ensureScenarioExists.mockResolvedValue({ user_id: OWNER }); port.getScenarioOwner.mockResolvedValue(OWNER);
  port.scenarioExists.mockResolvedValue(true); port.isScenarioMember.mockResolvedValue(false);
  vi.stubGlobal('fetch', vi.fn(async () => {
    modelCalls += 1;
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, the link matters.' }] }] }), { status: 200 });
  }));
  app = Fastify({ logger: false });
  await scenarioGraphRoute(app); await app.register(agentV1TurnRoute); await app.ready();
});
afterEach(async () => {
  await app.close(); vi.unstubAllGlobals();
  for (const p of agentProposals.outstanding(scenario, OWNER)) agentProposals.discard(p.proposal_id);
});

type Offer = { action_id: string; press_id: string; enabled: boolean; offer_key: string; label: string; disabled_reason?: string; why_now?: string };
type Bar = { v: number; state_key: string; revision: { graph_hash: string | null; run_key: string | null }; priority: Offer[]; standard: Offer[]; more: Offer[] };
type Body = { assistant_text: string; suggested_actions: { id: string; label: string; message: string }[]; action_bar?: Bar;
  _action?: Record<string, unknown>; _agent?: { tool_calls?: { name: string; proposal_id?: string }[] }; _diagnostic_trace?: { fast_path?: string } };
let turnSerial = 0;
const turn = async (payload: Record<string, unknown>): Promise<Body> => {
  turnSerial += 1;
  const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', scenario_id: scenario, turn_id: `aaaaaaa1-aaaa-4aaa-8aaa-${String(turnSerial).padStart(12, '0')}`, ...payload } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Body;
};
// A bar press carries its offer's user_line as the visible message (DGAI sends exactly that); WIDEN's shared risks id
// is told apart by it (SR-5). Ids the registry does not map keep a neutral message.
const USER_LINE_BY_PRESS = new Map(Object.values(ACTION_REGISTRY).flatMap((e) => (e.press.kind === 'fixed' ? [[e.press.id, e.user_line] as const] : [])));
const press = (id: string, extra: Record<string, unknown> = {}) => turn({ message: USER_LINE_BY_PRESS.get(id) ?? 'pressed', source: 'chip', chip: { id, ...extra } });
const reload = async (): Promise<{ action_bar?: Bar }> => {
  const r = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${scenario}/graph`, payload: { include_conversation_turns: true } });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
};
const offersOf = (b: Bar) => [...b.priority, ...b.standard, ...b.more];
const PRESS_IDS = ['agent-next-review-decision', 'agent-next-what-would-change', 'agent-next-strengthen', 'agent-next-pre-mortem', 'agent-next-widen',
  'act:frame_brief', 'act:set_goal', 'act:set_deadline', SUGGEST_RISKS_CHIP.id, 'act:bias_anchoring', 'act:check_estimates',
  'agent-test-without-link:["sprint_capacity_for_ai_reporting","ai_reporting_module_availability"]', 'act:no_such_action'];

describe('every press reaches its typed path, never the free Agent turn', () => {
  it.each(['pre_run', 'withheld', 'stale'] as const)('RED (%s): all registry presses + an unknown act: id → a typed fast path; 0 free Agent turns', async (state) => {
    setState(state);
    const free: string[] = [];
    const receipts: unknown[] = [];
    for (const id of PRESS_IDS) {
      const b = await press(id);
      if (b._diagnostic_trace?.fast_path === undefined) free.push(id);
      receipts.push(b._action);
    }
    expect(free, 'presses that fell to the free Agent turn').toEqual([]);
    expect(receipts).toEqual(PRESS_IDS.map((id) => expect.objectContaining({ v: 1, press_id: id })));
    // The log class: every press is dispatched and logged; none is answered by the ordinary loop.
    expect(logs.filter((l) => l.event === 'agent_lane.action_press').length).toBeGreaterThanOrEqual(PRESS_IDS.length);
  });
  it('RED: a press with an unexpected action_type (no typed path takes it) is still answered typed, with no model call', async () => {
    setState('withheld');
    const b = await press('agent-next-review-decision', { action_type: 'something_else' });
    expect(b._diagnostic_trace?.fast_path).toBe('method');
    expect(modelCalls).toBe(0);
    expect(b._action).toMatchObject({ action_id: 'review', outcome: 'cant_yet' });
  });
  it('RED (Codex r1 P1-2): an act: press carrying a Run action_type is dispatched by its id, never run', async () => {
    setState('withheld');
    const b = await press('act:no_such_action', { action_type: 'run_analysis' });
    expect(b._diagnostic_trace?.fast_path).toBe('method');
    expect(b._agent?.tool_calls ?? []).toEqual([]);
    expect(b._action).toMatchObject({ press_id: 'act:no_such_action', outcome: 'cant_yet', reason: 'unknown_action' });
  });
  it('RED (Codex r1 P2-3): a retried Review press on a stale Run replays the typed "can\'t yet" and its Run exit', async () => {
    setState('stale');
    const payload = { kind: 'message', scenario_id: scenario, turn_id: 'bbbbbbb1-bbbb-4bbb-8bbb-bbbbbbbbbbb1', message: 'pressed', source: 'chip', chip: { id: 'agent-next-review-decision' } };
    const first = (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload })).json() as Body;
    const again = (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload })).json() as Body;
    expect(first.assistant_text).toBe('I can’t review this decision yet: it needs a current analysis first.');
    expect(again.assistant_text).toBe(first.assistant_text);
    expect(again.suggested_actions.map((a) => a.id)).toEqual(['agent-run-analysis']);
  });
  it('CONTROL: a typed message and an ask:* chip are still ordinary Agent turns (ask:* is out of scope)', async () => {
    const typed = await turn({ message: 'What do you make of this?' });
    expect(typed._diagnostic_trace?.fast_path).toBeUndefined();
    expect(typed._action).toBeUndefined();
    const asked = await press('ask:method-reframe');
    expect(asked._diagnostic_trace?.fast_path).toBeUndefined();
    expect(asked._action).toBeUndefined();
  });
});

describe('a press is re-derived on the current state (amendment 6)', () => {
  it('RED: Strengthen pressed after an edit made the Run stale → typed "can\'t yet", the Run as its exit, 0 model calls', async () => {
    setState('withheld');
    const before = await turn({ message: 'Where are we?' });
    const offer = offersOf(before.action_bar!).find((o) => o.action_id === 'strengthen')!;
    expect(offer.enabled).toBe(true);
    setState('stale');
    modelCalls = 0;
    const b = await press(offer.press_id, { parameters: { offer_key: offer.offer_key } });
    expect(modelCalls).toBe(0);
    expect(b.assistant_text).toBe('I can’t strengthen the model yet: it needs a current analysis first.');
    expect(b.suggested_actions.map((a) => a.id)).toEqual(['agent-run-analysis']);
    expect(b._action).toMatchObject({ action_id: 'strengthen', offer_key: offer.offer_key, outcome: 'cant_yet', reason: 'needs_current_analysis' });
  });
  it('CONTROL: a stale offer_key whose action still holds runs on the current state (Pre-mortem offered pre-Run, pressed on a Run)', async () => {
    const before = await turn({ message: 'Where are we?' });
    const offer = offersOf(before.action_bar!).find((o) => o.action_id === 'pre_mortem')!;
    setState('withheld');
    const b = await press(offer.press_id, { parameters: { offer_key: offer.offer_key } });
    expect(b._diagnostic_trace?.fast_path).toBe('method');
    expect(b._action).toMatchObject({ action_id: 'pre_mortem', outcome: 'ran' });
  });
});

describe('the same offer pressed twice prepares ONE card (amendment 6)', () => {
  it('RED: Strengthen twice under the same offer_key → one held proposal; the second press re-offers it with no tool call', async () => {
    setState('withheld');
    const bar = (await turn({ message: 'Where are we?' })).action_bar!;
    const offer = offersOf(bar).find((o) => o.action_id === 'strengthen')!;
    const first = await press(offer.press_id, { parameters: { offer_key: offer.offer_key } });
    expect(first._agent?.tool_calls?.map((c) => c.name)).toEqual(['propose_link_strengths']);
    const approve = first.suggested_actions.find((a) => a.id.startsWith('agent-approve-proposal:'))!;
    const second = await press(offer.press_id, { parameters: { offer_key: offer.offer_key } });
    expect(second._agent?.tool_calls ?? []).toEqual([]);
    expect(second.suggested_actions.map((a) => a.id)).toEqual([approve.id, 'agent-amend-proposal']);
    expect(agentProposals.outstanding(scenario, OWNER).length).toBe(1);
    expect(second._action).toMatchObject({ outcome: 'ran', reason: 'already_waiting' });
  });
});

describe('action_bar v1 on every turn, and the reload derives the same bar (amendment 9)', () => {
  it.each(['pre_run', 'withheld', 'licensed'] as const)('RED (%s): live turn bar === reload GET bar, byte for byte', async (state) => {
    setState(state);
    const live = await turn({ message: 'Where are we?' });
    expect(live.action_bar?.v).toBe(1);
    // Precondition: the bar was derived from the model, not from an unread state (a bar of nothing would compare equal too).
    expect(live.action_bar!.revision.graph_hash).toBe(hashOf(source.graph));
    expect(live.action_bar!.revision.run_key === null).toBe(state === 'pre_run');
    coldStore();
    const again = await reload();
    expect(JSON.stringify(again.action_bar)).toBe(JSON.stringify(live.action_bar));
  });
  it('RED (Codex r1 P2-4): live === reload also when this answer pushes an older guidance event out of the history window', async () => {
    // One own option besides doing nothing: RC-WIDEN W2 ranks More options into priority unless pressed at this state.
    const g = structuredClone(D3.graph) as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
    g.nodes = g.nodes.filter((n) => n.kind !== 'option' || n.id === 'switch_to_gcp' || n.id === 'stay_on_aws');
    g.edges = g.edges.filter((e) => g.nodes.some((n) => n.id === e.from) && g.nodes.some((n) => n.id === e.to));
    setState('pre_run', g);
    const facts = actionFactsOf({ scenarioId: scenario, graph: g, graphHash: hashOf(g), analysisReady: READY });
    const widen = facts.rcRows.find((r) => r.policy_id === 'RC-WIDEN')!;
    expect(widen, 'precondition: RC-WIDEN holds on this state').toBeDefined();
    // 20 answer rows: the OLDEST presses RC-WIDEN at this state; 19 newer carry another policy's event.
    const row = (i: number, entries: Record<string, unknown>) => ({ id: `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`, scenario_id: scenario,
      user_id: OWNER, turn_id: `seed-${i}`, turn_class: 'direct_answer', handler_id: null, request_hash: `agent_turn:seed${i}`, response_emitted: true,
      created_at: new Date(Date.parse('2026-10-07T11:00:00.000Z') + i * 1000).toISOString(), user_message: null, assistant_message: null,
      pending_actions: [], agent_guidance: { version: 1, entries }, suggested_actions: null, suggested_actions_run_key: null });
    table.push(row(0, { 'RC-WIDEN': { status: 'pressed', state_key_hash: widen.state_key_hash } }));
    for (let i = 1; i < 20; i += 1) table.push(row(i, { 'RC-COACH-EDITS': { status: 'offered', state_key_hash: 'aaaaaaaaaaaa' } }));
    coldStore();
    const live = await turn({ message: 'Where are we?' });
    expect(table.filter((r) => r.agent_guidance !== null).length, 'precondition: this answer wrote a guidance event').toBe(21);
    const again = await reload();
    expect(JSON.stringify(again.action_bar)).toBe(JSON.stringify(live.action_bar));
  });
  it('RED: a press turn carries the bar too, and a changed state reloads a different state_key', async () => {
    setState('withheld');
    const pressed = await press('agent-next-pre-mortem');
    expect(pressed.action_bar?.v).toBe(1);
    const before = (await reload()).action_bar!;
    setState('withheld', (() => { const g = structuredClone(D1.graph) as { edges: Record<string, unknown>[] }; g.edges[0]!.strength = { mean: 0.91, std: 0.05 }; return g; })());
    const after = (await reload()).action_bar!;
    expect(after.state_key).not.toBe(before.state_key);
  });
  it('the three captured bars are the committed fixtures DGAI binds to (pre-Run, withheld Run, licensed Run)', async () => {
    scenario = '6f1e2d3c-4b5a-4e6d-9c7b-00000000f1c5';
    for (const [state, name] of [['pre_run', 'pre-run'], ['withheld', 'withheld-run'], ['licensed', 'licensed-run']] as const) {
      setState(state); coldStore(); table = [];
      const bar = (await turn({ message: 'Where are we?' })).action_bar!;
      expect(bar.revision.graph_hash, name).toBe(hashOf(source.graph));
      const file = new URL(`action-bar-v1-${name}.json`, FIXTURES);
      if (process.env.CAPTURE_ACTION_BAR_FIXTURES === '1') writeFileSync(file, `${JSON.stringify(bar, null, 2)}\n`);
      const expected = JSON.parse(readFileSync(file, 'utf8'));
      // Science 393023 LICENCE (a)/(b), 7 Oct: licensed D3 no Strengthen → enabled Strengthen for workload/savings; every other field stays pinned.
      if (name === 'licensed-run') expected.standard.splice(2, 0, {
        action_id: 'strengthen', label: 'Strengthen', icon: 'ShieldCheck', group: 'review',
        press_id: 'agent-next-strengthen', user_line: 'What would most strengthen this model?', enabled: true,
        why_now: 'A link on your goal’s path has no size yet.', offer_key: '82c52ea28c022f3b',
      });
      expect(bar, name).toEqual(expected);
    }
  });
});


const paulGraph = (chance = true) => {
  const g = structuredClone(D1.graph) as { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  const goal = g.nodes.find(n => n.kind === 'goal')!;
  delete goal.goal_horizon; delete goal.goal_threshold_raw; delete goal.goal_threshold_unit;
  goal.observed_state = { unit: chance ? '% likelihood of on-time launch' : 'features' };
  return g;
};

describe('S-B slice 2a through the real routes', () => {
  it('Paul: typed turn, pre-mortem press, and reload keep ONLY Set deadline in priority, byte for byte', async () => {
    setState('pre_run', paulGraph());
    for (const b of [await turn({ message: 'Where are we?' }), await press('agent-next-pre-mortem')]) {
      expect(b.action_bar!.priority.map(o => o.action_id)).toEqual(['set_deadline']);
      expect(b.action_bar!.priority[0]!.label).toBe('Set deadline');
      coldStore();
      expect(JSON.stringify((await reload()).action_bar)).toBe(JSON.stringify(b.action_bar));
    }
  });
  it('Set target is a standing gap only without a stated target; no goal prioritises Frame brief', async () => {
    const g = paulGraph(false); setState('pre_run', g);
    expect((await turn({ message: 'Where are we?' })).action_bar!.priority.map(o => o.action_id)).toEqual(['set_goal']);
    g.nodes.find(n => n.kind === 'goal')!.goal_threshold_raw = 10; setState('pre_run', g);
    expect(offersOf((await reload()).action_bar!).map(o => o.action_id)).not.toContain('set_goal');
    g.nodes = g.nodes.filter(n => n.kind !== 'goal'); setState('pre_run', g);
    expect((await reload()).action_bar!.priority.map(o => o.action_id)).toEqual(['frame_brief']);
  });
  it('a durable pending approval yields on live and reload; a stale Run also yields, a current Run restores priority', async () => {
    setState('withheld', paulGraph());
    const card = await press('agent-next-strengthen');
    const latest = table[0]!.pending_actions as PendingAction[];
    expect(latest.some(pa => pa.action.kind === 'apply_proposed_change'), 'the answer row carries its approval').toBe(true);
    expect(card.action_bar!.priority.map(o => o.action_id)).not.toContain('set_deadline');
    expect(card.action_bar!.more.find(o => o.action_id === 'set_deadline')).toMatchObject({ enabled: true });
    coldStore();
    expect(JSON.stringify((await reload()).action_bar)).toBe(JSON.stringify(card.action_bar));
    for (const p of agentProposals.outstanding(scenario, OWNER)) agentProposals.discard(p.proposal_id);
    table = []; coldStore(); setState('stale', paulGraph());
    const stale = await press('act:set_deadline');
    expect(stale.action_bar!.priority.map(o => o.action_id)).not.toContain('set_deadline');
    expect(stale.action_bar!.more.find(o => o.action_id === 'set_deadline')).toMatchObject({ enabled: true });
    expect(JSON.stringify((await reload()).action_bar)).toBe(JSON.stringify(stale.action_bar));
    expect((table[0]!.pending_actions as PendingAction[]).some(pa => pa.action.kind === 'apply_proposed_change')).toBe(false);
    setState('withheld', paulGraph());
    expect((await reload()).action_bar!.priority.map(o => o.action_id)).toEqual(['set_deadline']);
  });
  it('the live bar reads the PERSISTED approval carrier, like the reload (Codex r1 P1-1 on #2766)', async () => {
    setState('withheld', paulGraph());
    // The persistence floor (or a concurrent decline) leaves no approval on the row this turn writes.
    port.append.mockImplementation((w: SessionTurnWrite) => realStore.append({ ...w, pending_actions: [] }));
    const card = await press('agent-next-strengthen');
    expect(card.action_bar!.priority.map(o => o.action_id)).toEqual(['set_deadline']);
    coldStore();
    expect(JSON.stringify((await reload()).action_bar)).toBe(JSON.stringify(card.action_bar));
  });
  it.each(['set_deadline', 'set_goal'] as const)('%s press ships the exact canonical question, zero model calls, and a ran receipt', async action => {
    const g = paulGraph(action === 'set_deadline'); setState('pre_run', g);
    const b = await press(`act:${action}`);
    expect(b.assistant_text).toBe(action === 'set_deadline' ? chanceGoalDeadlineAsk(String(g.nodes.find(n => n.kind === 'goal')!.label)) : composeGoalTargetQuestion());
    expect(modelCalls).toBe(0); expect(b.suggested_actions).toEqual([]);
    expect(b._diagnostic_trace?.fast_path).toBe('method');
    expect(b._action).toMatchObject({ action_id: action, outcome: 'ran' });
  });
  it('Frame brief ships the exact target + risks reply without a model call or composer rewriting', async () => {
    const g = { nodes: [
      { id: 'goal', kind: 'goal', label: 'Grow revenue' }, { id: 'a', kind: 'option', interventions: { f: 1 } }, { id: 'b', kind: 'option', interventions: { f: 2 } },
      { id: 'f', kind: 'factor' }, { id: 'o', kind: 'outcome' },
    ], edges: [{ from: 'f', to: 'goal' }], goal_constraints: [{ node_id: 'f', operator: '<=', value: 10 }] };
    setState('pre_run', g);
    const b = await press('act:frame_brief');
    expect(b.assistant_text).toBe('Your brief has: goal, options, factors, outcomes, limits.\n- ' + composeGoalTargetQuestion()
      + '\n- What could go wrong that would stop ‘Grow revenue’?');
    expect(modelCalls).toBe(0); expect(b._action).toMatchObject({ action_id: 'frame_brief', outcome: 'ran' });
    expect(b.suggested_actions.map(a => a.id)).toEqual(['act:set_goal', SUGGEST_RISKS_CHIP.id]);
  });
  it('More risks with the registry user line opens WIDEN risks on the method fast path', async () => {
    setState('pre_run', paulGraph());
    expect(ACTION_REGISTRY.more_risks.user_line).toBe(SUGGEST_RISKS_CHIP.message);
    const b = await turn({ source: 'chip', message: ACTION_REGISTRY.more_risks.user_line, chip: { id: SUGGEST_RISKS_CHIP.id } });
    expect(b._diagnostic_trace?.fast_path).toBe('method');
    expect(b._action).toMatchObject({ action_id: 'more_risks', outcome: 'ran' });
    expect(modelCalls).toBeGreaterThan(0);
  });
});


describe('S-B slice 2b through the real turn, composer and reload routes', () => {
  const setEstimates = () => {
    setState('withheld', estimateGraph());
    const result = { ...(source.analysis.analysis_result as object), enrichment: { inference_warnings: [estimateLicence()] } };
    source.analysis = { ...source.analysis, analysis_result: result, current_read: { analysis_ready: READY, result } };
  };
  it.each(['bias_anchoring', 'check_estimates'] as const)('%s press is an exact typed reply, zero model calls, with live/reload parity and both enabled menu offers', async id => {
    setEstimates();
    const b = await press(`act:${id}`, { parameters: { offer_key: '0123456789abcdef' } });
    expect(b._diagnostic_trace?.fast_path).toBe('method');
    expect(modelCalls).toBe(0);
    expect(b._action).toMatchObject({ action_id: id, outcome: 'ran', offer_key: '0123456789abcdef' });
    const points = estimatePointsOf(actionFactsOf({ scenarioId: scenario, graph: source.graph, graphHash: hashOf(source.graph),
      analysisState: source.analysis.analysis_state, analysisResult: source.analysis.analysis_result, analysisReady: READY }));
    expect(points.map(p => p.factor_id)).toEqual(['far', 'near', 'znear']);
    const expected = id === 'bias_anchoring' ? [
      "A first number can pull later estimates towards it. Here are Olumi's figures this result leans on, to test against your own evidence.",
      ...[['Far', '25%'], ['Near', '15%'], ['Extra', '10%']].map(([label, figure]) => `- Olumi put ‘${label}’ at ${figure}. That's Olumi's estimate, not a measured figure. What would make the real value much lower than that? And what would make it much higher? From your own evidence, what range would you give, and what is it based on?`),
      'Which of these would you check first?',
    ].join('\n') : [
      "Olumi's estimates that this result rests on:",
      "- ‘Far’: 25%. That's Olumi's estimate, not a measured figure.",
      "- ‘Near’: 15%. That's Olumi's estimate, not a measured figure.",
      "- ‘Extra’: 10%. That's Olumi's estimate, not a measured figure.",
      "If you have your own figure for any of these, tell me and I'll propose it for you to approve.",
    ].join('\n');
    expect(b.assistant_text).toBe(expected);
    expect(b.assistant_text).not.toMatch(/\b(most|top|biggest|strongest|best|winner|recommend|leader|ahead|beats)\b/i);
    expect(b.suggested_actions).toEqual([]);
    expect(b._action?.science).toBeUndefined(); // two options + current Run: canonicalStageOf reads decide
    for (const action_id of ['bias_anchoring', 'check_estimates']) expect(b.action_bar!.more.find(o => o.action_id === action_id)).toMatchObject({ enabled: true });
    coldStore();
    expect((await reload()).action_bar).toEqual(b.action_bar);
  });
  it('anchoring frame badge uses the canonical reader on a stale Run; no readable stage yields no badge', async () => {
    setState('stale', estimateGraph());
    const frame = await press('act:bias_anchoring');
    expect(frame._action?.science).toEqual(resolveDskClaimProvenance('DSK-B-001'));
    expect(JSON.stringify(frame._action).match(/DSK-B-001/g)).toHaveLength(1);
    setState('pre_run', estimateGraph());
    const noStage = await press('act:bias_anchoring');
    expect(noStage._action).toMatchObject({ outcome: 'ran' });
    expect(noStage._action?.science).toBeUndefined();
    expect(modelCalls).toBe(0);
  });
  it('stale anchoring offer after all eligible factors became user figures: exact no-trigger reply, cant_yet, no model calls', async () => {
    setEstimates();
    const old = (await press('act:check_estimates')).action_bar!.more.find(o => o.action_id === 'bias_anchoring')!;
    const g = estimateGraph();
    for (const n of g.nodes) if (n.kind === 'factor' && n.observed_state) n.observed_state = { ...n.observed_state, source: 'user_edited' };
    setState('withheld', g);
    const b = await press('act:bias_anchoring', { parameters: { offer_key: old.offer_key } });
    expect(b.assistant_text).toBe("None of these patterns' triggers fire in this model.");
    expect(b._action).toMatchObject({ action_id: 'bias_anchoring', outcome: 'cant_yet', reason: 'nothing_in_scope' });
    expect(b._action?.science).toBeUndefined();
    expect(b.suggested_actions).toEqual([]);
    expect(modelCalls).toBe(0);
    expect(offersOf(b.action_bar!).some(o => o.action_id === 'bias_anchoring' || o.action_id === 'check_estimates')).toBe(false);
  });
});
