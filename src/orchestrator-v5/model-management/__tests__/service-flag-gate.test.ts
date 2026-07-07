/**
 * Model Management v1 — flag gate (CEE_MODEL_VERSIONS_ENABLED, default OFF).
 *
 * Every service entry point must fail-closed no-op to `{ status:
 * 'disabled' }` when the flag is off: no store call, no hashing, no event
 * emission. Also pins that the DEFAULT config value is OFF (a service
 * built with no isEnabled override, against pristine config, is disabled).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { config } from '../../../config/index.js';
import { ModelManagementService } from '../service.js';
import type { ModelVersionStorePort } from '../store-adapter.js';
import type { VersionEventSink } from '../types.js';

const SCENARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERSION_A = '11111111-1111-4111-8111-111111111111';
const VERSION_B = '22222222-2222-4222-8222-222222222222';

/** A store whose every method detonates — proof no path touches it when off. */
function explodingStore(): ModelVersionStorePort {
  const boom = () => {
    throw new Error('store must not be called while the flag is off');
  };
  return {
    saveVersion: vi.fn(boom),
    listVersions: vi.fn(boom),
    getVersion: vi.fn(boom),
    restoreVersion: vi.fn(boom),
    getCurrentVersionId: vi.fn(boom),
  };
}

function explodingSink(): VersionEventSink {
  return {
    emit: vi.fn(() => {
      throw new Error('sink must not be called while the flag is off');
    }),
  };
}

const GRAPH = {
  nodes: [{ id: 'n1', kind: 'factor', label: 'A' }],
  edges: [],
};

describe('ModelManagementService — flag OFF is a typed fail-closed no-op at EVERY entry point', () => {
  it('saveVersion / restoreVersion / listVersions / getVersion / getCurrentVersion / compareVersions all return disabled', async () => {
    const store = explodingStore();
    const sink = explodingSink();
    const service = new ModelManagementService({
      store,
      eventSink: sink,
      isEnabled: () => false,
    });

    const results = [
      await service.saveVersion({ scenario_id: SCENARIO, graph: GRAPH }),
      await service.restoreVersion({ scenario_id: SCENARIO, version_id: VERSION_A }),
      await service.listVersions(SCENARIO),
      await service.getVersion(SCENARIO, VERSION_A),
      await service.getCurrentVersion(SCENARIO),
      await service.compareVersions(SCENARIO, VERSION_A, VERSION_B),
    ];

    for (const result of results) {
      expect(result).toEqual({ status: 'disabled' });
    }
    for (const method of Object.values(store)) {
      expect(method).not.toHaveBeenCalled();
    }
    expect(sink.emit).not.toHaveBeenCalled();
  });
});

describe('ModelManagementService — default flag wiring', () => {
  // The repo-wide vitest.setup.ts calls _resetConfigCache() before EACH test,
  // so config.cee must be re-accessed at call time — a module-scope capture
  // would mutate a stale, discarded parse.
  const cee = () => config.cee as unknown as { modelVersionsEnabled: boolean };

  afterEach(() => {
    cee().modelVersionsEnabled = false;
  });

  it('config default is OFF (CEE_MODEL_VERSIONS_ENABLED unset ⇒ disabled)', async () => {
    // Pristine config in the test env carries the schema default: false.
    expect(config.cee.modelVersionsEnabled).toBe(false);

    const store = explodingStore();
    const service = new ModelManagementService({ store }); // no isEnabled override
    expect(await service.listVersions(SCENARIO)).toEqual({ status: 'disabled' });
    expect(store.listVersions).not.toHaveBeenCalled();
  });

  it('flag flip is honoured at CALL time (no boot-time capture)', async () => {
    const store = explodingStore();
    (store.listVersions as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const service = new ModelManagementService({ store });

    expect(await service.listVersions(SCENARIO)).toEqual({ status: 'disabled' });

    cee().modelVersionsEnabled = true;
    expect(await service.listVersions(SCENARIO)).toEqual({ status: 'ok', value: [] });

    cee().modelVersionsEnabled = false;
    expect(await service.listVersions(SCENARIO)).toEqual({ status: 'disabled' });
  });
});
