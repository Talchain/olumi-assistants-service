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
  ISLConformalRequest,
  ISLConformalResponse,
  ISLContrastiveRequest,
  ISLContrastiveResponse,
  ISLError,
  ISLSensitivityRequest,
  ISLSensitivityResponse,
  ISLValidationStrategiesRequest,
  ISLValidationStrategiesResponse,
} from './types.js';
import { logger } from '../../utils/simple-logger.js';
import { parseTimeout, parseMaxRetries } from './config.js';
import { config } from '../../config/index.js';

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
    this.timeout = config.timeout ?? 5000; // Default 5s timeout (production canary setting)
    this.maxRetries = config.maxRetries ?? 1; // Default 1 retry (production canary setting)
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
   * Get detailed sensitivity analysis for graph nodes
   *
   * @param request - Sensitivity analysis request
   * @returns Detailed sensitivity scores and contributing factors
   * @throws ISLError if analysis fails
   */
  async getSensitivityDetailed(
    request: ISLSensitivityRequest,
  ): Promise<ISLSensitivityResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest<ISLSensitivityResponse>(
        '/isl/v1/sensitivity',
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
        event: 'isl.sensitivity.success',
        request_id: response.request_id,
        nodes_analyzed: response.sensitivities.length,
        avg_sensitivity: response.summary.avg_sensitivity,
        latency_ms: latency,
        isl_latency_ms: response.latency_ms,
      });

      return response;
    } catch (error) {
      const latency = Date.now() - startTime;

      logger.warn({
        event: 'isl.sensitivity.failed',
        error: error instanceof Error ? error.message : String(error),
        latency_ms: latency,
      });

      throw error;
    }
  }

  /**
   * Get contrastive explanation for a decision
   *
   * @param request - Contrastive explanation request
   * @returns Contrast points explaining why decision differs from alternative
   * @throws ISLError if explanation fails
   */
  async getContrastiveExplanation(
    request: ISLContrastiveRequest,
  ): Promise<ISLContrastiveResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest<ISLContrastiveResponse>(
        '/isl/v1/contrastive',
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
        event: 'isl.contrastive.success',
        request_id: response.request_id,
        decision_node: response.decision_node_id,
        contrast_count: response.contrasts.length,
        latency_ms: latency,
        isl_latency_ms: response.latency_ms,
      });

      return response;
    } catch (error) {
      const latency = Date.now() - startTime;

      logger.warn({
        event: 'isl.contrastive.failed',
        error: error instanceof Error ? error.message : String(error),
        latency_ms: latency,
      });

      throw error;
    }
  }

  /**
   * Get conformal prediction intervals for quantitative predictions
   *
   * @param request - Conformal prediction request
   * @returns Prediction intervals with calibration metrics
   * @throws ISLError if prediction fails
   */
  async getConformalPrediction(
    request: ISLConformalRequest,
  ): Promise<ISLConformalResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest<ISLConformalResponse>(
        '/isl/v1/conformal',
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
        event: 'isl.conformal.success',
        request_id: response.request_id,
        intervals_count: response.intervals.length,
        calibration_reliable: response.calibration.is_reliable,
        latency_ms: latency,
        isl_latency_ms: response.latency_ms,
      });

      return response;
    } catch (error) {
      const latency = Date.now() - startTime;

      logger.warn({
        event: 'isl.conformal.failed',
        error: error instanceof Error ? error.message : String(error),
        latency_ms: latency,
      });

      throw error;
    }
  }

  /**
   * Get recommended validation strategies for the graph
   *
   * @param request - Validation strategies request
   * @returns Prioritized validation strategies with coverage analysis
   * @throws ISLError if strategy generation fails
   */
  async getValidationStrategies(
    request: ISLValidationStrategiesRequest,
  ): Promise<ISLValidationStrategiesResponse> {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest<ISLValidationStrategiesResponse>(
        '/isl/v1/validation-strategies',
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
        event: 'isl.validation_strategies.success',
        request_id: response.request_id,
        strategies_count: response.strategies.length,
        node_coverage: response.coverage.node_coverage,
        risk_coverage: response.coverage.risk_coverage,
        latency_ms: latency,
        isl_latency_ms: response.latency_ms,
      });

      return response;
    } catch (error) {
      const latency = Date.now() - startTime;

      logger.warn({
        event: 'isl.validation_strategies.failed',
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
    options: globalThis.RequestInit,
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

      // Retry on transient network errors
      // Covers Node.js fetch/undici error messages across different runtimes
      const isRetryableNetworkError =
        error instanceof Error &&
        (error.message.includes('ECONNREFUSED') ||
          error.message.includes('ETIMEDOUT') ||
          error.message.includes('ENOTFOUND') ||
          error.message.includes('ENETUNREACH') ||
          error.message.includes('ECONNRESET') ||
          error.message.includes('EHOSTUNREACH') ||
          error.message.includes('fetch failed') ||
          error.message.includes('UND_ERR_CONNECT_TIMEOUT') ||
          error.message.includes('socket hang up') ||
          error.name === 'TypeError' && error.message.includes('fetch'));

      if (attempt < this.maxRetries && isRetryableNetworkError) {
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
 * Create ISL client from centralized configuration
 */
export function createISLClient(): ISLClient | null {
  const baseUrl = config.isl.baseUrl;

  if (!baseUrl) {
    logger.debug({
      event: 'isl.client.disabled',
      reason: 'ISL_BASE_URL not configured',
    });
    return null;
  }

  return new ISLClient({
    baseUrl,
    timeout: parseTimeout(config.isl.timeoutMs, 5000),
    maxRetries: parseMaxRetries(config.isl.maxRetries, 1),
    apiKey: config.isl.apiKey,
  });
}
