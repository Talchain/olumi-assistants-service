import { logger } from '../../utils/simple-logger.js';
import { config } from '../../config/index.js';
import { emit, TelemetryEvents } from '../../utils/telemetry.js';

/**
 * ISL Configuration Module
 *
 * Centralizes ISL (Inference & Structure Learning) configuration parsing,
 * validation, and feature flag checks. Used by both the ISL client and
 * monitoring endpoints to ensure consistent configuration reporting.
 */

/**
 * Config source tracking for observability
 */
export type ConfigSource = 'env' | 'default' | 'clamped';

interface ParseResult<T> {
  value: T;
  source: ConfigSource;
}

/**
 * Parse and validate timeout from env, with fallback and clamping.
 * Emits telemetry events for invalid or clamped values.
 */
export function parseTimeout(envValue: string | undefined, defaultValue: number): number {
  const result = parseTimeoutWithSource(envValue, defaultValue);
  return result.value;
}

/**
 * Parse timeout with source tracking for diagnostics
 */
export function parseTimeoutWithSource(envValue: string | undefined, defaultValue: number): ParseResult<number> {
  if (!envValue) {
    return { value: defaultValue, source: 'default' };
  }

  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed <= 0) {
    logger.warn({
      event: 'isl.config.invalid_timeout',
      value: envValue,
      using_default: defaultValue,
    });
    emit(TelemetryEvents.IslConfigInvalidTimeout, {
      raw_value: envValue,
      fallback_value: defaultValue,
    });
    return { value: defaultValue, source: 'default' };
  }

  // Clamp to reasonable range: 100ms to 30s
  const MIN_TIMEOUT = 100;
  const MAX_TIMEOUT = 30000;
  const clamped = Math.max(MIN_TIMEOUT, Math.min(MAX_TIMEOUT, parsed));

  if (clamped !== parsed) {
    logger.warn({
      event: 'isl.config.timeout_clamped',
      original: parsed,
      clamped: clamped,
      min: MIN_TIMEOUT,
      max: MAX_TIMEOUT,
    });
    emit(TelemetryEvents.IslConfigTimeoutClamped, {
      original_value: parsed,
      clamped_value: clamped,
      min_allowed: MIN_TIMEOUT,
      max_allowed: MAX_TIMEOUT,
    });
    return { value: clamped, source: 'clamped' };
  }

  return { value: parsed, source: 'env' };
}

/**
 * Parse and validate max retries from env, with fallback.
 * Emits telemetry events for invalid or clamped values.
 */
export function parseMaxRetries(envValue: string | undefined, defaultValue: number): number {
  const result = parseMaxRetriesWithSource(envValue, defaultValue);
  return result.value;
}

/**
 * Parse max retries with source tracking for diagnostics
 */
export function parseMaxRetriesWithSource(envValue: string | undefined, defaultValue: number): ParseResult<number> {
  if (!envValue) {
    return { value: defaultValue, source: 'default' };
  }

  const parsed = parseInt(envValue, 10);
  if (isNaN(parsed) || parsed < 0) {
    logger.warn({
      event: 'isl.config.invalid_max_retries',
      value: envValue,
      using_default: defaultValue,
    });
    emit(TelemetryEvents.IslConfigInvalidMaxRetries, {
      raw_value: envValue,
      fallback_value: defaultValue,
    });
    return { value: defaultValue, source: 'default' };
  }

  // Clamp to reasonable range: 0 to 5
  const MAX_RETRIES = 5;
  const clamped = Math.min(MAX_RETRIES, parsed);

  if (clamped !== parsed) {
    logger.warn({
      event: 'isl.config.retries_clamped',
      original: parsed,
      clamped: clamped,
      max: MAX_RETRIES,
    });
    emit(TelemetryEvents.IslConfigRetriesClamped, {
      original_value: parsed,
      clamped_value: clamped,
      max_allowed: MAX_RETRIES,
    });
    return { value: clamped, source: 'clamped' };
  }

  return { value: parsed, source: 'env' };
}

/**
 * Check if causal validation is enabled via feature flag
 *
 * Uses type-safe config module for boolean coercion.
 */
export function causalValidationEnabled(): boolean {
  return config.cee.causalValidationEnabled;
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
  /** Source tracking for diagnostics */
  sources: {
    timeout: ConfigSource;
    maxRetries: ConfigSource;
  };
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
  const baseUrl = config.isl.baseUrl;
  const timeoutResult = parseTimeoutWithSource(config.isl.timeoutMs, 5000);
  const retriesResult = parseMaxRetriesWithSource(config.isl.maxRetries, 1);

  return {
    enabled: causalValidationEnabled(),
    configured: baseUrl !== undefined && baseUrl.trim().length > 0,
    baseUrl: baseUrl,
    timeout: timeoutResult.value,
    maxRetries: retriesResult.value,
    sources: {
      timeout: timeoutResult.source,
      maxRetries: retriesResult.source,
    },
  };
}
