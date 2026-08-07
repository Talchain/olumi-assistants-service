/**
 * Provider circuit breaker — SALVAGED, INERT (nothing imports this module).
 *
 * Origin: PR #25 (v1.5 "Circuit Breaker Pattern for Multi-Provider Failover"),
 * closed unmerged. Salvaged 2026-07-19.
 *
 * WHAT IT IS FOR. `src/adapters/llm/failover.ts` has **zero failure memory**:
 * `FailoverAdapter` walks its provider chain from index 0 on every single
 * call, so a hard-down primary is re-tried, and re-times-out, on every request
 * for as long as it stays down. This module is the missing piece — per-provider
 * CLOSED / OPEN / HALF_OPEN health state, so a provider that has just failed N
 * times in a row is skipped until a timeout elapses and it earns its way back.
 * The same shape already exists in-repo for the ISL client, so this is a
 * known-good pattern here rather than a novel one.
 *
 * WIRING IS DEFERRED AND ROWED — DO NOT WIRE THIS IN AS A DRIVE-BY. Making
 * `withFailover` consult these functions changes which provider serves a
 * request and is therefore a live behaviour change on every LLM call in the
 * service. It needs its own lane, its own soak, and its own authorisation.
 *
 * ONE THING THE WIRING LANE MUST DECIDE, NOT INHERIT: state lives in a
 * module-level `Map`, so it is per-process, lost on restart, and shared across
 * every caller in the process. Confirm that is the intended blast radius
 * before wiring.
 *
 * This module is a faithful copy of PR #25 with exactly ONE deviation, made at
 * salvage and documented at `DEFAULT_CONFIG` below: #25's three
 * `process.env.CIRCUIT_BREAKER_*` reads were replaced with the same values as
 * unconditional constants. Nothing else was changed.
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

/**
 * DEVIATION FROM PR #25, made at salvage (2026-07-19) — the only one.
 *
 * PR #25 read these three values from `CIRCUIT_BREAKER_FAILURE_THRESHOLD`,
 * `CIRCUIT_BREAKER_SUCCESS_THRESHOLD` and `CIRCUIT_BREAKER_TIMEOUT_MS` at
 * module load, falling back to the same numbers below. That is a lint error in
 * this repo (`no-restricted-syntax`: direct `process.env` access is banned
 * outside `src/config/index.ts`) and it is contrary to house preference on new
 * env-var gates, so the reads were replaced with unconditional constants. The
 * VALUES are unchanged — these are #25's own defaults.
 *
 * If the wiring lane decides these must be configurable, route them through
 * `src/config/index.ts` rather than restoring the raw `process.env` reads.
 */
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  successThreshold: 2,
  timeout: 30_000, // 30 seconds
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
  // Accepted for signature symmetry with recordSuccess/recordFailure; the
  // OPEN -> HALF_OPEN transition below is driven by the already-stored
  // nextRetryTime, so no config value is read here.
  _config: CircuitBreakerConfig = DEFAULT_CONFIG
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
