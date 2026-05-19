/**
 * V5 Context Management v1 — stale-rerun sibling guard.
 *
 * Short-circuits the narrow case where prior analysis is `stale`
 * (graph hash recorded on the latest successful run_analysis fact
 * differs from the current graph hash) AND the user is asking an
 * analytical question AND there is no concrete mutation signal.
 *
 * Routes to a deterministic direct_answer that nudges re-run, mirroring
 * the Phase 3 stale-safe coaching block strings in
 * `compose/phase3-blocks.ts` (`buildStaleRerunCoachingBlock`) — same
 * title/body/action shape, but emitted as a direct-answer turn rather
 * than a Phase 3 block (Phase 3 blocks only fire off run_analysis
 * handler facts).
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
  if (input.freshness !== 'stale') {
    return { matched: false, reason: 'not_stale' };
  }
  const message = input.message.trim();
  if (message.length === 0) {
    return { matched: false, reason: 'empty_message' };
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
    assistant_text: ASSISTANT_TEXT,
    suggested_actions: [RERUN_ACTION],
  };
}
