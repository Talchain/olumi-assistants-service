/**
 * RED-first specification for Shared Data Phase 2(c).
 * Round 2 refusal rows run RED before the fix, then GREEN in this file only.
 * Slice ii-a exercises the public versioned append through the test seam,
 * including replay and refusal at the Supabase RPC boundary. The shipped
 * default stays off until commit B.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupabaseSessionStore, USE_APPEND_V6, __setUseAppendV6ForTest, useAppendV6 } from '../supabase-store.js';
import {
  GraphStaleWriteError,
  SessionReadError,
  StateCommitFailedError,
  type SessionTurnWrite,
} from '../store.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MUTATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HASH = 'a'.repeat(64);
const GRAPH = { nodes: [], edges: [] };

let scenarioRow: Record<string, unknown> | null;
const selectCalls: Array<{ table: string; columns: string }> = [];
const rpc = vi.fn();
const cache = { invalidateAll: vi.fn() };
const client = {
  rpc,
  from: vi.fn((table: string) => {
    const query: Record<string, unknown> = {
      select: vi.fn((columns: string) => {
        selectCalls.push({ table, columns });
        return query;
      }),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({
        data: table === 'scenarios' ? scenarioRow : null,
        error: null,
      })),
      limit: vi.fn(async () => ({ data: [], error: null })),
    };
    return query;
  }),
};

function store(): SupabaseSessionStore {
  return new SupabaseSessionStore(client as never, cache as never, {
    defaultReadLimit: 20,
    graphCasRpc: 'enforce',
  } as never);
}

function write(overrides: Partial<SessionTurnWrite> = {}): SessionTurnWrite {
  return {
    scenario_id: SCENARIO,
    turn_id: TURN,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: 'request-hash',
    response_emitted: true,
    llm_calls_used: 0,
    duration_ms: 1,
    handler_facts: [],
    graph: GRAPH,
    expectedRevision: 7,
    modelVersion: {
      mutation_id: MUTATION,
      graph_identity_hash: HASH,
      analysis_affecting_hash: 'b'.repeat(64),
      hash_algorithm: 'sha256',
      identity_projection_version: 'identity.v1',
      identity_normaliser_version: '1',
      graph_schema_version: 'graph_v3',
      actor_kind: 'unknown',
      authored_by: null,
      creation_kind: 'committed_mutation',
      source_turn_id: TURN,
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  selectCalls.length = 0;
  scenarioRow = { graph: GRAPH, brief_text: 'Synthetic brief', revision: 7 };
  rpc.mockResolvedValue({
    data: { turn_row_id: 'turn-row', model_version_receipt: null, revision: 8 },
    error: null,
  });
});

describe('scenario revision — public append_turn_atomic_v6 path', () => {
  beforeEach(() => __setUseAppendV6ForTest(true));
  afterEach(() => __setUseAppendV6ForTest(false));

  it('ships disabled and the enabled test seam sends the original revision to v6, never v5', async () => {
    expect(USE_APPEND_V6).toBe(false);
    expect(useAppendV6()).toBe(true);
    await expect(store().append(write())).resolves.toEqual({ id: 'turn-row', revision: 8 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe('append_turn_atomic_v6');
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_scenario_id: SCENARIO,
      p_turn_id: TURN,
      p_expected_base_known: false,
      p_expected_graph_identity_hash: null,
      p_cas_enforce: true,
      p_version_mutation_id: MUTATION,
      p_expected_revision: 7,
    });
  });

  it('uses the trusted turn-start revision verbatim, without an append-time scenario reread', async () => {
    const sessionStore = store();
    const loaded = await sessionStore['readGraphAndBriefText'](SCENARIO, true);
    expect(loaded).toEqual({ graph: GRAPH, briefText: 'Synthetic brief', revision: 7 });
    expect(selectCalls).toEqual([{ table: 'scenarios', columns: 'graph, brief_text, revision' }]);

    // A rival writer lands after this turn's read. A reread would erase the
    // staleness signal by sending 8; the caller's measured base must remain 7.
    scenarioRow = { ...scenarioRow, revision: 8 };
    const rpcArgs = { p_scenario_id: SCENARIO, p_turn_id: TURN, p_request_hash: 'request-hash' };
    const rawResult = { data: { turn_row_id: 'turn-row', revision: 8 }, error: null };
    rpc.mockResolvedValue(rawResult);

    await expect(sessionStore['callAppendTurnAtomicV6'](
      write({ expectedRevision: loaded.revision }), rpcArgs,
    )).resolves.toEqual(rawResult);
    expect(rpc).toHaveBeenCalledWith('append_turn_atomic_v6', {
      ...rpcArgs, p_expected_revision: 7,
    });
    expect(selectCalls).toHaveLength(1);
  });

  it('forwards a known zero revision rather than treating it as an absent expectation', async () => {
    await store()['callAppendTurnAtomicV6'](write({ expectedRevision: 0 }), {});
    expect(rpc).toHaveBeenCalledWith('append_turn_atomic_v6', { p_expected_revision: 0 });
  });

  it.each([undefined, null, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'fails closed before the RPC for an invalid expected revision (%s)', async (expectedRevision) => {
      await expect(store()['callAppendTurnAtomicV6'](
        write({ expectedRevision: expectedRevision as number }), {},
      )).rejects.toBeInstanceOf(StateCommitFailedError);
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['OLRV1', 'revision_conflict'],
    ['OLGC1', 'rpc_cas_conflict'],
  ])('maps v6 %s to GraphStaleWriteError %s before generic/fence handling', async (code, category) => {
    const sessionStore = store();
    const turnWrite = write({ expectedGraphIdentityHash: HASH });
    const resolveDraftLoss = vi.spyOn(sessionStore, 'resolveDraftLossAfterGraphCommit' as never);
    const emitCasConflict = vi.spyOn(sessionStore, 'emitRpcCasConflict' as never);
    const emitFence = vi.spyOn(sessionStore, 'emitFenceEvaluated' as never);
    const markGraphWriteFailed = vi.spyOn(sessionStore, 'markGraphWriteFailed' as never);
    const rpcError = {
      code,
      message: code === 'OLRV1' ? 'append_turn_atomic_v6: revision_conflict' : 'stale graph write',
      details: JSON.stringify({ reason: 'revision_conflict', expected: 7, current: 8 }),
    };

    rpc.mockResolvedValue({ data: null, error: rpcError });

    const error = await sessionStore['appendAtomicVersioned'](turnWrite, {
      p_scenario_id: SCENARIO, p_turn_id: TURN, p_request_hash: turnWrite.request_hash,
    }, 'enforce', null)
      .then(() => null, (caught: unknown) => caught);

    expect(error).toBeInstanceOf(GraphStaleWriteError);
    expect(error).toMatchObject({
      conflict_category: category,
      cause: rpcError,
      expected_base_graph_hash: HASH,
    });
    expect(cache.invalidateAll).not.toHaveBeenCalled();
    expect(resolveDraftLoss).not.toHaveBeenCalled();
    expect(emitFence).not.toHaveBeenCalled();
    expect(markGraphWriteFailed).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([rpcName]) => rpcName)).toEqual([
      'append_turn_atomic_v6',
    ]);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_expected_revision: 7 });
    if (code === 'OLGC1') {
      expect(emitCasConflict).toHaveBeenCalledExactlyOnceWith(turnWrite, 'enforce', 'OLGC1');
    } else {
      expect(emitCasConflict).not.toHaveBeenCalled();
    }
  });

  it('refuses a stale public versioned commit and threads the equal-revision commit result', async () => {
    let current = 8;
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('append_turn_atomic_v6');
      if (args.p_expected_revision !== current) return {
        data: null,
        error: { code: 'OLRV1', details: JSON.stringify({ reason: 'revision_conflict', expected: args.p_expected_revision, current }) },
      };
      current += 1;
      return { data: { turn_row_id: 'committed-turn', model_version_receipt: null, revision: current }, error: null };
    });
    await expect(store().append(write({ expectedRevision: 7 }))).rejects.toMatchObject({
      name: 'GraphStaleWriteError', conflict_category: 'revision_conflict',
    });
    expect(current).toBe(8);
    await expect(store().append(write({ expectedRevision: 8 }))).resolves.toEqual({ id: 'committed-turn', revision: 9 });
    expect(current).toBe(9);
  });

  it('returns the cached turn on a same-turn-id replay before comparing a moved revision', async () => {
    let current = 7;
    const committed = new Map<string, { turn_row_id: string; model_version_receipt: null; revision: number }>();
    let comparisons = 0;
    rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('append_turn_atomic_v6');
      const cached = committed.get(String(args.p_turn_id));
      if (cached) return { data: { ...cached, revision: current }, error: null };
      comparisons += 1;
      if (args.p_expected_revision !== current) return {
        data: null,
        error: { code: 'OLRV1', details: JSON.stringify({ reason: 'revision_conflict', expected: args.p_expected_revision, current }) },
      };
      const data = { turn_row_id: 'cached-turn', model_version_receipt: null, revision: ++current };
      committed.set(String(args.p_turn_id), data);
      return { data, error: null };
    });
    const sessionStore = store();
    await expect(sessionStore.append(write())).resolves.toEqual({ id: 'cached-turn', revision: 8 });
    current = 11; // Another turn commits after the lost response.
    await expect(sessionStore.append(write())).resolves.toEqual({ id: 'cached-turn', revision: 11 });
    expect(comparisons).toBe(1);
    expect(committed.size).toBe(1);
    expect(rpc.mock.calls.map(([, args]) => args.p_turn_id)).toEqual([TURN, TURN]);
    expect(rpc.mock.calls.map(([, args]) => args.p_expected_revision)).toEqual([7, 7]);
  });

  it('does not fall back when the new RPC is absent', async () => {
    const result = { data: null, error: { code: 'PGRST202', message: 'append_turn_atomic_v6 unavailable' } };
    rpc.mockResolvedValue(result);
    await expect(store()['callAppendTurnAtomicV6'](write(), {})).resolves.toEqual(result);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe('append_turn_atomic_v6');
  });
});

describe('scenario revision — turn-start scenario read', () => {
  beforeEach(() => __setUseAppendV6ForTest(true));
  afterEach(() => __setUseAppendV6ForTest(false));

  it('reads and returns the scenario revision with the graph while the test seam is true', async () => {
    await expect(store().loadGraphAndBriefText(SCENARIO)).resolves.toEqual({
      graph: GRAPH, briefText: 'Synthetic brief', revision: 7,
    });
    expect(selectCalls).toEqual([{ table: 'scenarios', columns: 'graph, brief_text, revision' }]);
  });

  it('treats an absent scenario as revision zero on the dormant path', async () => {
    scenarioRow = null;
    await expect(store()['readGraphAndBriefText'](SCENARIO, true)).resolves.toEqual({
      graph: null, briefText: null, revision: 0,
    });
  });

  it.each([undefined, null, -1, 0.5, '7', Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'refuses an existing row with an invalid or missing revision (%s)', async (revision) => {
      scenarioRow = { graph: GRAPH, brief_text: 'Synthetic brief', revision };
      await expect(store()['readGraphAndBriefText'](SCENARIO, true)).rejects.toBeInstanceOf(SessionReadError);
      expect(rpc).not.toHaveBeenCalled();
    },
  );
});

describe('scenario revision — flag-off staging parity', () => {
  afterEach(() => __setUseAppendV6ForTest(false));

  beforeEach(() => {
    __setUseAppendV6ForTest(false);
  });

  it('uses v5 without an expected revision or added revision read, and calls the combined reader with false', async () => {
    expect(USE_APPEND_V6).toBe(false);
    expect(useAppendV6()).toBe(false);
    scenarioRow = { graph: GRAPH, brief_text: 'Synthetic brief' };
    const sessionStore = store();
    const combinedReader = vi.spyOn(sessionStore, 'readGraphAndBriefText' as never);

    await expect(sessionStore.loadGraphAndBriefText(SCENARIO)).resolves.toEqual({
      graph: GRAPH, briefText: 'Synthetic brief',
    });
    expect(combinedReader).toHaveBeenCalledExactlyOnceWith(SCENARIO, false);
    expect(selectCalls).toEqual([{ table: 'scenarios', columns: 'graph, brief_text' }]);

    await expect(sessionStore.append(write({ expectedRevision: undefined }))).resolves.toEqual({ id: 'turn-row' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe('append_turn_atomic_v5');
    expect(rpc.mock.calls[0]![1]).not.toHaveProperty('p_expected_revision');
    // The existing request-hash replay check remains; append adds no
    // scenario read or revision column.
    expect(selectCalls).toEqual([
      { table: 'scenarios', columns: 'graph, brief_text' },
      { table: 'v5_conversation_turns', columns: 'request_hash' },
    ]);
    expect(combinedReader).toHaveBeenCalledTimes(1);
  });
});
