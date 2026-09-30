/**
 * ⛔ GATE 5 — A GOAL THE USER'S OWN FIGURES MAKE AS A PRODUCT HAS NO FIGURES FROM A RUN THAT DID NOT READ IT (DL #75
 * 5904272507; AIQ 5904262145 + 5904286130; P0 partner rows 5904282153).
 *
 * Served MRR on CEE `ef042ce` (R3 #2339 row (b), guest `c8108752`, draft `m0`): "£49 … 1,500 paying subscribers … £75k
 * MRR" drafted with no product and an invented "Non-Pro MRR £1,500"; Run 1 named "Raise to £59" the provisional leader
 * (win share 0.844) at a median MRR of £77.4k, where 1,500 × £59 is £88,500.
 *
 * THE PATH: the served graphs through the REAL loader and the REAL handler; the PLoT client returns the served run body
 * (the cold read's `analysis_result.enrichment`). Rung: TESTED (in-process), not a wire witness.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { GOAL_FIGURES_PRODUCT_NOT_READ } from '../../../../orchestrator/context/option-result-source.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { goalChanceWithheldForAgent, PRODUCT_NOT_READ_NOTE } from '../../../agent-lane/goal-chance-withheld.js';
import { unreadGoalProduct } from '../../../agent-lane/unread-goal-product.js';
import { buildAnalysisResultBlock } from '../../../compose.js';
import { composeAnalysisStateV1, readRawRobustnessFromResponseBody } from '../../../compose/analysis-state-v1.js';
import { mayPresentLeaderClaimForFact } from '../../../compose/unrequested-analysis-confinement.js';
import { claimPermissionsFrom } from '../../../agent-lane/first-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Json = Record<string, any>;
type Served = { _provenance: { brief_text: string | null }; graph: Json; plot_body: Json };
const F = JSON.parse(readFileSync(new URL('./fixtures/served-gate5-mrr-m0-and-cut-costs-15f48f0b.json', import.meta.url), 'utf8')) as {
  mrr_m0: Served; cut_costs_15f48f0b: Served; mrr_m6_graph: { graph: Json };
};
const W3 = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const W3_SERVED: Served = {
  _provenance: { brief_text: null },
  graph: W3.graph,
  plot_body: { ...W3.analysis_result.enrichment, analysis_status: 'computed' },
};
const M0 = F.mrr_m0;
const CUT = F.cut_costs_15f48f0b;
const SCENARIO = 'c8108752-0000-4000-8000-000000000005';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

let lastFact: unknown;
async function runOn(served: Served, graph: Json = served.graph): Promise<Json> {
  const store = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: served._provenance.brief_text ?? '' })),
    loadGraph: vi.fn(async () => clone(graph)),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-g5-load', store as never);
  const run = vi.fn(async () => clone(served.plot_body) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot),
  });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-g5-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({
      turn_id: 't-g5', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse',
    } as never),
    requestId: 'req-g5-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error(`wrong fact_type ${fact.fact_type}`);
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  lastFact = fact;
  return fact.result as Json;
}

const CANONICAL_FRESH = {
  status: 'ready', freshness: 'fresh', freshness_reason: 'hash_match', selected_fact_index: 0, computed_at: '2026-09-30T04:40:00.000Z',
  graph_hash_at_run: 'h1', current_graph_hash: 'h1', blockers: [], model_adjustments: [], goal_node_id: 'mrr', degraded_fact_status: null,
  contradictions: [], usableForProse: true, usableForChips: true, usableForFollowupContext: true, requiresRerun: false, blockedUnusable: false,
} as never;
function leaderClaimOf(fact: unknown): { claim: Json; mayBeNamed: boolean } {
  const block = buildAnalysisResultBlock(fact as never);
  const state = composeAnalysisStateV1({
    canonical: CANONICAL_FRESH,
    mayNameLeadingOption: mayPresentLeaderClaimForFact(fact as never),
    rawRobustness: readRawRobustnessFromResponseBody({ blocks: [block] }),
  } as never)!;
  const perms = claimPermissionsFrom(state, { analysis_admission: { permitted_analysis_mode: 'comparative_leader' } }, { requested: true });
  return { claim: (state as Json).leader_claim, mayBeNamed: perms.leader_may_be_named };
}
function entriesFor(env: Json, id: string): Json[] {
  const carriers = [env.option_comparison, env.results, env.results?.option_comparison, env.results?.options, env.decision_brief?.options];
  return carriers.flatMap((c) => (Array.isArray(c) ? c : [])).filter((e: Json) => e?.option_id === id || e?.id === id);
}
const M0_OPTIONS = ['keep_49_price', 'raise_to_54', 'raise_to_59'];

describe('PREMISE — the served m0 run, read off the stored bytes', () => {
  it('no identity anywhere; the goal is £75,000 / month, the user\'s £49 price and 1,500 subscribers feed it; Raise to £59 leads at 0.844', () => {
    const nodes = M0.graph.nodes as Json[];
    expect(nodes.filter((n) => n.nonlinear_identity !== undefined)).toEqual([]);
    expect(nodes.find((n) => n.kind === 'goal')).toMatchObject({ id: 'mrr', observed_state: { raw_value: 75000, unit: '£/month', source: 'brief_extraction' } });
    expect(nodes.find((n) => n.id === 'pro_plan_price')!.observed_state).toMatchObject({ raw_value: 49, source: 'brief_extraction' });
    expect(nodes.find((n) => n.id === 'pro_paying_subscribers')!.observed_state).toMatchObject({ raw_value: 1500, source: 'brief_extraction' });
    const lead = (M0.plot_body.option_comparison as Json[]).find((o) => o.option_id === 'raise_to_59')!;
    expect(lead.win_probability).toBeCloseTo(0.844, 3);
    expect(lead.outcome.p50).toBeCloseTo(77410.29, 1);
    expect((M0.plot_body.option_comparison as Json[]).map((o) => o.option_id).sort()).toEqual(M0_OPTIONS);
  });
});

describe('Gate 5 at the call site: m0 withholds every goal figure, every win share and the leader', () => {
  it('RED: no goal chance, projected MRR, downside or win share on ANY option in ANY carrier', async () => {
    const r = await runOn(M0);
    const env = r.enrichment ?? r;
    for (const id of M0_OPTIONS) {
      const entries = entriesFor(env, id);
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        for (const k of ['probability_of_goal', 'probability_of_joint_goal', 'downside', 'win_probability', 'rank']) expect(e).not.toHaveProperty(k);
        for (const k of ['mean', 'p10', 'p50', 'p90', 'std']) expect(e.outcome ?? {}).not.toHaveProperty(k);
      }
    }
    expect(JSON.stringify(env)).not.toMatch(/77410\.2|0\.84403/);
  });

  it('RED: no leader anywhere, and the permission every consumer obeys withholds it', async () => {
    const r = await runOn(M0);
    const env = r.enrichment ?? r;
    expect(r).toHaveProperty('leading_option_id', null);
    for (const k of ['flip_thresholds', 'conditional_winners', 'p_win_sensitivity']) expect(env).not.toHaveProperty(k);
    const { claim, mayBeNamed } = leaderClaimOf(lastFact);
    expect(claim.permitted).toBe(false);
    expect(mayBeNamed).toBe(false);
  });

  it('RED: ONE typed warning names the reading Olumi did not make in the user\'s figures, and promises nothing; the Agent says it', async () => {
    const r = await runOn(M0);
    const env = r.enrichment ?? r;
    const w = (env.inference_warnings as Json[]).filter((x) => x.code === GOAL_FIGURES_PRODUCT_NOT_READ);
    expect(w).toHaveLength(1);
    expect(w[0]!.option_ids.slice().sort()).toEqual(M0_OPTIONS);
    expect(w[0]!.node_ids).toEqual(['mrr', 'pro_plan_price', 'pro_paying_subscribers']);
    expect(w[0]!.message.startsWith('Not shown. ')).toBe(true);
    expect(w[0]!.message.length).toBeLessThanOrEqual(400);
    expect(w[0]!.message).toContain('Olumi has not read ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’');
    expect(w[0]!.message).toContain('£73,500');
    expect(w[0]!.message).toContain('close to your £75,000');
    expect(w[0]!.message).not.toMatch(/will (calculate|use|work)/i);
    const chance = goalChanceWithheldForAgent({ enrichment: env });
    expect(chance).toMatchObject({ withheld: true, note: PRODUCT_NOT_READ_NOTE });
    expect(chance!.option_ids!.slice().sort()).toEqual(M0_OPTIONS);
    expect(chance!.say.startsWith('Olumi has not read ‘MRR’')).toBe(true);
  });
});

describe('CONTROLS — figures kept where the user\'s figures make no unread product', () => {
  it('CONTROL (the probe sees it): m0 with the product declared on the goal keeps every served figure and the leader', async () => {
    const g = clone(M0.graph);
    (g.nodes as Json[]).find((n) => n.id === 'mrr')!.nonlinear_identity = {
      operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], stated_in_brief: true,
    };
    expect(unreadGoalProduct(g)).toBeNull();
    const r = await runOn(M0, g);
    const env = r.enrichment ?? r;
    expect(env.inference_warnings.map((x: Json) => x.code)).not.toContain(GOAL_FIGURES_PRODUCT_NOT_READ);
    expect((env.option_comparison as Json[]).find((o) => o.option_id === 'raise_to_59')!.win_probability).toBeCloseTo(0.844, 3);
  });

  it('CONTROL (m0, the user\'s subscribers unstated): the same run is not withheld — every figure must be the user\'s', () => {
    const g = clone(M0.graph);
    (g.nodes as Json[]).find((n) => n.id === 'pro_paying_subscribers')!.observed_state.source = 'cee_inference';
    expect(unreadGoalProduct(g)).toBeNull();
  });

  it('CONTROL (m0, the goal 10% off the product): no reconciliation, no withhold', () => {
    const g = clone(M0.graph);
    (g.nodes as Json[]).find((n) => n.id === 'mrr')!.observed_state.raw_value = 81000;
    expect(unreadGoalProduct(g)).toBeNull();
  });

  it('CONTROL (m0, the price a YEARLY rate): the levels reconcile but the units do not compose, so no withhold', () => {
    const g = clone(M0.graph);
    (g.nodes as Json[]).find((n) => n.id === 'pro_plan_price')!.observed_state.unit = '£ per subscriber per year';
    expect(unreadGoalProduct(g)).toBeNull();
  });

  it('CONTROL (m6, the drafter declared the product): unchanged — a declared product is read or #416 withholds it', () => {
    expect((F.mrr_m6_graph.graph.nodes as Json[]).some((n) => n.nonlinear_identity?.operation === 'product')).toBe(true);
    expect(unreadGoalProduct(F.mrr_m6_graph.graph)).toBeNull();
  });

  it('CONTROL (cut-costs 15f48f0b): the brief\'s levels make no rate × count for spend, so 33%, the earned 0 and the leader stand', async () => {
    expect(unreadGoalProduct(CUT.graph)).toBeNull();
    const r = await runOn(CUT);
    const env = r.enrichment ?? r;
    expect(env.inference_warnings.map((x: Json) => x.code)).not.toContain(GOAL_FIGURES_PRODUCT_NOT_READ);
    const oc = env.option_comparison as Json[];
    expect(oc.find((o) => o.option_id === 'switch_to_gcp')).toMatchObject({ probability_of_goal: 0.3319 });
    expect(oc.find((o) => o.option_id === 'keep_aws')).toMatchObject({ probability_of_goal: 0 });
    expect(r.leading_option_id).toBe('switch_to_gcp');
  });

  it('CONTROL (signed-in MRR W3 520aab46, product confirmed): the cold read keeps 0.2469', async () => {
    expect(unreadGoalProduct(W3_SERVED.graph)).toBeNull();
    const r = await runOn(W3_SERVED);
    const env = r.enrichment ?? r;
    expect(env.inference_warnings.map((x: Json) => x.code)).not.toContain(GOAL_FIGURES_PRODUCT_NOT_READ);
    expect(JSON.stringify(env.option_comparison)).toContain('0.2469');
  });
});
