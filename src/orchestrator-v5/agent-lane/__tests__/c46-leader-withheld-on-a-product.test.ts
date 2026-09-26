/**
 * ⛔ C46 STAGE 1 (a)–(d) — THE LEADER IS WITHHELD WHERE THE GOAL IS A PRODUCT THE ANALYSIS ONLY ADDS UP.
 *
 * Ruling (ChatGPT #70 5841314428): where a multiplicative identity can change the sign, withhold the
 * leader and name the missing capability in plain English. MEASURED (#70 5841215337): the served analyse
 * path is a linear SCM, so £49 → £59 gives −960 at any subscriber level while MRR = price × subscribers
 * gives −1,360 at 100 subscribers and +640 at 300. On Paul's brief, once the churn limit is scored, the
 * leader would be named "£59" at win 0.94 on exactly that model (Delivery Lead #70 5842538762).
 *
 * The seams, each driven through the REAL path — a strict-schema candidate → `buildModelFromBrief` (drafter
 * faked) → the `/graph/register` body → the production snapshot loader (`loadScenarioSnapshotForRunAnalysis`,
 * which runs `GraphV3.safeParse`) → `createRunAnalysisHandler` with PLoT faked — and bound by option id:
 *  (a) CARRIER — admission writes the checked declaration on the product's node; NodeV3 keeps it.
 *  (b) STAMP — `run_analysis` withholds the leader PLoT ranked first when its sign against a compared
 *      option is not proven, as a remove-only conjunct beside the intake one; the headline goes with it.
 *  (c) REASON — `composeLeaderClaim` names `nonlinear_identity_sign_unproven` only when the constraint
 *      verdict permitted and the run was requested (AI Quality option (i), #70 5842615260; 5841878117).
 *  (d) AGENT VIEW — `claim_permissions` carries the product cause and its sentence, beside any other reason.
 *
 * ⚠ (c) IS COMPOSED HERE WITH THE INPUTS THE SCENARIO READ ROUTE PASSES (H1, `c46-reload-reason-handoff.test.ts`),
 * via `nonlinearIdentityLeaderClaimCause`, judged on the graph the run analysed. The V5 finaliser takes the cause
 * from the caller that refused (H2, `c46-finaliser-cause-is-stated.test.ts`); that turn caller is handoff H2b.
 * This file proves the producer and the helper they call.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import { aiEditableFieldRoots } from '@talchain/schemas/orchestrator';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import {
  nonlinearIdentityLeaderClaimCause,
  nonlinearIdentityLeaderWithhold,
} from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { narrateWriteOutcome } from '../write-outcome.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { deriveDecisionContextGraphHash, loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import type { SessionStore } from '../../session/store.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import {
  WITHHELD_CONSTRAINT_VERDICT,
  WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN,
  WITHHELD_UNREQUESTED_ANALYSIS,
  composeAnalysisStateV1,
  readRawRobustnessFromResponseBody,
} from '../../compose/analysis-state-v1.js';
import { buildAnalysisResultBlock } from '../../compose.js';
import {
  leaderWithheldOnlyBecauseUnrequested,
  mayPresentLeaderClaimForFact,
  wasAnalysisRequestedByUser,
} from '../../compose/unrequested-analysis-confinement.js';
import { AUTO_RUN_POST_CONSTRUCTION_INITIATOR, RUN_PROVENANCE_ENRICHMENT_KEY } from '../../context/run-initiator.js';
import { buildLimitUncheckedCard, leaderWithheldForALimit } from '../../coaching/limit-unchecked-card.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { ALLOWED_NODE_FIELD_ROOTS } from '../../graph-management/field-safety.js';
import { transformNodeToV3 } from '../../../cee/transforms/schema-v3.js';

const SCENARIO = '46464646-4646-4646-8646-464646464646';
const REQUEST_ID = 'req-mg-c46-stage1';
const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 10%, should we increase ' +
  'the Pro plan price from £49 to £59 per month with the next AI feature release?';

const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Dir = 'positive' | 'negative';
type Identity = { outcome: string; operation: string; factors: string[]; provenance: string };
const link = (from: string, to: string, direction: Dir) => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
const goal = { metric: 'MRR', operator: '>=', target_stated: true, value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
  baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null };
const CHURN_LIMIT = { metric: 'Monthly churn', operator: '<=', value: 10, unit: '%', provenance: 'explicit' };
const MRR_IS_PRICE_TIMES_SUBSCRIBERS: Identity = { outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Pro subscribers'], provenance: 'inferred' };

/**
 * PAUL'S SHAPE: the MRR goal is Pro plan price times Pro subscribers; raising the price raises churn,
 * which lowers subscribers — so "Raise Pro to £59" pushes the product's two inputs in opposite directions.
 */
function paul(opts: { identities?: Identity[]; churnLimit?: boolean } = {}): Record<string, unknown> {
  return {
    goal,
    constraints: opts.churnLimit === true ? [CHURN_LIMIT] : [],
    options: [
      // The status quo states today's price, so the Run admits two different options (at today's level it is
      // never a lever — N-b).
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
    links: [
      link('Pro plan price', 'Monthly churn', 'positive'),
      link('Monthly churn', 'Pro subscribers', 'negative'),
      link('Pro plan price', 'MRR', 'positive'),
      link('Pro subscribers', 'MRR', 'positive'),
    ],
    identities: opts.identities ?? [MRR_IS_PRICE_TIMES_SUBSCRIBERS],
    unknowns: [],
  };
}

/** CONTROL: an ADDITIVE goal — MRR = Pro MRR + Non-Pro MRR, no product declared. */
function additive(): Record<string, unknown> {
  return {
    ...paul({ identities: [] }),
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
      { label: 'Non-Pro MRR', role: 'observable', baseline_known: false, baseline_value: 5000, unit: 'GBP', provenance: 'ai_proposed', plausible_max: 50000 },
    ],
    outcomes: [{ label: 'Pro MRR', provenance: 'inferred' }],
    links: [link('Pro plan price', 'Pro MRR', 'positive'), link('Pro MRR', 'MRR', 'positive'), link('Non-Pro MRR', 'MRR', 'positive')],
  };
}

