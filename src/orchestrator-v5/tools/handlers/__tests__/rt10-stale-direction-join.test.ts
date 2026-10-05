/**
 * RT-10 stale-on-read JOIN (red-team #87 5996221302, DL spec): a Run the model now reads upside down is not served as
 * current. Real Run handler → real SC-24 snapshot writer → real cold read (`readScenarioAnalysis`), on the verbatim
 * GRAPH_READY graph of the red team's pre-fix B2 build ("monthly churn below 2%", staging 91656b1b; no top-level
 * goal_node_id, exactly as persisted). PLoT is the golden envelope.
 *
 *   J1  a Run that sent NO direction (the pre-#2585 resolver, measured `undefined` on this graph at 03f0d5a3f) reads
 *       STALE on the cold read once the resolver sends `minimise` — same graph, same hash, no writes;
 *   J2  the rerun sends `minimise`, records it, and reads CURRENT (binds to the resolved direction);
 *   J3  CONTRAST: a held floor sends nothing then and now and stays CURRENT.
 *
 * The pre-fix leg is the ONLY mock of the resolver: it returns what the served resolver returned before #2585.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';

const SCENARIO = 'e8c3f36f-1c2d-4e5f-8a9b-0c1d2e3f4a5b';
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
const leg = vi.hoisted(() => ({ preFix: false }));
vi.mock('../../../goal-target/goal-direction.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../goal-target/goal-direction.js')>();
  return { ...real, resolveGoalDirection: (...args: Parameters<typeof real.resolveGoalDirection>) =>
    leg.preFix ? undefined : real.resolveGoalDirection(...args) };
});

import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { readScenarioAnalysis } from '../../../../routes/scenario-graph-analysis-read.js';
import { createRunAnalysisHandler } from '../run-analysis.js';

type Rec = Record<string, any>;
const served = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/served-rt10-churn-below-2pct.json',
  import.meta.url), 'utf8')) as { captures: Record<string, { graph: Rec }> };
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

function harness(graph: Rec) {
  const facts: Rec[] = [];
  const sent: Rec[] = [];
  const plotClient = {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
      sent.push(structuredClone(body));
      const response = structuredClone(happy) as Rec;
      response.results = (body.options as Rec[]).map((o, index) => ({
        option_id: o.option_id, option_label: o.label,
        win_probability: [0.5, 0.3, 0.2][index] ?? 0, percentile_p10: 0.1, percentile_p90: 0.9,
      }));
      response.fact_objects = [];
      response.review_cards = [];
      return response as V2RunResponseEnvelope;
    }),
  } as unknown as PLoTClient;
  const handler = createRunAnalysisHandler({
    plotClient,
    scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(id, 'rt10', createNoopSessionStore({ loadGraphResult: structuredClone(graph) })),
  });
  readRecent.mockResolvedValue([{ id: 'turn-a' }, { id: 'turn-b' }]);
  readAnalysisInvalidatedAt.mockResolvedValue(null);
  const seedRead = () => {
    readFactsFor.mockResolvedValue([...facts].reverse());
    readFactsWithTurnFor.mockResolvedValue([...facts].reverse().map((fact, i) => ({ fact, fact_row_id: `row-${i}`, fact_created_at: fact.result.computed_at, turn_id: `turn-${i}` })));
    readScenarioRunAnalysisFactsFor.mockResolvedValue({ facts: [...facts].reverse().map((fact, i) => ({ fact, fact_row_id: `row-${i}`, fact_created_at: fact.result.computed_at })), total_count: facts.length });
  };
  const run = async (turn: string, preFix: boolean) => {
    leg.preFix = preFix;
    try {
      const result = await handler(invocation(turn));
      const fact = result.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec | undefined;
      expect(fact, 'the handler commits one Run fact').toBeDefined();
      facts.push(fact!); seedRead(); return fact!;
    } finally { leg.preFix = false; }
  };
  const cold = () => readScenarioAnalysis({ scenarioId: SCENARIO, graph: structuredClone(graph), requestId: 'cold' }) as Promise<Rec>;
  return { run, cold, sent };
}

const churn = (): Rec => structuredClone(served.captures.staging_91656b1b!.graph);

describe('RT-10 — a saved Run the model now reads upside down is not served as current (cold read)', () => {
  it('J1 + J2: the pre-fix Run reads stale with no writes; the rerun sends minimise and reads current', async () => {
    const graph = churn();
    expect(graph).not.toHaveProperty('goal_node_id');
    const { run, cold, sent } = harness(graph);

    const preFix = await run('turn-a', true);
    expect(sent[0]).not.toHaveProperty('goal_direction');
    expect(preFix.result.input_snapshot.goal).toMatchObject({ node_id: 'monthly_churn', operator: '<', frame: 'level' });
    expect(preFix.result.input_snapshot.goal).not.toHaveProperty('direction');

    const stale = await cold();
    expect(stale.analysis_state?.run_state.kind).toBe('complete_stale');
    expect(stale.current_read).toMatchObject({ computed_against_hash: preFix.result.graph_hash_at_run,
      current_analysis_hash: preFix.result.graph_hash_at_run, result: null, figures: [] });
    expect(stale.current_read.analysis_ready).toMatchObject({ freshness: 'stale',
      freshness_reason: 'which way counts as better for your goal changed' });

    await new Promise((r) => setTimeout(r, 5));
    const rerun = await run('turn-b', false);
    expect(sent[1]).toMatchObject({ goal_direction: 'minimise' });
    expect(rerun.result.input_snapshot.goal).toMatchObject({ node_id: 'monthly_churn', direction: 'minimise' });
    expect(rerun.result.graph_hash_at_run, 'the hash cannot see the direction on this graph')
      .toBe(preFix.result.graph_hash_at_run);

    const current = await cold();
    expect(current.analysis_state?.run_state.kind).toBe('complete_current');
    expect(current.current_read.result).not.toBeNull();
  });

  it('J3 CONTRAST: a held floor sends nothing then and now, and stays current', async () => {
    const graph = churn();
    graph.nodes.find((n: Rec) => n.id === 'monthly_churn')!.goal_direction = '>=';
    const { run, cold, sent } = harness(graph);
    const floorRun = await run('turn-a', false);
    expect(sent[0]).not.toHaveProperty('goal_direction');
    expect(floorRun.result.input_snapshot.goal).not.toHaveProperty('direction');
    const read = await cold();
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
  });

  // Codex r1 (#2596) negative/control pair, through the REAL loader (GraphV3 parse) and snapshot writer: the read must
  // resolve the goal as the Run's loader validated it, so a malformed reading the stored graph keeps is never "changed".
  it.each([
    ['NEGATIVE: a malformed Olumi reading (no words) — the Run sends nothing', undefined, false],
    ['CONTROL: a valid Olumi reading — the Run sends minimise', 'Olumi reads “cut by 20%” as lower is better.', true],
  ] as const)('J4 %s, and the cold read stays current', async (_name, words, sendsMinimise) => {
    const graph = churn();
    const goal = graph.nodes.find((n: Rec) => n.id === 'monthly_churn')!;
    delete goal.goal_direction;
    delete goal.goal_threshold_unit;
    Object.assign(goal, { label: 'Cloud costs', goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2,
      goal_threshold: -0.2, goal_sense_reading: { sense: 'minimise', basis: 'typed_change_sign', threshold: -0.2,
        threshold_frame: 'change_rel', ...(words === undefined ? {} : { words }) } });
    const { run, cold, sent } = harness(graph);
    const saved = await run('turn-a', false);
    if (sendsMinimise) {
      expect(sent[0]).toMatchObject({ goal_direction: 'minimise' });
      expect(saved.result.input_snapshot.goal).toMatchObject({ direction: 'minimise' });
    } else {
      expect(sent[0]).not.toHaveProperty('goal_direction');
      expect(saved.result.input_snapshot.goal).not.toHaveProperty('direction');
    }
    const read = await cold();
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
  });

  it('J5 B′: after an approved card ceiling (held <= + its goal row, no target figure) the Run sends minimise and reads current', async () => {
    const graph = churn();
    const goal = graph.nodes.find((n: Rec) => n.id === 'monthly_churn')!;
    for (const k of ['goal_threshold', 'goal_threshold_raw', 'goal_threshold_frame', 'goal_threshold_unit', 'goal_threshold_cap',
      'goal_threshold_cap_provenance']) delete goal[k];
    goal.goal_direction = '<=';
    graph.goal_constraints = [{ constraint_id: 'gc-card-1', node_id: 'monthly_churn', operator: '<=', value: 2, unit: '%',
      label: 'Monthly churn', provenance: 'explicit' }];
    const { run, cold, sent } = harness(graph);
    const saved = await run('turn-a', false);
    expect(sent[0]).toMatchObject({ goal_direction: 'minimise' });
    expect(saved.result.input_snapshot.goal).toMatchObject({ direction: 'minimise' });
    const read = await cold();
    expect(read.analysis_state?.run_state.kind).toBe('complete_current');
  });
});
