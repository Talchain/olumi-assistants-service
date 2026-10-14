/**
 * ⭐ B RESTATED GOAL — `SupabaseSessionStore.readCommittedTurnLedger`: which turns committed a model write, which carry a
 * user message, the first message's text only, and whether the read covered the whole scenario. Row shapes are the served
 * marketing scenario's own (`v5_conversation_turns`, scenario 17c98e69, 12 Oct, read-only SQL): a claim row and an answer
 * row share a turn id; the construction's registration row and a UI edit carry `model_version_mutation_id`.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';

const SCENARIO = '17c98e69-9a7d-4d5d-a11c-cca6b61b4155';

function storeOver(result: { data: unknown; error: unknown }) {
  const seen: { table?: string; cols?: string; filters: Record<string, unknown>; limit?: number } = { filters: {} };
  const chain: Record<string, unknown> = {
    select: (cols: string) => { seen.cols = cols; return chain; },
    eq: (col: string, val: unknown) => { seen.filters[`eq:${col}`] = val; return chain; },
    order: (col: string, opts: unknown) => { seen.filters[`order:${col}`] = opts; return chain; },
    limit: (n: number) => { seen.limit = n; return Promise.resolve(result); },
  };
  const client = { from: vi.fn((table: string) => { seen.table = table; return chain; }) } as unknown as SupabaseClient;
  return { seen, store: new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }), { defaultReadLimit: 20 }) };
}

const row = (turn_id: string, user_message: string | null, mutation: string | null, at: string) =>
  ({ id: `${turn_id}-${at}`, turn_id, user_message, model_version_mutation_id: mutation, created_at: at });

describe('readCommittedTurnLedger', () => {
  it('commit turns and message turns, distinct and oldest first; the first message\'s text as the brief, the later ones as context; scoped to the scenario', async () => {
    const { store, seen } = storeOver({ data: [
      row('brief-turn', '', null, '02:12:58'),
      row('graph_registration:c3beefc1-8cdc-4a6e-b7ae-5b1bac596790', null, 'b5d33658-68ae-52f1-addc-2d70e062cd4b', '02:14:02'),
      row('brief-turn', '  Should I hire a marketing manager?  ', null, '02:14:22'),
      row('l20-turn', '', null, '02:14:32'),
      row('l20-turn', 'I have two goals', null, '02:15:12'),
      row('ui-edit-turn', null, '42d06887-fc65-5723-a71f-2394157aa500', '02:18:35'),
    ], error: null });
    await expect(store.readCommittedTurnLedger(SCENARIO)).resolves.toEqual({
      write_turn_ids: ['graph_registration:c3beefc1-8cdc-4a6e-b7ae-5b1bac596790', 'ui-edit-turn'],
      user_message_turn_ids: ['brief-turn', 'l20-turn'],
      first_user_message: 'Should I hire a marketing manager?',
      later_user_messages: [{ turn_id: 'l20-turn', text: 'I have two goals' }],
      complete: true,
    });
    expect(seen.table).toBe('v5_conversation_turns');
    expect(seen.filters['eq:scenario_id']).toBe(SCENARIO);
    expect(seen.cols).not.toMatch(/assistant_message|pending_actions/);
  });

  it('one row past the cap marks the ledger incomplete (not a census)', async () => {
    const { store, seen } = storeOver({ data: [], error: null });
    await store.readCommittedTurnLedger(SCENARIO);
    const cap = seen.limit! - 1;
    const many = Array.from({ length: cap + 1 }, (_, i) => row(`t${i}`, null, null, String(i).padStart(4, '0')));
    await expect(storeOver({ data: many, error: null }).store.readCommittedTurnLedger(SCENARIO)).resolves.toMatchObject({ complete: false });
    await expect(storeOver({ data: many.slice(0, cap), error: null }).store.readCommittedTurnLedger(SCENARIO)).resolves.toMatchObject({ complete: true });
  });

  it('a failed or malformed read throws: unknown, never "nothing written"', async () => {
    await expect(storeOver({ data: null, error: { message: 'read unavailable' } }).store.readCommittedTurnLedger(SCENARIO)).rejects.toThrow(/failed/);
    await expect(storeOver({ data: null, error: null }).store.readCommittedTurnLedger(SCENARIO)).rejects.toThrow(/non-array/);
    await expect(storeOver({ data: [row('', 'x', null, '1')], error: null }).store.readCommittedTurnLedger(SCENARIO)).rejects.toThrow(/no turn id/);
  });
});
