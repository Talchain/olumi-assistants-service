/**
 * Unit tests for deriveAnalysisFreshness — V5 state-trust freshness
 * derivation. Exercises the full decision tree against curated
 * prior_facts arrays and current-graph-hash inputs.
 */
import { describe, it, expect } from 'vitest';
import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { deriveAnalysisFreshness, enforceInvariants } from '../freshness.js';
import type { FreshnessDerivation } from '../freshness.js';

// Valid UUID v4 for fact.result.scenario_id (z.string().uuid()).
const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

interface FactOpts {
  graph_hash_at_run?: string | null;
  computed_at?: string | null;
  status?: string | null;
  noop?: boolean;
  leading_option_id?: string | null;
}

function mkRunAnalysisFact(opts: FactOpts = {}): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (opts.status !== undefined && opts.status !== null) {
    enrichment.analysis_status = opts.status;
  }
  const result: RunAnalysisHandlerFact['result'] = {
    scenario_id: SCENARIO_ID,
    leading_option_id: opts.leading_option_id ?? 'opt_a',
    summary: 'Ran analysis on your current scenario.',
    enrichment,
  };
  if (opts.graph_hash_at_run !== undefined && opts.graph_hash_at_run !== null) {
    result.graph_hash_at_run = opts.graph_hash_at_run;
  }
  if (opts.computed_at !== undefined && opts.computed_at !== null) {
    result.computed_at = opts.computed_at;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: opts.noop ?? false,
    result,
  };
}

describe('deriveAnalysisFreshness — none', () => {
  it('empty prior_facts → none', () => {
    const r = deriveAnalysisFreshness([], 'abc1234567890def');
    expect(r.freshness).toBe('none');
    expect(r.reason).toBe('no_successful_run_analysis_fact');
    expect(r.selected_fact_index).toBeNull();
    expect(r.computed_at).toBeNull();
    expect(r.graph_hash_at_run).toBeNull();
    expect(r.current_graph_hash).toBe('abc1234567890def');
  });

  it('only noop run_analysis facts → none', () => {
    const facts: readonly HandlerFact[] = [
      mkRunAnalysisFact({ noop: true, graph_hash_at_run: 'h1', computed_at: '2026-04-30T00:00:00.000Z' }),
    ];
    const r = deriveAnalysisFreshness(facts, 'h1');
    expect(r.freshness).toBe('none');
    expect(r.reason).toBe('no_successful_run_analysis_fact');
  });

  it('only partial-status facts → none (excluded by successful filter)', () => {
    const facts: readonly HandlerFact[] = [
      mkRunAnalysisFact({
        graph_hash_at_run: 'h1',
        computed_at: '2026-04-30T00:00:00.000Z',
        status: 'partial',
      }),
    ];
    const r = deriveAnalysisFreshness(facts, 'h1');
    expect(r.freshness).toBe('none');
  });

  it('blocked / failed / degraded statuses → all excluded', () => {
    for (const status of ['blocked', 'failed', 'degraded']) {
      const facts: readonly HandlerFact[] = [
        mkRunAnalysisFact({
          graph_hash_at_run: 'h1',
          computed_at: '2026-04-30T00:00:00.000Z',
          status,
        }),
      ];
      const r = deriveAnalysisFreshness(facts, 'h1');
      expect(r.freshness).toBe('none');
    }
  });

  it('no run_analysis facts at all (e.g. only explain_results) → none', () => {
    // explain_results facts in the chain do not select.
    const explainFact: HandlerFact = {
      fact_type: 'explain_results',
      fact_version: 1,
      noop: true,
      result: { precondition_unmet: false, option_count: 2 },
    };
    const r = deriveAnalysisFreshness([explainFact], 'h1');
    expect(r.freshness).toBe('none');
  });
});

