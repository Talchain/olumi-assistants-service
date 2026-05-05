/**
 * Shared helpers for the V5 no-op explanation handlers
 * (`explain_from_structure`, `explain_results`, `what_would_flip`).
 *
 * Kept narrow on purpose — only utilities used by ≥ 2 handlers and tested
 * once. Handler-specific logic stays in each handler file so the per-
 * handler contract is readable in one place.
 */

import type { HandlerInvocation } from '../registry.js';

/**
 * Source-of-truth for `option_count` in the no-op handlers' result body
 * and precondition-fail template.
 *
 * `entity_registry.option_ids` from the wire-level `TurnContext` is a
 * stub: `build-turn-context.ts` initialises it as an empty array on every
 * turn and never populates it from the persisted graph. Reading it
 * directly produces "0 options" in production regardless of graph state.
 *
 * `analysisReady.options` from `computeStructuralReadiness` is the
 * authoritative graph-derived source. The turn-executor threads
 * `analysisReadyForTurn` into `HandlerInvocation` for this purpose.
 *
 * Falls back to the entity_registry stub only when `analysisReady` is
 * undefined — which today only happens on frame-stage turns with no
 * graph at all (computeStructuralReadiness returns undefined when no
 * graph is present). The fallback returns 0 in those cases by design.
 * The chip-click dispatch path also passes no analysisReady, but it
 * currently invokes only `run_analysis` and never these no-op handlers,
 * so that path is not a concern here.
 */
export function resolveOptionCount(invocation: HandlerInvocation): number {
  if (invocation.analysisReady) {
    return invocation.analysisReady.options.length;
  }
  return invocation.context.entity_registry.option_ids?.length ?? 0;
}

/**
 * Decide the precondition-fail template wording based on structural
 * readiness. The earlier single-string template said "ready to analyse"
 * unconditionally — wrong when readiness is `needs_user_input`,
 * `needs_user_mapping`, or `needs_encoding` because those statuses block
 * the run_analysis CTA. Branch the copy so the user gets accurate
 * direction.
 *
 * Statuses recognised:
 *   - `ready` → "and is ready to analyse" (run-analysis chip will follow).
 *   - `needs_user_input` / `needs_user_mapping` / `needs_encoding`
 *     → "but option values still need to be set up before analysis can
 *        run" (set-values chip will follow per chip-generator's existing
 *        readiness fallback).
 *   - undefined / unknown literal → fall back to the neutral "ready to
 *     analyse" wording. The chip generator's own readiness gate prevents
 *     a misleading executable chip in that case.
 */
export function buildAnalysisAbsentTemplate(
  optionCount: number,
  readinessStatus: string | undefined,
): string {
  const optionsLabel = optionCount === 1 ? 'option' : 'options';
  const NEEDS_SETUP_STATUSES = new Set([
    'needs_user_input',
    'needs_user_mapping',
    'needs_encoding',
  ]);
  const tail = NEEDS_SETUP_STATUSES.has(readinessStatus ?? '')
    ? `but the options still need to be set up before analysis can run.`
    : `and is ready to analyse. Would you like me to run the analysis?`;
  return (
    `No analysis has been run on your model yet. ` +
    `The graph has ${optionCount} ${optionsLabel} configured ` +
    tail
  );
}

/**
 * Stale-analysis template. Used by the V5 explanation handlers when a
 * successful prior analysis exists but the current graph hash differs
 * from the hash at the time of that run. Tells the user the model has
 * changed and offers a re-run, without leaking internal terms (no graph
 * hash, no fact_type, no analysis_status). The chip-generator pairs this
 * with a "Re-run analysis" suggested action.
 */
export function buildAnalysisStaleTemplate(): string {
  return (
    `The model has changed since the last analysis, so I can't be sure ` +
    `the previous result still applies. Would you like to re-run analysis ` +
    `to see how your changes affect the recommendation?`
  );
}

/**
 * Degraded-analysis template. Used by the V5 explanation handlers when
 * the most recent run_analysis fact arrived in a non-success state
 * (partial / blocked / failed / future non-canonical statuses). Frames
 * the situation in user terms — the analysis didn't produce usable
 * results — and offers a recovery path. Never echoes the internal
 * status string. The chip-generator pairs this with a "Re-run analysis"
 * suggested action.
 */
export function buildAnalysisDegradedTemplate(): string {
  return (
    `The last analysis didn't produce a usable result, so I can't ` +
    `summarise it for you. Would you like to re-run analysis?`
  );
}
