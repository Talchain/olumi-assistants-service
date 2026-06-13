/**
 * Track S 0.13c-4 — persist-site intercept repair coverage of the SECOND
 * scenarios.graph write RPC (store_draft_graph). storeDraftGraph is dead on the
 * live V5 path today but reserved for out-of-band admin/migration use; this proves
 * it now also strips duplicate observed-root intercepts before persisting, so the
 * persist-site coverage is airtight (both write RPCs repaired).
 */
import { describe, it, expect, vi } from 'vitest';

import { SupabaseSessionStore } from '../../../../src/orchestrator-v5/session/supabase-store.js';

function makeStore() {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  // storeDraftGraph only touches this.client.rpc; cache/options are unused on this path.
  const store = new SupabaseSessionStore({ rpc } as never, {} as never, {} as never);
  return { store, rpc };
}

describe('SupabaseSessionStore.storeDraftGraph — persist-site intercept repair (Track S 0.13c-4)', () => {
  it('repairs duplicate observed-root intercepts before the store_draft_graph RPC; preserves shape + non-equal', async () => {
    const { store, rpc } = makeStore();
    const dirty = {
      nodes: [
        { id: 'fac_dup', kind: 'factor', label: 'D', observed_state: { value: 0.5 }, intercept: 0.5 },
        { id: 'fac_keep', kind: 'factor', label: 'K', observed_state: { value: 0.9 }, intercept: 0.3 },
      ],
      edges: [],
      goal_node_id: 'goal_1',
      options: [{ id: 'opt_a' }],
    };
    await store.storeDraftGraph('sc-1', dirty);

    expect(rpc).toHaveBeenCalledTimes(1);
    const [rpcName, args] = rpc.mock.calls[0] as [string, { p_scenario_id: string; p_graph: typeof dirty }];
    expect(rpcName).toBe('store_draft_graph');
    expect(args.p_scenario_id).toBe('sc-1');
    expect('intercept' in args.p_graph.nodes[0]!).toBe(false);                  // duplicate removed
    expect((args.p_graph.nodes[1] as Record<string, unknown>).intercept).toBe(0.3); // non-equal preserved
    expect(args.p_graph.goal_node_id).toBe('goal_1');                            // D1 shape preserved
    expect(args.p_graph.options).toEqual([{ id: 'opt_a' }]);
    expect((dirty.nodes[0] as Record<string, unknown>).intercept).toBe(0.5);     // input not mutated (clone)
  });

  it('no-ops on absent graph (coerces p_graph to null → scenarios.graph unchanged)', async () => {
    const { store, rpc } = makeStore();
    await store.storeDraftGraph('sc-2', undefined);
    expect((rpc.mock.calls[0]![1] as { p_graph: unknown }).p_graph).toBeNull();
  });

  it('passes a clean graph through unchanged', async () => {
    const { store, rpc } = makeStore();
    const clean = { nodes: [{ id: 'f', kind: 'factor', observed_state: { value: 0.2 } }], edges: [] };
    await store.storeDraftGraph('sc-3', clean);
    expect((rpc.mock.calls[0]![1] as { p_graph: unknown }).p_graph).toEqual(clean);
  });
});