/** Carrying on as now states today's levels (never a lever, N-b), so the Run admits the options. */
const CARRY_ON = { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, changes: [],
  interventions: [{ factor_label: 'AI add-on uptake', value: 0, value_kind: 'absolute', unit: '%', provenance: 'ai_proposed' }, { factor_label: 'Referral volume', value: 10, value_kind: 'absolute', unit: 'per month', provenance: 'ai_proposed' }] };
const ADD_ON = { label: 'Launch AI add-on', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [{ factor_label: 'AI add-on uptake', value: 100, value_kind: 'absolute', unit: '%', provenance: 'ai_proposed' }] };

/**
 * The detection's own shapes (`construction-product-identity.test.ts`): an add-on moves revenue per user AND
 * churn one way; a referral scheme moves subscribers alone. Each is stable against carrying on as now, but
 * the two cannot be ranked against each other (a pair). `oneLever` replaces the referral with a second push
 * on the SAME lever: nothing can swap places — the sign-stable control.
 */
function sameSign(options?: unknown[]): Record<string, unknown> {
  return {
    goal, constraints: [],
    options: options ?? [CARRY_ON, ADD_ON,
      { label: 'Referral scheme', provenance: 'ai_proposed', is_status_quo: null, changes: [], interventions: [{ factor_label: 'Referral volume', value: 20, value_kind: 'absolute', unit: 'per month', provenance: 'ai_proposed' }] },
    ],
    factors: [
      { label: 'AI add-on uptake', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Referral volume', role: 'controllable', baseline_known: false, baseline_value: 10, unit: 'per month', provenance: 'ai_proposed', plausible_max: 1000 },
      { label: 'Revenue per Pro user', role: 'observable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 5, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
    ],
    risks: [], outcomes: [{ label: 'Pro MRR', provenance: 'inferred' }],
    links: [
      link('AI add-on uptake', 'Revenue per Pro user', 'positive'),
      link('AI add-on uptake', 'Monthly churn', 'negative'),
      link('Monthly churn', 'Pro subscribers', 'negative'),
      link('Referral volume', 'Pro subscribers', 'positive'),
      link('Revenue per Pro user', 'Pro MRR', 'positive'),
      link('Pro subscribers', 'Pro MRR', 'positive'),
      link('Pro MRR', 'MRR', 'positive'),
    ],
    identities: [{ outcome: 'Pro MRR', operation: 'product', factors: ['Revenue per Pro user', 'Pro subscribers'], provenance: 'inferred' }],
    unknowns: [],
  };
}
const oneLever = () => sameSign([CARRY_ON, ADD_ON,
  { label: 'Add-on to half the base', provenance: 'ai_proposed', is_status_quo: null, changes: [], interventions: [{ factor_label: 'AI add-on uptake', value: 50, value_kind: 'absolute', unit: '%', provenance: 'ai_proposed' }] },
]);

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };

async function build(wire: Record<string, unknown>, { validate = true } = {}): Promise<{ registered: Graph; out: ToolResult }> {
  if (validate) expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
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
  return { registered: registered as Graph, out };
}

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'Run the analysis now.' }],
      session_id: SCENARIO, request_id: REQUEST_ID, budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ scenario_id: SCENARIO, message: 'Run the analysis now.', turn_class: 'decide', stage: 'analyse' }),
    requestId: REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  } as HandlerInvocation;
}

type Ranked = { id: string; label: string; win: number };

/** PLoT, faked: the ranking given, a clear separation, and (unless a limit is checked) no constraint analysis. */
function plotResponse(ranked: Ranked[], opts: { checkedConstraintIds?: string[] } = {}): V2RunResponseEnvelope {
  const env = structuredClone(happyFixture) as unknown as Record<string, unknown>;
  env.results = ranked.map((r) => ({ option_id: r.id, option_label: r.label, win_probability: r.win, percentile_p10: 0.1, percentile_p90: 0.9 }));
  env.robustness = { level: 'high', fragile_edges: [], near_tie: { is_tie: false } };
  env.fact_objects = [];
  env.review_cards = [];
  if (opts.checkedConstraintIds === undefined) delete env.constraint_analysis;
  else env.constraint_analysis = { joint_probability: 0.95, per_constraint: opts.checkedConstraintIds.map((constraint_id) => ({ constraint_id, satisfied_probability: 0.95 })) };
  return env as unknown as V2RunResponseEnvelope;
}

/** Register body → production loader → the handler, PLoT faked. The persisted fact, as the handler wrote it. */
async function runOn(registered: Graph, ranked: Ranked[], opts: { checkedConstraintIds?: string[] } = {}): Promise<RunAnalysisHandlerFact> {
  // The register route's ingress and persistence are passthrough (`goal-direction-reaches-plot.test.ts`), so the
  // stored bytes are the register body.
  const store = {
    loadGraph: async () => registered,
    loadGraphAndBriefText: async () => ({ graph: registered, briefText: null }),
  } as unknown as SessionStore;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, REQUEST_ID, store);
  const run = vi.fn(() => Promise.resolve(plotResponse(ranked, opts)));
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const outcome = await createRunAnalysisHandler({ plotClient, scenarioReader: async () => snapshot })(makeInvocation());
  expect(run).toHaveBeenCalledOnce();
  return outcome.handler_facts[0] as RunAnalysisHandlerFact;
}

