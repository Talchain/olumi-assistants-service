/**
 * CONTEXT/MEMORY V5 defect 4 — THE WIRING HALF.
 *
 * `freshness-degraded-fact-read.test.ts` proves `deriveAnalysisFreshness`
 * honours the flag. That is necessary and NOT sufficient: a parameter that no
 * live caller threads is a dead parameter, and this estate's dominant defect is
 * exactly that shape — machinery that reads as a guarantee and never executes.
 *
 * `selectCanonicalAnalysisState` is the single authority that produces the
 * verdict reaching `coaching_context.freshness` (via `summariseCoachingStatePack`
 * in the turn executor). These tests bind to THAT function, so a refactor that
 * stops threading the flag REDs here even while the unit tests stay green.
 *
 * The one thing these cannot prove is that `turn-executor.ts` passes
 * `context.prior_facts_read_ok` at its two call sites — that is asserted by the
 * typecheck plus the mutation pair recorded in the PR body, and it is stated
 * here rather than left implied.
 */

import { describe, expect, it } from 'vitest';

import { selectCanonicalAnalysisState } from '../canonical-analysis-state.js';

const HASH = 'graph-hash-1';

describe('selectCanonicalAnalysisState — degraded prior-fact read', () => {
  it('CONTROL: a successful read with no facts stays "none"', () => {
    // The discriminating control. Without it, a fix that returned `unknown`
    // for every factless scenario would pass the degraded arm below and be
    // indistinguishable from a blanket downgrade of every fresh scenario.
    const state = selectCanonicalAnalysisState({
      handlerFacts: [],
      priorFacts: [],
      currentGraphHash: HASH,
      priorFactsReadOk: true,
    });
    expect(state.freshness).toBe('none');
    expect(state.freshness_reason).toBe('no_successful_run_analysis_fact');
  });

  it('CONTROL: omitting the flag is byte-identical to the pre-fix verdict', () => {
    const withoutFlag = selectCanonicalAnalysisState({
      handlerFacts: [],
      priorFacts: [],
      currentGraphHash: HASH,
    });
    const readOk = selectCanonicalAnalysisState({
      handlerFacts: [],
      priorFacts: [],
      currentGraphHash: HASH,
      priorFactsReadOk: true,
    });
    expect(withoutFlag).toEqual(readOk);
    expect(withoutFlag.freshness).toBe('none');
  });

  it('threads the degraded flag through to an "unknown" verdict', () => {
    const state = selectCanonicalAnalysisState({
      handlerFacts: [],
      priorFacts: [],
      currentGraphHash: HASH,
      priorFactsReadOk: false,
    });
    expect(state.freshness).toBe('unknown');
    expect(state.freshness_reason).toBe('derivation_failed');
  });

  it('an "unknown" verdict does not license the analysis for chips or prose', () => {
    // The consequence that makes this worth fixing. `usable_for_chips` is what
    // CEE #978 now gates the per-element focus join on, and what the display
    // freshness disclosure keys off. A degraded read must not read as licensed.
    //
    // ⚠ FIELD NAME DERIVED, NOT GUESSED. The first draft asserted
    // `usable_for_chips` — that is the SNAKE_CASE name on the PACK shape
    // (`summariseCoachingStatePack`), not on the raw `CanonicalAnalysisState`
    // this function returns, which uses `usableForChips`. `toBe(false)` caught
    // it because `undefined !== false`; a falsy assertion would have passed on
    // a property that does not exist. Two same-meaning names at two levels is
    // this estate's chronic defect shape, so it is worth naming here.
    const degraded = selectCanonicalAnalysisState({
      handlerFacts: [],
      priorFacts: [],
      currentGraphHash: HASH,
      priorFactsReadOk: false,
    });
    expect(degraded.usableForChips).toBe(false);
    // Contrast control: the licensing flag is not simply always false — a
    // successful-read scenario with no facts is equally unusable, so prove the
    // assertion above is about the DEGRADED path by checking a fresh one is true.
    const fresh = selectCanonicalAnalysisState({
      handlerFacts: [
        {
          fact_type: 'run_analysis',
          fact_version: 1,
          noop: false,
          result: { graph_hash_at_run: HASH, computed_at: '2026-08-15T00:00:00.000Z' },
        } as never,
      ],
      priorFacts: [],
      currentGraphHash: HASH,
      priorFactsReadOk: false,
    });
    expect(fresh.freshness).toBe('fresh');
    expect(fresh.usableForChips).toBe(true);
  });

  it('gives a current successful run precedence over a future-skewed durable timestamp', () => {
    const current = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        graph_hash_at_run: HASH,
        computed_at: '2026-08-27T12:00:00.000Z',
        enrichment: { analysis_status: 'computed' },
      },
    } as never;
    const futureSkewedPrior = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        graph_hash_at_run: 'old-graph-hash',
        computed_at: '2099-01-01T00:00:00.000Z',
        enrichment: { analysis_status: 'computed' },
      },
    } as never;

    const state = selectCanonicalAnalysisState({
      handlerFacts: [current],
      priorFacts: [futureSkewedPrior],
      currentGraphHash: HASH,
      priorFactsReadOk: true,
    });

    expect(state.freshness).toBe('fresh');
    expect(state.computed_at).toBe('2026-08-27T12:00:00.000Z');
  });

  it('does not let a future-skewed prior degradation poison a current success', () => {
    const current = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        graph_hash_at_run: HASH,
        computed_at: '2026-08-27T12:00:00.000Z',
        enrichment: { analysis_status: 'computed' },
      },
    } as never;
    const futureSkewedPriorPartial = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        graph_hash_at_run: HASH,
        computed_at: '2099-01-01T00:00:00.000Z',
        enrichment: { analysis_status: 'partial' },
      },
    } as never;

    const state = selectCanonicalAnalysisState({
      handlerFacts: [current],
      priorFacts: [futureSkewedPriorPartial],
      currentGraphHash: HASH,
      priorFactsReadOk: true,
    });

    expect(state.freshness).toBe('fresh');
    expect(state.degraded_fact_status).toBeNull();
    expect(state.contradictions).not.toContain(
      'fact_status_success_but_degraded_newer',
    );
    expect(state.usableForChips).toBe(true);
  });

  it('orders a persisted degradation by represented instant, not timestamp spelling', () => {
    const success = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        graph_hash_at_run: HASH,
        computed_at: '2026-04-30T00:30:00.000Z',
        enrichment: { analysis_status: 'computed' },
      },
    } as never;
    const chronologicallyOlderPartial = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        graph_hash_at_run: HASH,
        // Lexically greater than the success timestamp, but 90 minutes older.
        computed_at: '2026-04-30T01:00:00+02:00',
        enrichment: { analysis_status: 'partial' },
      },
    } as never;

    const state = selectCanonicalAnalysisState({
      handlerFacts: [],
      priorFacts: [chronologicallyOlderPartial, success],
      currentGraphHash: HASH,
      priorFactsReadOk: true,
    });

    expect(state.freshness).toBe('fresh');
    expect(state.computed_at).toBe('2026-04-30T00:30:00.000Z');
    expect(state.degraded_fact_status).toBeNull();
    expect(state.contradictions).not.toContain(
      'fact_status_success_but_degraded_newer',
    );
    expect(state.usableForChips).toBe(true);
    expect(state.requiresRerun).toBe(false);
  });

  it.each(['partial', 'refused']) (
    'treats a current %s run as newer than a future-skewed durable success',
    (status) => {
      const current = {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          graph_hash_at_run: HASH,
          computed_at: '2026-08-27T12:00:00.000Z',
          enrichment: { analysis_status: status },
        },
      } as never;
      const futureSkewedPrior = {
        fact_type: 'run_analysis',
        fact_version: 1,
        noop: false,
        result: {
          graph_hash_at_run: HASH,
          computed_at: '2099-01-01T00:00:00.000Z',
          enrichment: { analysis_status: 'computed' },
        },
      } as never;

      const state = selectCanonicalAnalysisState({
        handlerFacts: [current],
        priorFacts: [futureSkewedPrior],
        currentGraphHash: HASH,
        priorFactsReadOk: true,
      });

      expect(state.degraded_fact_status).toBe(status);
      expect(state.contradictions).toContain(
        'fact_status_success_but_degraded_newer',
      );
      expect(state.usableForChips).toBe(false);
    },
  );
});
