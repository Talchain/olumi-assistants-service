import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import { definitionalLinkInUse, identityRunUseOfResult } from '../../../compose/definitional-links.js';
import { GOAL_CHANCE_LICENSED } from '../../../goal-target/goal-chance-licence.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import minimalFixture from '../../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

type Rec = Record<string, any>;
const served = JSON.parse(readFileSync(new URL('../../../../../tests/fixtures/served/c96fc4bb-saved-graph.json', import.meta.url), 'utf8')).graph as Rec;
const clone = <T>(value: T): T => structuredClone(value);
const node = (graph: Rec, id: string): Rec => graph.nodes.find((n: Rec) => n.id === id);
const CARRIER_ID = 'subscribers_at_12';
const CARRIER = { operation: 'accumulation', factor_ids: ['paying_subscribers', 'monthly_churn', 'monthly_gross_additions'],
  horizon_months: 12, rate_scale: 0.01, stated_in_brief: false };
const PRODUCT = { operation: 'product', factor_ids: ['pro_plan_price', CARRIER_ID], stated_in_brief: true };

function accumulationGraph(deadline: number): Rec {
  const graph = clone(served);
  Object.assign(node(graph, 'mrr'), { goal_horizon_months: deadline, nonlinear_identity: clone(PRODUCT) });
  graph.nodes.push({ id: CARRIER_ID, kind: 'outcome', label: 'Pro subscribers at month 12', scale_frame: 10000,
    nonlinear_identity: clone(CARRIER) });
  graph.edges = graph.edges.filter((e: Rec) => !(e.to === 'paying_subscribers' || (e.from === 'paying_subscribers' && e.to === 'mrr')));
  const edge = (from: string, to: string): Rec => ({ from, to, strength: { mean: 1, std: 0.01 }, exists_probability: 1,
    effect_direction: 'positive' });
  graph.edges.push(...CARRIER.factor_ids.map(id => edge(id, CARRIER_ID)), edge(CARRIER_ID, 'mrr'));
  return graph;
}

async function run(graph: Rec, body: Rec = minimalFixture): Promise<{ wire: Rec; result: Rec; snapshot: Rec }> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'req-accumulation-load', {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: async () => ({ graph: clone(graph), briefText: 'Compare the Pro plan prices.' }),
    loadGraph: async () => clone(graph),
  } as never);
  const snapshotBefore = clone(snapshot);
  const plotRun = vi.fn(async () => clone(body) as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run: plotRun, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot,
  });
  const outcome = await handler({ payload: { scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', turn_id: 't-accumulation' },
    requestId: 'req-accumulation-run', signal: new AbortController().signal, context: {}, orientationText: '' } as unknown as HandlerInvocation);
  expect(plotRun).toHaveBeenCalledTimes(1);
  expect(snapshot).toEqual(snapshotBefore);
  const fact = outcome.handler_facts[0]!;
  expect(fact.fact_type).toBe('run_analysis');
  return { wire: ((plotRun.mock.calls as unknown[][])[0]![0] as { graph: Rec }).graph, result: fact.result as Rec,
    snapshot: snapshot as unknown as Rec };
}

const driftWarnings = (result: Rec): Rec[] => (result.enrichment.inference_warnings ?? []).filter((w: Rec) => w.code === 'ACCUMULATION_HORIZON_DRIFT');

