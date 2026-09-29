/**
 * ⭐ C46 × R3-4 — A PRODUCT THE ENGINE EVALUATED ON THIS RUN IS NOT WITHHELD BY THE STRUCTURAL SIGN TEST.
 *
 * Measured on Journey A's final Run: all six options computed, then "No option can be put forward: the model
 * represents MRR by adding price and subscriber effects, rather than their product." That sentence is C46's
 * structural sign test (`nonlinearIdentityLeaderWithhold`), which reads the node's persisted `nonlinear_identity`
 * carrier and never the engine. Batch 7 (ISL #187, PLoT #379) makes the engine EVALUATE a declared identity and
 * report it as `identity_evaluations` at the TOP LEVEL of the /v2/run response, which CEE stores whole as the fact's
 * `enrichment`. ISL's own contract, R3-4: only `evaluated: true` licenses a numerical claim that rests on it.
 *
 * The rule, fail closed: a carrier whose node THIS run's list marks `evaluated === true` is not withheld by the
 * sign test; a carrier absent from the list, `evaluated !== true`, or a malformed list keeps today's withhold
 * exactly; no list (every run before batch 7) is byte-identical to today.
 *
 * The graphs are built through the REAL path of `c46-leader-withheld-on-a-product.test.ts` (strict candidate →
 * `buildModelFromBrief`, drafter faked → the `/graph/register` body → the production snapshot loader →
 * `createRunAnalysisHandler`, PLoT faked), on the same Paul's-shape candidate, so every withhold below is one the
 * production sign test produces, not one this file wrote.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import {
  evaluatedIdentityNodeIds,
  nonlinearIdentityForAgent,
  nonlinearIdentityLeaderClaimCause,
  nonlinearIdentityLeaderWithhold,
} from '../admit-model.js';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { deriveDecisionContextGraphHash, loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import type { SessionStore } from '../../session/store.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

const SCENARIO = '46464646-4646-4646-8646-46464646464e';
const REQUEST_ID = 'req-dl-c46-lift-evaluated';
const BRIEF =
  'Given our goal of reaching £20k MRR within 12 months while keeping monthly churn under 10%, should we increase ' +
  'the Pro plan price from £49 to £59 per month with the next AI feature release?';

const happyFixture = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf-8')) as V2RunResponseEnvelope;
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Dir = 'positive' | 'negative';
const link = (from: string, to: string, direction: Dir) => ({ from, to, direction, provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
const goal = { metric: 'MRR', operator: '>=', target_stated: true, frame: 'level', value: 20000, unit: 'GBP', horizon_months: 12, provenance: 'explicit',
  baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null };

/** PAUL'S SHAPE, as `c46-leader-withheld-on-a-product.test.ts` builds it: MRR = Pro plan price × Pro subscribers. */
function paul(): Record<string, unknown> {
  return {
    goal,
    constraints: [],
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
    links: [
      link('Pro plan price', 'Monthly churn', 'positive'),
      link('Monthly churn', 'Pro subscribers', 'negative'),
      link('Pro plan price', 'MRR', 'positive'),
      link('Pro subscribers', 'MRR', 'positive'),
    ],
    identities: [{ outcome: 'MRR', operation: 'product', factors: ['Pro plan price', 'Pro subscribers'], provenance: 'inferred' }],
    unknowns: [],
    change_created: [],
    decision_question: null,
  };
}

/**
 * TWO CARRIERS: Paul's product split by plan — MRR = Pro MRR + Team MRR, each a price × volume product, and each
 * price rise lowering its own volume. Raising Pro moves Pro MRR's inputs in opposite directions (not provable on its
 * own), and a Team rise is the same on Team MRR — so each carrier independently withholds the Pro leader.
 */
