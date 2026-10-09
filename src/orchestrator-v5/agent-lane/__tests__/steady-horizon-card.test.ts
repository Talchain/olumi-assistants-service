import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { assignEntityRefs } from '../../graph/entity-refs.js';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6b1e2d3c-4b5a-4f6e-9d7c-8b9a0e1f3d${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
let graphOf = new Map<string, unknown>();
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
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
// 2b's proof is an HMAC minted only by applyGoalSteadyEdit; the secret is test-only (as horizon-basis-door.test.ts does).
vi.mock('../../../config/index.js', async original => {
  const actual = await original<typeof import('../../../config/index.js')>();
  return { ...actual, config: new Proxy(actual.config, { get(target, key) {
    if (key === 'auth') return { ...target.auth, hmacSecret: 'p45-card-test-only-secret' };
    return Reflect.get(target, key);
  } }) };
});
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

let commitMode: 'real' | 'missing_basis' | 'forged_proof' | 'stale' | 'refused' | 'unconfirmed' = 'real';
vi.mock('../../system-events/dispatch.js', async original => {
  const actual = await original<typeof import('../../system-events/dispatch.js')>();
  return { ...actual, commitOptionLevelsInProcess: vi.fn(async (input: CommitOptionLevelsInput, requestId: string): Promise<CommitOptionLevelsResult> => {
    if (commitMode === 'stale') return { status: 'stale' };
    if (commitMode === 'refused') return { status: 'refused', reason: 'test_refusal' };
    if (commitMode === 'unconfirmed') return { status: 'unconfirmed' };
    if (commitMode === 'missing_basis' || commitMode === 'forged_proof') {
      // 2b r8 (DL): the basis is valid only with the HMAC proof the door mints; a stored basis whose proof does not verify
      // is not the user's answer (the predicate is graph-only, so a wrong scenario is no longer a failure mode).
      if (commitMode === 'forged_proof') {
        const edit = applyGoalSteadyEdit(jsonbGraph(), input.goal_steady!, SCENARIO);
        if (edit.kind !== 'mutated') throw new Error('attestation refused');
        const goal = (edit.mutatedGraph.nodes as Rec[]).find(n => n.kind === 'goal')!;
        goal.horizon_basis = { ...goal.horizon_basis, proof: '0'.repeat(64) };
        graphOf.set(SCENARIO, edit.mutatedGraph);
      }
      return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(jsonbGraph() as never)!, receipt: null, already_applied: false, committed_levels: [] };
    }
    return actual.commitOptionLevelsInProcess(input, requestId);
  }) };
});

