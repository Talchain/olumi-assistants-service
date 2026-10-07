import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FROM, PRIOR } from '../../model-management/__tests__/version-result-fixtures.js';
import { goalScopeClaimInput, readGoalScopeClaimInput } from '../../compose/goal-scope-claim-input.js';
import { composeAnalysisStateV1, WITHHELD_NEAR_TIE } from '../../compose/analysis-state-v1.js';
import { selectCanonicalAnalysisState } from '../../context/canonical-analysis-state.js';
import { pickLatestRawRobustness } from '../../coaching/pick-raw-robustness.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { reconciliationPending } from '../goal-scope.js';
import { enforceLeaderLicenceAtFinalEgress, FINAL_EGRESS_FAILED_TEXT } from '../leader-final-egress.js';
import { buildAppliedGraphWireField } from '../../compose/applied-graph-emit.js';
import { HandlerFactSchema } from '@talchain/schemas/orchestrator';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { PendingAction } from '../../session/pending-action.js';
import type { ScenarioAnalysisRead } from '../../../routes/scenario-graph-analysis-read.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { RUN_RESULT_READY_TEXT } from '../run-explanation.js';

// Real Fastify route, scripted tool results and in-memory persistence; no provider or network.
const scripted = vi.hoisted(() => ({ results: [] as Record<string, unknown>[], prior: [] as PendingAction[],
  rows: [] as Record<string, unknown>[], concurrent: false, calls: 0, toolName: 'get_canonical_state',
  measured: false, measureCalls: 0, duringMeasure: null as null | (() => void), joinScopeRead: true,
  concurrentText: 'Offshore partner leads.', hideAnswerOnce: false,
  graphMode: 'ok', modelNames: false, retireOnAppend: false, durableNearTie: false, durableUnavailable: false,
  canonicalResult: false, scopeUnavailableOnce: false, retireAfterGraphRead: 0, graphReads: [] as ScenarioAnalysisRead[] }));
vi.mock('../../handlers/decision-flip-dispatch.js', async original => ({
  ...await original<Record<string, unknown>>(),
  dispatchDecisionFlip: vi.fn(async (params: { candidateLinks: { from_id: string; to_id: string }[] }) => {
    scripted.measureCalls += 1;
    scripted.duringMeasure?.();
    const link = params.candidateLinks[0]!;
    return { status: 'measured', run: { graph_hash_at_run: RESULT.graph_hash_at_run, computed_at: RESULT.computed_at },
      links: [link], block: { method: 'affine_crn_replicates_v1', leader_option_id: 'opt-a', replicates: 4,
        bound_abs: 0.01, bound_rel: 0.15, grid_step: 0.0025,
        links: [{ ...link, status: 'no_change', reason: null, current_mean: 0.6, threshold: null,
          replicate_thresholds: [null, null, null, null], replicate_range: null, to_option_id: null }] } };
  }),
}));
vi.mock('../runtime/agent-loop.js', async original => ({
  ...await original<Record<string, unknown>>(),
  runAgentTurn: vi.fn(async () => {
    scripted.calls += 1;
    return { assistant_text: 'Offshore partner leads.', items: [],
      tool_calls: scripted.results.map(() => ({ name: scripted.toolName, ok: true, mutated: false })),
      tool_results: scripted.results, mutated: false, hops: 1, stopped_reason: 'answered', timing: {} };
  }),
}));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => ({
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readRecent: vi.fn(async () => []),
  // This control models a readable, empty history; a missing reader now means unknown, not empty.
  readGuidanceHistory: vi.fn(async () => ({})),
  readScenarioRunAnalysisFactsFor: vi.fn(async (sid: string) => {
    expect(sid).toBe(SID); expect(RESULT.scenario_id).toBe(sid); expect(RESULT.run_id).toBe('bound-prior');
    if (scripted.durableUnavailable) throw new Error('canonical facts unavailable');
    const fact = scripted.durableNearTie ? HandlerFactSchema.parse({ ...DURABLE_PRIOR,
      result: { ...DURABLE_PRIOR.result, enrichment: { ...DURABLE_PRIOR.result.enrichment, robustness: { level: 'high', near_tie: { is_tie: true } } } } }) : DURABLE_PRIOR;
    return { facts: [{ fact, fact_row_id: 'bound-prior-row', fact_created_at: RESULT.computed_at }], total_count: 1 };
  }),
  readCommittedTurn: vi.fn(async (_sid: string, tid: string) => {
    if (tid === TID && scripted.hideAnswerOnce) { scripted.hideAnswerOnce = false; return null; }
    return scripted.rows.find(row => row.turn_id === tid) ?? null;
  }),
  readMostRecentPendingActions: vi.fn(async () => scripted.prior),
  append: vi.fn(async (row: Record<string, unknown>) => {
    if (scripted.retireOnAppend && row.turn_id === TID) scripted.prior = [];
    scripted.rows.push({ ...row, assistant_message: scripted.concurrent ? scripted.concurrentText : row.assistantMessage,
      // The concurrent winner did not observe the losing request's fresh issue.
      ...(scripted.concurrent ? { pending_actions: [] } : {}) });
    return { id: 'answer-row', ...(scripted.concurrent ? { replayedPriorTurn: true } : {}) };
  }),
}) }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

