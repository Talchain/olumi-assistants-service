/**
 * SC-24 JOINED (CEE half): Run A at £59 → the option is edited to £60 → Run B → the pair's `run_delta` carries the
 * exact input row, and a COLD READ serves the same pair and rows (no second stored comparison).
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
import { linkSizing } from '../../../../cee/magnitude/link-sizing.js';

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

describe('SC-24 · Run A → £59 → £60 → Run B → the delta and the cold read carry the exact input change', () => {
  it('writes run_id + input_snapshot on each Run, and the reload serves the same pair', async () => {
    const graph = structuredClone(served.graph);
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
      scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(
        id, 'sc24', createNoopSessionStore({ loadGraphResult: structuredClone(graph) }),
      ),
    });
    readRecent.mockResolvedValue([{ id: 'turn-a' }, { id: 'turn-b' }]);
    readAnalysisInvalidatedAt.mockResolvedValue(null);
    const seedRead = () => {
      readFactsFor.mockResolvedValue([...facts]);
      readFactsWithTurnFor.mockResolvedValue(facts.map((fact, i) => ({
        fact, fact_row_id: `row-${i}`, fact_created_at: fact.result.computed_at, turn_id: i === 0 ? 'turn-a' : 'turn-b',
      })));
      readScenarioRunAnalysisFactsFor.mockResolvedValue({
        facts: facts.map((fact, i) => ({ fact, fact_row_id: `row-${i}`, fact_created_at: fact.result.computed_at })),
        total_count: facts.length,
      });
    };
    const run = async (turn: string) => {
      const result = await handler(invocation(turn));
      const fact = result.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec | undefined;
      expect(fact, 'the handler commits one Run fact').toBeDefined();
      facts.push(fact!);
      seedRead();
      return fact!;
    };

    const a = await run('turn-a');
    await new Promise((r) => setTimeout(r, 5));
    // The user's edit: "Raise to £59" becomes £60 (the stored raw carrier, as the option edit writes it).
    graph.nodes.find((n: Rec) => n.id === 'raise_price_to_59')!.interventions.pro_plan_price = {
      ...graph.nodes.find((n: Rec) => n.id === 'raise_price_to_59')!.interventions.pro_plan_price,
      value: 0.3, raw_value: 60,
    };
    const b = await run('turn-b');

    // ── the writer: each Run records its execution identity and what it was SENT ──
    expect(a.result.run_id).toMatch(/^[0-9a-f]{64}$/);
    expect(b.result.run_id).not.toBe(a.result.run_id);
    expect(b.result.input_snapshot.goal).toEqual({
      node_id: 'mrr', label: expect.any(String), target_raw: 85000, unit: 'GBP/month', operator: '>', frame: 'level',
    });

    // ── 0.70.0 (R3 DEFECT 3): each sent link also carries its band and WHO SIZED it, read through the real handler
    //    from the graph the Run was built from (`persistedEdges`), never from the wire ──
    const sentLinks = b.result.input_snapshot.links as Rec[];
    expect(sentLinks.length, 'precondition: the Run sent links').toBeGreaterThan(0);
    for (const l of sentLinks) {
      expect(l.band).toMatch(/^(slight|moderate|strong|very_strong)$/);
      const persistedPair = (graph.edges as Rec[]).filter((e) => e.from === l.from && e.to === l.to);
      if (persistedPair.length === 1) expect(l.sizing, `${l.from}->${l.to}`).toBe(linkSizing(persistedPair[0]));
    }
    expect(sentLinks.filter((l) => l.sizing !== undefined).length, 'positive control: sizing recorded through the handler').toBeGreaterThan(0);

    // ── the producer: the pair's exact input change ──
    const turnDelta = buildRunDelta({ priorFacts: [...facts] as never, mayNameLeadingOption: true });
    expect(turnDelta.kind).toBe('ok');
    if (turnDelta.kind !== 'ok') return;
    expect(turnDelta.delta.endpoints).toEqual({
      prior: { run_id: a.result.run_id, computed_at: a.result.computed_at },
      current: { run_id: b.result.run_id, computed_at: b.result.computed_at },
    });
    expect(turnDelta.delta.input_coverage).toBe('complete');
    expect(turnDelta.delta.input_changes).toEqual([expect.objectContaining({
      entity_kind: 'option_setting', entity_id: 'pro_plan_price', option_id: 'raise_price_to_59', field: 'value',
      before: { raw: 59, unit: 'GBP/month' }, after: { raw: 60, unit: 'GBP/month' }, change: 'changed',
    })]);

    // ── the cold reload: the same pair and rows, from the one producer ──
    const reload = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: structuredClone(graph), requestId: 'cold-reload' });
    expect(reload.analysis_state?.run_state.kind).toBe('complete_current');
    // CURRENT-READ-v1 row 1: the comparison rides inside `current_read`, under its currentness gate — never top-level.
    expect((reload as Rec2).run_delta, 'no top-level run_delta on the read').toBeUndefined();
    const d = (reload as Rec2).current_read.run_delta;
    expect(d, 'the reload serves current_read.run_delta').toBeDefined();
    // P0 PARTNER open 1: the facts reach this read OLDEST-first (A then B). The displayed Run and the pair's newer end
    // come from ONE ordering (`orderSuccessfulRunAnalysisFactsNewestFirst`), so the delta is always the displayed Run's.
    expect(facts[0]).toBe(a);
    expect(d.endpoints.current.run_id).toBe(b.result.run_id);
    expect((reload as Rec2).current_read.computed_against_hash).toBe(b.result.graph_hash_at_run);
    expect({ c: d.attribution_case, e: d.endpoints, cov: d.input_coverage, rows: d.input_changes }).toEqual({
      c: turnDelta.delta.attribution_case, e: turnDelta.delta.endpoints,
      cov: turnDelta.delta.input_coverage, rows: turnDelta.delta.input_changes,
    });
  });
});
