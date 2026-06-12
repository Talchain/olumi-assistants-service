/**
 * edit_graph — prompt-cache block split (buildEditSystemCacheBlocks).
 *
 * The stable PMS prompt is the only cacheable prefix on this path: the
 * variable remainder (intent instruction with resolved target labels +
 * serialised graph context) changes per request, so marking it would write a
 * unique cache entry per turn and never read (pure 1.25x write premium).
 *
 * Pins:
 * 1. Block split shape: block 1 = stable prompt with cache_control,
 *    block 2 = variable remainder, unmarked.
 * 2. Byte-equality contract: block texts join back to the exact system string
 *    the plain-string path would send (non-Anthropic adapters use that string).
 * 3. Flag gating: caching disabled → no blocks (today's plain behaviour).
 * 4. No variable remainder → no blocks (nothing to split).
 */

import { describe, it, expect } from 'vitest';
import { buildEditSystemCacheBlocks } from '../../src/orchestrator/tools/edit-graph.js';

const STABLE = 'PMS_EDIT_PROMPT_V9';
const INTENT = 'This is a narrow parameter/value update. Apply this request to the existing Churn Rate factor only.';
const CONTEXT = '## Graph Context\n{"nodes":[...]}';

describe('buildEditSystemCacheBlocks', () => {
  it('splits stable prompt (cached) from variable remainder (uncached)', () => {
    const remainder = `\n\n${INTENT}\n\n${CONTEXT}`;
    const blocks = buildEditSystemCacheBlocks(STABLE, remainder, true);

    expect(blocks).toHaveLength(2);
    expect(blocks![0]).toEqual({
      type: 'text',
      text: STABLE,
      cache_control: { type: 'ephemeral' },
    });
    // The per-request remainder must never carry a cache marker.
    expect(blocks![1]).toEqual({ type: 'text', text: remainder });
    expect(blocks![1].cache_control).toBeUndefined();
  });

  it('block texts join back to the exact full system string (byte-equality contract)', () => {
    // Mirrors the call-site assembly for both attempt shapes:
    // initial: system + \n\n + intent + \n\n + context; repair: system + \n\n + context.
    const initialRemainder = `\n\n${INTENT}\n\n${CONTEXT}`;
    const repairRemainder = `\n\n${CONTEXT}`;

    for (const remainder of [initialRemainder, repairRemainder]) {
      const blocks = buildEditSystemCacheBlocks(STABLE, remainder, true);
      const joined = blocks!.map((b) => b.text).join('');
      expect(joined).toBe(`${STABLE}${remainder}`);
    }
  });

  it('returns undefined when caching is disabled (plain-string path unchanged)', () => {
    expect(buildEditSystemCacheBlocks(STABLE, `\n\n${CONTEXT}`, false)).toBeUndefined();
  });

  it('returns undefined when there is nothing to split', () => {
    expect(buildEditSystemCacheBlocks(STABLE, '', true)).toBeUndefined();
    expect(buildEditSystemCacheBlocks('', `\n\n${CONTEXT}`, true)).toBeUndefined();
  });
});
