/**
 * Prompt-size guard — ABSOLUTE value pins.
 *
 * Every other guard test (prompt-loader.test.ts,
 * orchestrator-prompt-resolution.test.ts) asserts the bound RELATIVE to
 * EXPECTED_SYSTEM_CHARS_MIN / EXPECTED_SYSTEM_CHARS_MAX, so changing the
 * constant moves every assertion with it and nothing goes red — the value
 * itself has no test protecting it. This file pins the ABSOLUTE window so
 * any future raise/lower of the guard fails a test and must be made
 * deliberately, plus behavioural pins at the sizes that matter:
 *
 *   - a 28,500-char prompt must PASS both guard sites (the amended coach
 *     arm class — Arm A is 28,422 chars — must be servable);
 *   - a 40,000-char prompt must FAIL both guard sites (the ceiling still
 *     exists — the ~57.6k orchestrator v28 default must never be servable).
 *
 * Both guard sites are exercised: the file-based loader
 * (`loadRoutingPrompt`, guards the bundled default at module init) and the
 * PMS-backed snapshot builder (`buildRoutingPromptSnapshot`, guards what is
 * actually served). Only the prompt store is mocked (same seam as
 * orchestrator-prompt-resolution.test.ts) via `importActual` so the rest of
 * the prompts module graph is real.
 */

import { describe, expect, it, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Hoisted so the (hoisted) vi.mock factory can close over it.
const { getCompiledMock } = vi.hoisted(() => ({ getCompiledMock: vi.fn() }));

vi.mock('../../../prompts/store.js', async (importActual) => {
  const actual = await importActual<typeof import('../../../prompts/store.js')>();
  return {
    ...actual,
    // Force the store path on + inject a controllable getCompiled.
    isDbBackedStoreHealthy: () => true,
    getPromptStore: () =>
      ({ getCompiled: getCompiledMock, get: vi.fn(async () => null) }) as unknown as ReturnType<
        typeof actual.getPromptStore
      >,
  };
});

// Imported after the hoisted mock is registered.
import {
  buildRoutingPromptSnapshot,
  loadRoutingPrompt,
  __resetRoutingPromptSnapshotForTests,
  EXPECTED_SYSTEM_CHARS_MIN,
  EXPECTED_SYSTEM_CHARS_MAX,
} from '../prompt-loader.js';

// Sizes chosen deliberately: 28,500 brackets the 28,422-char amended coach
// arm (Arm A); 40,000 sits well above any intended prompt but below the
// ~57.6k v28 orchestrator default. No newlines / trailing whitespace, so
// the loader's normalisation is identity and lengths are exact.
const IN_GUARD_28_5K = 'A'.repeat(28_500);
const OVERSIZED_40K = 'B'.repeat(40_000);

const tempDir = mkdtempSync(join(tmpdir(), 'prompt-size-guard-'));
const inGuardPath = join(tempDir, 'in-guard-28500.txt');
const oversizedPath = join(tempDir, 'oversized-40000.txt');
writeFileSync(inGuardPath, IN_GUARD_28_5K, 'utf-8');
writeFileSync(oversizedPath, OVERSIZED_40K, 'utf-8');

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  getCompiledMock.mockReset();
  __resetRoutingPromptSnapshotForTests();
});

describe('prompt-size guard — absolute value pins', () => {
  it('pins the guard window to the exact intended values (18,500–29,000)', () => {
    // If either of these fails, someone changed the guard: update this pin
    // DELIBERATELY, together with the behavioural pins below.
    expect(EXPECTED_SYSTEM_CHARS_MIN).toBe(18_500);
    expect(EXPECTED_SYSTEM_CHARS_MAX).toBe(29_000);
  });

  it('file loader: a 28,500-char prompt PASSES (amended coach arm class is servable)', () => {
    const loaded = loadRoutingPrompt(() => inGuardPath);
    expect(loaded.systemChars).toBe(28_500);
    expect(loaded.text).toBe(IN_GUARD_28_5K);
  });

  it('file loader: a 40,000-char prompt FAILS (the ceiling still exists)', () => {
    expect(() => loadRoutingPrompt(() => oversizedPath)).toThrow(
      /outside expected range/,
    );
  });

  it('PMS snapshot: a 28,500-char store prompt PASSES the served-prompt guard', async () => {
    getCompiledMock.mockResolvedValue({
      content: IN_GUARD_28_5K,
      promptId: 'orchestrator_default',
      version: 130,
    });
    const snap = await buildRoutingPromptSnapshot();
    expect(snap.source).toBe('store');
    expect(snap.systemChars).toBe(28_500);
  });

  it('PMS snapshot: a 40,000-char store prompt FAILS the served-prompt guard', async () => {
    getCompiledMock.mockResolvedValue({
      content: OVERSIZED_40K,
      promptId: 'orchestrator_default',
      version: 131,
    });
    await expect(buildRoutingPromptSnapshot()).rejects.toThrow(
      /outside expected range/,
    );
  });
});
