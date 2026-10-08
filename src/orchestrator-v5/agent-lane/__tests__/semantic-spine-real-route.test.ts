import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, vi, afterEach, afterAll } from 'vitest';
vi.mock('../../../config/index.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../config/index.js')>();
  return { ...actual, config: { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false }, proxy: { ...actual.config.proxy, agentLaneEnabled: true, agentLanePreview: false } } };
});
const { storeRef } = vi.hoisted(() => ({ storeRef: { value: null as unknown } }));
vi.mock('../../session/index.js', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), getSessionStore: () => storeRef.value }));
vi.mock('../../../orchestrator/user-identity.js', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: vi.fn(async () => ({ mode: 'verified', userId: '0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b' })) }));
import registerRoute from '../../../routes/assist.v1.scenario-graph-register.js';
import readRoute from '../../../routes/assist.v1.scenario-graph.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import capture from './fixtures/semantic-spine/paul-20261002.json';
import { ProposalStore } from '../proposal.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type AgentToolContext, type ToolResult } from '../runtime/agent-tools.js';
import { SCOPE_APPROVE_PREFIX, scopeWithdrawalWords } from '../goal-scope.js';
import { parsePendingAction, type PendingAction } from '../../session/pending-action.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { breakEvenFor } from '../break-even.js';
import { buildAtomicCommittedModelVersion, commitDirectAnswer } from '../../commit.js';
import { appendCheckedGraphWrite } from '../../persist-graph-write.js';
import { config } from '../../../config/index.js';
import { CURRENT_MODEL_STATE_PREFIX } from '../runtime/agent-loop.js';

const SID = '550e8400-e29b-41d4-a716-4466554400d9';
type Rec = Record<string, unknown>;
type Graph = { nodes: Rec[]; edges: Rec[] } & Rec;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const jsonb = <T>(v: T): T => JSON.parse(JSON.stringify(v, (_k, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, value[k]])) : value)) as T;
const g0 = () => clone(capture.graph) as Graph;
const goal = (g: Graph) => g.nodes.find(n => n.id === 'mrr')!;
const count = (g: Graph) => (g.nodes.find(n => n.id === 'pro_paying_subscribers')!.observed_state as Rec).raw_value;
const source = capture.statements[0]!.quote!;
const initialScope = { modelled: 'all revenue streams', alternative: 'Pro revenue only', extent: 'total', stated_in_brief: true, source: { quote: source },
  component: { label: 'Pro', rate_id: 'pro_plan_price', count_id: 'pro_paying_subscribers', basis: 'unknown', source: { quote: source } } };
