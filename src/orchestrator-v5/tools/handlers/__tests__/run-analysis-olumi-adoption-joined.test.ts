import { legacyDoorGraph } from '../../../agent-lane/__tests__/licence-test-graphs.js';
/**
 * Approved Olumi option: the stored graph is the Run input and the next cold
 * analysis read selects the rerun. Only the external PLoT calculation is stubbed.
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
import { computeExpectedGraphCasHashes } from '../../../context/graph-cas-conflict.js';
import { applyOlumiOptionAdoption } from '../../../system-events/olumi-option-adoption.js';
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

describe('approved Olumi option joins Run, stored fact and cold read', () => {
  it('keeps the option and levels, makes the old Run stale, then reopens the rerun as current', async () => {
    // Science 393023 LICENCE (a)/(b), 7 Oct: std 0.125 → 0.1 on a clone preserves this independent claim; captured bytes stay unchanged.
    let graph = legacyDoorGraph(served.graph);
    // Supply the existing £49 baseline explicitly so two distinct user-side
    // comparisons survive; the unadopted £54 suggestion must then be left out.
    graph.nodes.find((n: Rec) => n.id === 'keep_current_price')!.interventions = {
      pro_plan_price: { value: 0.245, raw_value: 49, unit: 'GBP/month', source: 'brief_extraction' },
    };
    const facts: Rec[] = [];
    const plotBodies: Rec[] = [];
    const plotClient = {
      validatePatch: vi.fn().mockResolvedValue({}),
      run: vi.fn(async (body: Rec) => {
        plotBodies.push(structuredClone(body));
        const response = structuredClone(happy) as Rec;
        const options = body.options as Rec[];
        response.results = options.map((o, index) => ({
          option_id: o.option_id, option_label: o.label,
          win_probability: [0.5, 0.3, 0.2][index] ?? 0,
          percentile_p10: 0.1, percentile_p90: 0.9,
        }));
        response.fact_objects = [];
        response.review_cards = [];
        return response as V2RunResponseEnvelope;
      }),
    } as unknown as PLoTClient;
    const handler = createRunAnalysisHandler({
      plotClient,
      scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(
        id, 'adoption-rerun', createNoopSessionStore({ loadGraphResult: structuredClone(graph) }),
      ),
    });
    readRecent.mockResolvedValue([{ id: 'turn-before' }, { id: 'turn-after' }]);
    readAnalysisInvalidatedAt.mockResolvedValue(null);
    const seedRead = () => {
      readFactsFor.mockResolvedValue([...facts]);
      readFactsWithTurnFor.mockResolvedValue(facts.map((fact, i) => ({
        fact, fact_row_id: `row-${i}`, fact_created_at: fact.result.computed_at,
        turn_id: i === 0 ? 'turn-before' : 'turn-after',
      })));
      readScenarioRunAnalysisFactsFor.mockResolvedValue({
        facts: facts.map((fact, i) => ({ fact, fact_row_id: `row-${i}`,
          fact_created_at: fact.result.computed_at })), total_count: facts.length,
      });
    };
    const run = async (turn: string) => {
      const result = await handler(invocation(turn));
      const fact = result.handler_facts.find((f) => f.fact_type === 'run_analysis');
      expect(fact, 'the handler commits one Run fact').toBeDefined();
      facts.push(fact as Rec);
      seedRead();
      return fact as Rec;
    };
    const read = () => readScenarioAnalysis({ scenarioId: SCENARIO,
      graph: structuredClone(graph), requestId: 'cold-reload' });

    const first = await run('turn-before');
    expect((plotBodies[0]!.options as Rec[]).map((o) => o.option_id))
      .toEqual(['keep_current_price', 'raise_price_to_59']);
    const firstRead = await read();
    expect(firstRead.analysis_state?.run_state.kind).toBe('complete_current');
    // ⭐ 52f8cd (DL 5924731600): the Run RECORDS the Olumi option it left out, and the cold read carries that record —
    // without it the UI said "The analysis returned no result for this option" (served dafdc620).
    const leftOut = [{ option_id: 'raise_price_to_54', state: 'excluded_olumi_proposed' }];
    expect(first.result.option_participation).toEqual(leftOut);
    expect(firstRead.analysis_option_participation).toEqual(leftOut);
    const option = graph.nodes.find((n: Rec) => n.id === 'raise_price_to_54')!;
    const hashes = computeExpectedGraphCasHashes(graph);
    const adoption = applyOlumiOptionAdoption(graph, {
      option_id: option.id, expected_label: option.label,
      expected_interventions: option.interventions,
      base_graph_hash: hashes.expectedGraphAnalysisHash!,
      expected_graph_identity_hash: hashes.expectedGraphIdentityHash!,
    });
    expect(adoption.kind, JSON.stringify(adoption)).toBe('mutated');
    if (adoption.kind !== 'mutated') return;
    graph = adoption.graph;
    const stale = await read();
    expect(stale.analysis_state?.run_state.kind).toBe('complete_stale');
    expect(stale.analysis_result).toBeNull();

    const second = await run('turn-after');
    expect(second.result.graph_hash_at_run).not.toBe(first.result.graph_hash_at_run);
    const sent = plotBodies.at(-1)!;
    expect((sent.options as Rec[]).map((o) => o.option_id))
      .toEqual(['keep_current_price', 'raise_price_to_59', 'raise_price_to_54']);
    const sentOption = (sent.options as Rec[]).find((o) => o.option_id === option.id);
    // The Run's production egress converts the stored raw £54 carrier to the
    // numeric level PLoT accepts. The canonical node still owns source/intent.
    expect(sentOption).toMatchObject({ option_id: option.id,
      interventions: { pro_plan_price: 54 } });
    expect(graph.nodes.find((n: Rec) => n.id === option.id)).toMatchObject({
      proposed_by: 'olumi', analysis_participation: 'included',
      interventions: option.interventions,
    });
    const reopened = await read();
    expect(reopened.analysis_state?.run_state.kind).toBe('complete_current');
    // CONTROL: once adopted the option is IN the comparison, so the rerun RECORDS nothing left out — `[]`, never absent
    // (schemas 0.65: absent = an older Run, not recorded; CODEX 5924967500) — and the read carries that `[]`.
    expect(second.result.option_participation).toEqual([]);
    expect(reopened.analysis_option_participation).toEqual([]);
    expect(reopened.analysis_result).toMatchObject({
      computed_against_hash: second.result.graph_hash_at_run,
      leading_option_id: null,
      enrichment: {
        // The goal holds the brief's 12 months and no limit is a duration, so the Run also carries A7 as its typed
        // warning (`decision-input-ask.ts` `untestedHorizonLine`), and the COLD READ returns it: the stored fact keeps it.
        inference_warnings: [
          { code: 'GOAL_FIGURES_PRODUCT_NOT_READ' },
          { code: 'GOAL_HORIZON_NOT_TESTED', severity: 'info',
            message: 'This chance uses the model\'s numbers as they are today; the model doesn\'t project how they change over time yet, so it can\'t say whether you\'ll reach £85,000 within 12 months.' },
        ],
      },
    });
    expect((reopened.analysis_result as Rec).win_probabilities).toBeUndefined();
    expect((reopened.analysis_result as Rec).enrichment.results.map((r: Rec) => r.option_id))
      .toContain(option.id);
    expect(first.result.graph_hash_at_run).not.toBe(second.result.graph_hash_at_run);
  });
});

it('Science 393023: the unchanged served adoption seed has two newly unsized links', async () => {
  const { isPlaceholderLink } = await import('../../../../cee/magnitude/link-sizing.js');
  expect(served.graph.edges.filter((e: Rec) => isPlaceholderLink(e)).map((e: Rec) => `${e.from}->${e.to}`).sort()).toEqual(['monthly_churn->paying_subscribers', 'pro_plan_price->mrr']);
});