function twoPlans(): Record<string, unknown> {
  return {
    goal,
    constraints: [],
    options: [
      { label: 'Keep both plans', provenance: 'explicit', is_status_quo: true, changes: [],
        interventions: [
          { factor_label: 'Pro plan price', value: 49, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' },
          { factor_label: 'Team plan price', value: 99, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' },
        ] },
      { label: 'Raise Pro to £59', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
      { label: 'Raise Team to £119', provenance: 'explicit', is_status_quo: null, changes: [],
        interventions: [{ factor_label: 'Team plan price', value: 119, value_kind: 'absolute', unit: 'GBP', provenance: 'explicit' }] },
    ],
    factors: [
      { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP', provenance: 'explicit', plausible_max: 200 },
      { label: 'Pro subscribers', role: 'observable', baseline_known: false, baseline_value: 300, unit: 'subscribers', provenance: 'ai_proposed', plausible_max: 2000 },
      { label: 'Monthly churn', role: 'observable', baseline_known: false, baseline_value: 5, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Team plan price', role: 'controllable', baseline_known: true, baseline_value: 99, unit: 'GBP', provenance: 'explicit', plausible_max: 500 },
      { label: 'Team seats', role: 'observable', baseline_known: false, baseline_value: 40, unit: 'seats', provenance: 'ai_proposed', plausible_max: 1000 },
    ],
    risks: [], outcomes: [{ label: 'Pro MRR', provenance: 'inferred' }, { label: 'Team MRR', provenance: 'inferred' }],
    links: [
      link('Pro plan price', 'Monthly churn', 'positive'),
      link('Monthly churn', 'Pro subscribers', 'negative'),
      link('Pro plan price', 'Pro MRR', 'positive'),
      link('Pro subscribers', 'Pro MRR', 'positive'),
      link('Team plan price', 'Team seats', 'negative'),
      link('Team plan price', 'Team MRR', 'positive'),
      link('Team seats', 'Team MRR', 'positive'),
      link('Pro MRR', 'MRR', 'positive'),
      link('Team MRR', 'MRR', 'positive'),
    ],
    identities: [
      { outcome: 'Pro MRR', operation: 'product', factors: ['Pro plan price', 'Pro subscribers'], provenance: 'inferred' },
      { outcome: 'Team MRR', operation: 'product', factors: ['Team plan price', 'Team seats'], provenance: 'inferred' },
    ],
    unknowns: [],
    change_created: [],
    decision_question: null,
  };
}

type Graph = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };

async function build(wire: Record<string, unknown>): Promise<Graph> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
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

/** PLoT, faked as the sibling file fakes it — plus, when given, batch 7's top-level `identity_evaluations`. */
function plotResponse(ranked: Ranked[], identityEvaluations?: unknown): V2RunResponseEnvelope {
  const env = structuredClone(happyFixture) as unknown as Record<string, unknown>;
  env.results = ranked.map((r) => ({ option_id: r.id, option_label: r.label, win_probability: r.win, percentile_p10: 0.1, percentile_p90: 0.9 }));
  env.robustness = { level: 'high', fragile_edges: [], near_tie: { is_tie: false } };
  env.fact_objects = [];
  env.review_cards = [];
  delete env.constraint_analysis;
  if (identityEvaluations !== undefined) env.identity_evaluations = identityEvaluations;
  return env as unknown as V2RunResponseEnvelope;
}

/** Register body → production loader → the handler, PLoT faked. The persisted fact, as the handler wrote it. */
async function runOn(registered: Graph, ranked: Ranked[], identityEvaluations?: unknown): Promise<RunAnalysisHandlerFact> {
  const store = {
    loadGraph: async () => registered,
    loadGraphAndBriefText: async () => ({ graph: registered, briefText: null }),
  } as unknown as SessionStore;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, REQUEST_ID, store);
  const run = vi.fn(() => Promise.resolve(plotResponse(ranked, identityEvaluations)));
  const plotClient = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  const outcome = await createRunAnalysisHandler({ plotClient, scenarioReader: async () => snapshot })(makeInvocation());
  expect(run).toHaveBeenCalledOnce();
  return outcome.handler_facts[0] as RunAnalysisHandlerFact;
}

const RAISE: Ranked = { id: 'raise_pro_to_59', label: 'Raise Pro to £59', win: 0.94 };
const KEEP: Ranked = { id: 'keep_pro_at_49', label: 'Keep Pro at £49', win: 0.06 };
const COMPARED = [RAISE.id, KEEP.id];

/** ISL #187's `IdentityEvaluation` for the carrier on `mrr`, as PLoT #379 forwards it — evaluated, and withheld. */
const EVALUATED_MRR = {
  node_id: 'mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'], addends: [], stated_in_brief: false,
  evaluated: true, level_source: 'identity_inputs',
};
const WITHHELD_MRR = {
  node_id: 'mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_subscribers'], addends: [], stated_in_brief: false,
  evaluated: false, withheld_reason: 'identity_frame_missing',
};

/** Today's finding on Paul's shape — the Run's own call, no list. */
const todayOn = (g: Graph) => nonlinearIdentityLeaderWithhold(g, RAISE.id, { comparedOptionIds: COMPARED });
const withSet = (g: Graph, set: ReadonlySet<string>) => nonlinearIdentityLeaderWithhold(g, RAISE.id, { comparedOptionIds: COMPARED, evaluatedIdentityNodeIds: set });

describe('C46 × R3-4: the structural sign test stands down only for a carrier the engine evaluated on this run', () => {
  it('PREMISE: Paul\'s shape carries the product on `mrr` and today withholds £59 against keeping £49', async () => {
    const g = await build(paul());
    expect(g.nodes.filter((n) => 'nonlinear_identity' in n).map((n) => n.id)).toEqual(['mrr']);
    expect(todayOn(g)).toMatchObject({ leader_id: RAISE.id, outcome_id: 'mrr', goal_id: 'mrr', against: [KEEP.id] });
  });

  it('ROW 1 (the lift): the carrier evaluated on this run → no withhold; the helper reads it from the response', async () => {
    const g = await build(paul());
    expect(withSet(g, new Set(['mrr']))).toBeNull();
    const set = evaluatedIdentityNodeIds({ identity_evaluations: [EVALUATED_MRR] });
    expect([...set]).toEqual(['mrr']);
    expect(withSet(g, set)).toBeNull();
    // The Agent's view takes the same set, on both of its internal calls.
    expect(nonlinearIdentityForAgent(g, true)).not.toBeNull();
    expect(nonlinearIdentityForAgent(g, true, set)).toBeNull();
    expect(nonlinearIdentityForAgent(g, false, set)).toBeNull();
  });

  it('ROW 2 (fail closed): `evaluated: false` with its withheld_reason → the SAME finding as today', async () => {
    const g = await build(paul());
    const set = evaluatedIdentityNodeIds({ identity_evaluations: [WITHHELD_MRR] });
    expect(set.size).toBe(0);
    expect(todayOn(g)).not.toBeNull();
    expect(withSet(g, set)).toEqual(todayOn(g));
  });

  it('ROW 3: the carrier absent from the list (another node evaluated) → the same finding as today', async () => {
    const g = await build(paul());
    const set = evaluatedIdentityNodeIds({ identity_evaluations: [{ ...EVALUATED_MRR, node_id: 'pro_subscribers' }] });
    expect([...set]).toEqual(['pro_subscribers']);
    expect(withSet(g, set)).toEqual(todayOn(g));
    expect(withSet(g, set)).not.toBeNull();
  });

  it('ROW 4: no list or a malformed list → an empty set, never a throw, and the finding is identical to today', async () => {
    const g = await build(paul());
    const malformed: unknown[] = [
      undefined, null, 'mrr', 42, [], [EVALUATED_MRR], {},
      { identity_evaluations: undefined },
      { identity_evaluations: null },
      { identity_evaluations: 'mrr' },
      { identity_evaluations: { mrr: EVALUATED_MRR } },
      { identity_evaluations: [null, 'mrr', 7, ['mrr']] },
      { identity_evaluations: [{ ...EVALUATED_MRR, node_id: undefined }] },
      { identity_evaluations: [{ evaluated: true }] },
      { identity_evaluations: [{ ...EVALUATED_MRR, node_id: 42 }] },
      { identity_evaluations: [{ ...EVALUATED_MRR, node_id: '' }] },
      { identity_evaluations: [{ ...EVALUATED_MRR, evaluated: 'true' }] },
      { identity_evaluations: [{ ...EVALUATED_MRR, evaluated: 1 }] },
      { identity_evaluations: [{ ...EVALUATED_MRR, evaluated: undefined }] },
    ];
    const today = todayOn(g);
    expect(today).not.toBeNull();
    for (const m of malformed) {
      const set = evaluatedIdentityNodeIds(m);
      expect(set.size, JSON.stringify(m) ?? String(m)).toBe(0);
      expect(withSet(g, set), JSON.stringify(m) ?? String(m)).toEqual(today);
    }
    // No `evaluatedIdentityNodeIds` key at all (every caller before batch 7) is today's call.
    expect(nonlinearIdentityLeaderWithhold(g, RAISE.id, { comparedOptionIds: COMPARED, evaluatedIdentityNodeIds: undefined })).toEqual(today);
  });

  it('ROW 5: two carriers, only one evaluated → still withheld, on the unevaluated one', async () => {
    const g = await build(twoPlans());
    const idOf = (label: string): string => g.nodes.find((n) => n.label === label)?.id as string;
    const [proMrr, teamMrr, raisePro, raiseTeam, keep] = ['Pro MRR', 'Team MRR', 'Raise Pro to £59', 'Raise Team to £119', 'Keep both plans'].map(idOf);
    // PREMISE: both carriers registered, and each withholds the Pro leader on its own today.
    expect(g.nodes.filter((n) => 'nonlinear_identity' in n).map((n) => n.id).sort()).toEqual([proMrr, teamMrr].sort());
    const compared = [raisePro!, keep!, raiseTeam!];
    const on = (set?: ReadonlySet<string>) => nonlinearIdentityLeaderWithhold(g, raisePro!, { comparedOptionIds: compared, ...(set !== undefined ? { evaluatedIdentityNodeIds: set } : {}) });
    expect(on()?.outcome_id).toBe(proMrr);
    // Pro MRR evaluated: Team MRR, unevaluated, still withholds the Pro leader — against the Team rise.
    expect(on(new Set([proMrr!]))).toMatchObject({ leader_id: raisePro, outcome_id: teamMrr, against: [raiseTeam] });
    // Team MRR evaluated: Pro MRR still withholds, exactly as today.
    expect(on(new Set([teamMrr!]))).toEqual(on());
    // Both evaluated: nothing the sign test can still say.
    expect(on(new Set([proMrr!, teamMrr!]))).toBeNull();
  });

  it('ROW 6 (persisted readback): a fact whose enrichment marks the carrier evaluated gives no C46 cause; without it, today', async () => {
    const g = await build(paul());
    // The real handler's fact on today's path: the leader withheld by the product, the constraint verdict permitting.
    const fact = await runOn(g, [RAISE, KEEP]);
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: false, constraint_verdict_state: 'not_applicable' });
    const cause = (result: RunAnalysisHandlerFact['result']) =>
      nonlinearIdentityLeaderClaimCause({ graph: g, graphHash: deriveDecisionContextGraphHash(g), result, requested: true });
    expect(cause(fact.result)).toEqual({ withheldBecauseUnrequested: false, withheldBecauseNonlinearIdentity: true });
    const evaluated = { ...fact.result, enrichment: { ...(fact.result.enrichment as Record<string, unknown>), identity_evaluations: [EVALUATED_MRR] } };
    expect(cause(evaluated)).toEqual({ withheldBecauseUnrequested: false, withheldBecauseNonlinearIdentity: false });
    // Fail closed on the readback too: the engine's own "withheld" keeps today's cause.
    const withheld = { ...fact.result, enrichment: { ...(fact.result.enrichment as Record<string, unknown>), identity_evaluations: [WITHHELD_MRR] } };
    expect(cause(withheld)).toEqual({ withheldBecauseUnrequested: false, withheldBecauseNonlinearIdentity: true });
  });

  it('HANDLER ROW (run_analysis): PLoT reports the carrier evaluated → the leader is named and the headline says it', async () => {
    const g = await build(paul());
    const fact = await runOn(g, [RAISE, KEEP], [EVALUATED_MRR]);
    expect(fact.result.leading_option_id).toBe(RAISE.id);
    expect(fact.result.constraint_verdict).toEqual({ may_name_leading_option: true, constraint_verdict_state: 'not_applicable' });
    expect(fact.result.summary).toMatch(/Raise Pro to £59/);
    // The list is stored verbatim with the envelope, where the readback finds it.
    expect((fact.result.enrichment as Record<string, unknown>).identity_evaluations).toEqual([EVALUATED_MRR]);
  });

  it('HANDLER CONTRAST: no list, or the engine withheld the identity → withheld exactly as today', async () => {
    const g = await build(paul());
    for (const list of [undefined, [WITHHELD_MRR], [{ ...EVALUATED_MRR, node_id: 'pro_subscribers' }]]) {
      const fact = await runOn(g, [RAISE, KEEP], list);
      expect(fact.result.constraint_verdict, JSON.stringify(list)).toEqual({ may_name_leading_option: false, constraint_verdict_state: 'not_applicable' });
      expect(fact.result.summary, JSON.stringify(list)).not.toMatch(/Raise Pro to £59/);
    }
  });
});
