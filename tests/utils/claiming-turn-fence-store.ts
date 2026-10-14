/** Real SupabaseSessionStore fence methods over a local row backend, as in the fence exemption suite. */
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseSessionStore } from '../../src/orchestrator-v5/session/supabase-store.js';
import { SessionLRUCache } from '../../src/orchestrator-v5/session/cache.js';
import { TURN_FENCE_RPC } from '../../src/orchestrator-v5/session/turn-fence.js';

interface FenceQuery {
  select(columns: string): FenceQuery;
  update(values: Record<string, unknown>): FenceQuery;
  eq(key: string, value: unknown): FenceQuery;
  neq(key: string, value: unknown): FenceQuery;
  is(key: string, value: unknown): FenceQuery;
  limit(count: number): FenceQuery;
  then(resolve: (result: { data: Array<Record<string, unknown>>; error: null }) => unknown): Promise<unknown>;
}

export function claimingTurnFenceStore() {
  const rows: Array<Record<string, unknown>> = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn !== TURN_FENCE_RPC.claim) throw new Error(`Unexpected fence RPC: ${fn}`);
      let row = rows.find(r => r.scenario_id === args.p_scenario_id && r.turn_id === args.p_turn_id);
      if (!row) {
        row = { scenario_id: args.p_scenario_id, turn_id: args.p_turn_id, generation: rows.length + 1,
          stopped_at: null, graph_write_failed_at: null, graph_write_failure_reason: null,
          graph_loss_disclosable_at: null };
        rows.push(row);
      }
      return { data: row.generation, error: null };
    },
    from: (table: string) => {
      if (table !== 'v5_turn_fence') throw new Error(`Unexpected fence table: ${table}`);
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let update: Record<string, unknown> | undefined;
      let limit = Infinity;
      const query: FenceQuery = {
        select: (_columns: string) => query,
        update: (values: Record<string, unknown>) => { update = values; return query; },
        eq: (key: string, value: unknown) => { filters.push(r => r[key] === value); return query; },
        neq: (key: string, value: unknown) => { filters.push(r => r[key] !== value); return query; },
        is: (key: string, value: unknown) => { filters.push(r => r[key] === value); return query; },
        limit: (count: number) => { limit = count; return query; },
        then: (resolve: (result: { data: Array<Record<string, unknown>>; error: null }) => unknown) => {
          const matches = rows.filter(r => filters.every(f => f(r))).slice(0, limit);
          if (update) matches.forEach(r => Object.assign(r, update));
          return Promise.resolve(resolve({ data: matches, error: null }));
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const store = new SupabaseSessionStore(client,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }), { defaultReadLimit: 20 });
  return { rows, store };
}
