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
 * - EXCEPTION (FIX 1/B, brief-bearing runs): a `/v2/run` payload carrying a
 *   non-empty `brief` triggers PLoT's synchronous, LLM-backed decision-review
 *   callback chain. That chain is expensive and non-idempotent, so a
 *   brief-bearing run is NEVER retried — on timeout, 5xx, OR network error —
 *   regardless of remaining budget. See `isBriefBearingRunPayload` /
 *   `skipRetryEntirely`.
 *
 * Outbound validation (H.5):
 * - /v2/run: graph present, options non-empty array with option_id strings, goal_node_id non-empty string
 * - /v1/validate-patch: graph present, operations non-empty array
 * - Validation failures throw OrchestratorError with code INTERNAL_PAYLOAD_ERROR
 */

import { z } from "zod";
import { config } from "../config/index.js";
import { PLOT_RUN_TIMEOUT_MS, PLOT_RUN_BRIEF_TIMEOUT_MS, PLOT_VALIDATE_TIMEOUT_MS } from "../config/timeouts.js";
import { log } from "../utils/telemetry.js";
import type { V2RunResponseEnvelope, OrchestratorError } from "./types.js";

// ============================================================================
// Inbound Response Validation (P0-2)
// ============================================================================

/**
 * Minimal Zod schema for PLoT /v2/run responses.
 * Validates structural liveness — required fields exist with correct types.
 * Uses .passthrough() so unknown fields are preserved, not stripped.
 *
 * PLoT returns option data in `option_comparison` (not `results`), and
 * `response_hash` at the top level (not inside `meta`). Accept both shapes
 * so we don't reject valid PLoT responses as malformed.
 */
const V2RunResponseMinimal = z.object({
  // PLoT returns option_comparison[], not results[] — accept either
  results: z.array(z.unknown()).min(1).optional(),
  option_comparison: z.array(z.unknown()).min(1).optional(),
  // response_hash can be top-level or inside meta
  response_hash: z.string().min(1).optional(),
  meta: z.object({
    response_hash: z.string().min(1).optional(),
  }).passthrough().optional(),
}).passthrough().refine(
  (val) => {
    // Must have at least one of results or option_comparison with data
    const hasResults = Array.isArray(val.results) && val.results.length > 0;
    const hasOptionComparison = Array.isArray(val.option_comparison) && val.option_comparison.length > 0;
    if (!hasResults && !hasOptionComparison) return false;

    // Must have response_hash somewhere
    const hasHash = (typeof val.response_hash === 'string' && val.response_hash.length > 0) ||
      (typeof val.meta?.response_hash === 'string' && val.meta.response_hash.length > 0);
    return hasHash;
  },
  {
    message: 'PLoT response must include (results[] or option_comparison[]) and response_hash (top-level or in meta)',
  },
);

/**
 * Minimal Zod schema for PLoT /v1/validate-patch success responses.
 * Validates structural liveness: response must be an object with optional
 * graph_hash (the only field consumed downstream by system-event-router).
 */
const ValidatePatchResponseMinimal = z.object({
  graph_hash: z.string().optional(),
}).passthrough();

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

  /**
   * Set when the PLoT /v2/run endpoint returns HTTP 422 with a parseable V2RunError body.
   * Allows callers to surface the structured analysis_status/critiques as a result
   * rather than treating the 422 as a pipeline error.
   */
  v2RunError?: V2RunError;

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
  // `code` / `user_message` are PLoT's typed-failure discriminators (PLoT #212
  // envelope: GRAPH_TOO_COMPLEX, ISL_TIMEOUT, PLOT_INTERNAL_ERROR, …). Typed
  // here so consumers can key honest copy off them; runtime was already
  // passthrough via the index signature.
  critiques?: Array<{ message?: string; code?: string; user_message?: string; [k: string]: unknown }>;
}

/**
 * A 200 body that fails the minimal response shape because PLoT deliberately
 * sent its typed failure envelope (analysis_status 'failed'/'blocked', usually
 * without results) is NOT malformed. Extract the envelope so callers can
 * surface honest, code-keyed copy. Returns null for anything else — bodies
 * with no analysis_status keep the PLOT_RESPONSE_MALFORMED classification.
 */
