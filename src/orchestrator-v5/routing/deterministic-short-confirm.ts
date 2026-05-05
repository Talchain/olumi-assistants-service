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
 * content disqualifies the match (e.g. "yes please run it now and …"
 * is treated as a free-text turn, not a confirmation, because the
 * trailing free text could carry edit verbs the LLM should reason
 * over). Trailing punctuation, whitespace, and emojis are tolerated.
 */
export const SHORT_CONFIRM_PATTERN =
  /^\s*(?:yes|yep|yeah|sure|ok(?:ay)?|do(?:\s+(?:it|that))?|go(?:\s+ahead)?|apply(?:\s+it)?|confirm(?:ed)?|please\s+do)[\s.!?\u{1F300}-\u{1FAFF}]*$/iu;

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

export type ShortConfirmDispatch =
  | { readonly matched: false; readonly skip_reason: ShortConfirmSkipReason }
  | {
      readonly matched: true;
      readonly dispatch: 'pending_action';
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
}

/**
 * Wave 2: only `run_analysis` has a resume synthesis path in
 * TurnExecutor today. Future kinds will join this set as their emit
 * sites and synthesis paths land in later waves.
 */
const WAVE2_RESUMABLE_KINDS: ReadonlySet<PendingAction['action']['kind']> =
  new Set(['run_analysis']);

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

  // Filter to non-expired.
  const live = input.pendingActions.filter(
    (pa) => !isExpired(pa, input.nowMs, input.currentTurnIndex),
  );
  if (live.length === 0) {
    return { matched: false, skip_reason: 'all_expired' };
  }

  // Filter to kinds Wave 2 can resume.
  const resumable = live.filter((pa) => WAVE2_RESUMABLE_KINDS.has(pa.action.kind));
  if (resumable.length === 0) {
    // Pending action is live but its kind is not yet wired in
    // TurnExecutor. Fall through to the LLM rather than misfire.
    return { matched: false, skip_reason: 'kind_not_yet_resumable' };
  }
  if (resumable.length > 1) {
    // Multiple resumable pending actions of distinct kinds — Wave 2
    // doesn't disambiguate. Fall through to the LLM. Wave 3 adds a
    // focused clarify path with one chip per candidate.
    return { matched: false, skip_reason: 'multiple_ambiguous' };
  }

  return { matched: true, dispatch: 'pending_action', pending: resumable[0]! };
}

/**
 * Default lifecycle bound re-exports for callers that need to reason
 * about expiry without crossing into the session module. Single source
 * of truth lives in `pending-action.ts`.
 */
export { PENDING_ACTION_DEFAULT_TURN_TTL, PENDING_ACTION_DEFAULT_WALL_TTL_MS };