const SID = FROM.scenario_id;
const OTHER_SID = '99999999-9999-4999-8999-999999999999';
const TID = '88888888-8888-4888-8888-888888888888';
const PENDING_ID = '77777777-7777-4777-8777-777777777777';
const AT = '2026-10-02T00:10:00.000Z';
const RESULT = (PRIOR as unknown as { result: { scenario_id: string; run_id: string; graph_hash_at_run: string; computed_at: string } }).result;
const DURABLE_PRIOR = (() => {
  const fact = HandlerFactSchema.parse({ ...PRIOR, fact_version: 1,
    // A persisted leader claim exercises the real reader's conditional summary projection.
    result: { ...(PRIOR as unknown as { result: Record<string, unknown> }).result, leading_option_id: 'opt-a', summary: 'Offshore partner leads.' } });
  if (fact.fact_type !== 'run_analysis') throw new Error('Expected the bound canonical Run fixture');
  return fact;
})();
const baselineUrl = new URL('./fixtures/fresh-goal-scope-permitted-baseline.json', import.meta.url);
const measuredBaselineUrl = new URL('./fixtures/fresh-goal-scope-measured-baseline.json', import.meta.url);
const PRESS = { id: 'agent-next-what-would-change' };
const MEASURED_MESSAGE = 'What would change the result?';
const pending = (scenarioId = SID): PendingAction => ({ ...reconciliationPending(scenarioId, {
  kind: 'reconcile_goal_scope', goal_id: 'n_revenue', goal_label: 'Revenue',
  declared_scope: { modelled: 'all revenue', alternative: 'one stream', stated_in_brief: true },
  question: 'Which revenue scope should this model represent?', /* #2613-successor (Science d5 6006584860): an UNTYPED question no longer blocks; this fixture's open issue is a typed one. */ scope: { modelled: 'all revenue', alternative: 'one stream', extent: 'total', stated_in_brief: true, source: { quote: 'all revenue' } }, expected: 'billing_basis', operands: [], derivations: [],
}, Date.parse(AT)), id: PENDING_ID });

/**
 * S-B (lane ACTION-BAR-CEE): every live agent-lane turn carries the `action_bar` v1 sidecar, and an action press its `_action`
 * receipt. Both are orthogonal to the leader egress these captures pin, so they are taken out (the bar asserted present and
 * versioned first) and every OTHER byte must still equal the pristine pre-fix capture: the baselines are not re-recorded.
 */
function withoutActionBar(raw: string, live: boolean): string {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  // A replay re-sends the stored answer: it derives no bar (the reload GET does).
  if (!live) { expect(parsed['action_bar']).toBeUndefined(); expect(parsed['_action']).toBeUndefined(); return raw; }
  expect((parsed['action_bar'] as { v?: unknown } | undefined)?.v).toBe(1);
  const removed = ['action_bar', '_action'].filter((k) => k in parsed);
  const removedBytes = removed.reduce((n, k) => n + JSON.stringify({ [k]: parsed[k] }).length - 1, 0);
  for (const k of removed) delete parsed[k];
  const rest = JSON.stringify(parsed);
  expect(rest.length, 'only the S-B keys were removed').toBe(raw.length - removedBytes);
  return rest;
}

