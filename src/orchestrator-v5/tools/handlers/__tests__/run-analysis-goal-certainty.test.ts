/**
 * 0.63.0 at the ONE call site (DL 5883197828; Runtime amendment 5883189956): the real `run_analysis` handler writes the
 * Run's own `goal_certainty` beside `graph_hash_at_run`, from the STORED graph that hash binds and the Run's own PLoT
 * body, and the fact still parses under `RunAnalysisResultSchema`.
 *
 * Paul's 17d1cd3a, end to end in process (the B5 fixture): his exported graph through the REAL loader and the REAL
 * handler; the PLoT client returns MG's executed replay of this exact body. On that Run every option scored P(goal) = 0,
 * so each claims a certainty and the producer must decide whether it is earned.
 *
 * A producer defect costs the FIELD, never the Run: a throw or an output the published contract refuses leaves
 * `goal_certainty` absent (= not recorded) and the Run fact otherwise whole.
 * Mutant (run by hand): drop the `goal_certainty` spread in `run-analysis.ts` → rows 1 and 2 go RED.
 *
 * Rung: TESTED (an in-process handler witness). It is not a wire witness and not a journey witness.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { log } from '../../../../utils/telemetry.js';

const producer = vi.hoisted(() => ({ mode: 'real' as 'real' | 'throw' | 'invalid' }));
vi.mock('../../../agent-lane/goal-certainty.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../agent-lane/goal-certainty.js')>();
  return {
    ...real,
    goalCertaintyOfStoredResult: (graph: unknown, result: unknown) => {
      if (producer.mode === 'throw') throw new Error('producer defect');
      // An earned decision may carry nothing else — the published contract refuses a sentence on it.
      if (producer.mode === 'invalid') return [{ option_id: 'keep_current_49_price', probability_of_goal: 0, earned: true, say: 'certain' }];
      return real.goalCertaintyOfStoredResult(graph, result);
    },
  };
});

type Json = Record<string, any>;
const DIR = 'tests/fixtures/cross-service/b5-per-limit';
const input = JSON.parse(readFileSync(`${DIR}/17d1cd3a.graph.json`, 'utf8')) as { graph: Json; brief_text: string };
const plotResponse = JSON.parse(readFileSync(`${DIR}/17d1cd3a.plot-response.json`, 'utf8')) as Json;

const SCENARIO = 'a295e4a1-97b5-46c8-987a-513232e5dba4';
const OPTIONS = ['keep_current_49_price', 'increase_price_to_59', 'increase_price_to_54'];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

async function storedRun(body: Json): Promise<Json> {
  const store = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(input.graph), briefText: input.brief_text })),
    loadGraph: vi.fn(async () => clone(input.graph)),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-gc-load', store as never);
  const run = vi.fn(async () => clone(body) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot),
  });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-gc-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({
      turn_id: 't-gc', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse',
    } as never),
    requestId: 'req-gc-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error(`wrong fact_type ${fact.fact_type}`);
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  return fact.result as Json;
}

beforeEach(() => {
  producer.mode = 'real';
  vi.restoreAllMocks();
});

describe('0.63.0 at the call site: the Run stores its own goal certainty', () => {
  it('⭐ the stored array is the producer\'s decision on the STORED graph the Run\'s hash binds and the Run\'s own body — one per 0/1 option', async () => {
    const result = await storedRun(plotResponse);
    const { goalCertaintyOfStoredResult } = await vi.importActual<typeof import('../../../agent-lane/goal-certainty.js')>(
      '../../../agent-lane/goal-certainty.js',
    );
    // Bound to the Run: the hash beside it is the stored graph's, and the decision is recomputed here from that graph.
    expect(result.graph_hash_at_run).toBe(computeAnalysisAffectingGraphHash(input.graph as never));
    expect(result.goal_certainty).toEqual(goalCertaintyOfStoredResult(input.graph, { enrichment: plotResponse }));
    expect((result.goal_certainty as Json[]).map((d) => d.option_id).sort()).toEqual([...OPTIONS].sort());
    for (const d of result.goal_certainty as Json[]) expect(d.probability_of_goal).toBe(0);
  });

  it('RECORDED EMPTY (Runtime 5883189956): a completed Run with no option at 0 or 1 stores `[]`, not absence', async () => {
    const body = clone(plotResponse);
    (body.option_comparison as Json[]).forEach((o, i) => { o.probability_of_goal = [0.2, 0.5, 0.7][i]; });
    const result = await storedRun(body);
    expect(result).toHaveProperty('goal_certainty');
    expect(result.goal_certainty).toEqual([]);
  });

  it('NOT RECORDED: a body with no `option_comparison` leaves the field absent — nothing to decide from', async () => {
    const body = clone(plotResponse);
    delete body.option_comparison;
    const result = await storedRun(body);
    expect(result).not.toHaveProperty('goal_certainty');
  });

  it('FAIL CLOSED, the Run stands: a producer that THROWS costs the field and is logged', async () => {
    producer.mode = 'throw';
    const warn = vi.spyOn(log, 'warn');
    const result = await storedRun(plotResponse);
    expect(result).not.toHaveProperty('goal_certainty');
    expect(result.graph_hash_at_run).toBe(computeAnalysisAffectingGraphHash(input.graph as never));
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'v5.run_analysis.goal_certainty_not_recorded', reason: 'producer_threw' }),
      expect.any(String),
    );
  });

  it('FAIL CLOSED, the Run stands: an output the published contract REFUSES is not stored', async () => {
    producer.mode = 'invalid';
    const warn = vi.spyOn(log, 'warn');
    const result = await storedRun(plotResponse);
    expect(result).not.toHaveProperty('goal_certainty');
    expect(result.leading_option_id).toBeDefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'v5.run_analysis.goal_certainty_not_recorded', reason: 'contract_refused' }),
      expect.any(String),
    );
  });
});
