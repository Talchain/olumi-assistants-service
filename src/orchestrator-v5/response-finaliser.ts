/**
 * V5 response finaliser — single structurally-guaranteed stamping point for
 * envelope-level fields the product depends on.
 *
 * Background. Across five+ briefs, `analysis_ready` has gone missing because
 * emission was opt-in per composer: every compose function had to remember to
 * set the field, and any new response path that forgot silently broke the
 * UI's pre-analysis panel. The previous brief
 * (`claude/v5-analysis-ready-contract`, commits 0462a1c6 / 8f82285f /
 * 15231c37 / 14e1966b) threaded an `analysisReady?` parameter through six
 * compose surfaces; this brief deletes that plumbing in favour of a single
 * stamping site here, called from route-v2.ts immediately before the egress
 * validator.
 *
 * Architectural rule (per the brief's design principle):
 *
 *   Fields the user depends on must not be opt-in per composer. If the
 *   response envelope requires a field for the product to function, that
 *   field is stamped by a single response finaliser after composition,
 *   before the wire. No composer touches it. No composer can forget it.
 *
 * Enforcement. A grep-based pre-push gate fires if any `analysis_ready`
 * assignment appears outside this file, the `attachComputedAt` helper, the
 * dispatch-result type declarations, or `route-v2.ts`. See
 * `scripts/check-no-direct-analysis-ready.sh`.
 *
 * Skipped paths (legitimate). 500 / `BoundaryError` exits in route-v2.ts do
 * NOT call this finaliser — they're infrastructure failures with no canvas
 * mutation, so the UI's prior `ceeAnalysisReady` value remains correct. Each
 * 500 site carries an inline comment to prevent a future "fix" that would
 * silently invalidate the prior-store-value invariant. See
 * `Docs/v5/v5-response-exit-audit.md` for the full path table.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';

import {
  attachComputedAt,
  type AnalysisReadyPayload,
} from './compose/analysis-ready-emit.js';

export interface FinaliserContext {
  /**
   * Pre-computed readiness from the dispatch path:
   *   - TurnExecutor      : structural readiness from the per-turn graph
   *                         (already computed at turn-executor.ts:368-378
   *                         for chip gating; surfaced on
   *                         `TurnExecutorRunResult.analysisReady`).
   *   - draft-graph       : the rich pipeline payload from
   *                         `DraftGraphResult.analysisReady`.
   *   - edit-graph        : structural readiness from the post-edit
   *                         `appliedGraph`.
   *   - chip-click        : structural readiness from the post-handler
   *                         graph state on the `ok` outcome.
   *   - system-event      : always undefined — system events (undo / redo
   *                         / etc.) carry no graph state.
   *
   * Undefined ⇒ no analysis_ready stamped on the response. This is correct
   * for paths that legitimately have no graph context; the UI's
   * null-as-unknown handling treats absence as "no fresh readiness this
   * turn", not as a blocker.
   */
  readonly analysisReady?: AnalysisReadyPayload;
}

/**
 * Stamp envelope-level fields that the product depends on but that no
 * composer should be responsible for setting.
 *
 * Today: `analysis_ready` only. Future envelope-level guarantees ride here
 * — add the field to `FinaliserContext`, stamp it inside this function,
 * extend the schema contract test to cover the new field. The pre-push gate
 * picks them up automatically because its exclusion list names the files
 * that are allowed to write the field, not the field name itself.
 *
 * Idempotency: calling the finaliser twice with the same context is safe —
 * the second call re-stamps `computed_at` (latest wins), the rest of the
 * payload is identical. Tested in response-finaliser.test.ts.
 */
export function finaliseV5Response(
  response: OlumiResponse,
  ctx: FinaliserContext,
): OlumiResponse {
  if (!ctx.analysisReady) return response;
  return { ...response, analysis_ready: attachComputedAt(ctx.analysisReady) };
}
