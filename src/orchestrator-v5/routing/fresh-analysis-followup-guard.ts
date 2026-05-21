/**
 * V5 fresh-analysis follow-up guard — catch-net for analytical questions
 * the post-analysis advice gate could not synthesise.
 *
 * Sits AFTER `tryPostAnalysisAdviceGate` so the existing rich classifier
 * keeps first refusal. Fires only when the advice gate already returned
 * `matched: false` AND the readiness snapshot confirms analysis is fresh.
 *
 * After the grounded-fresh-analysis workstream broadened the advice gate
 * to own the brief's canonical phrasings ("what drove this result",
 * "why is X ahead/leading/...", "what would need to change..."), the
 * remaining recurring fall-through class is:
 *
 *   - `data_unavailable_for_class` — message matched an advice-gate class
 *     pattern but the projection lacked `top_driver` / `leading_option`,
 *     so the strict per-class requirements failed and control fell
 *     through to the LLM router.
 *
 * Plus any residual classifier-only phrasings — `classifyAnalyticalIntent`
 * is broader than the advice gate's per-class pattern set, so a future
 * phrase recognised by the classifier but absent from the advice gate
 * (or one that survives the advice gate's stricter per-class data
 * checks) still lands here. This guard is the catch-net for both.
 *
 * Predicate (all four must hold):
 *
 *   - `readiness.latest_analysis_freshness === 'fresh'`
 *   - `readiness.has_run_analysis_fact === true`
 *   - `classifyAnalyticalIntent(message) !== null`
 *   - `hasMutationSignal(message) === false`
 *     **OR** (`classifyAnalyticalIntent(message) === 'what_would_flip'`
 *     **AND** `hasIndependentMutationSignal(message) === false`)
 *     (narrow exception — see "Mutation-precedence" below)
 *
 * Mutation-precedence
 * -------------------
 * Concrete edits MUST reach the edit-graph dispatch path. The guard
 * therefore rejects with `reason: 'mutation_signal'` whenever
 * `hasMutationSignal(message)` is true, with ONE doubly-scoped
 * exception:
 *
 *   1. The analytical class must be `what_would_flip` — `explain` /
 *      `what_drove` / `rerun_question` have no phrasing overlap with
 *      the mutation regex set; their mutation matches are always real
 *      edits.
 *
 *   2. `hasIndependentMutationSignal(message)` must return false. The
 *      helper returns true when the message carries an edit clause
 *      that is NOT explained by flip-pattern overlap:
 *        - any "always-independent" mutation pattern fires (verb+number,
 *          add-a-new, remove-the, from-X-to-Y, bare-imperative); OR
 *        - the verb-to-X mutation pattern still fires after stripping
 *          every `what_would_flip` pattern span from the message —
 *          proving a textual edit like "Change channel to TikTok"
 *          exists outside the flip phrasing.
 *
 * Concretely:
 *
 *   "What would need to change for another option to look better?"
 *     → cls=what_would_flip, mutation=true (`change ... to look`),
 *       independent=false (the `verb...to X` match falls fully inside
 *       the stripped flip span) → exception applies, matches.
 *
 *   "Set Pricing to 0.7 then what would need to change?"
 *     → cls=what_would_flip, mutation=true,
 *       independent=TRUE (verb+number "Set...0.7" is always-independent)
 *       → mutation wins, rejects with `mutation_signal`.
 *
 *   "Change marketing channel to TikTok then what would need to change?"
 *     → cls=what_would_flip, mutation=true (verb-to-X fires twice),
 *       independent=TRUE (after stripping "what would need to change",
 *       "Change marketing channel to TikTok" still fires verb-to-X) →
 *       mutation wins.
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
  hasIndependentMutationSignal,
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
    // path. Only `what_would_flip` keeps the analytical-first
    // exception, and even then only when the mutation signal is from
    // the flip-phrasing overlap alone (see the next branch).
    return { matched: false, reason: 'mutation_signal' };
  }

  if (
    mutation
    && cls === 'what_would_flip'
    && hasIndependentMutationSignal(message)
  ) {
    // `what_would_flip` + mutation, but the mutation signal includes a
    // clause that is INDEPENDENT of the flip phrasing. This covers:
    //
    //   - unambiguous concrete edits regardless of position:
    //       "Set Pricing to 0.7 then what would need to change..."
    //       "Increase budget to 200 then how could another option win?"
    //       "Remove the demand factor, then what would flip the result?"
    //       "Add a new constraint then what would flip the outcome?"
    //       "Change conversion from low to high then what would flip?"
    //   - textual verb-to-X edits separate from the flip span:
    //       "Change marketing channel to TikTok then what would
    //        need to change for another option to look better?"
    //       "Update strategy to premium then how could another option
    //        win?"
    //
    // The narrow flip-overlap exception only applies when the mutation
    // regex's match falls FULLY INSIDE a what_would_flip pattern span
    // (e.g. "change ... to look better" inside the "what would need to
    // change ... look better" pattern). `hasIndependentMutationSignal`
    // strips flip pattern spans before re-checking the verb-to-X
    // mutation pattern, so a separate edit clause survives the strip
    // and forces mutation precedence.
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