describe('fresh goal scope reaches the canonical leader claim at every route egress', () => {
  let app: FastifyInstance;
  let readState: ReturnType<typeof composeAnalysisStateV1>;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(AT));
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network/provider calls forbidden'); }));
    vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    scripted.results = []; scripted.prior = []; scripted.rows = []; scripted.concurrent = false; scripted.calls = 0; scripted.toolName = 'get_canonical_state';
    scripted.measured = false; scripted.measureCalls = 0; scripted.duringMeasure = null; scripted.joinScopeRead = true;
    scripted.concurrentText = 'Offshore partner leads.';
    scripted.hideAnswerOnce = false; scripted.graphMode = 'ok'; scripted.modelNames = false; scripted.retireOnAppend = false; scripted.durableNearTie = false; scripted.durableUnavailable = false;
    scripted.canonicalResult = false; scripted.scopeUnavailableOnce = false; scripted.retireAfterGraphRead = 0; scripted.graphReads = [];
    vi.resetModules();
    const readiness = buildCanonicalAnalysisReadyFromGraph(FROM.graph);
    const canonical = selectCanonicalAnalysisState({ priorFacts: [PRIOR], currentGraphHash: RESULT.graph_hash_at_run,
      currentGraph: FROM.graph, readiness, priorFactsReadOk: true });
    readState = composeAnalysisStateV1({ canonical, readiness, mayNameLeadingOption: true,
      runFactBinding: { scenarioId: SID, selectedResult: RESULT }, rawRobustness: pickLatestRawRobustness([PRIOR]) });
    expect(readState?.leader_claim).toEqual({ permitted: true, separation: 'separated' });
    expect(RESULT.scenario_id).toBe(SID);
    expect(RESULT.run_id).toBe('bound-prior');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { readScenarioAnalysis } = await import('../../../routes/scenario-graph-analysis-read.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req, reply) => {
      expect((req.params as { id: string }).id).toBe(SID);
      const state = scripted.prior.length === 0 || !scripted.joinScopeRead ? readState : composeAnalysisStateV1({ canonical, readiness,
        mayNameLeadingOption: true, runFactBinding: { scenarioId: SID, selectedResult: RESULT },
        rawRobustness: pickLatestRawRobustness([PRIOR]), goalScopeClaimInput: goalScopeClaimInput(scripted.prior, FROM.graph) });
      if (scripted.graphMode === '503') return reply.code(503).send({ error: 'unavailable' });
      if (scripted.graphMode === 'throw') throw new Error('graph reader threw');
      const graph = readGraph();
      const ready = readReady();
      // Recovery rows start with the real reader's paired, scope-projected state/result, never a hand-built block.
      const canonicalRead = scripted.canonicalResult ? await readScenarioAnalysis({ scenarioId: SID, graph, requestId: TID,
        goalScopeClaimInput: await readGoalScopeClaimInput(graph, async () => {
          if (scripted.scopeUnavailableOnce) { scripted.scopeUnavailableOnce = false; throw new Error('scope read unavailable'); }
          return scripted.prior;
        }) }) : undefined;
      if (canonicalRead !== undefined) {
        scripted.graphReads.push(canonicalRead);
        if (scripted.graphReads.length === scripted.retireAfterGraphRead) scripted.prior = [];
      }
      return { ...(scripted.graphMode !== 'missing-roster' ? { graph, analysis_ready: ready } : {}),
        graph_hash: RESULT.graph_hash_at_run, ...(scripted.graphMode !== 'missing-analysis' ? { analysis_state: scripted.graphMode === 'malformed-analysis' ? {} : canonicalRead?.analysis_state ?? state } : {}),
        ...(canonicalRead !== undefined ? { analysis_result: canonicalRead.analysis_result } : scripted.measured ? { analysis_result: { type: 'analysis_result', leading_option_id: 'opt-a',
          computed_against_hash: RESULT.graph_hash_at_run } } : {}) };
    });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, assistant_text: 'ran',
      blocks: [], suggested_actions: [], insights: [], analysis_state: readState }));
    await app.register(agentV1TurnRoute); await app.ready();
    const inject = app.inject.bind(app);
    vi.spyOn(app, 'inject').mockImplementation(((opts: any) => {
      if (scripted.graphMode === 'throw' && opts.url === `/assist/v1/scenarios/${SID}/graph`) return Promise.reject(new Error('graph dispatch threw'));
      return inject(opts);
    }) as typeof app.inject);
  }, 60000);
  afterEach(async () => { await app?.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const readGraph = () => {
    const graph = FROM.graph as GraphV3T;
    return scripted.modelNames ? { ...graph, nodes: graph.nodes.map(n => n.kind === 'option'
      ? { ...n, label: n.id === 'opt-a' ? 'Hire leads' : n.label, description: `Hire leads: user-authored description for ${n.id}.` } : n) } : graph;
  };
  const readReady = () => {
    const ready = buildCanonicalAnalysisReadyFromGraph(readGraph());
    return scripted.modelNames ? { ...ready, options: ready!.options.map(o => ({ ...o, description: `Hire leads: user-authored description for ${o.option_id}.` })) } : ready;
  };
  const turn = async (overrides: Record<string, unknown> = {}) => {
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message',
      scenario_id: SID, session_id: 'fresh-scope-baseline', turn_id: TID, message: 'Compare the options.', ...overrides } });
    expect(response.statusCode, response.body).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect(scripted.rows.every(row => row.graph === undefined)).toBe(true);
    const body = response.json<Record<string, any>>();
    if (!['503', 'throw', 'missing-analysis', 'malformed-analysis'].includes(scripted.graphMode)) {
      expect(body.graph_hash).toBe(RESULT.graph_hash_at_run);
      expect(body.analysis_state.run_state).toEqual(readState?.run_state);
      expect(body.analysis_state.run_state.computed_at).toBe(RESULT.computed_at);
    }
    return { body, bytes: withoutActionBar(response.body, body._agent?.replayed !== true) };
  };
  const assertWithheld = (body: Record<string, any>) => {
    expect.soft(body.analysis_state.leader_claim).toEqual({ permitted: false, withheld_reason: 'goal_scope_unresolved' });
    expect.soft(body.assistant_text).not.toContain('Offshore partner leads.');
  };
  const measuredTurn = (retry = false) => turn({ message: MEASURED_MESSAGE, source: retry ? 'retry' : 'chip',
    ...(retry ? {} : { chip: PRESS }) });
  const assertMeasuredWithheld = (body: Record<string, any>) => {
    assertWithheld(body);
    expect.soft(body.assistant_text).not.toContain('would still lead');
    expect.soft(body.assistant_text).not.toMatch(/runs would (?:still )?support|be supported by the most runs/);
    expect(body.assistant_text).toContain("There's nothing yet for a change to flip, because this analysis doesn't put one option forward yet."); // withheld: nothing to flip (DL 0df0e1, 5 Oct)
    expect(scripted.calls).toBe(0);
    expect(scripted.measureCalls).toBe(1);
  };


  const seedReplay = async (chip?: Record<string, unknown>) => {
    const { agentTurnRequestHash, chipOperationOf, withChipOperation } = await import('../../../routes/agent-v1-turn.js');
    const requestHash = withChipOperation(agentTurnRequestHash(SID, null, 'Compare the options.'), chipOperationOf({ chip }));
    scripted.rows = [{ id: 'original-answer', scenario_id: SID, turn_id: TID,
      request_hash: requestHash,
      assistant_message: chip ? RUN_RESULT_READY_TEXT : 'Offshore partner leads.', pending_actions: [pending()], llm_calls_used: 0 }];
    scripted.rows.push({ id: 'original-claim', turn_id: `${TID}:claim`,
      request_hash: `${requestHash}#claim:other-request`, assistant_message: null });
  };
  for (const exit of ['main', 'append-repair', 'existing-row', 'claim-wait'] as const) {
    for (const carrier of ['draft_graph', 'analysis_ready'] as const) {
      it(`P1-1 ${exit}: Hire leads ${carrier} model identity and schema survive withholding`, async () => {
        scripted.modelNames = true;
        const issue = pending();
        expect(issue).toMatchObject({ scenario_id: SID, id: PENDING_ID });
        if (exit === 'main' || exit === 'append-repair') {
          scripted.results = [{ ok: true, pending_action: issue }];
          scripted.concurrent = exit === 'append-repair';
        } else {
          scripted.prior = [issue]; await seedReplay(); scripted.hideAnswerOnce = exit === 'claim-wait';
        }
        const { body } = await turn();
        expect(body.analysis_state.leader_claim.permitted).toBe(false);
        const expected = carrier === 'draft_graph' ? buildAppliedGraphWireField(readGraph())?.nodes : readReady()?.options;
        const key = carrier === 'draft_graph' ? 'nodes' : 'options';
        expect(JSON.stringify(body[carrier][key])).toBe(JSON.stringify(expected));
        expect(body[carrier][key].filter((n: any) => (n.id ?? n.option_id) === 'opt-a' || (n.id ?? n.option_id) === 'opt-b').map((n: any) => n.id ?? n.option_id)).toEqual(['opt-a', 'opt-b']);
        expect(body[carrier][key].find((n: any) => (n.id ?? n.option_id) === 'opt-a')).toMatchObject({ label: 'Hire leads', description: 'Hire leads: user-authored description for opt-a.' });
        expect(OlumiResponseSchema.shape.draft_graph.safeParse(body.draft_graph).success).toBe(true);
        expect(OlumiResponseSchema.shape.analysis_ready.safeParse(body.analysis_ready).success).toBe(true);
      });
    }
  }
  // The route emits graph as draft_graph; pin the other shared egress carrier directly against the SAME readback.
  for (const carrier of ['draft_graph', 'graph', 'analysis_ready'] as const) {
    it(`P1-1 final envelope: ${carrier} is omitted on unavailable roster/egress failure without mutating the model`, () => {
      scripted.modelNames = true;
      const input = { assistant_text: 'Offshore partner leads.', draft_graph: buildAppliedGraphWireField(readGraph()), graph: readGraph(), analysis_ready: readReady() };
      const original = JSON.stringify(input);
      const out = enforceLeaderLicenceAtFinalEgress(input, { requestId: TID, exitPath: 'test', licence: 'withheld', mayNameLeadingOption: false,
        graph: { get nodes() { throw new Error('roster read failed'); } } }).response;
      expect(out[carrier]).toBeUndefined();
      expect(JSON.stringify(input)).toBe(original);
    });
    it(`P1-1 shared final egress: ${carrier} model bytes survive a healthy withheld read`, () => {
      scripted.modelNames = true;
      const input = { assistant_text: 'Offshore partner leads.', draft_graph: buildAppliedGraphWireField(readGraph()), graph: readGraph(), analysis_ready: readReady() };
      const out = enforceLeaderLicenceAtFinalEgress(input, { requestId: TID, exitPath: 'test', licence: 'withheld', mayNameLeadingOption: false,
        graph: readGraph(), analysisReady: readReady() }).response;
      expect(JSON.stringify(carrier === 'analysis_ready' ? out[carrier]!.options : out[carrier])).toBe(JSON.stringify(carrier === 'analysis_ready' ? input[carrier]!.options : input[carrier]));
    });
  }
  it('P1-2 persisted-issue withdrawal recomposes the same canonical Run after removal', async () => {
    scripted.prior = [pending()]; scripted.canonicalResult = true;
    scripted.results = [{ ok: true, withdrawn: true, proposal_id: pending().chip_id }];
    const { body } = await turn();
    expect(body.analysis_state.leader_claim).toEqual(readState!.leader_claim);
    expect(body.assistant_text).toBe('Offshore partner leads.');
    assertRestoredResult(body);
    expect(scripted.rows.find(row => row.turn_id === TID)?.pending_actions ?? []).toEqual([]);
  });
  const assertRestoredResult = (body: Record<string, any>) => {
    const initial = scripted.graphReads.find(read => read.analysis_state?.leader_claim.withheld_reason === 'goal_scope_unresolved');
    expect(initial?.analysis_result).toMatchObject({ type: 'analysis_result', leading_option_id: null,
      computed_against_hash: RESULT.graph_hash_at_run });
    expect(JSON.stringify(initial?.analysis_result)).toContain('No single option can be put forward');
    expect(body.analysis_state.run_state).toEqual(initial?.analysis_state?.run_state);
    expect(body.analysis_state.leader_claim).toEqual(readState!.leader_claim);
    expect(body.blocks.find((block: Record<string, unknown>) => block.type === 'analysis_result')).toMatchObject({
      leading_option_id: 'opt-a', computed_against_hash: RESULT.graph_hash_at_run });
    expect(JSON.stringify(body)).not.toContain('No single option can be put forward');
  };
  it('P1-2 an unavailable scope read recovers the same canonical state/result pair', async () => {
    scripted.canonicalResult = true; scripted.scopeUnavailableOnce = true;
    const { body } = await turn();
    assertRestoredResult(body);
  });
  it('P1-2 issue retirement between the graph and pending reads restores the main result/coaching pair', async () => {
    scripted.canonicalResult = true; scripted.prior = [pending()]; scripted.retireAfterGraphRead = 1;
    const { body } = await turn();
    assertRestoredResult(body);
  });
  it('P1-2 issue retirement restores the state/result pair consumed by the measured selector', async () => {
    scripted.canonicalResult = true; scripted.measured = true;
    // Measurement needs a licensed initial Run. The issue appears while it is in flight,
    // projects the final graph read, then retires before the pending read and answer selection.
    scripted.duringMeasure = () => { scripted.prior = [pending()]; }; scripted.retireAfterGraphRead = 2;
    const { body } = await measuredTurn();
    assertRestoredResult(body);
    expect(body.assistant_text).toContain('‘Offshore partner’ would still be supported by the most runs');
    expect(scripted.calls).toBe(0); expect(scripted.measureCalls).toBe(1);
  });
  for (const exit of ['existing-row', 'claim-wait', 'append-repair'] as const) {
    it(`P1-2 ${exit}: result-bearing replay restores the same canonical state/result pair after issue retirement`, async () => {
      scripted.canonicalResult = true; scripted.prior = [pending()];
      const chip = { action_type: 'run_analysis' };
      if (exit === 'append-repair') {
        scripted.concurrent = true; scripted.concurrentText = RUN_RESULT_READY_TEXT; scripted.retireAfterGraphRead = 2;
      } else {
        await seedReplay(chip); scripted.hideAnswerOnce = exit === 'claim-wait'; scripted.retireAfterGraphRead = 1;
      }
      const { body } = await turn({ chip });
      expect(body._agent.replayed).toBe(true);
      assertRestoredResult(body);
    });
  }
  for (const unavailable of [false, true]) {
    it(`P1-2 withdrawal cannot grant permission from ${unavailable ? 'unavailable' : 'near-tied'} canonical inputs`, async () => {
      scripted.prior = [pending()]; scripted.durableNearTie = !unavailable; scripted.durableUnavailable = unavailable;
      scripted.results = [{ ok: true, withdrawn: true, proposal_id: pending().chip_id }];
      const { body } = await turn();
      expect(body.analysis_state.leader_claim).toEqual(unavailable
        ? { permitted: false, withheld_reason: 'constraint_verdict_withheld' }
        : { permitted: false, withheld_reason: WITHHELD_NEAR_TIE, separation: 'near_tie' });
      expect(body.assistant_text).not.toContain('Offshore partner leads.');
      expect(scripted.rows.find(row => row.turn_id === TID)?.pending_actions ?? []).toEqual([]);
    });
  }
  it('P1-2 prior-issue retirement during concurrent repair cannot revive a prior carrier', async () => {
    scripted.prior = [pending()]; scripted.concurrent = true; scripted.retireOnAppend = true;
    const { body } = await turn();
    expect(body._agent.replayed).toBe(true);
    expect(body.analysis_state.leader_claim).toEqual(readState!.leader_claim);
    expect(body.assistant_text).toBe('Offshore partner leads.');
  });
  for (const mode of ['503', 'throw', 'missing-analysis', 'malformed-analysis', 'missing-roster']) {
    for (const exit of ['main', 'append-repair', 'existing-row', 'claim-wait'] as const) {
      it(`P1-3 ${exit}: ${mode} readback with surviving scope is structurally leader-free`, async () => {
        const issue = pending();
        expect(issue).toMatchObject({ scenario_id: SID, id: PENDING_ID });
        if (exit === 'main' || exit === 'append-repair') {
          scripted.results = [{ ok: true, pending_action: issue }]; scripted.concurrent = exit === 'append-repair';
        } else {
          scripted.prior = [issue]; await seedReplay(); scripted.hideAnswerOnce = exit === 'claim-wait';
        }
        scripted.graphMode = mode;
        scripted.modelNames = true;
        const { body } = await turn();
        expect(body.analysis_state.leader_claim).toEqual({ permitted: false, withheld_reason: 'goal_scope_unresolved' });
        expect(body.assistant_text).not.toContain('Offshore partner');
        expect(body.assistant_text).toContain(FINAL_EGRESS_FAILED_TEXT);
        expect(body.suggested_actions).toEqual([]);
        expect(body.run_delta).toBeUndefined();
        expect(body.graph).toBeUndefined();
        expect(body.draft_graph).toBeUndefined();
        expect(body.analysis_ready).toBeUndefined(); 
        // Every surviving member the boundary schema declares is individually schema-valid (no half-emptied wrapper).
        for (const [k, member] of Object.entries(OlumiResponseSchema.shape)) {
          if (k in body) { const parsed = member.safeParse(body[k]); expect(parsed.success, `${k}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true); }
        }
        expect(JSON.stringify(body)).not.toContain('Hire leads: user-authored description');
        if (exit === 'main') expect(scripted.rows.find(row => row.turn_id === TID)?.assistantMessage).toBe(body.assistant_text);
        else expect(body._agent.replayed).toBe(true);
      });
    }
    it(`P1-3 control: ${mode} without a surviving issue preserves pre-fix behaviour`, async () => {
      scripted.graphMode = mode;
      const { body } = await turn();
      expect(body.assistant_text).toBe(['missing-analysis', 'malformed-analysis'].includes(mode) ? FINAL_EGRESS_FAILED_TEXT : 'Offshore partner leads.');
    });
  }

  it('measured control: live and chipless replay without a scope issue keep every pre-fix byte', async () => {
    scripted.measured = true;
    const live = await measuredTurn();
    expect(live.body.assistant_text).toContain('‘Offshore partner’ would still be supported by the most runs');
    const replay = await measuredTurn(true);
    expect(replay.body.assistant_text).toBe(live.body.assistant_text);
    expect(replay.body._agent.replayed).toBe(true);
    const bytes = { live: live.bytes, replay: replay.bytes };
    if (process.env.CAPTURE_FRESH_SCOPE_BASELINE === '1') writeFileSync(measuredBaselineUrl, `${JSON.stringify(bytes)}\n`);
    expect(bytes).toEqual(JSON.parse(readFileSync(measuredBaselineUrl, 'utf8')));
    expect(scripted.calls).toBe(0); expect(scripted.measureCalls).toBe(1);
  });
  it('measured live: a fresh unresolved issue surviving the measurement withholds the leader sentence', async () => {
    scripted.measured = true; scripted.joinScopeRead = false;
    scripted.duringMeasure = () => { scripted.prior = [pending()]; };
    const { body } = await measuredTurn(); assertMeasuredWithheld(body);
    expect((scripted.rows.find(row => row.turn_id === TID)?.pending_actions as PendingAction[])[0]?.id).toBe(PENDING_ID);
    // A measurement rejected by the composed claim was never an answer to cache.
    scripted.prior = [];
    const replay = await measuredTurn(true);
    expect(replay.body.analysis_state.leader_claim.permitted).toBe(true);
    expect(replay.body.assistant_text).not.toContain('would still lead');
    expect(replay.body.assistant_text).not.toMatch(/runs would (?:still )?support|be supported by the most runs/);
    expect(scripted.measureCalls).toBe(1);
  });
  it('measured append-repair replay: the losing turn carries its fresh unresolved issue to the selector', async () => {
    scripted.measured = true; scripted.joinScopeRead = false; scripted.concurrent = true;
    scripted.concurrentText = '‘Offshore partner’ would still be supported by the most runs even if its average effect fell to zero.';
    scripted.duringMeasure = () => { scripted.prior = [pending()]; };
    const { body } = await measuredTurn(); assertMeasuredWithheld(body);
    expect(body._agent.replayed).toBe(true);
  });
  for (const retry of [false, true]) {
    it(`measured existing-row ${retry ? 'chipless ' : ''}replay: the warmed cache reads today's canonical unresolved scope`, async () => {
      scripted.measured = true;
      expect((await measuredTurn()).body.assistant_text).toContain('would still be supported by the most runs');
      scripted.prior = [pending()];
      const { body } = await measuredTurn(retry); assertMeasuredWithheld(body);
      expect(body._agent.replayed).toBe(true);
    });
  }
  it('measured claim-wait replay: the warmed cache reads canonical scope when the winner appears', async () => {
    scripted.measured = true;
    expect((await measuredTurn()).body.assistant_text).toContain('would still be supported by the most runs');
    scripted.prior = [pending()]; scripted.hideAnswerOnce = true;
    const { body } = await measuredTurn(true); assertMeasuredWithheld(body);
    expect(body._agent.replayed).toBe(true);
  });

  it('fresh unresolved issue: same scenario, pending id and Run withhold reply and wire', async () => {
    const issue = pending(); scripted.results = [{ ok: true, pending_action: issue }];
    const { body } = await turn(); assertWithheld(body);
    const answer = scripted.rows.find(row => row.turn_id === TID);
    expect(answer?.pending_actions).toEqual([issue]);
    expect(answer?.assistantMessage).toBe(body.assistant_text);
  });
  it('control: the same Run without a fresh issue is byte-identical to the pre-fix capture', async () => {
    const { body, bytes } = await turn();
    expect(body.assistant_text).toBe('Offshore partner leads.');
    expect(body.analysis_state.leader_claim.permitted).toBe(true);
    // Capture only on the pristine base, before applying production changes.
    if (process.env.CAPTURE_FRESH_SCOPE_BASELINE === '1') writeFileSync(baselineUrl, `${bytes}\n`);
    expect(bytes).toBe(readFileSync(baselineUrl, 'utf8').trimEnd());
  });
  it('an analysis-bearing turn gates the same fresh issue at the leader wire gate too', async () => {
    scripted.toolName = 'run_analysis'; scripted.results = [{ ok: true, pending_action: pending() }];
    const { body } = await turn(); assertWithheld(body);
    expect(body._diagnostic_trace.leader_claim_enforced).toBe(true);
  });
  it('fresh issue explicitly resolved within this turn stays permitted', async () => {
    const issue = pending(); scripted.results = [{ ok: true, pending_action: issue }, { ok: true, withdrawn: true, proposal_id: issue.chip_id }];
    const { body } = await turn();
    expect(body.analysis_state.leader_claim.permitted).toBe(true);
    expect(body.assistant_text).toBe('Offshore partner leads.');
    expect(scripted.rows.find(row => row.turn_id === TID)?.pending_actions ?? []).toEqual([]);
  });
  it('fresh issue for another scenario cannot withhold this same Run', async () => {
    scripted.results = [{ ok: true, pending_action: pending(OTHER_SID) }];
    const { body } = await turn();
    expect(body.analysis_state.leader_claim.permitted).toBe(true);
    expect(body.assistant_text).toBe('Offshore partner leads.');
    expect(scripted.rows.find(row => row.turn_id === TID)?.pending_actions ?? []).toEqual([]);
  });
  it('a fresh pending of another kind cannot withhold this same Run', async () => {
    scripted.results = [{ ok: true, pending_action: { ...pending(), action: { kind: 'run_analysis' } } }];
    const { body } = await turn();
    expect(body.analysis_state.leader_claim.permitted).toBe(true);
    expect(body.assistant_text).toBe('Offshore partner leads.');
  });
  it('prior persisted unresolved issue remains withheld on the same Run', async () => {
    scripted.prior = [pending()];
    const { body } = await turn(); assertWithheld(body);
    expect((scripted.rows.find(row => row.turn_id === TID)?.pending_actions as PendingAction[])[0]?.id).toBe(PENDING_ID);
  });
  it('concurrent commit replay retains the losing request\'s surviving fresh issue', async () => {
    scripted.concurrent = true; scripted.results = [{ ok: true, pending_action: pending() }];
    const { body } = await turn(); assertWithheld(body);
    expect(body._agent.replayed).toBe(true);
    expect(scripted.calls).toBe(1);
  });
  it('committed replay reads the original row\'s fresh issue through canonical scope input', async () => {
    const { agentTurnRequestHash } = await import('../../../routes/agent-v1-turn.js');
    scripted.prior = [pending()];
    scripted.rows = [{ id: 'original-answer', turn_id: TID,
      request_hash: agentTurnRequestHash(SID, null, 'Compare the options.'),
      assistant_message: 'Offshore partner leads.', pending_actions: [pending()], llm_calls_used: 0 }];
    const { body } = await turn(); assertWithheld(body);
    expect(body._agent.replayed).toBe(true);
    expect(scripted.calls).toBe(0);
  });
  it('committed replay does not revive an issue absent from today\'s canonical pending row', async () => {
    const { agentTurnRequestHash } = await import('../../../routes/agent-v1-turn.js');
    scripted.rows = [{ id: 'original-answer', turn_id: TID,
      request_hash: agentTurnRequestHash(SID, null, 'Compare the options.'),
      assistant_message: 'Offshore partner leads.', pending_actions: [pending()], llm_calls_used: 0 }];
    const { body } = await turn();
    expect(body.analysis_state.leader_claim.permitted).toBe(true);
    expect(body.assistant_text).toBe('Offshore partner leads.');
    expect(scripted.calls).toBe(0);
  });
});
