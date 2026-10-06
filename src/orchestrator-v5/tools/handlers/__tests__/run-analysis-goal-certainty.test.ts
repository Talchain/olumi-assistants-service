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
import { GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../../orchestrator/context/option-result-source.js';
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
const clone0 = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/**
 * …with NO stated target, so DECISION-REPRESENTATION row 4 (#2371) has no subject: Paul's 17d1 MRR target can't be tested
 * yet (placeholders on the goal's path), and row 4 then withholds EVERY option's chance, the status quo's earned 0 too
 * (AIQ #2371 5915342964: nothing left showing). These rows pin where the Run stores its certainty, not row 4. Only the
 * goal's raw target and its own limit row go (the C46 specs' shared pattern).
 */
function withoutTarget<G>(graph: G): G {
  const c = structuredClone(graph) as unknown as { nodes: Record<string, unknown>[]; goal_constraints?: { node_id?: unknown }[] };
  const goals = new Set(c.nodes.filter((n) => n.kind === 'goal').map((n) => n.id));
  for (const n of c.nodes) if (n.kind === 'goal') delete n.goal_threshold_raw;
  // ⭐ D3 step 2 (DL 0df0e1; c6): 17d1's goal holds no comparator (the 22% class), and a goal chance with no stated direction
  // is withheld with its "at least / at most" invitation (goal-chance-gate.ts, pinned there). The user's answer — "at
  // least", as the brief put it — is held here, so this file keeps testing the Run's certainty, not that gate.
  for (const n of c.nodes) if (n.kind === 'goal') n.goal_direction = '>=';
  if (Array.isArray(c.goal_constraints)) c.goal_constraints = c.goal_constraints.filter((r) => !goals.has(r.node_id));
  return c as unknown as G;
}
const SERVED_GRAPH = clone0(input.graph);
input.graph = withoutTarget(input.graph);
const plotResponse = JSON.parse(readFileSync(`${DIR}/17d1cd3a.plot-response.json`, 'utf8')) as Json;

const SCENARIO = 'a295e4a1-97b5-46c8-987a-513232e5dba4';
const OPTIONS = ['keep_current_49_price', 'increase_price_to_59', 'increase_price_to_54'];
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

async function storedRun(body: Json, graph: Json = input.graph): Promise<Json> {
  const store = {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: input.brief_text })),
    loadGraph: vi.fn(async () => clone(graph)),
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

describe('DR row 4 on the SERVED graph (target stated, not testable): the earned 0 is withheld too', () => {
  it('⛔ exploratory (DR row 4) withholds every option\'s goal chance, including an earned 0 (PTL P2; AIQ 5914730220, 5916664644)', async () => {
    const result = await storedRun(plotResponse, SERVED_GRAPH);
    expect(result.goal_certainty ?? []).toEqual([]);
    // The words (AIQ 5916664644): the status quo is withheld under the run's own TARGET_NOT_TESTABLE reason, never a
    // placeholder-path reason it does not have; the price options keep (S)'s own reason.
    const warnings: Json[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v === null || typeof v !== 'object') return;
      const r = v as Json;
      if (typeof r.code === 'string' && Array.isArray(r.option_ids)) warnings.push(r);
      Object.values(r).forEach(walk);
    };
    walk(result);
    const byCode = (code: string) => new Set(warnings.filter((w) => w.code === code).flatMap((w) => w.option_ids as string[]));
    expect(byCode(GOAL_FIGURES_TARGET_NOT_TESTABLE).has(OPTIONS[0])).toBe(true);
    expect(byCode(GOAL_FIGURES_PLACEHOLDER_PATH).has(OPTIONS[0])).toBe(false);
    expect([...byCode(GOAL_FIGURES_PLACEHOLDER_PATH)].sort()).toEqual([OPTIONS[2], OPTIONS[1]].sort());
  });
});

describe('0.63.0 at the call site: the Run stores its own goal certainty', () => {
  it('⭐ the stored array is the producer\'s decision on the STORED graph the Run\'s hash binds and the Run\'s own body — one per 0/1 option it still shows', async () => {
    const result = await storedRun(plotResponse);
    const { goalCertaintyOfStoredResult } = await vi.importActual<typeof import('../../../agent-lane/goal-certainty.js')>(
      '../../../agent-lane/goal-certainty.js',
    );
    // Bound to the Run: the hash beside it is the stored graph's, and the decision is recomputed here from that graph.
    expect(result.graph_hash_at_run).toBe(computeAnalysisAffectingGraphHash(input.graph as never));
    // ⛔ (S) (DL #75 5902570568): both price options reach MRR through an `olumi_placeholder`, so their goal figures are
    // withheld at the source and no certainty is decided for them. The status quo moves nothing and keeps its earned 0.
    expect(result.goal_certainty).toEqual(goalCertaintyOfStoredResult(input.graph, { enrichment: plotResponse })
      .filter((d) => d.option_id === OPTIONS[0]));
    expect(result.goal_certainty).toEqual([{ option_id: OPTIONS[0], probability_of_goal: 0, earned: true }]);
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
