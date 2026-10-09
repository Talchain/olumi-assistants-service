import type { SupabaseClient } from '@supabase/supabase-js';
import { HandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { loadCorpus } from '../../../../scripts/phase2/parity-2b.js';
import { SessionLRUCache } from '../../session/cache.js';
import { SupabaseSessionStore } from '../../session/supabase-store.js';
import type { SessionStore } from '../../session/store.js';

export const ANCHOR_SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export function anchorFact(runId: string, computedAt: string | undefined, status = 'computed'): HandlerFact {
  const source = structuredClone(loadCorpus()[0]!.fact) as { result: Record<string, unknown> };
  source.result.scenario_id = ANCHOR_SCENARIO;
  source.result.run_id = runId;
  source.result.graph_hash_at_run = `hash-${runId}`;
  if (computedAt === undefined) delete source.result.computed_at;
  else source.result.computed_at = computedAt;
  (source.result.enrichment as Record<string, unknown>).analysis_status = status;
  return HandlerFactSchema.parse(source);
}
export function anchorRow(fact: unknown, n: number, createdAt: string) {
  return { id: `712b0000-0000-4000-8002-${String(n).padStart(12, '0')}`,
    scenario_id: ANCHOR_SCENARIO, v5_conversation_turn_id: '712b0000-0000-4000-8003-000000000001',
    handler_id: 'run_analysis', action_type: 'run_analysis', noop: false, payload: fact, created_at: createdAt };
}
export type AnchorRow = ReturnType<typeof anchorRow>;

/** Real durable storage decoder + loader/reconciler; only PostgREST transport and empty hot window are faked. */
export function anchorFixture(rows: AnchorRow[], totalCount = rows.length, failure = false) {
  const queries: string[] = [];
  const client = { from(table: string) {
    queries.push(table);
    let limit = rows.length;
    let handler = 'run_analysis';
    const orders: { column: string; ascending: boolean }[] = [];
    const builder = {
      select() { return builder; },
      eq(column: string, value: unknown) { if (column === 'handler_id') handler = String(value); return builder; },
      gt() { return builder; },
      order(column: string, opts: { ascending: boolean }) { orders.push({ column, ascending: opts.ascending }); return builder; },
      limit(value: number) { limit = value; return builder; },
      abortSignal() { return builder; },
      then(onfulfilled: (value: unknown) => unknown, onrejected?: (reason: unknown) => unknown) {
        const data = handler === 'edit_graph' ? [] : [...rows].sort((a, b) => {
          for (const order of orders) {
            const av = String(a[order.column as keyof AnchorRow]);
            const bv = String(b[order.column as keyof AnchorRow]);
            if (av !== bv) return (av < bv ? -1 : 1) * (order.ascending ? 1 : -1);
          }
          return 0;
        }).slice(0, limit);
        return Promise.resolve({ data: failure ? null : data,
          count: handler === 'edit_graph' ? 0 : totalCount, error: failure ? { message: 'read unavailable' } : null })
          .then(onfulfilled, onrejected);
      },
    };
    return builder;
  } } as unknown as SupabaseClient;
  const durable = new SupabaseSessionStore(client, new SessionLRUCache({ maxScenarios: 1, maxTurnsPerScenario: 20 }), { defaultReadLimit: 20 });
  const sessionStore = {
    readRecent: async () => [],
    readScenarioRunAnalysisFactsFor: durable.readScenarioRunAnalysisFactsFor.bind(durable),
  } as unknown as SessionStore;
  return { client, sessionStore, queries };
}
