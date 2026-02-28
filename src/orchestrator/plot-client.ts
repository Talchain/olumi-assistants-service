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
 *
 * Retry policy (H.4):
 * - 1 retry for 5xx and timeout errors, 2-second backoff
 * - No retry for 4xx (deterministic client errors)
 * - Retry uses remaining turn budget, not a fresh timeout
 * - If remaining budget after backoff < 2s, retry is skipped
 *
 * Outbound validation (H.5):
 * - /v2/run: graph present, options non-empty array with option_id strings, goal_node_id non-empty string
 * - /v1/validate-patch: graph present, operations non-empty array
 * - Validation failures throw OrchestratorError with code INTERNAL_PAYLOAD_ERROR
 */

import { config } from "../config/index.js";
import { PLOT_RUN_TIMEOUT_MS, PLOT_VALIDATE_TIMEOUT_MS } from "../config/timeouts.js";
import { log } from "../utils/telemetry.js";
import type { V2RunResponseEnvelope, OrchestratorError } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

/** Backoff delay before retry (ms) */
const RETRY_BACKOFF_MS = 2_000;

/** Minimum remaining budget required to attempt a retry (ms) */
const MIN_RETRY_BUDGET_MS = 2_000;

// ============================================================================
// Error Types
// ============================================================================

/**
 * Maps PLoT HTTP operation names to orchestrator tool names.
 * PLoT operations are endpoint-scoped ('run', 'validate_patch'),
 * but OrchestratorError.tool should use the orchestrator tool name
 * that the consumer sees ('run_analysis', 'edit_graph').
 */
const OPERATION_TO_TOOL: Record<string, string> = {
  run: 'run_analysis',
  validate_patch: 'edit_graph',
};

export class PLoTError extends Error {
  readonly name = "PLoTError";

  /**
   * Optional override for the OrchestratorError returned by toOrchestratorError().
   * Set when the upstream error.v1 envelope provides an explicit `retryable` field
   * that should take precedence over the status-code heuristic.
   */
  orchestratorErrorOverride?: OrchestratorError;

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
    if (this.orchestratorErrorOverride) {
      return this.orchestratorErrorOverride;
    }
    return {
      code: 'TOOL_EXECUTION_FAILED',
      message: this.message,
      tool: OPERATION_TO_TOOL[this.operation] ?? this.operation,
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
      tool: OPERATION_TO_TOOL[this.operation] ?? this.operation,
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
// Outbound Structural Validation (H.5)
// ============================================================================

/**
 * Validate the outbound payload for /v2/run.
 * Catches "completely wrong shape" errors before the HTTP call.
 * Does NOT validate field-level shapes (PLoT does that).
 */
function validateRunPayload(payload: Record<string, unknown>): void {
  if (payload.graph == null) {
    throwPayloadError('run', 'Missing required field: graph');
  }
  if (!Array.isArray(payload.options) || payload.options.length === 0) {
    throwPayloadError('run', 'Missing or empty required field: options (must be non-empty array)');
  }
  for (let i = 0; i < payload.options.length; i++) {
    const opt = payload.options[i] as Record<string, unknown> | undefined;
    if (!opt || typeof opt.option_id !== 'string') {
      throwPayloadError('run', `options[${i}].option_id must be a string`);
    }
  }
  if (typeof payload.goal_node_id !== 'string' || payload.goal_node_id === '') {
    throwPayloadError('run', 'Missing or empty required field: goal_node_id (must be non-empty string)');
  }
}

/**
 * Validate the outbound payload for /v1/validate-patch.
 * Catches "completely wrong shape" errors before the HTTP call.
 */
function validatePatchPayload(payload: Record<string, unknown>): void {
  if (payload.graph == null) {
    throwPayloadError('validate_patch', 'Missing required field: graph');
  }
  if (!Array.isArray(payload.operations) || payload.operations.length === 0) {
    throwPayloadError('validate_patch', 'Missing or empty required field: operations (must be non-empty array)');
  }
}

function throwPayloadError(operation: string, message: string): never {
  const err: OrchestratorError = {
    code: 'INTERNAL_PAYLOAD_ERROR',
    message: `PLoT ${operation} outbound validation failed: ${message}`,
    tool: OPERATION_TO_TOOL[operation] ?? operation,
    recoverable: false,
  };
  throw Object.assign(new Error(err.message), { orchestratorError: err });
}

// ============================================================================
// Retry Helpers (H.4)
// ============================================================================

/**
 * Determine if an error is retryable (5xx or timeout).
 * 4xx errors are deterministic and should NOT be retried.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof PLoTError) {
    return error.status >= 500;
  }
  if (error instanceof PLoTTimeoutError) {
    return true;
  }
  // Network errors (fetch failures)
  if (error instanceof Error && (
    error.name === 'AbortError' ||
    error.message.includes('fetch failed') ||
    error.message.includes('ECONNREFUSED') ||
    error.message.includes('ECONNRESET')
  )) {
    return true;
  }
  return false;
}

/**
 * Sleep that can be cancelled by an AbortSignal.
 * Resolves to true if sleep completed, false if aborted.
 */
function cancellableSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve(true);
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      resolve(false);
    };

