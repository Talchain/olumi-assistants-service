import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupabaseSessionStore } from '../supabase-store.js';
import { GraphStaleWriteError, StateCommitFailedError } from '../store.js';
import type { SessionTurnWrite } from '../store.js';
import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';

type SunkEvent = { event: string; data: Record<string, unknown> };
function captureEvents(): SunkEvent[] {
  const events: SunkEvent[] = [];
  setTestSink((event, data) => events.push({ event, data }));
  return events;
}
afterEach(() => setTestSink(null));

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MUTATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const VERSION = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const HASH = 'a'.repeat(64);
const ANALYSIS_HASH = 'b'.repeat(64);

/**
 * The graph identity hash the SCENARIO ROW currently holds — i.e. exactly what
 * `append_turn_atomic_v4` reads into `v_current_hash` under its `FOR UPDATE`
 * (20260806120000_v5_turn_fence_first_write_exemption.sql:193).
 */
const ROW_CURRENT_HASH = 'f'.repeat(64);
/**
 * The graph identity hash the CALLER read at TURN START — the trusted base
 * (`SessionTurnWrite.expectedGraphIdentityHash`). Deliberately DIFFERENT from
 * `ROW_CURRENT_HASH`: that difference is what a real CAS must be able to see.
 */
const CALLER_TURN_START_HASH = 'e'.repeat(64);

const OLGC1 = 'OLGC1';

const receipt = {
  mutation_id: MUTATION,
  version_id: VERSION,
  version_number: 1,
  graph_identity_hash: HASH,
  analysis_affecting_hash: ANALYSIS_HASH,
  hash_algorithm: 'sha256',
  identity_projection_version: 'identity.v1',
  identity_normaliser_version: '1',
  graph_schema_version: 'graph_v3',
  actor_kind: 'unknown',
  authored_by: null,
  creation_kind: 'initial',
  source_version_id: null,
  source_turn_id: TURN,
  parent_version_id: null,
  root_version_id: VERSION,
  undo_version_id: null,
  graph: { nodes: [], edges: [], custom_persisted_field: true },
  event_id: `model_version_created_mutation_${MUTATION}`,
};

const rpc = vi.fn();
const maybeSingle = vi.fn();
const cache = { invalidateAll: vi.fn() };

/**
 * Every `.from(table).select(columns)` the store issues during the call under
 * test, recorded so an assertion can bind to the CAS re-read BY IDENTITY (the
 * `scenarios` table + the `graph_identity_hash` column) rather than by a
 * call-count another read could satisfy.
 */
const selectCalls: Array<{ table: string; columns: string }> = [];

const client = {
  rpc,
  from: vi.fn((table: string) => ({
    select: vi.fn((columns: string) => {
      selectCalls.push({ table, columns });
      return { eq: vi.fn(() => ({ maybeSingle })) };
    }),
  })),
};

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
    graph: receipt.graph,
    modelVersion: {
      mutation_id: MUTATION,
      graph_identity_hash: HASH,
      analysis_affecting_hash: ANALYSIS_HASH,
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

function storeWith(graphCasRpc?: 'off' | 'shadow' | 'enforce'): SupabaseSessionStore {
  return new SupabaseSessionStore(client as never, cache as never, {
    defaultReadLimit: 20,
    ...(graphCasRpc === undefined ? {} : { graphCasRpc }),
  } as never);
}

/** The single `append_turn_atomic_v5` argument object of the call under test. */
function v5Args(): Record<string, unknown> {
  const call = rpc.mock.calls.find((c) => c[0] === 'append_turn_atomic_v5');
  expect(call, 'append_turn_atomic_v5 was never called').toBeDefined();
  return call![1] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectCalls.length = 0;
  maybeSingle.mockResolvedValue({ data: { graph_identity_hash: null }, error: null });
  rpc.mockResolvedValue({
    data: { turn_row_id: 'turn-row', model_version_receipt: receipt },
    error: null,
  });
});

