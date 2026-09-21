/**
 * ATOMIC graph CAS (CEE_V5_GRAPH_CAS_RPC) — SupabaseSessionStore.append()
 * cutover to append_turn_atomic_v3.
 *
 * These tests pin the APP-SIDE half of POC-BOARD item 3: the store routes
 * graph-bearing writes to the v3 RPC (in-transaction CAS) when the flag is
 * on, threads the trusted expected base + the incoming identity hash, and
 * maps the v3 OLGC1 conflict onto a typed 409-class GraphStaleWriteError —
 * NEVER a silent clobber, and NEVER a silent success.
 *
 * The DB half (that the v3 SQL actually performs the in-transaction compare)
 * is pinned separately by the migration static-guards test. Here, a stateful
 * mock plays Postgres's role: it implements BOTH v2 (unconditional UPDATE =
 * clobber) and v3 (CAS), so a "two edits from the same base" case can prove
 * the second is rejected rather than clobbering the first.
 *
 * RED-first: none of this behaviour existed on the pre-cutover estate (the
 * store always called append_turn_atomic_v2 and never mapped OLGC1).
 * Mutation anchors are called out inline (revert `useV3` → the clobber test
 * goes green-clobber; revert the OLGC1 mapping → the conflict test loses its
 * GraphStaleWriteError type).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { config, _resetConfigCache } from '../../../config/index.js';
import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import {
  GraphStaleWriteError,
  StateCommitFailedError,
  type SessionTurnWrite,
} from '../store.js';
import {
  computeExpectedGraphCasHashes,
  GRAPH_CAS_RPC_CONFLICT_SQLSTATE,
  type GraphCasRpcMode,
} from '../../context/graph-cas-conflict.js';
import { setTestSink } from '../../../utils/telemetry.js';

const SCENARIO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// ── graph fixtures ──────────────────────────────────────────────────
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

/** Edit A — adds a churn factor (analysis-affecting). */
const EDIT_A = {
  ...BASE_GRAPH,
  nodes: [
    ...BASE_GRAPH.nodes,
    { id: 'fac_churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.2 } },
  ],
};

/** Edit B — a DIFFERENT analysis-affecting edit off the SAME base. */
const EDIT_B = {
  ...BASE_GRAPH,
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.95 } },
  ],
};

function idHash(raw: unknown): string {
  const h = computeExpectedGraphCasHashes(raw).expectedGraphIdentityHash;
  if (h === null) throw new Error('fixture must hash');
  return h;
}

const BASE_HASH = idHash(BASE_GRAPH);

// ── plain mock client (fixed RPC result) — for routing/mapping tests ──

interface PlainConfig {
  rpcResult?: { data?: unknown; error?: { message: string; code?: string } | null };
}

function makePlainClient(cfg: PlainConfig = {}): {
  client: SupabaseClient;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return cfg.rpcResult ?? { data: 'row-id-v3', error: null };
    }),
    // scenarios SELECT path (A3 observe hook) — never exercised here (observe off).
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'not', 'in']) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.limit = () => Promise.resolve({ data: [], error: null });
      return chain as never;
    }),
  } as unknown as SupabaseClient;
  return { client, rpcCalls };
}

// ── stateful mock client: plays Postgres append_turn_atomic_v2/_v3 ──
//
// This is the faithful CAS model. v2 clobbers unconditionally; v3 enforces
// the in-transaction compare exactly as the migration SQL specifies (self-noop
// allowed, distinct-base rejected with OLGC1). Its purpose is to let the store
// test discriminate "second write rejected" from "second write clobbers".