describe('deriveAnalysisFreshness — fresh', () => {
  it('matching hashes → fresh, reason graph_hash_match', () => {
    const facts: readonly HandlerFact[] = [
      mkRunAnalysisFact({
        graph_hash_at_run: 'aaaa1111bbbb2222',
        computed_at: '2026-04-30T00:00:00.000Z',
        status: 'computed',
      }),
    ];
    const r = deriveAnalysisFreshness(facts, 'aaaa1111bbbb2222');
    expect(r.freshness).toBe('fresh');
    expect(r.reason).toBe('graph_hash_match');
    expect(r.graph_hash_at_run).toBe('aaaa1111bbbb2222');
    expect(r.current_graph_hash).toBe('aaaa1111bbbb2222');
    expect(r.computed_at).toBe('2026-04-30T00:00:00.000Z');
    expect(r.selected_fact_index).toBe(0);
  });

  it('matches under canonical success and known aliases (case-insensitive)', () => {
    // Eligibility uses an allowlist (computed / completed / ready) plus
    // explicit aliases for historical fixture compatibility:
    //   'complete' (singular) → 'completed'
    //   'ok' / 'success' → 'completed'
    // Whitespace and case are normalised. Unknown future PLoT statuses
    // are NOT silently accepted (covered in the next test).
    for (const status of ['computed', 'completed', 'ready', 'complete', 'ok', 'success', 'COMPUTED', '  ready  ']) {
      const facts: readonly HandlerFact[] = [
        mkRunAnalysisFact({
          graph_hash_at_run: 'h1h1h1h1h1h1h1h1',
          computed_at: '2026-04-30T00:00:00.000Z',
          status,
        }),
      ];
      const r = deriveAnalysisFreshness(facts, 'h1h1h1h1h1h1h1h1');
      expect(r.freshness).toBe('fresh');
    }
  });

  it('rejects unknown / future PLoT statuses (closed allowlist)', () => {
    // Forward safety: a future PLoT status like "inconclusive" should
    // NOT be silently accepted as successful. The fact is excluded from
    // selection; freshness === 'none'.
    for (const status of ['inconclusive', 'incomplete', 'pending', 'queued', 'analyzing']) {
      const facts: readonly HandlerFact[] = [
        mkRunAnalysisFact({
          graph_hash_at_run: 'h1h1h1h1h1h1h1h1',
          computed_at: '2026-04-30T00:00:00.000Z',
          status,
        }),
      ];
      const r = deriveAnalysisFreshness(facts, 'h1h1h1h1h1h1h1h1');
      expect(r.freshness).toBe('none');
    }
  });

  it('selects newest by computed_at, not insertion order', () => {
    // priorFacts is delivered newest-first by the loader, so insertion
    // order [t2, t1] but the function must rely on computed_at desc — if
    // the order were reversed (t1, t2) the function should still pick t2.
    const earlier = mkRunAnalysisFact({
      graph_hash_at_run: 'old_hash_old_hash',
      computed_at: '2026-04-30T00:00:00.000Z',
      status: 'computed',
    });
    const later = mkRunAnalysisFact({
      graph_hash_at_run: 'new_hash_new_hash',
      computed_at: '2026-04-30T01:00:00.000Z',
      status: 'computed',
    });
    // Pass them with the older one first — function must still pick the
    // newer based on computed_at.
    const r = deriveAnalysisFreshness([earlier, later], 'new_hash_new_hash');
    expect(r.freshness).toBe('fresh');
    expect(r.graph_hash_at_run).toBe('new_hash_new_hash');
  });
});

describe('deriveAnalysisFreshness — stale', () => {
  it('different hashes → stale, reason graph_hash_diverged', () => {
    const facts: readonly HandlerFact[] = [
      mkRunAnalysisFact({
        graph_hash_at_run: 'old_hash_old_hash',
        computed_at: '2026-04-30T00:00:00.000Z',
        status: 'computed',
      }),
    ];
    const r = deriveAnalysisFreshness(facts, 'new_hash_new_hash');
    expect(r.freshness).toBe('stale');
    expect(r.reason).toBe('graph_hash_diverged');
    expect(r.graph_hash_at_run).toBe('old_hash_old_hash');
    expect(r.current_graph_hash).toBe('new_hash_new_hash');
    expect(r.computed_at).toBe('2026-04-30T00:00:00.000Z');
  });
});

