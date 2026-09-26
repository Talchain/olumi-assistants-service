/**
 * ⛔ C46 ON THE V5 FINALISER (H2) — THE PRODUCT CAUSE IS STATED BY THE CALLER THAT REFUSED, NEVER DERIVED HERE.
 *
 * The handoff patch's H2 hunk (`c46-handoff-v2.patch`) computed the C46 cause INSIDE `attachAnalysisState`, from the
 * fact the finaliser picked itself (`selectRunAnalysisFact(ctx.priorFacts)`) and this turn's `ctx.graph`. OpenAI
 * Runtime's review point (#70 5843934816) was the second half: after an edit, that judges a graph the run never
 * analysed. Checking it found the first half is the SAME defect class #1876 was sent back for
 * (`leader-claim-withheld-cause-binding.test.ts`): the turn's refusal is read by the ENTITLEMENT selector
 * (`readMayNameLeadingOptionVerdict`: newest fact of ANY status, unioned with the durable newest, over the
 * post-handler set), the finaliser's pick by the FRESHNESS selector (newest SUCCESSFUL fact in its window). Two
 * facts, one sentence — and `FinaliserContext.graph` is documented as a nullness signal, "never read for content".
 *
 * So H2 is the precedent's shape: `FinaliserContext.leaderWithheldBecauseNonlinearIdentity`, stated by the caller
 * that decided `mayNameLeadingOption === false`, passed to the composer, never derived. The turn caller that states
 * it from the refusal's OWN fact and the graph that run analysed is a named HANDOFF (Runtime, H2b). Until then a
 * turn exit says the constraint token — the base behaviour, exactly as for `leaderWithheldBecauseUnrequested`.
 *
 * Every fact here is the one the REAL handler wrote for a model the REAL construction built (PLoT faked, £59 at
 * 0.94). A synthesised field is labelled where it is made.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunAnalysisHandlerFactSchema, type RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { buildAnalysisResultBlock, composeDirectAnswerResponse } from '../compose.js';
import { finaliseV5Response } from '../response-finaliser.js';
import { readMayNameLeadingOptionVerdict } from '../context/claim-safety-read.js';
import { deriveAnalysisFreshness } from '../context/freshness.js';
import { canonicalStateFromFreshness } from '../context/canonical-analysis-state.js';
import { deriveDecisionContextGraphHash, loadScenarioSnapshotForRunAnalysis } from '../build-turn-context.js';
import { buildModelFromBrief, type CallStructuredModel } from '../agent-lane/runtime/build-model.js';
import type { InternalDispatch } from '../agent-lane/runtime/agent-capabilities.js';
import { nonlinearIdentityLeaderWithhold } from '../agent-lane/admit-model.js';
import type { SessionStore } from '../session/store.js';
import type { PLoTClient } from '../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../orchestrator/types.js';
import type { HandlerInvocation } from '../tools/registry.js';
import { createRunAnalysisHandler } from '../tools/handlers/run-analysis.js';
import { makeMessagePayload } from './fixtures.js';
import { AUTO_RUN_POST_CONSTRUCTION_INITIATOR, RUN_PROVENANCE_ENRICHMENT_KEY } from '../context/run-initiator.js';
import { leaderWithheldForALimit } from '../coaching/limit-unchecked-card.js';
import {
  WITHHELD_CONSTRAINT_VERDICT,
  WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN,
  WITHHELD_UNREQUESTED_ANALYSIS,
} from '../compose/analysis-state-v1.js';

const SCENARIO = '46464646-4646-4646-8646-464646464648';
const REQUEST_ID = 'req-mg-c46-finaliser';
const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months, should we increase the Pro plan price from £49 to £59 per month?';
const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;

const link = (from: string, to: string, direction: 'positive' | 'negative') => ({ from, to, direction, provenance: 'inferred' });
const GOAL = { metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
  baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null };
/** Paul's shape with NO limit: MRR = Pro plan price × Pro subscribers; raising the price raises churn. */
const PRODUCT = {
  goal: GOAL, constraints: [],
  options: [
    { label: 'Keep Pro at £49', provenance: 'explicit', is_status_quo: true, changes: [],
      interventions: [{ factor_label: 'Pro plan price', value: 49, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    { label: 'Raise Pro to £59', provenance: 'explicit', is_status_quo: null, changes: [],
      interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
  ],
  factors: [
    { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
    { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
    { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 5, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
  ],
  risks: [], outcomes: [],
  links: [link('Pro plan price', 'Monthly churn', 'positive'), link('Monthly churn', 'Pro subscribers', 'negative'),
    link('Pro plan price', 'MRR', 'positive'), link('Pro subscribers', 'MRR', 'positive')],
  identities: [{ outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Pro subscribers'], provenance: 'inferred' }],
  unknowns: [],
};

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };

async function build(wire: Record<string, unknown>): Promise<Graph> {
  let registered: unknown = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief(SCENARIO, BRIEF, dispatch, call);
  expect(out.ok, JSON.stringify(out)).toBe(true);
  return registered as Graph;
}

/** The persisted fact the real handler writes, PLoT faked with £59 first at 0.94 — a REQUESTED run. */
async function runOn(registered: Graph): Promise<RunAnalysisHandlerFact> {
  const store = { loadGraphAndBriefText: async () => ({ graph: registered, briefText: null }) } as unknown as SessionStore;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, REQUEST_ID, store);
  const env = structuredClone(happyFixture) as unknown as Record<string, unknown>;
  env.results = [
    { option_id: 'raise_pro_to_59', option_label: 'Raise Pro to £59', win_probability: 0.94, percentile_p10: 0.1, percentile_p90: 0.9 },
    { option_id: 'keep_pro_at_49', option_label: 'Keep Pro at £49', win_probability: 0.06, percentile_p10: 0.1, percentile_p90: 0.9 },
  ];
  env.robustness = { level: 'high', fragile_edges: [], near_tie: { is_tie: false } };
  env.fact_objects = [];
  env.review_cards = [];
  delete env.constraint_analysis;
  const plotClient = { run: vi.fn(() => Promise.resolve(env)), validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const invocation = {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'Run the analysis now.' }],
      session_id: SCENARIO, request_id: REQUEST_ID, budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'Run the analysis now.', turn_class: 'decide', stage: 'analyse' }),
    requestId: REQUEST_ID, signal: new AbortController().signal, orientationText: '',
  } as HandlerInvocation;
  const outcome = await createRunAnalysisHandler({ plotClient, scenarioReader: async () => snapshot })(invocation);
  return outcome.handler_facts[0] as RunAnalysisHandlerFact;
}

/** The dispatcher's auto-run stamp, as the automatic first pass carries it. */
const autoInitiated = (fact: RunAnalysisHandlerFact): RunAnalysisHandlerFact => ({
  ...fact,
  result: { ...fact.result, enrichment: { ...(fact.result.enrichment ?? {}), [RUN_PROVENANCE_ENRICHMENT_KEY]: { initiated_by: AUTO_RUN_POST_CONSTRUCTION_INITIATOR } } },
});

/**
 * ⚠ SYNTHESISED, LABELLED: the user's NEWER run on the same graph, which PLoT returned `partial` and whose limit was
 * checked and NOT met. The freshness selector skips a partial fact; the entitlement selector reads it (#730/#1876).
 */
const newerPartialLimitFailed = (fact: RunAnalysisHandlerFact): RunAnalysisHandlerFact => RunAnalysisHandlerFactSchema.parse({
  ...fact,
  result: {
    ...fact.result,
    computed_at: new Date(Date.parse(fact.result.computed_at!) + 60_000).toISOString(),
    constraint_verdict: { may_name_leading_option: false, constraint_verdict_state: 'evaluated_infeasible' },
    enrichment: { ...(fact.result.enrichment ?? {}), analysis_status: 'partial' },
  },
}) as RunAnalysisHandlerFact;

const ANALYSIS_READY = { status: 'ready' as const, goal_node_id: 'mrr', options: [], analysis_admission: { permitted_analysis_mode: 'comparative_leader' } };

/** The V5 finaliser on a turn exit, exactly as the conventional route hands it the turn_executor context. */
function finalise(graph: Graph, window: readonly RunAnalysisHandlerFact[], shown: RunAnalysisHandlerFact, mayNameLeadingOption: boolean, extra: Record<string, unknown> = {}) {
  const freshness = deriveAnalysisFreshness(window, deriveDecisionContextGraphHash(graph), undefined, { priorFactsReadOk: true });
  const response = composeDirectAnswerResponse({
    assistant_text: 'Here is where the analysis stands.', stage: 'analyse', answerKind: 'substantive',
    blocks: [buildAnalysisResultBlock(shown, ANALYSIS_READY as never)],
  });
  return finaliseV5Response(response, {
    scenarioId: SCENARIO,
    analysisReady: ANALYSIS_READY as never,
    freshness,
    canonicalState: canonicalStateFromFreshness(freshness, {}),
    priorFacts: window,
    mayNameLeadingOption,
    graph,
    ...extra,
  } as never);
}

const SCOPE = { newestAnalysisFact: null, readOk: true, windowTruncated: false } as const;

describe('H2 — the finaliser names the product cause only when the caller that refused states it', () => {
  it('PREMISE: the real handler stamped the product run — no leader may be named, its constraint state PERMITS', async () => {
    const graph = await build(PRODUCT);
    const fact = await runOn(graph);
    expect(fact.result.leading_option_id).toBe('raise_pro_to_59');
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: false, constraint_verdict_state: 'not_applicable' });
    expect(deriveDecisionContextGraphHash(graph)).toBe(fact.result.graph_hash_at_run);
  });

  it('RED: the caller states the product cause → `nonlinear_identity_sign_unproven`, and no limit card trigger', async () => {
    const graph = await build(PRODUCT);
    const fact = await runOn(graph);
    const verdict = readMayNameLeadingOptionVerdict([fact], SCOPE);
    expect(verdict.may_name_leading_option, 'premise: the turn verdict refuses on this fact').toBe(false);
    const out = finalise(graph, [fact], fact, verdict.may_name_leading_option, { leaderWithheldBecauseNonlinearIdentity: true });
    expect(out.analysis_state?.leader_claim).toMatchObject({ permitted: false, withheld_reason: WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN });
    expect(leaderWithheldForALimit(out.analysis_state)).toBe(false);
  });

  it('CONTROL: the stated cause is never a grant — an entitled turn names no product cause', async () => {
    const graph = await build(PRODUCT);
    const fact = await runOn(graph);
    const out = finalise(graph, [fact], fact, true, { leaderWithheldBecauseNonlinearIdentity: true });
    expect(out.analysis_state?.leader_claim.withheld_reason).not.toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
  });

  it('CONTROL (the composer\'s order): the unrequested first pass, stated too, keeps its code over the product', async () => {
    const graph = await build(PRODUCT);
    const fact = autoInitiated(await runOn(graph));
    const out = finalise(graph, [fact], fact, false, { leaderWithheldBecauseUnrequested: true, leaderWithheldBecauseNonlinearIdentity: true });
    expect(out.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_UNREQUESTED_ANALYSIS);
  });

  it('BASE: nothing stated → the constraint token, even with the product fact in the window and the product graph in scope', async () => {
    const graph = await build(PRODUCT);
    const fact = await runOn(graph);
    const out = finalise(graph, [fact], fact, false);
    expect(out.analysis_state?.leader_claim).toMatchObject({ permitted: false, withheld_reason: WITHHELD_CONSTRAINT_VERDICT });
  });
});

describe('why the finaliser cannot derive it (#1876\'s class, C46 edition): the refusal and its pick are two facts', () => {
  it('RED A: the user\'s NEWER partial run failed its limit — the refusal is that limit; a derived cause would hide it as the product', async () => {
    const graph = await build(PRODUCT);
    const a = await runOn(graph);
    const b = newerPartialLimitFailed(a);
    const verdict = readMayNameLeadingOptionVerdict([a, b], SCOPE);
    expect(verdict, 'premise: the turn verdict is B\'s failed limit').toMatchObject({ may_name_leading_option: false, constraint_verdict_state: 'evaluated_infeasible' });
    // The pick a finaliser-side derivation would use is A — the product run, fresh on this very graph.
    expect(nonlinearIdentityLeaderWithhold(graph, 'raise_pro_to_59', { comparedOptionIds: ['raise_pro_to_59', 'keep_pro_at_49'] })).not.toBeNull();
    const out = finalise(graph, [a, b], a, verdict.may_name_leading_option);
    expect(out.analysis_state?.leader_claim).toMatchObject({ permitted: false, withheld_reason: WITHHELD_CONSTRAINT_VERDICT });
    expect(leaderWithheldForALimit(out.analysis_state), 'the failed limit keeps its card').toBe(true);
  });

  it('RED A′: the older product run was the AUTOMATIC first pass — a derived cause would call the user\'s own failed-limit Run "unrequested"', async () => {
    const graph = await build(PRODUCT);
    const a = autoInitiated(await runOn(graph));
    const b = newerPartialLimitFailed(await runOn(graph));
    const verdict = readMayNameLeadingOptionVerdict([a, b], SCOPE);
    expect(verdict.constraint_verdict_state, 'premise: the refusal is B\'s failed limit').toBe('evaluated_infeasible');
    const out = finalise(graph, [a, b], a, verdict.may_name_leading_option);
    expect(out.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
  });

  it('RED (Runtime\'s point, finaliser edition): edited since the run, product kept — nothing new is withheld on a graph the run never analysed', async () => {
    const graph = await build(PRODUCT);
    const fact = await runOn(graph);
    const edited = structuredClone(graph);
    const n = edited.nodes.find((x) => x.id === 'pro_subscribers')!;
    expect((n.observed_state as { value?: unknown }).value, 'premise: the stored starting level, 300 of 2,000').toBe(0.15);
    n.observed_state = { ...(n.observed_state as object), value: 0.2 };
    expect(deriveDecisionContextGraphHash(edited), 'premise: the edit changed what the analysis reads').not.toBe(fact.result.graph_hash_at_run);
    expect(nonlinearIdentityLeaderWithhold(edited, 'raise_pro_to_59', { comparedOptionIds: ['raise_pro_to_59', 'keep_pro_at_49'] }), 'premise: this graph\'s own sign test would find the product').not.toBeNull();
    const out = finalise(edited, [fact], fact, false);
    expect(out.analysis_state?.run_state).toMatchObject({ kind: 'complete_stale' });
    expect(out.analysis_state?.leader_claim).toMatchObject({ permitted: false, withheld_reason: WITHHELD_CONSTRAINT_VERDICT });
  });
});
