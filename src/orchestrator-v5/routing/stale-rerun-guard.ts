/**
 * V5 Context Management v1 — stale-rerun sibling guard.
 *
 * Short-circuits the case where prior analysis is NOT confirmed current
 * AND the user is asking an analytical question AND there is no
 * INDEPENDENT mutation signal. Two non-current verdicts are owned here
 * (Mission 1 context-authority pass):
 *
 *   `stale`   — the graph hash recorded on the latest successful
 *               run_analysis fact differs from the current graph hash.
 *               The model is KNOWN to have changed, so the copy may
 *               assert it ("The graph has changed…").
 *   `unknown` — currency cannot be confirmed (legacy fact missing its
 *               run-time hash, or the current graph could not be hashed
 *               this turn). Tier 0 doctrine: treat as stale for
 *               user-facing freshness but do NOT assert the model
 *               changed — authority parity forbids claiming a state we
 *               cannot prove. Copy comes from the shared
 *               `buildAnalysisUnconfirmedTemplate`, the same source the
 *               explanation handlers use, so the two unconfirmed
 *               surfaces cannot drift. Before this pass, `unknown`
 *               analytical questions fell through every deterministic
 *               guard to broad LLM routing, which received no freshness
 *               token at all and could present stale results as
 *               current.
 *
 * Flip-overlap exception (Issue #195): canonical what-would-flip
 * phrasings ("what would need to change for another option to look
 * better?") trip the broad mutation-signal patterns purely through
 * flip-pattern overlap. The advice gate and the fresh-followup guard
 * already carry the `what_would_flip` + `!hasIndependentMutationSignal`
 * exception; this guard lacked it, so on stale analyses exactly those
 * phrasings were declined `mutation_signal` here, then `not_fresh` by
 * the advice gate, and fell to the broad routing LLM (~11s, no
 * staleness cue in the prompt). The exception closes that residual: a
 * mutation signal only declines when it survives the flip-pattern strip
 * (a genuine edit clause), preserving mutation precedence bit-for-bit
 * for real edits.
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
 * otherwise. This guard runs BEFORE the gate on the non-current path so
 * the fresh-path behaviour (and its tests) stay identical.
 */

import {
  classifyAnalyticalIntent,
  hasIndependentMutationSignal,
  hasMutationSignal,
  type AnalyticalIntentClass,
} from './analytical-intent.js';
import { buildAnalysisUnconfirmedTemplate } from '../tools/handlers/no-op-helpers.js';

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
  /** Freshness is `fresh` or `none` — nothing non-current to caveat.
   *  (Name kept for telemetry continuity; `unknown` now MATCHES.) */
  | 'not_stale'
  | 'mutation_signal'
  | 'no_analytical_signal'
  | 'empty_message';

export type StaleRerunGuardResult =
  | {
      readonly matched: true;
      /**
       * Copy register: `stale` asserts the model changed (hashes known
       * to differ); `unconfirmed` only says currency cannot be
       * confirmed (freshness `unknown` — authority parity, never claim
       * a change we cannot prove).
       */
      readonly mode: 'stale' | 'unconfirmed';
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
export const RERUN_ACTION: StaleRerunSuggestedAction = Object.freeze({
  id: 'chip_action_rerun_analysis',
  label: 'Re-run analysis',
  message: 'Re-run the analysis.',
  action_type: 'run_analysis' as const,
});

export function tryStaleRerunGuard(
  input: StaleRerunGuardInput,
): StaleRerunGuardResult {
  const verdict = input.freshness;
  if (verdict !== 'stale' && verdict !== 'unknown') {
    return { matched: false, reason: 'not_stale' };
  }
  const message = input.message.trim();
  if (message.length === 0) {
    return { matched: false, reason: 'empty_message' };
  }
  const cls = classifyAnalyticalIntent(message);
  if (hasMutationSignal(message)) {
    // Flip-overlap exception (Issue #195): a canonical what-would-flip
    // phrasing whose ONLY mutation signal comes from flip-pattern
    // overlap stays analytical. A genuine edit clause survives the
    // flip-pattern strip and keeps mutation precedence.
    const allowFlipException =
      cls === 'what_would_flip' && !hasIndependentMutationSignal(message);
    if (!allowFlipException) {
      return { matched: false, reason: 'mutation_signal' };
    }
  }
  if (cls === null) {
    return { matched: false, reason: 'no_analytical_signal' };
  }
  if (verdict === 'stale') {
    return {
      matched: true,
      mode: 'stale',
      intent_class: cls,
      assistant_text: ASSISTANT_TEXT,
      suggested_actions: [RERUN_ACTION],
    };
  }
  // freshness === 'unknown' — unconfirmed currency. Shared template so
  // this guard and the explanation handlers speak with one voice; it
  // deliberately does NOT assert the model changed.
  return {
    matched: true,
    mode: 'unconfirmed',
    intent_class: cls,
    assistant_text: buildAnalysisUnconfirmedTemplate(),
    suggested_actions: [RERUN_ACTION],
  };
}
