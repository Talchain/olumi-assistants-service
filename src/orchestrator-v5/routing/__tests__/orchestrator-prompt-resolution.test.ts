/**
 * V5 routing prompt resolution — PMS `orchestrator` alias.
 *
 * The CEE/V5 routing prompt IS the operator-managed `orchestrator` PMS
 * prompt (Paul manages `olumi_orchestrator_system_prompt_v…`), NOT a
 * separate `routing` row. These tests pin the smallest-safe fix:
 *   - the routing snapshot's PMS lookup uses `task_id='orchestrator'`;
 *   - the fallback stays the guard-safe `routing` v40 default — never the
 *     ~57k `orchestrator` v28 default;
 *   - the [18.5k–22k] routing guard still applies to the resolved prompt;
 *   - health/status reporting shows the PMS-backed orchestrator source.
 *
 * Only the prompt store is mocked (getCompiled / db-health), via
 * `importActual` so the rest of the prompts module graph is real.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import { createHash } from 'node:crypto';

// Hoisted so the (hoisted) vi.mock factory can close over it.
const { getCompiledMock } = vi.hoisted(() => ({ getCompiledMock: vi.fn() }));

vi.mock('../../../prompts/store.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../prompts/store.js')>();
  return {
    ...actual,
    // Force the store path on (isPromptManagementEnabled) + inject a
    // controllable getCompiled. `get` is unused by these paths.
    isDbBackedStoreHealthy: () => true,
    getPromptStore: () =>
      ({ getCompiled: getCompiledMock, get: vi.fn(async () => null) }) as unknown as ReturnType<
        typeof actual.getPromptStore
      >,
  };
});

// Imported after the hoisted mock is registered.
import { loadPrompt, getDefaultPrompts } from '../../../prompts/index.js';
import { PMS_TASK_ALIAS, pmsResolveTaskId } from '../../../prompts/tracked.js';
import { probeTrackedPrompts } from '../../../prompts/readiness.js';
import {
  buildRoutingPromptSnapshot,
  refreshRoutingPromptSnapshot,
  getRoutingPromptSnapshot,
  __resetRoutingPromptSnapshotForTests,
  EXPECTED_SYSTEM_CHARS_MIN,
  EXPECTED_SYSTEM_CHARS_MAX,
} from '../prompt-loader.js';

// A valid, in-guard orchestrator prompt body (no newlines/trailing ws so
// the snapshot normaliser leaves the length unchanged).
const ORCH_CONTENT = 'X'.repeat(20_000);
const ORCH_HASH = createHash('sha256').update(ORCH_CONTENT).digest('hex');

function orchestratorRow(version = 111, content = ORCH_CONTENT) {
  return { content, promptId: 'orchestrator_default', version };
}

beforeEach(() => {
  getCompiledMock.mockReset();
  __resetRoutingPromptSnapshotForTests();
});

describe('V5 routing prompt resolution → PMS orchestrator alias', () => {
  it('alias is the single source of truth: routing → orchestrator; others unchanged', () => {
    expect(PMS_TASK_ALIAS.routing).toBe('orchestrator');
    expect(pmsResolveTaskId('routing')).toBe('orchestrator');
    expect(pmsResolveTaskId('edit_graph')).toBe('edit_graph');
    expect(pmsResolveTaskId('orchestrator')).toBe('orchestrator');
  });

  it('req1+2: loadPrompt("routing") queries PMS task_id="orchestrator" and serves it; hash matches orchestrator, not v40', async () => {
    getCompiledMock.mockResolvedValue(orchestratorRow());
    const loaded = await loadPrompt('routing', { trigger: 'startup' });

    expect(getCompiledMock).toHaveBeenCalledTimes(1);
    expect(getCompiledMock.mock.calls[0]![0]).toBe('orchestrator'); // NOT 'routing'
    expect(loaded.source).toBe('store');
    expect(loaded.content).toBe(ORCH_CONTENT);
    expect(loaded.version).toBe(111);
    expect(createHash('sha256').update(loaded.content).digest('hex')).toBe(ORCH_HASH);
    expect(loaded.content).not.toBe(getDefaultPrompts().routing); // not the fallback v40
  });

  it('req3+4: PMS-unavailable fallback uses the routing v40 default (in-guard), never the 57k orchestrator v28', async () => {
    getCompiledMock.mockResolvedValue(null); // no PMS row for orchestrator
    const loaded = await loadPrompt('routing', { trigger: 'startup' });

    expect(getCompiledMock.mock.calls[0]![0]).toBe('orchestrator'); // still looked up orchestrator
    expect(loaded.source).toBe('default');
    expect(loaded.content).toBe(getDefaultPrompts().routing); // the v40 routing default
    // Within the routing guard ⇒ this is v40 (~21.4k), NOT the ~57.6k v28
    // orchestrator default (which would blow the guard and crash boot).
    expect(loaded.content.length).toBeGreaterThanOrEqual(EXPECTED_SYSTEM_CHARS_MIN);
    expect(loaded.content.length).toBeLessThanOrEqual(EXPECTED_SYSTEM_CHARS_MAX);
    const orchestratorDefault = getDefaultPrompts().orchestrator;
    if (orchestratorDefault) {
      expect(loaded.content).not.toBe(orchestratorDefault);
      expect(orchestratorDefault.length).toBeGreaterThan(EXPECTED_SYSTEM_CHARS_MAX); // v28 is oversized
    }
  });

  it('req1: snapshot resolves the orchestrator PMS prompt and passes the guard', async () => {
    getCompiledMock.mockResolvedValue(orchestratorRow());
    const snap = await buildRoutingPromptSnapshot();
    expect(snap.source).toBe('store');
    expect(snap.version).toBe('111');
    expect(snap.systemChars).toBe(20_000);
  });

  it('req3: snapshot falls back to v40 and passes the guard when PMS is unavailable', async () => {
    getCompiledMock.mockResolvedValue(null);
    const snap = await buildRoutingPromptSnapshot();
    expect(snap.source).toBe('default');
    expect(snap.version).toBe('v40');
    expect(snap.systemChars).toBeGreaterThanOrEqual(EXPECTED_SYSTEM_CHARS_MIN);
    expect(snap.systemChars).toBeLessThanOrEqual(EXPECTED_SYSTEM_CHARS_MAX);
  });

  it('req5: an OVERSIZED PMS orchestrator prompt fails the routing guard (boot refuses to start)', async () => {
    getCompiledMock.mockResolvedValue(
      orchestratorRow(999, 'Y'.repeat(EXPECTED_SYSTEM_CHARS_MAX + 5_000)),
    );
    await expect(buildRoutingPromptSnapshot()).rejects.toThrow(/outside expected range/);
  });

  it('req5 (defence-in-depth): an UNDERSIZED PMS orchestrator prompt also fails the guard', async () => {
    getCompiledMock.mockResolvedValue(
      orchestratorRow(998, 'Z'.repeat(EXPECTED_SYSTEM_CHARS_MIN - 5_000)),
    );
    await expect(buildRoutingPromptSnapshot()).rejects.toThrow(/outside expected range/);
  });

  it('req6: health probe reports the routing key as PMS-backed (source=pms, version=orchestrator active)', async () => {
    getCompiledMock.mockResolvedValue(orchestratorRow());
    const statuses = await probeTrackedPrompts('healthz');
    const routing = statuses.find((s) => s.key === 'routing');
    expect(routing).toBeDefined();
    expect(routing!.source).toBe('pms'); // was 'default' before the fix
    expect(routing!.version).toBe('111');
  });
});

describe('false-green guard: a rejected oversized reload does not green-light routing', () => {
  it('reports the OLD served snapshot + snapshot_error after a rejected oversized reload — not the rejected PMS row as green', async () => {
    // 1. Good state: in-guard orchestrator v111 builds + serves.
    getCompiledMock.mockResolvedValue(orchestratorRow(111, ORCH_CONTENT));
    const good = await buildRoutingPromptSnapshot();
    expect(good.source).toBe('store');
    expect(good.version).toBe('111');
    const servedHash = good.raw_hash;

    // 2. Operator uploads an OVERSIZED orchestrator prompt (v112).
    getCompiledMock.mockResolvedValue(
      orchestratorRow(112, 'O'.repeat(EXPECTED_SYSTEM_CHARS_MAX + 8_000)),
    );

    // 3. Reload REJECTS it (size guard) and atomically restores the prior snapshot.
    await expect(refreshRoutingPromptSnapshot()).rejects.toThrow(/outside expected range/);

    // 4. The live snapshot is STILL v111 — the rejected v112 is never served.
    const live = getRoutingPromptSnapshot();
    expect(live.version).toBe('111');
    expect(live.raw_hash).toBe(servedHash);

    // 5. Health/status report the SERVED old snapshot (not the rejected v112)
    //    and surface snapshot_error — closing the false-green path.
    const routing = (await probeTrackedPrompts('healthz')).find((s) => s.key === 'routing')!;
    expect(routing.source).toBe('pms'); // serving a PMS prompt (the old one)
    expect(routing.version).toBe('111'); // SERVED version, NOT the rejected '112'
    expect(routing.content_hash).toBe(servedHash); // served hash, not the oversized one
    expect(routing.pms_task).toBe('orchestrator');
    expect(routing.snapshot_error).toBeDefined();
    expect(routing.snapshot_error).toMatch(/outside expected range/);
  });

  it('a subsequent SUCCESSFUL reload clears snapshot_error and advances the served version', async () => {
    getCompiledMock.mockResolvedValue(orchestratorRow(111, ORCH_CONTENT));
    await buildRoutingPromptSnapshot();

    // Fail a reload → snapshot_error is set, served version stays old.
    getCompiledMock.mockResolvedValue(
      orchestratorRow(112, 'O'.repeat(EXPECTED_SYSTEM_CHARS_MAX + 8_000)),
    );
    await expect(refreshRoutingPromptSnapshot()).rejects.toThrow();
    let routing = (await probeTrackedPrompts('healthz')).find((s) => s.key === 'routing')!;
    expect(routing.snapshot_error).toBeDefined();
    expect(routing.version).toBe('111');

    // A good reload → snapshot_error cleared, served version advances.
    getCompiledMock.mockResolvedValue(orchestratorRow(113, ORCH_CONTENT));
    await refreshRoutingPromptSnapshot();
    routing = (await probeTrackedPrompts('healthz')).find((s) => s.key === 'routing')!;
    expect(routing.snapshot_error).toBeUndefined();
    expect(routing.source).toBe('pms');
    expect(routing.version).toBe('113');
  });
});
