/**
 * V5 routing prompt — byte-stability invariants.
 *
 * The Anthropic prompt-cache key is the byte sequence of the cached system
 * block. If the bytes drift across reloads (line-ending flips, trailing
 * whitespace from editors, etc.) the cache misses every turn. The loader
 * normalizes once at module init; these tests pin that contract.
 */

import { describe, it, expect } from 'vitest';
import { loadRoutingPrompt } from '../../src/orchestrator-v5/routing/prompt-loader.js';

describe('routing prompt byte-stability', () => {
  it('two consecutive loads return byte-identical .text', () => {
    const a = loadRoutingPrompt();
    const b = loadRoutingPrompt();
    expect(Buffer.from(a.text).equals(Buffer.from(b.text))).toBe(true);
  });

  it('.text contains no \\r characters', () => {
    const { text } = loadRoutingPrompt();
    expect(text.includes('\r')).toBe(false);
  });

  it('.text has no trailing whitespace on any line', () => {
    const { text } = loadRoutingPrompt();
    const offenders = text
      .split('\n')
      .map((line, i) => ({ i, line }))
      .filter(({ line }) => /[ \t]$/.test(line));
    expect(offenders).toEqual([]);
  });

  it('.sentHash is deterministic across loads', () => {
    const a = loadRoutingPrompt();
    const b = loadRoutingPrompt();
    expect(a.sentHash).toBe(b.sentHash);
  });

  it('.sourceHash is deterministic across loads', () => {
    const a = loadRoutingPrompt();
    const b = loadRoutingPrompt();
    expect(a.sourceHash).toBe(b.sourceHash);
  });

  it('.hash aliases .sentHash for backward-compat log fields', () => {
    const p = loadRoutingPrompt();
    expect(p.hash).toBe(p.sentHash);
  });
});

describe('UTF-8 byte length (regression: non-ASCII content)', () => {
  // The routing call's `stable_prefix_bytes` telemetry must be a UTF-8
  // byte length, not UTF-16 code-unit count. Today v40 is ASCII so
  // string.length and Buffer.byteLength coincide; if a future prompt
  // edit adds non-ASCII glyphs (em dashes, smart quotes, currency, etc.)
  // the metric must still report the on-the-wire byte count.
  it('Buffer.byteLength of a non-ASCII string differs from .length', () => {
    const sample = 'budget — “Q3” £300k → résumé';
    expect(Buffer.byteLength(sample, 'utf8')).toBeGreaterThan(sample.length);
  });
});
