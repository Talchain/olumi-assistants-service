/**
 * V5 alpha hardening Phase 2.6 — locked recoverable handler-cause-kinds.
 *
 * War-Room locked decision (post DL-7 / staging 95d64582). Handler
 * invocation failures fall into two product-shape categories:
 *
 *   - **User-recoverable** — the failure reflects user intent or graph
 *     state, not infrastructure. The turn recovers as a clean
 *     direct_answer 200 with coaching text and a recovery chip,
 *     mirroring the Phase 2.2 validator-recoverable pattern.
 *
 *   - **Fatal** — infrastructure (commit, scenario read, PLoT transport),
 *     contract-mismatch (PLoT shape drift), or impossible state
 *     (post-mutation graph invariant violated, handler result invalid).
 *     These continue to surface via the `composeHandlerFailure` 500 path
 *     so genuine system failures are not disguised as user-recoverable
 *     success. See `Docs/v5/v5-p1-1-handler-failure-scope.md`.
 *
 * `handler_not_registered` is intentionally NOT in this list — the
 * runtime data does not distinguish "Sonnet proposed an unavailable
 * action" (recoverable) from "registry tampered / dispatch invariant
 * broken" (fatal). Splitting the cause kind is a follow-up.
 */

import type { HandlerInvocationFailedCause } from '../tools/handler-errors.js';

/**
 * Locked recoverable handler-cause-kinds (War-Room post-staging-95d64582).
 * Adding a new entry requires a War Room decision recorded against
 * `Docs/v5/v5-p1-1-handler-failure-scope.md`.
 */
export const RECOVERABLE_HANDLER_CAUSES: ReadonlySet<HandlerInvocationFailedCause> = new Set<HandlerInvocationFailedCause>(
  [
    'args_validation_failed',
    'options_not_configured',
    // EP2 (V5 Edit Safety Core): the read-boundary analysis-ready guard blocking an
    // un-analysable persisted graph is user-recoverable (graph state, not infra) —
    // a clean direct_answer 200 with an honest next-step + recovery chip. (War-Room
    // convention: control to record against the handler-failure-scope doc.)
    'analysis_not_ready',
    'analysis_blocked',
    'parameter_invalid_at_execute',
    'entity_not_found_in_graph',
    'entity_kind_mismatch_at_execute',
    'precondition_unmet_at_execute',
  ],
);

/**
 * Convenience predicate. The catch ladder in `turn-executor.ts` uses
 * this to decide between the recoverable 200 path and the fatal 500
 * path; tests assert it for each cause-kind in the locked list.
 */
export function isRecoverableHandlerCause(
  cause: HandlerInvocationFailedCause,
): boolean {
  return RECOVERABLE_HANDLER_CAUSES.has(cause);
}
