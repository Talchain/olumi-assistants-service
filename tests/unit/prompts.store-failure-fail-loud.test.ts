/**
 * Prompt store failure must FAIL LOUD.
 *
 * INCIDENT (P0, ~2.5h): a single poisoned PMS row made `SupabasePromptStore`
 * throw for every version of `draft_graph`. `loadPrompt` caught it, served a
 * bundled default, and NOTHING on the health surface changed:
 *
 *   1. `arePromptsReady()` is `statuses.every(s => s.source !== 'error')`, but
 *      the loader NEVER surfaces `error` — it catches internally and returns
 *      `source: 'default'`. So `prompts_ready` stays TRUE BY CONSTRUCTION
 *      whenever the store is broken and a bundled default exists.
 *   2. The readiness prober DISCARDED `loaded.fallbackReason`, so "no PMS row,
 *      by design" (`not_found`) and "the PMS store is THROWING" (`fetch_error`)
 *      surfaced identically.
 *   3. `emit()` logs at `log.info` (level 30), so an event literally named
 *      `prompt.loader.error` could not trip level-based alerting.
 *
 * THE DISCRIMINATING TWIN is the load-bearing half of this file: `not_found`
 * must NOT raise the alarm. An always-on alarm is no alarm, and `not_found` is
 * a legitimate steady state here (`m2_graph_review` has no PMS row by design).
 *
 * Bindings are by IDENTITY — the `FallbackReason` token and the reason
 * constant — never a substring of prose.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

const storeBehaviour: { mode: 'throws' | 'not_found' | 'ok' } = { mode: 'throws' };

vi.mock('../../src/prompts/store.js', async (importOriginal) => {
  // importOriginal spread: a bare factory REPLACES the module, and every
  // symbol added since would silently vanish (this estate's dominant defect).
  const actual = await importOriginal<typeof import('../../src/prompts/store.js')>();
  return {
    ...actual,
    isDbBackedStoreHealthy: () => true,
    getPromptStore: () => ({
      getCompiled: async () => {
        if (storeBehaviour.mode === 'throws') {
          // The exact incident shape.
          throw new SyntaxError('Unexpected end of JSON input');
        }
        if (storeBehaviour.mode === 'not_found') return null;
        return null;
      },
      get: async () => null,
    }),
  };
});

const logSpies = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const emitSpy = vi.fn();

vi.mock('../../src/utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/telemetry.js')>();
  return { ...actual, log: logSpies, emit: emitSpy };
});

const { registerAllDefaultPrompts } = await import('../../src/prompts/defaults.js');
const { loadPrompt } = await import('../../src/prompts/loader.js');
const {
  probeTrackedPrompts,
  getCriticalPromptCoverage,
  promptStoreDegradationReasons,
  CRITICAL_PROMPT_FETCH_ERROR_REASON,
  __resetPromptsReadyCacheForTests,
  TRACKED_KEYS,
} = await import('../../src/prompts/readiness.js');
const { __resetRoutingLiveStatusProviderForTests } = await import(
  '../../src/prompts/routing-live-status.js'
);

beforeAll(() => {
  registerAllDefaultPrompts();
});

beforeEach(() => {
  vi.clearAllMocks();
  __resetPromptsReadyCacheForTests();
  __resetRoutingLiveStatusProviderForTests();
  storeBehaviour.mode = 'throws';
});

describe('loadPrompt — a throwing store is distinguishable from a missing row', () => {
  it('reports fallbackReason "fetch_error" when the store THROWS', async () => {
    const loaded = await loadPrompt('draft_graph', { trigger: 'status' });

    expect(loaded.source).toBe('default');
    expect(loaded.fallbackReason).toBe('fetch_error');
  });

  it('DISCRIMINATING TWIN: reports "not_found" when the store is healthy but has no row', async () => {
    storeBehaviour.mode = 'not_found';

    const loaded = await loadPrompt('draft_graph', { trigger: 'status' });

    expect(loaded.source).toBe('default');
    expect(loaded.fallbackReason).toBe('not_found');
  });

  // RED at pristine: the catch site logs at `warn`, and `emit()` logs at
  // `info`, so an event named `prompt.loader.error` sat at level 30 and could
  // not trip level-based alerting.
  it('logs the store failure at ERROR level, not warn', async () => {
    await loadPrompt('draft_graph', { trigger: 'status' });

    expect(logSpies.error).toHaveBeenCalled();
    const errorCall = logSpies.error.mock.calls.find(
      (c) => (c[0] as any)?.taskId === 'draft_graph',
    );
    expect(errorCall).toBeDefined();
    expect(emitSpy).toHaveBeenCalledWith(
      'prompt.loader.error',
      expect.objectContaining({ taskId: 'draft_graph' }),
    );
  });

  it('DISCRIMINATING TWIN: a missing row does NOT log at error and emits no loader-error event', async () => {
    storeBehaviour.mode = 'not_found';

    await loadPrompt('draft_graph', { trigger: 'status' });

    expect(
      logSpies.error.mock.calls.some((c) => (c[0] as any)?.taskId === 'draft_graph'),
    ).toBe(false);
    expect(emitSpy).not.toHaveBeenCalledWith('prompt.loader.error', expect.anything());
  });
});

describe('probeTrackedPrompts — carries fallbackReason into PromptKeyStatus', () => {
  // RED at pristine: readiness.ts:123-131 built the status row from `loaded`
  // and DISCARDED `fallbackReason`, so the field did not exist.
  it('surfaces fallback_reason "fetch_error" per key when the store throws', async () => {
    const rows = await probeTrackedPrompts('status');

    expect(rows).toHaveLength(TRACKED_KEYS.length);
    for (const row of rows) {
      expect(row.source).toBe('default');
      expect(row.fallback_reason).toBe('fetch_error');
    }
  });

  it('DISCRIMINATING TWIN: surfaces "not_found", not "fetch_error", for a missing row', async () => {
    storeBehaviour.mode = 'not_found';

    const rows = await probeTrackedPrompts('status');

    for (const row of rows) {
      expect(row.fallback_reason).toBe('not_found');
    }
  });
});

describe('getCriticalPromptCoverage — a throwing store is an explicit offender list', () => {
  it('lists every critical key in fetch_error when the store throws', async () => {
    const coverage = await getCriticalPromptCoverage('status');

    expect(coverage.all_pms).toBe(false);
    // Bind by IDENTITY — the key names, not a count another set could satisfy.
    expect([...coverage.fetch_error].sort()).toEqual([...TRACKED_KEYS].sort());
  });

  it('DISCRIMINATING TWIN: fetch_error is EMPTY when keys merely have no PMS row', async () => {
    storeBehaviour.mode = 'not_found';

    const coverage = await getCriticalPromptCoverage('status');

    // Still not covered by PMS...
    expect(coverage.all_pms).toBe(false);
    expect([...coverage.default_or_error].sort()).toEqual([...TRACKED_KEYS].sort());
    // ...but this is NOT a store failure, and must not raise the alarm.
    expect(coverage.fetch_error).toEqual([]);
  });
});

describe('promptStoreDegradationReasons — the /healthz reason token', () => {
  it('raises critical_prompt_fetch_error when a critical key hit a store failure', async () => {
    const coverage = await getCriticalPromptCoverage('status');

    expect(promptStoreDegradationReasons(coverage)).toEqual([
      CRITICAL_PROMPT_FETCH_ERROR_REASON,
    ]);
    expect(CRITICAL_PROMPT_FETCH_ERROR_REASON).toBe('critical_prompt_fetch_error');
  });

  /**
   * THE REASON THIS IS SCOPED TO fetch_error AND NOT TO `all_pms === false`:
   * `all_pms` is legitimately false in plenty of healthy shapes (no store
   * configured, a key with no PMS row by design). Keying the alarm on it would
   * make it always-on, i.e. no alarm at all.
   */
  it('DISCRIMINATING TWIN: raises NOTHING when all_pms is false purely from missing rows', async () => {
    storeBehaviour.mode = 'not_found';

    const coverage = await getCriticalPromptCoverage('status');

    expect(coverage.all_pms).toBe(false);
    expect(promptStoreDegradationReasons(coverage)).toEqual([]);
  });
});
