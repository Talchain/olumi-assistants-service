/**
 * Token budget middleware tests.
 *
 * Verifies:
 * - Daily budget blocks requests when exceeded with correct error shape and code
 * - retry_after_seconds is correct (seconds until midnight UTC)
 * - Budget resets after midnight UTC
 * - Token recording increments correctly via request context
 * - Context registration and cleanup
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

import {
  checkBudget,
  recordTokenUsage,
  registerRequestContext,
  unregisterRequestContext,
  getRequestContext,
  createContextRegistrationHook,
  createContextCleanupHook,
  _budgetStore,
  _requestContextMap,
  _resetStores,
} from '../../src/middleware/token-budget.js';

// ============================================================================
// Tests
// ============================================================================

describe('token budget', () => {
  beforeEach(() => {
    _resetStores();
    mockLog.warn.mockClear();
  });

  describe('checkBudget', () => {
    it('returns not exceeded for new user', () => {
      const result = checkBudget('user-1');
      expect(result.exceeded).toBe(false);
      expect(result.used).toBe(0);
      expect(result.limit).toBe(500_000);
    });

    it('returns exceeded after consuming budget', () => {
      const now = Date.now();
      const midnight = new Date(now);
      midnight.setUTCHours(24, 0, 0, 0);
      _budgetStore.set('user-2', { tokens: 500_000, resetAt: midnight.getTime() });

      const result = checkBudget('user-2', now);
      expect(result.exceeded).toBe(true);
      expect(result.used).toBe(500_000);
    });

    it('resets after midnight UTC', () => {
      const now = Date.now();
      const pastMidnight = new Date(now);
      pastMidnight.setUTCHours(24, 0, 0, 0);

      _budgetStore.set('user-3', { tokens: 500_000, resetAt: pastMidnight.getTime() });

      const afterMidnight = pastMidnight.getTime() + 1;
      const result = checkBudget('user-3', afterMidnight);
      expect(result.exceeded).toBe(false);
      expect(result.used).toBe(0);
    });

    it('returns correct retry_after_seconds', () => {
      const d = new Date();
      d.setUTCHours(23, 0, 0, 0);
      const now = d.getTime();

      const result = checkBudget('user-4', now);
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(3599);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(3601);
    });
  });

  describe('recordTokenUsage', () => {
    it('increments token count for mapped user via request context', () => {
      registerRequestContext('req-1', {
        userKey: 'sub:user-a',
        userId: 'user-a',
        scenarioId: null,
        task: 'draft_graph',
      });
      recordTokenUsage('req-1', 1000);
      recordTokenUsage('req-1', 500);

      const entry = _budgetStore.get('sub:user-a');
      expect(entry?.tokens).toBe(1500);
    });

    it('is a no-op when request context is missing', () => {
      recordTokenUsage('unknown-req', 1000);
      expect(_budgetStore.size).toBe(0);
    });
  });

  describe('request context mapping', () => {
    it('registers and unregisters correctly', () => {
      const ctx = { userKey: 'sub:alice', userId: 'alice', scenarioId: 'sc-1', task: 'draft_graph' };
      registerRequestContext('req-1', ctx);
      expect(getRequestContext('req-1')).toEqual(ctx);

      unregisterRequestContext('req-1');
      expect(getRequestContext('req-1')).toBeUndefined();
    });

    it('stores rich context fields', () => {
      registerRequestContext('req-2', {
        userKey: 'ip:1.2.3.4',
        userId: null,
        scenarioId: 'scenario-42',
        task: 'orchestrator',
      });
      const ctx = getRequestContext('req-2');
      expect(ctx?.userKey).toBe('ip:1.2.3.4');
      expect(ctx?.userId).toBeNull();
      expect(ctx?.scenarioId).toBe('scenario-42');
      expect(ctx?.task).toBe('orchestrator');
    });
  });

  describe('createContextRegistrationHook', () => {
    it('registers context for POST /assist/v1/ routes', async () => {
      const hook = createContextRegistrationHook();
      const req = {
        method: 'POST',
        url: '/assist/v1/draft-graph',
        headers: {},
        ip: '1.2.3.4',
        id: 'test-req',
        requestId: 'test-req',
      } as any;

      await hook(req);

      const ctx = _requestContextMap.get('test-req');
      expect(ctx).toBeDefined();
      expect(ctx?.userKey).toBe('ip:1.2.3.4');
      expect(ctx?.task).toBe('draft_graph');
    });

    it('skips non-POST requests', async () => {
      const hook = createContextRegistrationHook();
      const req = {
        method: 'GET',
        url: '/assist/v1/health',
        headers: {},
        ip: '1.2.3.4',
        id: 'test-req',
        requestId: 'test-req',
      } as any;

      await hook(req);

      expect(_requestContextMap.has('test-req')).toBe(false);
    });

    it('fails open on error and logs structured warning', async () => {
      const hook = createContextRegistrationHook();
      const req = {
        method: 'POST',
        url: '/assist/v1/draft-graph',
        headers: { get authorization() { throw new Error('boom'); } },
        get ip() { throw new Error('boom'); },
        id: 'test-req-err',
        requestId: 'test-req-err',
      } as any;

      await hook(req);

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'budget_tracker_error' }),
        expect.any(String),
      );
    });
  });

  describe('createContextCleanupHook', () => {
    it('removes context on response', async () => {
      registerRequestContext('req-cleanup', {
        userKey: 'sub:bob',
        userId: 'bob',
        scenarioId: null,
        task: 'chat',
      });

      const hook = createContextCleanupHook();
      const req = { id: 'req-cleanup', requestId: 'req-cleanup' } as any;
      await hook(req);

      expect(_requestContextMap.has('req-cleanup')).toBe(false);
    });
  });
});
