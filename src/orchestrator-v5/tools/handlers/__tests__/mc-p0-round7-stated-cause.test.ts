import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
const reads = vi.hoisted(() => ({ facts: [] as any[] }));
vi.mock('../../../session/index.js', async original => ({
  ...(await original<typeof import('../../../session/index.js')>()),
  getSessionStore: () => ({
    readMostRecentPendingActions: async () => [], readRecent: async () => [],
    readFactsFor: async () => [], readFactsWithTurnFor: async () => [], readAnalysisInvalidatedAt: async () => null,
    readScenarioRunAnalysisFactsFor: async () => ({ facts: reads.facts.map((fact, i) => ({
      fact, fact_row_id: `r7-${i}`, fact_created_at: fact.result.computed_at,
    })), total_count: reads.facts.length }),
  }),
}));
import { runP0Graph } from './mc-p0-run-helper.js';
import { bindStatedLinkSizes } from '../../../agent-lane/admit-model.js';
import { readUnsizedPathLeaderCause, UNSIZED_PATH_LEADER_CAUSE_KEY } from '../../../agent-lane/unsized-path-cause.js';
import * as compose from '../../../compose/analysis-state-v1.js';
import { boundRunLeaderClaim } from '../../../model-management/version-result-binding.js';
import { readMayNameLeadingOptionVerdictForFact, readMayNameLeadingOptionVerdict } from '../../../context/claim-safety-read.js';
import { finaliseV5Response } from '../../../response-finaliser.js';
import { readScenarioAnalysis } from '../../../../routes/scenario-graph-analysis-read.js';
import { buildAnalysisResultBlock } from '../../../compose.js';

type R = Record<string, any>;
const brief = readFileSync(new URL('../../../admission/__tests__/fixtures/mc-p0/BRIEF.txt', import.meta.url), 'utf8');
function graph(d: number, noTarget = false): R {
  const g = JSON.parse(readFileSync(new URL(`../../../admission/__tests__/fixtures/mc-p0/draw${d}.json`, import.meta.url), 'utf8'));
  const nodes = g.nodes.map((n: R) => ({ ...n, unit: n.observed_state?.unit ?? (n.kind === 'goal' ? n.goal_threshold_unit : undefined) ?? n.unit }));
  for (const [i, sentence] of bindStatedLinkSizes(g.edges.map((e: R) => ({ ...e, natural_effect: e.provenance?.natural_effect })), nodes, brief)) {
    if (g.edges[i].provenance?.magnitude === 'olumi_estimate') Object.assign(g.edges[i].provenance, { magnitude: 'user_stated', source_quote: sentence });
  }
  // R8: projected twins exercise R7 stated-cause rows; the stored originals now disclose legacy figures.
  if (d !== 2) for (const e of g.edges) if (e.defaulted === true && e.provenance?.magnitude === undefined) e.provenance.mean_projected = true;
  if (noTarget) {
    for (const n of g.nodes.filter((n: R) => n.kind === 'goal')) for (const k of Object.keys(n))
      if (k.startsWith('goal_threshold') || ['success_threshold', 'threshold_source', 'goal_comparator'].includes(k)) delete n[k];
    g.goal_constraints = (g.goal_constraints ?? []).filter((c: R) => !g.nodes.some((n: R) => n.kind === 'goal' && n.id === c.node_id));
  }
  return g;
}
const factOf = (result: R) => ({ fact_type: 'run_analysis', fact_version: 1, noop: false, result }) as never;
const fresh = { kind: 'complete_current' } as never;
const stale = { kind: 'complete_stale', cause: 'graph_changed' } as never;
const canonical = { status: 'ready', freshness: 'fresh', selected_fact_index: 0,
  computed_at: '2026-10-05T21:00:00.000Z', contradictions: [], usableForProse: true, usableForChips: true,
  usableForFollowupContext: true, requiresRerun: false, blockedUnusable: false } as never;
const inputFor = (result: R): compose.AnalysisStateComposeInput => ({
  canonical, rawRobustness: null, mayNameLeadingOption: readMayNameLeadingOptionVerdictForFact(factOf(result)).may_name_leading_option,
  withheldWithoutConstraintCause: true, withheldBecauseUnsizedPath: readUnsizedPathLeaderCause(result),
});
afterEach(() => { vi.restoreAllMocks(); reads.facts = []; });