const CANONICAL_FRESH = {
  status: 'ready', freshness: 'fresh', freshness_reason: 'hash_match', selected_fact_index: 0, computed_at: '2026-09-26T04:00:00.000Z',
  graph_hash_at_run: 'h1', current_graph_hash: 'h1', blockers: [], model_adjustments: [], goal_node_id: 'mrr', degraded_fact_status: null,
  contradictions: [], usableForProse: true, usableForChips: true, usableForFollowupContext: true, requiresRerun: false, blockedUnusable: false,
} as never;

/**
 * The turn's `analysis_state`, composed as the scenario read route composes it — the SAME readers for the
 * permission and the unrequested cause — plus the C46 cause from `nonlinearIdentityLeaderClaimCause`
 * (the HANDOFF line each production caller adds).
 */
function stateFor(fact: RunAnalysisHandlerFact, graph: unknown) {
  const block = buildAnalysisResultBlock(fact);
  const cause = nonlinearIdentityLeaderClaimCause({ graph, graphHash: deriveDecisionContextGraphHash(graph), result: fact.result, requested: wasAnalysisRequestedByUser(fact) });
  const state = composeAnalysisStateV1({
    canonical: CANONICAL_FRESH,
    mayNameLeadingOption: mayPresentLeaderClaimForFact(fact),
    withheldBecauseUnrequested: leaderWithheldOnlyBecauseUnrequested(fact) || cause.withheldBecauseUnrequested,
    withheldBecauseNonlinearIdentity: cause.withheldBecauseNonlinearIdentity,
    rawRobustness: readRawRobustnessFromResponseBody({ blocks: [block] }),
  })!;
  return { state, block };
}

const RAISE: Ranked = { id: 'raise_pro_to_59', label: 'Raise Pro to £59', win: 0.94 };
const KEEP: Ranked = { id: 'keep_pro_at_49', label: 'Keep Pro at £49', win: 0.06 };

/** The sentence the Agent is given, and the question the build asks — exact, by identity. */
const PAUL_SENTENCE =
  'No option can be put forward on "MRR" yet: Olumi reads "MRR" as depending on "Pro plan price" times "Pro subscribers", ' +
  'and this model adds those effects up rather than multiplying them, so it cannot say which option does better.';
const PAUL_QUESTION =
  'Which option does better on "MRR"? This model cannot answer that yet: Olumi reads "MRR" as depending on "Pro plan price" ' +
  'times "Pro subscribers", and the model adds those effects up rather than multiplying them.';

const nodeById = (g: Graph, id: string) => g.nodes.find((n) => n.id === id);

// ── (a) THE CARRIER ─────────────────────────────────────────────────────────────────────────────────
describe('(a) the checked declaration is carried on the product node, from registration to the Run', () => {
  it('RED: registered on the goal node by id, kept by GraphV3.parse and by the production snapshot loader', async () => {
    const { registered } = await build(paul());
    const carrier = { operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'], stated_in_brief: false };
    expect(nodeById(registered, 'mrr')).toMatchObject({ kind: 'goal', nonlinear_identity: carrier });
    // Only the product's node carries it.
    expect(registered.nodes.filter((n) => 'nonlinear_identity' in n).map((n) => n.id)).toEqual(['mrr']);
    const parsed = GraphV3.parse(registered) as unknown as Graph;
    expect(nodeById(parsed, 'mrr')?.nonlinear_identity).toEqual(carrier);
    const store = { loadGraphAndBriefText: async () => ({ graph: registered, briefText: null }) } as unknown as SessionStore;
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, REQUEST_ID, store);
    expect(nodeById(snapshot.graph as unknown as Graph, 'mrr')?.nonlinear_identity).toEqual(carrier);
  });

  it('CONTROL: a linear brief registers byte-identical to one that declares nothing — no carrier anywhere', async () => {
    const declaredNone = await build(paul({ identities: [] }));
    const legacy = paul({ identities: [] });
    // A candidate from before the field (no `identities` key) — what staging builds today.
    delete legacy.identities;
    const before = await build(legacy, { validate: false });
    expect(JSON.stringify(declaredNone.registered)).toBe(JSON.stringify(before.registered));
    expect(JSON.stringify(declaredNone.registered)).not.toContain('nonlinear_identity');
    expect(JSON.stringify((await build(additive())).registered)).not.toContain('nonlinear_identity');
  });

  it('a malformed carrier is dropped and the stored graph still parses (never a new refusal)', () => {
    for (const bad of [{ operation: 'sum', factor_ids: ['a', 'b'], stated_in_brief: true }, { operation: 'product', factor_ids: ['a'], stated_in_brief: true },
      { operation: 'product', factor_ids: ['a', 'b'] }, 'product', null]) {
      const parsed = GraphV3.safeParse({ nodes: [{ id: 'mrr', kind: 'goal', label: 'MRR', nonlinear_identity: bad }], edges: [] });
      expect(parsed.success, JSON.stringify(bad)).toBe(true);
      const node = parsed.success ? (parsed.data.nodes[0] as Record<string, unknown>) : {};
      expect(node.nonlinear_identity, JSON.stringify(bad)).toBeUndefined();
      // Persisted as JSON, the dropped value leaves no key behind.
      expect(JSON.parse(JSON.stringify(node)), JSON.stringify(bad)).not.toHaveProperty('nonlinear_identity');
      expect(node.label).toBe('MRR');
      expect(nonlinearIdentityLeaderWithhold({ nodes: [node], edges: [] }, 'x')).toBeNull();
    }
  });

  it('is not AI-editable: absent from the update roots, and the draft transform does not copy it', () => {
    expect(ALLOWED_NODE_FIELD_ROOTS.has('nonlinear_identity')).toBe(false);
    expect(aiEditableFieldRoots('node').has('nonlinear_identity')).toBe(false);
    expect(ALLOWED_NODE_FIELD_ROOTS.has('label')).toBe(true);
    const drafted = transformNodeToV3({
      id: 'mrr', kind: 'goal', label: 'MRR',
      nonlinear_identity: { operation: 'product', factor_ids: ['a', 'b'], stated_in_brief: true },
    } as never) as Record<string, unknown>;
    expect(drafted).not.toHaveProperty('nonlinear_identity');
    expect(drafted.kind).toBe('goal');
  });
});