describe('deriveAnalysisFreshness — unknown', () => {
  it('legacy fact (no graph_hash_at_run) → unknown, legacy_fact_missing_hash', () => {
    const facts: readonly HandlerFact[] = [
      mkRunAnalysisFact({
        graph_hash_at_run: null, // omitted on the fact
        computed_at: '2026-04-30T00:00:00.000Z',
        status: 'computed',
      }),
    ];
    const r = deriveAnalysisFreshness(facts, 'h1');
    expect(r.freshness).toBe('unknown');
    expect(r.reason).toBe('legacy_fact_missing_hash');
    expect(r.graph_hash_at_run).toBeNull();
    expect(r.computed_at).toBe('2026-04-30T00:00:00.000Z');
  });

  it('current graph hash null (no graph this turn) → unknown', () => {
    const facts: readonly HandlerFact[] = [
      mkRunAnalysisFact({
        graph_hash_at_run: 'h1',
        computed_at: '2026-04-30T00:00:00.000Z',
        status: 'computed',
      }),
    ];
    const r = deriveAnalysisFreshness(facts, null);
    expect(r.freshness).toBe('unknown');
    expect(r.reason).toBe('current_graph_hash_unavailable');
    expect(r.graph_hash_at_run).toBe('h1');
    expect(r.current_graph_hash).toBeNull();
  });

  it('legacy fact with no computed_at → unknown, computed_at returned as null', () => {
    const facts: readonly HandlerFact[] = [
      mkRunAnalysisFact({
        graph_hash_at_run: null,
        computed_at: null,
        status: 'computed',
      }),
    ];
    const r = deriveAnalysisFreshness(facts, 'h1');
    expect(r.freshness).toBe('unknown');
    expect(r.computed_at).toBeNull();
  });
});

describe('deriveAnalysisFreshness — selection ordering', () => {
  it('mixes legacy and 0.10.0 facts; picks newest by computed_at when present', () => {
    const legacy = mkRunAnalysisFact({
      // No graph_hash_at_run, no computed_at
      status: 'computed',
    });
    const modern = mkRunAnalysisFact({
      graph_hash_at_run: 'modern_hash_aaaa',
      computed_at: '2026-04-30T01:00:00.000Z',
      status: 'computed',
    });
    // Legacy first, modern second — function must pick modern (timestamped > untimestamped).
    const r = deriveAnalysisFreshness([legacy, modern], 'modern_hash_aaaa');
    expect(r.freshness).toBe('fresh');
    expect(r.graph_hash_at_run).toBe('modern_hash_aaaa');
  });

  it('two facts, same computed_at → stable insertion order (newest-first per loader)', () => {
    // build-turn-context delivers facts newest-first. When two facts share
    // an exact millisecond timestamp, the first in the input array wins.
    const a = mkRunAnalysisFact({
      graph_hash_at_run: 'hash_a__________',
      computed_at: '2026-04-30T00:00:00.000Z',
      status: 'computed',
    });
    const b = mkRunAnalysisFact({
      graph_hash_at_run: 'hash_b__________',
      computed_at: '2026-04-30T00:00:00.000Z',
      status: 'computed',
    });
    const r = deriveAnalysisFreshness([a, b], 'hash_a__________');
    expect(r.freshness).toBe('fresh');
    expect(r.graph_hash_at_run).toBe('hash_a__________');
  });

  it('partial fact present alongside successful one → successful selected', () => {
    const partial = mkRunAnalysisFact({
      graph_hash_at_run: 'partial_hash____',
      computed_at: '2026-04-30T02:00:00.000Z', // newer
      status: 'partial',
    });
    const success = mkRunAnalysisFact({
      graph_hash_at_run: 'success_hash____',
      computed_at: '2026-04-30T01:00:00.000Z', // older
      status: 'computed',
    });
    const r = deriveAnalysisFreshness([partial, success], 'success_hash____');
    expect(r.freshness).toBe('fresh');
    expect(r.graph_hash_at_run).toBe('success_hash____');
  });
});

