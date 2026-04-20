import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mutable mock config so individual tests can flip the flag
const mockConfig = {
  cee: {
    turnDebugEnabled: true,
  },
};

vi.mock('../../../config/index.js', () => ({ config: mockConfig }));

// Dynamic import after mock is registered
const { storeTurnDebug, getTurnDebug, getTurnDebugStoreSize, clearTurnDebugStore } =
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
});