function extractTypedFailureEnvelope(raw: unknown): V2RunError | null {
  if (raw === null || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  const status = rec.analysis_status;
  if (status !== 'failed' && status !== 'blocked') return null;
  const critiques = Array.isArray(rec.critiques)
    ? (rec.critiques.filter(
        (c): c is Record<string, unknown> => c !== null && typeof c === 'object',
      ) as V2RunError['critiques'])
    : undefined;
  return {
    analysis_status: status,
    status_reason: typeof rec.status_reason === 'string' ? rec.status_reason : undefined,
    critiques,
  };
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
 * Validates the PLoT-facing contract: options must have `id` (PLoT primary key)
 * and `interventions` must be a flat { factor_id: number } map.
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
    if (!opt || typeof opt.id !== 'string' || opt.id === '') {
      throwPayloadError('run', `options[${i}].id must be a non-empty string`);
    }
    // Validate interventions is a flat { factor_id: number } map
    if (opt.interventions == null || typeof opt.interventions !== 'object' || Array.isArray(opt.interventions)) {
      throwPayloadError('run', `options[${i}].interventions must be a non-null object`);
    }
    const interventions = opt.interventions as Record<string, unknown>;
    for (const [factorId, val] of Object.entries(interventions)) {
      if (typeof val !== 'number' || !Number.isFinite(val)) {
        throwPayloadError('run', `options[${i}].interventions["${factorId}"] must be a finite number, got ${typeof val}`);
      }
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
 * Detect whether a /v2/run payload carries a non-empty decision `brief`.
 *
 * Brief-bearing runs trigger PLoT's synchronous CEE decision-review callback
 * chain (see PLOT_RUN_BRIEF_TIMEOUT_MS doc comment) — they need the extended
 * timeout budget and must NOT be retried on ANY error class (timeout, 5xx,
 * or network — see FIX B, C2) — retrying would re-fire that expensive
 * LLM-backed chain a second time.
 */
function isBriefBearingRunPayload(payload: Record<string, unknown>): boolean {
  const brief = payload["brief"];
  return typeof brief === "string" && brief.trim().length > 0;
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
    // W2E-2 (round 4): non-positive persisted sigma is floored UPSTREAM, in
    // `loadScenarioSnapshotForRunAnalysis` (build-turn-context.ts) — BEFORE
    // the `GraphV3.safeParse` there, which rejects `strength.std <= 0` and
    // would otherwise fail the turn before any code here could run. A floor
    // at this seam is unreachable for that class on every live path (the only
    // live caller passes a GraphV3-validated graph), so none is wired here.
    // H.5: Outbound structural validation
    validateRunPayload(payload);

    // FIX 1 (extended by FIX B, C2): brief-bearing runs trigger PLoT's
    // synchronous CEE decision-review callback chain — they need a longer
    // timeout budget and must not be retried on ANY error class (timeout,
    // 5xx, or network — see PLOT_RUN_BRIEF_TIMEOUT_MS doc comment).
    const briefBearing = isBriefBearingRunPayload(payload);
    const timeoutMs = briefBearing ? PLOT_RUN_BRIEF_TIMEOUT_MS : PLOT_RUN_TIMEOUT_MS;

    return this.runWithRetry(
      () => this.runOnce(payload, requestId, timeoutMs),
      'run',
      requestId,
      opts,
      { skipRetryEntirely: briefBearing },
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
    retryConfig?: { skipRetryEntirely?: boolean },
  ): Promise<T> {
    try {
      return await fn();
    } catch (firstError) {
      // Only retry 5xx and timeout errors
      if (!isRetryableError(firstError)) {
        throw firstError;
      }

      // FIX 1 (extended by FIX B, C2): a brief-bearing run's synchronous,
      // LLM-backed decision-review callback chain may have already run (or
      // nearly run) to completion by the time ANY retryable error surfaces —
      // not just a timeout. A 5xx or network error while that expensive,
      // non-idempotent chain is in flight is just as likely to mean the
      // chain already fired; retrying would re-fire it a second time (the
      // "retry storm" observed in the flag-activation trial: 2x
      // decision-review LLM calls, ~68s turn). Structurally impossible:
      // never retry a brief-bearing run, on ANY error class (timeout, 5xx,
      // or network) — `firstError` is already confirmed retryable by the
      // `isRetryableError` check above, so no class-specific check is
      // needed here.
      if (retryConfig?.skipRetryEntirely) {
        log.warn(
          {
            request_id: requestId,
            operation,
            error_kind: firstError instanceof PLoTTimeoutError
              ? 'timeout'
              : firstError instanceof PLoTError
                ? '5xx'
                : 'network',
          },
          "PLoT retry skipped — brief-bearing run; retrying would double the LLM-backed decision-review chain",
        );
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

  private async runOnce(
    payload: Record<string, unknown>,
    requestId: string,
    timeoutMs: number = PLOT_RUN_TIMEOUT_MS,
  ): Promise<V2RunResponseEnvelope> {
    const url = `${this.baseUrl}/v2/run`;
    const startTime = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    log.info(
      { url: '/v2/run', request_id: requestId, timeout_ms: timeoutMs },
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
        const raw = await response.json();
        // P0-2: Validate response structure before accepting
        const parsed = V2RunResponseMinimal.safeParse(raw);
        if (!parsed.success) {
          // Typed-failure carve-out (seam item 3): a failed/blocked envelope
          // with no usable results is PLoT's deliberate typed failure shape,
          // not a malformed response. Carry it on the error so run-analysis
          // can dual-carry the critique codes into user-facing copy. Bodies
          // WITHOUT analysis_status stay classified PLOT_RESPONSE_MALFORMED
          // below — never loosen that pin for genuinely malformed bodies.
          const typedFailure = extractTypedFailureEnvelope(raw);
          if (typedFailure) {
            log.warn(
              {
                request_id: requestId,
                elapsed_ms: elapsedMs,
                analysis_status: typedFailure.analysis_status,
                status_reason: typedFailure.status_reason,
                critique_codes: typedFailure.critiques?.map((c) => c.code).filter(Boolean),
              },
              'PLoT /v2/run returned typed failure envelope (no results)',
            );
            const reason =
              typedFailure.status_reason ??
              typedFailure.critiques?.[0]?.message ??
              'no reason given';
            const failErr = new PLoTError(
              `PLoT run analysis ${typedFailure.analysis_status}: ${reason}`,
              200,
              'run',
              elapsedMs,
              requestId,
            );
            failErr.v2RunError = typedFailure;
            failErr.orchestratorErrorOverride = {
              code: 'TOOL_EXECUTION_FAILED',
              message: 'Analysis did not complete. Try running the analysis again.',
              tool: 'run_analysis',
              recoverable: true,
              suggested_retry: 'Try running the analysis again.',
            };
            throw failErr;
          }
          log.warn(
            {
              request_id: requestId,
              elapsed_ms: elapsedMs,
              validation_errors: parsed.error.flatten(),
              response_keys: raw != null && typeof raw === 'object' ? Object.keys(raw) : [],
            },
            'PLoT /v2/run response failed structural validation',
          );
          const plotErr = new PLoTError(
            `PLoT /v2/run returned malformed response: ${parsed.error.issues.map(i => i.message).join('; ')}`,
            200,
            'run',
            elapsedMs,
            requestId,
          );
          plotErr.orchestratorErrorOverride = {
            code: 'PLOT_RESPONSE_MALFORMED',
            message: 'Analysis service returned an unexpected response shape. Try again.',
            tool: 'run_analysis',
            recoverable: true,
          };
          throw plotErr;
        }
        const data = raw as V2RunResponseEnvelope;
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

        const plotErr = new PLoTError(
          `PLoT run analysis blocked: ${errMsg}`,
          422,
          'run',
          elapsedMs,
          requestId,
        );
        if (v2Err) plotErr.v2RunError = v2Err;
        throw plotErr;
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
          { timeout_ms: timeoutMs, elapsed_ms: elapsedMs, request_id: requestId },
          "PLoT run timed out",
        );
        throw new PLoTTimeoutError("PLoT run timed out after " + elapsedMs + "ms", 'run', timeoutMs, elapsedMs);
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
        const raw = await response.json();
        // P0-2: Validate response structure before accepting
        const parsed = ValidatePatchResponseMinimal.safeParse(raw);
        if (!parsed.success) {
          log.warn(
            {
              request_id: requestId,
              elapsed_ms: elapsedMs,
              validation_errors: parsed.error.flatten(),
            },
            'PLoT /v1/validate-patch response failed structural validation',
          );
          const plotErr = new PLoTError(
            `PLoT /v1/validate-patch returned malformed response: ${parsed.error.issues.map(i => i.message).join('; ')}`,
            200,
            'validate_patch',
            elapsedMs,
            requestId,
          );
          plotErr.orchestratorErrorOverride = {
            code: 'PLOT_RESPONSE_MALFORMED',
            message: 'Patch validation service returned an unexpected response shape. Try again.',
            tool: 'edit_graph',
            recoverable: true,
          };
          throw plotErr;
        }
        const data = raw as Record<string, unknown>;
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
