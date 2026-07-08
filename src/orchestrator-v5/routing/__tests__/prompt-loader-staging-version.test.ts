/**
 * Routing snapshot — staging_version support (prompt-workstream fix).
 *
 * `doBuildRoutingPromptSnapshot()` used to call
 * `loadPrompt('routing', { trigger: 'startup' })` WITHOUT `useStaging`,
 * unlike the handler-prompt loader (src/adapters/llm/prompt-loader.ts:325,
 * which passes `useStaging: shouldUseStagingPrompts()`). Consequence
 * (live-proven 2026-07-08 via admin reload): setting the PMS
 * `staging_version` pointer on the orchestrator row was a NO-OP for the
 * routing snapshot — the documented staged-rollout path did not work for
 * this key. These tests pin the fix: the snapshot build passes
 * `useStaging` reflecting `shouldUseStagingPrompts()` all the way down to
 * the prompt store's `getCompiled(taskId, variables, { version, useStaging })`.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { LoadPromptOptions } from '../../../prompts/loader.js';

// Hoisted so the (hoisted) vi.mock factories can close over them.
const { getCompiledMock, useStagingMock } = vi.hoisted(() => ({
  getCompiledMock: vi.fn(),
  useStagingMock: vi.fn<() => boolean>(() => true),
}));

vi.mock('../../../prompts/store.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../prompts/store.js')>();
  return {
    ...actual,
    isDbBackedStoreHealthy: () => true,
    getPromptStore: () =>
      ({ getCompiled: getCompiledMock, get: vi.fn(async () => null) }) as unknown as ReturnType<
        typeof actual.getPromptStore
      >,
  };
});

// Override ONLY shouldUseStagingPrompts; everything else on config is real.
vi.mock('../../../config/index.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../config/index.js')>();
  return {
    ...actual,
    shouldUseStagingPrompts: () => useStagingMock(),
  };
});

import {
  buildRoutingPromptSnapshot,
  __resetRoutingPromptSnapshotForTests,
} from '../prompt-loader.js';

// In-guard orchestrator prompt body (no newlines/trailing ws so the
// snapshot normaliser leaves the length unchanged).
const ORCH_CONTENT = 'X'.repeat(20_000);

function orchestratorRow(version = 111, content = ORCH_CONTENT) {
  return { content, promptId: 'orchestrator_default', version };
}

/** The store options bag loadPrompt forwards: third positional argument. */
function getCompiledOptions(callIndex = 0): Pick<LoadPromptOptions, 'version' | 'useStaging'> {
  const call = getCompiledMock.mock.calls[callIndex];
  expect(call).toBeDefined();
  return call![2] as Pick<LoadPromptOptions, 'version' | 'useStaging'>;
}

beforeEach(() => {
  getCompiledMock.mockReset();
  useStagingMock.mockReset();
  __resetRoutingPromptSnapshotForTests();
});

describe('routing snapshot honours shouldUseStagingPrompts() (staging_version support)', () => {
  it('passes useStaging: true to loadPrompt/getCompiled when shouldUseStagingPrompts() is true', async () => {
    useStagingMock.mockReturnValue(true);
    getCompiledMock.mockResolvedValue(orchestratorRow());

    await buildRoutingPromptSnapshot();

    expect(getCompiledMock).toHaveBeenCalledTimes(1);
    // Alias-aware PMS lookup is unchanged: routing → orchestrator.
    expect(getCompiledMock.mock.calls[0]![0]).toBe('orchestrator');
    expect(getCompiledOptions().useStaging).toBe(true);
  });

  it('passes useStaging: false when shouldUseStagingPrompts() is false (production pointer)', async () => {
    useStagingMock.mockReturnValue(false);
    getCompiledMock.mockResolvedValue(orchestratorRow());

    await buildRoutingPromptSnapshot();

    expect(getCompiledMock).toHaveBeenCalledTimes(1);
    expect(getCompiledOptions().useStaging).toBe(false);
  });
});
