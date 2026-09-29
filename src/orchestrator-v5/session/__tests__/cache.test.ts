/**
 * SessionLRUCache unit tests (slice B).
 *
 * Focus on boundary conditions: LRU eviction order, per-scenario bounds,
 * stale-filtering, and deep-freeze of returned snapshots. Tests assert
 * content, not shape.
 */

import { describe, it, expect } from 'vitest';

import type { SessionTurn } from '@talchain/schemas/orchestrator';
import { SessionLRUCache } from '../cache.js';

function makeTurn(scenarioId: string, turnId: string, createdAt: string): SessionTurn {
  return {
    id: `eeeeeeee-eeee-4eee-8eee-${turnId.padEnd(12, '0').slice(0, 12)}`,
    scenario_id: scenarioId,
    user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    turn_id: turnId,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `sha256:${turnId}`,
    response_emitted: true,
    llm_calls_used: 2,
    duration_ms: 123,
    created_at: createdAt,
  };
}

const CFG = { maxScenarios: 3, maxTurnsPerScenario: 5 };

describe('SessionLRUCache', () => {
  it('returns null for an uncached scenario', () => {
    const cache = new SessionLRUCache(CFG);
    expect(cache.getScenario('s1')).toBeNull();
  });

  it('populate + getScenario returns the populated turns (count match)', () => {
    const cache = new SessionLRUCache(CFG);
    const t1 = makeTurn('s1', 'turn-1', '2026-04-17T10:00:00Z');
    const t2 = makeTurn('s1', 'turn-2', '2026-04-17T11:00:00Z');
    cache.populate('s1', [t2, t1]);
    const got = cache.getScenario('s1');
    expect(got).not.toBeNull();
    expect(got!.turns.map((t) => t.turn_id)).toEqual(['turn-2', 'turn-1']);
  });

  it('returned snapshot is deep-frozen (recursive freeze)', () => {
    const cache = new SessionLRUCache(CFG);
    const t = makeTurn('s1', 'turn-1', '2026-04-17T10:00:00Z');
    cache.populate('s1', [t]);
    const got = cache.getScenario('s1');
    expect(Object.isFrozen(got!.turns)).toBe(true);
    expect(Object.isFrozen(got!.turns[0])).toBe(true);
    expect(() => {
      (got!.turns[0] as unknown as { turn_class: string }).turn_class = 'hacked';
    }).toThrow();
  });

  it('LRU eviction: oldest scenario dropped when maxScenarios exceeded', () => {
    const cache = new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 5 });
    cache.populate('s1', [makeTurn('s1', 't1', '2026-04-17T10:00:00Z')]);
    cache.populate('s2', [makeTurn('s2', 't2', '2026-04-17T10:00:00Z')]);
    cache.populate('s3', [makeTurn('s3', 't3', '2026-04-17T10:00:00Z')]);
    expect(cache.size()).toBe(2);
    expect(cache.getScenario('s1')).toBeNull(); // oldest evicted
    expect(cache.getScenario('s2')).not.toBeNull();
    expect(cache.getScenario('s3')).not.toBeNull();
  });

  it('LRU bump: getScenario moves scenario to most-recently-used position', () => {
    const cache = new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 5 });
    cache.populate('s1', [makeTurn('s1', 't1', '2026-04-17T10:00:00Z')]);
    cache.populate('s2', [makeTurn('s2', 't2', '2026-04-17T10:00:00Z')]);
    // Access s1 to bump it
    void cache.getScenario('s1');
    // Populating s3 should now evict s2 (the now-LRU), not s1
    cache.populate('s3', [makeTurn('s3', 't3', '2026-04-17T10:00:00Z')]);
    expect(cache.getScenario('s1')).not.toBeNull();
    expect(cache.getScenario('s2')).toBeNull();
    expect(cache.getScenario('s3')).not.toBeNull();
  });

  it('populate enforces maxTurnsPerScenario — keeps first N', () => {
    const cache = new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 3 });
    const turns = Array.from({ length: 7 }, (_, i) =>
      makeTurn('s1', `t${i}`, `2026-04-17T1${i}:00:00Z`),
    );
    cache.populate('s1', turns);
    const got = cache.getScenario('s1')!;
    expect(got.turns.length).toBe(3);
    expect(got.turns.map((t) => t.turn_id)).toEqual(['t0', 't1', 't2']);
  });

  it('populate with complete=true marks the cache entry authoritative', () => {
    const cache = new SessionLRUCache(CFG);
    cache.populate('s1', [makeTurn('s1', 't1', '2026-04-17T10:00:00Z')], { complete: true });
    const got = cache.getScenario('s1')!;
    expect(got.complete).toBe(true);
  });

  it('populate with complete=true is downgraded when bounded by maxTurnsPerScenario', () => {
    const cache = new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 2 });
    cache.populate(
      's1',
      [
        makeTurn('s1', 't1', '2026-04-17T10:00:00Z'),
        makeTurn('s1', 't2', '2026-04-17T11:00:00Z'),
        makeTurn('s1', 't3', '2026-04-17T12:00:00Z'),
      ],
      { complete: true },
    );
    const got = cache.getScenario('s1')!;
    // The caller lied about completeness (or maxTurns is misconfigured).
    // Cache refuses to claim completeness because data was truncated.
    expect(got.complete).toBe(false);
  });

  it('invalidateScoped on uncached scenario returns empty result', () => {
    const cache = new SessionLRUCache(CFG);
    const result = cache.invalidateScoped('nonexistent', { kind: 'structural' });
    expect(result.entries_invalidated).toEqual([]);
    expect(result.scope.kind).toBe('structural');
  });

  it('invalidateScoped(structural) marks every turn stale', () => {
    const cache = new SessionLRUCache(CFG);
    cache.populate('s1', [
      makeTurn('s1', 't1', '2026-04-17T10:00:00Z'),
      makeTurn('s1', 't2', '2026-04-17T11:00:00Z'),
    ]);
    const result = cache.invalidateScoped('s1', { kind: 'structural' });
    expect(result.entries_invalidated).toEqual(expect.arrayContaining(['t1', 't2']));
    expect(result.entries_invalidated.length).toBe(2);
  });

  it('invalidateScoped(factor) in slice B marks all turns stale (pessimistic, per cache.ts doc)', () => {
    const cache = new SessionLRUCache(CFG);
    cache.populate('s1', [
      makeTurn('s1', 't1', '2026-04-17T10:00:00Z'),
      makeTurn('s1', 't2', '2026-04-17T11:00:00Z'),
    ]);
    const result = cache.invalidateScoped('s1', { kind: 'factor', factorId: 'factor-x' });
    expect(result.entries_invalidated.length).toBe(2);
  });

  it('after invalidation getScenario filters stale turns from snapshot', () => {
    const cache = new SessionLRUCache(CFG);
    cache.populate('s1', [
      makeTurn('s1', 't1', '2026-04-17T10:00:00Z'),
      makeTurn('s1', 't2', '2026-04-17T11:00:00Z'),
    ]);
    cache.invalidateScoped('s1', { kind: 'structural' });
    const got = cache.getScenario('s1');
    expect(got).not.toBeNull();
    expect(got!.turns.length).toBe(0); // all stale, filtered out
  });

  it('invalidateAll evicts the scenario (next get returns null)', () => {
    const cache = new SessionLRUCache(CFG);
    cache.populate('s1', [makeTurn('s1', 't1', '2026-04-17T10:00:00Z')]);
    cache.invalidateAll('s1');
    expect(cache.getScenario('s1')).toBeNull();
  });

  it('invalidateAll returns the invalidated turn ids', () => {
    const cache = new SessionLRUCache(CFG);
    cache.populate('s1', [
      makeTurn('s1', 't1', '2026-04-17T10:00:00Z'),
      makeTurn('s1', 't2', '2026-04-17T11:00:00Z'),
    ]);
    const result = cache.invalidateAll('s1');
    expect(result.entries_invalidated).toEqual(['t1', 't2']);
  });

  it('prepend on cached scenario adds turn to front + bumps LRU', () => {
    const cache = new SessionLRUCache(CFG);
    cache.populate('s1', [makeTurn('s1', 'old', '2026-04-17T10:00:00Z')]);
    cache.prepend('s1', makeTurn('s1', 'new', '2026-04-17T12:00:00Z'));
    const got = cache.getScenario('s1')!;
    expect(got.turns[0].turn_id).toBe('new');
    expect(got.turns[1].turn_id).toBe('old');
  });

  it('prepend on uncached scenario is a no-op (next read repopulates from DB)', () => {
    const cache = new SessionLRUCache(CFG);
    cache.prepend('nonexistent', makeTurn('nonexistent', 'new', '2026-04-17T12:00:00Z'));
    expect(cache.getScenario('nonexistent')).toBeNull();
  });

  it('constructor rejects non-positive bounds', () => {
    expect(() => new SessionLRUCache({ maxScenarios: 0, maxTurnsPerScenario: 5 })).toThrow();
    expect(() => new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 0 })).toThrow();
    expect(() => new SessionLRUCache({ maxScenarios: -1, maxTurnsPerScenario: 5 })).toThrow();
  });

  it('prepend respects maxTurnsPerScenario (drops oldest)', () => {
    const cache = new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 2 });
    cache.populate('s1', [
      makeTurn('s1', 't1', '2026-04-17T10:00:00Z'),
      makeTurn('s1', 't2', '2026-04-17T11:00:00Z'),
    ]);
    cache.prepend('s1', makeTurn('s1', 't3', '2026-04-17T12:00:00Z'));
    const got = cache.getScenario('s1')!;
    expect(got.turns.length).toBe(2);
    expect(got.turns.map((t) => t.turn_id)).toEqual(['t3', 't1']); // t2 dropped
  });

  it('prepend downgrades completeness when it drops a turn from a complete cache', () => {
    const cache = new SessionLRUCache({ maxScenarios: 2, maxTurnsPerScenario: 2 });
    cache.populate(
      's1',
      [makeTurn('s1', 't1', '2026-04-17T10:00:00Z'), makeTurn('s1', 't2', '2026-04-17T11:00:00Z')],
      { complete: true },
    );
    expect(cache.getScenario('s1')!.complete).toBe(true);
    cache.prepend('s1', makeTurn('s1', 't3', '2026-04-17T12:00:00Z'));
    expect(cache.getScenario('s1')!.complete).toBe(false);
  });
});
