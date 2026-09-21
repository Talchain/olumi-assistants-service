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
        lt: (col: string, val: unknown) => {
          filters[`lt:${col}`] = val;
          return chain;
        },
        limit: (n: number) => {
          filters.limit = n;
          return Promise.resolve(cfg.selectResult ?? { data: [], error: null });
        },
        maybeSingle: () => {
          filters.maybeSingle = true;
          return Promise.resolve(cfg.selectResult ?? { data: null, error: null });
        },
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
    analysis_affecting_hash: HASH_B,
    mutation_id: null,
    parent_version_id: null,
    root_version_id: null,
    actor_kind: null,
    authored_by: null,
    creation_kind: null,
    source_version_id: null,
    source_turn_id: null,
    label: null,
    provenance: 'user_save',
    restored_from_version_id: null,
    graph: { nodes: [{ id: 'n1', kind: 'factor', label: 'Price' }], edges: [] },
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

function atomicRestoreOutcome(overrides: Record<string, unknown> = {}) {
  return {
    mutation_id: '22222222-2222-4222-8222-222222222222',
    version_id: '33333333-3333-4333-8333-333333333333',
    version_number: 4,
    graph_identity_hash: HASH_B,
    analysis_affecting_hash: HASH_A,
    hash_algorithm: 'sha256',
    identity_projection_version: 'identity.v1',
    identity_normaliser_version: '1',
    graph_schema_version: 'graph_v3',
    restored_from_version_id: VERSION_ID,
    undo_version_id: null,
    parent_version_id: VERSION_ID,
    root_version_id: VERSION_ID,
    actor_kind: 'known',
    authored_by: 'owner',
    creation_kind: 'restore',
    source_version_id: VERSION_ID,
    source_turn_id: null,
    graph: SAVE_WRITE.graph,
    deduped: false,
    replayed: false,
    analysis_invalidated_at: '2026-08-24T20:00:00.000Z',
    event_id: 'model_version_restored_33333333-3333-4333-8333-333333333333',
    ...overrides,
  };
}

