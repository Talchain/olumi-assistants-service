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
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { reconcileScenarioAnalysisFacts, SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT } from '../../context/reconcile-scenario-analysis-facts.js';
import { ModelManagementService } from '../../model-management/service.js';
import { SupabaseModelVersionStore } from '../../model-management/store-adapter.js';
import { SELECTED_RUN_DELTA_DEADLINE_MS, SELECTED_RUN_DELTA_MAX_PAGE_READS,
  SELECTED_RUN_DELTA_MAX_VERSION_READS } from '../selected-run-delta-for-model.js';

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
let unreadVersions = new Set<string>();
let versionPageFailure = false;
const versionListCalls: (number | undefined)[] = [];
let evidenceService: ModelManagementService | undefined;
let pendingFactRead: Promise<never> | undefined;
vi.mock('../../model-management/index.js', async original => ({
  ...await original<Record<string, unknown>>(),
  getModelManagementService: () => evidenceService ?? ({
    listVersions: async (_scenario: string, limit = 50, beforeSequence?: number) => {
      versionListCalls.push(beforeSequence);
      if (versionPageFailure && beforeSequence !== undefined) return { status: 'disabled' };
      return { status: 'ok', value: selectedVersions.filter(v => beforeSequence === undefined || v.version_number < beforeSequence)
        .sort((a, b) => b.version_number - a.version_number).slice(0, limit) };
    },
    getVersion: async (_scenario: string, id: string) => unreadVersions.has(id)
      ? { status: 'error', error: { code: 'store_error', recoverable: true, message: 'Offline unread version fixture.' } }
      : { status: 'ok', value: selectedVersions.find(v => v.id === id) },
  }),
}));
vi.mock('../../build-turn-context.js', async original => ({
  ...await original<Record<string, unknown>>(),
  loadScenarioAnalysisFactsForRead: async () => {
    if (pendingFactRead !== undefined) await pendingFactRead;
    return { factSet: reconcileScenarioAnalysisFacts({ scenarioId: SCENARIO,
    hotWindowFacts: [], durableRead: { status: 'ok', scenario_id: SCENARIO,
      query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT, total_count: selectedFacts.length,
      facts: selectedFacts.slice(0, SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT).map((fact, i) => ({ fact,
        fact_row_id: `selected-row-${i}`, fact_created_at: new Date(Date.UTC(2026, 9, 2, 12, 0, 59 - i)).toISOString() })) },
    }), hotWindow: { status: 'ok', facts: selectedFacts } };
  },
}));
const fresh = (): Json => JSON.parse(JSON.stringify(SERVED)) as Json;
/** The Run turn's own `analysis_ready`: the same admission the read carries (the turn and the read agree). */
const readyOf = (r: Json): Json => ({ status: 'ready', analysis_admission: r.analysis_admission });
const graphBody = (): Json => withCanonicalAnalysisView({ ...read, analysis_ready: readyOf(read), current_read: read.current_read ?? {} }, SCENARIO);
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
const guardsOf = (o: Json): Json => {
  const source = o.canonical_state === undefined ? o : { ...o.canonical_state.analysis, ...o.canonical_state.run_explanation };
  return Object.fromEntries(GUARDS.map((k) => [k, source[k]]));
};

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
  beforeEach(() => { read = fresh(); selectedFacts = selectedRunContextPair(read.graph_hash, read.analysis_state.run_state.computed_at);
    unreadVersions = new Set(); versionPageFailure = false; evidenceService = undefined; pendingFactRead = undefined;
    versionListCalls.length = 0; rows.length = 0; modelBodies = []; });
  afterEach(() => { vi.useRealTimers(); });

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
    selectedVersions = graphs.map((g, i) => versionRecord(GraphStateIngressSchema.parse(g), { id: i === 0 ? FROM.id : TO.id, scenario_id: SCENARIO, version_number: i + 1 }));
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

  const modelInput = (consumer: 'ordinary' | 'cold') => consumer === 'ordinary' ? ordinaryLoopState() : coldState();
  // Real service + adapter, with only the database transport stubbed: strict payloads and signals reach the store.
  const evidenceStore = (options: { pageSize?: number; pageSizes?: number[]; missingPage?: number; missingPayload?: null;
    stall?: 'initial page' | 'later page' | 'version'; pageDelay?: number } = {}) => {
    let pageReads = 0;
    const versionReads: string[] = [];
    const signals: AbortSignal[] = [];
    let rejectPending!: (error: Error) => void;
    const pending = new Promise<never>((_resolve, reject) => { rejectPending = reject; });
    // A reader without cancellation may reject after abandonment; always keep that rejection handled.
    void pending.catch(() => undefined);
    const client = { from: () => {
      let cursor: number | undefined;
      let versionId: string | undefined;
      const chain = {
        select: () => chain,
        eq: (key: string, value: string) => { if (key === 'id') versionId = value; return chain; },
        order: () => chain,
        lt: (_key: string, value: number) => { cursor = value; return chain; },
        abortSignal: (signal: AbortSignal) => { signals.push(signal); return chain; },
        limit: async (limit: number) => {
          pageReads++;
          versionListCalls.push(cursor);
          if ((options.stall === 'initial page' && pageReads === 1)
            || (options.stall === 'later page' && pageReads === 2)) await pending;
          if (options.pageDelay !== undefined) await new Promise(resolve => setTimeout(resolve, options.pageDelay));
          if (pageReads === options.missingPage) return { data: options.missingPayload, error: null };
          return { data: selectedVersions.filter(v => cursor === undefined || v.version_number < cursor)
            .sort((a, b) => b.version_number - a.version_number)
            .slice(0, Math.min(limit, options.pageSizes?.[pageReads - 1] ?? options.pageSize ?? limit)), error: null };
        },
        maybeSingle: async () => {
          versionReads.push(versionId!);
          if (options.stall === 'version') await pending;
          return { data: selectedVersions.find(v => v.id === versionId) ?? null, error: null };
        },
      };
      return chain;
    } } as unknown as SupabaseClient;
    evidenceService = new ModelManagementService({ store: new SupabaseModelVersionStore(client), isEnabled: () => true });
    return { versionReads, signals, rejectPending };
  };
  const endpointConsumers = (['prior', 'current'] as const).flatMap(endpoint =>
    (['ordinary', 'cold'] as const).map(consumer => ({ endpoint, consumer })));
  const canonicalPairWithEdgeAuthorship = (endpoint: 'prior' | 'current') => canonicalPair((_facts, graphs) => {
    const graph = graphs[endpoint === 'prior' ? 0 : 1]!;
    graph.nodes.find((n: Json) => n.id === 'n_price').observed_state.source = 'cee_inference';
    graph.edges.forEach((e: Json) => { e.provenance.source = 'brief_extraction'; e.defaulted = false; });
  });
  const addCappedHistory = async () => {
    const older = Array.from({ length: 19 }, (_, i) => {
      const fact = JSON.parse(JSON.stringify(selectedFacts[1])) as Json;
      fact.result.run_id = `older-${i}`;
      fact.result.computed_at = new Date(Date.UTC(2026, 9, 1, 0, 0, 59 - i)).toISOString();
      return RunAnalysisHandlerFactSchema.parse(fact);
    });
    selectedFacts.push(...older);
    const answer = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: read.graph, requestId: 'capped-selected-pair',
      analysisInvalidatedAt: null, goalScopeClaimInput: { status: 'clear', issues: [] } });
    read.analysis_state = answer.analysis_state; read.analysis_result = answer.analysis_result; read.current_read = answer.current_read;
    return answer;
  };

  it.each(endpointConsumers)(
    'saved admission evidence: $endpoint / $consumer / defaulted edge cannot borrow today’s permission', async ({ endpoint, consumer }) => {
      const index = endpoint === 'prior' ? 0 : 1;
      await canonicalPairWithEdgeAuthorship(endpoint);
      const permitted = selectedVersions[index]!;
      expect(buildCanonicalAnalysisReadyFromGraph(permitted.graph)?.analysis_admission?.permitted_analysis_mode).toBe('comparative_leader');
      const restrictive = JSON.parse(JSON.stringify(permitted.graph)) as Json;
      restrictive.edges.forEach((e: Json) => { e.defaulted = true; });
      expect(deriveDecisionContextGraphHash(restrictive)).toBe(deriveDecisionContextGraphHash(permitted.graph));
      expect(buildCanonicalAnalysisReadyFromGraph(restrictive)?.analysis_admission?.permitted_analysis_mode).toBe('quantified_provisional');
      // Retain a permissive same-hash match as well: any restrictive candidate must win.
      selectedVersions.push(versionRecord(GraphStateIngressSchema.parse(restrictive), { id: 'restrictive-version', scenario_id: SCENARIO, version_number: 3 }));
      const wire = JSON.stringify(read.current_read);
      expect(read.analysis_state.leader_claim.permitted).toBe(true);
      expect((await modelInput(consumer)).analysis).not.toHaveProperty('run_delta');
      expect(JSON.stringify(read.current_read)).toBe(wire);
    });

  it.each(endpointConsumers)('missing recorded $endpoint evidence omits the delta from $consumer', async ({ endpoint, consumer }) => {
    await canonicalPair();
    const delta = read.current_read.run_delta;
    expect((await modelInput(consumer)).analysis.run_delta).toEqual(projectModelFacingRunDelta(delta));
    const wire = JSON.stringify(read.current_read);
    selectedVersions.splice(endpoint === 'prior' ? 0 : 1, 1);
    expect((await modelInput(consumer)).analysis).not.toHaveProperty('run_delta');
    expect(JSON.stringify(read.current_read)).toBe(wire);
  });

  it.each(endpointConsumers)('oversized version history: hidden restrictive $endpoint evidence cannot license $consumer', async ({ endpoint, consumer }) => {
    const index = endpoint === 'prior' ? 0 : 1;
    await canonicalPairWithEdgeAuthorship(endpoint);
    const graph = selectedVersions[index]!.graph;
    const restrictive = JSON.parse(JSON.stringify(graph)) as Json;
    restrictive.edges.forEach((e: Json) => { e.defaulted = true; });
    expect(deriveDecisionContextGraphHash(restrictive)).toBe(deriveDecisionContextGraphHash(graph));
    selectedVersions = [versionRecord(GraphStateIngressSchema.parse(restrictive), { id: 'hidden-restrictive', scenario_id: SCENARIO, version_number: 1 }),
      ...Array.from({ length: 50 }, (_, i) => ({ ...selectedVersions[i % 2]!, id: `permissive-${i}`, version_number: i + 2 }))];
    const wire = JSON.stringify(read.current_read);
    expect((await modelInput(consumer)).analysis).not.toHaveProperty('run_delta');
    expect(versionListCalls).toHaveLength(SELECTED_RUN_DELTA_MAX_PAGE_READS);
    expect(JSON.stringify(read.current_read)).toBe(wire);
  });

  it.each((['ordinary', 'cold'] as const).flatMap(consumer => [false, true].map(failed => ({ consumer, failed }))))(
    'oversized version history: exactly 50 / $consumer / next-page failure=$failed omits', async ({ consumer, failed }) => {
      await canonicalPair();
      selectedVersions = Array.from({ length: 50 }, (_, i) => ({ ...selectedVersions[i % 2]!, id: `version-${i}`, version_number: i + 1 }));
      versionPageFailure = failed;
      const state = await modelInput(consumer);
      expect(versionListCalls).toHaveLength(failed ? 2 : SELECTED_RUN_DELTA_MAX_PAGE_READS);
      expect(state.analysis).not.toHaveProperty('run_delta');
    });

  it.each(endpointConsumers.flatMap(row => (['first', 'later'] as const).map(page => ({ ...row, page }))))(
    'short $page page: hidden restrictive $endpoint evidence omits from $consumer', async ({ endpoint, consumer, page }) => {
      await canonicalPairWithEdgeAuthorship(endpoint);
      const base = selectedVersions[endpoint === 'prior' ? 0 : 1]!;
      const restrictive = JSON.parse(JSON.stringify(base.graph)) as Json;
      restrictive.edges.forEach((edge: Json) => { edge.defaulted = true; });
      expect(deriveDecisionContextGraphHash(restrictive)).toBe(deriveDecisionContextGraphHash(base.graph));
      expect(buildCanonicalAnalysisReadyFromGraph(restrictive)?.analysis_admission?.permitted_analysis_mode).toBe('quantified_provisional');
      const permissiveCount = page === 'first' ? 2 : 6;
      selectedVersions = [versionRecord(GraphStateIngressSchema.parse(restrictive), {
        id: 'short-page-restriction', scenario_id: SCENARIO, version_number: 1,
      }), ...Array.from({ length: permissiveCount }, (_, i) => ({ ...selectedVersions[i % 2]!, id: `short-permissive-${i}`, version_number: i + 2 }))];
      const transport = evidenceStore({ pageSizes: page === 'first' ? [2] : [4, 2] });
      const wire = JSON.stringify(read.current_read);
      expect((await modelInput(consumer)).analysis).not.toHaveProperty('run_delta');
      expect(versionListCalls).toEqual(page === 'first' ? [undefined, 2] : [undefined, 4, 2]);
      expect(transport.versionReads).toContain('short-page-restriction');
      expect(JSON.stringify(read.current_read)).toBe(wire);
    });

  it.each(['ordinary', 'cold'] as const)('short first and later pages require a positively empty page for $0', async consumer => {
    await canonicalPair();
    selectedVersions.push({ ...selectedVersions[0]!, id: 'extra-permissive', version_number: 3 });
    evidenceStore({ pageSize: 2 });
    const delta = read.current_read.run_delta;
    expect((await modelInput(consumer)).analysis.run_delta).toEqual(projectModelFacingRunDelta(delta));
    expect(versionListCalls).toEqual([undefined, 2, 1]);
  });

  it.each(endpointConsumers.flatMap(row => [null, undefined].map(payload => ({ ...row, payload }))))(
    'missing page payload $payload after permissive $endpoint matches omits from $consumer', async ({ endpoint, consumer, payload }) => {
      await canonicalPairWithEdgeAuthorship(endpoint);
      // Positive control: these exact graphs and executions do license the comparison when exhaustion is confirmed.
      expect((await modelInput(consumer)).analysis.run_delta).toEqual(projectModelFacingRunDelta(read.current_read.run_delta));
      versionListCalls.length = 0;
      const transport = evidenceStore({ missingPage: 2, missingPayload: payload });
      const wire = JSON.stringify(read.current_read);
      expect((await modelInput(consumer)).analysis).not.toHaveProperty('run_delta');
      expect(versionListCalls).toEqual([undefined, 1]);
      expect(transport.versionReads).toHaveLength(2);
      expect(JSON.stringify(read.current_read)).toBe(wire);
    });

  it.each((['ordinary', 'cold'] as const).flatMap(consumer =>
    (['facts', 'initial page', 'later page', 'version'] as const).map(stall => ({ consumer, stall }))))(
    'total deadline: stalled $stall omits from $consumer within the budget', async ({ consumer, stall }) => {
      await canonicalPair();
      const transport = evidenceStore(stall === 'facts' ? {} : { stall });
      if (stall === 'facts') pendingFactRead = new Promise<never>((_resolve, reject) => { transport.rejectPending = reject; });
      const wire = JSON.stringify(read.current_read);
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
      const started = Date.now();
      let settled = false;
      const result = modelInput(consumer).then(state => { settled = true; return state; });
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      if (stall === 'facts') expect(versionListCalls).toHaveLength(0);
      else if (stall === 'initial page') expect(versionListCalls).toHaveLength(1);
      else if (stall === 'later page') { expect(versionListCalls).toHaveLength(2); expect(transport.versionReads).toHaveLength(2); }
      else expect(transport.versionReads).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(SELECTED_RUN_DELTA_DEADLINE_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled, 'the user turn must resolve despite an uncancellable read').toBe(true);
      expect((await result).analysis).not.toHaveProperty('run_delta');
      expect(Date.now() - started).toBeLessThanOrEqual(SELECTED_RUN_DELTA_DEADLINE_MS);
      expect(transport.signals).toHaveLength(versionListCalls.length + transport.versionReads.length);
      expect(transport.signals.every(signal => signal.aborted)).toBe(true);
      const readsAtDeadline = [versionListCalls.length, transport.versionReads.length];
      transport.rejectPending(new Error('Late abandoned read rejection.'));
      await vi.advanceTimersByTimeAsync(0);
      expect([versionListCalls.length, transport.versionReads.length]).toEqual(readsAtDeadline);
      expect(JSON.stringify(read.current_read)).toBe(wire);
    });

  it.each(['ordinary', 'cold'] as const)('total deadline spans multiple successful reads for $0', async consumer => {
    await canonicalPair();
    evidenceStore({ pageSize: 1, pageDelay: 600 });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let settled = false;
    const result = modelInput(consumer).then(state => { settled = true; return state; });
    await vi.advanceTimersByTimeAsync(SELECTED_RUN_DELTA_DEADLINE_MS);
    expect(versionListCalls).toEqual([undefined, 2, 1]);
    expect(settled).toBe(true);
    expect((await result).analysis).not.toHaveProperty('run_delta');
    await vi.advanceTimersByTimeAsync(600);
    expect(versionListCalls).toHaveLength(3);
  });

  it.each(['ordinary', 'cold'] as const)('version work limit: 2,000 valid versions omit promptly from $0', async consumer => {
    await canonicalPair();
    selectedVersions = Array.from({ length: 2000 }, (_, i) => ({ ...selectedVersions[i % 2]!, id: `large-history-${i}`, version_number: i + 1 }));
    const transport = evidenceStore();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const started = Date.now();
    let settled = false;
    const result = modelInput(consumer).then(state => { settled = true; return state; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled, 'work exhaustion must resolve without waiting for the deadline').toBe(true);
    expect((await result).analysis).not.toHaveProperty('run_delta');
    expect(Date.now() - started).toBeLessThanOrEqual(SELECTED_RUN_DELTA_DEADLINE_MS);
    expect(versionListCalls).toHaveLength(SELECTED_RUN_DELTA_MAX_PAGE_READS);
    expect(transport.versionReads).toHaveLength(SELECTED_RUN_DELTA_MAX_VERSION_READS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each((['ordinary', 'cold'] as const).flatMap(consumer => [12, 13].map(count => ({ consumer, count }))))(
    'version work boundary: $count valid versions / $consumer', async ({ consumer, count }) => {
      await canonicalPair();
      selectedVersions = Array.from({ length: count }, (_, i) => ({ ...selectedVersions[i % 2]!, id: `boundary-${i}`, version_number: i + 1 }));
      const transport = evidenceStore();
      const state = await modelInput(consumer);
      if (count === 12) expect(state.analysis.run_delta).toEqual(projectModelFacingRunDelta(read.current_read.run_delta));
      else expect(state.analysis).not.toHaveProperty('run_delta');
      expect(transport.versionReads).toHaveLength(12);
    });

  it.each(['ordinary', 'cold'] as const)('page work boundary: three nonempty pages and one empty page license $0', async consumer => {
    await canonicalPair();
    selectedVersions.push({ ...selectedVersions[0]!, id: 'page-boundary-extra', version_number: 3 });
    evidenceStore({ pageSize: 1 });
    expect((await modelInput(consumer)).analysis.run_delta).toEqual(projectModelFacingRunDelta(read.current_read.run_delta));
    expect(versionListCalls).toHaveLength(4);
  });

  it.each(['ordinary', 'cold'] as const)('page work limit: no empty page within four reads omits promptly from $0', async consumer => {
    await canonicalPair();
    selectedVersions = Array.from({ length: 4 }, (_, i) => ({ ...selectedVersions[i % 2]!, id: `page-budget-${i}`, version_number: i + 1 }));
    const transport = evidenceStore({ pageSize: 1 });
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let settled = false;
    const result = modelInput(consumer).then(state => { settled = true; return state; });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect((await result).analysis).not.toHaveProperty('run_delta');
    expect(versionListCalls).toHaveLength(SELECTED_RUN_DELTA_MAX_PAGE_READS);
    expect(transport.versionReads).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(endpointConsumers.flatMap(row => (['unread', 'unconfirmed', 'incompatible'] as const).flatMap(evidence =>
    (['newer', 'older'] as const).map(order => ({ ...row, evidence, order }))))) (
    'unresolved version candidate: $endpoint / $consumer / $evidence / $order cannot be skipped', async ({ endpoint, consumer, evidence, order }) => {
      await canonicalPairWithEdgeAuthorship(endpoint);
      const base = selectedVersions[endpoint === 'prior' ? 0 : 1]!;
      const graph = JSON.parse(JSON.stringify(base.graph)) as Json;
      if (evidence === 'incompatible') graph.nodes.find((n: Json) => n.id === 'n_revenue').goal_threshold_unit = 'USD/month';
      else graph.edges.forEach((e: Json) => { e.defaulted = true; });
      expect(deriveDecisionContextGraphHash(graph)).toBe(deriveDecisionContextGraphHash(base.graph));
      const candidate = versionRecord(GraphStateIngressSchema.parse(graph), { id: 'unresolved-candidate', scenario_id: SCENARIO,
        version_number: order === 'newer' ? 3 : 1,
        ...(evidence === 'unconfirmed' ? { identity_normaliser_version: 'unconfirmed' } : {}) });
      if (order === 'older') selectedVersions = selectedVersions.map(v => ({ ...v, version_number: v.version_number + 1 }));
      selectedVersions.push(candidate);
      if (evidence === 'unread') unreadVersions.add(candidate.id);
      const wire = JSON.stringify(read.current_read);
      expect((await modelInput(consumer)).analysis).not.toHaveProperty('run_delta');
      expect(JSON.stringify(read.current_read)).toBe(wire);
    });

  it.each(['ordinary', 'cold'] as const)('capped reader → $0 retains the validated newest exact pair', async consumer => {
    await canonicalPair();
    const before = read.current_read.run_delta;
    const answer = await addCappedHistory();
    expect(selectedFacts).toHaveLength(21);
    expect(answer.current_read.run_delta).toEqual(before);
    const wire = JSON.stringify(answer);
    expect((await modelInput(consumer)).analysis.run_delta).toEqual(projectModelFacingRunDelta(before));
    expect(JSON.stringify(answer)).toBe(wire);
  });

  it.each(endpointConsumers.flatMap(row => [false, true].map(capped => ({ ...row, capped }))))(
    'Run-ID-only substitution: $endpoint / $consumer / capped=$capped omits the stale delta', async ({ endpoint, consumer, capped }) => {
      await canonicalPair();
      if (capped) await addCappedHistory();
      const wire = JSON.stringify(read.current_read);
      const before = JSON.parse(JSON.stringify(selectedFacts)) as Json[];
      const index = endpoint === 'current' ? 0 : 1;
      (selectedFacts[index] as unknown as Json).result.run_id = `substituted-${endpoint}`;
      // Only execution identity changes; every graph hash, timestamp and result byte is otherwise identical.
      const after = JSON.parse(JSON.stringify(selectedFacts)) as Json[];
      after[index]!.result.run_id = before[index]!.result.run_id;
      expect(after).toEqual(before);
      expect((await modelInput(consumer)).analysis).not.toHaveProperty('run_delta');
      expect(JSON.stringify(read.current_read)).toBe(wire);
    });

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

  // ⭐ S7 (D4 lease #87 6005636960; DL YES with conditions): a pair the model is NOT shown as licensed still gets Olumi's own
  // leader-free record of what changed (`rerun_record`, rerun-explanation.ts), so the typed "what changed since the last run?"
  // has the record. The pins above are unchanged: `run_delta` stays out of the model's input for these pairs.
  const leaderFreePins = (record: Json) => {
    expect(Object.keys(record).sort()).toEqual(['attribution_case', 'code_line', 'prior_withheld', 'use']);
    for (const [field, value] of Object.entries(record)) {
      const said = JSON.stringify(value);
      for (const id of ['opt-a', 'opt-b']) expect(said, `${field} carries option id ${id}`).not.toContain(id);
      expect(said, `${field} names a leader`).not.toMatch(/leader|leading_option/i);
      expect(said, `${field} carries win probabilities`).not.toMatch(/win_probabilit/i);
      expect(said, `${field} carries a share`).not.toMatch(/\d\s?%/);
    }
  };

  it.each(['missing separation', 'near tie', 'withheld leaf'])('S7: canonical withheld %s → the typed loop and the cold read carry the leader-free rerun record, never the delta', async kind => {
    const answer = await canonicalPair((facts) => {
      const current = facts[1]!.result;
      if (kind === 'missing separation') delete current.enrichment.robustness;
      if (kind === 'near tie') current.enrichment.robustness.near_tie.is_tie = true;
      if (kind === 'withheld leaf') current.constraint_verdict.may_name_leading_option = false;
    });
    expect(answer.current_read.run_delta, 'control: the wire delta exists').toBeDefined();
    for (const state of [await ordinaryLoopState(), await coldState()]) {
      expect(state.analysis).not.toHaveProperty('run_delta');
      expect(state.rerun_record, 'the typed path has the record').toBeDefined();
      leaderFreePins(state.rerun_record);
    }
  });

  it('S7: the prior Run\u2019s restriction (withheld → licensed pair) → the record, leader-free; the current licence is not borrowed', async () => {
    await canonicalPair((facts) => { facts[0]!.result.constraint_verdict.may_name_leading_option = false; });
    expect(read.analysis_state.leader_claim.permitted).toBe(true);
    const state = await ordinaryLoopState();
    expect(state.analysis).not.toHaveProperty('run_delta');
    leaderFreePins(state.rerun_record);
  });

  it('S7 TWIN (DL condition 2): a pair proven licensed at both ends → NO rerun record; the model sees the licensed delta exactly as before', async () => {
    await canonicalPair();
    const delta = read.current_read.run_delta;
    for (const state of [await ordinaryLoopState(), await coldState()]) {
      expect(state.analysis.run_delta).toEqual(projectModelFacingRunDelta(delta));
      expect(state).not.toHaveProperty('rerun_record');
    }
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
    expect(explained.canonical_state.analysis.run_delta).toEqual(projectModelFacingRunDelta(delta));
    expect(explained.canonical_state.analysis.selected_run_reference).toBe(ordinary.analysis.selected_run_reference);
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
    // ⚠ S7 (D4 lease #87 6005636960): the ONE intended difference. This pair's delta is not shown to the model as licensed,
    // so the model gets Olumi's leader-free record of it instead, pinned by identity here. EVERYTHING ELSE stays byte-equal
    // to the baseline: still no goal fabricated, nothing else moved.
    const { rerun_record: rerunRecord, ...withoutRecord } = cold;
    expect(baseline).not.toHaveProperty('rerun_record');
    leaderFreePins(rerunRecord);
    expect(rerunRecord.code_line).toBe('Nothing you entered changed.');
    expect(JSON.stringify(rerunRecord)).not.toMatch(/\bgoal\b(?!_path)/i);
    expect(JSON.stringify({ ...withoutRecord, analysis })).toBe(JSON.stringify(baseline));
  });

  it('D3-a: Explain on a current Run with an UNEARNED P(goal)=0 carries that option’s goal_certainty sentence', async () => {
    // Fixture control: the published contract accepts the stored decisions (else every reader says `unchecked`).
    expect(readStoredGoalCertainty(UNEARNED)).toHaveLength(2);
    read.analysis_goal_certainty = UNEARNED;
    const ctx = await explainPayload();
    // Precondition (the hazard): the selected result still shows the bare exact 0 for that option.
    const resultRow = (read.analysis_result.enrichment.option_comparison as Json[]).find((r) => r.option_id === 'keep_49_price');
    expect(resultRow?.probability_of_goal).toBe(0);
    expect(ctx.canonical_state.analysis.saved_run_options.find((r: Json) => r.option_id === 'keep_49_price')).not.toHaveProperty('probability_of_goal');
    const options = (ctx.canonical_state.analysis.goal_certainty?.options ?? []) as Json[];
    const unearned = options.find((o) => o.option_id === 'keep_49_price');
    expect(unearned, JSON.stringify(ctx.canonical_state.analysis.goal_certainty)).toEqual({ option: 'Keep £49 price', option_id: 'keep_49_price', earned: false, say: UNEARNED_SAY });
    expect(options.find((o) => o.option_id === 'raise_to_54')).toEqual({ option: 'Raise to £54', option_id: 'raise_to_54', probability_of_goal: 0, earned: true });
    expect(typeof ctx.canonical_state.analysis.goal_certainty.note).toBe('string');
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
    expect(ctx.canonical_state.run_explanation.claim_permissions.leader_may_be_named).toBe(false);
    expect(ctx.canonical_state.run_explanation.claim_permissions.withheld_reason).toBe('constraint_verdict_withheld');
    expect(ctx.canonical_state.run_explanation.claim_permissions.nonlinear_identity?.reason, JSON.stringify(ctx.canonical_state.run_explanation.claim_permissions)).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
    expect(ctx.canonical_state.run_explanation.claim_permissions.nonlinear_identity.say).toContain('MRR');
    expect((ctx.canonical_state.analysis.limit_checks?.limits ?? []).map((l: Json) => [l.constraint_id, l.state])).toEqual([[CHURN, 'estimate_only']]);
    const tool = await runToolOutput();
    expect(tool.claim_permissions.nonlinear_identity, 'control: the Run tool carries the cause here').toBeDefined();
    expect(guardsOf(ctx)).toEqual(guardsOf(tool));
  });

  it('D3-b CONTROL: a product the Run’s engine evaluated is not said as a cause (the same read’s evaluated ids are passed)', async () => {
    read.analysis_state.leader_claim = WITHHELD_CLAIM;
    expect(read.analysis_identity_evaluated_node_ids).toEqual(['mrr']);
    const ctx = await explainPayload();
    expect(ctx.canonical_state.run_explanation.claim_permissions.leader_may_be_named).toBe(false);
    expect(ctx.canonical_state.run_explanation.claim_permissions.withheld_reason).toBe('constraint_verdict_withheld');
    expect(ctx.canonical_state.run_explanation.claim_permissions.nonlinear_identity).toBeUndefined();
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
