/**
 * RED-first specification for Shared Data Phase 2(c).
 * Authored before implementation; not executed because the build brief prohibits
 * test suites. The shipping switch stays false. Exercise the dormant seam
 * directly rather than introducing a runtime configuration escape hatch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupabaseSessionStore, USE_APPEND_V6 } from '../supabase-store.js';
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
    data: { turn_row_id: 'turn-row', model_version_receipt: null },
    error: null,
  });
});

describe('scenario revision — dormant append_turn_atomic_v6 path', () => {
  it('ships disabled, keeps the public append on v5, and sends no revision argument to v5', async () => {
    expect(USE_APPEND_V6).toBe(false);
    await expect(store().append(write())).resolves.toEqual({ id: 'turn-row' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe('append_turn_atomic_v5');
    expect(rpc.mock.calls[0]![1]).not.toHaveProperty('p_expected_revision');
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_scenario_id: SCENARIO,
      p_turn_id: TURN,
      p_expected_base_known: false,
      p_expected_graph_identity_hash: null,
      p_cas_enforce: true,
      p_version_mutation_id: MUTATION,
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

  it('maps revision_conflict to the v5 CAS error class, with no success side effects or fallback', async () => {
    const sessionStore = store();
    const resolveDraftLoss = vi.spyOn(sessionStore, 'resolveDraftLossAfterGraphCommit' as never);
    rpc.mockResolvedValue({
      data: {
        turn_row_id: null,
        model_version_receipt: null,
        reason: 'revision_conflict',
        revision: 8,
      },
      error: null,
    });

    const error = await sessionStore['callAppendTurnAtomicV6'](write(), {})
      .then(() => null, (caught: unknown) => caught);

    expect(error).toBeInstanceOf(GraphStaleWriteError);
    expect(error).toMatchObject({ conflict_category: 'revision_conflict' });
    expect(cache.invalidateAll).not.toHaveBeenCalled();
    expect(resolveDraftLoss).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe('append_turn_atomic_v6');

    // Bind the claimed error-class parity to the real, still-active v5 path.
    rpc.mockClear();
    rpc.mockResolvedValue({ data: null, error: { code: 'OLGC1', message: 'stale graph write' } });
    await expect(sessionStore.append(write())).rejects.toBeInstanceOf(GraphStaleWriteError);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe('append_turn_atomic_v5');
    expect(cache.invalidateAll).not.toHaveBeenCalled();
    expect(resolveDraftLoss).not.toHaveBeenCalled();
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
  it('preserves legacy columns and result shape while the shipping switch is false', async () => {
    await expect(store().loadGraphAndBriefText(SCENARIO)).resolves.toEqual({
      graph: GRAPH, briefText: 'Synthetic brief',
    });
    expect(selectCalls).toEqual([{ table: 'scenarios', columns: 'graph, brief_text' }]);
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
