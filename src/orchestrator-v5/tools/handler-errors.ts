/**
 * Handler-generic typed errors for V5 turn-executor dispatch catches.
 *
 * These error classes are SHARED across every registered handler — the
 * turn-executor's catch ladder matches on `instanceof` and maps to wire
 * codes via `INTERNAL_TO_WIRE` (`HANDLER_INVOCATION_FAILED` →
 * `INTERNAL_ERROR`, `HANDLER_RESULT_INVALID` → `INTERNAL_ERROR`).
 *
 * Lives in its own module so turn-executor does not import from any
 * specific handler's module (the state prior to this refactor coupled
 * `turn-executor.ts` to `tools/handlers/run-analysis.ts`). D1/D2 handlers
 * will throw these same classes; the ownership invariant script enforces
 * that handler modules themselves are only imported by `registry.ts`.
 *
 * `cause_kind` on `HandlerInvocationFailedError` is a stable machine-
 * readable tag for telemetry + tests — prefer it over substring-matching
 * the message across future refactors. The union grows as new handlers
 * add distinctive failure modes (Slice C2 seeded it with PLoT +
 * scenario-read + args-validation tags).
 */

/**
 * The set of distinctive cause tags a handler may surface on an
 * invocation-boundary failure. Keeping this as a string literal union
 * rather than `string` forces new handlers to add their tags here — a
 * rename or typo is caught by the TypeScript compiler rather than the
 * telemetry pipeline.
 */
export type HandlerInvocationFailedCause =
  | 'args_validation_failed'
  | 'scenario_read_failed'
  | 'plot_payload_invalid'
  | 'plot_error'
  | 'plot_timeout'
  | 'plot_unknown'
  | 'analysis_not_completed';

/**
 * Handler failed at the invocation boundary — upstream service unavailable,
 * dependent resource unreadable, args failed validation, or an upstream
 * returned a semantic error inside a valid wire envelope. Maps to
 * `INTERNAL_TO_WIRE.HANDLER_INVOCATION_FAILED` → `INTERNAL_ERROR`.
 *
 * `cause_kind` is preserved on the failure envelope's `details` so
 * observability can distinguish "PLoT timed out" from "scenario not
 * readable" without parsing the error message.
 */
export class HandlerInvocationFailedError extends Error {
  readonly kind = 'HANDLER_INVOCATION_FAILED';
  readonly cause_kind: HandlerInvocationFailedCause;

  constructor(
    message: string,
    options: { cause_kind: HandlerInvocationFailedCause; cause?: unknown },
  ) {
    super(message);
    this.name = 'HandlerInvocationFailedError';
    this.cause_kind = options.cause_kind;
    if (options.cause !== undefined) {
      // Standard ES2022 `cause` field — preserved for debug serialisation.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Handler produced a `HandlerOutcome` whose fact failed its own Zod
 * schema. Indicates a handler-internal bug (the handler's result-
 * construction path produced a shape incompatible with its declared
 * result type), not an upstream problem. Maps to
 * `INTERNAL_TO_WIRE.HANDLER_RESULT_INVALID` → `INTERNAL_ERROR` and is
 * logged at ERROR severity (vs WARN for invocation failures) because
 * it's always a code fix, never an operational retry.
 */
export class HandlerResultInvalidError extends Error {
  readonly kind = 'HANDLER_RESULT_INVALID';
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'HandlerResultInvalidError';
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}
