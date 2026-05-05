/**
 * V5 Wave 5E — deterministic pre-route for clarification continuity.
 *
 * Solves the brief's evidence #3: after a value-update clarify
 * ("Which one should I update? Owner Time Commitment / Engineering
 * Time Commitment?"), if the user types JUST a factor label
 * ("Engineering Time Commitment") with no quantity, the existing
 * `tryDeterministicValueUpdate` returns `skip_reason: 'no_quantity'`
 * and the message falls through to the LLM, which has lost the
 * parsed quantity from the prior turn.
 *
 * This pre-route reads the most-recent prior turn's pending actions
 * and looks for a `set_factor_value` pending whose target factor
 * label matches the user's reply. On a unique match the persisted
 * quantity + operator + factor_id are reconstructed into the same
 * proposal `tryDeterministicValueUpdate` would have produced — same
 * synthesis path, same handler dispatch, no LLM call.
 *
 * Negative gates (fall through to existing flow):
 *   - message contains an edit verb or quantity (handled by
 *     `tryDeterministicValueUpdate` directly)
 *   - message looks like a confirmation ("yes", "ok") (handled by
 *     `tryShortConfirmResume`)
 *   - no `set_factor_value` pending actions on the prior turn
 *   - no factor whose label matches the message
 *   - multiple factors match → existing recovery_ambiguous path
 *
 * `edit_graph_add_risk` continuity is a planned follow-up and is
 * NOT handled here. The shape it needs is different (the user's
 * reply is a DRIVER factor, not the target risk label) and the
 * deterministic add path lives in legacy `handleEditGraph` rather
 * than the V5 handler registry.
 */

import type { GraphLookup } from './validator.js';
import { bigramDice } from './validator.js';
import type { PendingAction } from '../session/pending-action.js';

/**
 * Same negative-gate regex `tryShortConfirmResume` and
 * `tryDeterministicValueUpdate` use. Defence in depth — if either
 * pre-route ordering changes, this module still doesn't claim
 * messages that belong to those paths.
 */
const EDIT_VERB_OR_QUANTITY_PATTERN =
  /\b(?:increase|decrease|reduce|raise|lower|set|change|update|make|adjust|add|remove|replace|simplif|rebuild)\b|\d/i;

const SHORT_CONFIRM_LIKELIHOOD =
  /^\s*(?:yes|yep|yeah|sure|ok(?:ay)?|do(?:\s+(?:it|that))?|go(?:\s+ahead)?|apply(?:\s+it)?|confirm(?:ed)?|please\s+do)\b/i;

export type ClarificationResumeSkipReason =
  | 'message_likely_value_update'
  | 'message_likely_short_confirm'
  | 'no_pending_clarification'
  | 'no_graph'
  | 'no_label_match'
  | 'multiple_label_matches'
  | 'all_expired'
  | 'all_targets_missing'
  | 'graph_hash_changed';

export type ClarificationResumeDispatch =
  | { readonly matched: false; readonly skip_reason: ClarificationResumeSkipReason }
  | {
      readonly matched: true;
      readonly dispatch: 'set_factor_value';
      readonly pending: PendingAction;
      readonly factorLabel: string;
      readonly matchKind: 'exact' | 'substring' | 'fuzzy';
    };

export interface TryClarificationResumeInput {
  readonly message: string;
  readonly pendingActions: readonly PendingAction[];
  readonly graphLookup: GraphLookup | undefined;
  /**
   * `Date.now()` at dispatch time. Plumbed in for testability so unit
   * tests freeze the clock without monkey-patching `Date`.
   */
  readonly nowMs: number;
  /**
   * Hash of the analysis-affecting graph state at resume time. When a
   * pending action was persisted with `preconditions.graph_hash` and
   * the live hash differs, the persisted operator/value may no longer
   * be safe to apply (the target could have moved, structure could
   * have changed). Pass undefined when no graph hash is computable.
   */
  readonly currentGraphHash?: string;
}

const FUZZY_DICE_FLOOR = 0.5;

function isExpired(pa: PendingAction, nowMs: number): boolean {
  // Mirrors the wall-clock and turn-count checks in
  // `tryShortConfirmResume.isExpired`. Keep the rules in sync — both
  // resumers must agree on what "expired" means.
  const expiresMs = Date.parse(pa.expires_at_iso);
  if (!Number.isFinite(expiresMs)) return true;
  if (nowMs > expiresMs) return true;
  if (pa.expires_at_turn_count <= 0) return true;
  return false;
}

function graphHashConflicts(
  pa: PendingAction,
  currentGraphHash: string | undefined,
): boolean {
  // If the persisted action carries no hash precondition, no conflict
  // possible — any current hash is acceptable. If it does carry one
  // and the current hash is unknown OR differs, treat as conflict.
  const persisted = pa.preconditions?.graph_hash;
  if (!persisted) return false;
  if (currentGraphHash === undefined) return true;
  return persisted !== currentGraphHash;
}

