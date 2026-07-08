/**
 * FIX 2 (1.41) — prompt size budgets for `buildDecisionReviewUserMessage`.
 *
 * Live evidence (flag-activation trial, 2026-07-08 — see
 * Docs/lanes/LANE-REVIEW-DELIVERABLE) showed the <GRAPH>, <ISL_RESULTS>, and
 * <DETERMINISTIC_COACHING> sections were raw `JSON.stringify` blocks with
 * zero capping: no length check, no array-size cap anywhere. At a MODEST
 * decision (4 options, 5 factors, 15 edges) this already cost ~9.9k input
 * tokens; nothing stopped it scaling linearly (or worse) with graph size on
 * a larger real decision.
 *
 * These tests pin:
 *   1. An oversized fixture (100s of factor_sensitivity / fragile_edges /
 *      option_comparison / graph node entries) produces a BOUNDED prompt —
 *      never unbounded growth.
 *   2. Truncation is always disclosed via a `[TRUNCATED: ...]` marker —
 *      never silent.
 *   3. Truncation keeps the most decision-relevant entries (highest
 *      |elasticity| factors, highest switch_probability edges, highest
 *      win_probability options) — not an arbitrary/positional cut.
 *   4. A typical/small payload (well under every cap) is completely
 *      unaffected — same content, no truncation marker, same order.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDecisionReviewUserMessage,
  DECISION_REVIEW_MAX_FACTOR_SENSITIVITY,
  DECISION_REVIEW_MAX_FRAGILE_EDGES,
  DECISION_REVIEW_MAX_OPTION_COMPARISON,
  DECISION_REVIEW_MAX_GRAPH_NODES,
  type DecisionReviewInvokeInput,
} from '../invoke.js';

function baseInput(overrides: Partial<DecisionReviewInvokeInput> = {}): DecisionReviewInvokeInput {
  return {
    brief: 'Should we hire a backend engineer or bring on a contractor?',
    brief_hash: 'abc123',
    graph: { nodes: [], edges: [] },
    isl_results: { factor_sensitivity: [], fragile_edges: [], option_comparison: [] },
    deterministic_coaching: { readiness: 'ready', headline_type: 'clear_winner', evidence_gaps: [], model_critiques: [] },
    winner: { id: 'opt-1', label: 'Hire', win_probability: 0.7 },
    runner_up: { id: 'opt-2', label: 'Contract', win_probability: 0.3 },
    ...overrides,
  };
}

function makeFactorSensitivity(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    factor_id: `fac_${i}`,
    factor_label: `Factor ${i}`,
    // Spread elasticity across a wide range so ranking is unambiguous —
    // higher index = higher |elasticity| = more decision-relevant.
    elasticity: (i + 1) * 0.01,
    confidence: 0.5,
  }));
}

function makeFragileEdges(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    edge_id: `edge_${i}`,
    from_label: `Node ${i}`,
    to_label: `Node ${i + 1}`,
    switch_probability: (i + 1) / (n + 1),
  }));
}

function makeOptionComparison(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    option_id: `opt_${i}`,
    option_label: `Option ${i}`,
    win_probability: (i + 1) / (n + 1),
    outcome: { mean: 100 * i, p10: 90 * i, p90: 110 * i },
  }));
}

function makeGraphNodes(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({ id: `node_${i}`, kind: 'factor', label: `Node ${i}` }));
}

describe('buildDecisionReviewUserMessage — prompt size budgets (FIX 2, 1.41)', () => {
  it('an oversized isl_results fixture produces a BOUNDED prompt, not unbounded growth', () => {
    const small = buildDecisionReviewUserMessage(baseInput(), 0.4);

    const huge = buildDecisionReviewUserMessage(
      baseInput({
        isl_results: {
          factor_sensitivity: makeFactorSensitivity(500),
          fragile_edges: makeFragileEdges(500),
          option_comparison: makeOptionComparison(500),
        },
      }),
      0.4,
    );

    // The huge fixture must NOT scale linearly with input size — bounded
    // regardless of how many entries PLoT/upstream supplies.
    expect(huge.length).toBeLessThan(small.length + 40_000);
    // Sanity: without capping, 500+500+500 entries would be tens of
    // thousands of characters just for these three arrays — confirm we're
    // nowhere near that.
    expect(huge.length).toBeLessThan(30_000);
  });

  it('an oversized graph fixture (100s of nodes/edges) produces a BOUNDED <GRAPH> section', () => {
    const huge = buildDecisionReviewUserMessage(
      baseInput({ graph: { nodes: makeGraphNodes(500), edges: [] } }),
      0.4,
    );
    expect(huge.length).toBeLessThan(30_000);
    expect(huge).toContain('[TRUNCATED:');
    expect(huge).toContain('graph.nodes entries omitted');
  });

  it('truncation is always disclosed via a [TRUNCATED: ...] marker — never silent', () => {
    const message = buildDecisionReviewUserMessage(
      baseInput({
        isl_results: {
          factor_sensitivity: makeFactorSensitivity(50),
          fragile_edges: makeFragileEdges(50),
          option_comparison: makeOptionComparison(50),
        },
      }),
      0.4,
    );
    expect(message).toContain('[TRUNCATED:');
    expect(message).toContain('factor_sensitivity entries omitted');
    expect(message).toContain('fragile_edges entries omitted');
    expect(message).toContain('option_comparison entries omitted');
  });

  it('truncation keeps the most decision-relevant factor_sensitivity entries (highest |elasticity|), drops the least relevant', () => {
    const n = DECISION_REVIEW_MAX_FACTOR_SENSITIVITY + 10;
    const message = buildDecisionReviewUserMessage(
      baseInput({ isl_results: { factor_sensitivity: makeFactorSensitivity(n) } }),
      0.4,
    );
    // Highest-index entries have the highest elasticity (most relevant) —
    // must survive. Lowest-index entries (least relevant) must be dropped.
    expect(message).toContain('"factor_id": "fac_' + (n - 1) + '"');
    expect(message).toContain('"factor_id": "fac_' + (n - DECISION_REVIEW_MAX_FACTOR_SENSITIVITY) + '"');
    expect(message).not.toContain('"factor_id": "fac_0"');
  });

  it('truncation keeps the most severe fragile_edges entries (highest switch_probability), drops the least severe', () => {
    const n = DECISION_REVIEW_MAX_FRAGILE_EDGES + 10;
    const message = buildDecisionReviewUserMessage(
      baseInput({ isl_results: { fragile_edges: makeFragileEdges(n) } }),
      0.4,
    );
    // Highest-index entries have the highest switch_probability — must survive.
    expect(message).toContain('"edge_id": "edge_' + (n - 1) + '"');
    expect(message).not.toContain('"edge_id": "edge_0"');
  });

  it('truncation keeps the highest win_probability option_comparison entries, drops the rest', () => {
    const n = DECISION_REVIEW_MAX_OPTION_COMPARISON + 10;
    const message = buildDecisionReviewUserMessage(
      baseInput({ isl_results: { option_comparison: makeOptionComparison(n) } }),
      0.4,
    );
    expect(message).toContain('"option_id": "opt_' + (n - 1) + '"');
    expect(message).not.toContain('"option_id": "opt_0"');
  });

  it('graph node/edge truncation keeps the first N (structural — no ranking signal at this layer)', () => {
    const n = DECISION_REVIEW_MAX_GRAPH_NODES + 10;
    const message = buildDecisionReviewUserMessage(
      baseInput({ graph: { nodes: makeGraphNodes(n), edges: [] } }),
      0.4,
    );
    expect(message).toContain('"id": "node_0"');
    expect(message).toContain('"id": "node_' + (DECISION_REVIEW_MAX_GRAPH_NODES - 1) + '"');
    expect(message).not.toContain('"id": "node_' + (n - 1) + '"');
  });

  it('a typical/small payload (well under every cap) is byte-identical to the uncapped path — no truncation marker, no reordering', () => {
    const islResults = {
      factor_sensitivity: makeFactorSensitivity(5),
      fragile_edges: makeFragileEdges(3),
      option_comparison: makeOptionComparison(2),
    };
    const input = baseInput({
      isl_results: islResults,
      graph: { nodes: makeGraphNodes(3), edges: [] },
    });
    const message = buildDecisionReviewUserMessage(input, 0.4);
    expect(message).not.toContain('[TRUNCATED:');
    // Order preserved exactly (no forced re-sort when under the cap) — the
    // capped ISL_RESULTS block is byte-identical to a direct stringify of
    // the original (uncapped) object.
    expect(message).toContain(JSON.stringify(islResults, null, 2));
  });

  it('DETERMINISTIC_COACHING with a pathologically oversized single field is still bounded by the hard byte ceiling', () => {
    const message = buildDecisionReviewUserMessage(
      baseInput({
        deterministic_coaching: {
          readiness: 'ready',
          headline_type: 'clear_winner',
          evidence_gaps: [],
          model_critiques: [],
          // A single oversized blob — array-count capping alone can't catch this.
          _pathological_blob: 'x'.repeat(50_000),
        },
      }),
      0.4,
    );
    expect(message.length).toBeLessThan(30_000);
    expect(message).toContain('[TRUNCATED:');
    expect(message).toContain('hard ceiling');
  });
});
