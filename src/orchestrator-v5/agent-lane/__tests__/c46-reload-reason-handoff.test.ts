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
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import type { SessionStore } from '../../session/store.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { AUTO_RUN_POST_CONSTRUCTION_INITIATOR, RUN_PROVENANCE_ENRICHMENT_KEY } from '../../context/run-initiator.js';
import { leaderWithheldForALimit } from '../../coaching/limit-unchecked-card.js';
import {
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

  it.fails('HANDOFF TRIPWIRE: the reload names the C46 reason (needs the read-route caller line)', async () => {
    const graph = await build(PRODUCT);
    const read = await reload(graph, await runOn(graph));
    expect(read.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN);
  });

  it.fails('HANDOFF TRIPWIRE: no limit card is triggered on a brief that set no limit (needs the caller line)', async () => {
    const graph = await build(PRODUCT);
    const read = await reload(graph, await runOn(graph));
    expect(leaderWithheldForALimit(read.analysis_state)).toBe(false);
  });

  it.fails('HANDOFF TRIPWIRE: the automatic first pass keeps `unrequested_analysis_withheld` (needs the caller line)', async () => {
    const graph = await build(PRODUCT);
    const read = await reload(graph, autoInitiated(await runOn(graph)));
    expect(read.analysis_state?.leader_claim.withheld_reason).toBe(WITHHELD_UNREQUESTED_ANALYSIS);
  });
});
