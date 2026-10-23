/**
 * The core turn's Stop read (`SupabaseSessionStore.turnWasStopped`, DL 93d79c3e 09:40Z): this exact (scenario, turn) row's
 * `stopped_at`, by a direct read of `v5_turn_fence`. A client double that records the query it was asked.
 */
import { describe, expect, it, vi } from 'vitest';
import { SupabaseSessionStore } from '../supabase-store.js';

function storeAnswering(answer: { data: unknown; error: unknown }) {
  const asked: unknown[][] = [];
  const query = {
    select: vi.fn((...a: unknown[]) => { asked.push(['select', ...a]); return query; }),
    eq: vi.fn((...a: unknown[]) => { asked.push(['eq', ...a]); return query; }),
    maybeSingle: vi.fn(async () => answer),
  };
  const client = { from: vi.fn((table: string) => { asked.push(['from', table]); return query; }) };
  return { store: new SupabaseSessionStore(client as never, {} as never, { defaultReadLimit: 20 } as never), asked };
}

describe('turnWasStopped: one fence row\'s tombstone', () => {
  it('reads exactly that row: a tombstone is true; no tombstone, or no row, is false', async () => {
    const stopped = storeAnswering({ data: { stopped_at: '2026-10-23T10:00:00.000Z' }, error: null });
    expect(await stopped.store.turnWasStopped('scn', 'turn')).toBe(true);
    expect(stopped.asked).toEqual([['from', 'v5_turn_fence'], ['select', 'stopped_at'], ['eq', 'scenario_id', 'scn'], ['eq', 'turn_id', 'turn']]);
    expect(await storeAnswering({ data: { stopped_at: null }, error: null }).store.turnWasStopped('scn', 'turn')).toBe(false);
    expect(await storeAnswering({ data: null, error: null }).store.turnWasStopped('scn', 'turn')).toBe(false);
  });

  it('⛔ a failed read throws, never a quiet "not stopped": the caller decides', async () => {
    await expect(storeAnswering({ data: null, error: { message: 'boom' } }).store.turnWasStopped('scn', 'turn')).rejects.toThrow('stop read failed');
  });
});
