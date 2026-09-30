/**
 * SC-24 × #2377 JOIN (AIQ 5916128618): the Run-attested goal unit (`input_snapshot.goal.unit`, #2378) is what #2377's
 * currentness gate reads. On the joined head:
 *   J1  a Run read back at once is CURRENT and carries its pair (no false goal_unit_changed from the producer's bytes);
 *   J2  the goal's unit edited after Run B → stale goal_unit_changed → NO run_delta on the cold read (as on the turn);
 *   J3  a goal with no unit on either side stays current.
 * Real handler, real snapshot loader, the served c96fc4bb graph (Paul's MRR journey); PLoT is the golden envelope.
 * Design SC-24 v2 (#84 5914416431); goal unit carrier P0 SHARED DATA 5914750268.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';

const SCENARIO = 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4';
const readRecent = vi.fn();
const readFactsFor = vi.fn();
const readFactsWithTurnFor = vi.fn();
const readScenarioRunAnalysisFactsFor = vi.fn();
const readAnalysisInvalidatedAt = vi.fn();
vi.mock('../../../session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../session/index.js')>()),
  getSessionStore: () => ({ readRecent, readFactsFor, readFactsWithTurnFor,
    readScenarioRunAnalysisFactsFor, readAnalysisInvalidatedAt }),
}));
vi.mock('../../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, p) => String(p) }),
}));

import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { buildRunDelta } from '../../../coaching/build-run-delta.js';
import { readScenarioAnalysis } from '../../../../routes/scenario-graph-analysis-read.js';
import { createRunAnalysisHandler } from '../run-analysis.js';

type Rec = Record<string, any>;
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
    payload: makeMessagePayload({ turn_id: turnId, scenario_id: SCENARIO,
      message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: turnId, signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation;
}

type Rec2 = Record<string, any>;

type Rec2 = Record<string, any>;

async function twoRuns(goalUnit: string | null) {
  const graph = structuredClone(served.graph);
  const goal = graph.nodes.find((n: Rec) => n.id === 'mrr')!;
  if (goalUnit === null) delete goal.goal_threshold_unit; else goal.goal_threshold_unit = goalUnit;
  graph.nodes.find((n: Rec) => n.id === 'keep_current_price')!.interventions = {
    pro_plan_price: { value: 0.245, raw_value: 49, unit: 'GBP/month', source: 'brief_extraction' },
  };
  const facts: Rec[] = [];
  const plotClient = {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
      const response = structuredClone(happy) as Rec;
      response.results = (body.options as Rec[]).map((o, index) => ({
        option_id: o.option_id, option_label: o.label,
        win_probability: [0.6, 0.4][index] ?? 0, percentile_p10: 0.1, percentile_p90: 0.9,
      }));
      response.fact_objects = [];
      response.review_cards = [];
      return response as V2RunResponseEnvelope;
    }),
  } as unknown as PLoTClient;
  const handler = createRunAnalysisHandler({
    plotClient,
    scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(id, 'sc24', createNoopSessionStore({ loadGraphResult: structuredClone(graph) })),
  });
  readRecent.mockResolvedValue([{ id: 'turn-a' }, { id: 'turn-b' }]);
  readAnalysisInvalidatedAt.mockResolvedValue(null);
  const seedRead = () => {
    readFactsFor.mockResolvedValue([...facts]);
    readFactsWithTurnFor.mockResolvedValue(facts.map((fact, i) => ({ fact, fact_row_id: `row-${i}`, fact_created_at: fact.result.computed_at, turn_id: i === 0 ? 'turn-a' : 'turn-b' })));
    readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: facts.map((fact, i) => ({ fact, fact_row_id: `row-${i}`, fact_created_at: fact.result.computed_at })), total_count: facts.length });
  };
  const run = async (turn: string) => {
    const result = await handler(invocation(turn));
    const fact = result.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec | undefined;
    expect(fact, 'the handler commits one Run fact').toBeDefined();
    facts.push(fact!); seedRead(); return fact!;
  };
  await run('turn-a');
  await new Promise((r) => setTimeout(r, 5));
  const opt = graph.nodes.find((n: Rec) => n.id === 'raise_price_to_59')!;
  opt.interventions.pro_plan_price = { ...opt.interventions.pro_plan_price, value: 0.3, raw_value: 60 };
  const b = await run('turn-b');
  return { graph, b };
}
const cold = (graph: Rec) => readScenarioAnalysis({ scenarioId: SCENARIO, graph: structuredClone(graph), requestId: 'cold' }) as Promise<Rec2>;

describe('SC-24 × #2377 — the Run-attested goal unit and the cold read', () => {
  it('J1: a Run read back at once is current and carries its pair (the producer\'s unit bytes match the graph\'s)', async () => {
    const { graph, b } = await twoRuns('GBP/month');
    expect(b.result.input_snapshot.goal.unit).toBe('GBP/month');
    const read = await cold(graph);
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
    expect(read.current_read?.run_delta, 'control: the pair rides when the unit agrees').toBeDefined();
    expect(read.run_delta, 'never top-level (CURRENT-READ-v1 row 1)').toBeUndefined();
  });

  it('J2: the goal unit edited after Run B → stale (goal_unit_changed) and NO run_delta on the cold read', async () => {
    const { graph } = await twoRuns('GBP/month');
    graph.nodes.find((n: Rec) => n.id === 'mrr')!.goal_threshold_unit = 'USD/month';
    const read = await cold(graph);
    expect(read.analysis_state?.run_state.kind).not.toBe('complete_current');
    expect(read.current_read?.run_delta).toBeUndefined();
    expect(read.run_delta).toBeUndefined();
  });

  it('J3: a goal with no unit on either side stays current (absent never becomes GBP)', async () => {
    const { graph, b } = await twoRuns(null);
    expect(b.result.input_snapshot.goal).not.toHaveProperty('unit');
    const read = await cold(graph);
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
    expect(read.current_read?.run_delta).toBeDefined();
  });
});