    function cleanup() {
      signal?.removeEventListener('abort', onAbort);
    }

    signal?.addEventListener('abort', onAbort);
  });
}

// ============================================================================
// Client
// ============================================================================

export interface PLoTClientRunOpts {
  /** Turn-level AbortSignal for budget-aware retry. */
  turnSignal?: AbortSignal;
  /** Timestamp (Date.now()) when the turn started — used to compute remaining budget. */
  turnStartedAt?: number;
  /** Total turn budget in ms — used with turnStartedAt to derive remaining time. */
  turnBudgetMs?: number;
}

export interface PLoTClient {
  run(payload: Record<string, unknown>, requestId: string, opts?: PLoTClientRunOpts): Promise<V2RunResponseEnvelope>;
  validatePatch(payload: Record<string, unknown>, requestId: string, opts?: PLoTClientRunOpts): Promise<ValidatePatchResult>;
}

class PLoTClientImpl implements PLoTClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authToken: string | undefined,
  ) {}

  async run(payload: Record<string, unknown>, requestId: string, opts?: PLoTClientRunOpts): Promise<V2RunResponseEnvelope> {
    // H.5: Outbound structural validation
    validateRunPayload(payload);

    return this.runWithRetry(
      () => this.runOnce(payload, requestId),
      'run',
      requestId,
      opts,
    ) as Promise<V2RunResponseEnvelope>;
  }

  async validatePatch(payload: Record<string, unknown>, requestId: string, opts?: PLoTClientRunOpts): Promise<ValidatePatchResult> {
    // H.5: Outbound structural validation
    validatePatchPayload(payload);

    return this.runWithRetry(
      () => this.validatePatchOnce(payload, requestId),
      'validate_patch',
      requestId,
      opts,
    ) as Promise<ValidatePatchResult>;
  }

  // --------------------------------------------------------------------------
  // Retry wrapper (H.4)
  // --------------------------------------------------------------------------

  private async runWithRetry<T>(
    fn: () => Promise<T>,
    operation: string,
    requestId: string,
    opts?: PLoTClientRunOpts,
  ): Promise<T> {
    try {
      return await fn();
    } catch (firstError) {
      // Only retry 5xx and timeout errors
      if (!isRetryableError(firstError)) {
        throw firstError;
      }

      // Check if turn signal is already aborted
      if (opts?.turnSignal?.aborted) {
        throw firstError;
      }

      // Calculate remaining budget
      const remainingBudgetMs = this.getRemainingBudget(opts);
      const budgetAfterBackoff = remainingBudgetMs - RETRY_BACKOFF_MS;

      if (budgetAfterBackoff < MIN_RETRY_BUDGET_MS) {
        log.warn(
          {
            request_id: requestId,
            operation,
            remaining_budget_ms: remainingBudgetMs,
            backoff_ms: RETRY_BACKOFF_MS,
          },
          "PLoT retry skipped — insufficient budget after backoff",
        );
        throw firstError;
      }

      log.info(
        {
          request_id: requestId,
          operation,
          remaining_budget_ms: remainingBudgetMs,
          backoff_ms: RETRY_BACKOFF_MS,
          first_error: firstError instanceof Error ? firstError.message : String(firstError),
        },
        "PLoT retrying after transient failure",
      );

      // Cancellable backoff sleep
      const sleepCompleted = await cancellableSleep(RETRY_BACKOFF_MS, opts?.turnSignal);
      if (!sleepCompleted) {
        log.info({ request_id: requestId, operation }, "PLoT retry abandoned — turn aborted during backoff");
        throw firstError;
      }

      // Retry
      try {
        return await fn();
      } catch (retryError) {
        log.warn(
          {
            request_id: requestId,
            operation,
            retry_error: retryError instanceof Error ? retryError.message : String(retryError),
          },
          "PLoT retry failed — exhausted",
        );
        throw retryError;
      }
    }
  }

  private getRemainingBudget(opts?: PLoTClientRunOpts): number {
    if (opts?.turnStartedAt != null && opts?.turnBudgetMs != null) {
      const elapsed = Date.now() - opts.turnStartedAt;
      return Math.max(0, opts.turnBudgetMs - elapsed);
    }
    // No budget info — assume plenty of budget (allow retry)
    return Infinity;
  }

  // --------------------------------------------------------------------------
  // Core HTTP operations (single attempt)
  // --------------------------------------------------------------------------

  private async runOnce(payload: Record<string, unknown>, requestId: string): Promise<V2RunResponseEnvelope> {
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
        plotErr.orchestratorErrorOverride = orchErr;
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

  private async validatePatchOnce(payload: Record<string, unknown>, requestId: string): Promise<ValidatePatchResult> {
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

// ============================================================================
// Exports for testing
// ============================================================================

export { validateRunPayload as _validateRunPayload, validatePatchPayload as _validatePatchPayload };
export { isRetryableError as _isRetryableError, cancellableSleep as _cancellableSleep };
export { RETRY_BACKOFF_MS as _RETRY_BACKOFF_MS, MIN_RETRY_BUDGET_MS as _MIN_RETRY_BUDGET_MS };

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