const apps: FastifyInstance[] = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); });
afterAll(() => { vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

async function harness(g = g0()) {
  const row = { graph: clone(g), pending: [] as PendingAction[], writes: [] as Rec[] };
  const records = new Map<string, Rec>();
  const store = {
    append: vi.fn(async (write: Rec) => {
      records.set(String(write.turn_id), { id: `row-${records.size + 1}`, scenario_id: SID, turn_id: write.turn_id, request_hash: write.request_hash, assistant_message: write.assistantMessage ?? null, user_message: write.userMessage ?? null, llm_calls_used: write.llm_calls_used ?? 0, pending_actions: clone(write.pending_actions ?? []) });
      if (write.graph !== undefined) { row.graph = clone(write.graph) as Graph; row.writes.push(clone(write)); }
      if (!String(write.turn_id).endsWith(':claim')) row.pending = clone(write.pending_actions ?? []) as PendingAction[]; return { id: `row-${row.writes.length}` }; }),
    loadGraph: vi.fn(async () => clone(row.graph)),
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(row.graph), briefText: null })),
    readMostRecentPendingActions: vi.fn(async () => clone(row.pending)),
    readRecent: vi.fn(async () => []),
    ensureScenarioExists: vi.fn(async () => ({ user_id: null })), getScenarioOwner: vi.fn(async () => null), scenarioExists: vi.fn(async () => true), readCommittedTurn: vi.fn(async (_sid: string, tid: string) => records.get(tid) ?? null),
  };
  storeRef.value = store;
  let app = Fastify(); apps.push(app); await registerRoute(app); await readRoute(app); await app.ready();
  const dispatch: InternalDispatch = async (path, body) => { const r = await app.inject({ method: 'POST', url: path, payload: body as Rec }); return { status: r.statusCode, json: r.json() as Rec }; };
  let proposals = new ProposalStore();
  let caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { readPendingActions: store.readMostRecentPendingActions });
  const context = (words: string, extra: Rec = {}): AgentToolContext => ({ scenario_id: SID, authenticated_user_id: null, request_id: 'req-spine', user_turn_text: words, user_text: words, ...extra });
  const call = (name: string, args: Rec, words = '', extra: Rec = {}) => dispatchTool(name, JSON.stringify(args), context(words, extra), caps);
  const restart = () => { row.graph = jsonb(row.graph); row.pending = jsonb(row.pending).map(p => parsePendingAction(p)!); proposals = new ProposalStore(); caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined, { readPendingActions: store.readMostRecentPendingActions }); };
  const retain = (r: ToolResult) => { const p = parsePendingAction(r.pending_action); expect(p).not.toBeNull(); row.pending = [clone(p!)]; };
  const read = () => dispatch(`/assist/v1/scenarios/${SID}/graph`, {});
  const register = (g: Graph) => dispatch(`/assist/v1/scenarios/${SID}/graph/register`, { graph: g });
  const startAgentProcess = async () => {
    row.graph = jsonb(row.graph); row.pending = jsonb(row.pending);
    await app.close(); vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify(); apps.push(app); await registerRoute(app); await readRoute(app); await app.register(agentV1TurnRoute); await app.ready();
  };
  const agentTurn = async (message: string, extra: Rec = {}) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SID, turn_id: randomUUID(), message, ...extra } });
    expect(r.statusCode, r.body.slice(0,1000)).toBe(200); return r.json() as Rec;
  };
  const clearHistory = () => { records.clear(); row.writes.length = 0; };
  return { row, store, call, restart, retain, read, register, startAgentProcess, agentTurn, clearHistory, get proposals() { return proposals; } };
}
async function open(h: Awaited<ReturnType<typeof harness>>) {
  const r = await h.call('reconcile_goal_scope', { goal_label: 'MRR', scope: initialScope, current_level: { value: 10000, unit: 'GBP/month', quote: source } }, source);
  expect(r.ok, JSON.stringify(r)).toBe(true); expect(r).not.toHaveProperty('proposal_id'); h.retain(r); return r;
}
async function share(h: Awaited<ReturnType<typeof harness>>) {
  const words = capture.statements[1]!.quote!;
  const r = await h.call('reconcile_goal_scope', { goal_label: 'MRR', component_share: .3, source_quote: words }, words);
  expect(r.ok, JSON.stringify(r)).toBe(true); expect(r).toHaveProperty('proposal_id'); h.retain(r); return r;
}
async function clarified(h: Awaited<ReturnType<typeof harness>>) {
  const words = '300 are registered Pro accounts, not billable subscriptions. The £49 price is per billable subscription per month; Pro contributes 30% of our total MRR.';
  const r = await h.call('reconcile_goal_scope', { goal_label: 'MRR', component_basis: 'different', count_basis: 'registered Pro accounts, not billable subscriptions', source_quote: words }, words);
  expect(r.ok, JSON.stringify(r)).toBe(true); expect(r.proposal_id).toBeTypeOf('string'); h.retain(r); return r;
}
async function approve(h: Awaited<ReturnType<typeof harness>>, r: ToolResult, words?: string) {
  return h.call('authorise_change', { proposal_id: r.proposal_id }, '', { typed_approval_of: r.proposal_id, typed_approval_words: words ?? SCOPE_APPROVE_PREFIX + r.public_label });
}

