/**
 * v1.5 PR M: Multi-Provider Failover
 *
 * Circuit breaker pattern for automatic provider failover.
 * Tracks provider health and routes to backup when primary fails.
 *
 * States:
 * - CLOSED: Normal operation, requests go to primary
 * - OPEN: Circuit tripped, requests go to fallback
 * - HALF_OPEN: Testing if primary recovered
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  failureThreshold: number; // Failures before opening circuit
  successThreshold: number; // Successes before closing circuit
  timeout: number; // Milliseconds before retry (OPEN → HALF_OPEN)
}

export interface CircuitBreakerState {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  nextRetryTime: number | null;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: Number(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD) || 3,
  successThreshold: Number(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD) || 2,
  timeout: Number(process.env.CIRCUIT_BREAKER_TIMEOUT_MS) || 30000, // 30 seconds
};

// Track circuit state per provider
const circuits = new Map<string, CircuitBreakerState>();

/**
 * Get or create circuit breaker state for a provider
 */
export function getCircuitState(providerId: string): CircuitBreakerState {
  if (!circuits.has(providerId)) {
    circuits.set(providerId, {
      state: "CLOSED",
      failures: 0,
      successes: 0,
      lastFailureTime: null,
      nextRetryTime: null,
    });
  }
  return circuits.get(providerId)!;
}

/**
 * Check if circuit allows request (not OPEN, or OPEN but timeout expired)
 */
export function isCircuitClosed(
  providerId: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG
): boolean {
  const circuit = getCircuitState(providerId);
  const now = Date.now();

  if (circuit.state === "CLOSED") {
    return true;
  }

  if (circuit.state === "OPEN") {
    // Check if timeout expired, transition to HALF_OPEN
    if (circuit.nextRetryTime && now >= circuit.nextRetryTime) {
      circuit.state = "HALF_OPEN";
      circuit.successes = 0;
      return true;
    }
    return false;
  }

  if (circuit.state === "HALF_OPEN") {
    return true;
  }

  return false;
}

/**
 * Record successful request
 */
export function recordSuccess(
  providerId: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG
): void {
  const circuit = getCircuitState(providerId);

  if (circuit.state === "HALF_OPEN") {
    circuit.successes++;

    // Enough successes to close circuit
    if (circuit.successes >= config.successThreshold) {
      circuit.state = "CLOSED";
      circuit.failures = 0;
      circuit.successes = 0;
      circuit.lastFailureTime = null;
      circuit.nextRetryTime = null;
    }
  } else if (circuit.state === "CLOSED") {
    // Reset failure count on success
    circuit.failures = 0;
  }
}

/**
 * Record failed request
 */
export function recordFailure(
  providerId: string,
  config: CircuitBreakerConfig = DEFAULT_CONFIG
): void {
  const circuit = getCircuitState(providerId);
  const now = Date.now();

  circuit.failures++;
  circuit.lastFailureTime = now;

  if (circuit.state === "HALF_OPEN") {
    // Failed during test, reopen circuit
    circuit.state = "OPEN";
    circuit.nextRetryTime = now + config.timeout;
    circuit.successes = 0;
  } else if (circuit.state === "CLOSED") {
    // Check if threshold exceeded
    if (circuit.failures >= config.failureThreshold) {
      circuit.state = "OPEN";
      circuit.nextRetryTime = now + config.timeout;
    }
  }
}

/**
 * Reset circuit breaker state (for testing)
 */
export function resetCircuit(providerId: string): void {
  circuits.delete(providerId);
}

/**
 * Reset all circuits (for testing)
 */
export function resetAllCircuits(): void {
  circuits.clear();
}

/**
 * Get circuit breaker statistics
 */
export function getCircuitStats(providerId: string): {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureTime: number | null;
  nextRetryTime: number | null;
  timeUntilRetry: number | null;
} {
  const circuit = getCircuitState(providerId);
  const now = Date.now();

  return {
    ...circuit,
    timeUntilRetry:
      circuit.nextRetryTime ? Math.max(0, circuit.nextRetryTime - now) : null,
  };
}
