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
  | 'multiple_label_matches';

export type ClarificationResumeDispatch =
  | { readonly matched: false; readonly skip_reason: ClarificationResumeSkipReason }
  | {
      readonly matched: true;
      readonly dispatch: 'set_factor_value';
      readonly pending: PendingAction;
      readonly factorLabel: string;
    };

export interface TryClarificationResumeInput {
  readonly message: string;
  readonly pendingActions: readonly PendingAction[];
  readonly graphLookup: GraphLookup | undefined;
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

  const candidates: Array<{ pending: PendingAction; label: string }> = [];
  for (const pending of setFactorPendings) {
    const action = pending.action;
    if (action.kind !== 'set_factor_value') continue;
    const node = input.graphLookup.findEntityById(action.factor_id);
    if (!node?.label) continue;
    const normLabel = node.label.trim().toLowerCase();
    if (normLabel.length === 0) continue;
    // Match if the user's message is the label exactly, or contains
    // the label as a substring. A user who types "Engineering Time
    // Commitment" matches the candidate exactly; a user who types
    // "the Engineering Time Commitment one" still matches via
    // substring. Word-boundary or fuzzy matching is over-engineered
    // here — the candidate set is at most 4 (MAX_CANDIDATES from
    // the value-update detector), and false positives in this set
    // are unlikely because the candidates were already
    // discriminated by label-match in the prior turn.
    if (normMessage === normLabel || normMessage.includes(normLabel)) {
      candidates.push({ pending, label: node.label });
    }
  }

  if (candidates.length === 0) {
    return { matched: false, skip_reason: 'no_label_match' };
  }
  if (candidates.length > 1) {
    return { matched: false, skip_reason: 'multiple_label_matches' };
  }

  return {
    matched: true,
    dispatch: 'set_factor_value',
    pending: candidates[0]!.pending,
    factorLabel: candidates[0]!.label,
  };
}
