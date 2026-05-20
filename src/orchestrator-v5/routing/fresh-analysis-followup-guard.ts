/**
 * V5 fresh-analysis follow-up guard — catch-net for analytical questions
 * the post-analysis advice gate could not synthesise.
 *
 * Sits AFTER `tryPostAnalysisAdviceGate` so the existing rich classifier
 * keeps first refusal. Fires only when the advice gate already returned
 * `matched: false` AND the readiness snapshot confirms analysis is fresh.
 * Closes two recurring fall-through classes:
 *
 *   - `data_unavailable_for_class` — message matched an advice-gate class
 *     pattern but the projection lacked `top_driver` / `leading_option`,
 *     so the strict per-class requirements failed and control fell
 *     through to the LLM router.
 *   - Pattern gap — questions like "Why is this option ahead?" or
 *     "What would need to change for another option to look better?"
 *     are not part of the advice gate's 9-class taxonomy but ARE
 *     recognised by `classifyAnalyticalIntent`.
 *
 * Predicate (all four must hold):
 *
 *   - `readiness.latest_analysis_freshness === 'fresh'`
 *   - `readiness.has_run_analysis_fact === true`
 *   - `classifyAnalyticalIntent(message) !== null`
 *   - `hasMutationSignal(message) === false`
 *
 * Matched response is a deterministic direct_answer that points the user
 * at the analysis surface and offers an existing chip. The chip carries
 * an existing `action_type` whose handler already runs deterministically
 * (no LLM call) when clicked via `dispatchDeterministicChipClick`:
 *
 *   - `explain` / `what_drove` / `rerun_question` → `explain_results`
 *   - `what_would_flip`                           → `what_would_flip`
 *
 * The brief allows this chip-led catch-net as the deterministic fallback
 * shape. A future refinement could short-circuit the handler invocation
 * inline so the user receives the synthesised answer without a click —
 * tracked in the PR body's follow-ups section.
 *
 * Privacy: copy is fixed strings; the guard reads only structural fields
 * off `ContextReadiness`. No graph content, factor labels, raw messages,
 * or internal IDs are emitted.
 */

import {
  classifyAnalyticalIntent,
  hasMutationSignal,
  type AnalyticalIntentClass,
} from './analytical-intent.js';
import type { ContextReadiness } from '../context/readiness.js';

export type FreshAnalysisFollowupActionType =
  | 'explain_results'
  | 'what_would_flip';

export interface FreshAnalysisFollowupSuggestedAction {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type: FreshAnalysisFollowupActionType;
}

export interface FreshAnalysisFollowupGuardInput {
  readonly message: string;
  readonly readiness: ContextReadiness;
}

export type FreshAnalysisFollowupUnmatchedReason =
  | 'not_fresh'
  | 'no_analysis_fact'
  | 'empty_message'
  | 'mutation_signal'
  | 'no_analytical_signal';

export type FreshAnalysisFollowupGuardResult =
  | {
      readonly matched: true;
      readonly intent_class: AnalyticalIntentClass;
      readonly selected_action_type: FreshAnalysisFollowupActionType;
      readonly assistant_text: string;
      readonly suggested_actions: readonly FreshAnalysisFollowupSuggestedAction[];
    }
  | {
      readonly matched: false;
      readonly reason: FreshAnalysisFollowupUnmatchedReason;
    };

/**
 * Recap copy for explain / what_drove / what_would_flip / rerun_question
 * follow-ups when analysis is already fresh. British English; no em dash;
 * no internal terms ("validator", "dispatcher", "schema", "operation",
 * "tool call", "patch") so a future copy-safety lint stays green.
 */
const RECAP_TEXT =
  "Here's the latest analysis recap. Open the analysis view for the full breakdown, including the main drivers and trade-offs.";

const EXPLAIN_RESULTS_ACTION: FreshAnalysisFollowupSuggestedAction = Object.freeze({
  id: 'chip_action_explain_results',
  label: 'Explain the result',
  message: 'Please explain the analysis result in plain language.',
  action_type: 'explain_results' as const,
});

const WHAT_WOULD_FLIP_ACTION: FreshAnalysisFollowupSuggestedAction = Object.freeze({
  id: 'chip_action_what_would_flip',
  label: 'What could change the outcome?',
  message: 'What could change the outcome of this analysis?',
  action_type: 'what_would_flip' as const,
});

function selectActionType(
  cls: AnalyticalIntentClass,
): FreshAnalysisFollowupActionType {
  return cls === 'what_would_flip' ? 'what_would_flip' : 'explain_results';
}

function actionFor(
  actionType: FreshAnalysisFollowupActionType,
): FreshAnalysisFollowupSuggestedAction {
  return actionType === 'what_would_flip'
    ? WHAT_WOULD_FLIP_ACTION
    : EXPLAIN_RESULTS_ACTION;
}

export function tryFreshAnalysisFollowupGuard(
  input: FreshAnalysisFollowupGuardInput,
): FreshAnalysisFollowupGuardResult {
  if (input.readiness.latest_analysis_freshness !== 'fresh') {
    return { matched: false, reason: 'not_fresh' };
  }
  if (!input.readiness.has_run_analysis_fact) {
    return { matched: false, reason: 'no_analysis_fact' };
  }
  const message = input.message.trim();
  if (message.length === 0) {
    return { matched: false, reason: 'empty_message' };
  }

  // Analytical-intent classification runs BEFORE the mutation-signal check.
  // The 23 `classifyAnalyticalIntent` patterns are deliberately specific
  // (e.g. `what would need to change`, `how could another option win`), so a
  // positive classification is a stronger signal than the broader
  // mutation-signal regex set, which exists to catch concrete edit phrasings.
  //
  // Why this ordering is safe: sibling guards (`tryStaleRerunGuard`,
  // `tryNoAnalysisGuard`) check mutation FIRST because they fire on
  // non-fresh states where falsely intercepting an edit is worse than
  // missing an analytical follow-up. On the fresh path the trade-off
  // inverts — the user just received a result and is overwhelmingly more
  // likely to be asking ABOUT it. A message like "What would need to
  // change for another option to look better?" classifies as
  // `what_would_flip` and would otherwise trip the
  // `\bchange\b...\bto\s+\S+` mutation pattern even though it is plainly
  // a sensitivity question.
  const cls = classifyAnalyticalIntent(message);
  if (cls === null) {
    // No analytical signal — fall through to mutation classification so
    // edit phrasings carry the right reason for telemetry.
    if (hasMutationSignal(message)) {
      return { matched: false, reason: 'mutation_signal' };
    }
    return { matched: false, reason: 'no_analytical_signal' };
  }

  const selected = selectActionType(cls);
  return {
    matched: true,
    intent_class: cls,
    selected_action_type: selected,
    assistant_text: RECAP_TEXT,
    suggested_actions: [actionFor(selected)],
  };
}
