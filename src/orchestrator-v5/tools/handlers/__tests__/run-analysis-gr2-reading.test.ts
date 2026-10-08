import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createRunAnalysisHandler, type RunAnalysisScenarioSnapshot } from '../run-analysis.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { HandlerInvocation } from '../../registry.js';
import { executedReadingAddendOf } from '../../../goal-target/reading-addend-contribution.js';
import minimal from '../../../../../tests/fixtures/plot/v2-run-golden-minimal.json';

type Rec = Record<string, any>;
const PAUL = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/goal-reach-paul-graph-632b92b9.json', import.meta.url), 'utf8'));
const n = (g: Rec, id: string) => g.nodes.find((x: Rec) => x.id === id);
const graph = () => structuredClone(PAUL) as Rec;
const SCENARIO = '00000000-0000-4000-8000-000000000002';
async function run(g: Rec) {
  const snapshot = { graph: structuredClone(g), rawPersistedGraph: structuredClone(g), goal_node_id: 'mrr', options: [
    { id: 'keep_49_pro_price', option_id: 'keep_49_pro_price', label: 'Keep £49 Pro price', interventions: { pro_plan_price: .245 }, is_baseline: true },
    { id: 'raise_pro_price_to_59', option_id: 'raise_pro_price_to_59', label: 'Raise Pro price to £59', interventions: { pro_plan_price: .295 } },
  ] } as RunAnalysisScenarioSnapshot;
  const before = JSON.stringify(snapshot);
  const hash = computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(g));
  const body: Rec = structuredClone(minimal);
  body.option_comparison = snapshot.options.map((o, i) => ({ option_id: o.id, probability_of_goal: i ? .62 : .41, win_probability: i ? .7 : .3 }));
  body.identity_evaluations = [{ node_id: 'mrr', operation: 'product', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'], evaluated: true }];
  const mock = vi.fn(async () => body);
  const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: { run: mock } as unknown as PLoTClient });
  const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 'gr2' }, requestId: 'gr2', signal: new AbortController().signal,
    context: {}, orientationText: '' } as unknown as HandlerInvocation);
  expect(mock).toHaveBeenCalledOnce();
  return { payload: (mock.mock.calls as unknown as Rec[][])[0]![0]!, wire: (mock.mock.calls as unknown as Rec[][])[0]![0]!.graph as Rec, snapshot, before, hash, outcome: outcome as Rec };
}

describe('GR2 actual run-analysis dispatch seam', () => {
  it('construction identity is stamped outbound; raw graph + snapshot + graph_hash_at_run unchanged', async () => {
    const g = graph(); const r = await run(g);
    expect(n(r.wire, 'mrr').nonlinear_identity.reading_licence).toBe('olumi_reading');
    // Case (2): keep it a linear parent, NEVER turn a levelless loss into a listed operand.
    expect(n(r.wire, 'mrr').nonlinear_identity.addends).toEqual([]);
    expect(JSON.stringify(r.snapshot)).toBe(r.before);
    expect(r.outcome.handler_facts?.[0]?.result.graph_hash_at_run).toBe(r.hash);
  });
  it('Paul executed churn contribution by node id is proved from the ACTUAL dispatched PLoT wire, including held edges', async () => {
    const r = await run(graph()); const goal = n(r.wire, 'mrr');
    const lossId = 'mrr_lost_to_price_driven_churn';
    const edge = (from: string, to: string): Rec => r.wire.edges.find((e: Rec) => e.from === from && e.to === to);
    const effective = (e: Rec) => e.strength.mean * e.exists_probability;
    for (const option of r.payload.options) {
      const price = option.interventions.pro_plan_price / n(r.wire, 'pro_plan_price').observed_state.cap;
      const churn = n(r.wire, 'monthly_churn_rate').observed_state.value + price * effective(edge('pro_plan_price', 'monthly_churn_rate'));
      const loss = churn * effective(edge('monthly_churn_rate', lossId));
      const amount = goal.goal_threshold_cap * loss * effective(edge(lossId, 'mrr'));
      expect(amount).toBeLessThan(0);
      expect(amount).toBeCloseTo(option.id === 'keep_49_pro_price' ? -876.12 : -934.92, 9);
      const executed = executedReadingAddendOf(r.wire, r.payload.options, option.id, 'mrr', lossId);
      expect(executed?.value).toBeCloseTo(amount, 9);
      expect(executed?.sized).toBe(false);
      console.info('GR2 actual wire contribution', { node_id: lossId, option_id: option.id, value: amount });
    }
    // Existing P5/constraint gates still withhold this fixture's mocked points; the stamp does not bypass them.
    expect(r.outcome.handler_facts[0].result.enrichment.option_comparison.every((o: Rec) => o.probability_of_goal === undefined)).toBe(true);
  });
  it('pre-2300 graph: carried product is stamped after carry, same identity binding', async () => {
    const g = graph(); delete n(g, 'mrr').nonlinear_identity;
    g.edges = g.edges.filter((e: Rec) => e.to !== 'mrr' || ['pro_plan_price', 'pro_paying_subscribers'].includes(e.from));
    n(g, 'mrr').observed_state = { value: .735, raw_value: 14700, cap: 20000, unit: '£/month', source: 'brief_extraction' };
    n(g, 'pro_paying_subscribers').observed_state = { value: .15, raw_value: 300, unit: 'subscribers', source: 'brief_extraction' };
    const r = await run(g);
    expect(n(r.wire, 'mrr').nonlinear_identity).toMatchObject({ stated_in_brief: false, reading_licence: 'olumi_reading', factor_ids: ['pro_plan_price', 'pro_paying_subscribers'] });
  });
  it.each(['unit', 'risk', 'contradiction', 'listed_missing', 'replaced'] as const)('NEG %s: no outbound stamp', async edit => {
    const g = graph();
    if (edit === 'unit') n(g, 'pro_paying_subscribers').observed_state.unit = '%';
    if (edit === 'risk') n(g, 'mrr_lost_to_price_driven_churn').provenance = 'from_brief';
    if (edit === 'contradiction') n(g, 'mrr').observed_state = { value: .75, raw_value: 30000, unit: '£/month', source: 'brief_extraction' };
    if (edit === 'listed_missing') n(g, 'mrr').nonlinear_identity.addends = ['mrr_lost_to_price_driven_churn'];
    if (edit === 'replaced') n(g, 'mrr').nonlinear_identity.factor_ids[1] = 'monthly_churn_rate';
    const r = await run(g); expect(n(r.wire, 'mrr').nonlinear_identity?.reading_licence).toBeUndefined();
  });
  it('Yes / CTRL-T1b confirmed identity remains unstamped', async () => {
    const g = graph(); n(g, 'mrr').nonlinear_identity.stated_in_brief = true;
    const r = await run(g); expect(n(r.wire, 'mrr').nonlinear_identity).toEqual(n(g, 'mrr').nonlinear_identity);
  });
});
