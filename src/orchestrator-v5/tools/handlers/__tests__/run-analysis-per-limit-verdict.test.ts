/**
 * B5 at the ONE call site: the real `run_analysis` handler writes `per_limit` + `joint` onto the stored run result's
 * `constraint_verdict` (@talchain/schemas 0.60.0), and the fact still parses under `RunAnalysisResultSchema`.
 *
 * Paul's 17d1cd3a, end to end in process: his exported graph goes through the REAL loader
 * (`loadScenarioSnapshotForRunAnalysis`) and the REAL handler. The PLoT client returns the response MG's EXECUTED
 * replay captured for this exact body (PLoT 1f6ad52 → ISL 3717e36; 281/281 values equal the export; #70 5856264807).
 * On that run churn "≤ 4 %" scored P = 1 for every option against Olumi's own 3 % estimate.
 *
 * Rung: TESTED (an in-process handler witness). It is not a wire witness and not a journey witness.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Json = Record<string, any>;
const DIR = 'tests/fixtures/cross-service/b5-per-limit';
const input = JSON.parse(readFileSync(`${DIR}/17d1cd3a.graph.json`, 'utf8')) as { graph: Json; brief_text: string };
const plotResponse = JSON.parse(readFileSync(`${DIR}/17d1cd3a.plot-response.json`, 'utf8')) as Json;

const SCENARIO = 'a295e4a1-97b5-46c8-987a-513232e5dba4';
const CHURN = 'agent-lane:monthly_churn:<=';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

async function storedVerdict(graph: Json): Promise<Json> {
  const store = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: input.brief_text })),
    loadGraph: vi.fn(async () => clone(graph)),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-b5-load', store as never);
  const run = vi.fn(async () => clone(plotResponse) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot),
  });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-b5-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({
      turn_id: 't-b5', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse',
    } as never),
    requestId: 'req-b5-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error(`wrong fact_type ${fact.fact_type}`);
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  return fact.result.constraint_verdict as Json;
}

/**
 * The same served graph with price's path to churn (`price → price_sensitivity → churn`, links nobody sized; the risk
 * node has no other link) replaced by ONE link Olumi sized in churn's unit — so the rows below pin B5's WHOSE-level
 * rule, not R-c's parts predicate.
 */
function withSizedChurnLink(g: Json): Json {
  const graph = clone(g);
  graph.nodes = (graph.nodes as Json[]).filter((n) => n.id !== 'price_sensitivity');
  graph.edges = (graph.edges as Json[]).filter((e) => e.from !== 'price_sensitivity' && e.to !== 'price_sensitivity');
  (graph.edges as Json[]).push({ from: 'pro_plan_price', to: 'monthly_churn', strength: { mean: 0.3, std: 0.15 }, exists_probability: 0.9, effect_direction: 'positive',
    provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 0.5, amount_unit: 'percentage points', per_source_change: 10, per_source_change_unit: 'GBP per month', strength_mean: 0.3, strength_mean_frame: 'edge_strength' } } });
  return graph;
}

describe('B5-1 at the call site: the stored verdict on Paul\'s 17d1 run', () => {
  it('R-c (AI Quality 5882087383): the served churn limit, moved by price only through unsized links, is stored unscored — the leader is still decided on the rest', async () => {
    const v = await storedVerdict(input.graph);
    expect(v.per_limit).toEqual([{ constraint_id: CHURN, state: 'unscored', reason: 'parts_links_placeholder' }]);
    expect(v.joint).toEqual({ state: 'withheld', withheld_reason: 'limit_unscored', constraint_ids: [CHURN] });
  });
  it('with the link sized: churn is estimate_only (Olumi\'s 3 %) and a joint that is not scored', async () => {
    const v = await storedVerdict(withSizedChurnLink(input.graph));
    expect(v.per_limit).toEqual([{ constraint_id: CHURN, state: 'estimate_only', reason: 'level_olumi_estimate' }]);
    expect(v.joint).toEqual({ state: 'estimate_only' });
  });
  it('DERIVED (churn\'s level marked as the user\'s assumption): the call site names it THEIRS, level_user_assumption', async () => {
    const graph = withSizedChurnLink(input.graph);
    (graph.nodes as Json[]).find((n) => n.id === 'monthly_churn')!.observed_state.source = 'user_assumption';
    const v = await storedVerdict(graph);
    expect(v.per_limit).toEqual([{ constraint_id: CHURN, state: 'estimate_only', reason: 'level_user_assumption' }]);
    expect(v.joint).toEqual({ state: 'estimate_only' });
  });
  it('CONTROL (DERIVED: churn\'s level stated by the user): the same run stores churn as scored', async () => {
    const graph = withSizedChurnLink(input.graph);
    (graph.nodes as Json[]).find((n) => n.id === 'monthly_churn')!.observed_state.source = 'user';
    const v = await storedVerdict(graph);
    expect(v.per_limit).toEqual([{ constraint_id: CHURN, state: 'scored' }]);
    expect(v.joint).toEqual({ state: 'scored' });
  });
});
