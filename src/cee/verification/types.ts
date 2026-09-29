import type { InferenceResultsV1 } from "../../contracts/plot/engine.js";

/**
 * Context passed into the verification pipeline for each CEE response.
 * This is intentionally metadata-only and must never contain user prompts,
 * briefs, or graph labels.
 */
export interface VerificationContext {
  /** Logical endpoint name, e.g. "draft-graph" or "explain-graph". */
  endpoint: string;
  /**
   * When true, the engine validation stage should be treated as a hard
   * blocker for this response (graph endpoints only).
   */
  requiresEngineValidation: boolean;
  /** Optional inference results used for numerical grounding checks. */
  engineResults?: InferenceResultsV1;
  /** Stable request identifier for telemetry correlation. */
  requestId?: string;
}

export type VerificationSeverity = "info" | "warn" | "error";

export interface VerificationResult<T = unknown> {
  /** Whether this stage considered the data valid. */
  valid: boolean;
  /** Logical stage name, e.g. "schema_validation". */
  stage: string;
  /** Optional severity used for warnings and non-blocking issues. */
  severity?: VerificationSeverity;
  /** Optional machine-readable code, e.g. "SCHEMA_INVALID". */
  code?: string;
  /** Optional human-readable message for logs and diagnostics. */
  message?: string;
  /**
   * Structured, metadata-only details. This must never contain user content
   * such as briefs, prompts, or graph labels.
   */
   
  details?: Record<string, any>;
  /** When the stage performs parsing, the strongly-typed parsed data. */
  validated_data?: T;
  /** True when the stage chose to skip validation for this invocation. */
  skipped?: boolean;
}

export interface VerificationStage<TInput = unknown, TResult = unknown> {
  readonly name: string;
  validate(data: TInput, context?: VerificationContext): Promise<VerificationResult<TResult>>;
}
