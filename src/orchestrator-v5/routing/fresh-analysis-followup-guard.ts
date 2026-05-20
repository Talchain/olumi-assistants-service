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
 *     **OR** `classifyAnalyticalIntent(message) === 'what_would_flip'`
 *     (narrow exception — see "Mutation-precedence" below)
 *
 * Mutation-precedence
 * -------------------
 * Concrete edits MUST reach the edit-graph dispatch path. The guard
 * therefore rejects with `reason: 'mutation_signal'` whenever
 * `hasMutationSignal(message)` is true — with ONE explicit, narrow
 * exception for `what_would_flip`:
 *
 *   `what_would_flip` patterns include `"what would need to change"` and
 *   `"how could another option win"`. The mutation regex's
 *   `change ... to <X>` pattern fires on phrasings like "what would
 *   need to change for another option to look better?" — that's a
 *   genuine sensitivity question, not an edit. So when the analytical
 *   class is `what_would_flip`, the mutation regex is treated as a
 *   false positive and the guard matches.
 *
 * For every OTHER analytical class (`explain` / `what_drove` /
 * `rerun_question`) the mutation regex matching is taken at face value
 * and the guard rejects, preserving edit dispatch for messages like
 * "Set Pricing to 0.7 then explain the results".
 *
 * Matched response is a deterministic direct_answer that points the user
 * at the analysis surface and offers an existing chip. The chip carries
 * an existing `action_type` whose handler already runs deterministically
 * (no LLM call) when clicked via `dispatchDeterministicChipClick`:
 *
 *   - `explain` / `what_drove` / `rerun_question` → `explain_results`
 *   - `what_would_flip`                           → `what_would_flip`
 *
 * Why chip-led rather than inline handler dispatch
 * -----------------------------------------------
 * The brief preferred direct handler dispatch when "safely available".
 * Two candidate execution shapes were rejected as wider-change:
 *
 *   1. Calling `dispatchDeterministicChipClick` (chip-click-dispatch.ts)
 *      from turn-executor's matched branch — that function calls
 *      `buildTurnContext` internally (redundant scenario read), commits
 *      with `turn_class: 'handler'` and `handler_id: actionType` (the
 *      message-path guards commit as `turn_class: 'direct_answer'`,
 *      `handler_id: null`), and emits `dispatch_path: 'chip_click_*'`
 *      freshness telemetry (which would be a lie for a message-path
 *      invocation). Reusing it cleanly needs `preBuiltContext` and
 *      `dispatchPath` override params — a refactor of a different
 *      module.
 *
 *   2. Inlining the handler-invocation pattern from
 *      `dispatchChipClickNoopExplanation` directly in turn-executor —
 *      doable but ~100 lines: build `analysisProjection` from
 *      `prior_facts`, resolve handler via registry, invoke with no
 *      `explanation` (triggers deterministic fallback), compose via
 *      `composeToolCallResponse` (handler shape, not direct_answer),
 *      plumb Phase 3 lifecycle blocks, commit as `turn_class: 'handler'`.
 *
 * The chip-led fallback ships in this PR; the user receives an instant
 * deterministic recap and the chip dispatches the real handler on click
 * via `dispatchDeterministicChipClick` with zero LLM calls. The "no
 * click" variant is a follow-up tracked in the PR body.
 *
 * Privacy of telemetry emitted from the wiring site
 * -------------------------------------------------
 * The guard module itself emits nothing — turn-executor emits one
 * structural event (`v5.fresh_analysis_followup_guard`) carrying
 * platform tracing IDs (`request_id`, `scenario_id`) consistent with
 * sibling guards, plus the structural fields documented in
 * `TelemetryEvents.V5FreshAnalysisFollowupGuard`. No user prose, no
 * factor labels, no raw message, no graph content.
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

  // Classify analytical intent first so we can apply the narrow
  // `what_would_flip` exception. For every OTHER class, mutation wins
  // outright — concrete edits must reach edit_graph dispatch.
  const cls = classifyAnalyticalIntent(message);
  const mutation = hasMutationSignal(message);

  if (cls === null) {
    // No analytical signal — mutation classification drives the reason.
    if (mutation) return { matched: false, reason: 'mutation_signal' };
    return { matched: false, reason: 'no_analytical_signal' };
  }

  if (mutation && cls !== 'what_would_flip') {
    // Concrete edit phrasing (e.g. "Set Pricing to 0.7 then explain the
    // results") with `explain` / `what_drove` / `rerun_question`
    // classification: mutation wins so the message reaches the edit
    // path. Only `what_would_flip` keeps the analytical-first exception
    // because its patterns ("what would need to change", "how could
    // another option win") genuinely overlap with the mutation regex's
    // `change ... to <X>` shape.
    return { matched: false, reason: 'mutation_signal' };
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
