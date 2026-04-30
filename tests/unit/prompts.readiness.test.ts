/**
 * Readiness probe — `prompts_ready` boolean and per-key status.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import {
  arePromptsReady,
  probeTrackedPrompts,
  __resetPromptsReadyCacheForTests,
  TRACKED_KEYS,
} from '../../src/prompts/readiness.js';

beforeAll(() => {
  registerAllDefaultPrompts();
});

beforeEach(() => {
  __resetPromptsReadyCacheForTests();
});

describe('prompts readiness', () => {
  it('arePromptsReady returns true when all five defaults are registered', async () => {
    expect(await arePromptsReady()).toBe(true);
  });

  it('probeTrackedPrompts returns one row per tracked key', async () => {
    const rows = await probeTrackedPrompts('status');
    expect(rows.map((r) => r.key).sort()).toEqual([...TRACKED_KEYS].sort());
    for (const r of rows) {
      expect(r.source).not.toBe('error');
      expect(r.content_hash).toMatch(/^[0-9a-f]{16}$/);
      expect(r.content_chars).toBeGreaterThan(0);
    }
  });
});
