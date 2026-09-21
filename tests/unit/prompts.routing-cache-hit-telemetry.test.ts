/**
 * Routing snapshot cache-hit telemetry.
 *
 * `ensureRoutingPromptSnapshot()` returns a cached snapshot on every routing
 * turn after boot. Without an explicit emission at this layer, those turns
 * would be invisible to `v5.prompt_resolved`. This test exercises the
 * second-call path and locks the contract.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import {
  buildRoutingPromptSnapshot,
  ensureRoutingPromptSnapshot,
  __resetRoutingPromptSnapshotForTests,
} from '../../src/orchestrator-v5/routing/prompt-loader.js';
import { setTestSink, TelemetryEvents } from '../../src/utils/telemetry.js';

beforeAll(() => {
  registerAllDefaultPrompts();
});

let captured: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeEach(() => {
  __resetRoutingPromptSnapshotForTests();
  captured = [];
  setTestSink((event, data) => {
    captured.push({ event, data });
  });
});

afterEach(() => {
  setTestSink(null);
});

function lastResolvedFor(key: string): Record<string, unknown> | undefined {
  return [...captured]
    .reverse()
    .find(
      (e) =>
        e.event === TelemetryEvents.V5PromptResolved &&
        (e.data as { key?: unknown }).key === key,
    )?.data;
}

describe('v5.prompt_resolved on routing snapshot cache hit', () => {
  it('emits cache=hit on the second ensureRoutingPromptSnapshot() call', async () => {
    // Cold call: builds the snapshot. The build path emits via
    // loadPrompt(routing, { trigger: 'startup' }) — that event has cache
    // unset (full resolution, not a cache return).
    await buildRoutingPromptSnapshot();
    captured = [];

    // Warm call: must emit cache=hit.
    await ensureRoutingPromptSnapshot();
    const event = lastResolvedFor('routing');
    expect(event, 'v5.prompt_resolved missing on routing snapshot cache hit').toBeDefined();
    expect(event!.cache).toBe('hit');
    expect(['pms', 'default']).toContain(event!.source);
    if (event!.source === 'default') {
      expect(event!.version).toBe('v40');
    }
    expect(String(event!.content_hash)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('does not emit cache=hit on the cold build path', async () => {
    // Snapshot was reset by beforeEach; the very first call is a build.
    await ensureRoutingPromptSnapshot();
    const events = captured.filter(
      (e) =>
        e.event === TelemetryEvents.V5PromptResolved &&
        (e.data as { key?: unknown }).key === 'routing',
    );
    // Build path emits via loadPrompt(routing, { trigger: 'startup' }) — no
    // cache field. The lazy ensure() must NOT also emit a hit on the cold
    // path; otherwise we'd double-fire.
    const hitCount = events.filter(
      (e) => (e.data as { cache?: unknown }).cache === 'hit',
    ).length;
    expect(hitCount).toBe(0);
  });
});
