/**
 * Server boot ordering invariants for the v5 routing prompt.
 *
 * 1. `buildRoutingPromptSnapshot()` requires `routing` to be in the defaults
 *    registry — it throws with a clear message if called before
 *    `registerAllDefaultPrompts()`.
 * 2. The snapshot build is unconditional at startup: both PMS-enabled and
 *    default-only deployments must fail fast on a missing/oversized routing
 *    prompt rather than lazy-fail on the first turn. We assert this by
 *    exercising the build with PMS disabled (no store path) and with PMS
 *    enabled-but-empty (store returns null) — both paths must produce a
 *    valid snapshot resolved from the registered default.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { registerDefaultPrompt } from '../../src/prompts/loader.js';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import {
  buildRoutingPromptSnapshot,
  __resetRoutingPromptSnapshotForTests,
} from '../../src/orchestrator-v5/routing/prompt-loader.js';

beforeEach(() => {
  __resetRoutingPromptSnapshotForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('routing snapshot boot ordering', () => {
  it('fails fast with a clear message when defaults have not been registered', async () => {
    // Force the defaults registry to not contain `routing`. We can't truly
    // unregister (the registry is a module-level Map), so we simulate the
    // pre-registration state by intercepting `getDefaultPrompts` to return
    // an empty object for this test only.
    const loaderModule = await import('../../src/prompts/loader.js');
    const spy = vi
      .spyOn(loaderModule, 'getDefaultPrompts')
      .mockReturnValue({});

    try {
      await expect(buildRoutingPromptSnapshot()).rejects.toThrow(
        /no default registered for task 'routing'/i,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it('builds successfully in PMS-disabled mode (default fallback only)', async () => {
    registerAllDefaultPrompts();
    // PMS disabled is the default config; loadPrompt() short-circuits to
    // the default branch via isPromptManagementEnabled() === false.
    const loaderModule = await import('../../src/prompts/loader.js');
    const spy = vi
      .spyOn(loaderModule, 'isPromptManagementEnabled')
      .mockReturnValue(false);

    try {
      const snap = await buildRoutingPromptSnapshot();
      expect(snap.source).toBe('default');
      expect(snap.version).toBe('v40');
      expect(snap.systemChars).toBeGreaterThan(18_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('builds successfully in PMS-enabled-but-empty mode', async () => {
    registerAllDefaultPrompts();
    const loaderModule = await import('../../src/prompts/loader.js');
    const storeModule = await import('../../src/prompts/store.js');
    const enabledSpy = vi
      .spyOn(loaderModule, 'isPromptManagementEnabled')
      .mockReturnValue(true);
    const stubStore = {
      getCompiled: async () => null,
      get: async () => null,
    };
    const storeSpy = vi
      .spyOn(storeModule, 'getPromptStore')
      .mockReturnValue(
        stubStore as unknown as ReturnType<typeof storeModule.getPromptStore>,
      );

    try {
      const snap = await buildRoutingPromptSnapshot();
      // Store returned null → loader falls through to default.
      expect(snap.source).toBe('default');
      expect(snap.version).toBe('v40');
    } finally {
      storeSpy.mockRestore();
      enabledSpy.mockRestore();
    }
  });

  it('throws when the resolved prompt fails the size sanity check', async () => {
    registerAllDefaultPrompts();
    // Register a tiny string for `routing` to force the size check to fail.
    // Use the registerDefaultPrompt helper directly so we don't have to
    // touch the on-disk file.
    const loaderModule = await import('../../src/prompts/loader.js');
    const spy = vi
      .spyOn(loaderModule, 'getDefaultPrompts')
      .mockReturnValue({ routing: 'too short' });
    // Also force PMS off so the default path is taken.
    const enabledSpy = vi
      .spyOn(loaderModule, 'isPromptManagementEnabled')
      .mockReturnValue(false);
    // Register the short string into the actual map so loadDefaultPrompt
    // (which reads via DEFAULT_PROMPTS, not getDefaultPrompts) finds it.
    registerDefaultPrompt('routing', 'too short');

    try {
      await expect(buildRoutingPromptSnapshot()).rejects.toThrow(
        /outside expected range/,
      );
    } finally {
      spy.mockRestore();
      enabledSpy.mockRestore();
      // Restore the real default by re-running the bulk registration.
      registerAllDefaultPrompts();
    }
  });
});
