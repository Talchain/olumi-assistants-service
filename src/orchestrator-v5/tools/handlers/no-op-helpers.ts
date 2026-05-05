/**
 * Shared helpers for the V5 no-op explanation handlers
 * (`explain_from_structure`, `explain_results`, `what_would_flip`).
 *
 * Kept narrow on purpose — only utilities used by ≥ 2 handlers and tested
 * once. Handler-specific logic stays in each handler file so the per-
 * handler contract is readable in one place.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import type { HandlerInvocation } from '../registry.js';
import {
  isSuccessfulRunAnalysisFact,
  selectDegradedRunAnalysisFact,
} from '../../context/freshness.js';

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
    `Your model has ${optionCount} ${optionsLabel} set up ` +
    tail
  );
}

/**
 * Combined success+currentness precondition verdict for the V5
 * explanation handlers (`explain_results`, `what_would_flip`).
 *
 * Both handlers consume the same four-state decision tree pre-Wave-1;
 * the duplication was originally inlined per-handler with a comment
 * justifying it. The follow-up review correctly noted that future
 * predicate changes could drift again — extracted here so there is a
 * single source of truth.
 */
export type ExplanationPreconditionVerdict =
  | 'missing'
  | 'degraded'
  | 'stale'
  | 'execute';

/**
 * Decide the precondition verdict from the handler invocation.
 *
 * Decision tree:
 *   1. No successful run_analysis fact in prior_facts:
 *      - Degraded fact present → 'degraded'.
 *      - Otherwise → 'missing'.
 *   2. Successful fact exists but `analysisProjection` is null/undefined
 *      → 'missing' (defensive — composer would otherwise hit its
 *      generic-line fallback without a recovery chip).
 *   3. Freshness === 'stale' → 'stale'.
 *   4. Otherwise → 'execute'.
 */
export function decideExplanationPrecondition(
  invocation: {
    readonly context: { readonly prior_facts: readonly HandlerFact[] }
    readonly analysisProjection?: unknown
    readonly analysisFreshness?: { readonly freshness: string }
  },
): ExplanationPreconditionVerdict {
  const priorFacts = invocation.context.prior_facts
  const hasSuccessfulFact = priorFacts.some(isSuccessfulRunAnalysisFact)

  if (!hasSuccessfulFact) {
    return selectDegradedRunAnalysisFact(priorFacts) !== null ? 'degraded' : 'missing'
  }

  if (invocation.analysisProjection == null) {
    return 'missing'
  }

  if (invocation.analysisFreshness?.freshness === 'stale') {
    return 'stale'
  }

  return 'execute'
}

/**
 * Render the precondition-fail assistant_text for a non-execute verdict.
 * Pure function over the verdict + invocation context.
 */
export function buildPreconditionAssistantText(
  verdict: Exclude<ExplanationPreconditionVerdict, 'execute'>,
  optionCount: number,
  readinessStatus: string | undefined,
): string {
  switch (verdict) {
    case 'missing':
      return buildAnalysisAbsentTemplate(optionCount, readinessStatus)
    case 'stale':
      return buildAnalysisStaleTemplate()
    case 'degraded':
      return buildAnalysisDegradedTemplate()
  }
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