describe('Run accumulation horizon drift — the wire copy uses the current deadline', () => {
  it('RED ROW subscribers_at_12: deadline changed to 6 drops only the wire carrier and records its exact warning', async () => {
    const graph = accumulationGraph(6);
    const storedBefore = clone(graph);
    const hashBefore = computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(graph));
    const { wire, result, snapshot } = await run(graph);
    expect(node(wire, CARRIER_ID).nonlinear_identity).toBeUndefined();
    expect(node(wire, 'mrr').nonlinear_identity).toEqual(PRODUCT);
    expect(node(snapshot.graph, CARRIER_ID).nonlinear_identity).toEqual(CARRIER);
    expect(node(snapshot.rawPersistedGraph, CARRIER_ID).nonlinear_identity).toEqual(CARRIER);
    expect(graph).toEqual(storedBefore);
    expect(computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(snapshot.rawPersistedGraph))).toBe(hashBefore);
    expect(result.graph_hash_at_run).toBe(hashBefore);
    expect(result.enrichment._meta.identities_not_forwarded).toContainEqual({ node_id: CARRIER_ID, reason: 'accumulation_horizon_drift' });
    expect(definitionalLinkInUse(graph, 'monthly_churn', CARRIER_ID, identityRunUseOfResult(result))).toBeNull();
    expect(driftWarnings(result)).toEqual([{ code: 'ACCUMULATION_HORIZON_DRIFT', severity: 'warning', node_ids: [CARRIER_ID],
      message: "‘Pro subscribers at month 12’ is worked out to month 12, but your deadline is now month 6, so it wasn't used in this run." }]);
  });

  it('CONTROL subscribers_at_12: matching month 12 sends the carrier byte-for-byte except rate_sigma_log and emits no drift warning', async () => {
    const { wire, result } = await run(accumulationGraph(12));
    // Both rates in the served fixture are cee_inference: #2862 carries Olumi's spread on the Run wire.
    expect(node(wire, CARRIER_ID).nonlinear_identity).toEqual({ ...CARRIER, rate_sigma_log: [0.246, 0.246] });
    expect(node(wire, 'mrr').nonlinear_identity).toEqual(PRODUCT);
    expect(driftWarnings(result)).toEqual([]);
    expect(definitionalLinkInUse(accumulationGraph(12), 'monthly_churn', CARRIER_ID, identityRunUseOfResult(result)))
      .toMatchObject({ carrier_id: CARRIER_ID, operation: 'accumulation' });
  });

  it('ROW + CONTROL subscribers_at_12: the run licence reads withdrawn input links as ordinary Bernoulli links', async () => {
    const body = { ...clone(minimalFixture), option_comparison: [
      { option_id: 'raise_price_to_59', probability_of_goal: 0.7, win_probability: 0.7 },
      { option_id: 'raise_price_to_54', probability_of_goal: 0.4, win_probability: 0.3 },
    ], identity_evaluations: [{ node_id: 'mrr', operation: 'product', factor_ids: PRODUCT.factor_ids, evaluated: true, level_source: 'stated_level' }] };
    const licences: Rec[] = [];
    for (const deadline of [6, 12]) {
      const graph = accumulationGraph(deadline);
      node(graph, CARRIER_ID).nonlinear_identity.stated_in_brief = true;
      Object.assign(node(graph, 'mrr'), { goal_threshold: 0.8, goal_threshold_raw: 85000,
        goal_threshold_cap: 106250, goal_threshold_unit: 'GBP/month', goal_threshold_frame: 'level', goal_direction: '>=' });
      const ratePath = graph.edges.find((e: Rec) => e.from === 'pro_plan_price' && e.to === 'monthly_churn');
      Object.assign(ratePath, { exists_probability: 1, defaulted: false, provenance: { source: 'user_specified' } });
      graph.edges.find((e: Rec) => e.from === 'monthly_churn' && e.to === CARRIER_ID).exists_probability = 0.5;
      const { result } = await run(graph, body);
      const licence = result.enrichment.inference_warnings.find((w: Rec) => w.code === GOAL_CHANCE_LICENSED);
      expect(licence).toBeDefined();
      licences.push(licence);
    }
    expect(licences[0]).toMatchObject({ goal_node_id: 'mrr', form: 'each',
      summary_withheld: { cause: 'olumi_existence_assumption', form: 'highest' } });
    expect(licences[1]).toMatchObject({ goal_node_id: 'mrr', form: 'highest' });
    expect(licences[1]!.summary_withheld).toBeUndefined();
  });

  it('ROW subscribers_at_12: removing the deadline also withdraws the wire carrier', async () => {
    const graph = accumulationGraph(12);
    delete node(graph, 'mrr').goal_horizon_months;
    const { wire, result } = await run(graph);
    expect(node(wire, CARRIER_ID).nonlinear_identity).toBeUndefined();
    expect(driftWarnings(result)).toEqual([{ code: 'ACCUMULATION_HORIZON_DRIFT', severity: 'warning', node_ids: [CARRIER_ID],
      message: "‘Pro subscribers at month 12’ is worked out to month 12, but your deadline is no longer set, so it wasn't used in this run." }]);
  });

  it('CONTROL mrr: a goal product without an accumulation is preserved after a deadline edit', async () => {
    const graph = clone(served);
    const product = { operation: 'product', factor_ids: ['pro_plan_price', 'paying_subscribers'], stated_in_brief: true };
    Object.assign(node(graph, 'mrr'), { goal_horizon_months: 6, nonlinear_identity: product });
    const { wire, result } = await run(graph);
    expect(node(wire, 'mrr').nonlinear_identity).toEqual(product);
    expect(driftWarnings(result)).toEqual([]);
  });
});