describe('SupabaseSessionStore append_turn_atomic_v5', () => {
  it('uses the trusted null base and returns the canonical internal receipt', async () => {
    const store = storeWith();

    const outcome = await store.append(write());

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]![0]).toBe('append_turn_atomic_v5');
    expect(rpc.mock.calls[0]![1]).toMatchObject({
      p_expected_graph_identity_hash: null,
      p_incoming_graph_identity_hash: HASH,
      // B2: derived from rpcMode, never hardcoded. These store options carry no
      // graphCasRpc, so the mode is 'off' and the versioned append must NOT
      // enforce — exactly what the v3/v4 siblings do for the same mode.
      p_cas_enforce: false,
      p_version_mutation_id: MUTATION,
      p_version_actor_kind: 'unknown',
    });
    expect(outcome).toEqual({ id: 'turn-row', modelVersionReceipt: receipt });
  });

  it('accepts an honest guest/no-op replay with no version receipt', async () => {
    rpc.mockResolvedValue({
      data: { turn_row_id: 'turn-row', model_version_receipt: null },
      error: null,
    });
    const store = storeWith();

    await expect(store.append(write())).resolves.toEqual({ id: 'turn-row' });
    expect(cache.invalidateAll).toHaveBeenCalledWith(SCENARIO);
  });
});

/**
 * ── B1 ──────────────────────────────────────────────────────────────────────
 * The versioned append must NEVER source `p_expected_graph_identity_hash` from
 * a read of `scenarios.graph_identity_hash`. That is the very column
 * `append_turn_atomic_v4` reads into `v_current_hash`
 * (20260806120000_...sql:193) and compares against
 * (`v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash`, :311), so
 * a re-read makes the comparison FALSE BY CONSTRUCTION — the CAS "matches"
 * unconditionally while reporting itself as enforcing.
 *
 * `session/store.ts:194-196` and `turn-executor.ts:1350-1353` both name and
 * REFUSE this anti-pattern; these tests hold the versioned path to it.
 */
describe('B1 — the versioned CAS base is never a copy of the value it is compared against', () => {
  it('B1: issues NO read of scenarios.graph_identity_hash on the versioned append path', async () => {
    // PRECONDITION PIN: the row genuinely holds a hash, so a re-read WOULD
    // return a non-null value. If the store re-reads, it can only be reading
    // the same column v4 compares against.
    maybeSingle.mockResolvedValue({
      data: { graph_identity_hash: ROW_CURRENT_HASH },
      error: null,
    });
    const store = storeWith('enforce');

    await store.append(write({ expectedGraphIdentityHash: undefined }));

    const casReReads = selectCalls.filter(
      (c) => c.table === 'scenarios' && c.columns.includes('graph_identity_hash'),
    );
    expect(
      casReReads,
      'the versioned append re-read scenarios.graph_identity_hash — that is the exact column ' +
        'append_turn_atomic_v4 reads into v_current_hash, so the CAS would compare it against itself',
    ).toEqual([]);
  });

  it('B1: an UNINSTRUMENTED write (undefined base) sends SQL NULL, not the row it is about to overwrite', async () => {
    maybeSingle.mockResolvedValue({
      data: { graph_identity_hash: ROW_CURRENT_HASH },
      error: null,
    });
    const store = storeWith('enforce');

    await store.append(write({ expectedGraphIdentityHash: undefined }));

    const args = v5Args();
    // The honest "this path is not instrumented" sentinel — store.ts:199-201.
    expect(args.p_expected_graph_identity_hash).toBeNull();
    // ...and specifically NOT the pre-write current value.
    expect(args.p_expected_graph_identity_hash).not.toBe(ROW_CURRENT_HASH);
  });

  it('B1: an INSTRUMENTED write forwards the CALLER turn-start base verbatim, so a genuine mismatch survives to the DB', async () => {
    // PRECONDITION PIN: the caller's base and the row's current hash genuinely
    // DIFFER. If the store forwarded a re-read instead, these two would be
    // equal at the DB and no mismatch could ever be detected.
    expect(CALLER_TURN_START_HASH).not.toBe(ROW_CURRENT_HASH);
    maybeSingle.mockResolvedValue({
      data: { graph_identity_hash: ROW_CURRENT_HASH },
      error: null,
    });
    const store = storeWith('enforce');

    await store.append(write({ expectedGraphIdentityHash: CALLER_TURN_START_HASH }));

    const args = v5Args();
    expect(args.p_expected_graph_identity_hash).toBe(CALLER_TURN_START_HASH);
    expect(args.p_cas_enforce).toBe(true);
    // The two operands v4 compares are now genuinely different sources, so
    // `v_current_hash IS DISTINCT FROM p_expected_graph_identity_hash` is
    // SATISFIABLE — which the next test proves is surfaced, not swallowed.
    expect(args.p_expected_graph_identity_hash).not.toBe(ROW_CURRENT_HASH);
  });

  it('B1: a genuine CAS conflict (OLGC1) is surfaced as GraphStaleWriteError carrying the caller base', async () => {
    maybeSingle.mockResolvedValue({
      data: { graph_identity_hash: ROW_CURRENT_HASH },
      error: null,
    });
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: OLGC1,
        message: `append_turn_atomic_v4: stale graph write for scenario ${SCENARIO} (expected ${CALLER_TURN_START_HASH}, current ${ROW_CURRENT_HASH})`,
      },
    });
    const store = storeWith('enforce');

    await expect(
      store.append(write({ expectedGraphIdentityHash: CALLER_TURN_START_HASH })),
    ).rejects.toBeInstanceOf(GraphStaleWriteError);
    expect(v5Args().p_expected_graph_identity_hash).toBe(CALLER_TURN_START_HASH);
  });
});

