/**
 * P0 CONTEXT (inventory output/p0-context/INVENTORY.md @ cf4ef6e6, defects 3 and 6) — the live route, 0 LLM calls.
 *
 * Defect 3: the Explain-result interpreter read the selected Run with NONE of the guard fields the Run tool gives the
 * Agent for the same Run (`goal_certainty`, `goal_chance`, `limit_checks`, the C46 `nonlinear_identity` cause), so an
 * unearned P(goal) of exactly 0 could be narrated as a certainty and a withheld leader lost its real reason.
 * Defect 6: a follow-up turn read leader permission only as the raw `analysis_state.leader_claim.permitted`, while the
 * Run turn read `claim_permissions.leader_may_be_named` (existing shared licence, including requested separable provisional): two spellings that disagree
 * when the admission mode is not `comparative_leader`.
 *
 * Every row decodes the stubbed provider request (the bytes the model reads), and the parity rows compare it with the
 * Run tool's own output for the SAME stubbed Run. Fixture: the served W3 cold read (`520aab46`, CEE `f074916`), whose
 * goal MRR carries the price x subscribers product and whose churn limit has a ratified constraint id.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRunExplanationChip, RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { CURRENT_MODEL_STATE_PREFIX, runAgentTurn } from '../runtime/agent-loop.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN } from '../../compose/analysis-state-v1.js';
import { leaderLicenceFromState } from '../../compose/leader-licence.js';
import { explanationContext } from './fixtures/run-explanation-follow-up.js';
import { readStoredGoalCertainty } from '../../tools/handlers/run-goal-certainty.js';
import { projectModelFacingRunDelta } from '../../context/model-facing-run-delta.js';
import { selectedRunContextDelta, selectedRunContextPair } from './fixtures/selected-run-context-delta.js';
import { readScenarioAnalysis } from '../../../routes/scenario-graph-analysis-read.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { deriveDecisionContextGraphHash } from '../../build-turn-context.js';
import { FROM, TO, savedRun } from '../../model-management/__tests__/version-result-fixtures.js';
import { versionRecord } from '../../model-management/__tests__/fixtures.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { issueContextPacket } from '../runtime/request-assembly.js';
import { modelFacingToolResult } from '../licensed-run-view.js';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';

type Json = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const SCENARIO = '520aab46-9ed5-4819-9d7f-498d16603943';
const CHURN = 'agent-lane:monthly_churn:<=';
/** An UNEARNED exact 0 for the baseline option, as the producer records one: one unsized path and its sentence. */
const UNEARNED_SAY = 'Keep £49 price shows a 0% chance only because the link from Pro plan price into MRR has not been sized yet.';
const UNEARNED = [
  { option_id: 'keep_49_price', probability_of_goal: 0, earned: false,
    unsized_path: { from: 'pro_plan_price', enters_goal_through: 'pro_plan_price' }, no_break_even: 'identity_not_evaluated', say: UNEARNED_SAY },
  { option_id: 'raise_to_54', probability_of_goal: 0, earned: true },
];
const VERDICTS = { per_limit: [{ constraint_id: CHURN, state: 'estimate_only', reason: 'level_user_assumption' }], joint: { state: 'estimate_only' } };
const WITHHELD_CLAIM = { permitted: false, withheld_reason: 'constraint_verdict_withheld' };

