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
 *   are recognised as "valid pending actions" but are CLARIFICATION
 *   continuations, not bare-confirm resumables: their drivers live in
 *   `tryClarificationResume` (label answer / driver answer), not here.
 *   In this module those kinds appear in `candidates` and fall through
 *   to the LLM (matched=false, skip_reason='kind_not_yet_resumable') —
 *   never silently misfired.
 *
 * Negative gate: messages containing edit verbs or numeric quantities
 * are NOT short-confirmations. They might be value updates instead and
 * must reach `tryDeterministicValueUpdate` and ultimately the LLM
 * with their full content intact.
 */

import type { PendingAction } from '../session/pending-action.js';
import {
  CONFIRMATION_EXPECTING_ACTION_TYPES,
  isPendingActionExpired,
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
 *
 * P1a (real-user run 2026-07-17, scenario c510030e): the GM held ask
 * copy invites "Reply yes to continue", and a real user naturally
 * OVER-answers with a DOUBLED confirmation ("Yes, go ahead" / "yeah
 * go ahead" / "ok proceed") — the exact P1a repro. The pre-fix pattern
 * recognised a SINGLE confirmation token only, so those fell to the LLM
 * router, which role-played agreement while nothing applied. The
 * OPTIONAL leading-affirmative prefix below (`yes|yeah|yep|sure|ok`
 * plus a comma/whitespace/"and" separator) lets one affirmative precede
 * a second confirmation phrase, so a doubled confirmation resolves the
 * lone live hold. It stays anchored start-to-end and carries NO edit
 * verb / quantity, so the negative gate still owns fresh requests that
 * merely start with "yes" ("yes change the timeframe", "yes option 2").
 */
export const SHORT_CONFIRM_PATTERN =
  /^\s*(?:(?:yes|yep|yeah|sure|ok(?:ay)?)[,\s]+(?:and\s+)?)?(?:yes|yep|yeah|sure|ok(?:ay)?|do(?:\s+(?:it|that))?|go(?:\s+ahead)?|apply(?:\s+(?:it|them|these))?|confirm(?:ed)?|please\s+do|proceed|yeah\s+ok|yes\s+do(?:\s+it)?)(?:\s+(?:please|now|thanks|thank\s+you))?[\s.!?\u{1F300}-\u{1FAFF}]*$/iu;

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
 * the edit-verb gate. The brief explicitly lists "add that",
 * "make that change", and (V5 P0.2) "make that update" as required
 * deterministic confirmations. The Signature Loop lane adds "try that",
 * "test that", and "update the model" (and "try/test the model"). The
 * trailing noun is one of change|update|edit so "make that update" /
 * "apply that update" / "do that edit" all resolve, while the noun stays
 * optional for the bare "make that" / "try that" forms. Still anchored
 * ^...$ so any extra content ("make that change to pricing", "update the
 * model to include churn") disqualifies the match and falls to the normal
 * edit / value-update path — only an anchored, content-free confirmation
 * resolves a pending proposal.
 */
export const PROPOSAL_CONFIRM_PATTERN =
  /^\s*(?:add\s+that|make\s+that(?:\s+(?:change|update|edit))?|do\s+that\s+(?:change|update|edit)|apply\s+that(?:\s+(?:change|update|edit))?|try\s+that(?:\s+(?:change|update|edit|one))?|test\s+that(?:\s+(?:change|update|edit|one))?|(?:update|try|test)\s+the\s+model|let'?s\s+(?:do\s+that|apply\s+that|try\s+that|test\s+that))(?:\s+(?:please|now|thanks|thank\s+you))?[\s.!?\u{1F300}-\u{1FAFF}]*$/iu;

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
 * CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11) — "all of them" pattern.
 *
 * Recognised ONLY while at least one live consent-expecting pending
 * exists, and ONLY for EXPLICIT collective forms: "all of them" /
 * "all of those" / "all of it" / "both of them" / "apply all" /
 * "apply both" / "apply them all" / "yes to all". The disambiguation
 * chip sends "All of them.", so the chip path always resolves.
 *
 * Deliberately EXCLUDED (adversarial review, 2026-07-11): bare "all" /
 * "both" / "do all". A bare "both" is routinely the answer to an
 * UNRELATED assistant question ("which options should I compare?" →
 * "both"); binding it to live consents would fire an unintended
 * multi-mutation — the exact intent-mismatch class the amendment
 * targets. Bare forms fall through to the normal gates (and the LLM)
 * untouched.
 *
 * Anchored start-to-end with the usual politeness/punctuation tail so
 * any substantive content ("all of the numbers") falls through.
 */
export const CONSENT_RESOLVE_ALL_PATTERN =
  /^\s*(?:all\s+of\s+(?:them|those|it)|both\s+of\s+(?:them|those)|yes\s+to\s+all|apply\s+(?:them\s+all|all(?:\s+of\s+(?:them|those))?|both(?:\s+of\s+(?:them|those))?))(?:\s+(?:please|now|thanks|thank\s+you))?[\s.!?\u{1F300}-\u{1FAFF}]*$/iu;

/**
 * Order consent-expecting candidates for LISTING and for ordinal
 * resolution: `apply_proposed_change` entries first (in input order —
 * the read side places the freshest first), then `proposed_concept`.
 * This keeps the numbered list the executor renders aligned with the
 * ordinal pre-resolve above, which indexes into the live
 * `apply_proposed_change` set: "1" always means the first listed item.
 */
export function orderConsentCandidates(
  candidates: readonly PendingAction[],
): readonly PendingAction[] {
  return [
    ...candidates.filter((pa) => pa.action.kind === 'apply_proposed_change'),
    ...candidates.filter((pa) => pa.action.kind !== 'apply_proposed_change'),
  ];
}

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
      /**
       * CONSENT-CLARITY AMENDMENT — the user answered the multi-consent
       * disambiguation (or typed it unprompted) with an "all of them"
       * confirmation. `candidates` carries every live consent-expecting
       * pending in listing order (see `orderConsentCandidates`). The
       * executor applies them together only where a safe direct-apply
       * path exists (GM holds); otherwise it lists them honestly and
       * takes them one at a time — never a silent partial apply.
       */
      readonly matched: true;
      readonly dispatch: 'consent_all';
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
 * persisted but resume requires a follow-up driver/parameter or a
 * label match — that continuity lives in `tryClarificationResume`
 * (the label-answer pre-route for set_factor_value; the F-HELD 4b
 * driver-answer pre-route for edit_graph_add_risk), so those kinds
 * stay deliberately excluded from the bare-confirm resumer.
 *
 * `proposed_concept` is ALSO excluded here. It IS confirmation-expecting
 * (it flips `pending_confirmation` — Track 2's
 * `CONFIRMATION_EXPECTING_ACTION_TYPES`), but it resumes through the
 * dedicated proposal-continuation path (`decideNoOpRecovery` /
 * `resolveProposalResume` in `edit-graph-dispatch`, which emits a Stage-1/2
 * clarifier on agreement), NOT this generic bare-confirm set. So
 * "confirmation-expecting" and "bare-confirm-resumable" are distinct: this
 * set is the latter only.
 */
const RESUMABLE_KINDS: ReadonlySet<PendingAction['action']['kind']> = new Set([
  'run_analysis',
  'what_would_flip',
  'apply_proposed_change',
]);

function isExpired(pa: PendingAction, nowMs: number, _currentTurnIndex: number): boolean {
  // Track 2: delegates to the shared read-time liveness authority in
  // session/pending-action.ts (extracted verbatim from this function).
  // Semantics unchanged: malformed expires_at_iso → expired; wall-clock
  // nowMs > expires_at_iso → expired; expires_at_turn_count <= 0 → expired.
  // currentTurnIndex remains unused — `pendingActions` is read from the
  // MOST RECENT prior turn only, so the offer is at most one turn old;
  // the persisted turn counter (decremented by carry-forward) is the
  // turn-TTL authority.
  return isPendingActionExpired(pa, nowMs);
}

/** Emit timestamp in ms for most-recent-wins ordering; malformed → oldest. */
function emittedAtMs(pa: PendingAction): number {
  const ms = Date.parse(pa.emitted_at_iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * F-HELD round 2 (FIXUP 1) — intent-vs-kind guard for chip-click resumes.
 *
 * A chip click carries an EXPLICIT intent: route-v2's
 * `detectChipClickResumeIntent` maps a `what_would_flip` chip click to the
 * TurnExecutor option `chipClickResumeIntent`, and the executor feeds the
 * resumer a SYNTHETIC "yes". That synthetic confirmation must only ever
 * resolve pendings of the CLICKED kind — without this scope, the F-HELD
 * consent-priority pick would prefer a live `apply_proposed_change` hold
 * over the wwf pending and EXECUTE a held graph mutation off an explanation
 * click (the hold's hash gate passes because analysis does not mutate the
 * graph). Callers apply this BEFORE `tryShortConfirmResume`.
 *
 * Typed confirmations (no intent flag) pass through untouched — the
 * consent-priority ruling governs a genuine bare "yes", not a click whose
 * intent the user already named. When the scope empties the set, the
 * resumer returns `no_pending` and the chip-click no-pending recovery owns
 * the turn (an honest "that offer is no longer available"), never the hold.
 */
export function scopePendingsToChipClickIntent(
  pendings: readonly PendingAction[],
  chipClickResumeIntent: 'what_would_flip' | undefined,
): readonly PendingAction[] {
  if (chipClickResumeIntent !== 'what_would_flip') return pendings;
  return pendings.filter((pa) => pa.action.kind === 'what_would_flip');
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

  // CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11) — "all of them".
  // Checked BEFORE the bare-confirm pattern gates because "all of them"
  // is not a SHORT_CONFIRM phrase, and before the edit-verb gate because
  // "apply all" / "do all" carry no edit verb but must still resolve
  // deterministically. Fires only when at least one LIVE consent-
  // expecting pending exists — with none, the message falls through to
  // the normal gates (and ultimately the LLM) untouched.
  const liveConsentExpectingAll = orderConsentCandidates(
    input.pendingActions.filter(
      (pa) =>
        CONFIRMATION_EXPECTING_ACTION_TYPES.has(pa.action.kind) &&
        !isExpired(pa, input.nowMs, input.currentTurnIndex),
    ),
  );
  if (
    liveConsentExpectingAll.length > 0 &&
    CONSENT_RESOLVE_ALL_PATTERN.test(input.message)
  ) {
    if (liveConsentExpectingAll.length > 1) {
      return {
        matched: true,
        dispatch: 'consent_all',
        candidates: liveConsentExpectingAll,
      };
    }
    // Exactly one live consent: "all of them" means that one. Resolve it
    // through the normal single-pending path when the kind is bare-
    // confirm-resumable; a lone `proposed_concept` keeps its dedicated
    // continuation (fall through — same as a bare "yes" today).
    const only = liveConsentExpectingAll[0]!;
    if (only.action.kind === 'apply_proposed_change') {
      return { matched: true, dispatch: 'pending_action', pending: only };
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

  // CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11) — ratified doctrine (b):
  // when a bare confirmation arrives while MULTIPLE consent-expecting
  // pendings are live, the system must NOT silently resolve one of them
  // (the pre-amendment posture was most-recent-wins WITHIN the consent
  // class). Return every live consent candidate so the executor lists
  // them (numbered, short labels) with per-item chips plus "All of them"
  // and "None" — no mutation on that turn. Ordinal picks ("the first
  // one") were already resolved deterministically by the pre-resolve
  // block above, so only genuinely subject-less confirmations reach
  // this rule. `proposed_concept` counts: it is consent-expecting even
  // though its resume rides the concept-continuation path, so a bare
  // "yes" with a live concept AND a live proposal is ambiguous.
  const liveConsentExpecting = live.filter((pa) =>
    CONFIRMATION_EXPECTING_ACTION_TYPES.has(pa.action.kind),
  );
  if (liveConsentExpecting.length > 1) {
    return {
      matched: true,
      dispatch: 'recovery_ambiguous',
      candidates: orderConsentCandidates(liveConsentExpecting),
    };
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
  // F-HELD CONSENT-PRIORITY (wire finding 2026-07-11; ratified by Paul
  // 2026-07-11 WITH the consent-clarity amendment above): a bare confirm
  // answers the live CONSENT-EXPECTING pending, not the newest chip
  // suggestion. Wire captures 13c→14c showed "yes" binding to a
  // freshly-minted run_analysis offer while a GM hold (apply_proposed_change)
  // was still live — the held change was never applied. Class priority is
  // therefore: live `apply_proposed_change` (a proposal awaiting the user's
  // explicit accept/decline) outranks the chip-suggestion kinds
  // (`run_analysis` / `what_would_flip`) REGARDLESS of emit recency.
  // Liveness still comes first — an expired hold never outranks anything
  // (the expiry split above already removed it). By the time this pick
  // runs, the amendment rule above guarantees AT MOST ONE live
  // consent-expecting pending remains — the multi-consent case returned
  // `recovery_ambiguous` (list, never a silent pick).
  const consentExpecting = resumable.filter(
    (pa) => pa.action.kind === 'apply_proposed_change',
  );
  const pickPool = consentExpecting.length > 0 ? consentExpecting : resumable;

  // V5 P0.2 — most-recent-wins is retained WITHIN the picked class for the
  // NON-consent suggestion kinds only (run_analysis / what_would_flip):
  // when multiple live pendings of the winning class coexist, the MOST
  // RECENTLY EMITTED one wins, so "do it" resumes the latest offer
  // without a clarification detour. For the consent class this can no
  // longer bind more than one candidate — the consent-clarity amendment
  // rule above lists multiple live consents instead of picking. Ordinal
  // pointers ("the first one") are still resolved by index in the
  // pre-resolve block above, and the turn-executor echoes the chosen
  // proposal's label ("Applying: …") so a wrong-target resume stays
  // visible. Graph-hash divergence, idempotency and stale-proposal
  // recovery remain enforced downstream by
  // `decideProposedChangeSynthesis` before any mutation is applied.
  // Tie-break: equal `emitted_at_iso` resolves to the first in input
  // order (Array.prototype.sort is stable) — deterministic, and the
  // read side already places the freshest proposal first.
  const pending =
    pickPool.length === 1
      ? pickPool[0]!
      : [...pickPool].sort((a, b) => emittedAtMs(b) - emittedAtMs(a))[0]!;

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
