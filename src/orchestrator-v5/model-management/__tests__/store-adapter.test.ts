/**
 * SupabaseModelVersionStore unit tests.
 *
 * Hand-rolled Supabase client (session supabase-store.test.ts idiom): no
 * live network, NO database execution — the migration is authored-not-
 * executed, so these tests assert RPC-invocation shape, error-code
 * mapping (MV001/MV404/MV409), row parsing, ordering and pointer reads.
 */
import { describe, it, expect, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  ModelVersionCasConflictError,
  ModelVersionNotFoundError,
  ModelVersionSignInRequiredError,
  ModelVersionStoreError,
  SupabaseModelVersionStore,
} from '../store-adapter.js';

const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const VERSION_ID = '11111111-1111-4111-8111-111111111111';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

interface MockConfig {
  rpcResult?: { data?: unknown; error?: { message: string; code?: string } | null };
  selectResult?: { data?: unknown; error?: { message: string; code?: string } | null };
}

function makeClient(cfg: MockConfig = {}): {
  client: SupabaseClient;
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  selectCalls: Array<{ table: string; cols: string; filters: Record<string, unknown> }>;
} {
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const selectCalls: Array<{ table: string; cols: string; filters: Record<string, unknown> }> = [];

  const client = {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return cfg.rpcResult ?? { data: defaultOutcome(), error: null };
    }),
    from: vi.fn((table: string) => {
      const filters: Record<string, unknown> = {};
      const chain = {
        select: (cols: string) => {
          selectCalls.push({ table, cols, filters });
          return chain;
        },
        eq: (col: string, val: unknown) => {
          filters[`eq:${col}`] = val;
          return chain;
        },
        order: (col: string, opts: unknown) => {
          filters[`order:${col}`] = opts;
          return chain;
        },
        limit: (n: number) => {
          filters.limit = n;
          return Promise.resolve(cfg.selectResult ?? { data: [], error: null });
        },
        maybeSingle: () => Promise.resolve(cfg.selectResult ?? { data: null, error: null }),
      };
      return chain as never;
    }),
  } as unknown as SupabaseClient;

  return { client, rpcCalls, selectCalls };
}

function defaultOutcome() {
  return {
    version_id: VERSION_ID,
    version_number: 3,
    graph_identity_hash: HASH_A,
    deduped: false,
    event_id: `model_version_created_${VERSION_ID}`,
  };
}

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    scenario_id: SCENARIO,
    owner_user_id: OWNER,
    version_number: 3,
    graph_identity_hash: HASH_A,
    hash_algorithm: 'sha256',
    identity_projection_version: 'identity.v1',
    identity_normaliser_version: '1',
    graph_schema_version: 'graph_v3',
    label: null,
    provenance: 'user_save',
    restored_from_version_id: null,
    created_at: '2026-07-05T10:00:00.000+00:00',
    ...overrides,
  };
}

const SAVE_WRITE = {
  scenario_id: SCENARIO,
  graph: { nodes: [{ id: 'n1' }], edges: [] },
  graph_identity_hash: HASH_A,
  hash_algorithm: 'sha256',
  identity_projection_version: 'identity.v1',
  identity_normaliser_version: '1',
  graph_schema_version: 'graph_v3',
};

