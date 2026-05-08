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
 * Resumable kinds today:
 *   - `run_analysis` and `what_would_flip` (Wave 2).
 *   - `apply_proposed_change` (V5 G7/G8): TurnExecutor calls
 *     `decideProposedChangeSynthesis` after this resumer matches, to
 *     check graph-hash divergence and idempotency before dispatching
 *     the handler indicated by `inline_patch.handler_id`.
 *
 *   The remaining kinds (`set_factor_value`, `edit_graph_add_risk`)
 *   are recognised as "valid pending actions" but do not yet have a
 *   synthesis path in TurnExecutor; they will be added when their
 *   resume drivers land. Until then, those kinds appear in
 *   `candidates` and fall through to the LLM (matched=false,
 *   skip_reason='kind_not_yet_resumable') — never silently misfired.
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
 *
 * EXCEPTION: when at least one live `apply_proposed_change` pending
 * action exists, `PROPOSAL_CONFIRM_PATTERN` overrides this gate for
 * proposal-targeted phrases like "add that" / "make that change".
 * Those edit verbs are part of an idiomatic confirmation, not a
 * fresh request, when the assistant has just offered a matching
 * proposal.
 */
const EDIT_VERB_OR_QUANTITY_PATTERN =
  /\b(?:increase|decrease|reduce|raise|lower|set|change|update|make|adjust|add|remove|replace|simplif|rebuild)\b|\d/i;

/**
 * Proposal-targeted confirmation phrases. Match ONLY when at least
 * one live `apply_proposed_change` pending action exists, and override
 * the edit-verb gate. The brief explicitly lists "add that" and
 * "make that change" as required deterministic confirmations.
 */
export const PROPOSAL_CONFIRM_PATTERN =
  /^\s*(?:add\s+that|make\s+that(?:\s+change)?|do\s+that\s+change|apply\s+that(?:\s+change)?|let'?s\s+(?:do\s+that|apply\s+that))(?:\s+(?:please|now|thanks|thank\s+you))?[\s.!?\u{1F300}-\u{1FAFF}]*$/iu;

/**
 * Phrasal-ordinal confirmation patterns. When at least one live
 * `apply_proposed_change` pending action exists and the message is
 * an ordinal pointer ("the first one", "first", "option 2", "#3"),
 * the resumer resolves the indexed proposal directly without
 * routing through `recovery_ambiguous`. The brief lists these as
 * deterministic resolutions.
 */
const ORDINAL_WORD_PATTERN =
  /^\s*(?:the\s+)?(first|second|third|fourth|fifth)(?:\s+(?:one|option|choice))?(?:\s+(?:please|now|thanks|thank\s+you))?[\s.!?]*$/iu;
const ORDINAL_DIGIT_PATTERN =
  /^\s*(?:#|option\s+|number\s+|the\s+)?(\d{1,2})(?:\s+(?:one|option|choice))?(?:\s+(?:please|now|thanks|thank\s+you))?[\s.!?]*$/iu;
const ORDINAL_WORD_TO_INDEX: ReadonlyMap<string, number> = new Map([
  ['first', 0],
  ['second', 1],
  ['third', 2],
  ['fourth', 3],
  ['fifth', 4],
]);
function tryParseOrdinalIndex(message: string): number | null {
  const word = ORDINAL_WORD_PATTERN.exec(message);
  if (word !== null) {
    const idx = ORDINAL_WORD_TO_INDEX.get(word[1]!.toLowerCase());
    return idx ?? null;
  }
  const digit = ORDINAL_DIGIT_PATTERN.exec(message);
  if (digit !== null) {
    const n = Number.parseInt(digit[1]!, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    return n - 1;
  }
  return null;
}

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
 *   - `apply_proposed_change`  — `inline_patch.handler_id` plus `params`
 *                                and `target_entity_ids` carry the full
 *                                replay payload. Hash divergence and
 *                                idempotency are enforced by
 *                                `decideProposedChangeSynthesis` in
 *                                TurnExecutor before dispatch.
 *
 * The remaining kinds (`set_factor_value`, `edit_graph_add_risk`) are
 * persisted but resume requires either a follow-up driver/parameter
 * or a label-match pre-route that disambiguates between candidates of
 * the same kind (e.g. user types "Engineering Budget" alone after a
 * multi-candidate clarify). That pre-route is the bounded follow-up
 * for full clarification continuity; until it lands those kinds are
 * deliberately excluded from the bare-confirm resumer.
 */
const RESUMABLE_KINDS: ReadonlySet<PendingAction['action']['kind']> = new Set([
  'run_analysis',
  'what_would_flip',
  'apply_proposed_change',
]);

function isExpired(pa: PendingAction, nowMs: number, _currentTurnIndex: number): boolean {
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
  // Pre-compute live apply_proposed_change candidates once. They unlock
  // two pre-route branches: (1) PROPOSAL_CONFIRM_PATTERN bypasses the
  // edit-verb gate for proposal-targeted phrases ("add that", "make
  // that change"); (2) ordinal pointers ("the first one", "option 2")
  // resolve directly to the indexed proposal without going through
  // `recovery_ambiguous`.
  const liveApplyProposed = input.pendingActions.filter(
    (pa) =>
      pa.action.kind === 'apply_proposed_change' &&
      !isExpired(pa, input.nowMs, input.currentTurnIndex),
  );

  // Phrasal-ordinal pre-resolve. Only fires when at least one live
  // apply_proposed_change exists. Single-proposal "the first one"
  // resolves to that one offer; multi-proposal ordinal picks the
  // indexed candidate. This deliberately short-circuits
  // `recovery_ambiguous` so deterministic ordinal picks never produce
  // a clarification round-trip.
  if (liveApplyProposed.length > 0) {
    const ordinalIdx = tryParseOrdinalIndex(input.message);
    if (ordinalIdx !== null && ordinalIdx >= 0 && ordinalIdx < liveApplyProposed.length) {
      return {
        matched: true,
        dispatch: 'pending_action',
        pending: liveApplyProposed[ordinalIdx]!,
      };
    }
  }

  // Edit-verb / numeric-quantity gate. Override only when a live
  // apply_proposed_change exists AND the message matches a
  // proposal-targeted confirmation phrase ("add that" / "make that
  // change" / "apply that change").
  const isProposalConfirm =
    liveApplyProposed.length > 0 && PROPOSAL_CONFIRM_PATTERN.test(input.message);
  if (EDIT_VERB_OR_QUANTITY_PATTERN.test(input.message) && !isProposalConfirm) {
    return { matched: false, skip_reason: 'no_short_confirm' };
  }
  if (!SHORT_CONFIRM_PATTERN.test(input.message) && !isProposalConfirm) {
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
  let resumable = live.filter((pa) => RESUMABLE_KINDS.has(pa.action.kind));
  // PROPOSAL_CONFIRM_PATTERN is unambiguous about proposal intent —
  // narrow the resumable set to apply_proposed_change candidates only,
  // even if other resumable kinds (e.g. run_analysis) are also live.
  if (isProposalConfirm) {
    resumable = resumable.filter((pa) => pa.action.kind === 'apply_proposed_change');
  }
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
