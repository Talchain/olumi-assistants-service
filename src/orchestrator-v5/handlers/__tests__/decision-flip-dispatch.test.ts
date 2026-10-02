/**
 * SCIENCE ROBUSTNESS (EXPERIMENT; #85 lease 5950283606): "What would change this?" asks about THE Run the user saw,
 * through the ONE Run payload builder, and persists nothing.
 *
 * Real `run_analysis` handler, real snapshot loader, the served c96fc4bb graph (Paul's MRR journey) — the harness of
 * `tools/handlers/__tests__/run-analysis-c1-seed-reuse.test.ts`. Run A is produced by the production registry (no
 * probe); the dispatch then re-derives the payload with the probe and must:
 *   F1 send PLoT exactly Run A's request (+ Run A's seed echo, + decision_flip, − brief), never call `run`, measured;
 *   F2 call a model edited since Run A `stale`, never asking PLoT;
 *   F3 with no Run, `no_run`; F4 a PLoT timeout → unavailable; F5 a block answering other links → unavailable.
 * The decision-flip block is REAL ISL output (ISL #220, D1) with its link ids re-pointed at the asked links.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';

vi.mock('../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, p) => String(p) }),
}));
const turnContext = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildTurnContext: vi.fn(async () => turnContext.current),
}));

import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { priorRunForSeed } from '../../coaching/seed-reuse.js';
import { NO_CLAIM, runWithBoundAnalysisSnapshot } from '../../run-analysis-snapshot-binding.js';
import { createRegistry, resolveHandler } from '../../tools/registry.js';
import { dispatchDecisionFlip, selectFlipLinks, type FlipLinkRef } from '../decision-flip-dispatch.js';

type Rec = Record<string, any>;
const SCENARIO = 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4';
const served = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as { graph: Rec };
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as V2RunResponseEnvelope;
const ISL_D1_BLOCK = {"method":"affine_crn_replicates_v1","leader_option_id":"ai_reporting_module_sprint","replicates":4,"bound_abs":0.01,"bound_rel":0.15,"grid_step":0.0025,"links":[{"from_id":"sprint_capacity_for_ai_reporting","to_id":"ai_reporting_module_availability","status":"quoted","reason":null,"current_mean":0.25,"threshold":0.0625,"replicate_thresholds":[0.06125,0.06375,0.06125,0.06625],"replicate_range":0.0050000000000000044,"to_option_id":"integration_bug_fix_sprint"},{"from_id":"ai_reporting_module_availability","to_id":"enterprise_prospect_signing_likelihood","status":"absent","reason":"replicates_spread","current_mean":0.6,"threshold":null,"replicate_thresholds":[0.14125000000000001,0.15125,0.15624999999999997,0.15874999999999997],"replicate_range":0.01749999999999996,"to_option_id":null},{"from_id":"enterprise_prospect_signing_likelihood","to_id":"quarterly_revenue","status":"quoted","reason":null,"current_mean":0.5,"threshold":0.08875000000000002,"replicate_thresholds":[0.08625000000000002,0.09125000000000003,0.08875000000000002,0.08875000000000002],"replicate_range":0.0050000000000000044,"to_option_id":"integration_bug_fix_sprint"}]};
const PATH: FlipLinkRef[] = [
  { from_id: 'pro_plan_price', to_id: 'monthly_churn' },
  { from_id: 'monthly_churn', to_id: 'paying_subscribers' },
  { from_id: 'paying_subscribers', to_id: 'mrr' },
];

function context(turnId: string, priorFacts: Rec[]) {
  return {
    stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
    messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO,
    request_id: turnId, budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
    prior_turns: [], prior_facts: priorFacts, scenarioBriefText: null, persistedGraph: null,
  };
}
const payloadOf = (turnId: string) =>
  makeMessagePayload({ turn_id: turnId, scenario_id: SCENARIO, message: 'what would change this?', turn_class: 'decide', stage: 'analyse' });

/** The PLoT double of the C1 harness: a caller seed is echoed; else a digest of the graph; a draw-structure key. */
function plotDouble(flip: (body: Rec) => unknown) {
  const runBodies: Rec[] = [];
  const flipBodies: Rec[] = [];
  const client = {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
      runBodies.push(structuredClone(body));
      const response = structuredClone(happy) as Rec;
      response.results = (body.options as Rec[]).map((o, index) => ({
        option_id: o.option_id, option_label: o.label, win_probability: [0.5, 0.3, 0.2][index] ?? 0, percentile_p10: 0.1, percentile_p90: 0.9,
      }));
      response.fact_objects = [];
      response.review_cards = [];
      const derived = String(parseInt(createHash('sha256').update(JSON.stringify(body.graph)).digest('hex').slice(0, 7), 16));
      response.meta = { ...(response.meta as Rec), seed_used: body.seed !== undefined ? String(body.seed) : derived };
      const g = body.graph as Rec;
      const drawShape = {
        nodes: (g.nodes as Rec[]).map((n) => `${n.id}|${n.kind}`),
        edges: (g.edges as Rec[]).map((e) => `${e.from}->${e.to}`),
        options: (body.options as Rec[]).map((o) => `${o.option_id ?? o.id}|${Object.keys(o.interventions ?? {}).sort().join(',')}`),
      };
      response._meta = { builds: { plot: 'p1', isl: 'i1' }, evidence: { isl_draw_structure_key: createHash('sha256').update(JSON.stringify(drawShape)).digest('hex') } };
      return response as V2RunResponseEnvelope;
    }),
    decisionFlip: vi.fn(async (body: Rec) => {
      flipBodies.push(structuredClone(body));
      return flip(body);
    }),
  } as unknown as PLoTClient;
  return { client, runBodies, flipBodies };
}

