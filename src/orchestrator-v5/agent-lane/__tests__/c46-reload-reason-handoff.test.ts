/**
 * ⛔ C46 STAGE 1 — WHAT THE PRODUCTION RELOAD SAYS TODAY, AND THE HANDOFF THAT MAKES IT SAY THE TRUE CAUSE.
 *
 * `c46-leader-withheld-on-a-product.test.ts` proves the producer: the carrier, the Run's stamp, the reason
 * code and its precedence, composed with the inputs `nonlinearIdentityLeaderClaimCause` supplies. The two
 * production callers of `composeAnalysisStateV1` — the scenario read route (`routes/scenario-graph-analysis-
 * read.ts`, which also serves the Agent turn's final readback) and the V5 finaliser (`response-finaliser.ts`)
 * — are OUTSIDE MG's C46 lease, so neither passes that cause yet.
 *
 * This file drives the REAL reload (`readScenarioAnalysis`, session store faked) on the fact the REAL handler
 * wrote for a model the REAL construction built, and pins both halves:
 *  · GREEN: the Run's stamp reaches the reload — no leader is designated (`permitted:false`, the
 *    `analysis_result` block names no leader), and a linear brief is unchanged.
 *  · `it.fails` TRIPWIRES — each asserts what must be true once the caller line lands, and fails today:
 *    the reload names `nonlinear_identity_sign_unproven`; the limit card's trigger does NOT fire on a brief
 *    that set no limit; the automatic first pass keeps `unrequested_analysis_withheld`. Today the reload
 *    publishes `constraint_verdict_withheld` for all three, which is why this PR must not merge ahead of the
 *    HANDOFF. When the caller line lands these fail loudly and must be flipped to `it`.
 *  · A FOURTH TRIPWIRE (verification of 1047641f, blocking): the Delivery Lead's acceptance case — Paul's brief with
 *    the churn limit scored and met. Today the reload tells him his churn limit "was not checked or not met".
 *
 * ⭐ H1 LANDED (read route, seam reviewer Canonical State): the four tripwires are `it` now. The route passes
 * `nonlinearIdentityLeaderClaimCause` the ONE fact its permission was read from, this graph, and its own freshness
 * hash of this graph — so the graph the run ANALYSED decides (OpenAI Runtime #70 5843934816). The last block pins
 * Runtime's row on the reload: after an edit the run is not current, nothing new is withheld, and the reply is the
 * one a linear brief's out-of-date run gets.
 *
 * ⭐ H1a (Canonical State, #70 5844217159): "the graph the run analysed" is decided by the analysis hash, so that hash
 * must read the C46 carrier. The last block pins it: a persisted graph that LOST `nonlinear_identity` since the run is
 * not the analysed graph, and a graph that never carried one hashes to the same bytes as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

const readRecent = vi.fn();
const readFactsFor = vi.fn();
const readFactsWithTurnFor = vi.fn();
const readScenarioRunAnalysisFactsFor = vi.fn();
const readAnalysisInvalidatedAt = vi.fn();
vi.mock('../../session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session/index.js')>()),
  getSessionStore: () => ({
    readRecent,
    readFactsFor,
    readFactsWithTurnFor,
    readScenarioRunAnalysisFactsFor,
    readAnalysisInvalidatedAt,
  }),
}));

import { readScenarioAnalysis } from '../../../routes/scenario-graph-analysis-read.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { deriveDecisionContextGraphHash, loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { computeAnalysisAffectingGraphHash, computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import type { SessionStore } from '../../session/store.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { AUTO_RUN_POST_CONSTRUCTION_INITIATOR, RUN_PROVENANCE_ENRICHMENT_KEY } from '../../context/run-initiator.js';
import { leaderWithheldForALimit } from '../../coaching/limit-unchecked-card.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { normaliseGraphNodeKindField } from '../../graph-registration/normalise-node-kind.js';
import { applyFactorValueEdit } from '../../system-events/factor-value-edit.js';
import { applyStructuralRename } from '../../system-events/structural-rename.js';
import { applyStructuralAdd } from '../../system-events/structural-add.js';
import { applyStructuralAddEdge } from '../../system-events/structural-add-edge.js';
import { applyStructuralDelete } from '../../system-events/structural-delete.js';
import { applyEdgeStrengthEdit } from '../../system-events/edge-strength-edit.js';
import { applyGoalTargetEdit } from '../../system-events/goal-target-edit.js';
import { applyOptionInterventionEdit } from '../../system-events/option-intervention-edit.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import {
  WITHHELD_CONSTRAINT_VERDICT,
  WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN,
  WITHHELD_UNREQUESTED_ANALYSIS,
} from '../../compose/analysis-state-v1.js';

const SCENARIO = '46464646-4646-4646-8646-464646464647';
const REQUEST_ID = 'req-mg-c46-reload';
const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months, should we increase the Pro plan price from £49 to £59 per month?';
const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;

const link = (from: string, to: string, direction: 'positive' | 'negative') => ({ from, to, direction, provenance: 'inferred' });
const GOAL = { metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
  baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null };
const OPTIONS = [
  { label: 'Keep Pro at £49', provenance: 'explicit', is_status_quo: true, changes: [],
    interventions: [{ factor_label: 'Pro plan price', value: 49, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
  { label: 'Raise Pro to £59', provenance: 'explicit', is_status_quo: null, changes: [],
    interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
];
const PRICE = { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 };

/** Paul's shape with NO limit: MRR = Pro plan price × Pro subscribers; raising the price raises churn. */
const PRODUCT = {
  goal: GOAL, constraints: [], options: OPTIONS,
  factors: [PRICE,
    { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
    { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 5, unit: '%', provenance: 'ai_proposed', plausible_max: 100 }],
  risks: [], outcomes: [],
  links: [link('Pro plan price', 'Monthly churn', 'positive'), link('Monthly churn', 'Pro subscribers', 'negative'),
    link('Pro plan price', 'MRR', 'positive'), link('Pro subscribers', 'MRR', 'positive')],
  identities: [{ outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Pro subscribers'], provenance: 'inferred' }],
  unknowns: [],
};
/** Paul's shape WITH his churn limit ("keeping monthly churn under 10%") — the Delivery Lead's acceptance brief. */
const PRODUCT_WITH_CHURN_LIMIT = { ...PRODUCT, constraints: [{ metric: 'Monthly churn', operator: '<=', value: 10, unit: '%', provenance: 'explicit' }] };
/** CONTROL: the additive goal — MRR = Pro MRR + Non-Pro MRR, no product declared. */
const ADDITIVE = {
  ...PRODUCT, identities: [],
  factors: [PRICE, { label: 'Non-Pro MRR', role: 'observable', baseline_known: false, baseline_value: 5000, unit: 'GBP', provenance: 'ai_proposed', plausible_max: 50000 }],
  outcomes: [{ label: 'Pro MRR', provenance: 'inferred' }],
  links: [link('Pro plan price', 'Pro MRR', 'positive'), link('Pro MRR', 'MRR', 'positive'), link('Non-Pro MRR', 'MRR', 'positive')],
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

/** The persisted fact the real handler writes, PLoT faked with £59 first at 0.94. */
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

/** The production reload over that one persisted fact. */
async function reload(graph: Graph, fact: RunAnalysisHandlerFact) {
  readScenarioRunAnalysisFactsFor.mockResolvedValue({
    facts: [{ fact, fact_row_id: 'run-row', fact_created_at: fact.result.computed_at }],
    total_count: 1,
  });
  return readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: REQUEST_ID });
}

/**
 * ⚠ SYNTHESISED, ONE FIELD, LABELLED: the persisted verdict once the churn limit is SCORED AND MET. At this head churn
 * cannot be scored (it is worked out from other parts; staging #1919), so the real handler writes `unevaluated`
 * (asserted as the premise below). Once it is scored and met, the constraint verdict PERMITS
 * (`evaluated_feasible`) and the C46 conjunct alone removes the permission, leaving the state untouched — exactly
 * this pair (verification of 1047641f, P6; `applyNonlinearIdentityToLeaderPermission`).
 */
const churnScoredAndMet = (fact: RunAnalysisHandlerFact): RunAnalysisHandlerFact => ({
  ...fact,
  result: { ...fact.result, constraint_verdict: { may_name_leading_option: false, constraint_verdict_state: 'evaluated_feasible' } },
});

const autoInitiated = (fact: RunAnalysisHandlerFact): RunAnalysisHandlerFact => ({
  ...fact,
  result: { ...fact.result, enrichment: { ...(fact.result.enrichment ?? {}), [RUN_PROVENANCE_ENRICHMENT_KEY]: { initiated_by: AUTO_RUN_POST_CONSTRUCTION_INITIATOR } } },
});

beforeEach(() => {
  vi.clearAllMocks();
  readRecent.mockResolvedValue([]);
  readFactsFor.mockResolvedValue([]);
  readFactsWithTurnFor.mockResolvedValue([]);
  readAnalysisInvalidatedAt.mockResolvedValue(null);
});

describe('C46 on the production reload — the stamp reaches it; the REASON waits on the caller HANDOFF', () => {
  it('GREEN: the Run\'s stamp reaches the reload — a current run, no leader designated, on the product brief', async () => {
    const graph = await build(PRODUCT);
    const fact = await runOn(graph);
    expect(fact.result.leading_option_id).toBe('raise_pro_to_59');
    const read = await reload(graph, fact);
    expect(read.analysis_state?.run_state.kind, 'premise: the reload selected this run as current').toBe('complete_current');
    expect(read.analysis_state?.leader_claim.permitted).toBe(false);
    expect((read.analysis_result as { leading_option_id?: unknown } | null)?.leading_option_id).toBeNull();
  });

  it('CONTROL: the additive brief reloads exactly as before — its leader is permitted, with no reason', async () => {
    const graph = await build(ADDITIVE);
    const read = await reload(graph, await runOn(graph));
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
    expect(read.analysis_state?.leader_claim).toEqual({ permitted: true, separation: 'separated' });
    expect((read.analysis_result as { leading_option_id?: unknown } | null)?.leading_option_id).toBe('raise_pro_to_59');
  });

  it('HANDOFF (landed): the reload names the C46 reason (needs the read-route caller line)', async () => {
    const graph = await build(PRODUCT);
    const read = await reload(graph, await runOn(graph));
    expect(read.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
  });

  it('HANDOFF (landed): no limit card is triggered on a brief that set no limit (needs the caller line)', async () => {
    const graph = await build(PRODUCT);
    const read = await reload(graph, await runOn(graph));
    expect(leaderWithheldForALimit(read.analysis_state)).toBe(false);
  });

  it('HANDOFF (landed): the automatic first pass keeps `unrequested_analysis_withheld` (needs the caller line)', async () => {
    const graph = await build(PRODUCT);
    const read = await reload(graph, autoInitiated(await runOn(graph)));
    expect(read.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_UNREQUESTED_ANALYSIS);
  });

  it('PREMISE (churn limit set, not yet scorable at this head): the real handler writes `unevaluated`, and the limit keeps its card', async () => {
    const graph = await build(PRODUCT_WITH_CHURN_LIMIT);
    const fact = await runOn(graph);
    expect(fact.result.leading_option_id).toBe('raise_pro_to_59');
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: false, constraint_verdict_state: 'unevaluated' });
    const read = await reload(graph, fact);
    expect(read.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
    expect(leaderWithheldForALimit(read.analysis_state)).toBe(true);
    // The scored case below still withholds the leader at this head — only its REASON is wrong.
    const scored = await reload(graph, churnScoredAndMet(fact));
    expect(scored.analysis_state?.leader_claim.permitted).toBe(false);
    expect((scored.analysis_result as { leading_option_id?: unknown } | null)?.leading_option_id).toBeNull();
  });

  it('HANDOFF (landed, acceptance case): churn SCORED AND MET — the reload names the product, never "your churn limit was not met" (needs the caller line)', async () => {
    const graph = await build(PRODUCT_WITH_CHURN_LIMIT);
    const read = await reload(graph, churnScoredAndMet(await runOn(graph)));
    expect(read.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
    expect(leaderWithheldForALimit(read.analysis_state)).toBe(false);
  });
});

/**
 * ⛔ RUNTIME'S ROW ON THE RELOAD (#70 5843934816): a run on the product graph (MRR = price × subscribers), then an
 * edit. Which graph decides, and what does the reload say?
 *
 * The run analysed the registered graph; after an analysis-affecting edit the read route's freshness hash of the
 * edited graph differs from the run's `graph_hash_at_run`, so the run is not current, the route selects no fact to
 * present (`selected = fresh ? historical : null`) and the C46 cause is never judged — neither on the edited graph
 * nor on the analysed one, which no fact carries. Nothing new is withheld: the reply is EXACTLY the reply a linear
 * brief's out-of-date run gets (the CONTROL below, whose run PERMITTED its leader).
 *
 * These two rows pass without H1 as well (EXECUTED): the route presents no fact once the run is out of date. They
 * GUARD the rule — a route that judged its historical fact on the edited graph would name the product here.
 *
 * ⚠ That reply's reason, `constraint_verdict_withheld`, is the base read route's for EVERY out-of-date run (no fact ⇒
 * `mayNameLeadingOption: false` ⇒ the constraint token), not a C46 claim. It is pinned here as today's value, by
 * identity with the linear control; whether an out-of-date run should carry a limit reason at all is Canonical's.
 */
describe('Runtime\'s row on the reload: after an edit, the graph the run analysed is out of reach — nothing new is withheld', () => {
  /** The user deletes "Pro subscribers": its node, every link touching it, and the product it made MRR. */
  const withoutTheProduct = (g: Graph): Graph => {
    const out = structuredClone(g);
    out.nodes = out.nodes.filter((n) => n.id !== 'pro_subscribers');
    out.edges = out.edges.filter((e) => e.from !== 'pro_subscribers' && e.to !== 'pro_subscribers');
    for (const n of out.nodes) delete n.nonlinear_identity;
    return out;
  };
  /** An edit that KEEPS the product: Pro subscribers' starting level, 300 → 400 of a plausible 2,000 (0.15 → 0.2). */
  const subscribersAt400 = (g: Graph): Graph => {
    const out = structuredClone(g);
    const n = out.nodes.find((x) => x.id === 'pro_subscribers')!;
    expect((n.observed_state as { value?: unknown }).value, 'premise: the stored starting level').toBe(0.15);
    n.observed_state = { ...(n.observed_state as object), value: 0.2 };
    return out;
  };
  /** The linear brief's out-of-date reload: its run PERMITTED "Raise Pro to £59"; then "Non-Pro MRR" is deleted. */
  async function linearStaleReload() {
    const graph = await build(ADDITIVE);
    const fact = await runOn(graph);
    expect(fact.result.constraint_verdict?.may_name_leading_option, 'premise: the linear run permitted its leader').toBe(true);
    const edited = structuredClone(graph);
    edited.nodes = edited.nodes.filter((n) => n.id !== 'non_pro_mrr');
    edited.edges = edited.edges.filter((e) => e.from !== 'non_pro_mrr' && e.to !== 'non_pro_mrr');
    return reload(edited, fact);
  }
  const STALE_REPLY = { permitted: false, withheld_reason: WITHHELD_CONSTRAINT_VERDICT };

  it('PREMISE: before the edit the reload judges the graph the run analysed — the product is the reason', async () => {
    const graph = await build(PRODUCT);
    const fact = await runOn(graph);
    expect(deriveDecisionContextGraphHash(graph), 'the read route\'s hash of this graph is the run\'s').toBe(fact.result.graph_hash_at_run);
    const read = await reload(graph, fact);
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
    expect(read.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
  });

  it('GUARD (Runtime\'s row): the edit REMOVES the product — the run is out of date, no leader, and the reply is the linear brief\'s out-of-date reply, never the product', async () => {
    const graph = await build(PRODUCT);
    const fact = await runOn(graph);
    const edited = withoutTheProduct(graph);
    expect(deriveDecisionContextGraphHash(edited), 'premise: the edit changed what the analysis reads').not.toBe(fact.result.graph_hash_at_run);
    const read = await reload(edited, fact);
    expect(read.analysis_state?.run_state).toMatchObject({ kind: 'complete_stale', cause: 'graph_changed' });
    expect(read.analysis_result).toBeNull();
    expect(read.analysis_state?.leader_claim).toEqual(STALE_REPLY);
    const control = await linearStaleReload();
    expect(control.analysis_state?.run_state).toMatchObject({ kind: 'complete_stale', cause: 'graph_changed' });
    expect(read.analysis_state?.leader_claim, 'the same reply as the linear brief\'s out-of-date run').toEqual(control.analysis_state?.leader_claim);
    expect(leaderWithheldForALimit(read.analysis_state)).toBe(leaderWithheldForALimit(control.analysis_state));
  });

  it('GUARD (discriminating): the edit KEEPS the product — still a graph the run never analysed; the same out-of-date reply, never the product', async () => {
    const graph = await build(PRODUCT);
    const fact = await runOn(graph);
    const edited = subscribersAt400(graph);
    expect(deriveDecisionContextGraphHash(edited), 'premise: the edit changed what the analysis reads').not.toBe(fact.result.graph_hash_at_run);
    const read = await reload(edited, fact);
    expect(read.analysis_state?.run_state).toMatchObject({ kind: 'complete_stale', cause: 'graph_changed' });
    expect(read.analysis_result).toBeNull();
    expect(read.analysis_state?.leader_claim).toEqual(STALE_REPLY);
  });
});

/**
 * ⛔ H1a (Canonical State, #70 5844217159, CEE #1972 5844218027): `fresh` MUST MEAN THE RUN'S OWN CARRIER.
 *
 * H1 judges the C46 cause only when the route's freshness hash of the persisted graph equals the fact's
 * `graph_hash_at_run`. That hash is the analysis-affecting projection (`context/graph-hash.ts` `projectNode`), and it
 * did not read `nonlinear_identity`. So a persisted graph that LOST the carrier since the run still read `fresh`, H1
 * judged the run on a graph it never analysed, and — on a brief that set NO limit — the reload presented a CURRENT
 * run whose leader was withheld for a limit (EXECUTED at 8b4684ef: `complete_current`, `constraint_verdict_withheld`,
 * `leaderWithheldForALimit` true).
 *
 * With the carrier in the projection, the carrier-less graph is a graph the run never analysed: it is out of date, and
 * the reply is the one every out-of-date run gets (Runtime's row above). A graph that never carried a declaration —
 * every graph before #1972 — hashes to the SAME bytes as before (BYTE row), so no stored scenario reads stale and no
 * model-version identity moves.
 */
describe('H1a: the analysis hash covers the C46 carrier — a graph that lost it is not fresh', () => {
  /** The persisted graph after the carrier is lost (a writer or a round trip that does not keep the field). */
  const withoutCarrier = (g: Graph): Graph => {
    const out = structuredClone(g);
    for (const n of out.nodes) delete n.nonlinear_identity;
    return out;
  };
  const carrierIds = (g: Graph) => g.nodes.filter((n) => n.nonlinear_identity !== undefined).map((n) => n.id);
  const HEX16 = /^[0-9a-f]{16}$/;

  it('PREMISE: the product graph carries the declaration on the goal, and dropping it MOVES the route\'s hash off the run\'s', async () => {
    const graph = await build(PRODUCT);
    expect(carrierIds(graph), 'the construction put the one declaration on MRR').toEqual(['mrr']);
    const fact = await runOn(graph);
    const atRun = fact.result.graph_hash_at_run;
    expect(atRun).toMatch(HEX16);
    expect(deriveDecisionContextGraphHash(graph), 'the route\'s hash of the analysed graph is the run\'s').toBe(atRun);
    const lost = deriveDecisionContextGraphHash(withoutCarrier(graph));
    expect(lost, 'a real hash, not an unhashable graph').toMatch(HEX16);
    expect(lost, 'the graph without its carrier is not the graph the run analysed').not.toBe(atRun);
  });

  it('CONTRAST: the hash moves on an analysis field (the goal threshold) and not on a display field (a label)', async () => {
    const graph = await build(PRODUCT);
    const base = deriveDecisionContextGraphHash(graph);
    expect(base).toMatch(HEX16);
    const goal = graph.nodes.find((n) => n.id === 'mrr')!;
    expect(goal.goal_threshold, 'premise: the stored threshold').toBe(0.8);
    const threshold = structuredClone(graph);
    threshold.nodes.find((n) => n.id === 'mrr')!.goal_threshold = 0.9;
    expect(deriveDecisionContextGraphHash(threshold)).toMatch(HEX16);
    expect(deriveDecisionContextGraphHash(threshold)).not.toBe(base);
    const relabelled = structuredClone(graph);
    relabelled.nodes.find((n) => n.id === 'mrr')!.label = 'Monthly recurring revenue';
    expect(deriveDecisionContextGraphHash(relabelled)).toBe(base);
  });

  it('CONTROL: on the graph the run analysed, H1 names the product and no limit card fires', async () => {
    const graph = await build(PRODUCT);
    const read = await reload(graph, await runOn(graph));
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
    expect(read.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
    expect(leaderWithheldForALimit(read.analysis_state)).toBe(false);
  });

  it('⭐ RULE: after the persisted graph loses the carrier, no CURRENT run reads "withheld for a limit" on a brief that set none', async () => {
    const graph = await build(PRODUCT);
    expect(PRODUCT.constraints, 'premise: the brief set no limit').toEqual([]);
    const fact = await runOn(graph);
    const read = await reload(withoutCarrier(graph), fact);
    const current = read.analysis_state?.run_state.kind === 'complete_current';
    expect(current && leaderWithheldForALimit(read.analysis_state),
      'a CURRENT run said to be withheld for a limit, on a brief that set none').toBe(false);
    // The graph the run analysed is out of reach: the run is out of date and nothing is presented (Runtime's row).
    expect(read.analysis_state?.run_state).toMatchObject({ kind: 'complete_stale', cause: 'graph_changed' });
    expect(read.analysis_result).toBeNull();
    expect(read.analysis_state?.leader_claim.permitted).toBe(false);
  });

  /**
   * BYTE: the zero-one-time-cost claim. A carrier-free graph shaped like the pricing model, touching every projected
   * node family (goal threshold/raw/cap, observed state, prior, intercept, encoding map, option levels with a native
   * quantity). Both pins were computed at 8b4684ef (BEFORE the carrier entered the projection) by running this row, and
   * written in by script: the 16-hex freshness token and the 64-hex model-version address.
   */
  it('BYTE: a graph that never carried the declaration hashes to the same bytes as before H1a', () => {
    const graph = {
      nodes: [
        { id: 'decision_mrr', kind: 'decision', label: 'Pro plan price decision' },
        { id: 'mrr', kind: 'goal', label: 'MRR', goal_threshold: 0.8, goal_threshold_raw: 20000, goal_threshold_cap: 25000, goal_threshold_unit: 'GBP' },
        { id: 'pro_plan_price', kind: 'factor', label: 'Pro plan price', category: 'controllable', factor_type: 'price',
          observed_state: { value: 0.245, baseline: 0.245, cap: 200, unit: 'GBP', raw_value: 49 } },
        { id: 'pro_subscribers', kind: 'factor', label: 'Pro subscribers', category: 'observable', intercept: 0.1,
          observed_state: { value: 0.15, cap: 2000 }, prior: { distribution: 'normal', range_min: 0, range_max: 1 } },
        { id: 'plan_tier', kind: 'factor', label: 'Plan tier', category: 'external', encoding_map: { basic: 0, pro: 1 } },
        { id: 'opt_keep', kind: 'option', label: 'Keep Pro at £49', is_baseline: true },
        { id: 'opt_raise', kind: 'option', label: 'Raise Pro to £59' },
      ],
      edges: [
        { from: 'pro_plan_price', to: 'mrr', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
        { from: 'pro_subscribers', to: 'mrr', strength: { mean: 0.7, std: 0.15 }, exists_probability: 0.95, effect_direction: 'positive' },
        { from: 'pro_plan_price', to: 'pro_subscribers', strength: { mean: -0.3, std: 0.1 }, exists_probability: 0.8, effect_direction: 'negative' },
      ],
      options: [
        { id: 'opt_keep', status: 'ready', is_baseline: true,
          interventions: { pro_plan_price: { value: 0.245, raw_value: 49, unit: 'GBP', target_match: { node_id: 'pro_plan_price' } } } },
        { id: 'opt_raise', status: 'ready',
          interventions: { pro_plan_price: { value: 0.295, raw_value: '59', unit: 'GBP', target_match: { node_id: 'pro_plan_price' } } } },
      ],
      goal_node_id: 'mrr',
      goal_constraints: [],
    };
    expect(JSON.stringify(graph).includes('nonlinear_identity'), 'premise: no carrier anywhere').toBe(false);
    expect(computeAnalysisAffectingGraphHash(graph as never)).toBe('680e4200b50c20dc');
    expect(computeAnalysisAffectingGraphHashSha256(graph as never)).toBe('680e4200b50c20dc7e79cc4c710ee1512c20811b53b96897720334aa659bf1d9');
    // A present-`undefined` carrier (the key survives in memory, never in JSON) is the same graph.
    const presentUndefined = { ...graph, nodes: graph.nodes.map((n) => ({ ...n, nonlinear_identity: undefined })) };
    expect(computeAnalysisAffectingGraphHash(presentUndefined as never)).toBe('680e4200b50c20dc');
  });
});

/**
 * ⛔ H1a′ — THE CARRIER SURVIVES EVERY CEE WRITER A SAVED MODEL PASSES THROUGH (verification of 8b4684ef, item 4).
 *
 * WHY: with H1a a lost carrier reads the run out of date — honest — but a RE-RUN on the carrier-less graph finds no
 * product and names a leader: the C46 withhold would lapse silently after an ordinary save. So every server writer a
 * saved model goes through must keep `nonlinear_identity` byte for byte. Each row runs the REAL writer on the REAL
 * constructed pricing graph, then the persisted-form projection (`projectGraphForPersistence`, which `commitDirectAnswer`
 * and the register route run on the way to `scenarios.graph`), and binds the carrier BY NODE ID to the exact
 * declaration construction wrote. Every writer must actually WRITE (`mutated` / `candidate`), so no row passes on a
 * refusal. The UI's own round trip (DecisionGuideAI `buildRegistrationGraph` spreads node `data`) is outside this repo.
 */
describe("H1a′: every CEE writer a saved model passes through keeps the C46 carrier", () => {
  const CARRIER = { operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'], stated_in_brief: false };
  const carriersOf = (g: unknown): Record<string, unknown> => Object.fromEntries(
    ((g as Graph | null)?.nodes ?? []).filter((n) => n.nonlinear_identity !== undefined).map((n) => [n.id as string, n.nonlinear_identity]),
  );
  const hashOf = (g: unknown): string => {
    const h = computeAnalysisAffectingGraphHash(g as never);
    if (h === null) throw new Error('the constructed graph must hash');
    return h;
  };
  const turn = { kind: 'system_event', scenario_id: SCENARIO, turn_id: '46464646-4646-4646-8646-464646464648', stage: 'analyse' };
  const payloadFor = (event: Record<string, unknown>) => ({ ...turn, event }) as never;

  /** Each writer as the dispatcher drives it: the persisted graph in, the graph it hands the commit out. */
  const WRITERS: ReadonlyArray<readonly [string, (g: Graph) => Promise<{ kind: string; graph: unknown }>]> = [
    ['register route ingress (kind normaliser + GraphStateIngressSchema)', async (g) => {
      const n = normaliseGraphNodeKindField(g);
      const parsed = n.ok ? GraphStateIngressSchema.safeParse(n.graph) : null;
      return parsed?.success === true ? { kind: 'mutated', graph: parsed.data } : { kind: 'refused', graph: null };
    }],
    ['turn-path parse (cee-v3 GraphV3)', async (g) => {
      const parsed = GraphV3.safeParse(g);
      return parsed.success ? { kind: 'mutated', graph: parsed.data } : { kind: 'refused', graph: null };
    }],
    ['patch applier update_node on the carrier\'s own node', async (g) => ({
      kind: 'mutated', graph: applyPatchOperations(GraphV3.parse(g), [{ op: 'update_node', path: 'mrr', value: { label: 'Monthly recurring revenue' } } as never]),
    })],
    ['factor_value_edit (set_factor_value) on a product factor', async (g) => {
      const event = { kind: 'factor_value_edit', target_id: 'pro_subscribers', value: 400, raw_value: 400, unit: 'subscribers', field: 'value' };
      const r = await applyFactorValueEdit({ payload: payloadFor(event), event: event as never, requestId: 'req-c46-w1', persistedGraph: g, priorFacts: [] } as never);
      return { kind: r.kind, graph: r.kind === 'mutated' ? r.mutatedGraph : null };
    }],
    ['structural_rename of the carrier\'s own node', async (g) => {
      const event = { kind: 'structural_rename', node_id: 'mrr', label: 'Monthly recurring revenue', expected_label: 'MRR', base_graph_hash: hashOf(g) };
      const r = applyStructuralRename({ payload: payloadFor(event), event: event as never, requestId: 'req-c46-w2', persistedGraph: g });
      return { kind: r.kind, graph: r.kind === 'mutated' ? r.mutatedGraph : null };
    }],
    ['structural_add of a factor', async (g) => {
      const event = { kind: 'structural_add', node_id: 'fac_seasonality', node_kind: 'factor', label: 'Seasonality', base_graph_hash: hashOf(g) };
      const r = applyStructuralAdd({ payload: payloadFor(event), event: event as never, requestId: 'req-c46-w3', persistedGraph: g });
      return { kind: r.kind, graph: r.kind === 'mutated' ? r.mutatedGraph : null };
    }],
    ['structural_add_edge', async (g) => {
      const event = { kind: 'structural_add_edge', from: 'monthly_churn', to: 'mrr', magnitude: 0.3, effect_direction: 'negative', base_graph_hash: hashOf(g) };
      const r = applyStructuralAddEdge({ payload: payloadFor(event), event: event as never, requestId: 'req-c46-w4', persistedGraph: g });
      return { kind: r.kind, graph: r.kind === 'mutated' ? r.mutatedGraph : null };
    }],
    ['structural_delete of a node outside the product', async (g) => {
      const event = { kind: 'structural_delete', removed_node_ids: ['monthly_churn'], removed_edges: [], base_graph_hash: hashOf(g) };
      const r = applyStructuralDelete({ payload: payloadFor(event), event: event as never, requestId: 'req-c46-w5', persistedGraph: g });
      return { kind: r.kind, graph: r.kind === 'mutated' ? r.mutatedGraph : null };
    }],
    ['edge_strength_edit on a link into the carrier\'s node', async (g) => {
      const e = g.edges.find((x) => x.from === 'pro_subscribers' && x.to === 'mrr')!;
      const event = { kind: 'edge_strength_edit', from: e.from, to: e.to, magnitude: 0.7, direction_intent: 'preserve',
        expected: { mean: (e.strength as { mean: number }).mean, effect_direction: e.effect_direction }, intent: 'set' };
      const r = await applyEdgeStrengthEdit({ payload: payloadFor(event), event: event as never, requestId: 'req-c46-w6', persistedGraph: g });
      return { kind: r.kind, graph: r.kind === 'mutated' ? r.mutatedGraph : null };
    }],
    ['goal_target_edit on the carrier\'s own node', async (g) => {
      const event = { kind: 'goal_target_edit', goal_node_id: 'mrr', constraint_type: 'at_least', raw_value: 25000, unit: '£', base_graph_hash: hashOf(g) };
      const r = await applyGoalTargetEdit({ payload: payloadFor(event), event: event as never, requestId: 'req-c46-w7', persistedGraph: g, priorFacts: [] });
      return { kind: r.kind, graph: r.kind === 'mutated' ? r.mutatedGraph : null };
    }],
    ['option_intervention_edit on a product factor', async (g) => {
      const persisted = projectGraphForPersistence(g);
      const r = applyOptionInterventionEdit({ persistedGraph: persisted, optionId: 'raise_pro_to_59', factorId: 'pro_plan_price', modelValue: 0.3,
        expectedGraphHash: hashOf(persisted), scenarioId: SCENARIO, turnId: 'turn-c46-w8', requestId: 'req-c46-w8', freshness: 'none', hasExistingAnalysis: false } as never);
      return { kind: r.kind, graph: r.kind === 'candidate' ? (r as { graph: unknown }).graph : null };
    }],
  ];

  it('PREMISE + CONTROL: construction wrote exactly one declaration, and the check sees a lost one', async () => {
    const graph = await build(PRODUCT);
    expect(carriersOf(projectGraphForPersistence(structuredClone(graph)))).toEqual({ mrr: CARRIER });
    const lost = structuredClone(graph);
    for (const n of lost.nodes) delete n.nonlinear_identity;
    expect(carriersOf(projectGraphForPersistence(lost)), 'the check is not vacuous: a graph without it reads empty').toEqual({});
  });

  it.each(WRITERS.map(([name, write]) => [name, write] as const))('%s: writes, and the persisted form keeps the carrier by id', async (_name, write) => {
    const graph = await build(PRODUCT);
    const out = await write(structuredClone(graph));
    expect(['mutated', 'candidate'], `the writer must WRITE here, not refuse (got ${out.kind})`).toContain(out.kind);
    expect(carriersOf(projectGraphForPersistence(structuredClone(out.graph)))).toEqual({ mrr: CARRIER });
  });
});
