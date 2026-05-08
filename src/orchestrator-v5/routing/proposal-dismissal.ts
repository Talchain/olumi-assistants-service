/**
 * V5 G7/G8 — proposal dismissal pre-route.
 *
 * Fires only when at least one live `apply_proposed_change` pending
 * action exists. When the user's message is a clear dismissal ("no",
 * "not now", "cancel", etc.) and contains no positive / apply / edit
 * phrase, this module returns `matched: true` so TurnExecutor emits a
 * deterministic "OK, no change made." direct answer and refuses to
 * re-emit the dismissed pending action on the new turn.
 *
 * Pre-route order (locked in plan): state-query → short-confirm →
 * proposal-ordinal-select (gated on ambiguous) → **proposal-dismissal
 * (here)** → LLM. This module short-circuits cleanly: if the message
 * isn't a dismissal or contains a positive token, returns
 * `{ matched: false }` and the next gate runs.
 *
 * Negative-control gate is critical:
 *   - "not now, but add it anyway"  → MUST NOT dismiss
 *   - "no, change the value to 200" → MUST NOT dismiss
 *   - "cancel that and apply the second one" → MUST NOT dismiss
 *
 * The negative control catches every case where the user mixes a
 * dismissal token with a positive intent or an edit verb. We let those
 * through to the LLM (or to short-confirm / ordinal-select on a later
 * turn) rather than silently swallowing the message.
 */

import type { PendingAction } from '../session/pending-action.js';

/**
 * Dismissal phrases. Anchored start-to-end of the message after
 * trimming and tolerating trailing punctuation. We ONLY match bare
 * dismissals — "no thanks" matches, "no, but add it anyway" does not
 * (the negative-control regex finds "add" and the dismissal is voided).
 */
const DISMISSAL_PATTERN =
  /^\s*(?:no(?:\s+thanks?)?|nope|cancel|not\s+now|dismiss|skip|not\s+yet|leave\s+it)\s*[.!?]*\s*$/i;

/**
 * Negative-control gate. Any of these tokens in the message means the
 * user is mixing dismissal with a positive intent and we must NOT
 * dismiss. Includes:
 *   - explicit positives ("yes", "ok", "do it", "apply", "confirm")
 *   - the conjunction "but" — almost always introduces a positive
 *     follow-up ("not now, but add it anyway")
 *   - edit verbs (mirrors short-confirm's gate)
 *   - any digit (numeric quantity → fresh request, not dismissal)
 */
const POSITIVE_OR_EDIT_PATTERN =
  /\b(?:yes|yep|yeah|sure|ok(?:ay)?|do\s+it|do\s+that|go\s+ahead|apply|confirm|but|increase|decrease|reduce|raise|lower|set|change|update|make|adjust|add|remove|replace|simplif|rebuild)\b|\d/i;

export interface TryProposalDismissalInput {
  readonly message: string;
  /**
   * Live pending actions read from the most recent prior turn. The
   * pre-route only fires when at least one is an
   * `apply_proposed_change`.
   */
  readonly livePendingActions: readonly PendingAction[];
}

export type ProposalDismissalResult =
  | { readonly matched: true; readonly dismissed_count: number }
  | { readonly matched: false };

/**
 * Deterministic copy used by TurnExecutor when this pre-route matches.
 * Single source of truth so tests assert the same string the production
 * path emits.
 */
export const PROPOSAL_DISMISSAL_RESPONSE = 'OK, no change made.';

export function tryProposalDismissal(
  input: TryProposalDismissalInput,
): ProposalDismissalResult {
  // Gate: at least one live apply_proposed_change must exist. Without
  // a target, dismissing makes no sense — fall through.
  const liveProposals = input.livePendingActions.filter(
    (pa) => pa.action.kind === 'apply_proposed_change',
  );
  if (liveProposals.length === 0) return { matched: false };

  // Negative control FIRST. A message that mixes dismissal with a
  // positive token is not a dismissal — let later gates / LLM handle.
  if (POSITIVE_OR_EDIT_PATTERN.test(input.message)) return { matched: false };

  if (!DISMISSAL_PATTERN.test(input.message)) return { matched: false };

  return { matched: true, dismissed_count: liveProposals.length };
}
