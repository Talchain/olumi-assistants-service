/**
 * decideNoOpRecovery — safe-text convergence sweep.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `decideNoOpRecovery` turns a dead-end (LLM no-op) edit turn into a useful,
 * deterministic recovery response. Its `proposal_stage_*`, `vague_edit`, and
 * inert `ambiguous` branches already have targeted tests
 * (`edit-graph-dispatch-proposal-continuation.test.ts`,
 * `edit-graph-dispatch-early-emit-authoritative.test.ts`). The
 * `analytical_fresh|stale|none` and `explore_factor|explore_factor_stale`
 * branches — which emit deterministic constant copy + chips — had NO test
 * asserting their user-facing text is SAFE (non-empty, free of leaked entity
 * IDs, free of forbidden user-facing phrases) and that their chips are
 * well-formed.
 *
 * This file fills that gap. It does NOT change behaviour or repair policy; it
 * pins the convergence invariant against the authoritative egress guard
 * (`findForbiddenPhraseHit`) so a future copy edit cannot silently regress a
 * recovery branch into an unsafe response.
 *
 * GAP-FILL SCOPE (no padding): only the previously-unasserted branches are
 * pinned here; `proposal_stage_*` / `vague_edit` / `ambiguous` remain owned by
 * their existing tests. A universal invariant at the end covers every branch
 * regardless of which fires.
 */

import { describe, expect, it } from 'vitest';

import { decideNoOpRecovery } from '../edit-graph-dispatch.js';
import { findForbiddenPhraseHit } from '../../compose/forbidden-user-facing-phrases.js';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

const NO_FACTS: readonly HandlerFact[] = [];

// A minimal SUCCESSFUL run_analysis fact. `isSuccessfulRunAnalysisFact` treats
// a non-noop run_analysis fact with no enrichment status as a legacy success,
// which is the simplest shape that flips `hasRunAnalysisFact` true.
const SUCCESS_RUN_ANALYSIS_FACT = {
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: { scenario_id: 'scen-test', summary: 'ran', enrichment: {} },
} as unknown as HandlerFact;

// An analytical question (no mutation signal, no vague-edit verb). Drives the
// `analytical_*` branch ladder. Mirrors phrasing exercised by
// edit-graph-dispatch-proposal-continuation.test.ts.
const ANALYTICAL_MSG = 'Walk me through the analysis.';

// Entity-ID leak pattern (the unambiguous prefixes; mirrors phase3-blocks.test.ts).
const ID_LIKE_PATTERN = /\b(?:fac|opt|edge|node)_[a-z0-9_]+\b/i;

function assertSafeText(text: string | null): void {
  expect(text).not.toBeNull();
  const t = text ?? '';
  expect(t.trim().length).toBeGreaterThan(0);
  expect(t).not.toMatch(ID_LIKE_PATTERN);
  // Authoritative guard — the SAME check applied at egress.
  expect(findForbiddenPhraseHit(t)).toBeNull();
}

function assertSafeActions(
  actions: ReadonlyArray<{ id: string; label: string; message: string }>,
): void {
  for (const a of actions) {
    expect(a.id.trim().length).toBeGreaterThan(0);
    expect(a.label.trim().length).toBeGreaterThan(0);
    expect(a.message.trim().length).toBeGreaterThan(0);
    expect(a.label).not.toMatch(ID_LIKE_PATTERN);
    expect(a.message).not.toMatch(ID_LIKE_PATTERN);
    expect(findForbiddenPhraseHit(a.label)).toBeNull();
    expect(findForbiddenPhraseHit(a.message)).toBeNull();
  }
}

