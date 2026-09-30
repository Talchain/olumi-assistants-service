/**
 * ⛔ DECISION-REPRESENTATION ROW 4 IN THE RUN (AIQ #2371 5914730220): `exploratory` withholds the goal CHANCE too.
 *
 * Served m1 after the identity card's Yes (R3 `cand2-8db2a62-1409Z/m1-yes-run`): the goal identity was evaluated, and the
 * Run said "Raise to £59" reaches £85k in 99.29% of runs, resting on Olumi's price → churn guess and churn counted once.
 * Under PTL P2 (#77 5914383843) the target can't be tested yet, so no option's chance is shown: `run_analysis` withholds
 * every option's goal figures with `GOAL_FIGURES_TARGET_NOT_TESTABLE`, the leader and shares with them.
 *
 * THE PATH: the served graph through the REAL loader and the REAL handler; the PLoT client returns the served run body.
 * Rung: TESTED (in-process), not a wire witness.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE, GOAL_FIGURES_WITHHELD_CODES } from '../../../../orchestrator/context/option-result-source.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

type Json = Record<string, any>;
const M1 = JSON.parse(readFileSync(new URL('./fixtures/r3-m1-card-yes-served-run-20260930.json', import.meta.url), 'utf8')) as {
  _provenance: { brief_text: string }; graph: Json; plot_body: Json;
};
const SCENARIO = 'c8108752-0000-4000-8000-000000002371';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

async function runOn(graph: Json): Promise<Json> {
  const store = {
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: M1._provenance.brief_text })),
    loadGraph: vi.fn(async () => clone(graph)),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-tt-load', store as never);
  const run = vi.fn(async () => clone(M1.plot_body) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot),
  });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-tt-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't-tt', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'req-tt-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error(`wrong fact_type ${fact.fact_type}`);
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  return fact.result as Json;
}

/** Every `probability_of_goal` anywhere in the Run's result, by option id. */
const chances = (result: Json): Record<string, number> => {
  const out: Record<string, number> = {};
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const r = v as Json;
    if (typeof r.probability_of_goal === 'number') out[String(r.option_id ?? r.id)] = r.probability_of_goal;
    Object.values(r).forEach(walk);
  };
  walk(result);
  return out;
};
const warningsOf = (result: Json): Json[] => {
  const found: Json[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v === null || typeof v !== 'object') return;
    const r = v as Json;
    if (typeof r.code === 'string' && typeof r.message === 'string') found.push(r);
    Object.values(r).forEach(walk);
  };
  walk(result);
  return found;
};

describe('a target the Run can\'t test has no goal chance for any option (m1 after the identity card\'s Yes)', () => {
  it('PRECONDITION: the served body carries the chance this row withholds', () => {
    expect(chances(M1.plot_body)['59_price']).toBeCloseTo(0.9929, 4);
  });

  it('RED: the served graph → no option\'s chance, one typed withhold in the set every reader keys on, in the DR words', async () => {
    const result = await runOn(M1.graph);
    expect(chances(result)).toEqual({});
    const w = warningsOf(result).filter((x) => x.code === GOAL_FIGURES_TARGET_NOT_TESTABLE);
    expect(w.length).toBeGreaterThan(0);
    expect(GOAL_FIGURES_WITHHELD_CODES.has(w[0]!.code)).toBe(true);
    expect(w[0]!.message.startsWith("Not shown. Olumi can compare your options, but can't yet test them against your target")).toBe(true);
  });

  it('CONTROL: the user sized the route (price → churn → subscribers at 12 months) → the chance is shown', async () => {
    const g = clone(M1.graph);
    for (const e of g.edges as Json[]) {
      if ((e.to === 'monthly_churn_rate' || e.to === 'paying_subscribers_at_12_months') && (e.defaulted === true || String(e.provenance?.magnitude ?? '').startsWith('olumi_'))) {
        e.provenance = { ...(e.provenance ?? {}), source: 'user_specified' };
      }
    }
    const result = await runOn(g);
    expect(chances(result)['59_price']).toBeCloseTo(0.9929, 4);
    expect(warningsOf(result).some((x) => x.code === GOAL_FIGURES_TARGET_NOT_TESTABLE)).toBe(false);
  });
});
