/**
 * Routing prompt snapshot tests:
 * - ordering invariant (defaults must be registered first)
 * - lazy ensure() works without explicit boot
 * - raw_hash vs sent_hash semantics
 * - refresh swaps atomically
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import {
  buildRoutingPromptSnapshot,
  ensureRoutingPromptSnapshot,
  getRoutingPromptSnapshot,
  refreshRoutingPromptSnapshot,
  __resetRoutingPromptSnapshotForTests,
} from '../../src/orchestrator-v5/routing/prompt-loader.js';

beforeAll(() => {
  registerAllDefaultPrompts();
});

beforeEach(() => {
  __resetRoutingPromptSnapshotForTests();
});

describe('routing prompt snapshot', () => {
  it('getRoutingPromptSnapshot throws before init', () => {
    expect(() => getRoutingPromptSnapshot()).toThrow(/snapshot not initialised/i);
  });

  it('ensureRoutingPromptSnapshot lazily builds when called before boot', async () => {
    const snap = await ensureRoutingPromptSnapshot();
    expect(snap.text.length).toBeGreaterThan(18_000);
    expect(snap.raw_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(snap.sent_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(snap.source).toBe('default');
    expect(snap.version).toBeDefined();
  });

  it('subsequent ensure() calls return the same instance', async () => {
    const a = await ensureRoutingPromptSnapshot();
    const b = await ensureRoutingPromptSnapshot();
    expect(a).toBe(b);
  });

  it('buildRoutingPromptSnapshot populates the cache for sync accessor', async () => {
    await buildRoutingPromptSnapshot();
    const snap = getRoutingPromptSnapshot();
    expect(snap.systemChars).toBeGreaterThan(18_000);
  });

  it('refreshRoutingPromptSnapshot rebuilds atomically', async () => {
    const first = await ensureRoutingPromptSnapshot();
    const refreshed = await refreshRoutingPromptSnapshot();
    expect(refreshed.sent_hash).toBe(first.sent_hash);
    // Same content → same hash. Identity changes (new object) on refresh.
    expect(refreshed).not.toBe(first);
  });
});