describe('decideNoOpRecovery — analytical-branch convergence (gap-fill)', () => {
  it('analytical_none (graph ready): safe copy + a run-analysis chip', () => {
    const r = decideNoOpRecovery({
      message: ANALYTICAL_MSG,
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: true,
    });
    expect(r.branch).toBe('analytical_none');
    assertSafeText(r.assistantText);
    expect(r.suggestedActions.length).toBeGreaterThan(0);
    assertSafeActions(r.suggestedActions);
  });

  it('analytical_none (graph NOT ready): safe copy + no chip (clicking would fail)', () => {
    const r = decideNoOpRecovery({
      message: ANALYTICAL_MSG,
      priorFacts: NO_FACTS,
      freshness: 'fresh',
      graphReady: false,
    });
    expect(r.branch).toBe('analytical_none');
    assertSafeText(r.assistantText);
    expect(r.suggestedActions).toHaveLength(0);
  });

  it('analytical_fresh: safe copy + a chip when a fresh prior analysis exists', () => {
    const r = decideNoOpRecovery({
      message: ANALYTICAL_MSG,
      priorFacts: [SUCCESS_RUN_ANALYSIS_FACT],
      freshness: 'fresh',
      graphReady: true,
    });
    expect(r.branch).toBe('analytical_fresh');
    expect(r.has_run_analysis_fact).toBe(true);
    assertSafeText(r.assistantText);
    assertSafeActions(r.suggestedActions);
  });

  it('analytical_stale: safe copy + a chip when the prior analysis is stale', () => {
    const r = decideNoOpRecovery({
      message: ANALYTICAL_MSG,
      priorFacts: [SUCCESS_RUN_ANALYSIS_FACT],
      freshness: 'stale',
      graphReady: true,
    });
    expect(r.branch).toBe('analytical_stale');
    assertSafeText(r.assistantText);
    assertSafeActions(r.suggestedActions);
  });
});

describe('decideNoOpRecovery — explore-factor branch convergence (gap-fill)', () => {
  // Bare known label, no analytical/vague/mutation signal, with a prior
  // successful analysis → the explore_factor safety-net branch.
  const NODES = [{ label: 'Delivery risk' }, { label: 'Cost overrun risk' }];

  it('explore_factor (fresh): safe copy + exploration chips', () => {
    const r = decideNoOpRecovery({
      message: 'Delivery risk',
      priorFacts: [SUCCESS_RUN_ANALYSIS_FACT],
      freshness: 'fresh',
      graphReady: true,
      nodes: NODES,
    });
    expect(r.branch).toBe('explore_factor');
    assertSafeText(r.assistantText);
    expect(r.suggestedActions.length).toBeGreaterThan(0);
    assertSafeActions(r.suggestedActions);
  });

  it('explore_factor_stale: safe copy + a re-run chip', () => {
    const r = decideNoOpRecovery({
      message: 'Delivery risk',
      priorFacts: [SUCCESS_RUN_ANALYSIS_FACT],
      freshness: 'stale',
      graphReady: true,
      nodes: NODES,
    });
    expect(r.branch).toBe('explore_factor_stale');
    assertSafeText(r.assistantText);
    assertSafeActions(r.suggestedActions);
  });
});

describe('decideNoOpRecovery — universal safe-text invariant', () => {
  // Across a representative input matrix, EVERY decision must satisfy:
  //   assistantText is null (preserve-existing-copy branch) OR safe;
  //   every chip is well-formed and leak-free.
  // This holds regardless of which branch fires, so it is robust to classifier
  // nuance while still proving non-vacuity (several inputs DO produce copy).
  const MATRIX: Array<Parameters<typeof decideNoOpRecovery>[0]> = [
    { message: ANALYTICAL_MSG, priorFacts: NO_FACTS, freshness: 'fresh', graphReady: true },
    { message: ANALYTICAL_MSG, priorFacts: NO_FACTS, freshness: 'fresh', graphReady: false },
    { message: ANALYTICAL_MSG, priorFacts: [SUCCESS_RUN_ANALYSIS_FACT], freshness: 'fresh', graphReady: true },
    { message: ANALYTICAL_MSG, priorFacts: [SUCCESS_RUN_ANALYSIS_FACT], freshness: 'stale', graphReady: true },
    { message: 'Let me change it.', priorFacts: NO_FACTS, freshness: 'fresh', graphReady: true },
    { message: 'Delivery risk', priorFacts: [SUCCESS_RUN_ANALYSIS_FACT], freshness: 'fresh', graphReady: true, nodes: [{ label: 'Delivery risk' }] },
    { message: 'Thanks, that all looks good.', priorFacts: NO_FACTS, freshness: 'unknown', graphReady: true },
    { message: '', priorFacts: NO_FACTS, freshness: 'fresh', graphReady: true },
  ];

  it('every decision is null-or-safe with well-formed chips', () => {
    let nonNullCount = 0;
    for (const input of MATRIX) {
      const r = decideNoOpRecovery(input);
      if (r.assistantText !== null) {
        nonNullCount += 1;
        assertSafeText(r.assistantText);
      }
      assertSafeActions(r.suggestedActions);
    }
    // Non-vacuity: the sweep actually exercised multiple copy-emitting branches.
    expect(nonNullCount).toBeGreaterThanOrEqual(4);
  });
});
