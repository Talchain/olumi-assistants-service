/**
 * ⭐ C1 DURABLE HISTORY — `seedHistoryFacts` (DL lease 5944383317, narrowed to the seed; DL conditions on the narrowing).
 * The hot window lends the seed whenever it holds a successful Run; the reconciled durable set only when the window lost
 * every Run, and only when it is attested for THIS scenario and a reasoning authority (`complete | capped`).
 * Every carrier here comes from the REAL reconciler (its attestation cannot be forged by a test).
 */
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { seedHistoryFacts } from '../seed-reuse.js';
import { orderSuccessfulRunAnalysisFactsNewestFirst } from '../../context/freshness.js';
import {
  SCENARIO_ANALYSIS_FACT_CAP,
  SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
  reconcileScenarioAnalysisFacts,
} from '../../context/reconcile-scenario-analysis-facts.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const runFact = (seed: string, at: string, scenarioId = SCENARIO): HandlerFact => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: {
    scenario_id: scenarioId, leading_option_id: `option-${seed}`, summary: `Analysis ${seed}`, computed_at: at,
    enrichment: { analysis_status: 'completed', meta: { seed_used: seed } },
  },
}) as unknown as HandlerFact;
/** A full capped page: the read returns LOOKAHEAD (cap + 1) rows, newest first, behind `total` > cap. */
const cappedPage = (newest: readonly HandlerFact[]) => [
  ...newest,
  ...Array.from({ length: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT - newest.length },
    (_, i) => runFact(`old${i}`, `2026-09-01T00:${String(59 - i).padStart(2, '0')}:00.000Z`)),
];
const A = runFact('111', '2026-10-01T10:00:00.000Z');
const B = runFact('222', '2026-10-01T11:00:00.000Z');
const reconciled = (facts: readonly HandlerFact[], total = facts.length, scenarioId = SCENARIO) => reconcileScenarioAnalysisFacts({
  scenarioId, hotWindowFacts: [], hotWindowFactsWithIdentity: [],
  durableRead: {
    status: 'ok', scenario_id: scenarioId, query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT, total_count: total,
    facts: facts.map((fact, i) => ({ fact, fact_row_id: `row-${i}`, fact_created_at: `2026-10-01T12:00:${String(59 - i).padStart(2, '0')}.000Z` })),
  },
});
/** The seed of the Run `priorRunForSeed` would lend from these facts (its own selector, newest successful first). The
 *  draw-structure gate after it is covered on the real chip path (`chip-click-run-seed-binding.test.ts` B4–B7). */
const seedOf = (facts: readonly HandlerFact[] | undefined) => {
  const newest = facts === undefined ? undefined : orderSuccessfulRunAnalysisFactsNewestFirst(facts)[0]?.fact;
  return newest === undefined ? 'no_prior_run' : String((newest as unknown as { result: { enrichment: { meta: { seed_used: string } } } }).result.enrichment.meta.seed_used);
};

describe('seedHistoryFacts — the window first; the durable set only when the window lost every Run', () => {
  it('precondition: the real reconciler attests these carriers as complete / capped', () => {
    expect(reconciled([A]).status).toBe('complete');
    expect(reconciled(cappedPage([A]), SCENARIO_ANALYSIS_FACT_CAP + 5).status).toBe('capped');
  });

  it('RED: the window lost every Run, the durable set is complete → the durable set lends (Run A\'s exact seed)', () => {
    const facts = seedHistoryFacts({ scenarioId: SCENARIO, hotWindow: [], durable: reconciled([A]) });
    expect(seedOf(facts)).toBe('111');
  });

  it('RED: … and when it is CAPPED (its newest rows) → the durable set lends', () => {
    expect(seedOf(seedHistoryFacts({ scenarioId: SCENARIO, hotWindow: [], durable: reconciled(cappedPage([B, A]), SCENARIO_ANALYSIS_FACT_CAP + 5) }))).toBe('222');
  });

  it('DL condition 1: the window holds a NEWER Run than the durable set → the window lends, never the older durable seed', () => {
    const durableOnlyA = reconciled([A]);
    expect(seedOf(seedHistoryFacts({ scenarioId: SCENARIO, hotWindow: [B], durable: durableOnlyA }))).toBe('222');
  });

  it('CODEX P2 disposition (capped + clock skew): the donor is the capped page\'s own newest success — the SAME Run the cold read pairs from (same carrier, same selector), so no C1 is claimed for a pair the read never shows', () => {
    // Database order [A, 19 failed, B]: A committed last but computed earlier; B (computed later) is the 21st row the cap drops.
    const failed = Array.from({ length: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT - 2 }, (_, i) => {
      const f = runFact(`f${i}`, `2026-10-01T09:00:${String(i).padStart(2, '0')}.000Z`) as unknown as { result: { enrichment: Record<string, unknown> } };
      f.result.enrichment.analysis_status = 'failed';
      return f as unknown as HandlerFact;
    });
    const skewA = runFact('111', '2026-10-01T12:00:00.000Z');
    const skewB = runFact('222', '2026-10-01T12:00:01.000Z');
    const set = reconciled([skewA, ...failed, skewB], SCENARIO_ANALYSIS_FACT_CAP + 1);
    expect(set.status).toBe('capped');
    const donor = seedOf(seedHistoryFacts({ scenarioId: SCENARIO, hotWindow: [], durable: set }));
    const coldReadPrior = seedOf(set.facts);
    expect(donor).toBe('111');
    expect(donor, 'the donor IS the cold read\'s prior').toBe(coldReadPrior);
  });

  it('a durable set attested for ANOTHER scenario never lends → the window (no Run) → no_prior_run', () => {
    expect(reconciled([runFact('999', '2026-10-01T12:00:00.000Z', OTHER)], 1, OTHER).status, 'precondition: attested, for OTHER').toBe('complete');
    expect(seedOf(seedHistoryFacts({ scenarioId: SCENARIO, hotWindow: [], durable: reconciled([runFact('999', '2026-10-01T12:00:00.000Z', OTHER)], 1, OTHER) }))).toBe('no_prior_run');
  });

  it('a FORGED carrier (not the reconciler\'s attested object) never lends', () => {
    const forged = { status: 'complete' as const, source: 'scenario' as const, facts: [A], total_count: 1 };
    expect(seedOf(seedHistoryFacts({ scenarioId: SCENARIO, hotWindow: [], durable: forged }))).toBe('no_prior_run');
  });

  it('CONTROL: a degraded or absent durable set → the window, today\'s answer', () => {
    const degraded = reconcileScenarioAnalysisFacts({ scenarioId: SCENARIO, hotWindowFacts: [] });
    expect(degraded.status).toBe('degraded');
    expect(seedOf(seedHistoryFacts({ scenarioId: SCENARIO, hotWindow: [], durable: degraded }))).toBe('no_prior_run');
    expect(seedOf(seedHistoryFacts({ scenarioId: SCENARIO, hotWindow: [], durable: undefined }))).toBe('no_prior_run');
    expect(seedOf(seedHistoryFacts({ scenarioId: SCENARIO, hotWindow: [A], durable: undefined }))).toBe('111');
  });
});
