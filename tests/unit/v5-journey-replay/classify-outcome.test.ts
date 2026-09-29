import { describe, expect, it } from 'vitest';

import {
  classifyResponse,
  hasErrorEnvelope,
  isTransportError,
} from '../../../tools/v5-journey-replay/classify-outcome.js';

describe('classifyResponse', () => {
  it.each([
    [200, 'v5-runtime'],
    [400, 'v5-runtime'],
    [422, 'v5-runtime'],
    [500, 'v5-runtime'],
    [502, 'v5-runtime'],
  ] as const)('status %d -> %s', (status, expected) => {
    expect(classifyResponse({ status, body: undefined })).toBe(expected);
  });

  it.each([
    [401, 'harness-auth-blocker'],
    [403, 'harness-auth-blocker'],
  ] as const)('status %d -> %s (auth blocker)', (status, expected) => {
    expect(classifyResponse({ status, body: undefined })).toBe(expected);
  });
});

describe('hasErrorEnvelope', () => {
  it('returns false for undefined body', () => {
    expect(hasErrorEnvelope(undefined)).toBe(false);
  });

  it('returns false for empty body', () => {
    expect(hasErrorEnvelope({})).toBe(false);
  });

  it('returns true for schema: error.v1 shape', () => {
    expect(
      hasErrorEnvelope({
        schema: 'error.v1',
        code: 'UNAUTHENTICATED',
      }),
    ).toBe(true);
  });

  it('returns true for BoundaryError shape (error + boundary both present)', () => {
    expect(
      hasErrorEnvelope({
        error: 'INTERNAL_ERROR',
        boundary: 'post-turn',
      }),
    ).toBe(true);
  });

  it('returns false when only error is present (non-BoundaryError)', () => {
    expect(hasErrorEnvelope({ error: 'something' })).toBe(false);
  });

  it('returns false for valid success response', () => {
    expect(
      hasErrorEnvelope({
        response_version: 2,
        assistant_text: 'Hello',
        suggested_actions: [],
      }),
    ).toBe(false);
  });
});

describe('isTransportError', () => {
  it.each([
    'fetch failed',
    'request to https://example.com failed, reason: connect ECONNREFUSED',
    'getaddrinfo ENOTFOUND cee-staging.onrender.com',
    'The operation was aborted',
    'AbortError: The operation was aborted',
    'network timeout at: https://example.com',
  ])('detects transport error: %s', (msg) => {
    expect(isTransportError(msg)).toBe(true);
  });

  it.each([
    'some random runtime error',
    'invalid response shape',
    'HTTP 500',
  ])('does not flag non-transport error: %s', (msg) => {
    expect(isTransportError(msg)).toBe(false);
  });
});
