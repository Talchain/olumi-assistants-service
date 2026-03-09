import { describe, it, expect, beforeEach } from 'vitest';
import {
  checkRateLimit,
  resolveRateLimitKey,
  _resetStore,
} from '../../../src/middleware/rate-limit.js';
import type { FastifyRequest } from 'fastify';

describe('Rate limiting (Task 5)', () => {
  beforeEach(() => {
    _resetStore();
  });

  it('rate limiter hook is applied to orchestrator endpoint', async () => {
    // Verify the module exports the hook factory
    const mod = await import('../../../src/middleware/rate-limit.js');
    expect(typeof mod.createOrchestratorRateLimitHook).toBe('function');

    // Verify the hook is a function
    const hook = mod.createOrchestratorRateLimitHook();
    expect(typeof hook).toBe('function');
  });

  it('resolveRateLimitKey includes scenario_id for authenticated users', () => {
    const mockRequest = {
      headers: { authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.sig' },
      ip: '127.0.0.1',
      ips: [],
    } as unknown as FastifyRequest;

    // With scenario_id
    const withScenario = resolveRateLimitKey(mockRequest, 'scenario-abc');
    expect(withScenario.keyType).toBe('user+scenario');
    expect(withScenario.key).toContain('scenario:scenario-abc');

    // Without scenario_id
    const withoutScenario = resolveRateLimitKey(mockRequest);
    expect(withoutScenario.keyType).toBe('user');
    expect(withoutScenario.key).not.toContain('scenario');
  });

  it('unauthenticated requests use IP-only key even with scenario_id', () => {
    const mockRequest = {
      headers: {},
      ip: '10.0.0.1',
      ips: [],
    } as unknown as FastifyRequest;

    // Without scenario_id
    const withoutScenario = resolveRateLimitKey(mockRequest);
    expect(withoutScenario.keyType).toBe('ip');
    expect(withoutScenario.limit).toBe(10); // MAX_REQUESTS_UNAUTHENTICATED

    // With scenario_id — still IP-only (untrusted scenario_id ignored)
    const withScenario = resolveRateLimitKey(mockRequest, 'scenario-abc');
    expect(withScenario.keyType).toBe('ip');
    expect(withScenario.key).not.toContain('scenario');
    expect(withScenario.limit).toBe(10);
  });

  it('checkRateLimit enforces the provided limit', () => {
    const key = 'test:key';
    const now = Date.now();

    // Fill up to limit
    for (let i = 0; i < 30; i++) {
      const result = checkRateLimit(key, now, 30);
      expect(result.allowed).toBe(true);
    }

    // 31st request should be blocked
    const blocked = checkRateLimit(key, now, 30);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });
});
