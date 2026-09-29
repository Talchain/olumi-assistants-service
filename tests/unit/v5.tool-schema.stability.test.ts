/**
 * V5 routing tool schema — stability tripwire.
 *
 * Anthropic prompt-cache invalidates if the tools block changes between
 * turns. Two layers must be byte-stable for cache hits to land:
 *
 *   1. The source `OLUMI_ACTION_TOOL` constant.
 *   2. The post-adapter SDK payload — what `buildStrictAnthropicTools()`
 *      produces for the resolved routing model. The cache key is the
 *      transformed block, not the source object, so a non-deterministic
 *      key order or shape change inside the adapter would silently
 *      invalidate every turn even with `OLUMI_ACTION_TOOL` unchanged.
 */

import { describe, it, expect } from 'vitest';
import { OLUMI_ACTION_TOOL } from '../../src/orchestrator-v5/routing/tool-schema.js';
import { __test_only as anthropicInternals } from '../../src/adapters/llm/anthropic.js';

describe('OLUMI_ACTION_TOOL stability', () => {
  it('JSON.stringify is byte-identical across consecutive serializations', () => {
    const a = JSON.stringify(OLUMI_ACTION_TOOL);
    const b = JSON.stringify(OLUMI_ACTION_TOOL);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('post-adapter Anthropic tool payload stability', () => {
  // `buildStrictAnthropicTools` is what the cache key sees. If the
  // transformed tools block ever becomes non-deterministic (object key
  // ordering, model-conditional fields, dynamic names, etc.) the cache
  // invalidates every turn even though OLUMI_ACTION_TOOL itself is stable.
  it('buildStrictAnthropicTools produces byte-identical output across calls (Sonnet 4.6)', () => {
    const a = JSON.stringify(
      anthropicInternals.buildStrictAnthropicTools([OLUMI_ACTION_TOOL], 'claude-sonnet-4-6'),
    );
    const b = JSON.stringify(
      anthropicInternals.buildStrictAnthropicTools([OLUMI_ACTION_TOOL], 'claude-sonnet-4-6'),
    );
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
