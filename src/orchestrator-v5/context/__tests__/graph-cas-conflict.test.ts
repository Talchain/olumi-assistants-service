/**
 * A3 graph CAS observe-mode — pure conflict-categoriser derivation table.
 *
 * Pins:
 *  - `computeExpectedGraphCasHashes` (absent → nulls, unparseable → nulls,
 *    valid → byte-equal to the sanctioned hash functions);
 *  - every `categoriseGraphCasWrite` category AND reason;
 *  - the FIRST-MATCH-WINS rule ordering (explicit ordering tests) — in
 *    particular that `self_noop` precedes both conflict-ish categories and
 *    that `match` precedes `self_noop`;
 *  - total-function behaviour (never throws, even on hostile input).
 */

import { describe, it, expect } from 'vitest';

import {
  categoriseGraphCasWrite,
  computeExpectedGraphCasHashes,
  unavailableGraphCasEvaluation,
  type GraphCasWriteInput,
} from '../graph-cas-conflict.js';
import { computeGraphIdentityHash } from '../graph-identity.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

// ── fixtures ────────────────────────────────────────────────────────

/** Base graph — the "expected" server base read at turn start. */
const BASE_GRAPH = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.5 } },
  ],
  edges: [
    {
      from: 'fac_price',
      to: 'goal_revenue',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
  goal_node_id: 'goal_revenue',
};

/**
 * Cosmetic variant of BASE_GRAPH: a label-only change. Labels are inside the
 * identity projection (full fidelity) but excluded from the analysis
 * projection — so identity hash differs, analysis hash is identical.
 */
const BASE_GRAPH_RELABELLED = {
  ...BASE_GRAPH,
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue (net)' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.5 } },
  ],
};

/** Analysis-affecting variant: observed_state.value moved. */
const DIVERGED_GRAPH = {
  ...BASE_GRAPH,
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.9 } },
  ],
};

