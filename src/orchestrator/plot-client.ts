/**
 * PLoT (Plot Lite) Client
 *
 * CEE→PLoT HTTP client for analysis runs and patch validation.
 * Modelled on the ISL client pattern (fetch + AbortController + retry).
 *
 * Endpoints:
 * - POST /v2/run — run Monte Carlo analysis
 * - POST /v1/validate-patch — validate graph patches
 *
 * Auth: When PLOT_AUTH_TOKEN is set, attaches Authorization: Bearer <token>.
 *
 * Error handling:
 * - /v2/run 422 → V2RunError (unwrapped: { analysis_status, status_reason, critiques })
 * - /v2/run 4xx/5xx → error.v1 envelope ({ schema, code, message, retryable, source })
 * - /v1/validate-patch 422 → structured rejection (not an error — returned as data)
 * - /v1/validate-patch 501 → FEATURE_DISABLED (returned as typed result, not thrown)
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
// V2RunError — unwrapped 422 from /v2/run
// ============================================================================

export interface V2RunError {
  analysis_status: string;
  status_reason?: string;
  critiques?: Array<{ message?: string; [k: string]: unknown }>;
}

// ============================================================================
// ValidatePatch Result Types
// ============================================================================

export interface ValidatePatchSuccess {
  kind: 'success';
  data: Record<string, unknown>;
}

export interface ValidatePatchRejection {
  kind: 'rejection';
  status: string;
  code?: string;
  message?: string;
  violations?: unknown[];
}

export interface ValidatePatchFeatureDisabled {
  kind: 'feature_disabled';
}

export type ValidatePatchResult = ValidatePatchSuccess | ValidatePatchRejection | ValidatePatchFeatureDisabled;

// ============================================================================
// Client
// ============================================================================

export interface PLoTClient {
  run(payload: Record<string, unknown>, requestId: string): Promise<V2RunResponseEnvelope>;
  validatePatch(payload: Record<string, unknown>, requestId: string): Promise<ValidatePatchResult>;
}

class PLoTClientImpl implements PLoTClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string | undefined,
  ) {}

  async run(payload: Record<string, unknown>, requestId: string): Promise<V2RunResponseEnvelope> {
    const url = `${this.baseUrl}/v2/run`;
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PLOT_RUN_TIMEOUT_MS);

    log.info(
      { url: '/v2/run', request_id: requestId, timeout_ms: PLOT_RUN_TIMEOUT_MS },
      "PLoT run request",
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(requestId),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json() as V2RunResponseEnvelope;
        log.info({ elapsed_ms: elapsedMs, request_id: requestId }, "PLoT run success");
        return data;
      }

      // 422 → V2RunError (unwrapped — { analysis_status, status_reason, critiques })
      if (response.status === 422) {
        const body = await this.safeJson(response);
        const v2Err = body as V2RunError | null;

        const statusReason = v2Err?.status_reason ?? 'Unknown analysis error';
        const firstCritique = v2Err?.critiques?.[0]?.message;
        const errMsg = firstCritique
          ? `${statusReason}: ${firstCritique}`
          : statusReason;

        log.error(
          { status: 422, elapsed_ms: elapsedMs, request_id: requestId, analysis_status: v2Err?.analysis_status },
          "PLoT run 422 — V2RunError",
        );

        throw new PLoTError(
          `PLoT run analysis blocked: ${errMsg}`,
          422,
          'run',
          elapsedMs,
          requestId,
        );
      }

      // 4xx/5xx → error.v1 envelope ({ schema, code, message, retryable, source })
      const body = await this.safeJson(response);
      const errV1 = body as { message?: string; retryable?: boolean } | null;
      const errMsg = errV1?.message ?? `PLoT run returned ${response.status}`;

      log.error(
        { status: response.status, elapsed_ms: elapsedMs, request_id: requestId },
        "PLoT run failed",
      );

      const plotErr = new PLoTError(errMsg, response.status, 'run', elapsedMs, requestId);
      // Override recoverable based on retryable field from error.v1 envelope when available
      if (typeof errV1?.retryable === 'boolean') {
        const orchErr = plotErr.toOrchestratorError();
        orchErr.recoverable = errV1.retryable;
        Object.assign(plotErr, { _overriddenOrchestratorError: orchErr });
      }
      throw plotErr;
    } catch (error) {
      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startTime;

      if (error instanceof PLoTError) throw error;

      if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted)) {
        log.error(
          { timeout_ms: PLOT_RUN_TIMEOUT_MS, elapsed_ms: elapsedMs, request_id: requestId },
          "PLoT run timed out",
        );
        throw new PLoTTimeoutError("PLoT run timed out after " + elapsedMs + "ms", 'run', PLOT_RUN_TIMEOUT_MS, elapsedMs);
      }

      log.error(
        { error, elapsed_ms: elapsedMs, request_id: requestId },
        "PLoT run failed",
      );
      throw error;
    }
  }

  async validatePatch(payload: Record<string, unknown>, requestId: string): Promise<ValidatePatchResult> {
    const url = `${this.baseUrl}/v1/validate-patch`;
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PLOT_VALIDATE_TIMEOUT_MS);

    log.info(
      { url: '/v1/validate-patch', request_id: requestId, timeout_ms: PLOT_VALIDATE_TIMEOUT_MS },
      "PLoT validate_patch request",
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(requestId),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startTime;

      // 2xx → success
      if (response.ok) {
        const data = await response.json() as Record<string, unknown>;
        log.info({ elapsed_ms: elapsedMs, request_id: requestId }, "PLoT validate_patch success");
        return { kind: 'success', data };
      }

      // 501 → FEATURE_DISABLED (endpoint not available — NOT a rejection)
      if (response.status === 501) {
        log.warn(
          { elapsed_ms: elapsedMs, request_id: requestId },
          "PLoT validate_patch returned 501 FEATURE_DISABLED — semantic validation skipped",
        );
        return { kind: 'feature_disabled' };
      }

      // 422 → structured rejection (valid tool result, not an error)
      if (response.status === 422) {
        const body = await this.safeJson(response) as Record<string, unknown> | null;
        log.warn(
          { elapsed_ms: elapsedMs, request_id: requestId, code: body?.code },
          "PLoT validate_patch 422 — patch rejected",
        );
        return {
          kind: 'rejection',
          status: String(body?.status ?? 'rejected'),
          code: typeof body?.code === 'string' ? body.code : undefined,
          message: typeof body?.message === 'string' ? body.message : undefined,
          violations: Array.isArray(body?.violations) ? body.violations : undefined,
        };
      }

      // Other 4xx/5xx → throw PLoTError
      const body = await response.text().catch(() => 'unknown');
      log.error(
        { status: response.status, elapsed_ms: elapsedMs, request_id: requestId, body_preview: body.slice(0, 500) },
        "PLoT validate_patch failed",
      );
      throw new PLoTError(
        `PLoT validate_patch returned ${response.status}: ${body.slice(0, 200)}`,
        response.status,
        'validate_patch',
        elapsedMs,
        requestId,
      );
    } catch (error) {
      clearTimeout(timeoutId);
      const elapsedMs = Date.now() - startTime;

      if (error instanceof PLoTError) throw error;

      if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted)) {
        log.error(
          { timeout_ms: PLOT_VALIDATE_TIMEOUT_MS, elapsed_ms: elapsedMs, request_id: requestId },
          "PLoT validate_patch timed out",
        );
        throw new PLoTTimeoutError(
          "PLoT validate_patch timed out after " + elapsedMs + "ms",
          'validate_patch',
          PLOT_VALIDATE_TIMEOUT_MS,
          elapsedMs,
        );
      }

      log.error(
        { error, elapsed_ms: elapsedMs, request_id: requestId },
        "PLoT validate_patch failed",
      );
      throw error;
    }
  }

  private buildHeaders(requestId: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    };
    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  private async safeJson(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      return null;
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

  const authToken = config.plot.authToken;
  if (!authToken) {
    log.warn({}, "PLOT_BASE_URL configured but PLOT_AUTH_TOKEN missing — PLoT calls will fail if auth is enabled");
  }

  log.info({ base_url: baseUrl, auth_configured: !!authToken }, "PLoT client configured");
  return new PLoTClientImpl(baseUrl, authToken);
}
