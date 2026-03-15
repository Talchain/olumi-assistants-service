/**
 * Orchestrator rate-limit middleware tests.
 *
 * Verifies:
 * - 429 returned after exceeding limit
 * - Response body matches existing CEE error shape
 * - retry_after_seconds present in body and Retry-After in header
 * - Rate limit headers on normal (allowed) responses
 * - Fail-open behaviour with structured warning log
 * - JWT sub extraction with a mock Bearer token
 * - IP fallback when no JWT present
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mock setup — vi.hoisted ensures variables exist before hoisted vi.mock
// ============================================================================

const { mockLog } = vi.hoisted(() => ({
  mockLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/utils/telemetry.js', () => ({
  log: mockLog,
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { checkRateLimit, _store, _resetStore, _resetConsecutiveErrors, _getConsecutiveErrors, createOrchestratorRateLimitHook } from '../../src/middleware/rate-limit.js';
import { extractJwtSub, extractClientIp, resolveUserKey } from '../../src/utils/jwt-extract.js';

// ============================================================================
// Tests
// ============================================================================

describe('orchestrator rate limiting', () => {
  beforeEach(() => {
    _resetStore();
    _resetConsecutiveErrors();
    mockLog.warn.mockClear();
    mockLog.error.mockClear();
  });

  describe('extractJwtSub', () => {
    it('extracts sub from a valid Bearer JWT', () => {
      // JWT payload: { "sub": "user-42", "iat": 1700000000 }
      const payload = Buffer.from(JSON.stringify({ sub: 'user-42', iat: 1700000000 })).toString('base64url');
      const token = `eyJhbGciOiJSUzI1NiJ9.${payload}.fake-signature`;
      expect(extractJwtSub(`Bearer ${token}`)).toBe('user-42');
    });

    it('returns undefined for non-Bearer header', () => {
      expect(extractJwtSub('Basic dXNlcjpwYXNz')).toBeUndefined();
    });

    it('returns undefined for missing header', () => {
      expect(extractJwtSub(undefined)).toBeUndefined();
    });

    it('returns undefined for malformed JWT (not 3 parts)', () => {
      expect(extractJwtSub('Bearer abc.def')).toBeUndefined();
    });

    it('returns undefined when sub is not a string', () => {
      const payload = Buffer.from(JSON.stringify({ sub: 123 })).toString('base64url');
      const token = `header.${payload}.sig`;
      expect(extractJwtSub(`Bearer ${token}`)).toBeUndefined();
    });
  });

  describe('extractClientIp', () => {
    it('extracts first IP from x-forwarded-for', () => {
      const req = { headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, ip: '127.0.0.1' } as any;
      expect(extractClientIp(req)).toBe('1.2.3.4');
    });

    it('falls back to request.ip', () => {
      const req = { headers: {}, ip: '10.0.0.1' } as any;
      expect(extractClientIp(req)).toBe('10.0.0.1');
    });
  });

  describe('resolveUserKey', () => {
    it('returns sub:-prefixed key for JWT', () => {
      const payload = Buffer.from(JSON.stringify({ sub: 'alice' })).toString('base64url');
      const req = {
        headers: { authorization: `Bearer h.${payload}.s` },
        ip: '127.0.0.1',
      } as any;
      expect(resolveUserKey(req)).toBe('sub:alice');
    });

    it('returns ip:-prefixed key when no JWT', () => {
      const req = { headers: {}, ip: '10.0.0.1' } as any;
      expect(resolveUserKey(req)).toBe('ip:10.0.0.1');
    });
  });

  describe('checkRateLimit', () => {
    it('allows requests under the limit', () => {
      const result = checkRateLimit('user-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(29); // 30 - 1
    });

    it('blocks after exceeding limit', () => {
      // Consume all 30 requests
      for (let i = 0; i < 30; i++) {
        checkRateLimit('user-2');
      }
      // 31st request should be blocked
      const result = checkRateLimit('user-2');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('resets after window expires', () => {
      const now = Date.now();
      for (let i = 0; i < 30; i++) {
        checkRateLimit('user-3', now);
      }
      // Request after window expiry
      const afterWindow = now + 3_600_001; // 1ms past the 60-min window
      const result = checkRateLimit('user-3', afterWindow);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(29);
    });

    it('isolates keys', () => {
      for (let i = 0; i < 30; i++) {
        checkRateLimit('user-a');
      }
      // Different user should not be affected
      const result = checkRateLimit('user-b');
      expect(result.allowed).toBe(true);
    });
  });

  describe('createOrchestratorRateLimitHook', () => {
    it('sets rate limit headers on allowed requests', async () => {
      const hook = createOrchestratorRateLimitHook();
      const headers: Record<string, unknown> = {};
      const req = {
        headers: {},
        ip: '1.2.3.4',
        id: 'test-req-id',
        requestId: 'test-req-id',
      } as any;
      const reply = {
        header: vi.fn((k: string, v: unknown) => { headers[k] = v; }),
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      await hook(req, reply);

      expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Limit', expect.any(Number));
      expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(Number));
      expect(reply.header).toHaveBeenCalledWith('X-RateLimit-Reset', expect.any(Number));
      expect(reply.code).not.toHaveBeenCalled(); // Not rejected
    });

    it('returns 429 with cee.error.v1 shape when limit exceeded', async () => {
      _resetStore();
      const hook = createOrchestratorRateLimitHook();
      const req = {
        headers: {},
        ip: '1.2.3.4',
        id: 'test-req-id',
        requestId: 'test-req-id',
        url: '/orchestrate/v1/turn',
      } as any;
      const reply = {
        header: vi.fn(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      // Exhaust the limit
      for (let i = 0; i < 30; i++) {
        await hook(req, { ...reply, header: vi.fn(), code: vi.fn().mockReturnThis(), send: vi.fn() });
      }

      // 31st request should be rejected
      await hook(req, reply);

      expect(reply.code).toHaveBeenCalledWith(429);
      const body = reply.send.mock.calls[0][0];
      expect(body.schema).toBe('cee.error.v1');
      expect(body.code).toBe('CEE_RATE_LIMIT');
      expect(body.retryable).toBe(true);
      expect(body.source).toBe('cee');
      expect(body.details.retry_after_seconds).toBeGreaterThan(0);
      expect(body.request_id).toBe('test-req-id');
      expect(body).not.toHaveProperty('statusCode');
      expect(reply.header).toHaveBeenCalledWith('Retry-After', expect.any(Number));
    });

    it('fails open on first error and logs structured warning', async () => {
      const hook = createOrchestratorRateLimitHook();
      // Trigger an error by passing a request with a getter that throws
      const req = {
        headers: { get authorization() { throw new Error('boom'); } },
        get ip() { throw new Error('boom'); },
        id: 'test-req',
        requestId: 'test-req',
        url: '/orchestrate/v1/turn',
      } as any;
      const reply = {
        header: vi.fn(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any;

      // Should not throw
      await hook(req, reply);

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'rate_limit_error', consecutive_errors: 1 }),
        expect.any(String),
      );
      // Request should be allowed through (no 429/503)
      expect(reply.code).not.toHaveBeenCalled();
      expect(_getConsecutiveErrors()).toBe(1);
    });

    it('fails closed after 3 consecutive errors (returns 503)', async () => {
      const hook = createOrchestratorRateLimitHook();
      const makeErrorReq = () => ({
        headers: { get authorization() { throw new Error('boom'); } },
        get ip() { throw new Error('boom'); },
        id: 'test-req',
        requestId: 'test-req',
        url: '/orchestrate/v1/turn',
      } as any);
      const makeReply = () => ({
        header: vi.fn(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any);

      // First 2 errors: fail open
      await hook(makeErrorReq(), makeReply());
      await hook(makeErrorReq(), makeReply());
      expect(_getConsecutiveErrors()).toBe(2);

      // 3rd error: fail closed
      const reply3 = makeReply();
      await hook(makeErrorReq(), reply3);

      expect(reply3.code).toHaveBeenCalledWith(503);
      const body = reply3.send.mock.calls[0][0];
      expect(body.schema).toBe('cee.error.v1');
      expect(body.code).toBe('CEE_RATE_LIMIT_UNAVAILABLE');
      expect(body.retryable).toBe(true);
      expect(_getConsecutiveErrors()).toBe(3);
    });

    it('resets consecutive error counter on success', async () => {
      const hook = createOrchestratorRateLimitHook();
      const makeErrorReq = () => ({
        headers: { get authorization() { throw new Error('boom'); } },
        get ip() { throw new Error('boom'); },
        id: 'test-req',
        requestId: 'test-req',
        url: '/orchestrate/v1/turn',
      } as any);
      const makeReply = () => ({
        header: vi.fn(),
        code: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as any);

      // 2 errors
      await hook(makeErrorReq(), makeReply());
      await hook(makeErrorReq(), makeReply());
      expect(_getConsecutiveErrors()).toBe(2);

      // Successful request resets counter
      const goodReq = {
        headers: {},
        ip: '1.2.3.4',
        id: 'test-req',
        requestId: 'test-req',
        url: '/orchestrate/v1/turn',
      } as any;
      await hook(goodReq, makeReply());
      expect(_getConsecutiveErrors()).toBe(0);
    });
  });
});
