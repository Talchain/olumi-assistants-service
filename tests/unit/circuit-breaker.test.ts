import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getCircuitState,
  isCircuitClosed,
  recordSuccess,
  recordFailure,
  resetCircuit,
  resetAllCircuits,
  getCircuitStats,
  type CircuitBreakerConfig,
} from "../../src/utils/circuit-breaker.js";

describe("circuit-breaker", () => {
  beforeEach(() => {
    resetAllCircuits();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getCircuitState()", () => {
    it("should initialize circuit in CLOSED state", () => {
      const state = getCircuitState("test-provider");

      expect(state.state).toBe("CLOSED");
      expect(state.failures).toBe(0);
      expect(state.successes).toBe(0);
      expect(state.lastFailureTime).toBeNull();
      expect(state.nextRetryTime).toBeNull();
    });

    it("should reuse existing circuit state", () => {
      const state1 = getCircuitState("test-provider");
      state1.failures = 5;

      const state2 = getCircuitState("test-provider");
      expect(state2.failures).toBe(5);
      expect(state1).toBe(state2); // Same object
    });
  });

  describe("isCircuitClosed()", () => {
    it("should return true for CLOSED circuit", () => {
      expect(isCircuitClosed("test-provider")).toBe(true);
    });

    it("should return false for OPEN circuit within timeout", () => {
      const config: CircuitBreakerConfig = {
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 10000,
      };

      // Trip circuit
      recordFailure("test-provider", config);
      recordFailure("test-provider", config);
      recordFailure("test-provider", config);

      expect(isCircuitClosed("test-provider", config)).toBe(false);
    });

    it("should transition to HALF_OPEN after timeout", () => {
      const config: CircuitBreakerConfig = {
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 10000,
      };

      // Trip circuit
      recordFailure("test-provider", config);
      recordFailure("test-provider", config);

      // Should be OPEN
      expect(isCircuitClosed("test-provider", config)).toBe(false);

      // Advance time past timeout
      vi.advanceTimersByTime(10001);

      // Should transition to HALF_OPEN and allow request
      expect(isCircuitClosed("test-provider", config)).toBe(true);
      const state = getCircuitState("test-provider");
      expect(state.state).toBe("HALF_OPEN");
    });
  });

  describe("recordSuccess()", () => {
    it("should reset failure count in CLOSED state", () => {
      const config: CircuitBreakerConfig = {
        failureThreshold: 5,
        successThreshold: 2,
        timeout: 10000,
      };

      recordFailure("test-provider", config);
      recordFailure("test-provider", config);

      const state1 = getCircuitState("test-provider");
      expect(state1.failures).toBe(2);

      recordSuccess("test-provider", config);

      const state2 = getCircuitState("test-provider");
      expect(state2.failures).toBe(0);
    });

    it("should close circuit after enough successes in HALF_OPEN", () => {
      const config: CircuitBreakerConfig = {
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 10000,
      };

      // Trip circuit
      recordFailure("test-provider", config);
      recordFailure("test-provider", config);

      // Advance to HALF_OPEN
      vi.advanceTimersByTime(10001);
      isCircuitClosed("test-provider", config);

      // Record successes
      recordSuccess("test-provider", config);
      const state1 = getCircuitState("test-provider");
      expect(state1.state).toBe("HALF_OPEN");
      expect(state1.successes).toBe(1);

      recordSuccess("test-provider", config);
      const state2 = getCircuitState("test-provider");
      expect(state2.state).toBe("CLOSED");
      expect(state2.failures).toBe(0);
      expect(state2.successes).toBe(0);
    });
  });

  describe("recordFailure()", () => {
    it("should increment failure count", () => {
      recordFailure("test-provider");

      const state = getCircuitState("test-provider");
      expect(state.failures).toBe(1);
      expect(state.lastFailureTime).toBeGreaterThan(0);
    });

    it("should open circuit after reaching threshold", () => {
      const config: CircuitBreakerConfig = {
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 10000,
      };

      recordFailure("test-provider", config);
      recordFailure("test-provider", config);

      let state = getCircuitState("test-provider");
      expect(state.state).toBe("CLOSED");

      recordFailure("test-provider", config);

      state = getCircuitState("test-provider");
      expect(state.state).toBe("OPEN");
      expect(state.nextRetryTime).toBeGreaterThan(0);
    });

    it("should reopen circuit on failure in HALF_OPEN", () => {
      const config: CircuitBreakerConfig = {
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 10000,
      };

      // Trip circuit
      recordFailure("test-provider", config);
      recordFailure("test-provider", config);

      // Advance to HALF_OPEN
      vi.advanceTimersByTime(10001);
      isCircuitClosed("test-provider", config);

      const state1 = getCircuitState("test-provider");
      expect(state1.state).toBe("HALF_OPEN");

      // Fail during test
      recordFailure("test-provider", config);

      const state2 = getCircuitState("test-provider");
      expect(state2.state).toBe("OPEN");
    });
  });

  describe("resetCircuit()", () => {
    it("should remove circuit state", () => {
      recordFailure("test-provider");

      let state = getCircuitState("test-provider");
      expect(state.failures).toBe(1);

      resetCircuit("test-provider");

      state = getCircuitState("test-provider");
      expect(state.failures).toBe(0);
      expect(state.state).toBe("CLOSED");
    });
  });

  describe("resetAllCircuits()", () => {
    it("should reset all circuit states", () => {
      recordFailure("provider-A");
      recordFailure("provider-B");

      resetAllCircuits();

      const stateA = getCircuitState("provider-A");
      const stateB = getCircuitState("provider-B");

      expect(stateA.failures).toBe(0);
      expect(stateB.failures).toBe(0);
    });
  });

  describe("getCircuitStats()", () => {
    it("should return circuit statistics", () => {
      const config: CircuitBreakerConfig = {
        failureThreshold: 2,
        successThreshold: 2,
        timeout: 10000,
      };

      recordFailure("test-provider", config);
      recordFailure("test-provider", config);

      const stats = getCircuitStats("test-provider");

      expect(stats.state).toBe("OPEN");
      expect(stats.failures).toBe(2);
      expect(stats.timeUntilRetry).toBeGreaterThan(0);
      expect(stats.timeUntilRetry).toBeLessThanOrEqual(10000);
    });

    it("should return null timeUntilRetry for CLOSED circuit", () => {
      const stats = getCircuitStats("test-provider");

      expect(stats.state).toBe("CLOSED");
      expect(stats.timeUntilRetry).toBeNull();
    });
  });
});