describe('Semantic spine S1–S7 through real canonical read/register and Run input', () => {
  it('the held-out warehouse canonical slice retains units, range, comparison basis and three options without inventing scope questions', async () => {
    const factor = (id: string, label: string, raw_value: number, unit: string) => ({ id, kind: 'factor', label, observed_state: { value: .5, raw_value, cap: raw_value * 2, unit, source: 'brief_extraction' } });
    const g = GraphV3.parse({ nodes: [
      factor('staff', 'Picking and packing staffing', 24, 'FTE'),
      factor('util', 'Normal-month utilisation', 80, '%'),
      factor('uplift', 'Nov/Dec volume uplift versus last year', 40, '%'),
      { id: 'temp_rate', kind: 'factor', label: 'Temporary staff hourly rate', prior: { distribution: 'uniform', range_min: 12, range_max: 15 }, display_value: '£12–15 per hour' },
      factor('capex', 'Conveyor automation capex', 80000, 'GBP'),
      factor('running', 'Current annual running costs', 800000, 'GBP/year'),
      { id: 'temps', kind: 'option', label: 'Hire temporary staff' },
      { id: 'conveyor', kind: 'option', label: 'Conveyor automation' },
      { id: 'shifts', kind: 'option', label: 'Three shifts instead of two' },
    ], edges: [] });
    const h = await harness(g); expect((await h.register(g)).status).toBe(200);
    h.clearHistory(); h.restart(); const read = await h.read();
    expect(read.json.graph).toEqual(g); expect(h.row.pending).toHaveLength(0);
    const nodes = (read.json.graph as Graph).nodes;
    for (const [id, raw_value, unit] of [['staff',24,'FTE'],['util',80,'%'],['uplift',40,'%'],['capex',80000,'GBP'],['running',800000,'GBP/year']]) {
      expect(nodes.find(n => n.id === id)).toMatchObject({ observed_state: { raw_value, unit, source: 'brief_extraction' } });
    }
    expect(nodes.find(n => n.id === 'temp_rate')).toMatchObject({ prior: { range_min: 12, range_max: 15 }, display_value: '£12–15 per hour' });
    expect(nodes.find(n => n.id === 'temp_rate')).not.toHaveProperty('observed_state');
    expect(nodes.find(n => n.id === 'uplift')!.label).toBe('Nov/Dec volume uplift versus last year');
    expect(nodes.filter(n => n.kind === 'option').map(n => n.id)).toEqual(['temps','conveyor','shifts']);
    expect(nodes.some(n => n.kind === 'goal')).toBe(false);
  });
  it('the answer context binds user quantities and conditional derivations to separate carrier ids', async () => {
    const h = await harness(); await open(h); const total = await share(h); await approve(h, total); h.clearHistory(); h.restart();
    const projected = await h.call('get_canonical_state', {});
    const entities = projected.entities as Rec[];
    expect(entities.find(e => e.id === 'mrr')).toMatchObject({ raw_value: 10000, unit: '£/month' });
    expect(entities.find(e => e.id === 'pro_paying_subscribers')).toMatchObject({ raw_value: 300 });
    expect(entities.find(e => e.id === 'pro_plan_price')).toMatchObject({ raw_value: 49 });
    expect(projected.goal).toMatchObject({ id: 'mrr', scope: { extent: 'total', component: { share: .3, basis: 'unknown', rate_id: 'pro_plan_price', count_id: 'pro_paying_subscribers' } }, conditional_derivations: [{ value: 3000, source: 'deterministic_derivation', conditional: true }, { value: 3000/49, source: 'deterministic_derivation', conditional: true }] });
    expect(entities.some(e => e.raw_value === 3000 || e.raw_value === 3000/49)).toBe(false);
    expect(entities.every(e => !Object.hasOwn(e, 'goal_scope'))).toBe(true); // Scope rides once beside the existing goal reading.
    expect(projected.goal_scope_reconciliation).toHaveLength(1);
  });
  it('approves the known total and withdraws its wrong product while retaining one unresolved count question after restart', async () => {
    const h = await harness(); await open(h); const offered = await share(h);
    expect(offered.public_label).toContain('count population and billing basis remain unresolved');
    expect(offered.public_label).not.toContain('the same billing bases');
    expect(await approve(h, offered)).toMatchObject({ applied: true });
    h.clearHistory(); h.restart();
    const read = await h.read(); const g = read.json.graph as Graph;
    expect(goal(g)).toMatchObject({ observed_state: { raw_value: 10000, source: 'user_override' }, goal_scope: { extent: 'total', component: { share: .3, basis: 'unknown' } } });
    expect(goal(g)).not.toHaveProperty('nonlinear_identity'); expect(count(g)).toBe(300);
    expect(h.row.pending).toHaveLength(1); expect(h.row.pending[0]!.action).toMatchObject({ kind: 'reconcile_goal_scope', goal_id: 'mrr', expected: 'billing_basis', derivations: [{ value: 3000, source: 'deterministic_derivation' }, { value: 3000/49, source: 'deterministic_derivation' }] });
    expect(read.json.goal_scope_reconciliation).toHaveLength(1);
  });
  it('binds an explicitly named multiword component after expiry while an unqualified number requires a fresh question', async () => {
    const h = await harness(); await open(h);
    const held = h.row.pending[0]!; if (held.action.kind !== 'reconcile_goal_scope') throw new Error('missing scope issue');
    held.action.scope!.component!.label = 'Pro plan'; h.row.pending[0] = { ...held, expires_at_iso: new Date(0).toISOString() };
    const bare = await h.call('reconcile_goal_scope', { goal_label: 'MRR', component_share: .3, source_quote: '30% currently' }, '30% currently');
    expect(bare).toMatchObject({ refusal: 'share_not_bound' }); expect(bare).not.toHaveProperty('proposal_id');
    const words = 'The Pro plan contributes 30% of our total MRR.';
    const named = await h.call('reconcile_goal_scope', { goal_label: 'MRR', component_share: .3, source_quote: words }, words);
    expect(named.ok, JSON.stringify(named)).toBe(true); expect(named).toHaveProperty('proposal_id');
    expect((named.pending_action as PendingAction).action).toMatchObject({ goal_id: 'mrr', scope: { component: { label: 'Pro plan', share: .3 } } });
  });
  it.each(['pro_plan_price', 'pro_paying_subscribers'])('deleted operand %s reopens one durable issue by id even on a previously resolved different basis', async deletedId => {
    const h = await harness(); await open(h); await share(h); const offered = await clarified(h); await approve(h, offered);
    expect(h.row.pending).toHaveLength(0);
    const g = clone(h.row.graph); g.nodes = g.nodes.filter(n => n.id !== deletedId);
    g.edges = g.edges.filter(e => e.from !== deletedId && e.to !== deletedId);
    expect((await h.register(g)).status).toBe(200);
    h.clearHistory(); h.restart(); await h.read();
    expect(h.row.pending).toHaveLength(1);
    expect(h.row.pending[0]!.action).toMatchObject({ kind: 'reconcile_goal_scope', goal_id: 'mrr', scope: { component: { rate_id: 'pro_plan_price', count_id: 'pro_paying_subscribers' } } });
    const action = h.row.pending[0]!.action;
    if (action.kind !== 'reconcile_goal_scope') throw new Error('missing scope issue');
    expect(action.question).toContain('removed or changed kind');
    expect(goal(h.row.graph)).toMatchObject({ observed_state: { raw_value: 10000 } });
    if (deletedId === 'pro_plan_price') expect(count(h.row.graph)).toBe(300);
    else expect(h.row.graph.nodes.some(n => n.id === deletedId)).toBe(false);
    expect((await h.read()).json.goal_scope_reconciliation).toHaveLength(1);
  });
  it('all-subscriber clarification closes the issue; an incompatible Pro-subscriber clarification retains the conflict', async () => {
    for (const all of [true, false]) {
      const h = await harness(); await open(h); const total = await share(h); await approve(h, total);
      const words = all ? '300 counts all subscribers across every plan, not Pro subscribers.' : '300 are Pro subscribers on the same monthly billing basis.';
      const r = await h.call('reconcile_goal_scope', { goal_label: 'MRR', component_basis: all ? 'different' : 'same', count_basis: all ? 'all subscribers across every plan' : 'Pro subscribers', source_quote: words }, words);
      expect(r.ok, JSON.stringify(r)).toBe(true); h.retain(r);
      expect(await approve(h, r)).toMatchObject({ applied: true });
      h.clearHistory(); h.restart(); await h.read();
      expect(goal(h.row.graph)).toMatchObject({ observed_state: { raw_value: 10000 }, goal_scope: { extent: 'total', component: { share: .3, count_basis: all ? 'all subscribers across every plan' : 'Pro subscribers' } } });
      expect(count(h.row.graph)).toBe(300); expect(h.row.pending).toHaveLength(all ? 0 : 1);
      if (!all) expect(h.row.pending[0]!.action).toMatchObject({ expected: 'billing_basis', derivations: [{ value: 3000 }, { value: 3000/49 }] });
    }
  });
  it('S1: an explicitly scoped component goal can approve consistent figures without changing its count or identity authorship', async () => {
    const h = await harness();
    const words = 'MRR here means Pro-plan revenue only. Current Pro MRR is £14,700 per month. Its £49 price and 300 subscriptions use the same monthly billing basis.';
    const scope = { modelled: 'Pro-plan revenue only', alternative: 'all-plan revenue', extent: 'component', stated_in_brief: true, source: { quote: words },
      component: { label: 'Pro', rate_id: 'pro_plan_price', count_id: 'pro_paying_subscribers', basis: 'same', source: { quote: words }, basis_source: { quote: words } } };
    const p = await h.call('reconcile_goal_scope', { goal_label: 'MRR', scope, current_level: { value: 14700, unit: 'GBP/month', quote: words } }, words);
    expect(p, JSON.stringify(p)).toHaveProperty('proposal_id'); h.retain(p);
    expect(await approve(h, p)).toMatchObject({ applied: true });
    expect(goal(h.row.graph)).toMatchObject({ goal_scope: { extent: 'component' }, observed_state: { raw_value: 14700 }, nonlinear_identity: { stated_in_brief: false } });
    expect(count(h.row.graph)).toBe(300); expect(h.row.pending).toEqual([]);
  });
  it('S2–S6: restart, unrelated register, share, explicit population clarification → one authorised commit, 300 retained', async () => {
    const h = await harness(); await open(h);
    const hash = computeAnalysisAffectingGraphHash(h.row.graph as never);
    expect(h.row.writes).toHaveLength(0); expect(goal(h.row.graph)).not.toHaveProperty('observed_state');
    h.restart(); expect((await h.register(clone(h.row.graph))).status).toBe(200);
    expect(h.row.pending).toHaveLength(1); expect(computeAnalysisAffectingGraphHash(h.row.graph as never)).toBe(hash);
    const r = await share(h);
    expect((r.conditional_derivations as Rec[]).map(d => d.value)).toEqual([3000, 3000/49]);
    expect(count(h.row.graph)).toBe(300);
    const unresolved = await h.read(); expect(unresolved.json.goal_scope_claim_permissions).toMatchObject({ total_goal_claims_allowed: false });
    const p = await clarified(h); const writesBefore = h.row.writes.length;
    expect(await approve(h, p, 'Yes')).toMatchObject({ applied: false });
    expect(h.row.writes).toHaveLength(writesBefore);
    const result = await approve(h, p); expect(result, JSON.stringify(result)).toMatchObject({ applied: true, mutated: true });
    expect(h.row.writes).toHaveLength(writesBefore + 1); expect(h.row.pending).toEqual([]);
    expect(goal(h.row.graph)).toMatchObject({ observed_state: { raw_value: 10000, baseline: .4, source: 'user_override' }, goal_scope: { extent: 'total', component: { share: .3, basis: 'different', count_basis: 'registered Pro accounts, not billable subscriptions' } } });
    expect(goal(h.row.graph)).not.toHaveProperty('nonlinear_identity'); expect(count(h.row.graph)).toBe(300);
    expect(await approve(h, p)).toMatchObject({ already_applied: true }); expect(h.row.writes).toHaveLength(writesBefore + 1);
  });
  it('S3: the shared writer refuses a silent baseline fit or identity confirmation while scope is unresolved', async () => {
    const h = await harness(); await open(h); await share(h);
    const fit = clone(h.row.graph); goal(fit).observed_state = { raw_value: 10000, baseline: .4, value: .4, cap: 25000, unit: '£/month', source: 'user_override' };
    expect((await h.register(fit)).status).toBe(422); expect(h.row.writes).toHaveLength(0);
    await expect(commitDirectAnswer({ response_version: 2, assistant_text: 'Record the baseline', blocks: [], suggested_actions: [], insights: [], stage_indicator: 'frame' } as never,
      { scenario_id: SID, turn_id: 'silent-fit', turn_class: 'direct_answer', graph: fit, baseGraphForInvariants: h.row.graph } as never, h.store as never)).rejects.toMatchObject({ code: 'GOAL_SCOPE_IDENTITY_CONFLICT' });
    expect(h.row.writes).toHaveLength(0);
    const confirmed = clone(h.row.graph); (goal(confirmed).nonlinear_identity as Rec).stated_in_brief = true;
    expect((await h.register(confirmed)).status).toBe(422); expect(count(h.row.graph)).toBe(300);
  });
  it('S7: stale approval writes nothing; an explicit identity is corrected only on its exact consented card', async () => {
    const g = g0(); (goal(g).nonlinear_identity as Rec).stated_in_brief = true;
    const h = await harness(g); await open(h); await share(h); const p = await clarified(h);
    expect(p.public_label).toContain('your confirmed product reading');
    expect(goal(h.row.graph).nonlinear_identity).toMatchObject({ stated_in_brief: true });
    (h.row.graph.nodes.find(n => n.id === 'pro_plan_price')!.observed_state as Rec).raw_value = 50;
    expect(await approve(h, p)).toMatchObject({ refusal: 'superseded' });
    expect(h.row.writes).toHaveLength(0); expect(goal(h.row.graph)).toHaveProperty('nonlinear_identity'); expect(count(h.row.graph)).toBe(300);
  });
  it('S6–S7: competing ask or expired binding requires a fresh question, retains the unresolved operands', async () => {
    const h = await harness(); await open(h); h.row.pending[0] = { ...h.row.pending[0]!, expires_at_turn_count: 0 }; h.restart();
    const r = await h.call('reconcile_goal_scope', { goal_label: 'MRR', component_share: .3, source_quote: '30% currently' }, '30% currently');
    expect(r).toMatchObject({ refusal: 'share_not_bound' }); h.retain(r);
    expect(h.row.pending[0]!.action).toMatchObject({ current_level: { value: 10000 }, expected: 'component_share' });
    expect(h.row.writes).toHaveLength(0); expect(count(h.row.graph)).toBe(300);
  });
  it('S6: a non-graph conversational commit cannot erase the issue when a legacy caller omits it', async () => {
    const h = await harness(); await open(h);
    await appendCheckedGraphWrite({ store: h.store as never, writesGraph: false, baseGraphForInvariants: h.row.graph,
      write: { scenario_id: SID, turn_id: 'unrelated-legacy', pending_actions: [] } as never });
    expect(h.row.pending).toHaveLength(1); expect(h.row.pending[0]!.action.kind).toBe('reconcile_goal_scope');
    expect(h.row.writes).toHaveLength(0); expect(count(h.row.graph)).toBe(300);
  });
  it('S7: a changed or withdrawn issue supersedes the card even when graph identity has not changed', async () => {
    const h = await harness(); await open(h); await share(h); const p = await clarified(h);
    const hash = computeAnalysisAffectingGraphHash(h.row.graph as never);
    const issue = h.row.pending[0]!.action;
    if (issue.kind === 'reconcile_goal_scope') issue.scope!.component!.count_basis = 'a different user-confirmed population';
    expect(computeAnalysisAffectingGraphHash(h.row.graph as never)).toBe(hash);
    expect(await approve(h, p)).toMatchObject({ refusal: 'superseded', applied: false });
    expect(h.row.writes).toHaveLength(0);
    h.row.pending = []; expect(await approve(h, p)).toMatchObject({ refusal: 'superseded' });
  });
  it('S7: a full scope argument cannot bypass an expired bare-answer binding', async () => {
    const h = await harness(); await open(h); h.row.pending[0] = { ...h.row.pending[0]!, expires_at_turn_count: 0 };
    const scope = { ...initialScope, component: { ...initialScope.component, share: .3, source: { quote: '30% currently' } } };
    expect(await h.call('reconcile_goal_scope', { goal_label: 'MRR', scope }, '30% currently')).toMatchObject({ refusal: 'share_not_bound' });
    expect(h.row.writes).toHaveLength(0);
  });
  it('S7: the existing version carrier includes scope; provenance alone changes neither version hash', async () => {
    const h = await harness(); await open(h); await share(h); const p = await clarified(h); expect(await approve(h, p)).toMatchObject({ applied: true });
    const enabled = config.cee.modelVersionsEnabled; config.cee.modelVersionsEnabled = true;
    try {
      const metadata = { scenario_id: SID, turn_id: 't-version', baseGraphForInvariants: g0() };
      const version = buildAtomicCommittedModelVersion(h.row.graph, metadata);
      expect(version.kind).toBe('plan');
      if (version.kind === 'plan') expect(version.write.graph_identity_hash).toBe((await h.read()).json.graph_identity_hash && ((await h.read()).json.graph_identity_hash as Rec).value);
      const note = clone(h.row.graph); (goal(note).goal_scope as {source: Rec}).source = { quote: 'An additional exact source reference.' };
      const provenanceVersion = buildAtomicCommittedModelVersion(note, { ...metadata, baseGraphForInvariants: h.row.graph });
      expect(provenanceVersion.kind).toBe('plan');
      if (version.kind === 'plan' && provenanceVersion.kind === 'plan') {
        expect(provenanceVersion.write.graph_identity_hash).toBe(version.write.graph_identity_hash);
        expect(provenanceVersion.write.analysis_affecting_hash).toBe(version.write.analysis_affecting_hash);
      }
    } finally { config.cee.modelVersionsEnabled = enabled; }
  });
  it('SUCCESS: canonical read → readiness → captured Run input → Agent context → explanation → cold reload, with no transcript or process memory', async () => {
    const h = await harness(); await open(h); await share(h); const p = await clarified(h); expect(await approve(h, p)).toMatchObject({ applied: true });
    h.clearHistory(); h.restart(); const read = await h.read(); expect(read.status).toBe(200); expect(read.json.brief_text).toBeNull();
    const canonical = GraphV3.parse(read.json.graph); expect(canonical.nodes.find(n => n.id === 'mrr')!.goal_scope?.extent).toBe('total');
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SID, 'req-load', h.store as never);
    const run = vi.fn(async (_input: unknown) => ({ meta: { seed_used: 1, n_samples: 1, response_hash: 'sha256:s' }, results: [], response_hash: 'sha256:t', analysis_status: 'completed' }));
    const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient, scenarioReader: vi.fn(async () => snapshot) });
    await handler({ context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SID, request_id: 'req-run', budgets: { turn_ms: 180000, llm_narrate_ms: 60000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null }, payload: makeMessagePayload({ turn_id: 't-run', scenario_id: SID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }), requestId: 'req-run', signal: new AbortController().signal, orientationText: '' } as unknown as HandlerInvocation);
    expect(run).toHaveBeenCalledTimes(1);
    const input = run.mock.calls[0]![0] as unknown as { graph: Graph };
    expect(goal(input.graph)).toMatchObject({ goal_scope: { extent: 'total', component: { share: .3, basis: 'different' } }, observed_state: { raw_value: 10000, baseline: .4 } });
    expect(goal(input.graph)).not.toHaveProperty('nonlinear_identity'); expect(count(input.graph)).toBe(300);
    const context = await h.call('get_canonical_state', {});
    expect(context.goal).toMatchObject({ scope: { extent: 'total', component: { share: .3, basis: 'different' } } });
    expect(breakEvenFor(h.row.graph)).toBeNull();
    // The explanation's canonical context and its deterministic arithmetic backstop, after every history source is gone.
    expect(JSON.stringify(context)).toContain('registered Pro accounts'); expect(JSON.stringify(context)).toContain('10000');
    const ui = clone(h.row.graph); delete goal(ui).goal_scope; expect((await h.register(ui)).status).toBe(200);
    h.restart(); expect(goal((await h.read()).json.graph as Graph)).toMatchObject({ goal_scope: goal(h.row.graph).goal_scope, observed_state: { raw_value: 10000 } });
  });
});


