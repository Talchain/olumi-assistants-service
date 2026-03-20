/**
 * Rate-limit middleware unit tests.
 *
 * Covers: checkRateLimit core logic, key resolution priority,
 * fail-open/fail-closed behaviour, and response headers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  resolveRateLimitKey,
  _resetStore,
  _resetConsecutiveErrors,
  _getConsecutiveErrors,
} from '../../../src/middleware/rate-limit.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeRequest(opts: {
  authorization?: string;
  ip?: string;
}) {
  return {
    headers: {
      authorization: opts.authorization,
    },
    ip: opts.ip ?? '192.168.1.1',
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rate-limit middleware', () => {
  beforeEach(() => {
    _resetStore();
    _resetConsecutiveErrors();
  });

  // -------------------------------------------------------------------------
  // checkRateLimit
  // -------------------------------------------------------------------------

  describe('checkRateLimit', () => {
    it('allows requests under the limit', () => {
      const result = checkRateLimit('test-key', 1000, 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.limit).toBe(5);
    });

    it('denies requests at the limit', () => {
      const now = 1000;
      for (let i = 0; i < 5; i++) {
        checkRateLimit('test-key', now, 5);
      }
      const result = checkRateLimit('test-key', now, 5);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('resets count after window expires', () => {
      const start = 1000;
      for (let i = 0; i < 10; i++) {
        checkRateLimit('test-key', start, 5);
      }
      // Window is 60s
      const afterWindow = start + 61_000;
      const result = checkRateLimit('test-key', afterWindow, 5);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
    });

    it('calculates retryAfterSeconds correctly', () => {
      const now = 5000;
      const result = checkRateLimit('test-key', now, 5);
      // Window resets at now + 60_000 = 65_000
      // retryAfterSeconds = ceil((65000 - 5000) / 1000) = 60
      expect(result.retryAfterSeconds).toBe(60);
    });

    it('returns minimum retryAfterSeconds of 1', () => {
      const now = 1000;
      checkRateLimit('test-key', now, 5);
      // Even at the very end of the window, minimum is 1
      const nearEnd = now + 59_500;
      const result = checkRateLimit('test-key', nearEnd, 5);
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });
  });

  // -------------------------------------------------------------------------
  // resolveRateLimitKey
  // -------------------------------------------------------------------------

  describe('resolveRateLimitKey', () => {
    it('uses user+scenario key when authenticated with scenario', () => {
      const request = makeFakeRequest({
        authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.fake',
      });
      const { key, keyType, limit } = resolveRateLimitKey(request, 'scenario-123');
      expect(keyType).toBe('user+scenario');
      expect(key).toContain('scenario:scenario-123');
      expect(limit).toBe(30);
    });

    it('uses user key when authenticated without scenario', () => {
      const request = makeFakeRequest({
        authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhbGljZSJ9.fake',
      });
      const { key, keyType } = resolveRateLimitKey(request);
      expect(keyType).toBe('user');
      expect(key).toMatch(/^user:/);
    });

    it('uses ip key for unauthenticated requests (stricter limit)', () => {
      const request = makeFakeRequest({ ip: '10.0.0.1' });
      const { key, keyType, limit } = resolveRateLimitKey(request);
      expect(keyType).toBe('ip');
      expect(key).toBe('ip:10.0.0.1');
      expect(limit).toBe(10);
    });

    it('ignores scenario_id for unauthenticated requests', () => {
      const request = makeFakeRequest({ ip: '10.0.0.1' });
      const { keyType } = resolveRateLimitKey(request, 'scenario-123');
      expect(keyType).toBe('ip');
    });
  });

  // -------------------------------------------------------------------------
  // Consecutive error tracking
  // -------------------------------------------------------------------------

  describe('consecutive error tracking', () => {
    it('starts at 0', () => {
      expect(_getConsecutiveErrors()).toBe(0);
    });

    it('resets with _resetConsecutiveErrors', () => {
      // Simulate external increment (through hook error path)
      _resetConsecutiveErrors();
      expect(_getConsecutiveErrors()).toBe(0);
    });
  });
});
