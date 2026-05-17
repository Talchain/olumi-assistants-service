/**
 * Unit tests for the per-request debug-fields gate helper.
 *
 * The header tolerance rules below are the contract DGAI and the replay
 * harness rely on:
 *   - case-insensitive token match
 *   - whitespace around tokens tolerated
 *   - comma-separated lists supported
 *   - absent / array-valued / non-string headers return false safely
 *
 * Server-side permission flag (`config.cee.timingDebugEnabled`) is NOT
 * checked here — that's the caller's responsibility. This helper is the
 * per-request gate only.
 */

import { describe, expect, it } from 'vitest';
import type { IncomingHttpHeaders } from 'node:http';

import { debugFieldRequested } from '../debug-fields.js';

function headers(input: Record<string, string | string[] | undefined>): IncomingHttpHeaders {
  return input as IncomingHttpHeaders;
}

describe('debugFieldRequested — X-Olumi-Debug header gate', () => {
  it('returns false when the header is absent', () => {
    expect(debugFieldRequested(headers({}), 'timings')).toBe(false);
  });

  it('returns false when the header is undefined explicitly', () => {
    expect(debugFieldRequested(headers({ 'x-olumi-debug': undefined }), 'timings')).toBe(false);
  });

  it('returns false when the header is empty', () => {
    expect(debugFieldRequested(headers({ 'x-olumi-debug': '' }), 'timings')).toBe(false);
  });

  it('returns true on exact single-token match', () => {
    expect(debugFieldRequested(headers({ 'x-olumi-debug': 'timings' }), 'timings')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(debugFieldRequested(headers({ 'x-olumi-debug': 'TIMINGS' }), 'timings')).toBe(true);
    expect(debugFieldRequested(headers({ 'x-olumi-debug': 'Timings' }), 'timings')).toBe(true);
  });

  it('tolerates surrounding whitespace on the single value', () => {
    expect(debugFieldRequested(headers({ 'x-olumi-debug': '  timings  ' }), 'timings')).toBe(true);
  });

  it('supports comma-separated token lists', () => {
    expect(
      debugFieldRequested(headers({ 'x-olumi-debug': 'timings,diagnostics' }), 'timings'),
    ).toBe(true);
    expect(
      debugFieldRequested(headers({ 'x-olumi-debug': 'diagnostics,timings' }), 'timings'),
    ).toBe(true);
    expect(
      debugFieldRequested(
        headers({ 'x-olumi-debug': '  diagnostics ,  timings , cache_stats  ' }),
        'timings',
      ),
    ).toBe(true);
  });

  it('returns false when a different token is requested', () => {
    expect(debugFieldRequested(headers({ 'x-olumi-debug': 'diagnostics' }), 'timings')).toBe(false);
    expect(debugFieldRequested(headers({ 'x-olumi-debug': 'cache_stats,foo' }), 'timings')).toBe(false);
  });

  it('does not partial-match (timings is NOT a prefix of timings_extended)', () => {
    expect(
      debugFieldRequested(headers({ 'x-olumi-debug': 'timings_extended' }), 'timings'),
    ).toBe(false);
  });

  it('handles array-valued headers by inspecting the first non-empty entry', () => {
    expect(
      debugFieldRequested(headers({ 'x-olumi-debug': ['timings', 'diagnostics'] }), 'timings'),
    ).toBe(true);
    expect(
      debugFieldRequested(headers({ 'x-olumi-debug': ['diagnostics'] }), 'timings'),
    ).toBe(false);
  });

  it('array with leading empty string falls through to the next non-empty entry (matches the documented contract)', () => {
    expect(
      debugFieldRequested(headers({ 'x-olumi-debug': ['', 'timings'] }), 'timings'),
    ).toBe(true);
    expect(
      debugFieldRequested(headers({ 'x-olumi-debug': ['', '', 'diagnostics,timings'] }), 'timings'),
    ).toBe(true);
    expect(
      debugFieldRequested(headers({ 'x-olumi-debug': ['', '', ''] }), 'timings'),
    ).toBe(false);
    expect(
      debugFieldRequested(headers({ 'x-olumi-debug': [] }), 'timings'),
    ).toBe(false);
  });

  it('returns false on non-string header values defensively', () => {
    // Node typings normally enforce string|string[]|undefined, but
    // upstream middleware can rewrite to other shapes. The gate must
    // fail closed rather than throw.
    expect(
      debugFieldRequested(
        headers({ 'x-olumi-debug': 123 as unknown as string }),
        'timings',
      ),
    ).toBe(false);
  });
});
