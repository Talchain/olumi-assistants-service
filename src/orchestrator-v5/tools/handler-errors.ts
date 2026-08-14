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
  | 'analysis_not_completed'
  // V5 alpha hardening Phase 2.3: PLoT status matrix split
  // `analysis_not_completed` into more specific fatal kinds so
  // observability + composer logic can differentiate "PLoT decided it
  // cannot answer" from "PLoT errored mid-run" from "unknown status with
  // no usable fields". See Docs/v5/v5-resilience-contract.md Part C.
  | 'analysis_blocked'
  | 'analysis_failed'
  // ROADMAP 2.202 fix ③ (diagnosis-run-analysis-500s.md): the analysis engine
  // is at its CONCURRENCY LIMIT — a downstream HTTP 429 (ISL's compute governor
  // rejecting a concurrent run, or PLoT's own limiter rejecting CEE). This is
  // capacity contention, not breakage: nothing is wrong with the user's model
  // and a retry in a few seconds plausibly succeeds. Recoverable typed 200 with
  // honest busy copy + a retry chip — NOT a 500 INTERNAL_ERROR, which told the
  // tester the service was broken when it was merely busy. Same principle CEE
  // already accepted for its OWN ingress limiter (41d5ecf0, "429 RATE_LIMITED,
  // not 500 INTERNAL"). Carries `downstream_http_status` in details.
  | 'analysis_engine_busy'
  | 'options_not_configured'
  // EP2 (V5 Edit Safety Core): the read-boundary analysis-ready guard found the
  // persisted graph unrecoverable (non-canonical option shape that can't be
  // safely encoded, or structurally un-analysable). Recoverable typed 200 with
  // an honest next-step — NOT a 500. Carries `reason_code` + `next_step` in details.
  | 'analysis_not_ready'
  // V5 D1 mutation handlers (set_factor_value, add_constraint,
  // adjust_edge_strength). Surface at execute-time when the validator's
  // structural pass missed the failure — e.g. graph-dependent checks
  // that fire only after the handler reads the in-memory graph, or
  // post-mutation Zod validation rejecting an invalid graph.
  | 'parameter_invalid_at_execute'
  | 'entity_not_found_in_graph'
  | 'entity_kind_mismatch_at_execute'
  | 'graph_invariant_violated'
  | 'precondition_unmet_at_execute';

/**
 * Handler failure payload. `handler_id` is always present so telemetry and
 * composers can attribute a failure without guessing. Known optional keys:
 *   - `specific_issue`      short user-safe explanation for args_validation_*
 *                            and plot_payload_invalid
 *   - `first_option_label`  used by options_not_configured
 *   - `missing_item_label`  reserved for future handlers
 *   - `analysis_status`     used by analysis_not_completed
 *   - `scenario_id`         used by scenario_read_failed
 * Passthrough for any other keys a handler wants to surface in telemetry.
 */
export interface HandlerFailureDetails {
  readonly handler_id: string;
  readonly specific_issue?: string;
  readonly first_option_label?: string;
  readonly missing_item_label?: string;
  readonly analysis_status?: string;
  readonly scenario_id?: string;
  /** EP2 analysis_not_ready: user-safe next step (no internal IDs). */
  readonly next_step?: string;
  /** EP2 analysis_not_ready: typed reason code for telemetry. */
  readonly reason_code?: string;
  readonly [key: string]: unknown;
}

/**
 * Handler failed at the invocation boundary — upstream service unavailable,
 * dependent resource unreadable, args failed validation, or an upstream
 * returned a semantic error inside a valid wire envelope. Maps to
 * `INTERNAL_TO_WIRE.HANDLER_INVOCATION_FAILED` → `INTERNAL_ERROR`.
 *
 * `cause_kind` is preserved on the failure envelope so observability can
 * distinguish "PLoT timed out" from "scenario not readable" without parsing
 * the message. `retryable` answers the semantic question "could a retry
 * plausibly succeed?" — it does NOT decide the chip. The composer picks
 * Retry vs "Try again in a moment" vs specific-fix per cause_kind
 * independently.
 */
