/**
 * C1 "why it moved" at the handler (design `c1-why-it-moved/C1-DESIGN.md`; R3 #75 5920656318 + 5920859011).
 * Real handler, real snapshot loader, the served c96fc4bb graph (Paul's MRR journey). The PLoT double behaves like
 * `resolveSeed`: a caller seed is echoed verbatim; otherwise the seed is DERIVED from the graph's values (a stand-in
 * digest), so a value edit moves it — exactly today's C2 on the served funding pair (docs `d7c833b8`).
 *
 *   H1 (R-a) £59 → £60 on an option, inside a turn bound to the prior facts → PLoT receives Run A's own seed echo, and
 *      the pair classifies C1_attributable.
 *   H2 (R-d, identity) the same graph rerun → the same seed reaches PLoT (the result would be identical).
 *   H3 (R-c) a pinning change (an option newly sets a factor) → no seed sent → C2_unpaired, as today.
 *   H4 (control) no turn binding (a script / test double) → no seed, exactly today's behaviour.
 *   H5 (CR 5921519604) a prior added to a factor with no observed value → C2; H5c the same prior on both Runs → C1.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';

vi.mock('../../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, p) => String(p) }),
}));

import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { buildRunDelta } from '../../../coaching/build-run-delta.js';
import { priorRunForSeed } from '../../../coaching/seed-reuse.js';
import { NO_CLAIM, runWithBoundAnalysisSnapshot } from '../../../run-analysis-snapshot-binding.js';
import { createRunAnalysisHandler } from '../run-analysis.js';

type Rec = Record<string, any>;
const SCENARIO = 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4';
const served = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as { graph: Rec };
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as V2RunResponseEnvelope;

function invocation(turnId: string): HandlerInvocation {
  return {
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO,
      request_id: turnId, budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: turnId, scenario_id: SCENARIO, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: turnId, signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
}

function harness() {
  const graph = structuredClone(served.graph);
  graph.nodes.find((n: Rec) => n.id === 'keep_current_price')!.interventions = {
    pro_plan_price: { value: 0.245, raw_value: 49, unit: 'GBP/month', source: 'brief_extraction' },
  };
  const sentSeeds: unknown[] = [];
  const plotClient = {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
      sentSeeds.push(body.seed);
      const response = structuredClone(happy) as Rec;
      response.results = (body.options as Rec[]).map((o, index) => ({
        option_id: o.option_id, option_label: o.label,
        win_probability: [0.6, 0.4][index] ?? 0, percentile_p10: 0.1, percentile_p90: 0.9,
      }));
      response.fact_objects = [];
      response.review_cards = [];
      // PLoT `resolveSeed`: a caller seed wins, echoed as a string; else a digest of the graph's values.
      const derived = String(parseInt(createHash('sha256').update(JSON.stringify(body.graph)).digest('hex').slice(0, 7), 16));
      response.meta = { ...(response.meta as Rec), seed_used: body.seed !== undefined ? String(body.seed) : derived };
      // PLoT's canonical meta also records the ISL request it sent (`_meta.payloads.isl_request`). This double mirrors
      // only the draw-bearing shape: an observed factor → normal; a prior-only factor → uniform (PLoT's second pass).
      const g = body.graph as Rec;
      const uncertainties = (g.nodes as Rec[]).flatMap((n): Rec[] => {
        if (n.kind !== 'factor') return [];
        if (typeof n.observed_state?.value === 'number') return [{ node_id: n.id, distribution: 'normal', std: 0.05 }];
        if (n.prior && typeof n.prior.range_min === 'number') return [{ node_id: n.id, distribution: 'uniform', range_min: n.prior.range_min, range_max: n.prior.range_max }];
        return [];
      });
      response._meta = {
        builds: { plot: 'p1', isl: 'i1' },
        payloads: { isl_request: {
          seed: body.seed ?? 'derived', n_samples: 1000, analysis_types: ['comparison'],
          graph: { nodes: (g.nodes as Rec[]).map((n) => ({ id: n.id, kind: n.kind, epsilon_std: 0 })), edges: g.edges },
          options: (body.options as Rec[]).map((o) => ({ id: o.option_id ?? o.id, interventions: o.interventions ?? {} })),
          parameter_uncertainties: uncertainties,
        } },
      };
      return response as V2RunResponseEnvelope;
    }),
  } as unknown as PLoTClient;
  const handler = createRunAnalysisHandler({
    plotClient,
    scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(id, 'c1', createNoopSessionStore({ loadGraphResult: structuredClone(graph) })),
  });
  const facts: Rec[] = [];
  const run = async (turn: string, bound: boolean) => {
    const go = () => handler(invocation(turn));
    const result = bound
      ? await runWithBoundAnalysisSnapshot({ scenarioId: SCENARIO, analysisGraphHash: NO_CLAIM, priorRunSeed: priorRunForSeed(facts as never) }, go)
      : await go();
    const fact = result.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec | undefined;
    expect(fact, 'the handler commits one Run fact').toBeDefined();
    facts.push(fact!);
    return fact!;
  };
  const setPrice = (raw: number) => {
    graph.nodes.find((n: Rec) => n.id === 'raise_price_to_59')!.interventions.pro_plan_price = {
      ...graph.nodes.find((n: Rec) => n.id === 'raise_price_to_59')!.interventions.pro_plan_price, value: raw / 200, raw_value: raw,
    };
  };
  const caseOf = () => {
    const built = buildRunDelta({ priorFacts: facts as never, mayNameLeadingOption: true });
    expect(built.kind, JSON.stringify(built).slice(0, 300)).toBe('ok');
    return (built as { delta: Rec }).delta;
  };
  return { graph, sentSeeds, run, setPrice, caseOf };
}

describe('C1 at the handler — the prior Run lends its seed to a same-structure rerun', () => {
  it('H1 (R-a): £59 → £60 in a bound turn → PLoT receives Run A\'s own echo → C1_attributable', async () => {
    const h = harness();
    const a = await h.run('turn-a', true);
    const seedA = a.result.enrichment.meta.seed_used as string;
    expect(h.sentSeeds[0], 'Run A has no prior: PLoT derives its seed').toBeUndefined();
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    await h.run('turn-b', true);
    expect(h.sentSeeds[1], 'Run B sends Run A\'s seed echo, verbatim').toBe(seedA);
    const delta = h.caseOf();
    expect(delta.pair_provenance).toMatchObject({ seed_equal: true, hash_equal: false });
    expect(delta.attribution_case).toBe('C1_attributable');
  });

  it('H2 (R-d, identity): the same graph rerun → the same seed reaches PLoT', async () => {
    const h = harness();
    const a = await h.run('turn-a', true);
    await new Promise((r) => setTimeout(r, 5));
    await h.run('turn-b', true);
    expect(h.sentSeeds[1]).toBe(a.result.enrichment.meta.seed_used);
  });

  it('H3 (R-c): a pinning change (the status quo newly sets churn) → no seed sent → C2_unpaired, as today', async () => {
    const h = harness();
    await h.run('turn-a', true);
    await new Promise((r) => setTimeout(r, 5));
    h.graph.nodes.find((n: Rec) => n.id === 'keep_current_price')!.interventions.monthly_churn = { value: 0.03, raw_value: 3, unit: '%', source: 'user_override' };
    await h.run('turn-b', true);
    expect(h.sentSeeds[1], 'a draw-structure change lends no seed').toBeUndefined();
    expect(h.caseOf().attribution_case).toBe('C2_unpaired');
  });

  it('H5 (CR 5921519604): a prior added to a factor with no observed value → PLoT samples it → C2, never C1', async () => {
    const h = harness();
    const churn = h.graph.nodes.find((n: Rec) => n.id === 'monthly_churn')!;
    delete churn.observed_state;
    delete churn.prior;
    await h.run('turn-a', true);
    await new Promise((r) => setTimeout(r, 5));
    churn.prior = { distribution: 'uniform', range_min: 0.02, range_max: 0.04 };
    await h.run('turn-b', true);
    expect(h.caseOf().attribution_case, 'the recorded ISL requests differ by one uniform draw').toBe('C2_unpaired');
  });

  it('H5c (control): the same prior on both Runs and a £59 → £60 edit → C1', async () => {
    const h = harness();
    const churn = h.graph.nodes.find((n: Rec) => n.id === 'monthly_churn')!;
    delete churn.observed_state;
    churn.prior = { distribution: 'uniform', range_min: 0.02, range_max: 0.04 };
    await h.run('turn-a', true);
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    await h.run('turn-b', true);
    expect(h.caseOf().attribution_case).toBe('C1_attributable');
  });

  it('H4 (control): outside a bound turn nothing is lent — today\'s behaviour, and C2 on a value edit', async () => {
    const h = harness();
    await h.run('turn-a', false);
    await new Promise((r) => setTimeout(r, 5));
    h.setPrice(60);
    await h.run('turn-b', false);
    expect(h.sentSeeds).toEqual([undefined, undefined]);
    expect(h.caseOf().attribution_case).toBe('C2_unpaired');
  });
});
