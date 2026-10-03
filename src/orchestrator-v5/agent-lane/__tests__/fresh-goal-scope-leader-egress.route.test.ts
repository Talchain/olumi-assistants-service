import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FROM, PRIOR } from '../../model-management/__tests__/version-result-fixtures.js';
import { goalScopeClaimInput } from '../../compose/goal-scope-claim-input.js';
import { composeAnalysisStateV1 } from '../../compose/analysis-state-v1.js';
import { selectCanonicalAnalysisState } from '../../context/canonical-analysis-state.js';
import { pickLatestRawRobustness } from '../../coaching/pick-raw-robustness.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { reconciliationPending } from '../goal-scope.js';
import type { PendingAction } from '../../session/pending-action.js';

// Real Fastify route, scripted tool results and in-memory persistence; no provider or network.
const scripted = vi.hoisted(() => ({ results: [] as Record<string, unknown>[], prior: [] as PendingAction[],
  rows: [] as Record<string, unknown>[], concurrent: false, calls: 0, toolName: 'get_canonical_state',
  measured: false, measureCalls: 0, duringMeasure: null as null | (() => void), joinScopeRead: true,
  concurrentText: 'Offshore partner leads.', hideAnswerOnce: false }));
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
  readCommittedTurn: vi.fn(async (_sid: string, tid: string) => {
    if (tid === TID && scripted.hideAnswerOnce) { scripted.hideAnswerOnce = false; return null; }
    return scripted.rows.find(row => row.turn_id === tid) ?? null;
  }),
  readMostRecentPendingActions: vi.fn(async () => scripted.prior),
  append: vi.fn(async (row: Record<string, unknown>) => {
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
const baselineUrl = new URL('./fixtures/fresh-goal-scope-permitted-baseline.json', import.meta.url);
const measuredBaselineUrl = new URL('./fixtures/fresh-goal-scope-measured-baseline.json', import.meta.url);
const PRESS = { id: 'agent-next-what-would-change' };
const MEASURED_MESSAGE = 'What would change the result?';
const pending = (scenarioId = SID): PendingAction => ({ ...reconciliationPending(scenarioId, {
  kind: 'reconcile_goal_scope', goal_id: 'n_revenue', goal_label: 'Revenue',
  declared_scope: { modelled: 'all revenue', alternative: 'one stream', stated_in_brief: true },
  question: 'Which revenue scope should this model represent?', expected: 'scope', operands: [], derivations: [],
}, Date.parse(AT)), id: PENDING_ID });

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
    scripted.hideAnswerOnce = false;
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
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async req => {
      expect((req.params as { id: string }).id).toBe(SID);
      const state = scripted.prior.length === 0 || !scripted.joinScopeRead ? readState : composeAnalysisStateV1({ canonical, readiness,
        mayNameLeadingOption: true, runFactBinding: { scenarioId: SID, selectedResult: RESULT },
        rawRobustness: pickLatestRawRobustness([PRIOR]), goalScopeClaimInput: goalScopeClaimInput(scripted.prior, FROM.graph) });
      return { graph: FROM.graph, graph_hash: RESULT.graph_hash_at_run, analysis_ready: readiness, analysis_state: state,
        ...(scripted.measured ? { analysis_result: { type: 'analysis_result', leading_option_id: 'opt-a',
          computed_against_hash: RESULT.graph_hash_at_run } } : {}) };
    });
    await app.register(agentV1TurnRoute); await app.ready();
  }, 60000);
  afterEach(async () => { await app?.close(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const turn = async (overrides: Record<string, unknown> = {}) => {
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message',
      scenario_id: SID, session_id: 'fresh-scope-baseline', turn_id: TID, message: 'Compare the options.', ...overrides } });
    expect(response.statusCode, response.body).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    const body = response.json();
    expect(body.graph_hash).toBe(RESULT.graph_hash_at_run);
    expect(body.analysis_state.run_state).toEqual(readState?.run_state);
    expect(body.analysis_state.run_state.computed_at).toBe(RESULT.computed_at);
    return { body, bytes: response.body };
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
    expect(body.assistant_text).toContain('no grounded factor threshold available to quote');
    expect(scripted.calls).toBe(0);
    expect(scripted.measureCalls).toBe(1);
  };

  it('measured control: live and chipless replay without a scope issue keep every pre-fix byte', async () => {
    scripted.measured = true;
    const live = await measuredTurn();
    expect(live.body.assistant_text).toContain('‘Offshore partner’ would still lead');
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
    expect(scripted.measureCalls).toBe(1);
  });
  it('measured append-repair replay: the losing turn carries its fresh unresolved issue to the selector', async () => {
    scripted.measured = true; scripted.joinScopeRead = false; scripted.concurrent = true;
    scripted.concurrentText = '‘Offshore partner’ would still lead even if its average effect fell to zero.';
    scripted.duringMeasure = () => { scripted.prior = [pending()]; };
    const { body } = await measuredTurn(); assertMeasuredWithheld(body);
    expect(body._agent.replayed).toBe(true);
  });
  for (const retry of [false, true]) {
    it(`measured existing-row ${retry ? 'chipless ' : ''}replay: the warmed cache reads today's canonical unresolved scope`, async () => {
      scripted.measured = true;
      expect((await measuredTurn()).body.assistant_text).toContain('would still lead');
      scripted.prior = [pending()];
      const { body } = await measuredTurn(retry); assertMeasuredWithheld(body);
      expect(body._agent.replayed).toBe(true);
    });
  }
  it('measured claim-wait replay: the warmed cache reads canonical scope when the winner appears', async () => {
    scripted.measured = true;
    expect((await measuredTurn()).body.assistant_text).toContain('would still lead');
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