describe('deriveAnalysisFreshness — wire-field fidelity', () => {
  it('always populates current_graph_hash on every verdict', () => {
    const facts: readonly HandlerFact[] = [
      mkRunAnalysisFact({
        graph_hash_at_run: 'h1',
        computed_at: '2026-04-30T00:00:00.000Z',
        status: 'computed',
      }),
    ];
    expect(deriveAnalysisFreshness(facts, 'h1').current_graph_hash).toBe('h1');
    expect(deriveAnalysisFreshness(facts, 'h2').current_graph_hash).toBe('h2');
    expect(deriveAnalysisFreshness([], 'h3').current_graph_hash).toBe('h3');
    expect(deriveAnalysisFreshness([], null).current_graph_hash).toBeNull();
  });

  it('selected_fact_index references position in the input array', () => {
    const a = mkRunAnalysisFact({
      graph_hash_at_run: 'hash_a__________',
      computed_at: '2026-04-30T00:00:00.000Z',
      status: 'computed',
    });
    const b = mkRunAnalysisFact({
      graph_hash_at_run: 'hash_b__________',
      computed_at: '2026-04-30T01:00:00.000Z', // newer
      status: 'computed',
    });
    // Newer fact at index 1 should be selected.
    const r = deriveAnalysisFreshness([a, b], 'hash_b__________');
    expect(r.selected_fact_index).toBe(1);
  });
});

describe('enforceInvariants — hard invariant violations', () => {
  // Production code paths cannot construct this state through the regular
  // decision tree, but the enforcer is the defence-in-depth backstop. The
  // test injects an artificial violation by hand-rolling the derivation,
  // exercising the fallback so a future code change that breaks the
  // exhaustive tree fails this test rather than shipping bad freshness.

  it('both hashes present + freshness=unknown → coerced to unknown / invariant_failed', () => {
    // This is the impossible state: if both hashes are present the
    // derivation must produce fresh or stale, never unknown. Force it.
    const violating: FreshnessDerivation = {
      freshness: 'unknown',
      reason: 'graph_hash_match', // pretend the decision tree produced this
      selected_fact_index: 0,
      graph_hash_at_run: 'aaaa1111bbbb2222',
      current_graph_hash: 'aaaa1111bbbb2222',
      computed_at: '2026-04-30T00:00:00.000Z',
    };
    const enforced = enforceInvariants(violating);
    expect(enforced.freshness).toBe('unknown');
    expect(enforced.reason).toBe('invariant_failed');
    // Other fields untouched
    expect(enforced.selected_fact_index).toBe(0);
    expect(enforced.graph_hash_at_run).toBe('aaaa1111bbbb2222');
    expect(enforced.current_graph_hash).toBe('aaaa1111bbbb2222');
    expect(enforced.computed_at).toBe('2026-04-30T00:00:00.000Z');
  });

  it('valid fresh derivation passes through unchanged', () => {
    const valid: FreshnessDerivation = {
      freshness: 'fresh',
      reason: 'graph_hash_match',
      selected_fact_index: 0,
      graph_hash_at_run: 'h1',
      current_graph_hash: 'h1',
      computed_at: '2026-04-30T00:00:00.000Z',
    };
    expect(enforceInvariants(valid)).toEqual(valid);
  });

  it('valid stale derivation passes through unchanged', () => {
    const valid: FreshnessDerivation = {
      freshness: 'stale',
      reason: 'graph_hash_diverged',
      selected_fact_index: 0,
      graph_hash_at_run: 'h1',
      current_graph_hash: 'h2',
      computed_at: '2026-04-30T00:00:00.000Z',
    };
    expect(enforceInvariants(valid)).toEqual(valid);
  });

  it('legitimate unknown (one hash missing) passes through', () => {
    // Hash-data-missing is a real reason for unknown; not a violation.
    const valid: FreshnessDerivation = {
      freshness: 'unknown',
      reason: 'legacy_fact_missing_hash',
      selected_fact_index: 0,
      graph_hash_at_run: null,
      current_graph_hash: 'h1',
      computed_at: '2026-04-30T00:00:00.000Z',
    };
    expect(enforceInvariants(valid)).toEqual(valid);
  });

  it('legitimate none (no fact selected) passes through', () => {
    const valid: FreshnessDerivation = {
      freshness: 'none',
      reason: 'no_successful_run_analysis_fact',
      selected_fact_index: null,
      graph_hash_at_run: null,
      current_graph_hash: 'h1',
      computed_at: null,
    };
    expect(enforceInvariants(valid)).toEqual(valid);
  });
});
