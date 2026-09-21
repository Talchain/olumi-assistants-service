import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mutable mock config so individual tests can flip the flag
const mockConfig = {
  cee: {
    turnDebugEnabled: true,
  },
};

vi.mock('../../../config/index.js', () => ({ config: mockConfig }));

// Dynamic import after mock is registered
const { storeTurnDebug, getTurnDebug, getTurnDebugStoreSize, clearTurnDebugStore, recordModelResolution, recordFailureContext } =
  await import('../turn-debug-store.js');

import type { TurnDebugEntry } from '../turn-debug-store.js';

function makeEntry(turn_id: string, overrides: Partial<TurnDebugEntry> = {}): TurnDebugEntry {
  return {
    turn_id,
    session_id: 'sess-1',
    stored_at: Date.now(),
    cqe: {
      parsed_quantities: [],
      patterns_matched: ['rule_currency', 'rule_percent'],
      timeout: false,
      degraded: false,
      compromise_match_count: 0,
      duration_ms: 42,
      message_too_long: false,
      word_range_missed: false,
    },
    ...overrides,
  };
}

describe('TurnDebugStore', () => {
  beforeEach(() => {
    clearTurnDebugStore();
    mockConfig.cee.turnDebugEnabled = true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores and retrieves an entry', () => {
    const entry = makeEntry('turn-1');
    storeTurnDebug(entry);
    const result = getTurnDebug('turn-1');
    expect(result).toEqual(entry);
  });

  it('returns undefined for unknown turn_id', () => {
    expect(getTurnDebug('turn-missing')).toBeUndefined();
  });

  it("returns 'expired' when TTL has elapsed", () => {
    const past = Date.now() - 61 * 60 * 1000; // 61 minutes ago
    const entry = makeEntry('turn-old', { stored_at: past });
    storeTurnDebug(entry);
    expect(getTurnDebug('turn-old')).toBe('expired');
  });

  it('evicts oldest entry when max capacity is reached', () => {
    for (let i = 0; i < 500; i++) {
      storeTurnDebug(makeEntry(`turn-${i}`));
    }
    expect(getTurnDebugStoreSize()).toBe(500);
    storeTurnDebug(makeEntry('turn-overflow'));
    expect(getTurnDebugStoreSize()).toBe(500);
    expect(getTurnDebug('turn-0')).toBeUndefined();
    expect(getTurnDebug('turn-overflow')).toBeDefined();
  });

  it('reports store size correctly', () => {
    expect(getTurnDebugStoreSize()).toBe(0);
    storeTurnDebug(makeEntry('turn-a'));
    storeTurnDebug(makeEntry('turn-b'));
    expect(getTurnDebugStoreSize()).toBe(2);
  });

  it('preserves all CQE fields verbatim', () => {
    const entry = makeEntry('turn-fields', {
      cqe: {
        parsed_quantities: [{ raw_text: '50%', value: 50, unit: '%' } as never],
        patterns_matched: ['rule_percent'],
        timeout: true,
        degraded: true,
        compromise_match_count: 2,
        duration_ms: 187,
        message_too_long: false,
        word_range_missed: true,
      },
    });
    storeTurnDebug(entry);
    const result = getTurnDebug('turn-fields');
    expect(result).not.toBe('expired');
    expect(result?.cqe.timeout).toBe(true);
    expect(result?.cqe.compromise_match_count).toBe(2);
    expect(result?.cqe.word_range_missed).toBe(true);
    expect(result?.cqe.parsed_quantities).toHaveLength(1);
  });

  it('does not store when CEE_TURN_DEBUG_ENABLED is false', () => {
    mockConfig.cee.turnDebugEnabled = false;
    storeTurnDebug(makeEntry('turn-disabled'));
    expect(getTurnDebugStoreSize()).toBe(0);
  });

  it('clears all entries', () => {
    storeTurnDebug(makeEntry('turn-x'));
    clearTurnDebugStore();
    expect(getTurnDebugStoreSize()).toBe(0);
    expect(getTurnDebug('turn-x')).toBeUndefined();
  });

  describe('recordModelResolution', () => {
    it('appends a resolution record to an existing entry', () => {
      storeTurnDebug(makeEntry('turn-a'));
      recordModelResolution('turn-a', 'sess-1', {
        task: 'draft_graph',
        resolved_model: 'claude-sonnet-4-6',
        resolution_source: 'store_model_config',
      });
      const result = getTurnDebug('turn-a');
      expect(result).not.toBe('expired');
      if (!result || result === 'expired') throw new Error('unreachable');
      expect(result.model_resolutions).toHaveLength(1);
      expect(result.model_resolutions?.[0].resolution_source).toBe('store_model_config');
      expect(result.model_resolutions?.[0].resolved_model).toBe('claude-sonnet-4-6');
    });

    it('creates a minimal entry when no prior CQE entry exists', () => {
      recordModelResolution('turn-new', 'sess-new', {
        task: 'draft_graph',
        resolved_model: 'gpt-4.1-2025-04-14',
        resolution_source: 'task_default',
      });
      const result = getTurnDebug('turn-new');
      expect(result).not.toBe('expired');
      if (!result || result === 'expired') throw new Error('unreachable');
      expect(result.model_resolutions).toHaveLength(1);
      expect(result.cqe.parsed_quantities).toHaveLength(0);
      expect(result.session_id).toBe('sess-new');
    });

    it('preserves resolutions across a subsequent storeTurnDebug overwrite', () => {
      recordModelResolution('turn-order', 'sess-o', {
        task: 'draft_graph',
        resolved_model: 'claude-sonnet-4-6',
        resolution_source: 'per_call',
      });
      storeTurnDebug(makeEntry('turn-order'));
      const result = getTurnDebug('turn-order');
      expect(result).not.toBe('expired');
      if (!result || result === 'expired') throw new Error('unreachable');
      expect(result.model_resolutions).toHaveLength(1);
    });

    it('is a no-op when CEE_TURN_DEBUG_ENABLED is false', () => {
      mockConfig.cee.turnDebugEnabled = false;
      recordModelResolution('turn-off', 'sess-off', {
        task: 'draft_graph',
        resolved_model: 'gpt-4o',
        resolution_source: 'task_default',
      });
      expect(getTurnDebugStoreSize()).toBe(0);
    });

    it('preserves call order across multiple appends', () => {
      storeTurnDebug(makeEntry('turn-multi'));
      recordModelResolution('turn-multi', 'sess-m', {
        task: 'draft_graph',
        resolved_model: 'first',
        resolution_source: 'task_default',
      });
      recordModelResolution('turn-multi', 'sess-m', {
        task: 'repair_graph',
        resolved_model: 'second',
        resolution_source: 'env_var',
      });
      const result = getTurnDebug('turn-multi');
      if (!result || result === 'expired') throw new Error('unreachable');
      expect(result.model_resolutions?.map((r) => r.resolved_model)).toEqual(['first', 'second']);
    });
  });

  describe('recordFailureContext (V5 P0 stabilisation)', () => {
    it('attaches route_failure_type + freshness_summary to an existing entry', () => {
      storeTurnDebug(makeEntry('turn-fail-a'));
      recordFailureContext('turn-fail-a', 'sess-1', {
        route_failure_type: 'unexpected_stop_reason',
        freshness_summary: {
          freshness: 'fresh',
          freshness_reason: 'state_matches',
          analysis_status: 'success',
          leading_option_present: true,
        },
      });
      const result = getTurnDebug('turn-fail-a');
      if (!result || result === 'expired') throw new Error('unreachable');
      expect(result.route_failure_type).toBe('unexpected_stop_reason');
      expect(result.freshness_summary?.freshness).toBe('fresh');
      expect(result.freshness_summary?.leading_option_present).toBe(true);
    });

    it('creates a minimal entry when none exists (context-pack assembly never ran)', () => {
      recordFailureContext('turn-fail-b', 'sess-b', {
        route_failure_type: 'timeout',
      });
      const result = getTurnDebug('turn-fail-b');
      if (!result || result === 'expired') throw new Error('unreachable');
      expect(result.route_failure_type).toBe('timeout');
      expect(result.session_id).toBe('sess-b');
      // CQE skeleton is empty rather than undefined so admin-endpoint
      // consumers can still read the cqe section without conditional
      // chaining.
      expect(result.cqe.parsed_quantities).toHaveLength(0);
    });

    it('coexists with model_resolutions on the same turn', () => {
      recordModelResolution('turn-fail-c', 'sess-c', {
        task: 'orchestrator',
        resolved_model: 'claude-sonnet-4-6',
        resolution_source: 'task_default',
      });
      recordFailureContext('turn-fail-c', 'sess-c', {
        route_failure_type: 'schema_repair_failed',
      });
      const result = getTurnDebug('turn-fail-c');
      if (!result || result === 'expired') throw new Error('unreachable');
      expect(result.model_resolutions).toHaveLength(1);
      expect(result.route_failure_type).toBe('schema_repair_failed');
    });

    it('is a no-op when CEE_TURN_DEBUG_ENABLED is false', () => {
      mockConfig.cee.turnDebugEnabled = false;
      recordFailureContext('turn-fail-off', 'sess-off', {
        route_failure_type: 'unexpected_stop_reason',
      });
      expect(getTurnDebugStoreSize()).toBe(0);
    });

    // P2 merge-semantics regression guard (review): when
    // recordFailureContext writes first (creating a minimal entry)
    // and storeTurnDebug then overwrites with a CQE-only entry, the
    // failure fields must survive — mirrors the model_resolutions
    // preservation contract.
    it('preserves route_failure_type + freshness_summary across a subsequent storeTurnDebug overwrite', () => {
      recordFailureContext('turn-fail-order', 'sess-o', {
        route_failure_type: 'unexpected_stop_reason',
        freshness_summary: {
          freshness: 'fresh',
          analysis_status: 'success',
          leading_option_present: true,
        },
      });
      storeTurnDebug(makeEntry('turn-fail-order'));
      const result = getTurnDebug('turn-fail-order');
      if (!result || result === 'expired') throw new Error('unreachable');
      expect(result.route_failure_type).toBe('unexpected_stop_reason');
      expect(result.freshness_summary?.freshness).toBe('fresh');
      expect(result.freshness_summary?.leading_option_present).toBe(true);
      // CQE writer's content must also remain visible — the merge
      // preserves BOTH writers, not just one.
      expect(result.cqe.patterns_matched).toEqual(['rule_currency', 'rule_percent']);
    });
  });
});