// ── (b) THE STAMP, END TO END ──────────────────────────────────────────────────────────────────────
describe('(b)+(c) run_analysis withholds the leader PLoT ranks first when its sign is not proven', () => {
  it('RED: Paul\'s shape, £59 ranked first at 0.94 → no leader may be named, with the C46 reason, by option id', async () => {
    const { registered } = await build(paul());
    const fact = await runOn(registered, [RAISE, KEEP]);
    // PLoT's leader is recorded as PLoT ranked it …
    expect(fact.result.leading_option_id).toBe('raise_pro_to_59');
    // … and the persisted permission withholds it; the constraint state is untouched (no limit set).
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: false, constraint_verdict_state: 'not_applicable' });
    // The same response does not name it either (the headline goes with the stamp).
    expect(fact.result.summary).not.toMatch(/Raise Pro to £59/);
    const { state, block } = stateFor(fact, registered);
    expect(state.leader_claim).toEqual({ permitted: false, withheld_reason: WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN, separation: 'separated' });
    expect(block.leading_option_id).toBeNull();
    // The finding names the leader by id, and whom it is not proven against.
    expect(nonlinearIdentityLeaderWithhold(registered, 'raise_pro_to_59')).toMatchObject({
      leader_id: 'raise_pro_to_59', outcome_id: 'mrr', goal_id: 'mrr', factor_ids: ['pro_plan_price', 'pro_subscribers'], against: ['keep_pro_at_49'],
      sentence: PAUL_SENTENCE,
    });
  });

  it('CONTROL (harness): the ADDITIVE goal — MRR = Pro MRR + Non-Pro MRR — names its leader, as today', async () => {
    const { registered } = await build(additive());
    const fact = await runOn(registered, [{ id: 'raise_pro_to_59', label: 'Raise Pro to £59', win: 0.94 }, KEEP]);
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: true, constraint_verdict_state: 'not_applicable' });
    // The discriminating half: on this path the headline DOES name the leader, so its absence above is the stamp's.
    expect(fact.result.summary).toMatch(/Raise Pro to £59/);
    expect(stateFor(fact, registered).state.leader_claim).toEqual({ permitted: true, separation: 'separated' });
  });

  it('CONTROL: a product every option moves the same way (the detection\'s sign-stable control) names its leader', async () => {
    const { registered } = await build(oneLever());
    expect(nodeById(registered, 'pro_mrr')).toHaveProperty('nonlinear_identity');
    const fact = await runOn(registered, [
      { id: 'add_on_to_half_the_base', label: 'Add-on to half the base', win: 0.7 },
      { id: 'launch_ai_add_on', label: 'Launch AI add-on', win: 0.2 },
      { id: 'carry_on_as_now', label: 'Carry on as now', win: 0.1 },
    ]);
    expect(fact.result.constraint_verdict?.may_name_leading_option).toBe(true);
    expect(stateFor(fact, registered).state.leader_claim.permitted).toBe(true);
  });

  it('CONTROL: a graph persisted before the carrier (no `nonlinear_identity`) behaves exactly as before', async () => {
    const { registered } = await build(paul());
    const old = structuredClone(registered);
    for (const n of old.nodes) delete n.nonlinear_identity;
    const fact = await runOn(old, [RAISE, KEEP]);
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: true, constraint_verdict_state: 'not_applicable' });
    expect(fact.result.summary).toMatch(/Raise Pro to £59/);
    expect(stateFor(fact, old).state.leader_claim).toEqual({ permitted: true, separation: 'separated' });
  });

  it('RED (leader by id): on the add-on vs referral pair, the add-on leading is withheld, carrying on as now leading is not', async () => {
    const { registered } = await build(sameSign());
    const all = [
      { id: 'launch_ai_add_on', label: 'Launch AI add-on', win: 0.5 },
      { id: 'referral_scheme', label: 'Referral scheme', win: 0.3 },
      { id: 'carry_on_as_now', label: 'Carry on as now', win: 0.2 },
    ];
    const addOnLeads = await runOn(registered, all);
    expect(addOnLeads.result.leading_option_id).toBe('launch_ai_add_on');
    expect(addOnLeads.result.constraint_verdict?.may_name_leading_option).toBe(false);
    expect(stateFor(addOnLeads, registered).state.leader_claim.withheld_reason).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
    expect(nonlinearIdentityLeaderWithhold(registered, 'launch_ai_add_on')?.against).toEqual(['referral_scheme']);

    // Carrying on as now is provable against each option on its own: its leader is named.
    const statusQuoLeads = await runOn(registered, [all[2]!, all[0]!, all[1]!].map((r, i) => ({ ...r, win: [0.5, 0.3, 0.2][i]! })));
    expect(statusQuoLeads.result.leading_option_id).toBe('carry_on_as_now');
    expect(statusQuoLeads.result.constraint_verdict?.may_name_leading_option).toBe(true);
    expect(stateFor(statusQuoLeads, registered).state.leader_claim.permitted).toBe(true);
  });

  it('CONTROL (compared set): the pair\'s other option was not in this run — the add-on leading is named', async () => {
    const { registered } = await build(sameSign());
    const fact = await runOn(registered, [
      { id: 'launch_ai_add_on', label: 'Launch AI add-on', win: 0.7 },
      { id: 'carry_on_as_now', label: 'Carry on as now', win: 0.3 },
    ]);
    expect(fact.result.leading_option_id).toBe('launch_ai_add_on');
    expect(fact.result.constraint_verdict?.may_name_leading_option).toBe(true);
  });
});

