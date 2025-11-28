/**
 * ISL Circuit Breaker Unit Tests
 *
 * Tests for circuit breaker behavior in ISL causal validation integration.
 * Circuit breaker protects against cascading failures by temporarily disabling
 * ISL calls after consecutive failures.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { components } from '../../src/generated/openapi.d.ts';
import type { GraphV1 } from '../../src/contracts/plot/engine.js';
import { cleanBaseUrl } from '../helpers/env-setup.js';

// Mock logger globally so it works with vi.resetModules()
// Use explicit type to avoid implicit any
interface MockLogger {
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
  trace: ReturnType<typeof vi.fn>;
  child: ReturnType<typeof vi.fn>;
}

const mockLogger: MockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: vi.fn(),
};

vi.mock('../../src/utils/simple-logger.js', () => ({
  logger: mockLogger,
}));

type CEEBiasFindingV1 = components['schemas']['CEEBiasFindingV1'];

// Circuit breaker constants (must match implementation)
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_PAUSE_MS = 90000; // 90 seconds
const CIRCUIT_BREAKER_RESET_MS = 60000; // 60 seconds

// Module-level time that persists across tests to handle persistent circuit breaker state
let mockTime = 1000000000000;

// Dynamic import references for config-dependent functions
let enrichBiasFindings: typeof import('../../src/cee/bias/causal-enrichment.js').enrichBiasFindings;
let __resetIslCircuitBreakerForTests: typeof import('../../src/cee/bias/causal-enrichment.js').__resetIslCircuitBreakerForTests;

describe('ISL Circuit Breaker', () => {
  let mockGraph: GraphV1;
  let mockFindings: CEEBiasFindingV1[];
  let realDateNow: typeof Date.now;

  beforeEach(async () => {
    // Reset modules and config cache for clean env var state
    vi.resetModules();
    cleanBaseUrl();

    // Save real Date.now before spying
    realDateNow = Date.now;

    // Advance time past any potential circuit breaker pause from previous tests
    // This ensures circuit breaker is in clean state
    mockTime += CIRCUIT_BREAKER_PAUSE_MS + 10000;

    // Enable feature flag and configure ISL BEFORE importing config-dependent modules
    process.env.CEE_CAUSAL_VALIDATION_ENABLED = 'true';
    process.env.ISL_BASE_URL = 'http://localhost:8080';
    process.env.ISL_TIMEOUT_MS = '5000';
    process.env.ISL_MAX_RETRIES = '0'; // No retries for circuit breaker tests

    // Reset config cache and dynamically import config-dependent functions
    const { _resetConfigCache } = await import('../../src/config/index.js');
    _resetConfigCache();

    const causalEnrichment = await import('../../src/cee/bias/causal-enrichment.js');
    enrichBiasFindings = causalEnrichment.enrichBiasFindings;
    __resetIslCircuitBreakerForTests = causalEnrichment.__resetIslCircuitBreakerForTests;

    // Reset circuit breaker state
    __resetIslCircuitBreakerForTests();

    // Mock time control
    vi.spyOn(Date, 'now').mockImplementation(() => mockTime);
    (global as any).advanceTime = (ms: number) => {
      mockTime += ms;
    };
    (global as any).setMockTime = (timestamp: number) => {
      mockTime = timestamp;
    };

    // Setup test fixtures
    mockGraph = {
      version: '1',
      default_seed: 17,
      nodes: [
        { id: 'goal1', kind: 'goal', label: 'Main Goal' } as any,
        { id: 'evidence1', kind: 'evidence', label: 'Evidence 1' } as any,
      ],
      edges: [
        { id: 'e1', source: 'evidence1', target: 'goal1' } as any,
      ],
      meta: {
        roots: [],
        leaves: [],
        suggested_positions: {},
        source: 'fixtures' as const,
      },
    };

    mockFindings = [
      {
        id: 'CONFIRMATION_BIAS',
        code: 'CONFIRMATION_BIAS',
        category: 'selection',
        severity: 'high',
        explanation: 'Evidence may be selectively chosen',
        targets: {
          node_ids: ['evidence1'],
        },
      } as CEEBiasFindingV1,
    ];

    // Clear mock logger calls from previous test/setup
    mockLogger.debug.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();

    // Mock a successful fetch to ensure circuit breaker closes if it was open
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        validations: [],
        request_id: 'cleanup',
        latency_ms: 1,
      }),
    });

    // Trigger circuit close check by calling enrichBiasFindings
    // This will close the circuit if it was open from a previous test
    try {
      await enrichBiasFindings(mockGraph, []);
    } catch {
      // Ignore any errors during cleanup
    }

    // Clear all mocks after cleanup
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore mocks
    vi.restoreAllMocks();
    Date.now = realDateNow;
    delete (global as any).advanceTime;
    delete (global as any).setMockTime;

    // Clean up env vars
    delete process.env.CEE_CAUSAL_VALIDATION_ENABLED;
    delete process.env.ISL_BASE_URL;
    delete process.env.ISL_TIMEOUT_MS;
    delete process.env.ISL_MAX_RETRIES;
  });

  it('should open circuit after 3 consecutive ISL failures', async () => {
    // Mock ISL to fail
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    // First failure
    await enrichBiasFindings(mockGraph, mockFindings);
    expect(mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    )).toBeUndefined();

    // Second failure
    await enrichBiasFindings(mockGraph, mockFindings);
    expect(mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    )).toBeUndefined();

    // Third failure - should open circuit
    await enrichBiasFindings(mockGraph, mockFindings);

    // Verify circuit breaker opened event logged
    const openedLog = mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    );
    expect(openedLog).toBeDefined();
    const openedLogEntry = openedLog as any;
    expect(openedLogEntry[0]).toMatchObject({
      event: 'isl.circuit_breaker.opened',
      consecutive_failures: CIRCUIT_BREAKER_THRESHOLD,
      pause_ms: CIRCUIT_BREAKER_PAUSE_MS,
    });
    expect(openedLogEntry[0].resume_at).toBeDefined();
  });

  it('should skip ISL calls when circuit is open and log circuit_open event', async () => {
    // Mock ISL to fail
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    // Trigger 3 failures to open circuit
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);

    // Verify circuit opened
    expect(mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    )).toBeDefined();

    // Clear mock calls
    mockLogger.warn.mockClear();
    (global.fetch as any).mockClear();

    // Advance time by 30 seconds (still within 90s pause)
    (global as any).advanceTime(30000);

    // Make another call - should be skipped
    const result = await enrichBiasFindings(mockGraph, mockFindings);

    // Verify no fetch call made
    expect(fetch).not.toHaveBeenCalled();

    // Verify circuit_open event logged
    const circuitOpenLog = mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'cee.bias.causal_validation.circuit_open'
    );
    expect(circuitOpenLog).toBeDefined();
    const circuitOpenLogEntry = circuitOpenLog as any;
    expect(circuitOpenLogEntry[0]).toMatchObject({
      event: 'cee.bias.causal_validation.circuit_open',
      reason: 'Circuit breaker paused due to consecutive failures',
    });

    // Verify unenriched findings returned
    expect(result).toEqual(mockFindings);
    expect(result[0]).not.toHaveProperty('causal_validation');
  });

  it('should close circuit after pause expires and allow ISL calls', async () => {
    // Mock ISL to fail initially, then succeed
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    // Trigger 3 failures to open circuit
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);

    // Verify circuit opened
    expect(mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    )).toBeDefined();

    // Clear logger mocks
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();

    // Advance time past pause window (90+ seconds)
    (global as any).advanceTime(CIRCUIT_BREAKER_PAUSE_MS + 1000);

    // Mock ISL to succeed now
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        validations: [
          {
            bias_code: 'CONFIRMATION_BIAS',
            causal_validation: {
              identifiable: true,
              strength: 0.75,
              confidence: 'high' as const,
            },
          },
        ],
        request_id: 'req-123',
        latency_ms: 150,
      }),
    });

    // Make another call - should succeed
    const result = await enrichBiasFindings(mockGraph, mockFindings);

    // Verify circuit closed event logged
    const closedLog = mockLogger.info.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.closed'
    );
    expect(closedLog).toBeDefined();
    const closedLogEntry = closedLog as any;
    expect(closedLogEntry[0]).toMatchObject({
      event: 'isl.circuit_breaker.closed',
      pause_duration_ms: CIRCUIT_BREAKER_PAUSE_MS,
    });

    // Verify ISL call was made
    expect(fetch).toHaveBeenCalled();

    // Verify enriched findings returned
    expect(result[0]).toHaveProperty('causal_validation');
    expect(result[0].causal_validation).toMatchObject({
      identifiable: true,
      strength: 0.75,
      confidence: 'high',
    });

    // Verify success event logged
    const successLog = mockLogger.info.mock.calls.find(
      (call: any) => call[0]?.event === 'cee.bias.causal_validation.success'
    );
    expect(successLog).toBeDefined();
  });

  it('should reset circuit breaker after successful ISL call', async () => {
    // Mock ISL to fail twice, then succeed
    let callCount = 0;
    global.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.reject(new Error('Connection refused'));
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          validations: [
            {
              bias_code: 'CONFIRMATION_BIAS',
              causal_validation: {
                identifiable: true,
                strength: 0.8,
                confidence: 'high' as const,
              },
            },
          ],
          request_id: 'req-123',
          latency_ms: 100,
        }),
      });
    });

    // First two failures
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);

    // Verify circuit not opened yet
    expect(mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    )).toBeUndefined();

    // Third call succeeds
    mockLogger.info.mockClear();
    const result = await enrichBiasFindings(mockGraph, mockFindings);

    // Verify circuit breaker reset event logged
    const resetLog = mockLogger.info.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.reset'
    );
    expect(resetLog).toBeDefined();
    const resetLogEntry = resetLog as any;
    expect(resetLogEntry[0]).toMatchObject({
      event: 'isl.circuit_breaker.reset',
      previous_failures: 2,
    });

    // Verify enriched findings returned
    expect(result[0]).toHaveProperty('causal_validation');

    // Verify success logged
    const successLog = mockLogger.info.mock.calls.find(
      (call: any) => call[0]?.event === 'cee.bias.causal_validation.success'
    );
    expect(successLog).toBeDefined();

    // Now trigger 3 more failures - should need full 3 to open circuit
    callCount = 0; // Reset for new failure sequence
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    mockLogger.warn.mockClear();

    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);

    // Circuit should not be open yet after 2 failures
    expect(mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    )).toBeUndefined();

    await enrichBiasFindings(mockGraph, mockFindings);

    // Circuit should open after 3rd failure
    expect(mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    )).toBeDefined();
  });

  it('should reset failure counter after 60 seconds of no failures', async () => {
    // Mock ISL to fail
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    // Record 2 failures (not enough to open circuit)
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);

    // Verify circuit not opened
    expect(mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    )).toBeUndefined();

    // Advance time by 60+ seconds (past reset window)
    (global as any).advanceTime(CIRCUIT_BREAKER_RESET_MS + 1000);

    // Clear logger mocks
    mockLogger.warn.mockClear();

    // Trigger another failure
    await enrichBiasFindings(mockGraph, mockFindings);

    // Circuit should NOT open (counter was reset, this is only the 1st failure)
    expect(mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    )).toBeUndefined();

    // Trigger 2 more failures in quick succession
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);

    // Now circuit should open (3 consecutive failures)
    const openedLog = mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    );
    expect(openedLog).toBeDefined();
    const openedLogEntry = openedLog as any;
    expect(openedLogEntry[0]).toMatchObject({
      event: 'isl.circuit_breaker.opened',
      consecutive_failures: CIRCUIT_BREAKER_THRESHOLD,
    });
  });

  it('should return unenriched findings when circuit is open', async () => {
    // Mock ISL to fail
    global.fetch = vi.fn().mockRejectedValue(new Error('Connection refused'));

    // Trigger 3 failures to open circuit
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);

    // Make call while circuit is open
    const result = await enrichBiasFindings(mockGraph, mockFindings);

    // Verify unenriched findings returned (graceful degradation)
    expect(result).toEqual(mockFindings);
    expect(result[0]).not.toHaveProperty('causal_validation');
    expect(result[0]).not.toHaveProperty('evidence_strength');
  });

  it('should handle ISL timeout errors in circuit breaker', async () => {
    // Mock ISL to timeout
    global.fetch = vi.fn().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('AbortError');
          error.name = 'AbortError';
          reject(error);
        }, 10);
      });
    });

    // Trigger 3 timeouts to open circuit
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);

    // Verify circuit opened
    const openedLog = mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    );
    expect(openedLog).toBeDefined();

    // Verify timeout events logged
    const timeoutLogs = mockLogger.warn.mock.calls.filter(
      (call: any) => call[0]?.event === 'cee.bias.causal_validation.timeout'
    );
    expect(timeoutLogs).toHaveLength(3);
  });

  it('should handle ISL validation errors in circuit breaker', async () => {
    // Mock ISL to return 400 errors
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid graph structure',
        },
      }),
    });

    // Trigger 3 errors to open circuit
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);
    await enrichBiasFindings(mockGraph, mockFindings);

    // Verify circuit opened
    const openedLog = mockLogger.warn.mock.calls.find(
      (call: any) => call[0]?.event === 'isl.circuit_breaker.opened'
    );
    expect(openedLog).toBeDefined();

    // Verify error events logged
    const errorLogs = mockLogger.warn.mock.calls.filter(
      (call: any) => call[0]?.event === 'cee.bias.causal_validation.error'
    );
    expect(errorLogs).toHaveLength(3);
  });
});
