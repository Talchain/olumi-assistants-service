/**
 * Caching is named in the goal and could not be measured: the ledger carried
 * site/provider/model/purpose/outcome and nothing else, while the agent lane's
 * transport already received a `usage` object and threw it away. Measured on
 * served 3f412be over six briefs — no token or cache field anywhere in a turn
 * payload, across 4-6 provider calls per first turn that each carry the same
 * ~1,437-token instruction prefix byte for byte.
 *
 * ⚠ I had no captured provider `usage` object to derive key names from. Inventing
 * the schema and then testing my own invention would prove nothing about the wire,
 * so `raw` is the authority and the derived fields are explicitly best-effort. The
 * test that matters most here is therefore the one asserting `raw` survives even
 * when EVERY derived guess misses.
 */
import { describe, it, expect } from 'vitest';
import {
  OPENAI_ONLY, runWithProviderPolicy, assertProviderAllowed, recordProviderUsage,
  recordedProviderCalls, normaliseProviderUsage,
} from '../provider-policy.js';

describe('normaliseProviderUsage reads what it can and never pretends', () => {
  it('reads the Responses-style shape', () => {
    const u = normaliseProviderUsage({ input_tokens: 1500, output_tokens: 200, input_tokens_details: { cached_tokens: 1408 } });
    expect(u?.input_tokens).toBe(1500);
    expect(u?.output_tokens).toBe(200);
    expect(u?.cached_input_tokens, 'the caching signal').toBe(1408);
  });

  it('reads the Chat-Completions-style shape', () => {
    const u = normaliseProviderUsage({ prompt_tokens: 1500, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 0 } });
    expect(u?.input_tokens).toBe(1500);
    expect(u?.output_tokens).toBe(200);
    expect(u?.cached_input_tokens, 'zero is a MEASUREMENT, not a missing value').toBe(0);
  });

  /**
   * ⭐ THE HONESTY PROPERTY. If every key name I guessed is wrong, the derived
   * fields must be absent AND the provider's own object must still reach the wire,
   * so the next reader sees the real schema immediately instead of an empty result
   * that looks like "caching is off".
   */
  it('carries `raw` verbatim even when no derived field is recognised', () => {
    const u = normaliseProviderUsage({ totally_unexpected_name: 42, nested: { cached: 7 } });
    expect(u, 'an unrecognised shape is still recorded').toBeDefined();
    expect(u?.input_tokens).toBeUndefined();
    expect(u?.output_tokens).toBeUndefined();
    expect(u?.cached_input_tokens).toBeUndefined();
    expect(u?.raw).toEqual({ totally_unexpected_name: 42, nested: { cached: 7 } });
  });

  it('records nothing for a payload that is not an object — never a shape that reads as measured', () => {
    for (const bad of [null, undefined, 42, 'usage', [1, 2, 3], true]) {
      expect(normaliseProviderUsage(bad), JSON.stringify(bad) ?? 'undefined').toBeUndefined();
    }
  });

  it('ignores a non-finite count rather than recording NaN as a token total', () => {
    const u = normaliseProviderUsage({ input_tokens: Number.NaN, output_tokens: 10 });
    expect(u?.input_tokens).toBeUndefined();
    expect(u?.output_tokens).toBe(10);
  });
});

describe('usage attaches to the call it belongs to', () => {
  it('attaches by handle, and a second in-flight call is left untouched', () => {
    runWithProviderPolicy(OPENAI_ONLY('test'), () => {
      const first = assertProviderAllowed('openai', 'site.one', { model: 'm', purpose: 'conversation' });
      const second = assertProviderAllowed('openai', 'site.two', { model: 'm', purpose: 'construction' });
      // The FIRST call's response lands after the second was already started.
      recordProviderUsage(first, { input_tokens: 111, input_tokens_details: { cached_tokens: 100 } });
      const calls = recordedProviderCalls();
      expect(calls[0]?.usage?.input_tokens, 'the handle must not drift to the newest row').toBe(111);
      expect(calls[1]?.usage, 'crediting one call’s tokens to another is the quietest way to make a caching measurement wrong').toBeUndefined();
      // And the second can still be filled independently.
      recordProviderUsage(second, { input_tokens: 222 });
      expect(recordedProviderCalls()[1]?.usage?.input_tokens).toBe(222);
      expect(recordedProviderCalls()[0]?.usage?.input_tokens).toBe(111);
    });
  });

  it('a REFUSED call never gets usage — no network happened', () => {
    runWithProviderPolicy(OPENAI_ONLY('test'), () => {
      let handle: number | undefined;
      try {
        handle = assertProviderAllowed('anthropic', 'site.blocked', { model: 'claude', purpose: 'conversation' });
      } catch {
        // expected: the policy refuses before the network
      }
      const calls = recordedProviderCalls();
      expect(calls[0]?.outcome).toBe('refused_before_network');
      recordProviderUsage(0, { input_tokens: 999 });
      expect(recordedProviderCalls()[0]?.usage, 'a refusal has no tokens to report').toBeUndefined();
      expect(handle).toBeUndefined();
    });
  });

  it('outside a policy it records nothing and does not throw', () => {
    expect(() => recordProviderUsage(0, { input_tokens: 1 })).not.toThrow();
    expect(assertProviderAllowed('openai', 'site.free')).toBeUndefined();
    expect(recordedProviderCalls()).toEqual([]);
  });

  it('an out-of-range handle is ignored', () => {
    runWithProviderPolicy(OPENAI_ONLY('test'), () => {
      assertProviderAllowed('openai', 'site.one', { model: 'm', purpose: 'p' });
      expect(() => recordProviderUsage(99, { input_tokens: 1 })).not.toThrow();
      expect(recordedProviderCalls()[0]?.usage).toBeUndefined();
    });
  });
});
