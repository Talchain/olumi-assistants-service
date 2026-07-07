/**
 * ModelManagementService unit tests (fake store port — no Supabase, no DB).
 *
 * Covers: CEE-side identity-envelope computation (Group A module reused),
 * empty-graph refusal, guest-refusal copy ("version history requires
 * sign-in" semantics), CAS-conflict vocabulary, restore-creates-new-version
 * semantics, version event sink emission (at-least-once, idempotent-by-key,
 * never fails the result), and compare wiring.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  computeGraphIdentityHash,
  GRAPH_SCHEMA_VERSION,
  IDENTITY_NORMALISER_VERSION,
  IDENTITY_PROJECTION_VERSION,
} from '../../context/graph-identity.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
import { ModelManagementService } from '../service.js';
import {
  ModelVersionCasConflictError,
  ModelVersionNotFoundError,
  ModelVersionSignInRequiredError,
  type ModelVersionStorePort,
  type SaveVersionWrite,
} from '../store-adapter.js';
import {
  CAS_CONFLICT_KIND,
  SIGN_IN_REQUIRED_MESSAGE,
  type ModelVersionEvent,
  type ModelVersionRecord,
  type VersionEventSink,
  type VersionWriteOutcome,
} from '../types.js';

const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_ID = '11111111-1111-4111-8111-111111111111';
const NEW_ID = '33333333-3333-4333-8333-333333333333';

const GRAPH = {
  nodes: [
    { id: 'n1', kind: 'factor', label: 'Price' },
    { id: 'n2', kind: 'outcome', label: 'Revenue' },
  ],
  edges: [{ from: 'n1', to: 'n2' }],
};

function outcome(overrides: Partial<VersionWriteOutcome> = {}): VersionWriteOutcome {
  return {
    version_id: NEW_ID,
    version_number: 4,
    graph_identity_hash: 'c'.repeat(64),
    deduped: false,
    event_id: `model_version_created_${NEW_ID}`,
    ...overrides,
  };
}

function record(overrides: Partial<ModelVersionRecord> = {}): ModelVersionRecord {
  return {
    id: TARGET_ID,
    scenario_id: SCENARIO,
    owner_user_id: OWNER,
    version_number: 1,
    graph: GRAPH,
    graph_identity_hash: 'a'.repeat(64),
    hash_algorithm: 'sha256',
    identity_projection_version: IDENTITY_PROJECTION_VERSION,
    identity_normaliser_version: IDENTITY_NORMALISER_VERSION,
    graph_schema_version: GRAPH_SCHEMA_VERSION,
    label: null,
    provenance: null,
    restored_from_version_id: null,
    created_at: '2026-07-05T10:00:00.000+00:00',
    ...overrides,
  };
}

function makeStore(overrides: Partial<ModelVersionStorePort> = {}): ModelVersionStorePort {
  return {
    saveVersion: vi.fn().mockResolvedValue(outcome()),
    listVersions: vi.fn().mockResolvedValue([]),
    getVersion: vi.fn().mockResolvedValue(record()),
    restoreVersion: vi.fn().mockResolvedValue(outcome()),
    getCurrentVersionId: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeService(store: ModelVersionStorePort, sink?: { emit: ReturnType<typeof vi.fn> }) {
  // Two explicit branches (no conditional spread): exactOptionalPropertyTypes
  // rejects `eventSink?: ... | undefined` produced by `...(sink ? {...} : {})`.
  if (sink) {
    return new ModelManagementService({
      store,
      // Bare vi.fn() types as Mock<Procedure|Constructable>, which does not
      // structurally satisfy emit's signature — safe test-only cast.
      eventSink: sink as unknown as VersionEventSink,
      isEnabled: () => true,
    });
  }
  return new ModelManagementService({ store, isEnabled: () => true });
}

describe('saveVersion — CEE-side identity envelope (Group A reuse, no re-implementation)', () => {
  it('computes graphIdentityHash + envelope fields and hands them to the store verbatim', async () => {
    const store = makeStore();
    const service = makeService(store);

    const result = await service.saveVersion({
      scenario_id: SCENARIO,
      graph: GRAPH,
      label: 'v-label',
      provenance: 'user_save',
    });

    expect(result.status).toBe('ok');
    expect(store.saveVersion).toHaveBeenCalledTimes(1);
    const write = (store.saveVersion as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SaveVersionWrite;

    // The hash must be EXACTLY what the sanctioned Group A module computes.
    const expected = computeGraphIdentityHash(GRAPH as unknown as GraphStateIngress);
    expect(expected).not.toBeNull();
    expect(write.graph_identity_hash).toBe(expected!.value);
    expect(write.graph_identity_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(write.hash_algorithm).toBe('sha256');
    expect(write.identity_projection_version).toBe(IDENTITY_PROJECTION_VERSION);
    expect(write.identity_normaliser_version).toBe(IDENTITY_NORMALISER_VERSION);
    expect(write.graph_schema_version).toBe(GRAPH_SCHEMA_VERSION);
    expect(write.graph).toBe(GRAPH);
    expect(write.label).toBe('v-label');
    expect(write.provenance).toBe('user_save');
  });

  it('refuses absent/identity-empty graphs with a typed recoverable empty_graph error (store untouched)', async () => {
    const store = makeStore();
    const service = makeService(store);

    for (const graph of [null, undefined, {}, { nodes: [], edges: [] }]) {
      const result = await service.saveVersion({ scenario_id: SCENARIO, graph });
      expect(result).toEqual({
        status: 'error',
        error: {
          code: 'empty_graph',
          recoverable: true,
          message: expect.stringContaining('identity-empty') as unknown as string,
        },
      });
    }
    expect(store.saveVersion).not.toHaveBeenCalled();
  });

  it('threads the optional expected hash through as the CAS seam', async () => {
    const store = makeStore();
    const service = makeService(store);
    const expectedHash = 'd'.repeat(64);
    await service.saveVersion({
      scenario_id: SCENARIO,
      graph: GRAPH,
      expected_graph_identity_hash: expectedHash,
    });
    const write = (store.saveVersion as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as SaveVersionWrite;
    expect(write.expected_graph_identity_hash).toBe(expectedHash);
  });
});

describe('typed error mapping (service never throws)', () => {
  it('guest refusal → sign_in_required with the exact D3 interim copy', async () => {
    const store = makeStore({
      saveVersion: vi.fn().mockRejectedValue(new ModelVersionSignInRequiredError('MV001')),
    });
    const service = makeService(store);
    const result = await service.saveVersion({ scenario_id: SCENARIO, graph: GRAPH });
    expect(result).toEqual({
      status: 'error',
      error: {
        code: 'sign_in_required',
        recoverable: true,
        message: SIGN_IN_REQUIRED_MESSAGE,
      },
    });
    expect(SIGN_IN_REQUIRED_MESSAGE).toBe('Version history requires sign-in.');
  });

  it('stale CAS → typed conflict named with the A3 vocabulary term', async () => {
    const expectedHash = 'e'.repeat(64);
    const store = makeStore({
      restoreVersion: vi
        .fn()
        .mockRejectedValue(new ModelVersionCasConflictError('MV409', expectedHash)),
    });
    const service = makeService(store);
    const result = await service.restoreVersion({
      scenario_id: SCENARIO,
      version_id: TARGET_ID,
      expected_graph_identity_hash: expectedHash,
    });
    expect(result.status).toBe('conflict');
    if (result.status === 'conflict') {
      expect(result.conflict.kind).toBe('analysis_affecting_conflict');
      expect(result.conflict.kind).toBe(CAS_CONFLICT_KIND);
      expect(result.conflict.expected_graph_identity_hash).toBe(expectedHash);
    }
  });

  it('unknown store failures → fail-closed store_error, never a throw', async () => {
    const store = makeStore({
      listVersions: vi.fn().mockRejectedValue(new Error('relation model_versions does not exist')),
    });
    const service = makeService(store);
    const result = await service.listVersions(SCENARIO);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('store_error');
      expect(result.error.recoverable).toBe(false);
    }
  });

  it('getVersion absent → typed version_not_found', async () => {
    const store = makeStore({ getVersion: vi.fn().mockResolvedValue(null) });
    const service = makeService(store);
    const result = await service.getVersion(SCENARIO, TARGET_ID);
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.error.code).toBe('version_not_found');
  });

  it('store MV404 on restore → typed version_not_found', async () => {
    const store = makeStore({
      restoreVersion: vi.fn().mockRejectedValue(new ModelVersionNotFoundError('MV404')),
    });
    const service = makeService(store);
    const result = await service.restoreVersion({ scenario_id: SCENARIO, version_id: TARGET_ID });
    expect(result.status).toBe('error');
    if (result.status === 'error') expect(result.error.code).toBe('version_not_found');
  });
});

describe('restore semantics — restore creates a NEW version, never rewrites', () => {
  it('surfaces the new version id + lineage from the store outcome', async () => {
    const store = makeStore({
      restoreVersion: vi.fn().mockResolvedValue(
        outcome({
          version_id: NEW_ID,
          version_number: 5,
          restored_from_version_id: TARGET_ID,
          event_id: `model_version_restored_${NEW_ID}`,
        }),
      ),
    });
    const service = makeService(store);
    const result = await service.restoreVersion({ scenario_id: SCENARIO, version_id: TARGET_ID });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.value.version_id).toBe(NEW_ID);
      expect(result.value.version_id).not.toBe(TARGET_ID);
      expect(result.value.version_number).toBe(5);
      expect(result.value.restored_from_version_id).toBe(TARGET_ID);
    }
  });
});

describe('version event sink (contract §7.3 seam)', () => {
  it('emits exactly one event per durable write, keyed by the RPC event id', async () => {
    const sink = { emit: vi.fn().mockResolvedValue(undefined) };
    const store = makeStore();
    const service = makeService(store, sink);

    await service.saveVersion({ scenario_id: SCENARIO, graph: GRAPH });

    expect(sink.emit).toHaveBeenCalledTimes(1);
    const event = sink.emit.mock.calls[0]![0] as ModelVersionEvent;
    expect(event.event_version).toBe('model_version_event.v1');
    expect(event.event_id).toBe(`model_version_created_${NEW_ID}`);
    expect(event.event_type).toBe('model_version_created');
    expect(event.scenario_id).toBe(SCENARIO);
    expect(event.version_id).toBe(NEW_ID);
    expect(event.version_number).toBe(4);
  });

  it('emits model_version_restored with lineage on restore', async () => {
    const sink = { emit: vi.fn().mockResolvedValue(undefined) };
    const store = makeStore({
      restoreVersion: vi.fn().mockResolvedValue(
        outcome({
          restored_from_version_id: TARGET_ID,
          event_id: `model_version_restored_${NEW_ID}`,
        }),
      ),
    });
    const service = makeService(store, sink);
    await service.restoreVersion({ scenario_id: SCENARIO, version_id: TARGET_ID });
    const event = sink.emit.mock.calls[0]![0] as ModelVersionEvent;
    expect(event.event_type).toBe('model_version_restored');
    expect(event.restored_from_version_id).toBe(TARGET_ID);
  });

  it('deduped writes emit NO event (history records changes, not confirmations)', async () => {
    const sink = { emit: vi.fn().mockResolvedValue(undefined) };
    const store = makeStore({
      saveVersion: vi.fn().mockResolvedValue(outcome({ deduped: true, event_id: null })),
    });
    const service = makeService(store, sink);
    const result = await service.saveVersion({ scenario_id: SCENARIO, graph: GRAPH });
    expect(result.status).toBe('ok');
    expect(sink.emit).not.toHaveBeenCalled();
  });

  it('sink failure never fails the user-facing result (at-least-once, re-drivable)', async () => {
    const sink = { emit: vi.fn().mockRejectedValue(new Error('sink down')) };
    const store = makeStore();
    const service = makeService(store, sink);
    const result = await service.saveVersion({ scenario_id: SCENARIO, graph: GRAPH });
    expect(result.status).toBe('ok');
    expect(sink.emit).toHaveBeenCalledTimes(1);
  });
});

describe('compareVersions wiring', () => {
  it('fetches both versions and short-circuits on identical identity envelopes', async () => {
    const store = makeStore({
      getVersion: vi
        .fn()
        .mockResolvedValueOnce(record())
        .mockResolvedValueOnce(record({ id: NEW_ID, version_number: 2 })),
    });
    const service = makeService(store);
    const result = await service.compareVersions(SCENARIO, TARGET_ID, NEW_ID);
    expect(result).toEqual({
      status: 'ok',
      value: { relation: 'identical', short_circuit: true },
    });
    expect(store.getVersion).toHaveBeenCalledWith(SCENARIO, TARGET_ID);
    expect(store.getVersion).toHaveBeenCalledWith(SCENARIO, NEW_ID);
  });

  it('either side missing → typed version_not_found naming the absent id', async () => {
    const store = makeStore({
      getVersion: vi
        .fn()
        .mockResolvedValueOnce(record())
        .mockResolvedValueOnce(null),
    });
    const service = makeService(store);
    const result = await service.compareVersions(SCENARIO, TARGET_ID, NEW_ID);
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('version_not_found');
      expect(result.error.message).toContain(NEW_ID);
    }
  });
});
