/**
 * `readCommittedTurn` returns the resumable actions persisted WITH this exact turn, so a replay
 * of that turn can re-offer them (independent review of #1792, 5806428423). Scoped to the
 * scenario, tolerant of malformed entries, and a failed read is still an UNKNOWN (it throws).
 */
import { describe, expect, it, vi } from 'vitest';
import { SupabaseSessionStore } from '../supabase-store.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RUN = {
  id: 'pa-1', scenario_id: SCENARIO, chip_id: 'agent-run-analysis', action: { kind: 'run_analysis' },
  preconditions: {}, expires_at_turn_count: 2, expires_at_iso: '2099-01-01T00:00:00.000Z', emitted_at_iso: '2026-09-24T02:40:00.000Z',
};

function storeReturning(result: { data: unknown; error: unknown }) {
  const selected: string[] = [];
  const limit = vi.fn(async () => result);
  const client = { from: vi.fn(() => ({ select: vi.fn((cols: string) => { selected.push(cols); return { eq: () => ({ eq: () => ({ limit }) }) }; }) })) };
  const store = new SupabaseSessionStore(client as never, { invalidateAll: vi.fn() } as never, { defaultReadLimit: 20 } as never);
  return { store, selected };
}

describe('readCommittedTurn carries the turn\'s own persisted actions', () => {
  it('RED: selects pending_actions and returns this turn\'s parsed run_analysis offer', async () => {
    const { store, selected } = storeReturning({ data: [{ id: 'row-1', request_hash: 'h', assistant_message: 'Saved.', user_message: 'yes', llm_calls_used: 0, pending_actions: [RUN] }], error: null });
    const row = await store.readCommittedTurn(SCENARIO, 'turn-1');
    expect(selected[0]).toContain('pending_actions');
    expect(row?.pending_actions).toEqual([RUN]);
  });

  it('drops an entry for another scenario and a malformed entry; a non-array column reads as none', async () => {
    const { store } = storeReturning({ data: [{ id: 'row-1', request_hash: 'h', assistant_message: null, user_message: null, llm_calls_used: 0,
      pending_actions: [RUN, { ...RUN, id: 'pa-2', scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, { nonsense: true }] }], error: null });
    expect((await store.readCommittedTurn(SCENARIO, 'turn-1'))?.pending_actions).toEqual([RUN]);
    const { store: s2 } = storeReturning({ data: [{ id: 'row-1', request_hash: 'h', assistant_message: null, user_message: null, llm_calls_used: 0, pending_actions: null }], error: null });
    expect((await s2.readCommittedTurn(SCENARIO, 'turn-1'))?.pending_actions).toEqual([]);
  });

  it('a failed read is an unknown — it throws, never an empty offer that could permit re-execution', async () => {
    const { store } = storeReturning({ data: null, error: { message: 'boom' } });
    await expect(store.readCommittedTurn(SCENARIO, 'turn-1')).rejects.toThrow(/readCommittedTurn failed/);
  });
});