/** ISL's real D1 block, re-pointed at the links asked (values untouched: they still pass the strict parse). */
const blockFor = (links: FlipLinkRef[]) => ({
  ...ISL_D1_BLOCK,
  links: links.map((l, i) => ({ ...ISL_D1_BLOCK.links[i % ISL_D1_BLOCK.links.length], from_id: l.from_id, to_id: l.to_id })),
});

async function harness(flip: (body: Rec) => unknown = (b) => ({ ok: true, block: blockFor(b.decision_flip.links) })) {
  const graph = structuredClone(served.graph);
  const reader = () => loadScenarioSnapshotForRunAnalysis(SCENARIO, 'flip', createNoopSessionStore({ loadGraphResult: structuredClone(graph) }));
  const plot = plotDouble(flip);
  // Run A through the PRODUCTION registry shape (no probe).
  const handler = resolveHandler(createRegistry({ plotClient: plot.client, scenarioReader: reader, counterfactualClient: null }), 'run_analysis')!;
  const a = await runWithBoundAnalysisSnapshot({ scenarioId: SCENARIO, analysisGraphHash: NO_CLAIM, priorRunSeed: priorRunForSeed([]) },
    () => handler({ context: context('turn-a', []), payload: payloadOf('turn-a'), requestId: 'turn-a', signal: new AbortController().signal, orientationText: '' } as unknown as HandlerInvocation));
  const runA = a.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec;
  expect(runA, 'Run A commits one Run fact').toBeDefined();
  const ask = (priorFacts: Rec[]) => {
    turnContext.current = context('turn-q', priorFacts);
    return dispatchDecisionFlip({ payload: payloadOf('turn-q'), requestId: 'turn-q', candidateLinks: PATH, plotClient: plot.client, scenarioReader: reader });
  };
  return { graph, plot, runA, ask };
}

describe('dispatchDecisionFlip — the Run the user saw, one builder, nothing persisted', () => {
  it('F1: PLoT gets exactly Run A\'s request (+ its seed echo, + decision_flip) and no Run happens', async () => {
    const h = await harness();
    expect(h.plot.runBodies).toHaveLength(1);
    expect(h.plot.runBodies[0].seed, 'Run A had no prior: PLoT derived its seed').toBeUndefined();
    const out = await h.ask([h.runA]);
    expect(out.status, JSON.stringify(out).slice(0, 200)).toBe('measured');
    expect(h.plot.runBodies, 'the dispatch never asks PLoT for a Run').toHaveLength(1);
    const { decision_flip, seed, request_id: _r, ...rest } = h.plot.flipBodies[0];
    const { request_id: _ra, brief: _b, ...runA } = h.plot.runBodies[0];
    expect(rest).toEqual(runA); // the same request, by the one builder
    expect(seed).toBe(h.runA.result.enrichment.meta.seed_used); // Run A's own draws
    expect(decision_flip.replicates).toBe(4);
    expect(decision_flip.links.length).toBeLessThanOrEqual(2);
    expect(h.plot.flipBodies[0]).not.toHaveProperty('brief');
  });

  it('F2: a model edited since Run A is stale — PLoT is never asked', async () => {
    const h = await harness();
    const price = h.graph.nodes.find((n: Rec) => n.id === 'raise_price_to_59')!.interventions.pro_plan_price;
    price.value = 0.3; price.raw_value = 60;
    const out = await h.ask([h.runA]);
    expect(out).toEqual({ status: 'stale' });
    expect(h.plot.flipBodies).toHaveLength(0);
  });

  it('F3: with no Run there is nothing to ask about', async () => {
    const h = await harness();
    expect(await h.ask([])).toEqual({ status: 'no_run' });
    expect(h.plot.flipBodies).toHaveLength(0);
  });

  it('F4: a PLoT timeout is unavailable (RC\'s honest limit), never a throw', async () => {
    const h = await harness(() => ({ ok: false, reason: 'timeout' }));
    expect(await h.ask([h.runA])).toEqual({ status: 'unavailable', reason: 'timeout' });
  });

  it('F5: a block answering other links is unavailable, never attributed', async () => {
    const h = await harness(() => ({ ok: true, block: blockFor([{ from_id: 'monthly_gross_additions', to_id: 'paying_subscribers' }]) }));
    expect(await h.ask([h.runA])).toEqual({ status: 'unavailable', reason: 'block_links_mismatch' });
  });
});

describe('selectFlipLinks — the plan\'s path, fragile first, at most two', () => {
  const fragile = (rows: Rec[]) => ({ robustness: { fragile_edges: rows } });
  it('orders by the Run\'s fragile_edges priority, then path order, capped at 2', () => {
    const e = fragile([{ from_id: 'paying_subscribers', to_id: 'mrr', switch_probability: 0.2 }, { from_id: 'x', to_id: 'y', switch_probability: 0.9 }]);
    expect(selectFlipLinks(PATH, e)).toEqual([PATH[2], PATH[0]]);
  });
  it('a fragile edge off the path never enters; no candidates → none', () => {
    expect(selectFlipLinks([], fragile([{ from_id: 'x', to_id: 'y', switch_probability: 0.9 }]))).toEqual([]);
    expect(selectFlipLinks(PATH, undefined)).toEqual([PATH[0], PATH[1]]);
  });
});
