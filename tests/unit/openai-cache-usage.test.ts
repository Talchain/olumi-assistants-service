/**
 * OPENAI CACHE READS MUST REACH THE FIELD THE ESTATE ALREADY AGGREGATES.
 *
 * `UsageMetrics.cache_read_input_tokens` has existed all along and is read by 29
 * files — it is how the routing cache was measured at an 80.0% hit rate with a
 * constant 15,338 tokens read per hit. **The OpenAI adapter never populated it**,
 * so OpenAI cache usage was invisible: `cached_tokens` and
 * `prompt_tokens_details` had ZERO occurrences in `src`, against contrast
 * controls of 17 files referencing `prompt_tokens` and 29 referencing
 * `cache_read_input_tokens`.
 *
 * ⚠ These tests bind the MAPPING, not a hit rate. What a real request caches
 * depends on prefix stability and OpenAI's own 1,024-token floor, which no unit
 * test can assert. What can be asserted is that when the provider reports a
 * cached count, it arrives in the field the aggregators read — and that when the
 * provider reports nothing, the field is ABSENT rather than a fabricated zero.
 */
import { describe, expect, it } from 'vitest';
import { __test_only_openAiUsage as openAiUsage } from '../../src/adapters/llm/openai.js';

describe('openAiUsage maps the provider usage object onto UsageMetrics', () => {
  it('⛔ carries a reported cached count into cache_read_input_tokens', () => {
    const u = openAiUsage({
      prompt_tokens: 2609,
      completion_tokens: 4241,
      prompt_tokens_details: { cached_tokens: 1920 },
    });
    expect(u.input_tokens).toBe(2609);
    expect(u.output_tokens).toBe(4241);
    expect(u.cache_read_input_tokens).toBe(1920);
  });

  it('⛔ OMITS the field when the provider reports no details — absent, not zero', () => {
    // The distinction that matters to an aggregator: a fabricated 0 reads as
    // "measured no cache reads", which is a different claim from "this provider
    // did not report any". Same reasoning as the omitted-when-absent carriers in
    // the entity projection.
    const u = openAiUsage({ prompt_tokens: 100, completion_tokens: 20 });
    expect('cache_read_input_tokens' in u).toBe(false);
  });

  it('OMITS the field when details exist but cached_tokens does not', () => {
    const u = openAiUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: {} });
    expect('cache_read_input_tokens' in u).toBe(false);
  });

  it('a reported ZERO is kept — that IS a measurement', () => {
    // A provider that says "0 cached" has told us something; only silence is
    // absent. If this ever flips to omitting 0, a genuine cold-start measurement
    // becomes indistinguishable from an unreporting provider.
    const u = openAiUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 0 },
    });
    expect(u.cache_read_input_tokens).toBe(0);
  });

  it('tolerates null/undefined usage without throwing', () => {
    for (const input of [null, undefined]) {
      const u = openAiUsage(input);
      expect(u.input_tokens).toBe(0);
      expect(u.output_tokens).toBe(0);
      expect('cache_read_input_tokens' in u).toBe(false);
    }
  });

  it('⚠ NEVER invents cache_creation_input_tokens', () => {
    // Anthropic reports cache WRITE tokens explicitly; OpenAI's automatic prompt
    // caching does not. Populating it would be inventing a number, and a
    // fabricated zero would read as "no cache writes occurred" rather than "not
    // reported by this provider".
    const u = openAiUsage({
      prompt_tokens: 2609,
      completion_tokens: 4241,
      prompt_tokens_details: { cached_tokens: 1920 },
    });
    expect('cache_creation_input_tokens' in u).toBe(false);
  });
});