// ── (b) RULE 7: A ROUTE AROUND THE PRODUCT OPPOSING THE ROUTE THROUGH IT ─────────────────────────────
/**
 * Verification of 1047641f, findings 3 and 4 (`construction-product-identity.test.ts` rule 7), END TO END: the
 * Run named "Offer annual discount" (+ through Pro subscribers, − straight into MRR) at 0.7, three-way AND against
 * carrying on as now alone; and "Raise Pro to £59" (+ through Pro MRR, − through refunds) against keeping £49.
 */
describe('(b) rule 7 on the Run: a leader whose routes through and around the product disagree is withheld', () => {
  const SQ_TODAY = (levels: [string, number, string][]) => ({ label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, changes: [],
    interventions: levels.map(([factor_label, value, unit]) => ({ factor_label, value, value_kind: 'absolute', unit, provenance: 'ai_proposed' })) });
  const at = (label: string, factor_label: string, value: number, unit: string) => ({ label, provenance: 'ai_proposed', is_status_quo: null, changes: [],
    interventions: [{ factor_label, value, value_kind: 'absolute', unit, provenance: 'ai_proposed' }] });
  function discount(direct: Dir, withReferral: boolean): Record<string, unknown> {
    return {
      goal, constraints: [],
      options: [
        SQ_TODAY([['Annual discount', 0, '%'], ...(withReferral ? [['Referral volume', 10, 'per month'] as [string, number, string]] : [])]),
        at('Offer annual discount', 'Annual discount', 15, '%'),
        ...(withReferral ? [at('Referral scheme', 'Referral volume', 20, 'per month')] : []),
      ],
      factors: [
        { label: 'Annual discount', role: 'controllable', baseline_known: false, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 50 },
        ...(withReferral ? [{ label: 'Referral volume', role: 'controllable', baseline_known: false, baseline_value: 10, unit: 'per month', provenance: 'ai_proposed', plausible_max: 1000 }] : []),
        { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
        { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
      ],
      risks: [], outcomes: [],
      links: [
        link('Annual discount', 'Pro subscribers', 'positive'), link('Annual discount', 'MRR', direct),
        ...(withReferral ? [link('Referral volume', 'Pro subscribers', 'positive')] : []),
        link('Pro plan price', 'MRR', 'positive'), link('Pro subscribers', 'MRR', 'positive'),
      ],
      identities: [MRR_IS_PRICE_TIMES_SUBSCRIBERS],
      unknowns: [],
    };
  }
  function refunds(direction: Dir): Record<string, unknown> {
    return {
      ...paul({ identities: [{ outcome: 'Pro MRR', operation: 'product', factors: ['Pro plan price', 'Pro subscribers'], provenance: 'inferred' }] }),
      factors: [
        { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
        { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
        { label: 'Refunds', role: 'observable', baseline_known: false, baseline_value: 200, unit: 'GBP', provenance: 'ai_proposed', plausible_max: 5000 },
      ],
      outcomes: [{ label: 'Pro MRR', provenance: 'inferred' }],
      links: [
        link('Pro plan price', 'Pro MRR', 'positive'), link('Pro subscribers', 'Pro MRR', 'positive'), link('Pro MRR', 'MRR', 'positive'),
        link('Pro plan price', 'Refunds', 'positive'), link('Refunds', 'MRR', direction),
      ],
    };
  }
  const DISCOUNT: Ranked = { id: 'offer_annual_discount', label: 'Offer annual discount', win: 0.7 };
  const SQ: Ranked = { id: 'carry_on_as_now', label: 'Carry on as now', win: 0.3 };
  const REFERRAL: Ranked = { id: 'referral_scheme', label: 'Referral scheme', win: 0.2 };

  it('RED (P3): the discount leading against carrying on as now ALONE is withheld, against that option by id', async () => {
    const { registered } = await build(discount('negative', false));
    const fact = await runOn(registered, [DISCOUNT, SQ]);
    expect(fact.result.leading_option_id).toBe('offer_annual_discount');
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: false, constraint_verdict_state: 'not_applicable' });
    expect(fact.result.summary).not.toMatch(/Offer annual discount/);
    expect(nonlinearIdentityLeaderWithhold(registered, 'offer_annual_discount')?.against).toEqual(['carry_on_as_now']);
    expect(stateFor(fact, registered).state.leader_claim.withheld_reason).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
  });

  it('RED (P3, three-way): the discount leading is withheld, and so is the referral scheme leading — they are paired', async () => {
    const { registered } = await build(discount('negative', true));
    const discountLeads = await runOn(registered, [DISCOUNT, SQ, REFERRAL]);
    expect(discountLeads.result.constraint_verdict?.may_name_leading_option).toBe(false);
    const referralLeads = await runOn(registered, [{ ...REFERRAL, win: 0.7 }, SQ, { ...DISCOUNT, win: 0.2 }]);
    expect(referralLeads.result.leading_option_id).toBe('referral_scheme');
    expect(referralLeads.result.constraint_verdict?.may_name_leading_option).toBe(false);
    expect(nonlinearIdentityLeaderWithhold(registered, 'referral_scheme')?.against).toEqual(['offer_annual_discount']);
  });

  it('CONTROL (P3): the discount reaching MRR the SAME way on both routes keeps its leader against carrying on as now', async () => {
    const { registered } = await build(discount('positive', false));
    expect(nodeById(registered, 'mrr')).toHaveProperty('nonlinear_identity');
    const fact = await runOn(registered, [DISCOUNT, SQ]);
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: true, constraint_verdict_state: 'not_applicable' });
    expect(fact.result.summary).toMatch(/Offer annual discount/);
  });

  it('RED (P4): £59 lifting Pro MRR and, through refunds, lowering MRR is withheld against keeping £49', async () => {
    const { registered } = await build(refunds('negative'));
    const fact = await runOn(registered, [RAISE, KEEP]);
    expect(fact.result.leading_option_id).toBe('raise_pro_to_59');
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: false, constraint_verdict_state: 'not_applicable' });
    expect(nonlinearIdentityLeaderWithhold(registered, 'raise_pro_to_59')?.against).toEqual(['keep_pro_at_49']);
  });

  it('CONTROL (P4): refunds that RAISE MRR — both routes one way — keep £59 named', async () => {
    const { registered } = await build(refunds('positive'));
    const fact = await runOn(registered, [RAISE, KEEP]);
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: true, constraint_verdict_state: 'not_applicable' });
    expect(fact.result.summary).toMatch(/Raise Pro to £59/);
  });
});