describe('MC P0 R7 stated unsized goal path cause', () => {
  it.each([1, 2, 3].flatMap(d => [false, true].map(noTarget => [d, noTarget] as const)))('d%i post-Fi no-target=%s binds the SAME caller-stated ends into composer, finaliser and cold read', async (d, noTarget) => {
    const g = graph(d, noTarget), result = await runP0Graph(g, brief), fact = factOf(result);
    const cause = readUnsizedPathLeaderCause(result);
    // The constraint check retains its own permission; the independent Run licence withhold removes the overall claim.
    expect(result.constraint_verdict.may_name_leading_option).toBe(true);
    if (d === 2) expect(cause).toBeUndefined();
    else {
      expect(compose.composeLeaderClaim(inputFor(result), fresh, false)).toMatchObject({ permitted: false, withheld_reason: 'goal_path_unsized' });
      const from = d === 1 ? 'starter_support_cost' : 'starter_monthly_price';
      const to = d === 1 ? 'mrr_lost_to_starter_support_burden' : 'starter_tier_monthly_recurring_revenue';
      expect(cause).toEqual({ from, to,
        from_label: g.nodes.find((n: R) => n.id === from).label, to_label: g.nodes.find((n: R) => n.id === to).label,
        links: expect.arrayContaining([{ from, to, from_label: g.nodes.find((n: R) => n.id === from).label, to_label: g.nodes.find((n: R) => n.id === to).label }]) });
      const input = inputFor(result);
      expect(input.withheldBecauseUnsizedPath).toEqual(cause);
      expect(compose.composeLeaderClaim(input, fresh, false)).toMatchObject({ permitted: false, withheld_reason: 'goal_path_unsized' });
    }
    const spy = vi.spyOn(compose, 'composeAnalysisStateV1');
    const bound = boundRunLeaderClaim({ fact, identity: { graph_hash_at_run: result.graph_hash_at_run } } as never,
      { graph: g, scenario_id: result.scenario_id } as never);
    expect(spy.mock.calls.at(-1)![0].withheldBecauseUnsizedPath).toEqual(cause);
    expect(bound.state?.leader_claim.permitted).toBe(d === 2);
    if (d !== 2) expect(bound.state?.leader_claim.withheld_reason).toBe('goal_path_unsized');
    const verdict = readMayNameLeadingOptionVerdictForFact(fact);
    expect(verdict.unsized_path_cause).toEqual(cause);
    // Agent-lane finalisation receives the SAME selected-fact verdict as the route.
    const wire = finaliseV5Response({ assistant_text: '', blocks: [], chips: [] } as never, {
      requestId: 'r7-final', exitPath: 'run_analysis', analysisStateCanonical: canonical,
      mayNameLeadingOption: verdict.may_name_leading_option,
      claimConstraintVerdictState: verdict.constraint_verdict_state,
      leaderWithheldBecauseUnsizedPath: verdict.unsized_path_cause,
    } as never);
    if (d !== 2) expect(wire.analysis_state?.leader_claim).toMatchObject({ permitted: false, withheld_reason: 'goal_path_unsized' });
    reads.facts = [fact];
    const cold = await readScenarioAnalysis({ scenarioId: result.scenario_id, graph: g as never, requestId: 'r7-cold' });
    expect(spy.mock.calls.at(-1)![0].withheldBecauseUnsizedPath).toEqual(cause);
    expect(cold.analysis_state?.leader_claim.permitted).toBe(d === 2);
    if (d !== 2) expect(cold.analysis_state?.leader_claim.withheld_reason).toBe('goal_path_unsized');
    expect((buildAnalysisResultBlock(fact) as R).enrichment?.[UNSIZED_PATH_LEADER_CAUSE_KEY]).toBeUndefined();
  });

  it('an unrequested first pass with the SAME d1 path outranks unsized on stored binding, finaliser and reload', async () => {
    const g = graph(1), result = await runP0Graph(g, brief);
    result.enrichment.run_provenance = { initiated_by: 'auto_post_draft' };
    const fact = factOf(result), verdict = readMayNameLeadingOptionVerdictForFact(fact);
    expect(verdict.unsized_path_unrequested).toBe(true);
    const bound = boundRunLeaderClaim({ fact, identity: { graph_hash_at_run: result.graph_hash_at_run } } as never,
      { graph: g, scenario_id: result.scenario_id } as never);
    expect(bound.state?.leader_claim.withheld_reason).toBe(compose.WITHHELD_UNREQUESTED_ANALYSIS);
    const wire = finaliseV5Response({ assistant_text: '', blocks: [], chips: [] } as never, {
      requestId: 'r7-auto', exitPath: 'run_analysis', analysisStateCanonical: canonical, mayNameLeadingOption: false,
      leaderWithheldBecauseUnsizedPath: verdict.unsized_path_cause, leaderWithheldBecauseUnrequested: verdict.unsized_path_unrequested,
    } as never);
    expect(wire.analysis_state?.leader_claim.withheld_reason).toBe(compose.WITHHELD_UNREQUESTED_ANALYSIS);
    reads.facts = [fact];
    expect((await readScenarioAnalysis({ scenarioId: result.scenario_id, graph: g as never, requestId: 'r7-auto-cold' }))
      .analysis_state?.leader_claim.withheld_reason).toBe(compose.WITHHELD_UNREQUESTED_ANALYSIS);
    g.edges = [];
    const staleAuto = await readScenarioAnalysis({ scenarioId: result.scenario_id, graph: g as never, requestId: 'r7-auto-stale' });
    expect(staleAuto.analysis_state?.run_state.kind).toBe('complete_stale');
    expect(staleAuto.analysis_state?.leader_claim.withheld_reason).toBe(compose.WITHHELD_UNREQUESTED_ANALYSIS);
  });

  it('precedence: unrequested > every-option limit > stale > identity > unsized > unrecorded > constraint', async () => {
    const result = await runP0Graph(graph(1), brief), input = inputFor(result);
    const claim = (extra: Partial<compose.AnalysisStateComposeInput>, state = fresh) => compose.composeLeaderClaim({ ...input, ...extra }, state, false).withheld_reason;
    expect(claim({ withheldBecauseUnrequested: true, everyOptionLimit: 'none_meets', withheldBecauseNonlinearIdentity: true })).toBe(compose.WITHHELD_UNREQUESTED_ANALYSIS);
    expect(claim({ everyOptionLimit: 'none_meets', withheldBecauseNonlinearIdentity: true })).toBe(compose.WITHHELD_NO_OPTION_MEETS_LIMIT);
    expect(claim({ everyOptionLimit: 'likely_breaks', withheldBecauseNonlinearIdentity: true })).toBe(compose.WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT);
    expect(claim({ withheldBecauseNonlinearIdentity: true })).toBe(compose.WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
    // DL 7 Oct (W1c): an out-of-date Run's reason leads over the causes that describe the revision it analysed.
    expect(claim({}, stale)).toBe(compose.WITHHELD_RUN_OUT_OF_DATE);
    expect(claim({ withheldBecauseNonlinearIdentity: true }, stale)).toBe(compose.WITHHELD_RUN_OUT_OF_DATE);
    expect(claim({}), 'CONTROL: the same unsized input on a current Run').toBe('goal_path_unsized');
    expect(claim({ withheldBecauseUnsizedPath: undefined }, stale)).toBe(compose.WITHHELD_RUN_OUT_OF_DATE);
    expect(claim({ withheldBecauseUnsizedPath: undefined })).toBe('analysis_leader_withheld');
    expect(claim({ withheldBecauseUnsizedPath: undefined, withheldWithoutConstraintCause: false })).toBe(compose.WITHHELD_CONSTRAINT_VERDICT);
    expect(compose.composeLeaderClaim(input, fresh, true)).toEqual({ permitted: false, withheld_reason: 'goal_path_unsized' });
    expect(compose.composeLeaderClaim({ ...input, withheldBecauseNonlinearIdentity: true }, fresh, true).withheld_reason)
      .toBe(compose.WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
    expect(compose.composeLeaderClaim({ ...input, withheldBecauseUnrequested: true }, fresh, true).withheld_reason)
      .toBe(compose.WITHHELD_UNREQUESTED_ANALYSIS);
    expect(compose.leaderClaimReasonKind('goal_path_unsized')).toBe('withheld');
  });

  it('stale d1 reload: the out-of-date reason leads, and the edited graph is never walked to invent a cause', async () => {
    const g = graph(1), result = await runP0Graph(g, brief);
    reads.facts = [factOf(result)];
    g.edges = []; // Removes today's failing path, and makes the recorded Run stale.
    const cold = await readScenarioAnalysis({ scenarioId: result.scenario_id, graph: g as never, requestId: 'r7-stale' });
    expect(cold.analysis_state?.run_state.kind).toBe('complete_stale');
    expect(cold.analysis_state?.leader_claim.withheld_reason).toBe(compose.WITHHELD_RUN_OUT_OF_DATE);
  });

  it('the scenario permission reader carries the newer cause, rather than an older hot-window Run', async () => {
    const newest = factOf(await runP0Graph(graph(1), brief));
    const older = factOf(await runP0Graph(graph(3), brief));
    (newest as R).result.computed_at = '2026-10-05T22:00:00.000Z';
    (older as R).result.computed_at = '2026-10-05T21:00:00.000Z';
    const verdict = readMayNameLeadingOptionVerdict([older], { newestAnalysisFact: newest, readOk: true, windowTruncated: false } as never);
    expect(verdict.unsized_path_cause?.from).toBe('starter_support_cost');
    expect(verdict.may_name_leading_option).toBe(false);
  });

  it('a newer permitted partial Run cannot erase the displayed older Run’s stated cause', async () => {
    const displayed = factOf(await runP0Graph(graph(1), brief));
    const partial = factOf(await runP0Graph(graph(2, true), brief));
    (displayed as R).result.computed_at = '2026-10-05T21:00:00.000Z';
    (partial as R).result.computed_at = '2026-10-05T22:00:00.000Z';
    (partial as R).result.enrichment.analysis_status = 'partial';
    const verdict = readMayNameLeadingOptionVerdict([partial, displayed], { newestAnalysisFact: null, readOk: true, windowTruncated: false });
    expect(verdict.provenance).toBe('fail_closed_projected_analysis');
    expect(verdict.may_name_leading_option).toBe(false);
    expect(verdict.unsized_path_cause?.from).toBe('starter_support_cost');
  });

  it('a missing or partial persisted cause is not reconstructed', () => {
    expect(readUnsizedPathLeaderCause({ enrichment: { [UNSIZED_PATH_LEADER_CAUSE_KEY]: { from: 'x', to: 'g' } } })).toBeUndefined();
    expect(readUnsizedPathLeaderCause({ enrichment: {} })).toBeUndefined();
  });
});
