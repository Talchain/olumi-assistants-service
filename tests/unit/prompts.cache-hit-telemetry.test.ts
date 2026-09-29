/**
 * Cache-hit telemetry guard.
 *
 * The adapter's `getSystemPrompt()` serves cached content on hit without
 * delegating to `loadPrompt()`. Without an explicit emission at the cache
 * layer, those resolutions would be invisible to `v5.prompt_resolved`. The
 * brief requires every runtime resolution of a tracked key to emit.
 *
 * This test forces a cache hit on a tracked operation and asserts the
 * `v5.prompt_resolved` event is present with `cache: 'hit'`.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { registerAllDefaultPrompts } from '../../src/prompts/defaults.js';
import {
  getSystemPrompt,
  invalidatePromptCache,
} from '../../src/adapters/llm/prompt-loader.js';
import { setTestSink, TelemetryEvents } from '../../src/utils/telemetry.js';

let captured: Array<{ event: string; data: Record<string, unknown> }> = [];

beforeAll(() => {
  registerAllDefaultPrompts();
});

beforeEach(() => {
  captured = [];
  invalidatePromptCache();
  setTestSink((event, data) => {
    captured.push({ event, data });
  });
});

afterEach(() => {
  setTestSink(null);
  vi.useRealTimers();
});

function lastResolved(): Record<string, unknown> | undefined {
  return [...captured]
    .reverse()
    .find((e) => e.event === TelemetryEvents.V5PromptResolved)?.data;
}

describe('v5.prompt_resolved on adapter cache hits', () => {
  it('emits cache=hit on a second getSystemPrompt() call within TTL', async () => {
    // Cold call — populates the cache.
    await getSystemPrompt('edit_graph');
    captured = [];

    // Warm call — must emit cache=hit.
    await getSystemPrompt('edit_graph');
    const event = lastResolved();
    expect(event, 'v5.prompt_resolved missing on cache hit').toBeDefined();
    expect(event!.key).toBe('edit_graph');
    expect(event!.cache).toBe('hit');
    // source is mapped to the public vocabulary.
    expect(['pms', 'default']).toContain(event!.source);
    // version is the canonical default-version string when source=default.
    if (event!.source === 'default') {
      expect(event!.version).toBe('v6');
    }
    expect(String(event!.content_hash)).toMatch(/^[0-9a-f]{16}$/);
  });
});