/**
 * ── B2 ──────────────────────────────────────────────────────────────────────
 * `p_cas_enforce` is DERIVED from the store's GraphCasRpcMode, exactly as
 * every sibling derives it (`supabase-store.ts:392`, `:1099`, `:1104`). The
 * code default is 'shadow' (config/index.ts:677), whose contract is "log, never
 * refuse"; promoting it to enforce is "a later explicit, Paul-gated step".
 */
describe('B2 — p_cas_enforce is derived from the RPC mode, both directions', () => {
  it("B2: shadow LOGS AND PROCEEDS — p_cas_enforce is false and the append returns", async () => {
    maybeSingle.mockResolvedValue({
      data: { graph_identity_hash: ROW_CURRENT_HASH },
      error: null,
    });
    const store = storeWith('shadow');

    const outcome = await store.append(
      write({ expectedGraphIdentityHash: CALLER_TURN_START_HASH }),
    );

    expect(v5Args().p_cas_enforce).toBe(false);
    // Shadow must not refuse: a stale base still commits, exactly as today.
    expect(outcome).toEqual({ id: 'turn-row', modelVersionReceipt: receipt });
  });

  it('B2: enforce REFUSES — p_cas_enforce is true and OLGC1 becomes a typed refusal', async () => {
    maybeSingle.mockResolvedValue({
      data: { graph_identity_hash: ROW_CURRENT_HASH },
      error: null,
    });
    const store = storeWith('enforce');
    await store.append(write({ expectedGraphIdentityHash: CALLER_TURN_START_HASH }));
    expect(v5Args().p_cas_enforce).toBe(true);

    vi.clearAllMocks();
    selectCalls.length = 0;
    rpc.mockResolvedValue({ data: null, error: { code: OLGC1, message: 'stale graph write' } });
    await expect(
      storeWith('enforce').append(write({ expectedGraphIdentityHash: CALLER_TURN_START_HASH })),
    ).rejects.toBeInstanceOf(GraphStaleWriteError);
  });

  it('B2: the CONFLICT TELEMETRY reports the mode in force, not a hardcoded label', async () => {
    const events = captureEvents();
    rpc.mockResolvedValue({ data: null, error: { code: OLGC1, message: 'stale graph write' } });

    await expect(
      storeWith('shadow').append(write({ expectedGraphIdentityHash: CALLER_TURN_START_HASH })),
    ).rejects.toBeInstanceOf(GraphStaleWriteError);

    const conflicts = events.filter(
      (e) => e.event === TelemetryEvents.V5GraphCasRpcConflict,
    );
    expect(
      conflicts,
      `no ${TelemetryEvents.V5GraphCasRpcConflict} event was emitted`,
    ).toHaveLength(1);
    // Binds by IDENTITY to the mode field. A hardcoded 'enforce' would
    // misattribute every shadow-mode conflict.
    expect(conflicts[0]!.data.mode).toBe('shadow');
  });

  it("B2: 'off' does not enforce", async () => {
    const store = storeWith('off');
    await store.append(write({ expectedGraphIdentityHash: CALLER_TURN_START_HASH }));
    expect(v5Args().p_cas_enforce).toBe(false);
  });

  it('B2: the three modes are DISCRIMINATED — shadow/off false, enforce true, from one identical write', async () => {
    const seen: Array<[string, unknown]> = [];
    for (const mode of ['off', 'shadow', 'enforce'] as const) {
      vi.clearAllMocks();
      selectCalls.length = 0;
      rpc.mockResolvedValue({
        data: { turn_row_id: 'turn-row', model_version_receipt: receipt },
        error: null,
      });
      await storeWith(mode).append(write({ expectedGraphIdentityHash: CALLER_TURN_START_HASH }));
      seen.push([mode, v5Args().p_cas_enforce]);
    }
    // A hardcoded value would make all three identical — this asserts the
    // DISCRIMINATION, which a blind/constant implementation cannot fake.
    expect(seen).toEqual([
      ['off', false],
      ['shadow', false],
      ['enforce', true],
    ]);
  });
});