describe('S6–S7: the actual Agent route owns the durable reconciliation and cold explanation', () => {
  it('an explicit user withdrawal retires the issue through the persistence floor and restart', async () => {
    const h = await harness(); await open(h);
    expect(await h.call('withdraw_proposal', { proposal_id: 'goal-scope:mrr' }, 'Skip that question for now')).toMatchObject({ refusal: 'withdrawal_not_approved' });
    expect(h.row.pending).toHaveLength(1);
    let script: Rec[][] = [[{ type: 'function_call', name: 'withdraw_proposal', call_id: randomUUID(), arguments: JSON.stringify({ proposal_id: 'goal-scope:mrr' }) }],
      [{ type: 'message', content: [{ type: 'output_text', text: 'The unresolved reading was withdrawn.' }] }]];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: script.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Ready.' }] }] }), { status: 200 })));
    await h.startAgentProcess();
    const reply = await h.agentTurn(scopeWithdrawalWords('mrr'));
    // GOAL-REACH #2802: the goal still carries Olumi's unconfirmed reading, so the route's existing re-offer may attach the
    // identity card (it writes nothing) after the withdrawal; the withdrawal is the turn's own call.
    const calls = (reply._agent as { tool_calls: { name: string; ok?: boolean; mutated?: boolean }[] }).tool_calls;
    expect(calls[0]).toMatchObject({ name: 'withdraw_proposal', ok: true });
    expect(calls.slice(1).every(c => c.name === 'propose_identity' && c.mutated !== true)).toBe(true);
    expect(h.row.pending.some(p => p.action.kind === 'reconcile_goal_scope')).toBe(false);
    expect(h.row.writes).toHaveLength(0); expect(count(h.row.graph)).toBe(300);
    h.restart(); expect((await h.read()).json).not.toHaveProperty('goal_scope_reconciliation');
    await h.startAgentProcess(); script = []; await h.agentTurn('What does monthly churn mean?');
    expect(h.row.pending.some(p => p.action.kind === 'reconcile_goal_scope')).toBe(false);
  });
  it('persists its own question, carries it across restart/unrelated turns, approves its exact card, then explains only canonical meaning', async () => {
    const h = await harness();
    let scripted: Rec[][] = [];
    const sent: Rec[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: {body?: string}) => {
      sent.push(JSON.parse(init.body ?? '{}'));
      return new Response(JSON.stringify({ output: scripted.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'The retained reading is ready for review.' }] }] }), { status: 200 });
    }));
    const ask = (args: Rec, text: string) => { scripted = [ [{ type: 'function_call', name: 'reconcile_goal_scope', call_id: randomUUID(), arguments: JSON.stringify(args) }], [{ type: 'message', content: [{ type: 'output_text', text }] }] ]; };
    await h.startAgentProcess();
    ask({ goal_label: 'MRR', scope: initialScope, current_level: { value: 10000, unit: 'GBP/month', quote: source } }, 'What share of the current MRR comes from Pro?');
    const first = await h.agentTurn(source);
    expect(first.assistant_text).toContain((h.row.pending.find(p => p.action.kind === 'reconcile_goal_scope')!.action as {question: string}).question);
    expect(h.row.pending.filter(p => p.action.kind === 'reconcile_goal_scope')).toHaveLength(1);
    expect(goal(h.row.graph)).not.toHaveProperty('observed_state');
    await h.startAgentProcess(); scripted = [];
    await h.agentTurn('What does monthly churn mean?');
    expect(h.row.pending.filter(p => p.action.kind === 'reconcile_goal_scope')).toHaveLength(1);
    expect((await h.register(clone(h.row.graph))).status).toBe(200);
    await h.startAgentProcess();
    const shareWords = capture.statements[1]!.quote!;
    ask({ goal_label: 'MRR', component_share: .3, source_quote: shareWords }, 'Do the count and monthly revenue describe the same billing population?');
    await h.agentTurn(shareWords);
    expect(h.row.pending.find(p => p.action.kind === 'reconcile_goal_scope')!.action).toMatchObject({ expected: 'billing_basis', derivations: [{ value: 3000 }, { value: 3000/49 }] });
    const words = '300 are registered accounts, not billable subscriptions. Pro supplies 30% of total monthly MRR; its £49 price is per billable subscription.';
    ask({ goal_label: 'MRR', component_basis: 'different', count_basis: 'registered accounts, not billable subscriptions', source_quote: words }, 'Review the exact goal reading on the card.');
    const offered = await h.agentTurn(words);
    const card = (offered.suggested_actions as Rec[]).find(c => String(c.id).startsWith('agent-approve-proposal:'))!;
    expect(card, JSON.stringify(offered)).toBeDefined(); expect(card.message).toContain('Withdraw');
    await h.startAgentProcess(); scripted = [];
    const approved = await h.agentTurn(String(card.message), { source: 'chip', chip: { id: card.id } });
    expect(approved._agent).toMatchObject({ tool_calls: [{ name: 'authorise_change', ok: true }] });
    expect(goal(h.row.graph)).not.toHaveProperty('nonlinear_identity'); expect(count(h.row.graph)).toBe(300);
    expect(h.row.pending.some(p => p.action.kind === 'reconcile_goal_scope')).toBe(false);
    // No transcript remains anywhere in the store or the restarted route. The provider input must still contain all authorities.
    h.clearHistory(); sent.length = 0; await h.startAgentProcess();
    scripted = [[{ type: 'message', content: [{ type: 'output_text', text: 'The model records £10,000 total monthly MRR. Pro contributes 30%; 300 refers to registered accounts, not billable subscriptions. Its price and account count do not define total MRR.' }] }]];
    const explanation = await h.agentTurn('Explain the goal reading from the saved model.');
    const input = sent.at(-1)!.input as Rec[];
    const text = input.filter(item => item.role === 'developer').flatMap(item => Array.isArray(item.content) ? item.content as Rec[] : [])
      .find(item => typeof item.text === 'string' && item.text.startsWith(CURRENT_MODEL_STATE_PREFIX))?.text;
    expect(text).toBeTypeOf('string');
    const supplied = JSON.parse(String(text).slice(CURRENT_MODEL_STATE_PREFIX.length)) as Rec;
    expect(supplied.goal).toMatchObject({ id: 'mrr', scope: { extent: 'total', modelled: 'all revenue streams', component: { share: .3, basis: 'different', count_basis: 'registered accounts, not billable subscriptions', rate_id: 'pro_plan_price', count_id: 'pro_paying_subscribers' } } });
    const suppliedEntities = supplied.entities as Rec[];
    expect(suppliedEntities.find(e => e.id === 'mrr')).toMatchObject({ raw_value: 10000, value_provenance: { source: 'user_override' } });
    expect(suppliedEntities.find(e => e.id === 'pro_paying_subscribers')).toMatchObject({ raw_value: 300, value_provenance: { source: 'user_override' } });
    expect(suppliedEntities.find(e => e.id === 'pro_plan_price')).toMatchObject({ raw_value: 49, value_provenance: { source: 'brief_extraction' } });
    expect(suppliedEntities.some(e => e.raw_value === 3000 || e.raw_value === 3000 / 49)).toBe(false);
    expect(explanation.assistant_text).toContain('£10,000 total monthly MRR');
    expect(explanation.assistant_text).not.toContain('£14,700'); expect((explanation._agent as Rec).break_even).toBeUndefined();
    const cold = await h.read(); expect(goal(cold.json.graph as Graph)).toMatchObject({ goal_scope: { extent: 'total', component: { share: .3, basis: 'different' } }, observed_state: { raw_value: 10000 } });
  }, 60000);
});
