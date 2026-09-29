/**
 * Unit tests for attachComputedAt — V5 state-trust freshness threading.
 *
 * The pre-state-trust contract was: stamp Date.now() ISO every time. That
 * caused explain / direct-answer turns to restamp computed_at on every
 * response, which the UI saw as "newer" than the actual analysis.
 *
 * The new contract:
 *   - With no freshness derivation passed   → legacy behaviour (Date.now)
 *   - With derivation that selected a fact  → use the selected fact's
 *                                              computed_at
 *   - With derivation that selected nothing → fall back to Date.now
 *   - Freshness wire fields (freshness / freshness_reason /
 *     graph_hash_at_run / current_graph_hash) are stamped from the
 *     derivation when one is provided.
 */
import { describe, it, expect } from 'vitest';
import type { FreshnessDerivation } from '../../context/freshness.js';
import { attachComputedAt, type AnalysisReadyPayload } from '../analysis-ready-emit.js';

const basePayload: AnalysisReadyPayload = {
  options: [],
  goal_node_id: 'goal-1',
  status: 'ready',
};

describe('attachComputedAt — legacy behaviour (no freshness arg)', () => {
  it('stamps a fresh ISO timestamp', () => {
    const before = new Date().toISOString();
    const out = attachComputedAt(basePayload);
    const after = new Date().toISOString();
    expect(out.computed_at).toBeDefined();
    expect(out.computed_at! >= before).toBe(true);
    expect(out.computed_at! <= after).toBe(true);
  });

  it('does NOT stamp freshness fields when no derivation is provided', () => {
    const out = attachComputedAt(basePayload);
    expect(out.freshness).toBeUndefined();
    expect(out.freshness_reason).toBeUndefined();
    expect(out.graph_hash_at_run).toBeUndefined();
    expect(out.current_graph_hash).toBeUndefined();
  });

  it('returns a shallow copy (does not mutate input)', () => {
    const out = attachComputedAt(basePayload);
    expect(out).not.toBe(basePayload);
    expect(basePayload).not.toHaveProperty('computed_at');
  });
});

describe('attachComputedAt — fresh verdict', () => {
  const FRESH_AT = '2026-04-30T12:34:56.789Z';
  const fresh: FreshnessDerivation = {
    freshness: 'fresh',
    reason: 'graph_hash_match',
    selected_fact_index: 0,
    graph_hash_at_run: 'aaaa1111bbbb2222',
    current_graph_hash: 'aaaa1111bbbb2222',
    computed_at: FRESH_AT,
  };

  it('uses the selected fact computed_at, NOT wire-emit time', () => {
    const out = attachComputedAt(basePayload, fresh);
    expect(out.computed_at).toBe(FRESH_AT);
  });

  it('stamps freshness wire fields', () => {
    const out = attachComputedAt(basePayload, fresh);
    expect(out.freshness).toBe('fresh');
    expect(out.freshness_reason).toBe('graph_hash_match');
    expect(out.graph_hash_at_run).toBe('aaaa1111bbbb2222');
    expect(out.current_graph_hash).toBe('aaaa1111bbbb2222');
  });

  it('repeated emissions with the same derivation produce the same computed_at — no restamping', () => {
    const a = attachComputedAt(basePayload, fresh);
    const b = attachComputedAt(basePayload, fresh);
    expect(a.computed_at).toBe(b.computed_at);
    expect(a.computed_at).toBe(FRESH_AT);
  });
});

describe('attachComputedAt — stale verdict', () => {
  const STALE_AT = '2026-04-29T08:00:00.000Z';
  const stale: FreshnessDerivation = {
    freshness: 'stale',
    reason: 'graph_hash_diverged',
    selected_fact_index: 0,
    graph_hash_at_run: 'old_hash________',
    current_graph_hash: 'new_hash________',
    computed_at: STALE_AT,
  };

  it('uses the selected fact computed_at — even though current graph differs', () => {
    const out = attachComputedAt(basePayload, stale);
    expect(out.computed_at).toBe(STALE_AT);
  });

  it('graph_hash_at_run and current_graph_hash differ on the wire', () => {
    const out = attachComputedAt(basePayload, stale);
    expect(out.freshness).toBe('stale');
    expect(out.graph_hash_at_run).toBe('old_hash________');
    expect(out.current_graph_hash).toBe('new_hash________');
    expect(out.graph_hash_at_run).not.toBe(out.current_graph_hash);
  });
});

describe('attachComputedAt — none verdict (no fact selected)', () => {
  const none: FreshnessDerivation = {
    freshness: 'none',
    reason: 'no_successful_run_analysis_fact',
    selected_fact_index: null,
    graph_hash_at_run: null,
    current_graph_hash: 'h1',
    computed_at: null,
  };

  it('falls back to wire-emit time when no fact was selected', () => {
    const before = new Date().toISOString();
    const out = attachComputedAt(basePayload, none);
    const after = new Date().toISOString();
    expect(out.computed_at).toBeDefined();
    expect(out.computed_at! >= before).toBe(true);
    expect(out.computed_at! <= after).toBe(true);
  });

  it('still stamps the freshness verdict even with no fact', () => {
    const out = attachComputedAt(basePayload, none);
    expect(out.freshness).toBe('none');
    expect(out.freshness_reason).toBe('no_successful_run_analysis_fact');
    // Hash fields omitted when null
    expect(out.graph_hash_at_run).toBeUndefined();
    expect(out.current_graph_hash).toBe('h1');
  });
});

describe('attachComputedAt — unknown verdict (legacy fact)', () => {
  const unknown: FreshnessDerivation = {
    freshness: 'unknown',
    reason: 'legacy_fact_missing_hash',
    selected_fact_index: 0,
    graph_hash_at_run: null,
    current_graph_hash: 'h1',
    computed_at: '2026-04-29T00:00:00.000Z',
  };

  it('uses the selected fact computed_at when present (even on legacy fact)', () => {
    const out = attachComputedAt(basePayload, unknown);
    expect(out.computed_at).toBe('2026-04-29T00:00:00.000Z');
  });

  it('omits graph_hash_at_run when null (legacy fact had none)', () => {
    const out = attachComputedAt(basePayload, unknown);
    expect(out.freshness).toBe('unknown');
    expect(out.graph_hash_at_run).toBeUndefined();
    expect(out.current_graph_hash).toBe('h1');
  });
});