let read: Json = {};
let selectedFacts: ReturnType<typeof selectedRunContextPair> = [];
let selectedVersions = [FROM, TO];
vi.mock('../../model-management/index.js', async original => ({
  ...await original<Record<string, unknown>>(),
  getModelManagementService: () => ({
    listVersions: async () => ({ status: 'ok', value: selectedVersions }),
    getVersion: async (_scenario: string, id: string) => ({ status: 'ok', value: selectedVersions.find(v => v.id === id) }),
  }),
}));
vi.mock('../../build-turn-context.js', async original => ({
  ...await original<Record<string, unknown>>(),
  loadScenarioAnalysisFactsForRead: async () => ({ factSet: { status: 'complete', source: 'scenario', facts: selectedFacts, total_count: selectedFacts.length }, hotWindow: { status: 'ok', facts: selectedFacts } }),
}));
const fresh = (): Json => JSON.parse(JSON.stringify(SERVED)) as Json;
/** The Run turn's own `analysis_ready`: the same admission the read carries (the turn and the read agree). */
const readyOf = (r: Json): Json => ({ status: 'ready', analysis_admission: r.analysis_admission });
const graphBody = (): Json => ({ ...read, analysis_ready: readyOf(read), current_read: read.current_read ?? {} });
const turnBody = (): Json => ({ response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [],
  graph_hash: read.graph_hash, blocks: [read.analysis_result], analysis_state: read.analysis_state, analysis_ready: readyOf(read) });