/** A third distinct graph — the "incoming" write on most conflict cases. */
const INCOMING_GRAPH = {
  ...BASE_GRAPH,
  nodes: [
    ...BASE_GRAPH.nodes,
    { id: 'fac_churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.2 } },
  ],
};

const UNPARSEABLE_GRAPH = { nodes: 'not-an-array', edges: [] };

/** Identity-empty graph — hashes to null in both projections. */
const EMPTY_GRAPH = { nodes: [], edges: [] };

function parsed(raw: unknown): GraphStateIngress {
  const r = GraphStateIngressSchema.safeParse(raw);
  if (!r.success) throw new Error('fixture must parse');
  return r.data;
}

const idHash = (raw: unknown): string => {
  const h = computeGraphIdentityHash(parsed(raw));
  if (h === null) throw new Error('fixture must have an identity hash');
  return h.value;
};
const anHash = (raw: unknown): string => {
  const h = computeAnalysisAffectingGraphHash(parsed(raw));
  if (h === null) throw new Error('fixture must have an analysis hash');
  return h;
};

/** Convenience: fully-populated input with per-case overrides. */
function input(overrides: Partial<GraphCasWriteInput>): GraphCasWriteInput {
  return {
    expectedIdentityHash: idHash(BASE_GRAPH),
    expectedAnalysisHash: anHash(BASE_GRAPH),
    currentGraphRaw: BASE_GRAPH,
    incomingGraphRaw: INCOMING_GRAPH,
    ...overrides,
  };
}

// ── computeExpectedGraphCasHashes ───────────────────────────────────

describe('computeExpectedGraphCasHashes', () => {
  it('absent graph (null / undefined) → both hashes null', () => {
    expect(computeExpectedGraphCasHashes(null)).toEqual({
      expectedGraphIdentityHash: null,
      expectedGraphAnalysisHash: null,
    });
    expect(computeExpectedGraphCasHashes(undefined)).toEqual({
      expectedGraphIdentityHash: null,
      expectedGraphAnalysisHash: null,
    });
  });

  it('unparseable graph → both hashes null (never a throw)', () => {
    expect(computeExpectedGraphCasHashes(UNPARSEABLE_GRAPH)).toEqual({
      expectedGraphIdentityHash: null,
      expectedGraphAnalysisHash: null,
    });
    expect(computeExpectedGraphCasHashes('a string')).toEqual({
      expectedGraphIdentityHash: null,
      expectedGraphAnalysisHash: null,
    });
  });

  it('identity-empty graph → both hashes null (server base read, no content)', () => {
    expect(computeExpectedGraphCasHashes(EMPTY_GRAPH)).toEqual({
      expectedGraphIdentityHash: null,
      expectedGraphAnalysisHash: null,
    });
  });

  it('valid graph → hashes byte-equal to the sanctioned hash functions', () => {
    const result = computeExpectedGraphCasHashes(BASE_GRAPH);
    expect(result.expectedGraphIdentityHash).toBe(idHash(BASE_GRAPH));
    expect(result.expectedGraphAnalysisHash).toBe(anHash(BASE_GRAPH));
    // Shape sanity: identity is the full 64-hex, analysis the 16-hex.
    expect(result.expectedGraphIdentityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.expectedGraphAnalysisHash).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ── categoriseGraphCasWrite — full derivation table ─────────────────

describe('categoriseGraphCasWrite — derivation table', () => {
  it('(1) current graph present but unparseable → unavailable / current_parse_failed', () => {
    const evaluation = categoriseGraphCasWrite(input({ currentGraphRaw: UNPARSEABLE_GRAPH }));
    expect(evaluation.category).toBe('unavailable');
    expect(evaluation.reason).toBe('current_parse_failed');
    expect(evaluation.current_identity_hash).toBeNull();
    expect(evaluation.current_analysis_hash).toBeNull();
  });

  it('(2) current absent + expected undefined → first_write / no_current_graph', () => {
    const evaluation = categoriseGraphCasWrite(
      input({ currentGraphRaw: null, expectedIdentityHash: undefined, expectedAnalysisHash: undefined }),
    );
    expect(evaluation.category).toBe('first_write');
    expect(evaluation.reason).toBe('no_current_graph');
  });

  it('(2) current absent + expected null → first_write / no_current_graph', () => {
    const evaluation = categoriseGraphCasWrite(
      input({ currentGraphRaw: null, expectedIdentityHash: null, expectedAnalysisHash: null }),
    );
    expect(evaluation.category).toBe('first_write');
    expect(evaluation.reason).toBe('no_current_graph');
  });

  it('(2) current identity-EMPTY graph counts as absent → first_write when no expected base', () => {
    const evaluation = categoriseGraphCasWrite(
      input({ currentGraphRaw: EMPTY_GRAPH, expectedIdentityHash: undefined, expectedAnalysisHash: undefined }),
    );
    expect(evaluation.category).toBe('first_write');
    expect(evaluation.reason).toBe('no_current_graph');
  });

  it('(2) current absent + expected NON-null → analysis_affecting_conflict / current_graph_vanished', () => {
    const evaluation = categoriseGraphCasWrite(input({ currentGraphRaw: null }));
    expect(evaluation.category).toBe('analysis_affecting_conflict');
    expect(evaluation.reason).toBe('current_graph_vanished');
  });

  it('(3) expected undefined with current existing → no_expected / not_instrumented', () => {
    const evaluation = categoriseGraphCasWrite(
      input({ expectedIdentityHash: undefined, expectedAnalysisHash: undefined }),
    );
    expect(evaluation.category).toBe('no_expected');
    expect(evaluation.reason).toBe('not_instrumented');
  });

  it('(3) expected null with current existing → no_expected / no_base_at_turn_start', () => {
    const evaluation = categoriseGraphCasWrite(
      input({ expectedIdentityHash: null, expectedAnalysisHash: null }),
    );
    expect(evaluation.category).toBe('no_expected');
    expect(evaluation.reason).toBe('no_base_at_turn_start');
  });

  it('(4) expected === current → match / expected_equals_current', () => {
    const evaluation = categoriseGraphCasWrite(input({}));
    expect(evaluation.category).toBe('match');
    expect(evaluation.reason).toBe('expected_equals_current');
    expect(evaluation.current_identity_hash).toBe(idHash(BASE_GRAPH));
    expect(evaluation.current_analysis_hash).toBe(anHash(BASE_GRAPH));
    expect(evaluation.incoming_identity_hash).toBe(idHash(INCOMING_GRAPH));
  });

  it('(5) incoming === current while expected differs → self_noop / incoming_equals_current', () => {
    // The DB moved past our base (BASE → DIVERGED), but the incoming write
    // carries exactly the current content — an idempotent replay/duplicate.
    const evaluation = categoriseGraphCasWrite(
      input({ currentGraphRaw: DIVERGED_GRAPH, incomingGraphRaw: DIVERGED_GRAPH }),
    );
    expect(evaluation.category).toBe('self_noop');
    expect(evaluation.reason).toBe('incoming_equals_current');
  });

  it('(5) self_noop is identity-normalised: node-order-permuted incoming still matches current', () => {
    const permuted = {
      ...DIVERGED_GRAPH,
      nodes: [...DIVERGED_GRAPH.nodes].reverse(),
    };
    const evaluation = categoriseGraphCasWrite(
      input({ currentGraphRaw: DIVERGED_GRAPH, incomingGraphRaw: permuted }),
    );
    expect(evaluation.category).toBe('self_noop');
  });

  it('(6) identity moved, analysis projection identical → cosmetic_concurrent_edit / analysis_projection_matched', () => {
    const evaluation = categoriseGraphCasWrite(
      input({ currentGraphRaw: BASE_GRAPH_RELABELLED }),
    );
    // Fixture sanity: identity moved, analysis did not.
    expect(idHash(BASE_GRAPH_RELABELLED)).not.toBe(idHash(BASE_GRAPH));
    expect(anHash(BASE_GRAPH_RELABELLED)).toBe(anHash(BASE_GRAPH));
    expect(evaluation.category).toBe('cosmetic_concurrent_edit');
    expect(evaluation.reason).toBe('analysis_projection_matched');
  });

  it('(7) analysis projection diverged → analysis_affecting_conflict / analysis_projection_diverged', () => {
    const evaluation = categoriseGraphCasWrite(input({ currentGraphRaw: DIVERGED_GRAPH }));
    expect(anHash(DIVERGED_GRAPH)).not.toBe(anHash(BASE_GRAPH));
    expect(evaluation.category).toBe('analysis_affecting_conflict');
    expect(evaluation.reason).toBe('analysis_projection_diverged');
  });

  it('(7) expected analysis hash missing on an identity mismatch → conservative analysis_affecting_conflict / analysis_hash_unavailable', () => {
    const evaluation = categoriseGraphCasWrite(
      input({
        currentGraphRaw: DIVERGED_GRAPH,
        expectedAnalysisHash: null, // identity base known, analysis base not
      }),
    );
    expect(evaluation.category).toBe('analysis_affecting_conflict');
    expect(evaluation.reason).toBe('analysis_hash_unavailable');
  });

  it('never throws on hostile input (circular incoming graph → unavailable / observe_hook_failed)', () => {
    const circular: Record<string, unknown> = {
      nodes: [{ id: 'n1', kind: 'factor', label: 'x' }],
      edges: [],
    };
    (circular.nodes as Array<Record<string, unknown>>)[0]!.self = circular;
    const evaluation = categoriseGraphCasWrite(input({ incomingGraphRaw: circular }));
    // Total function: whatever the internal failure point, the result is a
    // typed evaluation, never a throw.
    expect(evaluation.category).toBe('unavailable');
    expect(evaluation.reason).toBe('observe_hook_failed');
  });
});

// ── explicit FIRST-MATCH-WINS ordering proof ────────────────────────

describe('categoriseGraphCasWrite — first-match-wins ordering', () => {
  it('unavailable (1) beats no_expected (3): unparseable current + uninstrumented expected → unavailable', () => {
    const evaluation = categoriseGraphCasWrite(
      input({
        currentGraphRaw: UNPARSEABLE_GRAPH,
        expectedIdentityHash: undefined,
        expectedAnalysisHash: undefined,
      }),
    );
    expect(evaluation.category).toBe('unavailable');
    expect(evaluation.reason).toBe('current_parse_failed');
  });

  it('current_graph_vanished (2) beats no_expected-style outcomes: vanished current wins over any later rule', () => {
    const evaluation = categoriseGraphCasWrite(
      input({ currentGraphRaw: null, incomingGraphRaw: null }),
    );
    expect(evaluation.category).toBe('analysis_affecting_conflict');
    expect(evaluation.reason).toBe('current_graph_vanished');
  });

  it('match (4) beats self_noop (5): expected === current === incoming → match, not self_noop', () => {
    const evaluation = categoriseGraphCasWrite(
      input({ currentGraphRaw: BASE_GRAPH, incomingGraphRaw: BASE_GRAPH }),
    );
    expect(evaluation.category).toBe('match');
  });

  it('self_noop (5) beats cosmetic_concurrent_edit (6): incoming === current on a cosmetic divergence → self_noop', () => {
    // expected = BASE; current = RELABELLED (identity differs, analysis
    // matches → rule 6 would fire); incoming = current → rule 5 must win.
    const evaluation = categoriseGraphCasWrite(
      input({ currentGraphRaw: BASE_GRAPH_RELABELLED, incomingGraphRaw: BASE_GRAPH_RELABELLED }),
    );
    expect(evaluation.category).toBe('self_noop');
    expect(evaluation.reason).toBe('incoming_equals_current');
  });

  it('self_noop (5) beats analysis_affecting_conflict (7): incoming === current on an analysis divergence → self_noop', () => {
    // expected = BASE; current = DIVERGED (analysis-affecting conflict shape
    // — a naive classifier would call this a conflict); incoming = current.
    const evaluation = categoriseGraphCasWrite(
      input({ currentGraphRaw: DIVERGED_GRAPH, incomingGraphRaw: DIVERGED_GRAPH }),
    );
    expect(evaluation.category).toBe('self_noop');
    expect(evaluation.category).not.toBe('analysis_affecting_conflict');
    expect(evaluation.category).not.toBe('cosmetic_concurrent_edit');
  });

  it('cosmetic (6) beats conflict (7): analysis projections equal while identities differ → cosmetic', () => {
    const evaluation = categoriseGraphCasWrite(
      input({ currentGraphRaw: BASE_GRAPH_RELABELLED, incomingGraphRaw: INCOMING_GRAPH }),
    );
    expect(evaluation.category).toBe('cosmetic_concurrent_edit');
  });
});

// ── unavailableGraphCasEvaluation helper ────────────────────────────

describe('unavailableGraphCasEvaluation', () => {
  it('builds the hook-side unavailable evaluations with null hashes', () => {
    expect(unavailableGraphCasEvaluation('select_failed')).toEqual({
      category: 'unavailable',
      reason: 'select_failed',
      current_identity_hash: null,
      current_analysis_hash: null,
      incoming_identity_hash: null,
    });
    expect(unavailableGraphCasEvaluation('observe_hook_failed').reason).toBe(
      'observe_hook_failed',
    );
  });
});