function makeStatefulClient(initial: {
  currentGraph: unknown;
  currentHash: string | null;
}): {
  client: SupabaseClient;
  state: {
    currentGraph: unknown;
    currentHash: string | null;
    committedTurnRowIds: string[];
  };
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
} {
  const state = {
    currentGraph: initial.currentGraph,
    currentHash: initial.currentHash,
    committedTurnRowIds: [] as string[],
  };
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  let rowSeq = 0;

  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      const pGraph = args.p_graph ?? null;
      if (fn === 'append_turn_atomic_v3') {
        const enforce = args.p_cas_enforce === true;
        const expected = (args.p_expected_graph_identity_hash ?? null) as string | null;
        const incoming = (args.p_incoming_graph_identity_hash ?? null) as string | null;
        // In-transaction CAS — mirrors the migration's IF predicate exactly.
        if (
          pGraph !== null &&
          enforce &&
          expected !== null &&
          state.currentHash !== null &&
          state.currentHash !== expected &&
          (incoming === null || incoming !== state.currentHash)
        ) {
          // OLGC1 — no state mutation (whole txn rolls back).
          return { data: null, error: { message: 'stale graph write', code: GRAPH_CAS_RPC_CONFLICT_SQLSTATE } };
        }
        if (pGraph !== null) {
          state.currentGraph = pGraph;
          state.currentHash = incoming;
        }
        rowSeq += 1;
        const rowId = `row-${rowSeq}`;
        state.committedTurnRowIds.push(rowId);
        return { data: rowId, error: null };
      }
      // v2 — unconditional UPDATE (the clobber the CAS exists to prevent).
      if (pGraph !== null) state.currentGraph = pGraph;
      rowSeq += 1;
      const rowId = `row-${rowSeq}`;
      state.committedTurnRowIds.push(rowId);
      return { data: rowId, error: null };
    }),
    from: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'not', 'in']) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
      chain.limit = () => Promise.resolve({ data: [], error: null });
      return chain as never;
    }),
  } as unknown as SupabaseClient;

  return { client, state, rpcCalls };
}

function makeStore(client: SupabaseClient, graphCasRpc?: GraphCasRpcMode): SupabaseSessionStore {
  return new SupabaseSessionStore(
    client,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
    { defaultReadLimit: 20, ...(graphCasRpc !== undefined ? { graphCasRpc } : {}) },
  );
}

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

/** Graph-bearing write built on BASE (expected base = BASE_HASH). */
function graphWrite(overrides: Partial<SessionTurnWrite>): SessionTurnWrite {
  return {
    ...BASE_WRITE,
    graph: EDIT_A,
    expectedGraphIdentityHash: BASE_HASH,
    expectedGraphAnalysisHash: computeExpectedGraphCasHashes(BASE_GRAPH).expectedGraphAnalysisHash,
    ...overrides,
  };
}

type SunkEvent = { event: string; data: Record<string, unknown> };
function captureEvents(): SunkEvent[] {
  const events: SunkEvent[] = [];
  setTestSink((event, data) => events.push({ event, data }));
  return events;
}
afterEach(() => setTestSink(null));

// ── store defensive fallback (option omitted): un-migrated-safe v2 ────
// NB: this is the STORE constructor's own `?? 'off'` fallback for an UNSPECIFIED
// option — deliberately conservative so a bare/direct store construction is safe
// against an un-migrated schema. It is NOT the live/config default: since 18 Jul
// (Paul-ratified) the CONFIG default `config.features.graphCasRpc` is 'shadow',
// and production wires it into the store via session/index.ts (proven by the
// "config default" describe below). The two are intentionally distinct.

describe('graph CAS RPC — store fallback (option omitted): calls v2, never v3', () => {
  it('absent option → append_turn_atomic_v2 with the canonical 15 args (no CAS params, no v3)', async () => {
    const { client, rpcCalls } = makePlainClient();
    const store = makeStore(client); // option absent — store's un-migrated-safe fallback
    const result = await store.append(graphWrite({}));
    expect(result.id).toBe('row-id-v3');
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v2');
    // No CAS params leak, and exactly the 15 v2 names (un-migrated-schema safe:
    // v3 need not exist for the default path to work).
    expect(Object.keys(rpcCalls[0]!.args)).toHaveLength(15);
    expect(rpcCalls[0]!.args).not.toHaveProperty('p_expected_graph_identity_hash');
    expect(rpcCalls[0]!.args).not.toHaveProperty('p_cas_enforce');
  });

  it("explicit 'off' → identical to absent (v2, no CAS params)", async () => {
    const { client, rpcCalls } = makePlainClient();
    const store = makeStore(client, 'off');
    await store.append(graphWrite({}));
    expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v2');
    expect(rpcCalls[0]!.args).not.toHaveProperty('p_cas_enforce');
  });

  it('non-graph write stays on v2 EVEN under enforce (CAS is graph-only)', async () => {
    const { client, rpcCalls } = makePlainClient();
    const store = makeStore(client, 'enforce');
    await store.append({ ...BASE_WRITE }); // no graph
    expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v2');
  });
});

// ── config default: 'shadow' since 18 Jul (Paul-ratified); env = kill-switch ──
// The store fallback above is deliberately 'off'; the LIVE default is the CONFIG
// value production wires into the store (session/index.ts:
// graphCasRpc: appConfig.features.graphCasRpc). This block pins that default at
// the source (migration 20260717120000 executed + verified), and proves the env
// var is the kill-switch — CEE_V5_GRAPH_CAS_RPC=off restores v2.

