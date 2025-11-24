/**
 * ISL (Inference & Structure Learning) Client
 *
 * Client for communicating with the ISL service to perform causal validation
 * of bias findings.
 */

import type {
  ISLBiasValidateRequest,
  ISLBiasValidateResponse,
  ISLClientConfig,
  ISLError,
} from './types.js';
import { logger } from '../../utils/simple-logger.js';

/**
 * ISL Client for causal validation
 */
export class ISLClient {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly apiKey?: string;

  constructor(config: ISLClientConfig) {
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout ?? 2000; // Default 2s timeout
    this.maxRetries = config.maxRetries ?? 0; // No retries by default
    this.apiKey = config.apiKey;
  }

  /**
   * Validate bias findings using causal inference
   *
   * @param request - Validation request with graph and bias findings
   * @returns Validated bias findings with causal analysis
   * @throws ISLError if validation fails
   */
  async validateBias(
    request: ISLBiasValidateRequest,
  ): Promise<ISLBiasValidateResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest<ISLBiasValidateResponse>(
        '/isl/v1/bias-validate',
        {
          method: 'POST',
          body: JSON.stringify(request),
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { 'X-ISL-API-Key': this.apiKey } : {}),
          },
        },
      );

      const latency = Date.now() - startTime;

      logger.info({
        event: 'isl.bias_validate.success',
        request_id: response.request_id,
        validations_count: response.validations.length,
        latency_ms: latency,
        isl_latency_ms: response.latency_ms,
      });

      return response;
    } catch (error) {
      const latency = Date.now() - startTime;

      logger.warn({
        event: 'isl.bias_validate.failed',
        error: error instanceof Error ? error.message : String(error),
        latency_ms: latency,
      });

      throw error;
    }
  }

  /**
   * Make HTTP request to ISL service with timeout and retries
   */
  private async makeRequest<T>(
    path: string,
    options: RequestInit,
    attempt = 0,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as ISLError;
        throw new ISLValidationError(
          errorBody.error?.message ?? `ISL request failed: ${response.status}`,
          response.status,
          errorBody.error?.code,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      clearTimeout(timeoutId);

      // Handle timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ISLTimeoutError(
          `ISL request timed out after ${this.timeout}ms`,
        );
      }

      // Retry on network errors
      if (
        attempt < this.maxRetries &&
        error instanceof Error &&
        (error.message.includes('ECONNREFUSED') ||
          error.message.includes('ETIMEDOUT'))
      ) {
        logger.warn({
          event: 'isl.retry',
          attempt: attempt + 1,
          max_retries: this.maxRetries,
          error: error.message,
        });

        // Exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 100),
        );
        return this.makeRequest<T>(path, options, attempt + 1);
      }

      throw error;
    }
  }
}

/**
 * ISL validation error
 */
export class ISLValidationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorCode?: string,
  ) {
    super(message);
    this.name = 'ISLValidationError';
  }
}

/**
 * ISL timeout error
 */
export class ISLTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ISLTimeoutError';
  }
}

/**
 * Parse and validate timeout from env, with fallback and clamping
 */
function parseTimeout(envValue: string | undefined, defaultValue: number): number {
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
function parseMaxRetries(envValue: string | undefined, defaultValue: number): number {
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
 * Create ISL client from environment configuration
 */
export function createISLClient(): ISLClient | null {
  const baseUrl = process.env.ISL_BASE_URL;

  if (!baseUrl) {
    logger.debug({
      event: 'isl.client.disabled',
      reason: 'ISL_BASE_URL not configured',
    });
    return null;
  }

  return new ISLClient({
    baseUrl,
    timeout: parseTimeout(process.env.ISL_TIMEOUT_MS, 5000),
    maxRetries: parseMaxRetries(process.env.ISL_MAX_RETRIES, 1),
    apiKey: process.env.ISL_API_KEY,
  });
}
