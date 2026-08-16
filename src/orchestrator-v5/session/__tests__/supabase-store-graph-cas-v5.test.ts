/**
 * Atomic graph CAS carried by the singular graph-only v5 append RPC.
 *
 * The runtime mode controls only the CAS arguments. It can never route a graph
 * through v2/v3/v4: missing v5 fails closed. A stateful fake pins the core
 * two-edits-from-one-base race without requiring external database access.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { _resetConfigCache, config } from '../../../config/index.js';
import {
  GRAPH_CAS_RPC_CONFLICT_SQLSTATE,
  computeExpectedGraphCasHashes,
  type GraphCasRpcMode,
} from '../../context/graph-cas-conflict.js';
import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import {
  GraphStaleWriteError,
  StateCommitFailedError,
  type SessionTurnWrite,
} from '../store.js';

const SCENARIO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ACK_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const BASE_GRAPH = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.5 } },
  ],
  edges: [
    {
      from: 'fac_price',
      to: 'goal_revenue',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
  goal_node_id: 'goal_revenue',
};

const EDIT_A = {
  ...BASE_GRAPH,
  nodes: [
    ...BASE_GRAPH.nodes,
    { id: 'fac_churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.2 } },
  ],
};

const EDIT_B = {
  ...BASE_GRAPH,
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.95 } },
  ],
};

function identityHash(graph: unknown): string {
  const hash = computeExpectedGraphCasHashes(graph).expectedGraphIdentityHash;
  if (hash === null) throw new Error('fixture must have an identity hash');
  return hash;
}

const BASE_HASH = identityHash(BASE_GRAPH);

const BASE_WRITE: SessionTurnWrite = {
  scenario_id: SCENARIO,
  turn_id: 'turn-1',
  turn_class: 'handler',
  handler_id: null,
  request_hash: 'sha256:abc',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 40,
  handler_facts: [],
};

function graphWrite(overrides: Partial<SessionTurnWrite> = {}): SessionTurnWrite {
  return {
    ...BASE_WRITE,
    graph: EDIT_A,
    expectedGraphIdentityHash: BASE_HASH,
    expectedGraphAnalysisHash:
      computeExpectedGraphCasHashes(BASE_GRAPH).expectedGraphAnalysisHash,
    ...overrides,
  };
}

function harmlessQueryClientPart() {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'update', 'eq', 'is', 'not', 'order', 'in']) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
  chain.limit = () => Promise.resolve({ data: [], error: null });
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: null, error: null }).then(resolve);
  return chain as never;
}

function makePlainClient(result?: {
  data?: unknown;
  error?: { message: string; code?: string } | null;
}): {
  client: SupabaseClient;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (result !== undefined) return result;
      return fn === 'append_turn_atomic_v5'
        ? { data: { id: ACK_ID, disposition: 'inserted' }, error: null }
        : { data: ACK_ID, error: null };
    }),
    from: vi.fn(() => harmlessQueryClientPart()),
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
}

function makeStore(client: SupabaseClient, mode?: GraphCasRpcMode): SupabaseSessionStore {
  return new SupabaseSessionStore(
    client,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
    { defaultReadLimit: 20, ...(mode === undefined ? {} : { graphCasRpc: mode }) },
  );
}

describe('graph CAS mode changes v5 arguments, never graph RPC selection', () => {
  it.each([
    [undefined, false, null, null],
    ['off', false, null, null],
    ['shadow', false, BASE_HASH, identityHash(EDIT_A)],
    ['enforce', true, BASE_HASH, identityHash(EDIT_A)],
  ] as const)(
    '%s uses v5 with enforce=%s',
    async (mode, enforce, expected, incoming) => {
      const { client, rpcCalls } = makePlainClient();
      const result = await makeStore(client, mode).append(graphWrite());

      expect(result).toEqual({
        id: ACK_ID,
        graph_write_disposition: 'accepted_insert',
      });
      expect(rpcCalls).toHaveLength(1);
      expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v5');
      expect(rpcCalls[0]!.args).toMatchObject({
        p_cas_enforce: enforce,
        p_expected_graph_identity_hash: expected,
        p_incoming_graph_identity_hash: incoming,
        p_fence_generation: null,
      });
      expect(Object.keys(rpcCalls[0]!.args)).toHaveLength(19);
    },
  );

  it('non-graph writes alone remain on v2', async () => {
    const { client, rpcCalls } = makePlainClient();
    await makeStore(client, 'enforce').append(BASE_WRITE);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v2');
  });
});

describe('production config remains a CAS behavior switch, not a rollback RPC switch', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    _resetConfigCache();
  });

  afterEach(() => {
    process.env = originalEnv;
    _resetConfigCache();
  });

  it("default shadow config calls v5 with enforcement off", async () => {
    delete process.env.CEE_V5_GRAPH_CAS_RPC;
    _resetConfigCache();
    expect(config.features.graphCasRpc).toBe('shadow');
    const { client, rpcCalls } = makePlainClient();
    await makeStore(client, config.features.graphCasRpc).append(graphWrite());
    expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v5');
    expect(rpcCalls[0]!.args.p_cas_enforce).toBe(false);
  });

  it("off still calls v5, with null CAS inputs", async () => {
    process.env.CEE_V5_GRAPH_CAS_RPC = 'off';
    _resetConfigCache();
    const { client, rpcCalls } = makePlainClient();
    await makeStore(client, config.features.graphCasRpc).append(graphWrite());
    expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v5');
    expect(rpcCalls[0]!.args).toMatchObject({
      p_cas_enforce: false,
      p_expected_graph_identity_hash: null,
      p_incoming_graph_identity_hash: null,
    });
  });
});

describe('v5 OLGC1 mapping', () => {
  it('maps OLGC1 to GraphStaleWriteError on the existing commit-failure envelope', async () => {
    const { client } = makePlainClient({
      data: null,
      error: { message: 'stale graph write', code: GRAPH_CAS_RPC_CONFLICT_SQLSTATE },
    });
    const failure = makeStore(client, 'enforce').append(graphWrite());
    await expect(failure).rejects.toBeInstanceOf(GraphStaleWriteError);
    await expect(failure).rejects.toBeInstanceOf(StateCommitFailedError);
  });

  it('keeps non-OLGC1 errors generic and never retries a legacy RPC', async () => {
    const { client, rpcCalls } = makePlainClient({
      data: null,
      error: { message: 'function missing', code: 'PGRST202' },
    });
    await expect(makeStore(client, 'enforce').append(graphWrite())).rejects.toMatchObject({
      name: 'StateCommitFailedError',
      rpc_code: 'PGRST202',
    });
    expect(rpcCalls.map((call) => call.fn)).toEqual(['append_turn_atomic_v5']);
  });
});

function makeStatefulClient(): {
  client: SupabaseClient;
  state: { graph: unknown; identityHash: string; insertedTurns: string[] };
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const state = {
    graph: BASE_GRAPH as unknown,
    identityHash: BASE_HASH,
    insertedTurns: [] as string[],
  };
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let row = 0;
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      if (fn !== 'append_turn_atomic_v5') {
        return { data: null, error: { code: 'MUTANT', message: 'legacy graph RPC' } };
      }
      const expected = args.p_expected_graph_identity_hash as string | null;
      const incoming = args.p_incoming_graph_identity_hash as string | null;
      if (
        args.p_cas_enforce === true &&
        expected !== null &&
        state.identityHash !== expected &&
        (incoming === null || incoming !== state.identityHash)
      ) {
        return {
          data: null,
          error: { code: GRAPH_CAS_RPC_CONFLICT_SQLSTATE, message: 'stale graph write' },
        };
      }
      state.graph = args.p_graph;
      state.identityHash = incoming ?? state.identityHash;
      state.insertedTurns.push(String(args.p_turn_id));
      row += 1;
      const id = `00000000-0000-4000-8000-${String(row).padStart(12, '0')}`;
      return { data: { id, disposition: 'inserted' }, error: null };
    }),
    from: vi.fn(() => harmlessQueryClientPart()),
  } as unknown as SupabaseClient;
  return { client, state, rpcCalls };
}

describe('two analysis-affecting edits from the same base', () => {
  it('accepts the first and atomically refuses the stale second without a turn row', async () => {
    const { client, state, rpcCalls } = makeStatefulClient();
    const store = makeStore(client, 'enforce');

    await store.append(graphWrite({ turn_id: 'turn-A', graph: EDIT_A }));
    expect(state.graph).toBe(EDIT_A);
    expect(state.insertedTurns).toEqual(['turn-A']);

    await expect(
      store.append(graphWrite({ turn_id: 'turn-B', graph: EDIT_B })),
    ).rejects.toBeInstanceOf(GraphStaleWriteError);
    expect(state.graph).toBe(EDIT_A);
    expect(state.identityHash).toBe(identityHash(EDIT_A));
    expect(state.insertedTurns).toEqual(['turn-A']);
    expect(rpcCalls.every((call) => call.fn === 'append_turn_atomic_v5')).toBe(true);
  });

  it('allows a distinct-turn self-noop because incoming already equals current', async () => {
    const { client, state } = makeStatefulClient();
    state.graph = EDIT_A;
    state.identityHash = identityHash(EDIT_A);
    const result = await makeStore(client, 'enforce').append(
      graphWrite({ turn_id: 'turn-noop', graph: EDIT_A }),
    );
    expect(result.graph_write_disposition).toBe('accepted_insert');
    expect(state.graph).toBe(EDIT_A);
  });
});
