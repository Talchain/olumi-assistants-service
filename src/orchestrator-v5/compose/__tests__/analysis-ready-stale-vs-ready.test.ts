/**
 * V5 product-state continuity (foamy-bee tranche) — contract test.
 *
 * The CEE wire contract for `analysis_ready` carries two INDEPENDENT
 * axes that the UI must surface as distinct labels:
 *
 *   - `analysis_ready.status` (structural readiness)
 *       computed by `computeStructuralReadiness` from the current graph;
 *       values include 'ready', 'needs_user_input', 'needs_user_mapping',
 *       'needs_encoding', etc.
 *
 *   - `analysis_ready.freshness` (analysis recency)
 *       deterministic verdict computed by `deriveAnalysisFreshness` against
 *       the current vs at-run graph hash; values 'fresh' | 'stale' |
 *       'unknown' | 'none'.
 *
 * After a successful mutation following a prior analysis, the next
 * response carries `status: 'ready'` AND `freshness: 'stale'`
 * SIMULTANEOUSLY — the model is structurally fine to analyse, but the
 * latest analysis is now out of date because the graph hash diverged.
 *
 * This test pins that combination as a valid wire emission and proves
 * the two fields remain independently populated. Lives separately from
 * the renderer contract (the UI tranche owns the "two badges, not one"
 * rendering rule) and from `analysis-ready-emit.test.ts` (which covers
 * computed_at / wire-emit semantics).
 *
 * If a future change collapses the two fields into one, drops one, or
 * conflates them in the wire emit helper, this test fails.
 */

import { describe, it, expect } from 'vitest';

import type { FreshnessDerivation } from '../../context/freshness.js';
import { attachComputedAt, type AnalysisReadyPayload } from '../analysis-ready-emit.js';

const POST_MUTATION_FRESHNESS: FreshnessDerivation = {
  freshness: 'stale',
  reason: 'graph_hash_diverged',
  selected_fact_index: 0,
  graph_hash_at_run: 'aaaa1111bbbb2222',
  current_graph_hash: 'cccc3333dddd4444',
  computed_at: '2026-04-30T12:00:00.000Z',
};

describe('analysis_ready — structural readiness vs analysis freshness contract', () => {
  it('emits status=ready AND freshness=stale together when the model is ready but the prior analysis is out of date', () => {
    // The exact post-mutation case from the failure scenario: user
    // adds a £50k constraint after a prior run_analysis. The model is
    // still structurally ready (no goal/option change), but the
    // analysis is now stale because the graph hash diverged.
    const readyPayload: AnalysisReadyPayload = {
      options: [],
      goal_node_id: 'goal-1',
      status: 'ready',
    };

    const out = attachComputedAt(readyPayload, POST_MUTATION_FRESHNESS);

    // Both axes survive the wire emit unchanged.
    expect(out.status).toBe('ready');
    expect(out.freshness).toBe('stale');

    // Independent fields — neither overwrites the other.
    expect(out.status).not.toBe(out.freshness);

    // Hash trail visible for the UI / debug path.
    expect(out.graph_hash_at_run).toBe('aaaa1111bbbb2222');
    expect(out.current_graph_hash).toBe('cccc3333dddd4444');

    // computed_at carries the prior analysis run's timestamp, NOT
    // wire-emit time. UI consumers can compare against the current
    // turn timestamp to render "out of date" copy.
    expect(out.computed_at).toBe('2026-04-30T12:00:00.000Z');
  });

  it('emits status≠ready AND freshness=stale together when the model is incomplete and the prior analysis is out of date', () => {
    // Mid-conversation: user removed an option after a prior analysis.
    // Structurally not-ready (lost an option) AND the analysis is stale.
    const notReadyPayload: AnalysisReadyPayload = {
      options: [],
      goal_node_id: 'goal-1',
      status: 'needs_user_input',
    };

    const out = attachComputedAt(notReadyPayload, POST_MUTATION_FRESHNESS);

    expect(out.status).toBe('needs_user_input');
    expect(out.freshness).toBe('stale');
  });

  it('emits status=ready AND freshness=fresh together when model is ready and the latest analysis matches', () => {
    // Right after a successful run_analysis: both axes positive.
    const fresh: FreshnessDerivation = {
      freshness: 'fresh',
      reason: 'graph_hash_match',
      selected_fact_index: 0,
      graph_hash_at_run: 'eeee5555ffff6666',
      current_graph_hash: 'eeee5555ffff6666',
      computed_at: '2026-05-01T09:30:00.000Z',
    };
    const readyPayload: AnalysisReadyPayload = {
      options: [],
      goal_node_id: 'goal-1',
      status: 'ready',
    };

    const out = attachComputedAt(readyPayload, fresh);

    expect(out.status).toBe('ready');
    expect(out.freshness).toBe('fresh');
  });

  it('emits status=ready AND freshness=none when the model is ready but no analysis has run', () => {
    const noAnalysis: FreshnessDerivation = {
      freshness: 'none',
      reason: 'no_successful_run_analysis_fact',
      selected_fact_index: null,
      graph_hash_at_run: null,
      current_graph_hash: null,
      computed_at: null,
    };
    const readyPayload: AnalysisReadyPayload = {
      options: [],
      goal_node_id: 'goal-1',
      status: 'ready',
    };

    const out = attachComputedAt(readyPayload, noAnalysis);

    expect(out.status).toBe('ready');
    expect(out.freshness).toBe('none');
  });

  it('the two axes are independent — every (status, freshness) pair is a valid wire shape', () => {
    // Compile-time + runtime proof that the contract permits any
    // combination. If a future change couples the two fields (e.g. a
    // type narrowing that says "freshness can only be stale when
    // status is ready"), this test fails.
    const matrix: ReadonlyArray<{
      status: AnalysisReadyPayload['status'];
      freshness: FreshnessDerivation['freshness'];
    }> = [
      { status: 'ready', freshness: 'fresh' },
      { status: 'ready', freshness: 'stale' },
      { status: 'ready', freshness: 'unknown' },
      { status: 'ready', freshness: 'none' },
      { status: 'needs_user_input', freshness: 'fresh' },
      { status: 'needs_user_input', freshness: 'stale' },
      { status: 'needs_user_input', freshness: 'unknown' },
      { status: 'needs_user_input', freshness: 'none' },
    ];

    for (const { status, freshness } of matrix) {
      const out = attachComputedAt(
        {
          options: [],
          goal_node_id: 'goal-1',
          status,
        },
        {
          freshness,
          reason: 'no_successful_run_analysis_fact',
          selected_fact_index: null,
          graph_hash_at_run: null,
          current_graph_hash: null,
          computed_at: null,
        },
      );
      expect(out.status).toBe(status);
      expect(out.freshness).toBe(freshness);
    }
  });
});
