/**
 * V5 Wave 2 — deterministic pre-route for short-confirmation resumes.
 *
 * Inserted into TurnExecutor's lifecycle BEFORE `tryDeterministicValueUpdate`
 * (the existing value-update pre-route). When the user replies with a
 * short confirmation ("yes", "ok", "do it", "go ahead", …) and the
 * previous assistant turn persisted exactly one resumable pending
 * action that is still safe to apply, this module dispatches the
 * matching handler without an LLM round-trip.
 *
 * Resolves only against the LAST assistant turn's pending actions —
 * older orphan offers are ignored. Pure pre-route detector that returns
 * a dispatch decision; the synthesis of `RoutingToolCallResult` happens
 * in the TurnExecutor caller (mirrors `deterministic-value-update.ts`'s
 * separation of detection from dispatch).
 *
 * Wave 2 implementation scope:
 *   - Resumable kind handled today: `run_analysis`.
 *   - Other kinds (`what_would_flip`, `set_factor_value`,
 *     `apply_proposed_change`, `edit_graph_add_risk`) are recognised
 *     as "valid pending actions" but do not yet have a synthesis path
 *     in TurnExecutor; they will be added in Waves 3+ as their emit
 *     sites land. Until then, those kinds appear in `candidates` and
 *     fall through to the LLM (matched=false, skip_reason=
 *     'kind_not_yet_resumable') — never silently misfired.
 *
 * Negative gate: messages containing edit verbs or numeric quantities
 * are NOT short-confirmations. They might be value updates instead and
 * must reach `tryDeterministicValueUpdate` and ultimately the LLM
 * with their full content intact.
 */

import type { PendingAction } from '../session/pending-action.js';
import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
} from '../session/pending-action.js';

/**
 * Short-confirmation regex. Anchored start-to-end so ANY substantive
 * trailing content (edit verbs, quantities, etc.) disqualifies the
 * match. Trailing punctuation, whitespace, and emojis are tolerated.
 *
 * The brief lists at minimum: "yes", "yes please", "do that",
 * "apply it", "go ahead", and chip-click equivalents. The pattern
 * extends those bases with common politeness suffixes ("please",
 * "now", "thanks") and natural variants ("yes do", "yeah ok").
 */
export const SHORT_CONFIRM_PATTERN =
  /^\s*(?:yes|yep|yeah|sure|ok(?:ay)?|do(?:\s+(?:it|that))?|go(?:\s+ahead)?|apply(?:\s+it)?|confirm(?:ed)?|please\s+do|yeah\s+ok|yes\s+do(?:\s+it)?)(?:\s+(?:please|now|thanks|thank\s+you))?[\s.!?\u{1F300}-\u{1FAFF}]*$/iu;

/**
 * Negative gate. If any of these appear in the message, the user is
 * not making a bare confirmation — they're probably typing a fresh
 * request that happens to start with "yes". Stay out of the way.
 */
const EDIT_VERB_OR_QUANTITY_PATTERN =
  /\b(?:increase|decrease|reduce|raise|lower|set|change|update|make|adjust|add|remove|replace|simplif|rebuild)\b|\d/i;

export type ShortConfirmSkipReason =
  | 'no_short_confirm'
  | 'no_pending'
  | 'all_expired'
  | 'kind_not_yet_resumable'
  | 'multiple_ambiguous';

/**
 * Coarse summary of analysis state at resume time. Drives the
 * `what_would_flip` freshness precondition: a stale or missing analysis
 * means resuming what_would_flip would surface a misleading answer, so
 * the resumer downgrades to a `rerun_analysis_required` recovery
 * dispatch with safe assistant text and a `run_analysis` resumer-chip.
 */
export type AnalysisFreshnessAtResume = 'fresh' | 'stale' | 'unknown' | 'none';

export type ShortConfirmDispatch =
  | { readonly matched: false; readonly skip_reason: ShortConfirmSkipReason }
  | {
      readonly matched: true;
      readonly dispatch: 'pending_action';
      readonly pending: PendingAction;
    }
  | {
      readonly matched: true;
      readonly dispatch: 'recovery_expired';
      readonly expired_count: number;
    }
  | {
      readonly matched: true;
      readonly dispatch: 'recovery_ambiguous';
      readonly candidates: readonly PendingAction[];
    }
  | {
      readonly matched: true;
      readonly dispatch: 'rerun_analysis_required';
      readonly pending: PendingAction;
    };

export interface TryShortConfirmResumeInput {
  readonly message: string;
  /**
   * Pending actions read from the most recent prior turn via
   * `SessionStore.readMostRecentPendingActions`. The list is already
   * scoped to the current scenario.
   */
  readonly pendingActions: readonly PendingAction[];
  /** Number of prior turns in the conversation history. */
  readonly currentTurnIndex: number;
  /**
   * `Date.now()` at the time of dispatch. Plumbed in for testability —
   * unit tests freeze the clock without monkey-patching `Date`.
   */
  readonly nowMs: number;
  /**
   * Coarse freshness verdict for the live analysis at resume time. If
   * absent, defaults to `'unknown'` — the freshness-sensitive resume
   * paths (`what_would_flip`) treat that as not-fresh and downgrade
   * to a rerun-analysis recovery rather than running a stale answer.
   */
  readonly analysisFreshness?: AnalysisFreshnessAtResume;
}

