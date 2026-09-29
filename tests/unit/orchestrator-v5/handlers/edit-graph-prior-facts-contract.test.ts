/**
 * V5 — `prior_facts` / `HandlerFactWithTurn` contract test for the
 * `edit_graph` freshness derivation (DL-7 Decision 2).
 *
 * War Room Decision 2 verbatim:
 *   "edit_graph freshness derivation may depend on prior_facts, but
 *   DL-7 closure requires a targeted contract test proving the
 *   prior_facts / HandlerFactWithTurn shape used by edit_graph
 *   freshness derivation remains stable."
 *
 * What this test pins:
 *  1. `deriveAnalysisFreshness` reads `prior_facts: readonly HandlerFact[]`
 *     plus a current graph hash and produces a freshness verdict —
 *     PURE FUNCTION. Tested via direct call.
 *  2. With a single prior `RunAnalysisHandlerFact` carrying
 *     `graph_hash_at_run`, and a different current graph hash, the
 *     verdict is `'stale'` with `reason: 'graph_hash_diverged'`.
 *  3. `freshness.computed_at` is the prior fact's `result.computed_at`,
 *     NOT synthesised — proving the derivation reads the fact, not
 *     stamps Date.now().
 *
 * IMPORTANT — boundary invariant:
 *   This test imports ONLY `freshness.ts` from the V5 context layer.
 *   It does NOT import `ContextPack`, `context-pack-assembler`,
 *   `recent-changes`, or `build-turn-context`. Per War Room Decision 2:
 *   "Assert no ContextPack or recent_changes field-shape drift is
 *   required to make the assertion pass."
 *
 *   The forbidden-imports list is enforced statically by the imports
 *   below; if a future maintainer adds one of them to this file, that
 *   change should fail review (not this test). The current test is
 *   the contract; the imports are the contract surface.
 */

import { describe, it, expect } from 'vitest';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { deriveAnalysisFreshness } from '../../../../src/orchestrator-v5/context/freshness.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const HASH_PRE_EDIT = 'aaaaaaaaaaaaaaaa';
const HASH_POST_EDIT = 'bbbbbbbbbbbbbbbb';
const COMPUTED_AT = '2026-05-09T10:00:00.000Z';

function makeRunAnalysisFact(graph_hash_at_run: string): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Option A leads.',
      win_probabilities: { opt_a: 0.64, opt_b: 0.36 },
      graph_hash_at_run,
      computed_at: COMPUTED_AT,
    },
  };
}

describe('edit_graph freshness derivation — prior_facts contract (DL-7 Decision 2)', () => {
  it('PF1 prior run_analysis fact + diverged current graph hash → stale', () => {
    const priorFacts: readonly HandlerFact[] = [makeRunAnalysisFact(HASH_PRE_EDIT)];

    const verdict = deriveAnalysisFreshness(priorFacts, HASH_POST_EDIT);

    expect(verdict.freshness).toBe('stale');
    expect(verdict.reason).toBe('graph_hash_diverged');
    expect(verdict.graph_hash_at_run).toBe(HASH_PRE_EDIT);
    expect(verdict.current_graph_hash).toBe(HASH_POST_EDIT);
  });

  it('PF2 verdict.computed_at is the prior fact\'s, not synthesised', () => {
    const priorFacts: readonly HandlerFact[] = [makeRunAnalysisFact(HASH_PRE_EDIT)];

    const verdict = deriveAnalysisFreshness(priorFacts, HASH_POST_EDIT);

    expect(verdict.computed_at).toBe(COMPUTED_AT);
  });

  it('PF3 selected_fact_index points at the prior fact (newest-first index 0)', () => {
    const priorFacts: readonly HandlerFact[] = [makeRunAnalysisFact(HASH_PRE_EDIT)];

    const verdict = deriveAnalysisFreshness(priorFacts, HASH_POST_EDIT);

    expect(verdict.selected_fact_index).toBe(0);
  });

  it('PF4 same hash → fresh (not stale; happy regression)', () => {
    const priorFacts: readonly HandlerFact[] = [makeRunAnalysisFact(HASH_PRE_EDIT)];

    const verdict = deriveAnalysisFreshness(priorFacts, HASH_PRE_EDIT);

    expect(verdict.freshness).toBe('fresh');
    expect(verdict.reason).toBe('graph_hash_match');
  });

  it('PF5 no prior run_analysis facts → none', () => {
    const verdict = deriveAnalysisFreshness([], HASH_POST_EDIT);

    expect(verdict.freshness).toBe('none');
    expect(verdict.reason).toBe('no_successful_run_analysis_fact');
    expect(verdict.selected_fact_index).toBeNull();
  });

  it('PF6 reading the prior fact requires no ContextPack/recent_changes shape drift', () => {
    // Smoke test — the imports above pin the contract surface.
    // If a future change makes this test require ContextPack
    // assembler / recent_changes / build-turn-context types, those
    // imports would have to be added here, which would fail review
    // per War Room Decision 2's "no field-shape drift required"
    // invariant.
    //
    // We assert the smoke version: the function we just exercised
    // accepts a `readonly HandlerFact[]` and a `string | null`,
    // and produces a `FreshnessDerivation`. Nothing else.
    const verdict = deriveAnalysisFreshness(
      [makeRunAnalysisFact(HASH_PRE_EDIT)],
      HASH_POST_EDIT,
    );
    expect(verdict).toEqual(
      expect.objectContaining({
        freshness: expect.any(String),
        reason: expect.any(String),
        selected_fact_index: expect.any(Number),
        graph_hash_at_run: expect.any(String),
        current_graph_hash: expect.any(String),
        computed_at: expect.any(String),
      }),
    );
  });
});