export class HandlerInvocationFailedError extends Error {
  readonly kind = 'HANDLER_INVOCATION_FAILED';
  readonly cause_kind: HandlerInvocationFailedCause;
  readonly retryable: boolean;
  readonly details: Readonly<HandlerFailureDetails>;

  constructor(
    message: string,
    options: {
      cause_kind: HandlerInvocationFailedCause;
      retryable: boolean;
      details: Readonly<HandlerFailureDetails>;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'HandlerInvocationFailedError';
    this.cause_kind = options.cause_kind;
    this.retryable = options.retryable;
    // Defensive normalisation: TypeScript enforces `details` but runtime
    // mutation / `as any` escapes / future deserialisation paths could deliver
    // null/non-object. Normalise to a minimally valid shape so downstream
    // composer switches can always read `details.handler_id` / specific_issue
    // without throwing before their own safe fallback kicks in.
    this.details = normaliseDetails(options.details);
    if (options.cause !== undefined) {
      // Standard ES2022 `cause` field — preserved for debug serialisation.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

function normaliseDetails(raw: unknown): Readonly<HandlerFailureDetails> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { handler_id: 'unknown' };
  }
  const record = raw as Record<string, unknown>;
  const handler_id =
    typeof record.handler_id === 'string' && record.handler_id.length > 0
      ? record.handler_id
      : 'unknown';
  return { ...record, handler_id };
}

/**
 * ROADMAP 2.1091 / golden-journey EXT-2 — the handler whose failure IS an
 * analysis refusal.
 *
 * ⚠ THIS CONSTANT EXISTS BECAUSE ITS ABSENCE SHIPPED A DEFECT. TurnExecutor's
 * recoverable-handler catch is GENERIC across every registered handler, and
 * `d1-shared/error-boundary.ts` maps four D1 error codes onto recoverable
 * causes. A first version of the 2.1091 fix gated only on
 * `isRecoverableHandlerCause`, so a failed `set_factor_value` /
 * `add_constraint` / `adjust_edge_strength` emitted
 * `analysis_ready.status: 'blocked'` — the product claiming the ANALYSIS was
 * blocked because a CONSTRAINT EDIT failed.
 *
 * Scope is `run_analysis` only. The explain family (`explain_results`,
 * `what_would_flip`, `explain_from_structure`) READS an analysis rather than
 * running one, so a refusal there says nothing about analysis readiness. This
 * is also exactly the chip-click arm's scope — `DETERMINISTIC_CHIP_ACTION_TYPES`
 * has one member — and a test asserts the two agree by DERIVATION, so a future
 * widening of the chip whitelist REDs here rather than drifting silently.
 */
export const ANALYSE_HANDLER_ID = 'run_analysis';

/**
 * ROADMAP 2.1091 / golden-journey EXT-2 — the SPECIFIC, machine-readable
 * reason a refused analyse turn reports on `analysis_ready.blocked_reason`.
 *
 * ONE derivation, two consumers (the chip-click dispatcher and TurnExecutor's
 * recovery branch). Written here, beside the error it reads, rather than
 * duplicated at each call site — a two-line expression copied twice is the
 * hand-maintained mirror CLAUDE.md trap 12 is about, and the two analyse arms
 * disagreeing on the reason code is exactly the drift this row exists to end.
 *
 * Precedence: the handler's own declared `details.reason_code` (the finest
 * grain — `mixed_scale_unresolved` vs `baseline_scale_unresolved` vs
 * `scale_postcondition_violated` all arrive under one `cause_kind`), else the
 * typed `cause_kind` itself.
 *
 * CANNOT RETURN A GENERIC OR EMPTY VALUE: `cause_kind` is a non-empty string
 * literal union enforced by the compiler, so the fallback is total and every
 * result is specific by construction. There is deliberately no
 * `'unknown'`/`'unspecified'` branch — "blocked for a reason nobody can act
 * on" is the state this field was added to abolish.
 */
export function blockedReasonForHandlerFailure(
  error: HandlerInvocationFailedError,
): string {
  const declared = error.details.reason_code;
  if (typeof declared === 'string' && declared.trim().length > 0) return declared;
  return error.cause_kind;
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