/**
 * ── B3 ──────────────────────────────────────────────────────────────────────
 * `append_turn_atomic_v5` has NO legacy fallback and must not gain one
 * (supabase-store.ts:346-348 — "No legacy fallback is safe"). The remedy for an
 * un-migrated database is therefore an ACTIONABLE failure, matching the
 * treatment `append_turn_atomic_v4`'s PGRST202 already gets at :1114-1127.
 */
describe('B3 — an un-migrated database fails closed with an ACTIONABLE message', () => {
  it('B3: PGRST202 on append_turn_atomic_v5 names migration 20260824200000', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.append_turn_atomic_v5 in the schema cache',
      },
    });
    const store = storeWith('shadow');

    const err = await store.append(write()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StateCommitFailedError);
    const message = (err as Error).message;
    expect(message).toContain('20260824200000');
    expect(message.toLowerCase()).toContain('migration');
  });

  it('B3: PGRST202 still FAILS CLOSED — no fallback RPC is attempted', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'function not found' },
    });
    const store = storeWith('shadow');

    await expect(store.append(write())).rejects.toBeInstanceOf(StateCommitFailedError);
    const attempted = rpc.mock.calls.map((c) => c[0] as string);
    expect(attempted).toEqual(['append_turn_atomic_v5']);
    expect(attempted).not.toContain('append_turn_atomic_v4');
    expect(attempted).not.toContain('append_turn_atomic_v3');
    expect(attempted).not.toContain('append_turn_atomic_v2');
  });

  it('B3: a NON-PGRST202 RPC failure keeps its own message and does not claim a missing migration', async () => {
    // CONTRAST CONTROL: proves the migration hint is conditioned on PGRST202
    // and not unconditionally appended to every error.
    rpc.mockResolvedValue({
      data: null,
      error: { code: '40001', message: 'could not serialize access' },
    });
    const err = await storeWith('shadow')
      .append(write())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StateCommitFailedError);
    expect((err as Error).message).not.toContain('20260824200000');
  });
});