import { steadyHorizonCard, STEADY_HORIZON_ANSWER } from '../steady-horizon-card.js';
import { horizonSteadyAttested } from '../../goal-target/horizon-basis.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { withGoalChanceLicence } from '../../goal-target/goal-chance-licence.js';
import { withUntestedHorizonWarning } from '../decision-input-ask.js';
import { applyGoalSteadyEdit } from '../../goal-target/goal-steady-write.js';
import { commitOptionLevelsInProcess, type CommitOptionLevelsInput, type CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { agentProposals, executableProposalId } from '../held-approval-offers.js';

type Rec = Record<string, any>;
type Chip = { id: string; label: string; message: string; detail?: string; action_type?: string };
const fixture = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as Rec;
const seed = (): Rec => {
  const graph = structuredClone(fixture.graph_with_target);
  graph.nodes.find((n: Rec) => n.kind === 'goal').goal_horizon_months = 9;
  return assignEntityRefs(projectGraphForPersistence(graph), null).graph as Rec;
};
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');
const offered = (graph: Rec, over = {}) => steadyHorizonCard({ graph, graphHash: computeAnalysisAffectingGraphHash(graph as never) ?? undefined,
  scenarioId: SCENARIO, userId: null, runReply: true, approvalHeld: false, ...over });
const jsonbGraph = (): Rec => graphOf.get(SCENARIO) as Rec;
let runs = 0;
let modelTool: Record<string, unknown> | undefined;

describe('steady horizon: one held card through the existing approved batch door', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const tool = modelTool;
      modelTool = undefined;
      return new Response(JSON.stringify({ output: tool ? [tool] : [{ type: 'message', content: [{ type: 'output_text', text: 'Your judgement stays yours.' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async req => {
      const graph = graphOf.get((req.params as { id: string }).id);
      return { graph, graph_hash: computeAnalysisAffectingGraphHash(graph as never), analysis_ready: { status: 'ready', may_run: true } };
    });
    app.post('/orchestrate/v2/turn', async req => {
      const body = req.body as { chip?: { action_type?: string } };
      if (body.chip?.action_type !== 'run_analysis') throw new Error('Only Run reaches the orchestrator; steady writes use the batch port');
      runs += 1;
      const graph = jsonbGraph();
      const env = withUntestedHorizonWarning(withGoalChanceLicence({ option_comparison: [
        { option_id: 'a', probability_of_goal: 0.62 }, { option_id: 'b', probability_of_goal: 0.41 }], inference_warnings: [] }, graph, goalOf(graph).id), graph);
      return { assistant_text: 'Analysis complete.', blocks: [{ type: 'analysis_result', data: env }],
        analysis_ready: { status: 'ready', may_run: true }, tool_results: [{ name: 'run_analysis', ran: true }], ...env };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { nextScenario(); graphOf.set(SCENARIO, seed()); runs = 0; modelTool = undefined; commitMode = 'real'; vi.mocked(commitOptionLevelsInProcess).mockClear(); });
  const turn = async (payload: Rec): Promise<Rec> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload } });
    expect(r.statusCode, r.body.slice(0, 500)).toBe(200);
    return r.json() as Rec;
  };
  const run = () => turn({ message: 'Run analysis', source: 'chip', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } });
  const cardOf = (reply: Rec): Chip => {
    const chip = (reply.suggested_actions as Chip[]).find(c => c.label === STEADY_HORIZON_ANSWER);
    expect(chip, JSON.stringify(reply.suggested_actions)).toBeDefined();
    return chip!;
  };
  const press = (chip: Chip, extra = {}) => turn({ message: chip.message, source: 'chip', chip: { id: chip.id }, ...extra });

  it('Run deterministically offers the exact unselected card, without writing; replay keeps the same card', async () => {
    const before = JSON.stringify(jsonbGraph());
    const tid = randomUUID();
    const reply = await turn({ message: 'Run analysis', source: 'chip', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: tid });
    const card = cardOf(reply);
    expect(card.id).toMatch(/^agent-approve-proposal:/);
    expect(card.detail).toBe(`Does ‘${goalOf(jsonbGraph()).label}’ stay about the same over 9 months unless you act? If yes, Olumi records that as your judgement and the chance is worked out for month 9; then run the analysis again.`);
    expect(card).not.toHaveProperty('preselected');
    expect(JSON.stringify(jsonbGraph())).toBe(before);
    expect(executableProposalId(card.id.split(':')[1]!, SCENARIO, null, computeAnalysisAffectingGraphHash(jsonbGraph() as never) ?? undefined, jsonbGraph())).toBeDefined();
    const retry = await turn({ message: 'Run analysis', source: 'chip', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, turn_id: tid });
    expect(cardOf(retry)).toEqual(card);
    expect(runs).toBe(1);
    expect(cardOf(await run())).toEqual(card);
    expect(runs).toBe(2);
    expect(JSON.stringify(jsonbGraph())).toBe(before);
  });
  it('a requested Run through the Agent tool offers the same deterministic card', async () => {
    modelTool = { type: 'function_call', name: 'run_analysis', call_id: 'requested_run', arguments: '{}' };
    cardOf(await turn({ message: 'Run analysis again.' }));
    expect(runs).toBe(1);
    expect(horizonSteadyAttested(jsonbGraph())).toBe(false);
  });
  it('JOINED: B2 nine-month Run → card → approved door → attested read-back → follow-up; no implicit Run', async () => {
    const baseHash = computeAnalysisAffectingGraphHash(jsonbGraph() as never);
    const card = cardOf(await run());
    const tid = randomUUID();
    const reply = await press(card, { turn_id: tid });
    expect(goalOf(jsonbGraph()).horizon_basis).toMatchObject({ basis: 'steady_attested', source: 'user_stated', bound_months: 9 });
    expect(commitOptionLevelsInProcess).toHaveBeenCalledWith(expect.objectContaining({
      scenario_id: SCENARIO, links: [], levels: [], goal_steady: { goal_id: goalOf(jsonbGraph()).id, months: 9 },
    }), expect.any(String));
    expect(reply.assistant_text).toContain('Recorded as your judgement. Then run the analysis again.');
    expect(horizonSteadyAttested(jsonbGraph())).toBe(true);
    expect(graphWrites.get(SCENARIO)).toBe(1);
    expect(computeAnalysisAffectingGraphHash(jsonbGraph() as never)).not.toBe(baseHash);
    expect(runs).toBe(1);
    expect(reply._agent.tool_calls).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'authorise_change', ok: true })]));
    expect(reply.suggested_actions).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'agent-run-analysis', action_type: 'run_analysis' })]));
    await press(card, { turn_id: tid });
    expect(graphWrites.get(SCENARIO)).toBe(1);
    const rerun = await run();
    expect(runs).toBe(2);
    expect((rerun.suggested_actions as Chip[]).some(c => c.label === STEADY_HORIZON_ANSWER)).toBe(false);

  });
  it('bare yes text plus model authorise_change output cannot consume the card or write', async () => {
    const card = cardOf(await run());
    const before = JSON.stringify(jsonbGraph());
    modelTool = { type: 'function_call', name: 'authorise_change', call_id: 'forged_yes', arguments: JSON.stringify({ proposal_id: card.id.split(':')[1] }) };
    await turn({ message: 'yes' });
    expect(horizonSteadyAttested(jsonbGraph())).toBe(false);
    expect(JSON.stringify(jsonbGraph())).toBe(before);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    expect(agentProposals.get(card.id.split(':')[1]!)).toBeDefined();
  });
  it('old card cannot write after H changes 9→12', async () => {
    const card = cardOf(await run());
    goalOf(jsonbGraph()).goal_horizon_months = 12;
    await press(card);
    expect(graphWrites.get(SCENARIO) ?? 0).toBe(0);
    expect(horizonSteadyAttested(jsonbGraph())).toBe(false);
  });
  it('offer requires Run, positive H, no attestation, no other approval and no admitted carrier', () => {
    const graph = seed();
    expect(offered(graph)).not.toBeNull();
    expect(offered(graph, { runReply: false })).toBeNull();
    expect(offered(graph, { approvalHeld: true })).toBeNull();
    goalOf(graph).goal_horizon_months = 0;
    expect(offered(graph)).toBeNull();
    goalOf(graph).goal_horizon_months = 9;
    const edit = applyGoalSteadyEdit(graph, { goal_id: goalOf(graph).id, months: 9 }, SCENARIO);
    expect(edit.kind).toBe('mutated');
    if (edit.kind !== 'mutated') throw new Error('attestation refused');
    expect(offered(edit.mutatedGraph)).toBeNull();
    graph.nodes.push({ id: 'stock_at_9', kind: 'outcome', label: 'Stock at month 9', nonlinear_identity: { operation: 'accumulation', factor_ids: ['stock_today', 'churn', 'inflow'], horizon_months: 9, rate_scale: 0.01, stated_in_brief: true } });
    goalOf(graph).nonlinear_identity = { operation: 'product', factor_ids: ['price', 'stock_at_9'], stated_in_brief: true };
    expect(offered(graph)).toBeNull();
  });

  it.each([undefined, 0, -1, 1.5, '9', NaN, Infinity])('no card without a positive integer held month: %s', months => {
    const graph = seed();
    goalOf(graph).goal_horizon_months = months;
    expect(offered(graph)).toBeNull();
  });
  it('requires exactly one goal and keeps the approval card-only', () => {
    const graph = seed();
    const card = offered(graph)!;
    expect(card.proposal.operations).toEqual([{ op: 'attest_goal_steady', path: goalOf(graph).id, value: { months: 9 } }]);
    agentProposals.put(card.proposal);
    expect(agentProposals.authorise({ proposal_id: card.proposal.proposal_id, scenario_id: SCENARIO,
      authenticated_user_id: null, current_graph_identity_hash: computeAnalysisAffectingGraphHash(graph as never)!,
    }).status).toBe('approval_required');
    graph.nodes.push({ ...goalOf(graph), id: 'other_goal' });
    expect(offered(graph)).toBeNull();
    graph.nodes = graph.nodes.filter((node: Rec) => node.kind !== 'goal');
    expect(offered(graph)).toBeNull();
  });

  it('P45: no card beside an UNCONFIRMED accumulation carrier (B1 before its Yes)', () => {
    const unconfirmed = seed();
    unconfirmed.nodes.push({ id: 'stock_at_9', kind: 'outcome', label: 'Stock at month 9', nonlinear_identity: { operation: 'accumulation', factor_ids: ['stock_today', 'churn', 'inflow'], horizon_months: 9, rate_scale: 0.01, stated_in_brief: true } });
    goalOf(unconfirmed).nonlinear_identity = { operation: 'product', factor_ids: ['price', 'stock_at_9'], stated_in_brief: false };
    expect(offered(unconfirmed)).toBeNull();
    // CONTROL: the same seed without the carrier is offered.
    expect(offered(seed())).not.toBeNull();
  });
  it.each(['missing_basis', 'forged_proof'] as const)('unconfirmed: committed door without a valid read-back (%s) cannot claim success', async mode => {
    const card = cardOf(await run());
    commitMode = mode;
    const reply = await press(card);
    expect(commitOptionLevelsInProcess).toHaveBeenCalledTimes(1);
    expect(horizonSteadyAttested(jsonbGraph())).toBe(false);
    expect(reply._agent.tool_calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'authorise_change', ok: false, refusal: 'not_confirmed' }),
    ]));
    expect(reply.assistant_text).not.toContain('Recorded as your judgement. Then run the analysis again.');
    expect(agentProposals.isApplied(card.id.split(':')[1]!)).toBe(false);
  });
  it.each(['stale', 'refused', 'unconfirmed'] as const)('door %s maps to the existing refusal', async mode => {
    const card = cardOf(await run());
    commitMode = mode;
    const reply = await press(card);
    expect(reply._agent.tool_calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'authorise_change', ok: false, refusal: mode === 'unconfirmed' ? 'not_confirmed' : mode }),
    ]));
    expect(horizonSteadyAttested(jsonbGraph())).toBe(false);
  });
  it('JOINED CONTROL: Run with an unconfirmed accumulation node offers no steady card', async () => {
    jsonbGraph().nodes.push({ id: 'stock_at_9', kind: 'outcome', label: 'Stock at month 9', nonlinear_identity: {
      operation: 'accumulation', factor_ids: ['stock_today', 'churn', 'inflow'], horizon_months: 9, rate_scale: 0.01, stated_in_brief: true,
    } });
    const reply = await run();
    expect(runs).toBe(1);
    expect((reply.suggested_actions as Chip[]).some(c => c.label === STEADY_HORIZON_ANSWER)).toBe(false);
    expect(commitOptionLevelsInProcess).not.toHaveBeenCalled();
  });

});