describe('graph CAS RPC — config default (drives production wiring)', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    _resetConfigCache();
  });
  afterEach(() => {
    process.env = originalEnv;
    _resetConfigCache();
  });

  it("default (env unset): config.features.graphCasRpc is 'shadow'", () => {
    delete process.env.CEE_V5_GRAPH_CAS_RPC;
    _resetConfigCache();
    expect(config.features.graphCasRpc).toBe('shadow');
  });

  it("shadow config value → the store routes graph writes to append_turn_atomic_v3 (enforce=false)", async () => {
    // Mirrors the production wiring: feed the config default into the store.
    delete process.env.CEE_V5_GRAPH_CAS_RPC;
    _resetConfigCache();
    const { client, rpcCalls } = makePlainClient();
    const store = makeStore(client, config.features.graphCasRpc);
    await store.append(graphWrite({}));
    expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v3');
    expect(rpcCalls[0]!.args.p_cas_enforce).toBe(false);
  });

  it("kill-switch: CEE_V5_GRAPH_CAS_RPC=off → 'off' (legacy v2 path restored)", async () => {
    process.env.CEE_V5_GRAPH_CAS_RPC = 'off';
    _resetConfigCache();
    expect(config.features.graphCasRpc).toBe('off');
    const { client, rpcCalls } = makePlainClient();
    const store = makeStore(client, config.features.graphCasRpc);
    await store.append(graphWrite({}));
    expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v2');
  });

  it("env override to 'enforce' is still honoured (a later explicit step, not the default)", () => {
    process.env.CEE_V5_GRAPH_CAS_RPC = 'enforce';
    _resetConfigCache();
    expect(config.features.graphCasRpc).toBe('enforce');
  });
});

// ── shadow: v3 called, CAS params threaded, enforce=false ────────────

describe('graph CAS RPC — shadow: v3 stamps hash, never rejects', () => {
  it('routes to v3 with p_cas_enforce=false and threads expected + incoming hashes', async () => {
    const { client, rpcCalls } = makePlainClient();
    const store = makeStore(client, 'shadow');
    const write = graphWrite({});
    const result = await store.append(write);
    expect(result.id).toBe('row-id-v3');
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe('append_turn_atomic_v3');
    const args = rpcCalls[0]!.args;
    expect(args.p_cas_enforce).toBe(false);
    expect(args.p_expected_graph_identity_hash).toBe(BASE_HASH);
    // Incoming hash is the identity of the graph actually written (EDIT_A).
    expect(args.p_incoming_graph_identity_hash).toBe(idHash(EDIT_A));
    // Still carries all 15 base args + the 3 CAS params.
    expect(Object.keys(args)).toHaveLength(18);
  });

  it('uninstrumented write (no expected base) → expected hash passes as null', async () => {
    const { client, rpcCalls } = makePlainClient();
    const store = makeStore(client, 'shadow');
    await store.append(graphWrite({ expectedGraphIdentityHash: undefined }));
    expect(rpcCalls[0]!.args.p_expected_graph_identity_hash).toBeNull();
  });
});

// ── enforce: OLGC1 conflict → typed 409-class refusal ────────────────