describe('SupabaseModelVersionStore.saveVersion', () => {
  it('calls create_model_version with ALL named args (identity envelope stored verbatim)', async () => {
    const { client, rpcCalls } = makeClient();
    const store = new SupabaseModelVersionStore(client);

    const outcome = await store.saveVersion({
      ...SAVE_WRITE,
      label: 'before pricing pivot',
      provenance: 'user_save',
      expected_graph_identity_hash: HASH_B,
    });

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]!.fn).toBe('create_model_version');
    expect(rpcCalls[0]!.args).toEqual({
      p_scenario_id: SCENARIO,
      p_graph: SAVE_WRITE.graph,
      p_graph_identity_hash: HASH_A,
      p_projection_version: 'identity.v1',
      p_normaliser_version: '1',
      p_graph_schema_version: 'graph_v3',
      p_hash_algorithm: 'sha256',
      p_label: 'before pricing pivot',
      p_provenance: 'user_save',
      p_event_id: null,
      p_expected_graph_identity_hash: HASH_B,
    });
    expect(outcome).toEqual(defaultOutcome());
  });

  it('omitted optionals are passed as explicit nulls (PostgREST arg discipline)', async () => {
    const { client, rpcCalls } = makeClient();
    const store = new SupabaseModelVersionStore(client);
    await store.saveVersion(SAVE_WRITE);
    expect(rpcCalls[0]!.args.p_label).toBeNull();
    expect(rpcCalls[0]!.args.p_provenance).toBeNull();
    expect(rpcCalls[0]!.args.p_expected_graph_identity_hash).toBeNull();
  });

  it('surfaces deduped outcomes verbatim (no event, head returned)', async () => {
    const { client } = makeClient({
      rpcResult: {
        data: {
          version_id: VERSION_ID,
          version_number: 3,
          graph_identity_hash: HASH_A,
          deduped: true,
          event_id: null,
        },
        error: null,
      },
    });
    const store = new SupabaseModelVersionStore(client);
    const outcome = await store.saveVersion(SAVE_WRITE);
    expect(outcome.deduped).toBe(true);
    expect(outcome.event_id).toBeNull();
  });

  it('maps SQLSTATE MV001 → ModelVersionSignInRequiredError (guest refusal)', async () => {
    const { client } = makeClient({
      rpcResult: { data: null, error: { message: 'no owner', code: 'MV001' } },
    });
    const store = new SupabaseModelVersionStore(client);
    await expect(store.saveVersion(SAVE_WRITE)).rejects.toBeInstanceOf(
      ModelVersionSignInRequiredError,
    );
  });

  it('maps SQLSTATE MV409 → ModelVersionCasConflictError carrying the expected hash', async () => {
    const { client } = makeClient({
      rpcResult: { data: null, error: { message: 'stale', code: 'MV409' } },
    });
    const store = new SupabaseModelVersionStore(client);
    const err = await store
      .saveVersion({ ...SAVE_WRITE, expected_graph_identity_hash: HASH_B })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelVersionCasConflictError);
    expect((err as ModelVersionCasConflictError).expectedHash).toBe(HASH_B);
  });

  it('maps any other RPC failure → ModelVersionStoreError (fail-closed)', async () => {
    const { client } = makeClient({
      rpcResult: { data: null, error: { message: 'function does not exist', code: 'PGRST202' } },
    });
    const store = new SupabaseModelVersionStore(client);
    await expect(store.saveVersion(SAVE_WRITE)).rejects.toBeInstanceOf(ModelVersionStoreError);
  });

  it('rejects malformed RPC outcomes instead of propagating shape drift', async () => {
    const { client } = makeClient({ rpcResult: { data: { nope: true }, error: null } });
    const store = new SupabaseModelVersionStore(client);
    await expect(store.saveVersion(SAVE_WRITE)).rejects.toBeInstanceOf(ModelVersionStoreError);
  });
});

describe('SupabaseModelVersionStore.restoreVersion', () => {
  it('calls restore_model_version with all named args and parses restored_from lineage', async () => {
    const { client, rpcCalls } = makeClient({
      rpcResult: {
        data: {
          version_id: '33333333-3333-4333-8333-333333333333',
          version_number: 4,
          graph_identity_hash: HASH_B,
          restored_from_version_id: VERSION_ID,
          deduped: false,
          event_id: 'model_version_restored_33333333-3333-4333-8333-333333333333',
        },
        error: null,
      },
    });
    const store = new SupabaseModelVersionStore(client);
    const outcome = await store.restoreVersion({
      scenario_id: SCENARIO,
      version_id: VERSION_ID,
    });

    expect(rpcCalls[0]!.fn).toBe('restore_model_version');
    expect(rpcCalls[0]!.args).toEqual({
      p_scenario_id: SCENARIO,
      p_version_id: VERSION_ID,
      p_label: null,
      p_event_id: null,
      p_expected_graph_identity_hash: null,
    });
    // Restore creates a NEW version: new id, next number, lineage recorded.
    expect(outcome.version_id).not.toBe(VERSION_ID);
    expect(outcome.version_number).toBe(4);
    expect(outcome.restored_from_version_id).toBe(VERSION_ID);
  });

  it('maps MV404 → ModelVersionNotFoundError', async () => {
    const { client } = makeClient({
      rpcResult: { data: null, error: { message: 'missing', code: 'MV404' } },
    });
    const store = new SupabaseModelVersionStore(client);
    await expect(
      store.restoreVersion({ scenario_id: SCENARIO, version_id: VERSION_ID }),
    ).rejects.toBeInstanceOf(ModelVersionNotFoundError);
  });
});