// ── (c) PRECEDENCE ─────────────────────────────────────────────────────────────────────────────────
describe('(c) precedence: the limit keeps its code and card; the unrequested first pass keeps its code', () => {
  it('REQUIRED RED ROW: churn unchecked + product identity → BOTH the limit card AND the C46 reason reach the user', async () => {
    const { registered, out } = await build(paul({ churnLimit: true }));
    expect((registered as unknown as { goal_constraints?: unknown[] }).goal_constraints?.length).toBe(1);
    const fact = await runOn(registered, [RAISE, KEEP]);
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: false, constraint_verdict_state: 'unevaluated' });
    const { state, block } = stateFor(fact, registered);

    // 1. The LIMIT: `constraint_verdict_withheld` keeps the field, so the limit card fires and is built.
    expect(state.leader_claim).toEqual({ permitted: false, withheld_reason: WITHHELD_CONSTRAINT_VERDICT, separation: 'separated' });
    expect(leaderWithheldForALimit(state)).toBe(true);
    const card = buildLimitUncheckedCard({
      analysisResult: { ...block, computed_against_hash: 'h1' }, graphHash: 'h1', computedAt: '2026-09-26T04:00:00.000Z',
      trigger: 'explicit_run', freshness: 'fresh',
    }, 'Monthly churn');
    expect(card.reason).toBeNull();
    expect(card.block?.title).toBe('Check your limit before relying on this');

    // 2. The PRODUCT, in its own channels. (i) The build's reply line — appended by the server every time.
    const status = narrateWriteOutcome('', [{ name: 'build_model_from_brief' }], [out]).status ?? '';
    expect(out.open_questions).toContain(PAUL_QUESTION);
    expect(status).toContain(PAUL_QUESTION);
    // (ii) The Agent's view of THIS run: the product cause beside the limit's code, never replacing it.
    const permissions = await agentRunPermissions(registered, state, block);
    expect(permissions.withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
    expect(permissions.leader_may_be_named).toBe(false);
    expect(permissions.nonlinear_identity).toMatchObject({ reason: WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN, say: PAUL_SENTENCE });
  });

  it('RED: an unrequested first pass keeps `unrequested_analysis_withheld` — never the limits code on a brief with no limit', async () => {
    const { registered } = await build(paul());
    const fact = await runOn(registered, [RAISE, KEEP]);
    // The dispatcher's auto-run stamp, as the first pass carries it.
    (fact.result.enrichment as Record<string, unknown>)[RUN_PROVENANCE_ENRICHMENT_KEY] = { initiated_by: AUTO_RUN_POST_CONSTRUCTION_INITIATOR };
    expect(wasAnalysisRequestedByUser(fact)).toBe(false);
    expect(stateFor(fact, registered).state.leader_claim.withheld_reason).toBe(WITHHELD_UNREQUESTED_ANALYSIS);
  });

  it('the cause is read from the persisted pair: only a constraint state that PERMITS a leader leaves the field to the product', async () => {
    const { registered } = await build(paul());
    const fact = await runOn(registered, [RAISE, KEEP]);
    const withState = (may: boolean, state: string) =>
      nonlinearIdentityLeaderClaimCause({ graph: registered, graphHash: deriveDecisionContextGraphHash(registered), result: { ...fact.result, constraint_verdict: { may_name_leading_option: may, constraint_verdict_state: state } }, requested: true });
    const PRODUCT = { withheldBecauseUnrequested: false, withheldBecauseNonlinearIdentity: true };
    const NONE = { withheldBecauseUnrequested: false, withheldBecauseNonlinearIdentity: false };
    // A checked-and-met limit, or none set: the constraint verdict permitted, so the product is the reason.
    expect(withState(false, 'evaluated_feasible')).toEqual(PRODUCT);
    expect(withState(false, 'not_applicable')).toEqual(PRODUCT);
    // A limit that withholds keeps its own code (option (i)); so does anything this reader does not know.
    for (const state of ['unevaluated', 'evaluated_infeasible', 'identity_unresolved', 'constructor', 'no_such_state']) {
      expect(withState(false, state), state).toEqual(NONE);
    }
    // A permitted leader has no withheld cause at all.
    expect(withState(true, 'evaluated_feasible')).toEqual(NONE);
    // The same fact on a graph with no carrier: no cause. Since H1a (Canonical State) the carrier IS an
    // analysis-affecting field, so this graph no longer hashes as the run's own and the hash refuses it. The missing
    // carrier refuses it on its own as well: handed the run's own hash, the cause is still none.
    const old = structuredClone(registered);
    for (const n of old.nodes) delete n.nonlinear_identity;
    const atRun = fact.result.graph_hash_at_run;
    expect(atRun).toMatch(/^[0-9a-f]{16}$/);
    expect(deriveDecisionContextGraphHash(old), 'H1a: a graph that lost its carrier is not the analysed graph').not.toBe(atRun);
    expect(nonlinearIdentityLeaderClaimCause({ graph: old, graphHash: deriveDecisionContextGraphHash(old), result: fact.result, requested: true })).toEqual(NONE);
    expect(nonlinearIdentityLeaderClaimCause({ graph: old, graphHash: atRun ?? null, result: fact.result, requested: true })).toEqual(NONE);
  });

  /**
   * ⛔ THE GRAPH THE RUN ANALYSED DECIDES (OpenAI Runtime #70 5843934816, the H2 review point).
   *
   * A persisted fact binds the graph it analysed by `graph_hash_at_run` ALONE: `RunAnalysisResultSchema`
   * (@talchain/schemas 0.59.0) keeps no graph, and PLoT's envelope echoes none. So a caller's graph decides the
   * cause only when its own freshness hash equals the run's; after any analysis-affecting edit the analysed graph
   * is out of reach and nothing new is withheld. Runtime's row: a run on the product graph (MRR = price ×
   * subscribers), then an edit that removes the product.
   */
  describe('the graph the run analysed decides the cause — never a graph edited since the run', () => {
    const PRODUCT = { withheldBecauseUnrequested: false, withheldBecauseNonlinearIdentity: true };
    const NONE = { withheldBecauseUnrequested: false, withheldBecauseNonlinearIdentity: false };
    const cause = (graph: Graph, result: RunAnalysisHandlerFact['result']) =>
      nonlinearIdentityLeaderClaimCause({ graph, graphHash: deriveDecisionContextGraphHash(graph), result, requested: true });
    /** The user deletes "Pro subscribers": its node, every link touching it, and the product it made MRR. */
    const withoutTheProduct = (g: Graph): Graph => {
      const out = structuredClone(g);
      out.nodes = out.nodes.filter((n) => n.id !== 'pro_subscribers');
      out.edges = out.edges.filter((e) => e.from !== 'pro_subscribers' && e.to !== 'pro_subscribers');
      for (const n of out.nodes) delete n.nonlinear_identity;
      return out;
    };
    /**
     * An edit that KEEPS the product: Pro subscribers' starting level, 300 → 400 of a plausible 2,000 (stored
     * normalised, 0.15 → 0.2) — an analysis-affecting field.
     */
    const subscribersAt400 = (g: Graph): Graph => {
      const out = structuredClone(g);
      const n = out.nodes.find((x) => x.id === 'pro_subscribers')!;
      const os = n.observed_state as { value?: unknown };
      expect(os.value, 'premise: the stored starting level, 300 of 2,000').toBe(0.15);
      n.observed_state = { ...os, value: 0.2 };
      return out;
    };

    it('PREMISE: the run bound the graph it analysed by the SAME hash the read route derives from that graph', async () => {
      const { registered } = await build(paul());
      const fact = await runOn(registered, [RAISE, KEEP]);
      expect(fact.result.graph_hash_at_run).toMatch(/^[0-9a-f]{16}$/);
      expect(deriveDecisionContextGraphHash(registered)).toBe(fact.result.graph_hash_at_run);
      expect(cause(registered, fact.result), 'the analysed graph decides: the product').toEqual(PRODUCT);
    });

    it('RED (Runtime\'s row): run on the product graph, then an edit REMOVES the product — the edited graph never decides; no cause', async () => {
      const { registered } = await build(paul());
      const fact = await runOn(registered, [RAISE, KEEP]);
      const edited = withoutTheProduct(registered);
      expect(deriveDecisionContextGraphHash(edited), 'premise: the edit changed what the analysis reads').not.toBe(fact.result.graph_hash_at_run);
      expect(cause(edited, fact.result)).toEqual(NONE);
    });

    it('RED (discriminating): an edit that KEEPS the product is still a graph the run never analysed — no cause, although its own sign test would find one', async () => {
      const { registered } = await build(paul());
      const fact = await runOn(registered, [RAISE, KEEP]);
      const edited = subscribersAt400(registered);
      expect(deriveDecisionContextGraphHash(edited), 'premise: the edit changed what the analysis reads').not.toBe(fact.result.graph_hash_at_run);
      // What judging THIS graph would say — the rule Runtime rejected: the product, by the leader's id.
      expect(nonlinearIdentityLeaderWithhold(edited, 'raise_pro_to_59', { comparedOptionIds: ['raise_pro_to_59', 'keep_pro_at_49'] })).not.toBeNull();
      expect(cause(edited, fact.result)).toEqual(NONE);
    });

    it('RED: a fact that bound no graph (legacy, no `graph_hash_at_run`) or a graph the caller could not hash decides nothing', async () => {
      const { registered } = await build(paul());
      const fact = await runOn(registered, [RAISE, KEEP]);
      const { graph_hash_at_run: _dropped, ...legacy } = fact.result;
      expect(nonlinearIdentityLeaderClaimCause({ graph: registered, graphHash: deriveDecisionContextGraphHash(registered), result: legacy, requested: true })).toEqual(NONE);
      expect(nonlinearIdentityLeaderClaimCause({ graph: registered, graphHash: null, result: fact.result, requested: true })).toEqual(NONE);
    });

    it('CONTROL: an edit the analysis does not read (the goal\'s label) leaves the analysed graph in reach — the product stands', async () => {
      const { registered } = await build(paul());
      const fact = await runOn(registered, [RAISE, KEEP]);
      const relabelled = structuredClone(registered);
      relabelled.nodes.find((n) => n.id === 'mrr')!.label = 'Monthly recurring revenue';
      expect(deriveDecisionContextGraphHash(relabelled)).toBe(fact.result.graph_hash_at_run);
      expect(cause(relabelled, fact.result)).toEqual(PRODUCT);
    });
  });

  it('the composer\'s own order: the unrequested first pass (policy) outranks the product; a permitted verdict takes no cause', async () => {
    const { registered } = await build(additive());
    const fact = await runOn(registered, [RAISE, KEEP]);
    const raw = readRawRobustnessFromResponseBody({ blocks: [buildAnalysisResultBlock(fact)] });
    const claim = (may: boolean, unrequested: boolean, product: boolean) => composeAnalysisStateV1({
      canonical: CANONICAL_FRESH, mayNameLeadingOption: may, withheldBecauseUnrequested: unrequested,
      withheldBecauseNonlinearIdentity: product, rawRobustness: raw,
    })!.leader_claim;
    expect(claim(false, true, true).withheld_reason).toBe(WITHHELD_UNREQUESTED_ANALYSIS);
    expect(claim(false, false, true).withheld_reason).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
    expect(claim(false, false, false).withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
    // A cause is never a grant, and never a reason on a permitted claim.
    expect(claim(true, false, true)).toEqual({ permitted: true, separation: 'separated' });
  });
});

