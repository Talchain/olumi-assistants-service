/**
 * `loadPrompt()` derives `useStaging` — it does NOT default to `false`.
 *
 * THE DEFECT THIS PINS (live-observed on cee-staging, 2026-07-18):
 * `loadPrompt()`'s options bag destructured `useStaging = false`. Every caller
 * that omitted the option therefore selected the PMS **`active_version`**
 * pointer (see src/prompts/stores/supabase.ts — `options?.useStaging ?
 * prompt.staging_version : null) ?? prompt.active_version`) even on a
 * deployment where `shouldUseStagingPrompts() === true`.
 *
 * The live symptom was a PER-TASK DIVERGENCE on one service:
 *   - `routing`         served/reported v117 = its STAGING pin  ✓
 *   - `draft_graph`     reported v194 = its ACTIVE  (v195 was pinned)  ✗
 *   - `decision_review` reported v11  = its ACTIVE  (v14  was pinned)  ✗
 *
 * The split is exactly the two call paths. The routing snapshot passes
 * `useStaging` explicitly (src/orchestrator-v5/routing/prompt-loader.ts — an
 * earlier, NARROWER fix for this same defect class, pinned by
 * routing/__tests__/prompt-loader-staging-version.test.ts). The readiness
 * probe (src/prompts/readiness.ts) did NOT, so `/admin/prompts/status`,
 * `/admin/prompts/reload` and `/healthz` MISREPORTED the live version for
 * every tracked key except `routing`.
 *
 * Fixing only the one caller was the mirror-shaped fix: a hand-maintained
 * list of "callers that remembered to pass it" drifts silently, and the drift
 * reads as green. So the pointer is now DERIVED at the single chokepoint
 * (`loadPrompt`), and these tests fail if that derivation is reverted to a
 * hardcoded `false` — no matter which caller omits the option.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';

const { getCompiledMock, getMock, useStagingMock } = vi.hoisted(() => ({
  getCompiledMock: vi.fn(),
  getMock: vi.fn(),
  useStagingMock: vi.fn<() => boolean>(() => true),
}));

vi.mock('../store.js', async (importActual) => {
  const actual = await importActual<typeof import('../store.js')>();
  return {
    ...actual,
    isDbBackedStoreHealthy: () => true,
    getPromptStore: () =>
      ({ getCompiled: getCompiledMock, get: getMock }) as unknown as ReturnType<
        typeof actual.getPromptStore
      >,
  };
});

// Override ONLY shouldUseStagingPrompts; the rest of config stays real.
vi.mock('../../config/index.js', async (importActual) => {
  const actual = await importActual<typeof import('../../config/index.js')>();
  return {
    ...actual,
    shouldUseStagingPrompts: () => useStagingMock(),
  };
});

import { loadPrompt } from '../loader.js';
import { probeTrackedPrompts } from '../readiness.js';

const ACTIVE_VERSION = 194;
const STAGING_VERSION = 195;
const PROMPT_ID = 'draft_graph_default';

/** The options bag `loadPrompt` forwards to the store (3rd positional arg). */
function optionsOfCall(callIndex = 0): { useStaging?: boolean; version?: number } {
  const call = getCompiledMock.mock.calls[callIndex];
  expect(call).toBeDefined();
  return call![2] as { useStaging?: boolean; version?: number };
}

beforeEach(() => {
  getCompiledMock.mockReset();
  getMock.mockReset();
  useStagingMock.mockReset();

  // Model the real DB row: staging pin AHEAD of the active pointer, so the
  // two pointers are DISTINGUISHABLE. If they were equal the assertion would
  // be vacuous — it could not tell which pointer was chosen.
  getCompiledMock.mockImplementation(
    async (_taskId: string, _vars: unknown, options?: { useStaging?: boolean }) => ({
      promptId: PROMPT_ID,
      version: options?.useStaging ? STAGING_VERSION : ACTIVE_VERSION,
      content: options?.useStaging ? 'STAGING BODY' : 'ACTIVE BODY',
      compiledAt: new Date().toISOString(),
    }),
  );
  getMock.mockResolvedValue({
    id: PROMPT_ID,
    activeVersion: ACTIVE_VERSION,
    stagingVersion: STAGING_VERSION,
  });
});

describe('loadPrompt() derives useStaging from the deployment (no silent production default)', () => {
  it('a caller that OMITS useStaging still gets the STAGING pin when shouldUseStagingPrompts() is true', async () => {
    useStagingMock.mockReturnValue(true);

    // No `useStaging` in the options bag — exactly what readiness.ts does.
    const loaded = await loadPrompt('draft_graph', { trigger: 'reload' });

    expect(optionsOfCall().useStaging).toBe(true);
    expect(loaded.version).toBe(STAGING_VERSION);
    expect(loaded.content).toBe('STAGING BODY');
  });

  it('a caller that OMITS useStaging gets the ACTIVE pin when shouldUseStagingPrompts() is false', async () => {
    // Positive control for the inverse: proves the fix DERIVES the pointer
    // rather than hardcoding `true` (which would break production).
    useStagingMock.mockReturnValue(false);

    const loaded = await loadPrompt('draft_graph', { trigger: 'reload' });

    expect(optionsOfCall().useStaging).toBe(false);
    expect(loaded.version).toBe(ACTIVE_VERSION);
    expect(loaded.content).toBe('ACTIVE BODY');
  });

  it('an EXPLICIT useStaging argument still wins over the derived value', async () => {
    useStagingMock.mockReturnValue(true);

    await loadPrompt('draft_graph', { useStaging: false, trigger: 'reload' });

    expect(optionsOfCall().useStaging).toBe(false);
  });
});

describe('readiness probe reports the pin that is actually served', () => {
  it('/admin/prompts/{status,reload} + /healthz report the STAGING version on a staging deployment', async () => {
    useStagingMock.mockReturnValue(true);

    const statuses = await probeTrackedPrompts('reload');

    // Every non-routing tracked key resolves through loadPrompt(). Before the
    // fix each of these reported ACTIVE_VERSION while the staging pin was
    // live — the misreport that sent a root-cause investigation down a
    // serving-defect path that did not exist.
    const reported = statuses.filter((s) => s.key !== 'routing');
    expect(reported.length).toBeGreaterThan(0);
    for (const status of reported) {
      expect(status.source).toBe('pms');
      expect(status.version).toBe(String(STAGING_VERSION));
    }

    // And every store call the probe made carried the derived pointer.
    for (const call of getCompiledMock.mock.calls) {
      expect((call[2] as { useStaging?: boolean }).useStaging).toBe(true);
    }
  });
});
