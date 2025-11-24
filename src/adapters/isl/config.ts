import { logger } from '../../utils/simple-logger.js';

/**
 * ISL Configuration Module
 *
 * Centralizes ISL (Inference & Structure Learning) configuration parsing,
 * validation, and feature flag checks. Used by both the ISL client and
 * monitoring endpoints to ensure consistent configuration reporting.
 */

/**
 * Parse and validate timeout from env, with fallback and clamping
 */
export function parseTimeout(envValue: string | undefined, defaultValue: number): number {
  if (!envValue) {
    return defaultValue;
  }

  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed <= 0) {
    logger.warn({
      event: 'isl.config.invalid_timeout',
      value: envValue,
      using_default: defaultValue,
    });
    return defaultValue;
  }

  // Clamp to reasonable range: 100ms to 30s
  const MIN_TIMEOUT = 100;
  const MAX_TIMEOUT = 30000;
  return Math.max(MIN_TIMEOUT, Math.min(MAX_TIMEOUT, parsed));
}

/**
 * Parse and validate max retries from env, with fallback
 */
export function parseMaxRetries(envValue: string | undefined, defaultValue: number): number {
  if (!envValue) {
    return defaultValue;
  }

  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed < 0) {
    logger.warn({
      event: 'isl.config.invalid_max_retries',
      value: envValue,
      using_default: defaultValue,
    });
    return defaultValue;
  }

  // Clamp to reasonable range: 0 to 5
  return Math.min(5, parsed);
}

/**
 * Check if causal validation is enabled via feature flag
 *
 * Accepts both "true" and "1" as enabled values for flexibility.
 */
export function causalValidationEnabled(): boolean {
  const flag = process.env.CEE_CAUSAL_VALIDATION_ENABLED;
  if (flag === undefined) {
    return false;
  }
  return flag === 'true' || flag === '1';
}

/**
 * ISL effective configuration
 */
export interface ISLConfig {
  /** Whether causal validation is enabled via feature flag */
  enabled: boolean;
  /** Whether ISL client can be created (ISL_BASE_URL is configured) */
  configured: boolean;
  /** ISL service base URL (if configured) */
  baseUrl: string | undefined;
  /** Effective timeout in milliseconds (validated and clamped) */
  timeout: number;
  /** Effective max retry attempts (validated and clamped) */
  maxRetries: number;
}

/**
 * Get effective ISL configuration
 *
 * Returns the validated, clamped configuration values that will actually
 * be used by the ISL client. Use this for both client instantiation and
 * monitoring/health endpoints to ensure consistent reporting.
 *
 * Default values: 5000ms timeout, 1 retry (production canary settings)
 */
export function getISLConfig(): ISLConfig {
  const baseUrl = process.env.ISL_BASE_URL;

  return {
    enabled: causalValidationEnabled(),
    configured: baseUrl !== undefined && baseUrl.trim().length > 0,
    baseUrl: baseUrl,
    timeout: parseTimeout(process.env.ISL_TIMEOUT_MS, 5000),
    maxRetries: parseMaxRetries(process.env.ISL_MAX_RETRIES, 1),
  };
}
