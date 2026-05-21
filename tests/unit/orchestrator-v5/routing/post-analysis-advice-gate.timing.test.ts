/**
 * Timing + structural-performance test for the post-analysis advice gate
 * after the grounded-fresh-analysis enrichment.
 *
 * This test asserts the **guard/composition** segment of turn latency —
 * the synchronous, no-LLM, no-PLoT, no-fetch path matched fresh-analysis
 * follow-ups now go through. End-to-end turn latency includes context
 * build (turn-executor STEP 0 prior_facts read + ContextPack assembly)
 * and is not asserted here; it is checked in staging smoke after merge
 * using the existing Render / DGAI replay observability.
 *
 * Structural assertion (primary guarantee): `tryPostAnalysisAdviceGate`
 * is synchronous — it returns an `AdviceGateResult` POJO, not a Promise.
 * Wall-clock timing is a defence-in-depth ceiling against accidental
 * quadratic regex backtracking from the patterns added by this
 * workstream (the new "why is X ahead" pattern in particular uses a
 * bounded `[^.?!\n]{1,40}` span between fixed anchors, which is
 * intentionally narrow to keep the matcher fast).
 *
 * The 50 ms loop-mean ceiling is loose — a deterministic regex match
 * plus string-concat composition should comfortably run sub-millisecond
 * per invocation. The ceiling exists only to catch a regression that
 * would make CI flaky over time; it is NOT a tight performance SLA.
 */

import { describe, expect, it } from 'vitest';

import {
  tryPostAnalysisAdviceGate,
  type AdviceClass,
  type AdviceGateAnalysis,
} from '../../../../src/orchestrator-v5/routing/post-analysis-advice-gate.js';

const ENRICHED_ANALYSIS: AdviceGateAnalysis = {
  status: 'success',
  leading_option: { label: 'Hire two senior engineers locally', probability: 0.62 },
  runner_up: { label: 'Hire one senior engineer overseas', probability: 0.38 },
  margin_pp: 24,
  robustness_band: 'moderate',
  top_drivers: [
    { factor_label: 'Delivery risk', sensitivity_value: 0.45 },
    { factor_label: 'Cost overrun risk', sensitivity_value: -0.32 },
  ],
  fragile_edges: [{ from_label: 'Delivery risk', to_label: 'Successful launch' }],
};

/**
 * Each row pairs a target phrase with the advice-gate class it must
 * resolve to. Asserting BOTH matched=true AND the expected class is the
 * critical loop-budget guarantee: a regression that broke the patterns
 * (e.g. accidental class-precedence shuffle) would make the gate
 * fast-fail, and a timing test that only checked `lastResult).toBeDefined()`
 * would silently pass on the fast-fail path. The structural assertion +
 * class assertion + wall-clock bound together prove the matched
 * guard+composition path stays synchronous and fast.
 */
const TARGET_PHRASES: ReadonlyArray<readonly [string, AdviceClass]> = [
  ['Walk me through the analysis', 'explain_results_free_text'],
  ['What drove this result?', 'explain_results_free_text'],
  ['Why is this option ahead?', 'explain_results_free_text'],
  ['Why is Option A leading?', 'explain_results_free_text'],
  ['What would need to change for another option to look better?', 'what_would_flip_free_text'],
  ['What should I pay attention to?', 'advice'],
];

const LOOP_ITERATIONS = 100;
const MEAN_BUDGET_MS = 50;

describe('post-analysis-advice-gate — timing + structural performance', () => {
  it('returns a synchronous result (not a Promise)', () => {
    // Structural performance guarantee — the matched path never awaits.
    // A Promise would indicate a regression that broke the F.6 invariant
    // (no fetches, no LLM, no recompute) and would also make the wall-
    // clock test below unreliable in event-loop-heavy CI runners.
    const result = tryPostAnalysisAdviceGate({
      message: 'Explain the results.',
      analysis: ENRICHED_ANALYSIS,
      freshness: 'fresh',
    });
    // Vitest does not have a direct `.not.toBeInstanceOf(Promise)`
    // matcher in older versions — use a structural check that survives.
    expect(result).not.toHaveProperty('then');
    expect(result.matched).toBe(true);
  });

  for (const [phrase, expectedClass] of TARGET_PHRASES) {
    it(`matched ${expectedClass} + loop mean < ${MEAN_BUDGET_MS}ms over ${LOOP_ITERATIONS} iterations: "${phrase}"`, () => {
      const start = performance.now();
      let lastResult: ReturnType<typeof tryPostAnalysisAdviceGate> | undefined;
      for (let i = 0; i < LOOP_ITERATIONS; i += 1) {
        lastResult = tryPostAnalysisAdviceGate({
          message: phrase,
          analysis: ENRICHED_ANALYSIS,
          freshness: 'fresh',
        });
      }
      const elapsedMs = performance.now() - start;
      const meanMs = elapsedMs / LOOP_ITERATIONS;
      // The gate MUST have matched the expected class — otherwise the
      // timing measurement covers only the fast-fail path and tells us
      // nothing about guard+composition latency. This is what the test
      // is here to prove.
      expect(lastResult).toBeDefined();
      expect(lastResult!.matched).toBe(true);
      if (lastResult!.matched) {
        expect(lastResult!.advice_class).toBe(expectedClass);
      }
      expect(meanMs).toBeLessThan(MEAN_BUDGET_MS);
    });
  }
});