const ATOMIC_RESTORE_WRITE = {
  scenario_id: SCENARIO,
  version_id: VERSION_ID,
  mutation_id: '22222222-2222-4222-8222-222222222222',
  graph: SAVE_WRITE.graph,
  graph_identity_hash: HASH_B,
  analysis_affecting_hash: HASH_A,
  hash_algorithm: 'sha256',
  identity_projection_version: 'identity.v1',
  identity_normaliser_version: '1',
  graph_schema_version: 'graph_v3',
  source_graph_identity_hash: HASH_A,
  current_graph: SAVE_WRITE.graph,
  current_graph_identity_hash: HASH_A,
  current_analysis_affecting_hash: HASH_A,
  expected_graph_identity_hash: HASH_A,
  actor_kind: 'known' as const,
  authored_by: 'owner',
  source_turn_id: null,
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

describe('SupabaseModelVersionStore.restoreVersionAtomic', () => {
  it('accepts an attested known actor from the guarded restore RPC', async () => {
    const { client } = makeClient({
      rpcResult: { data: atomicRestoreOutcome(), error: null },
    });
    const store = new SupabaseModelVersionStore(client);
    const result = await store.restoreVersionAtomic(ATOMIC_RESTORE_WRITE);
    expect(result.actor_kind).toBe('known');
    expect(result.authored_by).toBe('owner');
  });

  it.each(['system', 'unknown'] as const)(
    'rejects contradictory %s attribution before receipt projection',
    async (actorKind) => {
      const { client } = makeClient({
        rpcResult: {
          data: atomicRestoreOutcome({ actor_kind: actorKind, authored_by: 'owner' }),
          error: null,
        },
      });
      const store = new SupabaseModelVersionStore(client);
      await expect(store.restoreVersionAtomic(ATOMIC_RESTORE_WRITE)).rejects.toBeInstanceOf(
        ModelVersionStoreError,
      );
    },
  );

  it('rejects a known actor without authored_by and contradictory restore provenance', async () => {
    for (const outcome of [
      atomicRestoreOutcome({ authored_by: null }),
      atomicRestoreOutcome({ creation_kind: 'committed_mutation' }),
      atomicRestoreOutcome({ source_version_id: '44444444-4444-4444-8444-444444444444' }),
    ]) {
      const { client } = makeClient({ rpcResult: { data: outcome, error: null } });
      const store = new SupabaseModelVersionStore(client);
      await expect(store.restoreVersionAtomic(ATOMIC_RESTORE_WRITE)).rejects.toBeInstanceOf(
        ModelVersionStoreError,
      );
    }
  });
});

describe('SupabaseModelVersionStore.listVersions', () => {
  it('reads newest-first and discards the internal legacy-hash graph from summaries', async () => {
    const rows = [summaryRow({ version_number: 2 }), summaryRow({ id: '44444444-4444-4444-8444-444444444444', version_number: 1 })];
    const { client, selectCalls } = makeClient({ selectResult: { data: rows, error: null } });
    const store = new SupabaseModelVersionStore(client);

    const versions = await store.listVersions(SCENARIO, 10);

    expect(selectCalls[0]!.table).toBe('model_versions');
    expect(selectCalls[0]!.cols).toMatch(/,\s*graph\b/);
    expect(selectCalls[0]!.filters['eq:scenario_id']).toBe(SCENARIO);
    expect(selectCalls[0]!.filters['order:version_number']).toEqual({ ascending: false });
    expect(selectCalls[0]!.filters.limit).toBe(10);
    expect(versions.map((v) => v.version_number)).toEqual([2, 1]);
    expect(versions.every((version) => !Object.hasOwn(version, 'graph'))).toBe(true);
  });

  it('applies an exclusive sequence cursor and derives a missing legacy analysis hash', async () => {
    const legacy = summaryRow({ analysis_affecting_hash: null });
    const { client, selectCalls } = makeClient({
      selectResult: { data: [legacy], error: null },
    });
    const store = new SupabaseModelVersionStore(client);

    const [version] = await store.listVersions(SCENARIO, 6, 10);

    expect(selectCalls[0]!.filters['lt:version_number']).toBe(10);
    expect(version!.analysis_affecting_hash).toMatch(/^[0-9a-f]{64}$/);
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

  // The legacy-derivation path above hashes `row.graph`, which is `unknown` off
  // the row. These pin the two measured ways that goes wrong, and they bind to
  // the GUARD's own message, not merely to the error class — the pre-existing
  // "analysis-affecting identity is unavailable" throw is also a
  // ModelVersionStoreError, so `toBeInstanceOf` alone would not discriminate
  // which check fired.
  it.each([
    // Not dereferenceable as an object at all.
    ['a string', 'corrupt', /row field 'graph' must be an object/],
    ['a number', 42, /row field 'graph' must be an object/],
    ['an array', [1, 2, 3], /row field 'graph' must be an object/],
    ['null', null, /row field 'graph' must be an object/],
    // An object, but the projection dereferences `nodes.length` unconditionally,
    // so a graph-shaped-but-nodeless row is the raw-TypeError case.
    ['a non-graph object', { corrupted: true }, /row field 'graph\.nodes' must be an array of objects/],
    ['a graph with no edges key', { nodes: [] }, /row field 'graph\.edges' must be an array of objects/],
    // Measured at this tip: this shape hashes to a well-formed 64-hex that can
    // never equal an identity computed on the write path. This is the case a
    // bare `as` cast would have shipped — served as an authoritative
    // analysis_affecting_hash, the field CAS and freshness compare on.
    [
      'a graph whose nodes hold non-objects',
      { nodes: [42, 'x'], edges: [] },
      /row field 'graph\.nodes' must be an array of objects/,
    ],
  ])(
    'refuses to derive a legacy analysis hash when graph is %s (typed, never a raw TypeError or a silent hash)',
    async (_label, graph, expectedMessage) => {
      const { client } = makeClient({
        selectResult: {
          data: [summaryRow({ analysis_affecting_hash: null, graph })],
          error: null,
        },
      });
      const store = new SupabaseModelVersionStore(client);
      const rejection = await store.listVersions(SCENARIO).then(
        () => null,
        (e: unknown) => e,
      );
      expect(rejection).toBeInstanceOf(ModelVersionStoreError);
      expect((rejection as Error).message).toMatch(expectedMessage as RegExp);
    },
  );

  it('CONTRAST: a legacy graph whose nodes lack kind/label still derives (persistence never required the wire fields)', async () => {
    // This is the discriminating half. The repo's usual parser for this shape,
    // GraphStateIngressSchema, REJECTS this row (it requires node.kind and
    // node.label for the UI wire contract). Gating the derivation on it would
    // turn the legacy backfill into a hard read failure. If this case ever
    // starts throwing, the guard has been tightened to the wrong boundary.
    const { client } = makeClient({
      selectResult: {
        data: [summaryRow({ analysis_affecting_hash: null, graph: { nodes: [{ id: 'n1' }], edges: [] } })],
        error: null,
      },
    });
    const store = new SupabaseModelVersionStore(client);
    const [version] = await store.listVersions(SCENARIO);
    expect(version!.analysis_affecting_hash).toMatch(/^[0-9a-f]{64}$/);
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

describe('SupabaseModelVersionStore.getVersionForCommittedTurn', () => {
  const SOURCE_TURN = '55555555-5555-4555-8555-555555555555';
  const MUTATION = '66666666-6666-4666-8666-666666666666';

  it('reads the exact scenario/source-turn/mutation child, never the current head or newest row', async () => {
    const row = summaryRow({
      source_turn_id: SOURCE_TURN,
      mutation_id: MUTATION,
      creation_kind: 'committed_mutation',
      parent_version_id: 'parent-version',
    });
    const { client, rpcCalls, selectCalls } = makeClient({ selectResult: { data: row, error: null } });
    const store = new SupabaseModelVersionStore(client);
    const version = await store.getVersionForCommittedTurn(SCENARIO, SOURCE_TURN, MUTATION);
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]!.table).toBe('model_versions');
    expect(selectCalls[0]!.cols.split(',').map((column) => column.trim())).toEqual(expect.arrayContaining([
      'graph', 'source_turn_id', 'mutation_id', 'creation_kind', 'parent_version_id', 'scenario_id', 'owner_user_id',
    ]));
    expect(selectCalls[0]!.filters).toEqual({
      'eq:scenario_id': SCENARIO,
      'eq:source_turn_id': SOURCE_TURN,
      'eq:mutation_id': MUTATION,
      'eq:creation_kind': 'committed_mutation',
      maybeSingle: true,
    });
    expect(version).toMatchObject({
      id: VERSION_ID,
      scenario_id: SCENARIO,
      source_turn_id: SOURCE_TURN,
      mutation_id: MUTATION,
      creation_kind: 'committed_mutation',
      parent_version_id: 'parent-version',
      graph: row.graph,
    });
    expect(rpcCalls).toEqual([]);
  });

  it('an absent exact child remains null without falling back to a current or adjacent version', async () => {
    const { client, selectCalls } = makeClient({ selectResult: { data: null, error: null } });
    const store = new SupabaseModelVersionStore(client);
    expect(await store.getVersionForCommittedTurn('other-scenario', SOURCE_TURN, MUTATION)).toBeNull();
    expect(selectCalls).toHaveLength(1);
    expect(selectCalls[0]!.filters['eq:scenario_id']).toBe('other-scenario');
    expect(selectCalls[0]!.filters['eq:source_turn_id']).toBe(SOURCE_TURN);
    expect(selectCalls[0]!.filters['eq:mutation_id']).toBe(MUTATION);
  });

  it.each(['PGRST116', '08006'])(
    'ambiguous or failed child reads (%s) throw instead of picking one candidate',
    async (code) => {
      const { client } = makeClient({
        selectResult: { data: null, error: { code, message: 'No unique readable child' } },
      });
      const store = new SupabaseModelVersionStore(client);
      await expect(store.getVersionForCommittedTurn(SCENARIO, SOURCE_TURN, MUTATION))
        .rejects.toBeInstanceOf(ModelVersionStoreError);
    },
  );

  it('malformed returned metadata throws instead of fabricating a version record', async () => {
    const { client } = makeClient({ selectResult: { data: summaryRow({ id: null }), error: null } });
    const store = new SupabaseModelVersionStore(client);
    await expect(store.getVersionForCommittedTurn(SCENARIO, SOURCE_TURN, MUTATION))
      .rejects.toBeInstanceOf(ModelVersionStoreError);
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
