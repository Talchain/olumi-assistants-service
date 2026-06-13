/**
 * V5 Context Management v1 — stale-rerun / freshness-status sibling guard.
 *
 * Two deterministic short-circuits, both for an analytical question with no
 * concrete mutation signal:
 *
 *   - STALE path: prior analysis is `stale` (graph hash on the latest
 *     successful run_analysis fact differs from the current graph hash) AND
 *     the user asks any analytical question → nudge re-run, naming the
 *     applied change where a display-safe summary is available (V5-WAVE-2
 *     PR-C).
 *   - FRESH freshness-status path (V5-WAVE-2 PR-C): the analysis is `fresh`
 *     AND the user asks a freshness-status question specifically
 *     (`rerun_question`, e.g. "Is this analysis still up to date?") → a crisp
 *     "still current, no need to re-run" answer. This closes the J3 failure
 *     where the positive "up to date" phrasing classified as null intent,
 *     fell through to the LLM, and tripped the egress copy-policy guard
 *     ("previous/prior analysis") to the generic fallback. Other fresh
 *     analytical intents (explain / what_drove / what_would_flip) are NOT
 *     intercepted here — they flow to the post-analysis advice gate.
 *
 * Routes to a deterministic direct_answer, mirroring the Phase 3 stale-safe
 * coaching block strings in `compose/phase3-blocks.ts`
 * (`buildStaleRerunCoachingBlock`) — same title/body/action shape, but
 * emitted as a direct-answer turn rather than a Phase 3 block (Phase 3
 * blocks only fire off run_analysis handler facts).
 *
 * Sibling to `tryPostAnalysisAdviceGate`: the gate already short-
 * circuits only on `freshness === 'fresh'` and returns `not_fresh`
 * otherwise. This guard runs BEFORE the gate on the stale path so the
 * fresh-path behaviour (and its tests) stay identical.
 */

import {
  classifyAnalyticalIntent,
  hasMutationSignal,
  type AnalyticalIntentClass,
} from './analytical-intent.js';

export type StaleRerunFreshness = 'fresh' | 'stale' | 'unknown' | 'none';

export interface StaleRerunSuggestedAction {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type: 'run_analysis';
}

export interface StaleRerunGuardInput {
  readonly message: string;
  readonly freshness: StaleRerunFreshness | null | undefined;
  /**
   * V5-WAVE-2 PR-C: the most recent change summary (verbatim, already
   * display-safe — the same `recent_changes[0].summary` the state-query
   * guard quotes). When present on the STALE path, it is named in the
   * re-run copy so the user sees WHY the analysis is out of date. Absent /
   * empty → the copy is byte-identical to the prior wording.
   */
  readonly recentChangeSummary?: string | null;
}

export type StaleRerunUnmatchedReason =
  | 'not_stale'
  | 'mutation_signal'
  | 'no_analytical_signal'
  | 'empty_message';

export type StaleRerunGuardResult =
  | {
      readonly matched: true;
      readonly intent_class: AnalyticalIntentClass;
      readonly assistant_text: string;
      readonly suggested_actions: readonly StaleRerunSuggestedAction[];
    }
  | {
      readonly matched: false;
      readonly reason: StaleRerunUnmatchedReason;
    };

/**
 * Title + body strings mirror `buildStaleRerunCoachingBlock` in
 * compose/phase3-blocks.ts so the deterministic copy is consistent
 * across the Phase 3 block surface and this pre-router guard. The
 * direct-answer turn cannot render block-shaped titles, so the body
 * is the user-facing line; the title concept survives as the lead
 * clause of the same sentence.
 */
const ASSISTANT_TEXT =
  'The graph has changed since the last analysis. '
  + 'Re-run analysis to refresh the insights and explore the updated decision.';

/**
 * V5-WAVE-2 PR-C — crisp "still current" answer for a freshness-status
 * question ("Is this analysis still up to date?") asked on a FRESH analysis.
 * British English; no em dashes; no internal terms; contains no
 * FORBIDDEN_USER_FACING_PHRASES entry (notably avoids "previous/prior
 * analysis" and the "no/nothing changed" denial forms — says "the model has
 * not changed since it last ran").
 */
const CURRENT_TEXT =
  'Yes, this analysis is still current. The model has not changed since it '
  + 'last ran, so there is no need to re-run it.';

/**
 * Compose the stale re-run copy, naming the applied change as a leading
 * sentence when a display-safe summary is available (V5-WAVE-2 PR-C). The
 * summary is the verbatim `recent_changes[0].summary` the state-query guard
 * already quotes, so it carries no raw IDs or internal terms. Absent / empty
 * → the original `ASSISTANT_TEXT` verbatim (no behaviour change).
 */
function composeStaleText(recentChangeSummary?: string | null): string {
  const named =
    typeof recentChangeSummary === 'string' && recentChangeSummary.trim().length > 0
      ? `${recentChangeSummary.trim()} `
      : '';
  return `${named}${ASSISTANT_TEXT}`;
}

/**
 * Suggested-action shape mirrors the stale-rerun chip already used at
 * turn-executor.ts:1277–1284 (the what_would_flip stale recovery path)
 * so the run_analysis chip looks identical to other rerun nudges.
 */
const RERUN_ACTION: StaleRerunSuggestedAction = Object.freeze({
  id: 'chip_action_rerun_analysis',
  label: 'Re-run analysis',
  message: 'Re-run the analysis.',
  action_type: 'run_analysis' as const,
});

export function tryStaleRerunGuard(
  input: StaleRerunGuardInput,
): StaleRerunGuardResult {
  const message = input.message.trim();
  if (message.length === 0) {
    return { matched: false, reason: 'empty_message' };
  }

  // V5-WAVE-2 PR-C — freshness-status question on a CURRENT analysis.
  // "Is this analysis still up to date?" on a fresh analysis gets a crisp
  // "still current" answer here, rather than falling through to the
  // fresh-analysis follow-up recap (or, before the classifier gap at
  // analytical-intent.ts was closed, an LLM answer that tripped the egress
  // copy-policy guard). Scoped to `rerun_question` ONLY — explain /
  // what_drove / what_would_flip on a fresh analysis still flow to the
  // post-analysis advice gate for grounded answers. Mutation still wins (a
  // concrete edit must reach the edit path). Runs before the stale branch.
  if (input.freshness === 'fresh') {
    if (hasMutationSignal(message)) {
      return { matched: false, reason: 'mutation_signal' };
    }
    if (classifyAnalyticalIntent(message) === 'rerun_question') {
      return {
        matched: true,
        intent_class: 'rerun_question',
        assistant_text: CURRENT_TEXT,
        suggested_actions: [],
      };
    }
    return { matched: false, reason: 'not_stale' };
  }

  if (input.freshness !== 'stale') {
    return { matched: false, reason: 'not_stale' };
  }
  if (hasMutationSignal(message)) {
    return { matched: false, reason: 'mutation_signal' };
  }
  const cls = classifyAnalyticalIntent(message);
  if (cls === null) {
    return { matched: false, reason: 'no_analytical_signal' };
  }
  return {
    matched: true,
    intent_class: cls,
    assistant_text: composeStaleText(input.recentChangeSummary),
    suggested_actions: [RERUN_ACTION],
  };
}
