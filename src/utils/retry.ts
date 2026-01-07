import { emit, TelemetryEvents } from "./telemetry.js";

/**
 * Retry configuration options
 */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffFactor: number;
  jitterPercent: number;
}

/**
 * Default retry configuration
 * - 3 attempts total (1 initial + 2 retries)
 * - Exponential backoff: 250ms, 500ms, 1000ms (with jitter)
 * - ±20% jitter to prevent thundering herd
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 5000,
  backoffFactor: 2,
  jitterPercent: 20,
};

/**
 * Error types that should trigger retries
 */
const RETRYABLE_ERROR_PATTERNS = [
  // Network/timeout errors
  /timeout/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /socket hang up/i,

  // Rate limit errors
  /rate.?limit/i,
  /too many requests/i,

  // Server overload errors
  /overloaded/i,
  /service unavailable/i,
  /temporarily unavailable/i,
];

/**
 * Check if an error is a schema validation failure from LLM response
 */
export function isSchemaValidationError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("_response_invalid_schema");
}

/**
 * Retry configuration for schema validation failures
 * - Only 1 retry (2 total attempts) to limit token burn
 * - Shorter delay since LLM may produce valid JSON on retry
 */
export const SCHEMA_VALIDATION_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 2,
  baseDelayMs: 100,
  maxDelayMs: 500,
  backoffFactor: 2,
  jitterPercent: 20,
};

/**
 * HTTP status codes that should trigger retries
 */
const RETRYABLE_STATUS_CODES = new Set([
  408, // Request Timeout
  429, // Too Many Requests
  500, // Internal Server Error
  502, // Bad Gateway
  503, // Service Unavailable
  504, // Gateway Timeout
]);

/**
 * Check if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Check HTTP status codes
  const err = error as any;
  if (err.status && RETRYABLE_STATUS_CODES.has(err.status)) {
    return true;
  }
  if (err.statusCode && RETRYABLE_STATUS_CODES.has(err.statusCode)) {
    return true;
  }

  // Check error messages
  const message = err.message || String(error);
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Calculate delay with exponential backoff and jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  // Exponential backoff: baseDelay * (backoffFactor ^ (attempt - 1))
  const exponentialDelay = config.baseDelayMs * Math.pow(config.backoffFactor, attempt - 1);

  // Cap at maxDelay
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs);

  // Add jitter: ±jitterPercent
  const jitterRange = (cappedDelay * config.jitterPercent) / 100;
  const jitter = Math.random() * jitterRange * 2 - jitterRange;

  return Math.max(0, Math.floor(cappedDelay + jitter));
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a function with automatic retries
 *
 * @param fn Function to execute (should throw on error)
 * @param context Context for telemetry (adapter name, model, etc.)
 * @param config Retry configuration
 * @returns Result of successful execution
 * @throws Last error if all attempts fail
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  context: { adapter: string; model: string; operation: string },
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      const result = await fn();

      // Success - emit telemetry if this wasn't first attempt
      if (attempt > 1) {
        emit(TelemetryEvents.LlmRetrySuccess, {
          adapter: context.adapter,
          model: context.model,
          operation: context.operation,
          attempt,
          total_attempts: attempt,
        });
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if error is retryable
      if (!isRetryableError(error)) {
        // Not retryable - fail immediately
        throw error;
      }

      // Check if we should retry
      if (attempt >= config.maxAttempts) {
        // No more attempts - fail
        emit(TelemetryEvents.LlmRetryExhausted, {
          adapter: context.adapter,
          model: context.model,
          operation: context.operation,
          total_attempts: attempt,
          error_message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      // Emit retry telemetry
      const delay = calculateBackoffDelay(attempt, config);
      const errorMessage = error instanceof Error ? error.message : String(error);

      emit(TelemetryEvents.LlmRetry, {
        adapter: context.adapter,
        model: context.model,
        operation: context.operation,
        attempt,
        max_attempts: config.maxAttempts,
        delay_ms: delay,
        reason: errorMessage.substring(0, 100), // Truncate for safety
      });

      // Wait before retrying
      await sleep(delay);
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}