export function tryClarificationResume(
  input: TryClarificationResumeInput,
): ClarificationResumeDispatch {
  // Negative gates: defer to the canonical pre-routes if the message
  // shape is theirs. A user who types "set Engineering Capacity to
  // 30%" carries everything needed for `tryDeterministicValueUpdate`
  // to dispatch directly; we should not intercept that.
  if (EDIT_VERB_OR_QUANTITY_PATTERN.test(input.message)) {
    return { matched: false, skip_reason: 'message_likely_value_update' };
  }
  if (SHORT_CONFIRM_LIKELIHOOD.test(input.message)) {
    return { matched: false, skip_reason: 'message_likely_short_confirm' };
  }

  const setFactorPendings = input.pendingActions.filter(
    (p) => p.action.kind === 'set_factor_value',
  );
  if (setFactorPendings.length === 0) {
    return { matched: false, skip_reason: 'no_pending_clarification' };
  }

  // Apply expiry + graph-hash invalidation BEFORE label matching.
  // The remaining candidates are the only ones safe to apply.
  const live = setFactorPendings.filter((pa) => !isExpired(pa, input.nowMs));
  if (live.length === 0) {
    return { matched: false, skip_reason: 'all_expired' };
  }
  const hashSafe = live.filter(
    (pa) => !graphHashConflicts(pa, input.currentGraphHash),
  );
  if (hashSafe.length === 0) {
    return { matched: false, skip_reason: 'graph_hash_changed' };
  }

  if (input.graphLookup === undefined) {
    // No graph means we cannot resolve factor labels for matching.
    // The persisted pending action's factor_id would be unmatched
    // against an unknown graph; safer to fall through.
    return { matched: false, skip_reason: 'no_graph' };
  }

  const normMessage = input.message.trim().toLowerCase();
  if (normMessage.length === 0) {
    return { matched: false, skip_reason: 'no_label_match' };
  }

  // Build a working set of candidates whose target factor still
  // exists in the live graph. Persisted pending actions whose
  // factor_id has been deleted since are dropped here with a
  // distinct invalidation reason from "no label match".
  type Candidate = {
    pending: PendingAction;
    label: string;
    score: number;
    matchKind: 'exact' | 'substring' | 'fuzzy';
  };
  const targetsResolved: Array<{ pending: PendingAction; label: string }> = [];
  for (const pending of hashSafe) {
    const action = pending.action;
    if (action.kind !== 'set_factor_value') continue;
    const node = input.graphLookup.findEntityById(action.factor_id);
    if (!node?.label) continue;
    targetsResolved.push({ pending, label: node.label });
  }
  if (targetsResolved.length === 0) {
    return { matched: false, skip_reason: 'all_targets_missing' };
  }

  // Pass 1: exact + substring match (deterministic, high-confidence).
  const directMatches: Candidate[] = [];
  for (const t of targetsResolved) {
    const normLabel = t.label.trim().toLowerCase();
    if (normLabel.length === 0) continue;
    if (normMessage === normLabel) {
      directMatches.push({ pending: t.pending, label: t.label, score: 1, matchKind: 'exact' });
    } else if (normMessage.includes(normLabel)) {
      directMatches.push({ pending: t.pending, label: t.label, score: 1, matchKind: 'substring' });
    }
  }

  // Pass 2: fuzzy bigram-Dice fallback. Only runs when no direct
  // matches were found. The candidate set in this pre-route is small
  // (at most 4, all label-similar to the prior turn's user message),
  // so a 0.5 threshold is conservative — typos like "Engneering Time
  // Comitmnt" still cluster well above 0.5 against "Engineering Time
  // Commitment", but unrelated factors do not. Above-threshold
  // matches sort by score; ambiguity goes to multiple_label_matches.
  let pickFrom: Candidate[] = directMatches;
  if (directMatches.length === 0) {
    const fuzzy: Candidate[] = [];
    for (const t of targetsResolved) {
      const normLabel = t.label.trim().toLowerCase();
      if (normLabel.length === 0) continue;
      const score = bigramDice(normMessage, normLabel);
      if (score >= FUZZY_DICE_FLOOR) {
        fuzzy.push({ pending: t.pending, label: t.label, score, matchKind: 'fuzzy' });
      }
    }
    pickFrom = fuzzy;
  }

  if (pickFrom.length === 0) {
    return { matched: false, skip_reason: 'no_label_match' };
  }
  if (pickFrom.length > 1) {
    return { matched: false, skip_reason: 'multiple_label_matches' };
  }

  return {
    matched: true,
    dispatch: 'set_factor_value',
    pending: pickFrom[0]!.pending,
    factorLabel: pickFrom[0]!.label,
    matchKind: pickFrom[0]!.matchKind,
  };
}
