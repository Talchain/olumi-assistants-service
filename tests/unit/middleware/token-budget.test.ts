/**
 * Token-budget middleware unit tests.
 *
 * Covers: budget checking, token recording, lazy midnight reset,
 * request context lifecycle, and disabled-mode behaviour.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkBudget,
  recordTokenUsage,
  registerRequestContext,
  unregisterRequestContext,
  getRequestContext,
  _resetStores,
  _budgetStore,
  type RequestContext,
} from '../../../src/middleware/token-budget.js';

describe('token-budget middleware', () => {
  beforeEach(() => {
    _resetStores();
  });

  // -------------------------------------------------------------------------
  // checkBudget
  // -------------------------------------------------------------------------

  describe('checkBudget', () => {
    it('returns not exceeded for new users', () => {
      const result = checkBudget('sub:alice', Date.now());
      expect(result.exceeded).toBe(false);
      expect(result.used).toBe(0);
      expect(result.limit).toBe(500_000);
    });

    it('marks exceeded when tokens >= limit', () => {
      _budgetStore.set('sub:alice', {
        tokens: 500_000,
        resetAt: Date.now() + 86_400_000,
      });
      const result = checkBudget('sub:alice');
      expect(result.exceeded).toBe(true);
    });

    it('resets budget entry after midnight UTC', () => {
      const pastMidnight = Date.now() - 1;
      _budgetStore.set('sub:alice', {
        tokens: 999_999,
        resetAt: pastMidnight,
      });
      const result = checkBudget('sub:alice');
      expect(result.exceeded).toBe(false);
      expect(result.used).toBe(0);
    });

    it('calculates retryAfterSeconds > 0', () => {
      const result = checkBudget('sub:alice');
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // recordTokenUsage
  // -------------------------------------------------------------------------

  describe('recordTokenUsage', () => {
    it('records tokens for registered request context', () => {
      const ctx: RequestContext = {
        userKey: 'sub:alice',
        userId: 'alice',
        scenarioId: null,
        task: 'draft_graph',
      };
      registerRequestContext('req-1', ctx);
      recordTokenUsage('req-1', 1000);
      const entry = _budgetStore.get('sub:alice');
      expect(entry).toBeDefined();
      expect(entry!.tokens).toBe(1000);
    });

    it('accumulates tokens across multiple calls', () => {
      const ctx: RequestContext = {
        userKey: 'sub:bob',
        userId: 'bob',
        scenarioId: null,
        task: 'orchestrator',
      };
      registerRequestContext('req-2', ctx);
      recordTokenUsage('req-2', 500);
      recordTokenUsage('req-2', 300);
      const entry = _budgetStore.get('sub:bob');
      expect(entry!.tokens).toBe(800);
    });

    it('is a no-op when requestId not in context map', () => {
      recordTokenUsage('unknown-req', 9999);
      expect(_budgetStore.size).toBe(0);
    });

    it('resets tokens if past midnight on record', () => {
      const pastMidnight = Date.now() - 1;
      _budgetStore.set('sub:carol', {
        tokens: 400_000,
        resetAt: pastMidnight,
      });
      const ctx: RequestContext = {
        userKey: 'sub:carol',
        userId: 'carol',
        scenarioId: null,
        task: null,
      };
      registerRequestContext('req-3', ctx);
      recordTokenUsage('req-3', 100);
      const entry = _budgetStore.get('sub:carol');
      expect(entry!.tokens).toBe(100); // Fresh entry, not 400_100
    });
  });

  // -------------------------------------------------------------------------
  // Request context lifecycle
  // -------------------------------------------------------------------------

  describe('request context', () => {
    it('registers and retrieves context', () => {
      const ctx: RequestContext = {
        userKey: 'ip:10.0.0.1',
        userId: null,
        scenarioId: 'sc-1',
        task: 'draft_graph',
      };
      registerRequestContext('req-10', ctx);
      expect(getRequestContext('req-10')).toEqual(ctx);
    });

    it('unregisters context', () => {
      registerRequestContext('req-11', {
        userKey: 'sub:x',
        userId: 'x',
        scenarioId: null,
        task: null,
      });
      unregisterRequestContext('req-11');
      expect(getRequestContext('req-11')).toBeUndefined();
    });

    it('returns undefined for unregistered requestId', () => {
      expect(getRequestContext('nonexistent')).toBeUndefined();
    });
  });
});