describe('SupabaseModelVersionStore.listVersions', () => {
  it('reads summaries newest-first by version_number (NOT created_at), graph column excluded', async () => {
    const rows = [summaryRow({ version_number: 2 }), summaryRow({ id: '44444444-4444-4444-8444-444444444444', version_number: 1 })];
    const { client, selectCalls } = makeClient({ selectResult: { data: rows, error: null } });
    const store = new SupabaseModelVersionStore(client);

    const versions = await store.listVersions(SCENARIO, 10);

    expect(selectCalls[0]!.table).toBe('model_versions');
    expect(selectCalls[0]!.cols).not.toContain('graph,');
    expect(selectCalls[0]!.cols).not.toMatch(/,\s*graph\b/);
    expect(selectCalls[0]!.filters['eq:scenario_id']).toBe(SCENARIO);
    expect(selectCalls[0]!.filters['order:version_number']).toEqual({ ascending: false });
    expect(selectCalls[0]!.filters.limit).toBe(10);
    expect(versions.map((v) => v.version_number)).toEqual([2, 1]);
  });

  it('throws ModelVersionStoreError on read failure', async () => {
    const { client } = makeClient({ selectResult: { data: null, error: { message: 'boom' } } });
    const store = new SupabaseModelVersionStore(client);
    await expect(store.listVersions(SCENARIO)).rejects.toBeInstanceOf(ModelVersionStoreError);
  });

  it('throws on degraded rows (shape drift must not silently propagate)', async () => {
    const { client } = makeClient({
      selectResult: { data: [summaryRow({ graph_identity_hash: 42 })], error: null },
    });
    const store = new SupabaseModelVersionStore(client);
    await expect(store.listVersions(SCENARIO)).rejects.toBeInstanceOf(ModelVersionStoreError);
  });
});

describe('SupabaseModelVersionStore.getVersion', () => {
  it('filters by BOTH scenario_id and id; returns the full record including graph', async () => {
    const graph = { nodes: [{ id: 'n1' }], edges: [] };
    const { client, selectCalls } = makeClient({
      selectResult: { data: { ...summaryRow(), graph }, error: null },
    });
    const store = new SupabaseModelVersionStore(client);

    const version = await store.getVersion(SCENARIO, VERSION_ID);

    expect(selectCalls[0]!.filters['eq:scenario_id']).toBe(SCENARIO);
    expect(selectCalls[0]!.filters['eq:id']).toBe(VERSION_ID);
    expect(version?.graph).toEqual(graph);
    expect(version?.version_number).toBe(3);
  });

  it('returns null when absent (cross-scenario ids read as absent, never leak)', async () => {
    const { client } = makeClient({ selectResult: { data: null, error: null } });
    const store = new SupabaseModelVersionStore(client);
    expect(await store.getVersion(SCENARIO, VERSION_ID)).toBeNull();
  });
});

describe('SupabaseModelVersionStore.getCurrentVersionId (pointer semantics)', () => {
  it('reads scenarios.current_model_version_id', async () => {
    const { client, selectCalls } = makeClient({
      selectResult: { data: { current_model_version_id: VERSION_ID }, error: null },
    });
    const store = new SupabaseModelVersionStore(client);
    expect(await store.getCurrentVersionId(SCENARIO)).toBe(VERSION_ID);
    expect(selectCalls[0]!.table).toBe('scenarios');
    expect(selectCalls[0]!.cols).toBe('current_model_version_id');
    expect(selectCalls[0]!.filters['eq:id']).toBe(SCENARIO);
  });

  it('null pointer (no versions yet) reads as null', async () => {
    const { client } = makeClient({
      selectResult: { data: { current_model_version_id: null }, error: null },
    });
    const store = new SupabaseModelVersionStore(client);
    expect(await store.getCurrentVersionId(SCENARIO)).toBeNull();
  });
});