/**
 * Pending-action kinds that have a synthesis path in TurnExecutor.
 *
 * Each kind here carries enough state on the `PendingAction.action`
 * payload that a bare confirmation ("yes", "do it") can resume it
 * without further user input:
 *   - `run_analysis`           — no params; the handler reads scenario state
 *   - `what_would_flip`        — no params; reads the live analysis projection
 *
 * The remaining kinds (`set_factor_value`, `apply_proposed_change`,
 * `edit_graph_add_risk`) are persisted but resume requires either a
 * follow-up driver/parameter or a label-match pre-route that
 * disambiguates between candidates of the same kind (e.g. user types
 * "Engineering Budget" alone after a multi-candidate clarify). That
 * pre-route is the bounded follow-up for full clarification
 * continuity; until it lands those kinds are deliberately excluded
 * from the bare-confirm resumer.
 */
const RESUMABLE_KINDS: ReadonlySet<PendingAction['action']['kind']> = new Set([
  'run_analysis',
  'what_would_flip',
]);

function isExpired(pa: PendingAction, nowMs: number, currentTurnIndex: number): boolean {
  // Wall-clock TTL: emitted_at_iso + expires_at_iso are both written
  // at emit time. We trust expires_at_iso as the canonical expiry.
  const expiresMs = Date.parse(pa.expires_at_iso);
  if (!Number.isFinite(expiresMs)) {
    // Defence-in-depth: malformed expiry → treat as expired so we never
    // silently resume an action whose freshness we can't verify.
    return true;
  }
  if (nowMs > expiresMs) return true;
  // Turn-count TTL: emitted_in_turn N, expires after expires_at_turn_count.
  // currentTurnIndex is the count of prior turns; if more than
  // expires_at_turn_count have elapsed since the offer, expire.
  // We don't store the emit-time turn index — instead we rely on the
  // fact that `pendingActions` is read from the MOST RECENT prior turn
  // only, so the offer is at most one turn old. The turn-count TTL
  // becomes a wall TTL for Wave 2; it will tighten in Wave 3 when
  // multi-turn pending actions are persisted (e.g. add-risk clarify).
  if (pa.expires_at_turn_count <= 0) return true;
  return false;
}

export function tryShortConfirmResume(
  input: TryShortConfirmResumeInput,
): ShortConfirmDispatch {
  // Negative gate first — cheapest. A "yes" with edit verbs is a fresh
  // request, not a confirmation.
  if (EDIT_VERB_OR_QUANTITY_PATTERN.test(input.message)) {
    return { matched: false, skip_reason: 'no_short_confirm' };
  }
  if (!SHORT_CONFIRM_PATTERN.test(input.message)) {
    return { matched: false, skip_reason: 'no_short_confirm' };
  }
  if (input.pendingActions.length === 0) {
    return { matched: false, skip_reason: 'no_pending' };
  }

  // Split into expired and live so we can surface focused recovery copy
  // when the only thing the user could have been saying yes to is gone.
  const expired = input.pendingActions.filter((pa) =>
    isExpired(pa, input.nowMs, input.currentTurnIndex),
  );
  const live = input.pendingActions.filter(
    (pa) => !isExpired(pa, input.nowMs, input.currentTurnIndex),
  );
  if (live.length === 0) {
    // The user said "yes" but every offer they could have meant has
    // expired. Surface a focused recovery rather than falling through
    // to the LLM, where a generic direct_answer would lose context.
    return { matched: true, dispatch: 'recovery_expired', expired_count: expired.length };
  }

  // Filter to kinds with a synthesis path.
  const resumable = live.filter((pa) => RESUMABLE_KINDS.has(pa.action.kind));
  if (resumable.length === 0) {
    // Pending action is live but its kind is not yet wired in
    // TurnExecutor. Fall through to the LLM rather than misfire.
    return { matched: false, skip_reason: 'kind_not_yet_resumable' };
  }
  if (resumable.length > 1) {
    // Multiple resumable pending actions — ask a focused clarification
    // rather than guessing or letting the LLM see a bare "yes".
    return { matched: true, dispatch: 'recovery_ambiguous', candidates: resumable };
  }

  const pending = resumable[0]!;

  // Freshness precondition for what_would_flip: if analysis is missing
  // or stale, do not resume. The whole point of "what would flip" is
  // about the live analysis result — running it against stale or
  // absent data would surface a misleading answer. Downgrade to a
  // rerun_analysis_required recovery so the user can refresh first.
  if (
    pending.action.kind === 'what_would_flip' &&
    (input.analysisFreshness ?? 'unknown') !== 'fresh'
  ) {
    return { matched: true, dispatch: 'rerun_analysis_required', pending };
  }

  return { matched: true, dispatch: 'pending_action', pending };
}

/**
 * Default lifecycle bound re-exports for callers that need to reason
 * about expiry without crossing into the session module. Single source
 * of truth lives in `pending-action.ts`.
 */
export { PENDING_ACTION_DEFAULT_TURN_TTL, PENDING_ACTION_DEFAULT_WALL_TTL_MS };