const rows: Record<string, unknown>[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_scenario: string, id: string) => rows.find((r) => r.turn_id === id) ?? null),
  append: vi.fn(async (row: Record<string, unknown>) => { rows.push({ ...row, id: row.turn_id }); return { id: String(row.turn_id) }; }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

/** The Run tool's own output for the SAME stubbed Run: what a Run turn hands the Agent (`runAnalysis`). */
async function runToolOutput(): Promise<Json> {
  const dispatch: InternalDispatch = async (path) => path === '/orchestrate/v2/turn' ? { status: 200, json: turnBody() }
    : path.endsWith('/graph') ? { status: 200, json: graphBody() } : { status: 500, json: {} };
  return await createAgentCapabilities(dispatch, new ProposalStore())
    .runAnalysis({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'p0-ctx-run' } as never, { reason: 'the user pressed Run' } as never) as Json;
}
const GUARDS = ['claim_permissions', 'goal_certainty', 'goal_chance', 'limit_checks'] as const;
const guardsOf = (o: Json): Json => Object.fromEntries(GUARDS.map((k) => [k, o[k]]));

/** The `CURRENT MODEL STATE` developer item the model reads on an ordinary turn, parsed. */
function modelStateOf(body: Json): Json | undefined {
  const input = Array.isArray(body.input) ? body.input as Json[] : [];
  for (const item of input) {
    const text = item?.role === 'developer' && Array.isArray(item.content) ? item.content[0]?.text : undefined;
    if (typeof text === 'string' && text.startsWith(CURRENT_MODEL_STATE_PREFIX)) return JSON.parse(text.slice(CURRENT_MODEL_STATE_PREFIX.length)) as Json;
  }
  return undefined;
}

describe('P0 context — Explain carries the Run guard fields; one leader-permission spelling (live route)', () => {
  let app: FastifyInstance;
  let modelBodies: Json[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      modelBodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'The result depends on the assumptions in your model.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => turnBody());
    app.post('/assist/v1/scenarios/:id/graph', async () => graphBody());
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => {
    await app.close(); vi.unstubAllGlobals();
    delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW;
  });
  beforeEach(() => { read = fresh(); selectedFacts = selectedRunContextPair(read.graph_hash, read.analysis_state.run_state.computed_at); rows.length = 0; modelBodies = []; });

  type First = { suggested_actions: { id: string }[]; _agent: { session_id: string } };
  const run = async (): Promise<First> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      turn_id: randomUUID(), scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click', chip: { action_type: 'run_analysis' },
    } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as First;
  };
  const explainPayload = async (): Promise<Json> => {
    const first = await run();
    const chip = first.suggested_actions.find((c) => isRunExplanationChip(c.id));
    expect(chip, JSON.stringify(first.suggested_actions)).toBeDefined();
    const second = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { turn_id: randomUUID(), scenario_id: SCENARIO,
      agent_session_id: first._agent.session_id, message: RUN_EXPLANATION_MESSAGE, chip: { id: chip!.id } } });
    expect(second.statusCode, second.body).toBe(200);
    expect(modelBodies).toHaveLength(1);
    const ctx = explanationContext(modelBodies[0]!.input);
    expect(ctx, JSON.stringify(modelBodies[0]!.input)).toBeDefined();
    return ctx as Json;
  };
  const followUpState = async (): Promise<Json> => {
    const first = await run();
    const next = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { turn_id: randomUUID(), scenario_id: SCENARIO,
      agent_session_id: first._agent.session_id, message: 'Please describe the assumptions recorded in the model.' } });
    expect(next.statusCode, next.body).toBe(200);
    const states = modelBodies.map(modelStateOf).filter((s): s is Json => s !== undefined);
    expect(states.length, 'control: the follow-up model call carries CURRENT MODEL STATE').toBeGreaterThan(0);
    return states[0]!;
  };

  /** Real canonical reader, exact persisted executions and graph versions; no pre-neutralised result. */
  const canonicalPair = async (change?: (facts: Json[], graphs: Json[]) => void, scope: 'clear' | 'unresolved' | 'unavailable' = 'clear') => {
    const graphs = [FROM.graph, TO.graph].map(g => JSON.parse(JSON.stringify(g)) as Json);
    const fixtures = [FROM, TO].map((v, i) => savedRun(v, `execution-${i}`, `2026-10-02T0${i}:00:00.000Z`, i === 0 ? 0.62 : 0.45) as unknown as Json);
    fixtures.forEach((f, i) => { f.fact_version = 1; f.result.scenario_id = SCENARIO;
      f.result.leading_option_id = i === 0 ? 'opt-a' : 'opt-b'; f.result.summary = 'Recorded model-relative comparison.'; });
    change?.(fixtures, graphs);
    selectedVersions = graphs.map((g, i) => versionRecord(GraphStateIngressSchema.parse(g), { id: i === 0 ? FROM.id : TO.id, scenario_id: SCENARIO }));
    fixtures.forEach((f, i) => { f.result.graph_hash_at_run = deriveDecisionContextGraphHash(graphs[i]); });
    selectedFacts = fixtures.reverse().map(f => RunAnalysisHandlerFactSchema.parse(f));
    const graph = graphs[1]!;
    const admission = buildCanonicalAnalysisReadyFromGraph(graph)?.analysis_admission;
    const answer = await readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'selected-delta-test',
      analysisInvalidatedAt: null, goalScopeClaimInput: { status: scope, issues: [] } });
    read = { graph, graph_hash: deriveDecisionContextGraphHash(graph), analysis_admission: admission,
      analysis_state: answer.analysis_state, analysis_result: answer.analysis_result, current_read: answer.current_read };
    return answer;
  };
  const coldState = async (): Promise<Json> => modelFacingToolResult('get_canonical_state', await createAgentCapabilities(
    async () => ({ status: 200, json: graphBody() }), new ProposalStore(),
  ).getCanonicalState({ scenario_id: SCENARIO } as never)) as Json;

  const ordinaryLoopState = async (): Promise<Json> => {
    const caps = createAgentCapabilities(async () => ({ status: 200, json: graphBody() }), new ProposalStore());
    const state = await caps.getCanonicalState({ scenario_id: SCENARIO } as never);
    const expectation = { scenario_id: SCENARIO, authenticated_user_id: 'test-reader', graph_revision: read.graph_hash,
      current_turn: 1, binding_secret: 'selected-run-test-secret' };
    const packet = issueContextPacket({ ...expectation, captured_at_turn: 1, state }, expectation.binding_secret);
    let modelState: Json | undefined;
    await runAgentTurn({ ctx: { scenario_id: SCENARIO } as never, history: [], message: 'Describe the assumptions.',
      instructions: 'Use the supplied model.', maxOutputTokens: 100, canonicalContext: { packet, expectation } }, caps,
    async request => {
      modelState = modelStateOf(request as unknown as Json);
      return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Recorded assumptions.' }] }] };
    });
    expect(modelState).toBeDefined();
    return modelState!;
  };

  it.each(['missing separation', 'near tie', 'withheld admission', 'likely_breaks', 'withheld leaf', 'unresolved scope', 'unavailable scope'])('canonical withheld %s omits the entire delta from ordinary and recovery inputs', async kind => {
    const answer = await canonicalPair((facts, graphs) => {
      const current = facts[1]!.result;
      if (kind === 'missing separation') delete current.enrichment.robustness;
      if (kind === 'near tie') current.enrichment.robustness.near_tie.is_tie = true;
      if (kind === 'withheld leaf') current.constraint_verdict.may_name_leading_option = false;
      if (kind === 'withheld admission') graphs[1]!.nodes.find((n: Json) => n.id === 'opt-b').interventions = { n_price: { value: 12, source: 'brief_extraction' } };
      if (kind === 'likely_breaks') {
        graphs[1]!.goal_constraints = [{ constraint_id: 'limit-current', node_id: 'n_price', operator: '<=', value: 100, label: 'Price limit' }];
        current.enrichment.option_comparison = ['opt-a', 'opt-b'].map(option_id => ({ option_id, option_label: option_id === 'opt-a' ? 'Offshore partner' : 'Hire locally', constraints_decision_grade: true, constraint_probabilities: { 'limit-current': 0.2 } }));
        current.enrichment.constraint_results = [{ ...graphs[1]!.goal_constraints[0], scale_provenance: { decision_grade: true, range_unified: true, source: 'explicit_cap' } }];
      }
    }, kind === 'unresolved scope' ? 'unresolved' : kind === 'unavailable scope' ? 'unavailable' : 'clear');
    expect(answer.analysis_result, 'actual canonical result still delivered').not.toBeNull();
    expect(answer.current_read.run_delta, 'control: the UI comparison still exists').toBeDefined();
    if (kind === 'missing separation') {
      expect(answer.current_read.run_delta!.win_probabilities.length, 'the real egress retains inferable shares').toBeGreaterThan(0);
      expect(answer.current_read.run_delta!.leader.changed).toBe(true);
      expect(answer.current_read.run_delta!.leader).not.toHaveProperty('current_leading_option_id');
    }
    const wire = JSON.stringify(answer);
    expect((await (kind === 'likely_breaks' ? ordinaryLoopState() : followUpState())).analysis).not.toHaveProperty('run_delta');
    expect((await coldState()).analysis).not.toHaveProperty('run_delta');
    expect(JSON.stringify(answer)).toBe(wire);
  });

  it.each(['missing separation', 'near tie', 'withheld admission', 'likely_breaks', 'withheld leaf'])('the prior Run’s %s restriction cannot borrow the current licence', async kind => {
    await canonicalPair((facts, graphs) => {
      const prior = facts[0]!.result;
      if (kind === 'missing separation') delete prior.enrichment.robustness;
      if (kind === 'near tie') prior.enrichment.robustness.near_tie.is_tie = true;
      if (kind === 'withheld leaf') prior.constraint_verdict.may_name_leading_option = false;
      if (kind === 'withheld admission') graphs[0]!.nodes.find((n: Json) => n.id === 'opt-b').interventions = { n_price: { value: 12, source: 'brief_extraction' } };
      if (kind === 'likely_breaks') {
        graphs[0]!.goal_constraints = [{ constraint_id: 'limit-prior', node_id: 'n_price', operator: '<=', value: 100, label: 'Price limit' }];
        prior.enrichment.option_comparison = ['opt-a', 'opt-b'].map(option_id => ({ option_id, option_label: option_id === 'opt-a' ? 'Offshore partner' : 'Hire locally', constraints_decision_grade: true, constraint_probabilities: { 'limit-prior': 0.2 } }));
        prior.enrichment.constraint_results = [{ ...graphs[0]!.goal_constraints[0], scale_provenance: { decision_grade: true, range_unified: true, source: 'explicit_cap' } }];
      }
    });
    expect(read.analysis_state.leader_claim.permitted).toBe(true);
    expect(read.current_read.run_delta).toBeDefined();
    expect((await followUpState()).analysis).not.toHaveProperty('run_delta');
    expect((await coldState()).analysis).not.toHaveProperty('run_delta');
  });

  it('reader → ordinary/recovery inputs share the typed projection and preserve UI wire bytes', async () => {
    const answer = await canonicalPair();
    const delta = answer.current_read.run_delta!;
    expect(delta).toBeDefined();
    const wire = JSON.stringify(answer);
    for (const context of [await followUpState(), await coldState()]) {
      expect(context.analysis.run_delta).toEqual(projectModelFacingRunDelta(delta));
      for (const key of ['flip_thresholds', 'endpoints', 'input_coverage', 'input_changes', 'win_probabilities_unavailable']) {
        expect(context.analysis.run_delta).not.toHaveProperty(key);
      }
    }
    expect(JSON.stringify(answer)).toBe(wire);
  });

  it('a prior Run keeps its own provisional admission instead of today’s authorship', async () => {
    await canonicalPair((_facts, graphs) => {
      graphs[0] = JSON.parse(JSON.stringify(graphs[1])) as Json;
      graphs[0]!.nodes.find((n: Json) => n.id === 'n_price').observed_state.source = 'cee_inference';
    });
    expect(buildCanonicalAnalysisReadyFromGraph(selectedVersions[0]!.graph)?.analysis_admission?.permitted_analysis_mode).toBe('quantified_provisional');
    expect(read.analysis_state.leader_claim.permitted).toBe(true);
    expect((await followUpState()).analysis).not.toHaveProperty('run_delta');
    expect((await coldState()).analysis).not.toHaveProperty('run_delta');
  });

  it('unavailable prior version evidence omits the comparison without changing the wire', async () => {
    await canonicalPair();
    const wire = JSON.stringify(read.current_read);
    selectedVersions = [];
    expect((await followUpState()).analysis).not.toHaveProperty('run_delta');
    expect((await coldState()).analysis).not.toHaveProperty('run_delta');
    expect(JSON.stringify(read.current_read)).toBe(wire);
  });

  it.each(['newer same graph', 'foreign scenario', 'foreign version', 'stale comparison'])('reader → ordinary/recovery refuses substitution: %s', async kind => {
    await canonicalPair();
    const oldDelta = read.current_read.run_delta;
    const oldReference = (await coldState()).analysis.selected_run_reference;
    if (kind === 'newer same graph' || kind === 'stale comparison') {
      const next = JSON.parse(JSON.stringify(selectedFacts[0])) as Json;
      next.result.run_id = 'execution-2'; next.result.computed_at = '2026-10-02T02:00:00.000Z';
      next.result.leading_option_id = 'opt-a';
      next.result.enrichment.meta.seed_used = 'execution-2';
      next.result.enrichment.results[0].win_probability = 0.7;
      next.result.enrichment.results[1].win_probability = 0.3;
      selectedFacts.unshift(next as ReturnType<typeof selectedRunContextPair>[number]);
      const answer = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: read.graph, requestId: 'newer-run', analysisInvalidatedAt: null, goalScopeClaimInput: { status: 'clear', issues: [] } });
      read.analysis_state = answer.analysis_state; read.analysis_result = answer.analysis_result; read.current_read = answer.current_read;
      expect(read.current_read.run_delta.endpoints.current.run_id).toBe('execution-2');
      expect(read.current_read.run_delta).not.toEqual(oldDelta);
      if (kind === 'stale comparison') read.current_read = { ...read.current_read, run_delta: oldDelta };
    } else if (kind === 'foreign scenario') {
      (selectedFacts[0] as unknown as Json).result.scenario_id = 'foreign-scenario';
    } else {
      selectedVersions = selectedVersions.map(v => ({ ...v, scenario_id: 'foreign-scenario' }));
    }
    for (const context of [await followUpState(), await coldState()]) {
      if (kind === 'newer same graph') {
        expect(context.analysis.selected_run_reference).not.toBe(oldReference);
        expect(context.analysis.run_delta).toEqual(projectModelFacingRunDelta(read.current_read.run_delta));
      } else expect(context.analysis).not.toHaveProperty('run_delta');
    }
  });

  it('ordinary model input and transcript-free get_canonical_state retain the reader delta and prior qualitative bytes', async () => {
    const answer = await canonicalPair();
    const delta = answer.current_read.run_delta!;
    read.current_read = { ...read.current_read };
    delete read.current_read.run_delta;
    const dispatch: InternalDispatch = async () => ({ status: 200, json: graphBody() });
    const coldCaps = createAgentCapabilities(dispatch, new ProposalStore());
    const baseline = await coldCaps.getCanonicalState({ scenario_id: SCENARIO } as never) as Json;
    read.current_read = { ...read.current_read, run_delta: delta };
    const state = await followUpState();
    const cold = await coldCaps.getCanonicalState({ scenario_id: SCENARIO } as never) as Json;
    expect(state.analysis.run_delta).toEqual(projectModelFacingRunDelta(delta));
    expect(cold.analysis.run_delta).toEqual(projectModelFacingRunDelta(delta));
    const { run_delta: _delta, ...analysis } = cold.analysis;
    expect({ ...cold, analysis }).toEqual(baseline);
    expect(JSON.stringify({ ...cold, analysis })).toBe(JSON.stringify(baseline));
    expect(state.entities).toEqual(baseline.entities);
    expect(state.links).toEqual(baseline.links);
    expect(state.limits).toEqual(baseline.limits);
    expect(state.analysis.claim_permissions).toEqual(baseline.analysis.claim_permissions);
  });

  it('Explain and ordinary model input consume the same selected reader delta', async () => {
    const answer = await canonicalPair();
    const delta = answer.current_read.run_delta!;
    const explained = await explainPayload();
    modelBodies = [];
    const ordinary = await followUpState();
    expect(explained.canonical_state.run_delta).toEqual(delta);
    expect(ordinary.analysis.run_delta).toEqual(projectModelFacingRunDelta(delta));
  });

  it('an absent first-Run comparison does not become a fabricated no-change delta', async () => {
    expect((await followUpState()).analysis).not.toHaveProperty('run_delta');
  });

  it('goal-free canonical context keeps its qualitative carriers and does not fabricate a goal', async () => {
    read.graph.nodes = read.graph.nodes.filter((node: Json) => node.kind !== 'goal');
    delete read.graph.goal_node_id;
    read.graph.edges = read.graph.edges.filter((edge: Json) => edge.to !== 'mrr' && edge.from !== 'mrr');
    const dispatch: InternalDispatch = async () => ({ status: 200, json: graphBody() });
    const caps = createAgentCapabilities(dispatch, new ProposalStore());
    const baseline = await caps.getCanonicalState({ scenario_id: SCENARIO } as never) as Json;
    read.current_read = { run_delta: selectedRunContextDelta(read.graph_hash, read.analysis_state.run_state.computed_at) };
    const cold = await caps.getCanonicalState({ scenario_id: SCENARIO } as never) as Json;
    expect(cold.analysis).not.toHaveProperty('run_delta');
    expect(cold).not.toHaveProperty('goal');
    expect(cold).not.toHaveProperty('goals');
    const { run_delta: _delta, ...analysis } = cold.analysis;
    expect(JSON.stringify({ ...cold, analysis })).toBe(JSON.stringify(baseline));
  });

  it('D3-a: Explain on a current Run with an UNEARNED P(goal)=0 carries that option’s goal_certainty sentence', async () => {
    // Fixture control: the published contract accepts the stored decisions (else every reader says `unchecked`).
    expect(readStoredGoalCertainty(UNEARNED)).toHaveLength(2);
    read.analysis_goal_certainty = UNEARNED;
    const ctx = await explainPayload();
    // Precondition (the hazard): the selected result still shows the bare exact 0 for that option.
    const resultRow = (ctx.result.enrichment.option_comparison as Json[]).find((r) => r.option_id === 'keep_49_price');
    expect(resultRow?.probability_of_goal).toBe(0);
    const options = (ctx.goal_certainty?.options ?? []) as Json[];
    const unearned = options.find((o) => o.option_id === 'keep_49_price');
    expect(unearned, JSON.stringify(ctx.goal_certainty)).toEqual({ option: 'Keep £49 price', option_id: 'keep_49_price', earned: false, say: UNEARNED_SAY });
    expect(options.find((o) => o.option_id === 'raise_to_54')).toEqual({ option: 'Raise to £54', option_id: 'raise_to_54', probability_of_goal: 0, earned: true });
    expect(typeof ctx.goal_certainty.note).toBe('string');
  });

  it('D3-a parity: the Explain payload’s guard fields equal the Run tool’s for the same Run', async () => {
    read.analysis_goal_certainty = UNEARNED;
    const tool = await runToolOutput();
    expect(tool.goal_certainty?.options, 'control: the Run tool carries BOUND goal_certainty decisions here').toHaveLength(2);
    expect(guardsOf(await explainPayload())).toEqual(guardsOf(tool));
  });

  it('D3-b: a withheld-leader Explain carries the C46 product cause and the per-limit checks', async () => {
    read.analysis_state.leader_claim = WITHHELD_CLAIM;
    delete read.analysis_identity_evaluated_node_ids;
    read.analysis_limit_verdicts = VERDICTS;
    const ctx = await explainPayload();
    expect(ctx.claim_permissions.leader_may_be_named).toBe(false);
    expect(ctx.claim_permissions.withheld_reason).toBe('constraint_verdict_withheld');
    expect(ctx.claim_permissions.nonlinear_identity?.reason, JSON.stringify(ctx.claim_permissions)).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
    expect(ctx.claim_permissions.nonlinear_identity.say).toContain('MRR');
    expect((ctx.limit_checks?.limits ?? []).map((l: Json) => [l.constraint_id, l.state])).toEqual([[CHURN, 'estimate_only']]);
    const tool = await runToolOutput();
    expect(tool.claim_permissions.nonlinear_identity, 'control: the Run tool carries the cause here').toBeDefined();
    expect(guardsOf(ctx)).toEqual(guardsOf(tool));
  });

  it('D3-b CONTROL: a product the Run’s engine evaluated is not said as a cause (the same read’s evaluated ids are passed)', async () => {
    read.analysis_state.leader_claim = WITHHELD_CLAIM;
    expect(read.analysis_identity_evaluated_node_ids).toEqual(['mrr']);
    const ctx = await explainPayload();
    expect(ctx.claim_permissions.leader_may_be_named).toBe(false);
    expect(ctx.claim_permissions.withheld_reason).toBe('constraint_verdict_withheld');
    expect(ctx.claim_permissions.nonlinear_identity).toBeUndefined();
  });

  it('D6-a: exploratory admission and leader_claim.permitted is true — the follow-up says leader_may_be_named false, as the Run turn does', async () => {
    read.analysis_admission = { ...read.analysis_admission, permitted_analysis_mode: 'exploratory' };
    expect(read.analysis_state.leader_claim.permitted).toBe(true);
    const tool = await runToolOutput();
    expect(tool.claim_permissions.leader_may_be_named).toBe(false);
    const state = await followUpState();
    // The raw spelling still says permitted: true; the one governing spelling says no.
    expect(state.analysis.leader_claim.permitted).toBe(true);
    expect(state.analysis.claim_permissions, JSON.stringify(state.analysis)).toEqual({ leader_may_be_named: false, permitted_analysis_mode: 'exploratory' });
    expect(state.analysis.claim_permissions.leader_may_be_named).toBe(tool.claim_permissions.leader_may_be_named);
  });

  it('D6-c (DL 4563ad): over the producer’s four admission cells, a separated permitted Run reads ONE permission on the follow-up and the Run turn, never looser than the one licence', async () => {
    // The producer's joint domain (`analysis-admission.ts`): none/exploratory only with structurally_analysable false,
    // quantified_provisional/comparative_leader only with true.
    const cells = [['none', false, false], ['exploratory', false, false], ['quantified_provisional', true, true], ['comparative_leader', true, true]] as const;
    for (const [mode, analysable, nameable] of cells) {
      read = fresh();
      modelBodies = [];
      read.analysis_admission = { ...read.analysis_admission, permitted_analysis_mode: mode, structurally_analysable: analysable };
      expect(read.analysis_state.leader_claim).toEqual({ permitted: true, separation: 'separated' });
      const licence = leaderLicenceFromState(read.analysis_state, { analysis_admission: read.analysis_admission });
      const tool = await runToolOutput();
      const state = await followUpState();
      const followUp = state.analysis.claim_permissions as Json;
      expect(followUp.leader_may_be_named, mode).toBe(nameable);
      expect(followUp, mode).toEqual(tool.claim_permissions);
      // Never looser than the licence: nameable only where the one licence is not `withheld`.
      if (followUp.leader_may_be_named === true) expect(licence, mode).not.toBe('withheld');
    }
  });

  it('CTX05: ordinary and cold model input carry this selected Run’s canonical constraints and limit risks', async () => {
    read.analysis_limit_verdicts = VERDICTS;
    read.analysis_constraint_verdict_state = 'evaluated_feasible';
    read.analysis_leader_limit_risks = [{ constraint_id: CHURN, label: 'Monthly churn', source_quote: 'Churn ≤ 4%', probability: 0.3 }];
    const state = await followUpState();
    expect(state.analysis.limit_verdicts).toEqual(VERDICTS);
    expect(state.analysis.constraint_verdict_state).toBe('evaluated_feasible');
    expect(state.analysis.leader_limit_risks).toEqual(read.analysis_leader_limit_risks);
    const dispatch: InternalDispatch = async () => ({ status: 200, json: graphBody() });
    const cold = await createAgentCapabilities(dispatch, new ProposalStore()).getCanonicalState({ scenario_id: SCENARIO } as never) as Json;
    expect(cold.analysis.limit_verdicts).toEqual(state.analysis.limit_verdicts);
    expect(cold.analysis.constraint_verdict_state).toEqual(state.analysis.constraint_verdict_state);
    expect(cold.analysis.leader_limit_risks).toEqual(state.analysis.leader_limit_risks);
  });

  it.each([[null], [[]]])('CTX05: canonical leader-risk %j is retained distinctly', async (risks) => {
    read.analysis_leader_limit_risks = risks;
    read.analysis_constraint_verdict_state = null;
    const state = await followUpState();
    expect(state.analysis.leader_limit_risks).toEqual(risks);
    expect(state.analysis.constraint_verdict_state).toBeNull();
  });

  it('CTX05 CONTROL: missing selected fields do not become empty or no-risk assertions', async () => {
    delete read.analysis_limit_verdicts;
    delete read.analysis_leader_limit_risks;
    delete read.analysis_constraint_verdict_state;
    const state = await followUpState();
    expect(state.analysis).not.toHaveProperty('limit_verdicts');
    expect(state.analysis).not.toHaveProperty('leader_limit_risks');
    expect(state.analysis).not.toHaveProperty('constraint_verdict_state');
  });

  it('D6-b CONTROL: comparative_leader and permitted — leader_may_be_named true on both the Run turn and the follow-up', async () => {
    expect(read.analysis_admission.permitted_analysis_mode).toBe('comparative_leader');
    const tool = await runToolOutput();
    expect(tool.claim_permissions.leader_may_be_named).toBe(true);
    const state = await followUpState();
    expect(state.analysis.claim_permissions).toEqual({ leader_may_be_named: true, permitted_analysis_mode: 'comparative_leader' });
  });
});
