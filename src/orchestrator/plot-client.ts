/**
 * PLoT (Plot Lite) Client
 *
 * CEE→PLoT HTTP client for analysis runs and patch validation.
 * Modelled on the ISL client pattern (fetch + AbortController + retry).
 *
 * Endpoints:
 * - POST /v2/run — run Monte Carlo analysis
 * - POST /v1/validate-patch — validate graph patches
 */

import { config } from "../config/index.js";
import { PLOT_RUN_TIMEOUT_MS, PLOT_VALIDATE_TIMEOUT_MS } from "../config/timeouts.js";
import { log } from "../utils/telemetry.js";
import type { V2RunResponseEnvelope, OrchestratorError } from "./types.js";

// ============================================================================
// Error Types
// ============================================================================

export class PLoTError extends Error {
  readonly name = "PLoTError";

  constructor(
    message: string,
    public readonly status: number,
    public readonly operation: string,
    public readonly elapsedMs: number,
    public readonly requestId?: string,
  ) {
    super(message);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PLoTError);
    }
  }

  toOrchestratorError(): OrchestratorError {
    return {
      code: 'TOOL_EXECUTION_FAILED',
      message: this.message,
      tool: 'run_analysis',
      recoverable: this.status >= 500,
      suggested_retry: this.status >= 500 ? 'Try running the analysis again.' : undefined,
    };
  }
}

export class PLoTTimeoutError extends Error {
  readonly name = "PLoTTimeoutError";

  constructor(
    message: string,
    public readonly operation: string,
    public readonly timeoutMs: number,
    public readonly elapsedMs: number,
  ) {
    super(message);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PLoTTimeoutError);
    }
  }

  toOrchestratorError(): OrchestratorError {
    return {
      code: 'TOOL_EXECUTION_FAILED',
      message: `PLoT ${this.operation} timed out after ${this.elapsedMs}ms`,
      tool: 'run_analysis',
      recoverable: true,
      suggested_retry: 'Try running the analysis again.',
    };
  }
}

// ============================================================================
// Client
// ============================================================================

export interface PLoTClient {
  run(payload: Record<string, unknown>, requestId: string): Promise<V2RunResponseEnvelope>;
  validatePatch(payload: Record<string, unknown>, requestId: string): Promise<unknown>;
}

class PLoTClientImpl implements PLoTClient {
  constructor(private readonly baseUrl: string) {}

  async run(payload: Record<string, unknown>, requestId: string): Promise<V2RunResponseEnvelope> {
    return this.makeRequest<V2RunResponseEnvelope>(
      '/v2/run',
      payload,
      requestId,
      PLOT_RUN_TIMEOUT_MS,
      'run',
    );
  }

  async validatePatch(payload: Record<string, unknown>, requestId: string): Promise<unknown> {
    return this.makeRequest(
      '/v1/validate-patch',
      payload,
      requestId,
      PLOT_VALIDATE_TIMEOUT_MS,
      'validate_patch',
    );
  }

  private async makeRequest<T>(
    path: string,
    payload: Record<string, unknown>,
    requestId: string,
    timeoutMs: number,
    operation: string,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    log.info(
      { url: path, request_id: requestId, timeout_ms: timeoutMs },
      `PLoT ${operation} request`,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Id': requestId,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startTime;

      if (!response.ok) {
        const body = await response.text().catch(() => 'unknown');
        log.error(
          { status: response.status, elapsed_ms: elapsedMs, request_id: requestId, body_preview: body.slice(0, 500) },
          `PLoT ${operation} failed`,
        );
        throw new PLoTError(
          `PLoT ${operation} returned ${response.status}: ${body.slice(0, 200)}`,
          response.status,
          operation,
          elapsedMs,
          requestId,
        );
      }

      const data = await response.json() as T;

      log.info(
        { elapsed_ms: elapsedMs, request_id: requestId },
        `PLoT ${operation} success`,
      );

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startTime;

      if (error instanceof PLoTError) throw error;

      if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted)) {
        log.error(
          { timeout_ms: timeoutMs, elapsed_ms: elapsedMs, request_id: requestId },
          `PLoT ${operation} timed out`,
        );
        throw new PLoTTimeoutError(
          `PLoT ${operation} timed out after ${elapsedMs}ms`,
          operation,
          timeoutMs,
          elapsedMs,
        );
      }

      log.error(
        { error, elapsed_ms: elapsedMs, request_id: requestId },
        `PLoT ${operation} failed`,
      );
      throw error;
    }
  }
}

/**
 * Create a PLoT client if configured, or null if PLOT_BASE_URL is not set.
 */
export function createPLoTClient(): PLoTClient | null {
  const baseUrl = config.plot.baseUrl;
  if (!baseUrl) {
    log.info({}, "PLoT client not configured (PLOT_BASE_URL not set)");
    return null;
  }
  log.info({ base_url: baseUrl }, "PLoT client configured");
  return new PLoTClientImpl(baseUrl);
}