// ── (d) THE AGENT'S VIEW ───────────────────────────────────────────────────────────────────────────
/** The Agent's `run_analysis` tool, with the turn and the graph read faked from the given state. */
async function agentRunPermissions(graph: Graph, state: unknown, block: unknown): Promise<Record<string, unknown>> {
  const dispatch: InternalDispatch = async (path) => {
    if (path === '/orchestrate/v2/turn') {
      return { status: 200, json: { analysis_state: state, analysis_ready: { status: 'ready' }, blocks: [block], assistant_text: '' } };
    }
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h1' } };
    return { status: 404, json: {} };
  };
  const caps = createAgentCapabilities(dispatch, new ProposalStore());
  const r = await caps.runAnalysis({ scenario_id: SCENARIO, authenticated_user_id: 'u', request_id: 'r' }, { reason: 'Run it' } as never);
  return r.claim_permissions as Record<string, unknown>;
}

describe('(d) the Agent\'s view carries the product cause, remove-only', () => {
  it('RED: the C46 code on the wire reaches the Agent with its sentence — never dropped as an unknown code', async () => {
    const { registered } = await build(paul());
    const fact = await runOn(registered, [RAISE, KEEP]);
    const { state, block } = stateFor(fact, registered);
    const permissions = await agentRunPermissions(registered, state, block);
    expect(permissions.withheld_reason).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
    expect(permissions.nonlinear_identity).toMatchObject({ reason: WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN, say: PAUL_SENTENCE });
    expect(permissions.leader_may_be_named).toBe(false);
  });

  it('CONTROL: a finding about SOME OTHER pair is not said as this leader\'s reason (the limit withheld it)', async () => {
    const { registered } = await build(sameSign());
    const state = { leader_claim: { permitted: false, withheld_reason: WITHHELD_CONSTRAINT_VERDICT } };
    const permissions = await agentRunPermissions(registered, state, { type: 'analysis_result', leading_option_id: null });
    expect(permissions).not.toHaveProperty('nonlinear_identity');
    expect(permissions.withheld_reason).toBe(WITHHELD_CONSTRAINT_VERDICT);
  });

  it('CONTROL: a linear model — the Agent\'s permissions are exactly what the wire gave', async () => {
    const { registered } = await build(additive());
    const state = { leader_claim: { permitted: false, withheld_reason: WITHHELD_CONSTRAINT_VERDICT } };
    const permissions = await agentRunPermissions(registered, state, { type: 'analysis_result', leading_option_id: null });
    expect(permissions).toEqual({ leader_may_be_named: false, withheld_reason: WITHHELD_CONSTRAINT_VERDICT, permitted_analysis_mode: null });
  });

  it('RED: the first pass the build runs carries the product cause beside `unrequested_analysis_withheld`', async () => {
    const wire = paul();
    let registered: unknown = null;
    const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
    const readback = { leader_claim: { permitted: false, withheld_reason: WITHHELD_UNREQUESTED_ANALYSIS } };
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph/register')) {
        registered = structuredClone((body as { graph: unknown }).graph);
        return { status: 200, json: { model_version: { version_number: 1 } } };
      }
      if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
      if (path.endsWith('/graph')) {
        return { status: 200, json: { graph: registered ?? { nodes: [], edges: [] }, graph_hash: 'h1', analysis_state: registered === null ? undefined : readback } };
      }
      return { status: 404, json: {} };
    };
    const caps = createAgentCapabilities(dispatch, new ProposalStore(), call, 'full', undefined, {
      firstAnalysis: async () => ({ ran: true, runTurnId: 't1', blocks: [] }),
    });
    const r = await caps.buildModelFromBrief({ scenario_id: SCENARIO, authenticated_user_id: 'u', request_id: 'r' }, { brief: BRIEF } as never);
    const permissions = (r.first_analysis as { claim_permissions: Record<string, unknown> }).claim_permissions;
    expect(permissions.withheld_reason).toBe(WITHHELD_UNREQUESTED_ANALYSIS);
    expect(permissions.nonlinear_identity).toMatchObject({ reason: WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN, say: PAUL_SENTENCE });
  });
});