describe('graph CAS RPC — enforce: OLGC1 → GraphStaleWriteError (never silent)', () => {
  it('v3 returns OLGC1 → GraphStaleWriteError, instanceof StateCommitFailedError, rpc_conflict telemetry', async () => {
    const events = captureEvents();
    const { client } = makePlainClient({
      rpcResult: { data: null, error: { message: 'stale graph write', code: GRAPH_CAS_RPC_CONFLICT_SQLSTATE } },
    });
    const store = makeStore(client, 'enforce');

    let thrown: unknown;
    try {
      await store.append(graphWrite({}));
    } catch (err) {
      thrown = err;
    }
    // MUTATION ANCHOR: remove the `errCode === OLGC1` branch in append() and
    // this becomes a generic StateCommitFailedError (not GraphStaleWriteError).
    expect(thrown).toBeInstanceOf(GraphStaleWriteError);
    expect(thrown).toBeInstanceOf(StateCommitFailedError); // rides the existing envelope
    expect((thrown as GraphStaleWriteError).conflict_category).toBe('rpc_cas_conflict');

    const conflictEvents = events.filter((e) => e.event === 'v5.graph_cas.rpc_conflict');
    expect(conflictEvents).toHaveLength(1);
    expect(conflictEvents[0]!.data.conflict_category).toBe('rpc_cas_conflict');
    expect(conflictEvents[0]!.data.rpc_code).toBe(GRAPH_CAS_RPC_CONFLICT_SQLSTATE);
    // Content-free: no graph label leaks into telemetry.
    expect(JSON.stringify(conflictEvents[0]!.data)).not.toContain('Revenue');
  });

  it('a NON-OLGC1 RPC error is a generic StateCommitFailedError (OLGC1 discrimination is specific)', async () => {
    const { client } = makePlainClient({
      rpcResult: { data: null, error: { message: 'connection reset', code: 'ECONNRESET' } },
    });
    const store = makeStore(client, 'enforce');
    let thrown: unknown;
    try {
      await store.append(graphWrite({}));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(StateCommitFailedError);
    expect(thrown).not.toBeInstanceOf(GraphStaleWriteError);
  });

  it('clean enforce write (no conflict) → returns id and proceeds', async () => {
    const { client, rpcCalls } = makePlainClient();
    const store = makeStore(client, 'enforce');
    const result = await store.append(graphWrite({}));
    expect(result.id).toBe('row-id-v3');
    expect(rpcCalls[0]!.args.p_cas_enforce).toBe(true);
  });
});

// ── the core invariant: two edits from the SAME base → second REJECTED ──

describe('graph CAS RPC — two edits from the same base (concurrency dead-end root)', () => {
  it('enforce: second stale-base edit is REJECTED, not clobbered — the committed graph stays edit A', async () => {
    // DB starts at BASE (currentHash = BASE_HASH). Two turns both captured
    // their expected base as BASE_HASH (the stale-base race). Turn A commits
    // first, moving the committed hash forward; Turn B then arrives with the
    // now-stale base.
    const { client, state, rpcCalls } = makeStatefulClient({
      currentGraph: BASE_GRAPH,
      currentHash: BASE_HASH,
    });
    const store = makeStore(client, 'enforce');

    // Turn A: expected == current base → accepted; commits EDIT_A.
    const a = await store.append(
      graphWrite({ turn_id: 'turn-A', graph: EDIT_A, expectedGraphIdentityHash: BASE_HASH }),
    );
    expect(a.id).toBe('row-1');
    expect(state.currentHash).toBe(idHash(EDIT_A));
    expect(state.committedTurnRowIds).toEqual(['row-1']);

    // Turn B: SAME (now stale) expected base, a DIFFERENT edit → must be
    // rejected atomically, leaving the committed graph as EDIT_A.
    let thrown: unknown;
    try {
      await store.append(
        graphWrite({ turn_id: 'turn-B', graph: EDIT_B, expectedGraphIdentityHash: BASE_HASH }),
      );
    } catch (err) {
      thrown = err;
    }
    // MUTATION ANCHOR: force `useV3 = false` (always call v2) in append() and
    // this write goes through the unconditional v2 path → state.currentGraph
    // becomes EDIT_B (green-clobber) and nothing throws.
    expect(thrown).toBeInstanceOf(GraphStaleWriteError);
    expect(state.currentGraph).toBe(EDIT_A); // NOT clobbered by B
    expect(state.currentHash).toBe(idHash(EDIT_A));
    // OLGC1 aborts the whole transaction: neither scenarios.graph nor the
    // second turn row lands. This is the exact atomic property the structured
    // edge writer's 409 mapping relies on.
    expect(state.committedTurnRowIds).toEqual(['row-1']);
    expect(rpcCalls.every((c) => c.fn === 'append_turn_atomic_v3')).toBe(true);
  });

  it('enforce: an idempotent self-noop (incoming == current) is NEVER rejected', async () => {
    // DB already at EDIT_A. A duplicate submission carrying EDIT_A again, with
    // a stale expected base, must still be accepted (self-noop safety).
    const { client, state } = makeStatefulClient({
      currentGraph: EDIT_A,
      currentHash: idHash(EDIT_A),
    });
    const store = makeStore(client, 'enforce');
    const result = await store.append(
      graphWrite({ turn_id: 'turn-dup', graph: EDIT_A, expectedGraphIdentityHash: BASE_HASH }),
    );
    expect(result.id).toBe('row-1');
    expect(state.currentGraph).toBe(EDIT_A);
  });
});
